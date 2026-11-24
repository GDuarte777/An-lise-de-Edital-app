import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { extrairCodigoUasg, normalizarCodigoUasg } from "./src/utils/identificacaoEdital";
import { derivarChaveMestra, descriptografarSegredo, estaCriptografado } from "./src/utils/segredos";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL_DEFAULT = process.env.VITE_SUPABASE_URL || "https://cghlfhndoqohmrrvppjj.supabase.co";
const SUPABASE_ANON_KEY_DEFAULT =
  process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_FWDd-D9L6tGwasm1-qyT1Q_c7T9m_6o";

interface ServerAiConfig {
  provider: string;
  apiKey: string;
  model: string;
}

interface CachedModels {
  models: string[];
  timestamp: number;
}

const modelDiscoveryCache = new Map<string, CachedModels>();
const MODEL_CACHE_TTL_MS = 10 * 60_000;

// In-memory store for chunked large file uploads (> 2.2MB)
interface UploadSession {
  name: string;
  type: string;
  chunks: Map<number, string>;
  totalChunks: number;
  createdAt: number;
}
const chunkUploads = new Map<string, UploadSession>();

export function normalizeServerGeminiModel(model?: string | null): string {
  const clean = (model || "").trim().toLowerCase();
  if (
    !clean ||
    clean.startsWith("gemini-1.") ||
    clean.startsWith("gemini-2.0") ||
    clean.startsWith("gemini-2.5") ||
    clean === "gemini-flash-latest" ||
    clean === "gemini-flash-lite-latest" ||
    clean === "gemini-pro" ||
    clean === "gemini-pro-latest"
  ) {
    return "gemini-3.5-flash-lite";
  }
  return clean;
}

export function normalizeModelForRemoteEdge(provider: string, model?: string | null): string {
  if (provider !== "gemini") return model || "";
  return normalizeServerGeminiModel(model);
}

function scoreGeminiModel(name: string): number {
  const n = name.toLowerCase();
  if (
    n.includes("embedding") ||
    n.includes("aqa") ||
    n.includes("imagen") ||
    n.includes("veo") ||
    n.includes("tts") ||
    n.includes("image") ||
    n.includes("audio") ||
    n.includes("robotics") ||
    n.includes("computer-use") ||
    n.includes("gemma") ||
    n.startsWith("gemini-1.") ||
    n.startsWith("gemini-2.0") ||
    n.startsWith("gemini-2.5") ||
    n === "gemini-flash-latest" ||
    n === "gemini-flash-lite-latest" ||
    n === "gemini-pro-latest" ||
    n.includes("-001") ||
    n.includes("exp")
  ) {
    return -1;
  }
  if (n === "gemini-3.5-flash-lite") return 200;
  if (n === "gemini-3.5-flash") return 195;
  if (n === "gemini-3.1-flash-lite") return 190;
  if (n === "gemini-3.1-flash-lite-preview") return 188;
  if (n === "gemini-3.8-flash-lite") return 186;
  if (n === "gemini-3.8-flash") return 185;
  if (n === "gemini-4-hydrogen") return 180;
  if (n === "gemini-3-flash-preview" || n === "gemini-3-flash") return 175;
  if (n.includes("flash-lite")) return 170;
  if (n.includes("flash")) return 165;
  if (n === "gemini-3.5-pro" || n === "gemini-3.1-pro-preview" || n === "gemini-4-neon") return 150;
  if (n.includes("pro")) return 140;
  return 10;
}

async function discoverServerGeminiModels(apiKey: string): Promise<string[] | null> {
  const cleanKey = (apiKey || "").trim();
  if (!cleanKey || estaCriptografado(cleanKey)) return null;

  const cached = modelDiscoveryCache.get(cleanKey);
  if (cached && Date.now() - cached.timestamp < MODEL_CACHE_TTL_MS) {
    return cached.models;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7_000);
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}&pageSize=200`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!resp.ok) return null;

    const data = await resp.json();
    const rawModels: string[] = (data?.models || [])
      .filter(
        (m: any) =>
          Array.isArray(m?.supportedGenerationMethods) &&
          m.supportedGenerationMethods.includes("generateContent")
      )
      .map((m: any) => String(m?.name || "").replace(/^models\//, ""))
      .filter((m: string) => Boolean(m) && scoreGeminiModel(m) > 0)
      .sort((a: string, b: string) => scoreGeminiModel(b) - scoreGeminiModel(a) || b.localeCompare(a));

    if (rawModels.length === 0) return null;
    modelDiscoveryCache.set(cleanKey, { models: rawModels, timestamp: Date.now() });
    return rawModels;
  } catch {
    return null;
  }
}

function chooseServerGeminiChain(preferredModel: string, discovered: string[] | null): string[] {
  const normPreferred = normalizeServerGeminiModel(preferredModel);
  const defaults = [
    normPreferred,
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.8-flash",
    "gemini-4-hydrogen",
    "gemini-3-flash-preview",
  ];

  if (!discovered || discovered.length === 0) {
    return Array.from(new Set(defaults)).slice(0, 6);
  }

  const chain: string[] = [];
  if (normPreferred && discovered.includes(normPreferred)) {
    chain.push(normPreferred);
  }
  if (!chain.includes("gemini-3.5-flash-lite")) {
    chain.push("gemini-3.5-flash-lite");
  }
  for (const m of discovered) {
    if (chain.length >= 6) break;
    if (!chain.includes(m)) chain.push(m);
  }
  for (const d of defaults) {
    if (chain.length >= 6) break;
    if (!chain.includes(d)) chain.push(d);
  }
  return chain;
}

export function cleanAndParseJsonServer(text: string): any {
  if (!text) return {};
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();

  const firstBrace = cleaned.search(/[\{\[]/);
  const lastBrace = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      const fixedJson = cleaned
        .replace(/,\s*([\}\]])/g, "$1")
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, (match) => {
          if (match === "\n") return "\\n";
          if (match === "\r") return "\\r";
          if (match === "\t") return "\\t";
          return "";
        });
      return JSON.parse(fixedJson);
    } catch {
      return {};
    }
  }
}

function sanitizeServerAiText(text: string): string {
  if (!text) return "";
  return text
    .replace(/\$\$(.*?)\$\$/gs, (_, f) => f)
    .replace(/\$(.*?)\$/g, (_, f) => f)
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\\times/g, "x")
    .replace(/\\cdot/g, "x")
    .replace(/\\rightarrow/g, "→")
    .replace(/\\leftarrow/g, "←")
    .replace(/\\Rightarrow/g, "=>")
    .replace(/\\approx/g, "≈")
    .replace(/\\le/g, "≤")
    .replace(/\\ge/g, "≥")
    .replace(/\\neq/g, "≠");
}

function resolveUploadAttachment(file: any): any {
  if (!file || typeof file !== "object") return file;
  if (file.uploadId && chunkUploads.has(file.uploadId)) {
    const session = chunkUploads.get(file.uploadId)!;
    const ordered: string[] = [];
    for (let i = 0; i < session.totalChunks; i++) {
      ordered.push(session.chunks.get(i) || "");
    }
    return {
      ...file,
      name: file.name || session.name,
      type: file.type || session.type,
      base64: ordered.join(""),
    };
  }
  return file;
}

function fileAttachmentToPart(rawFile: any): any | null {
  const file = resolveUploadAttachment(rawFile);
  if (!file) return null;
  const rawB64 = file.base64 || file.fileBase64 || file.data || "";
  if (!rawB64 || typeof rawB64 !== "string") return null;

  const cleanB64 = rawB64.replace(/^data:[^;]+;base64,/, "").trim();
  if (!cleanB64) return null;

  const fname = (file.name || file.fileName || "").toLowerCase();
  let mtype = file.type || file.fileType || file.mimeType || "";
  if (!mtype || mtype === "application/octet-stream") {
    if (fname.endsWith(".pdf")) mtype = "application/pdf";
    else if (fname.endsWith(".txt") || fname.endsWith(".md") || fname.endsWith(".csv")) mtype = "text/plain";
    else if (fname.endsWith(".png")) mtype = "image/png";
    else if (fname.endsWith(".jpg") || fname.endsWith(".jpeg")) mtype = "image/jpeg";
    else mtype = "application/pdf";
  }

  if (mtype.startsWith("text/") || fname.endsWith(".txt") || fname.endsWith(".md") || fname.endsWith(".csv")) {
    try {
      const decoded = Buffer.from(cleanB64, "base64").toString("utf-8");
      if (decoded.trim()) {
        return {
          text: `\n\n--- INÍCIO DO ANEXO (${file.name || "Documento"}) ---\n${decoded}\n--- FIM DO ANEXO ---\n\n`,
        };
      }
    } catch {
      // fall through to inlineData
    }
  }

  return {
    inlineData: {
      mimeType: mtype,
      data: cleanB64,
    },
  };
}

function createServerGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function resolveServerAiConfig(rawAiConfig?: any): ServerAiConfig | null {
  const provider = rawAiConfig?.provider || "gemini";
  let rawKey = String(rawAiConfig?.apiKey || "").trim();

  if (estaCriptografado(rawKey)) {
    const masterSecret = derivarChaveMestra(process.env.AI_KEYS_ENCRYPTION_KEY || "");
    if (masterSecret) {
      rawKey = descriptografarSegredo(rawKey, masterSecret).trim();
    } else {
      rawKey = "";
    }
  }

  if (!rawKey && provider === "gemini") {
    rawKey = (process.env.GEMINI_API_KEY || "").trim();
  }
  if (!rawKey && provider === "openai") {
    rawKey = (process.env.OPENAI_API_KEY || "").trim();
  }
  if (!rawKey && provider === "deepseek") {
    rawKey = (process.env.DEEPSEEK_API_KEY || "").trim();
  }
  // If user selected another provider without key, fall back to server GEMINI_API_KEY if available
  if (!rawKey && process.env.GEMINI_API_KEY) {
    return {
      provider: "gemini",
      apiKey: process.env.GEMINI_API_KEY.trim(),
      model: normalizeServerGeminiModel(rawAiConfig?.model),
    };
  }

  if (!rawKey || rawKey.length < 10) {
    return null;
  }

  return {
    provider,
    apiKey: rawKey,
    model:
      provider === "gemini"
        ? normalizeServerGeminiModel(rawAiConfig?.model)
        : String(rawAiConfig?.model || ""),
  };
}

async function runServerLLMCall(params: {
  aiConfig: ServerAiConfig;
  contents: any[];
  systemInstruction?: string;
  jsonMode?: boolean;
  responseSchema?: any;
}): Promise<string> {
  const { aiConfig, contents, systemInstruction, jsonMode, responseSchema } = params;
  const provider = aiConfig.provider || "gemini";
  const apiKey = (aiConfig.apiKey || "").trim();

  if (provider === "openai" || provider === "deepseek") {
    const endpoint =
      provider === "openai"
        ? "https://api.openai.com/v1/chat/completions"
        : "https://api.deepseek.com/v1/chat/completions";
    const defaultModel = provider === "openai" ? "gpt-4o" : "deepseek-chat";

    const textPrompt = contents
      .map((c: any) => {
        if (typeof c === "string") return c;
        if (c?.text) return c.text;
        if (Array.isArray(c?.parts)) {
          return c.parts.map((p: any) => p?.text || "").filter(Boolean).join("\n");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n");

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: aiConfig.model || defaultModel,
        messages: [
          ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
          { role: "user", content: textPrompt },
        ],
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`${provider.toUpperCase()} API Error (${resp.status}): ${errText.slice(0, 200)}`);
    }
    const data = await resp.json();
    return sanitizeServerAiText(data?.choices?.[0]?.message?.content || "");
  }

  // Server-side Gemini call via @google/genai SDK with User-Agent: 'aistudio-build'
  const ai = createServerGeminiClient(apiKey);
  const discovered = await discoverServerGeminiModels(apiKey);
  const modelsToTry = chooseServerGeminiChain(aiConfig.model, discovered);

  const isRoleBased = contents.every((c) => c && typeof c === "object" && Array.isArray(c.parts));
  const formattedContents = isRoleBased
    ? contents.map((c) => ({
        role: c.role === "assistant" || c.role === "model" ? "model" : "user",
        parts: c.parts,
      }))
    : [
        {
          role: "user",
          parts: contents.map((c) => (typeof c === "string" ? { text: c } : c)),
        },
      ];

  let lastError: any = null;
  const tried = new Set<string>();
  const queue = [...modelsToTry];

  while (queue.length > 0) {
    const modelName = queue.shift()!;
    if (!modelName || tried.has(modelName)) continue;
    tried.add(modelName);

    try {
      const config: any = {};
      if (systemInstruction) config.systemInstruction = systemInstruction;
      if (jsonMode) config.responseMimeType = "application/json";
      if (responseSchema) config.responseSchema = responseSchema;

      const response = await ai.models.generateContent({
        model: modelName,
        contents: formattedContents,
        ...(Object.keys(config).length > 0 ? { config } : {}),
      });

      if (response?.text) {
        return sanitizeServerAiText(response.text);
      }
    } catch (err: any) {
      lastError = err;
      const errMsg = String(err?.message || "");
      // Self-heal if Google's 404 error recommends a replacement model ("Please update your code to use models/<name>")
      const suggestedMatch = errMsg.match(/use\s+models\/([a-zA-Z0-9._-]+)/i);
      if (suggestedMatch && suggestedMatch[1]) {
        const suggestedModel = suggestedMatch[1].trim();
        if (!tried.has(suggestedModel)) {
          queue.unshift(suggestedModel);
        }
      }

      if (responseSchema && (err?.status === 400 || errMsg.includes("400"))) {
        try {
          const fallbackConfig: any = {};
          if (systemInstruction) fallbackConfig.systemInstruction = systemInstruction;
          if (jsonMode) fallbackConfig.responseMimeType = "application/json";
          const responseNoSchema = await ai.models.generateContent({
            model: modelName,
            contents: formattedContents,
            config: fallbackConfig,
          });
          if (responseNoSchema?.text) {
            return sanitizeServerAiText(responseNoSchema.text);
          }
        } catch (retryErr: any) {
          lastError = retryErr;
        }
      }
    }
  }

  throw lastError || new Error("Falha ao comunicar com a API do Gemini no servidor.");
}

export function normalizeEditalAnalysisObject(parsedData: any, rawTextInput = ""): any {
  const NAO_IDENTIFICADO = "Não identificado no edital";
  const textoOuNulo = (valor: any): string => {
    const t = String(valor ?? "").trim();
    if (!t) return "";
    const baixo = t.toLowerCase();
    if (baixo === "null" || baixo === "undefined" || baixo === "n/a" || baixo === "na") return "";
    return t;
  };
  const ehPlaceholder = (valor: string): boolean =>
    /^n[ãa]o\s+(especificad|identificad|informad|localizad|consta|h[áa]\b)/i.test(valor.trim());
  const listaDeTextos = (valor: any): string[] =>
    Array.isArray(valor) ? valor.map(textoOuNulo).filter((t) => Boolean(t) && !ehPlaceholder(t)) : [];

  const result: any = { ...(parsedData || {}) };
  result.pontosPositivos = listaDeTextos(result.pontosPositivos);
  result.pontosAlerta = listaDeTextos(result.pontosAlerta);
  result.documentosExigidos = listaDeTextos(result.documentosExigidos);

  if (!Array.isArray(result.itensEdital)) {
    result.itensEdital = [];
  } else {
    const vistos = new Set<string>();
    result.itensEdital = result.itensEdital
      .filter((it: any) => it && typeof it === "object")
      .map((it: any, idx: number) => {
        const descricao = textoOuNulo(it.descricao ?? it.descrição) || NAO_IDENTIFICADO;
        const quantidadeBruta = Number(it.quantidade);
        return {
          numero: Number.isFinite(Number(it.numero)) ? Number(it.numero) : idx + 1,
          descricao,
          quantidade: Number.isFinite(quantidadeBruta) && quantidadeBruta >= 0 ? quantidadeBruta : 0,
          unidade: textoOuNulo(it.unidade) || "Unidade",
          valorEstimado: textoOuNulo(it.valorEstimado) || "Não especificado no edital",
        };
      })
      .filter((it: any) => {
        const chave = `${it.numero}|${it.descricao}|${it.quantidade}|${it.unidade}`;
        if (vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
      });
  }

  const objetoOuNulo = (valor: any) => (valor && typeof valor === "object" ? valor : {});
  const ic = objetoOuNulo(result.identificacaoCertame);
  result.identificacaoCertame = {
    ...ic,
    orgaoComprador: textoOuNulo(ic.orgaoComprador) || NAO_IDENTIFICADO,
    modalidade: textoOuNulo(ic.modalidade) || NAO_IDENTIFICADO,
    identificacaoNumerica: textoOuNulo(ic.identificacaoNumerica) || NAO_IDENTIFICADO,
    codigoUASG: normalizarCodigoUasg(textoOuNulo(ic.codigoUASG)),
    numeroEdital: textoOuNulo(ic.numeroEdital) || "",
    dataHoraSessao: textoOuNulo(ic.dataHoraSessao) || NAO_IDENTIFICADO,
  };

  if (!result.identificacaoCertame.codigoUASG) {
    result.identificacaoCertame.codigoUASG = extrairCodigoUasg(
      [result.identificacaoCertame.orgaoComprador, rawTextInput, result.reportMarkdown].filter(Boolean).join(" ")
    );
  }

  const et = objetoOuNulo(result.especificacoesTecnicas);
  result.especificacoesTecnicas = {
    exigenciasFisicas: listaDeTextos(et.exigenciasFisicas),
    pegadinhasOcultas: listaDeTextos(et.pegadinhasOcultas),
  };

  const bb = objetoOuNulo(result.burocraciaBarreiras);
  result.burocraciaBarreiras = {
    exigeAmostra: textoOuNulo(bb.exigeAmostra) || NAO_IDENTIFICADO,
    exigeCartaSolidariedade: textoOuNulo(bb.exigeCartaSolidariedade) || NAO_IDENTIFICADO,
    exigenciaGarantia: textoOuNulo(bb.exigenciaGarantia) || NAO_IDENTIFICADO,
    consorcioSubcontratacao: textoOuNulo(bb.consorcioSubcontratacao) || NAO_IDENTIFICADO,
  };

  const lc = objetoOuNulo(result.logisticaCronograma);
  result.logisticaCronograma = {
    prazoEntregaReal: textoOuNulo(lc.prazoEntregaReal) || textoOuNulo(result.prazoEntrega) || NAO_IDENTIFICADO,
    classificacaoPrazo: textoOuNulo(lc.classificacaoPrazo) || NAO_IDENTIFICADO,
    enderecoEntrega: textoOuNulo(lc.enderecoEntrega) || NAO_IDENTIFICADO,
    prazoGarantia: textoOuNulo(lc.prazoGarantia) || NAO_IDENTIFICADO,
  };

  const vf = objetoOuNulo(result.viabilidadeFinanceira);
  result.viabilidadeFinanceira = {
    valorEstimado: textoOuNulo(vf.valorEstimado) || NAO_IDENTIFICADO,
    distorcoesPreco: textoOuNulo(vf.distorcoesPreco) || NAO_IDENTIFICADO,
    prazoPagamento: textoOuNulo(vf.prazoPagamento) || textoOuNulo(result.prazoPagamento) || NAO_IDENTIFICADO,
  };

  const pf = objetoOuNulo(result.parecerFinal);
  result.parecerFinal = {
    veredito: textoOuNulo(pf.veredito) || "Analisar viabilidade técnica e comercial",
    grauRisco: textoOuNulo(pf.grauRisco) || "Médio",
    estrategiaLances: textoOuNulo(pf.estrategiaLances) || NAO_IDENTIFICADO,
  };

  result.prazoEntrega = textoOuNulo(result.prazoEntrega) || result.logisticaCronograma.prazoEntregaReal;
  result.prazoPagamento = textoOuNulo(result.prazoPagamento) || result.viabilidadeFinanceira.prazoPagamento;
  result.descricaoProduto = textoOuNulo(result.descricaoProduto) || NAO_IDENTIFICADO;

  const naoLocalizado = (valor: string) => !valor || valor === NAO_IDENTIFICADO || ehPlaceholder(valor);
  result.camposNaoIdentificados = [
    ...(result.itensEdital.length === 0 ? ["itens do edital"] : []),
    ...(result.documentosExigidos.length === 0 ? ["documentos exigidos"] : []),
    ...(naoLocalizado(result.viabilidadeFinanceira.valorEstimado) ? ["valor estimado"] : []),
    ...(naoLocalizado(result.identificacaoCertame.orgaoComprador) ? ["órgão comprador"] : []),
    ...(naoLocalizado(result.identificacaoCertame.modalidade) ? ["modalidade"] : []),
    ...(naoLocalizado(result.identificacaoCertame.dataHoraSessao) ? ["data da sessão"] : []),
  ];

  return result;
}

export function buildEditalAnalysisPrompt(textInput: string, selectedItems?: any[]): string {
  const focusStr =
    Array.isArray(selectedItems) && selectedItems.length > 0
      ? `\nFOCO NOS ITENS SELECIONADOS:\n${selectedItems
          .map((it) => `- Item ${it.numero}: ${it.descricao} (Qtd: ${it.quantidade} ${it.unidade || ""})`)
          .join("\n")}\n`
      : "";

  return `Você é um Analista Sênior de Licitações Públicas (Lei Federal nº 14.133/2021).
Analise o Edital / Termo de Referência anexado e retorne EXCLUSIVAMENTE um objeto JSON válido com a estrutura completa abaixo (sem markdown \`\`\` fora do JSON).

REGRAS CRÍTICAS:
1. FIDELIDADE ABSOLUTA AO EDITAL: Extraia apenas fatos reais do documento. Onde uma informação não constar no edital, escreva "Não especificado no edital".
2. ITENS E LOTES ("itensEdital"): Liste TODOS os itens/lotes do edital com numero, descricao, quantidade (número), unidade e valorEstimado (valor unitário).
3. VALORES: Em "viabilidadeFinanceira.valorEstimado", informe o valor global total estimado da licitação.
4. DOCUMENTOS EXIGIDOS ("documentosExigidos"): Liste apenas os documentos e certidões exigidos para habilitação no edital.
${focusStr}
ESTRUTURA JSON OBRIGATÓRIA:
{
  "pontosPositivos": ["..."],
  "pontosAlerta": ["..."],
  "prazoEntrega": "...",
  "prazoPagamento": "...",
  "descricaoProduto": "...",
  "documentosExigidos": ["..."],
  "itensEdital": [
    { "numero": 1, "descricao": "...", "quantidade": 1, "unidade": "Unid", "valorEstimado": "R$ 0,00" }
  ],
  "identificacaoCertame": {
    "orgaoComprador": "...",
    "modalidade": "...",
    "identificacaoNumerica": "...",
    "codigoUASG": "",
    "numeroEdital": "",
    "dataHoraSessao": "...",
    "idContratacaoPNCP": "",
    "linkPNCP": ""
  },
  "especificacoesTecnicas": {
    "exigenciasFisicas": ["..."],
    "pegadinhasOcultas": ["..."]
  },
  "burocraciaBarreiras": {
    "exigeAmostra": "...",
    "exigeCartaSolidariedade": "...",
    "exigenciaGarantia": "...",
    "consorcioSubcontratacao": "..."
  },
  "logisticaCronograma": {
    "prazoEntregaReal": "...",
    "classificacaoPrazo": "Confortável | Aceitável | Crítico",
    "enderecoEntrega": "...",
    "prazoGarantia": "..."
  },
  "viabilidadeFinanceira": {
    "valorEstimado": "...",
    "distorcoesPreco": "...",
    "prazoPagamento": "..."
  },
  "parecerFinal": {
    "veredito": "...",
    "grauRisco": "Baixo | Médio | Alto",
    "estrategiaLances": "..."
  },
  "dossieExecutivo": {
    "kicker": "INTELIGÊNCIA LICITATÓRIA • LEI Nº 14.133/2021",
    "titulo": "Dossiê Executivo: ...",
    "subtituloOrgao": "Órgão: ... • Processo: ... • Objeto: ...",
    "sinteseTitulo": "SÍNTESE ESTRATÉGICA DA OPORTUNIDADE",
    "sinteseTexto": "...",
    "secao1Titulo": "1. Dados Oficiais, Valores, Prazo e Local de Entrega",
    "colunaRegraTitulo": "Regra Oficial do Edital e Termo de Referência",
    "dadosOficiais": [
      { "parametro": "Órgão e Plataforma", "regra": "..." },
      { "parametro": "Sessão e Disputa", "regra": "..." },
      { "parametro": "Valor Global Estimado", "regra": "..." },
      { "parametro": "Prazo e Local de Entrega", "regra": "..." },
      { "parametro": "Condições de Pagamento", "regra": "..." }
    ],
    "secao2Titulo": "2. Planilha de Itens, Quantitativos e Valores Máximos",
    "especificacaoComum": "...",
    "secao3Titulo": "3. Pontos de Atenção e Riscos Críticos do Edital",
    "pontosAtencao": [
      { "prefixo": "PONTO DE ATENÇÃO 1", "titulo": "...", "descricao": "..." }
    ],
    "secao4Titulo": "4. Checklist Rápido de Habilitação e Proposta",
    "checklistCategorizado": [
      { "categoria": "Proposta Comercial", "descricao": "..." },
      { "categoria": "Habilitação Jurídica, Fiscal e Trabalhista", "descricao": "..." },
      { "categoria": "Qualificação Econômico-Financeira e Técnica", "descricao": "..." }
    ],
    "rodapeTexto": "Dossiê Executivo • Análise Oficial"
  },
  "reportMarkdown": "### 🎯 Veredito da Análise\\n..."
}
${textInput ? `\nCONTEÚDO / TEXTO DO EDITAL:\n${textInput}` : ""}`;
}

async function forwardToSupabaseEdge(req: express.Request, res: express.Response) {
  try {
    const targetUrl = `${SUPABASE_URL_DEFAULT.replace(/\/+$/, "")}/functions/v1${req.originalUrl}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: req.headers["apikey"] ? String(req.headers["apikey"]) : SUPABASE_ANON_KEY_DEFAULT,
    };
    if (req.headers.authorization) {
      headers["Authorization"] = String(req.headers.authorization);
    }

    const bodyObj = req.body && typeof req.body === "object" ? { ...req.body } : {};
    if (bodyObj.aiConfig) {
      bodyObj.aiConfig = {
        ...bodyObj.aiConfig,
        model: normalizeModelForRemoteEdge(bodyObj.aiConfig.provider || "gemini", bodyObj.aiConfig.model),
      };
    }

    const fetchOpts: RequestInit = {
      method: req.method,
      headers,
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      fetchOpts.body = JSON.stringify(bodyObj);
    }

    const edgeResp = await fetch(targetUrl, fetchOpts);

    // Automatic recovery if /api/analyze-edital on the remote Edge Function returns degraded: true
    if (req.path === "/api/analyze-edital" && edgeResp.ok) {
      const cloned = edgeResp.clone();
      const jsonData = await cloned.json().catch(() => null);
      if (jsonData?.degraded) {
        try {
          const allFiles = [
            ...(Array.isArray(bodyObj.attachments) ? bodyObj.attachments : []),
            ...(Array.isArray(bodyObj.attachedFiles) ? bodyObj.attachedFiles : []),
            ...(Array.isArray(bodyObj.files) ? bodyObj.files : []),
            ...(bodyObj.fileBase64
              ? [{ base64: bodyObj.fileBase64, name: bodyObj.fileName, type: bodyObj.fileType }]
              : []),
          ].map(resolveUploadAttachment);

          const firstFileWithB64 = allFiles.find((f: any) => f && (f.base64 || f.fileBase64 || f.data));
          const prompt = buildEditalAnalysisPrompt(String(bodyObj.textInput || ""), bodyObj.selectedItems);

          const chatMessages: any[] = [
            {
              role: "user",
              content: prompt,
              ...(firstFileWithB64
                ? {
                    attachment: {
                      name: firstFileWithB64.name || firstFileWithB64.fileName || "edital.pdf",
                      type: firstFileWithB64.type || firstFileWithB64.fileType || "application/pdf",
                      data: firstFileWithB64.base64 || firstFileWithB64.fileBase64 || firstFileWithB64.data,
                    },
                  }
                : {}),
            },
          ];

          const chatUrl = `${SUPABASE_URL_DEFAULT.replace(/\/+$/, "")}/functions/v1/api/chat`;
          const chatResp = await fetch(chatUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
              messages: chatMessages,
              aiConfig: bodyObj.aiConfig,
            }),
          });

          if (chatResp.ok) {
            const chatJson = await chatResp.json().catch(() => null);
            if (chatJson?.reply && !chatJson?.degraded) {
              const parsed = cleanAndParseJsonServer(chatJson.reply);
              if (parsed && Object.keys(parsed).length > 2) {
                const normalized = normalizeEditalAnalysisObject(parsed, String(bodyObj.textInput || ""));
                if (jsonData.analysis?.dadosOficiaisPNCP) {
                  normalized.dadosOficiaisPNCP = jsonData.analysis.dadosOficiaisPNCP;
                }
                return res.status(200).json({ analysis: normalized });
              }
            }
          }
        } catch (recoverErr) {
          console.warn("[server] Falha na recuperação de analyze-edital via /api/chat:", recoverErr);
        }
      }
    }

    const contentType = edgeResp.headers.get("content-type") || "application/json";
    res.status(edgeResp.status).setHeader("Content-Type", contentType);
    const buffer = Buffer.from(await edgeResp.arrayBuffer());
    return res.send(buffer);
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || "Erro ao encaminhar requisição para a Edge Function." });
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // 0. Health & Chunked Upload endpoints
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", runtime: "node-express" });
  });

  app.post("/api/upload-chunk/init", (req, res) => {
    const uploadId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    chunkUploads.set(uploadId, {
      name: String(req.body?.name || "arquivo.pdf"),
      type: String(req.body?.type || "application/pdf"),
      chunks: new Map(),
      totalChunks: 0,
      createdAt: Date.now(),
    });
    res.json({ uploadId });
  });

  app.post("/api/upload-chunk", (req, res) => {
    const { uploadId, chunkIndex, totalChunks, chunkBase64 } = req.body || {};
    const session = chunkUploads.get(String(uploadId || ""));
    if (!session) {
      return res.status(404).json({ error: "Sessão de upload não encontrada." });
    }
    session.chunks.set(Number(chunkIndex), String(chunkBase64 || ""));
    session.totalChunks = Math.max(session.totalChunks, Number(totalChunks) || 0);
    return res.json({ received: true, chunkIndex });
  });

  // 1. /api/ai-status
  const handleAiStatus = async (req: express.Request, res: express.Response) => {
    const serverAi = resolveServerAiConfig(req.body?.aiConfig);
    if (!serverAi) {
      return forwardToSupabaseEdge(req, res);
    }

    if (serverAi.provider === "gemini") {
      const disponiveis = await discoverServerGeminiModels(serverAi.apiKey);
      const normModel = normalizeServerGeminiModel(serverAi.model);
      const cadeia = chooseServerGeminiChain(normModel, disponiveis);
      const servido = disponiveis ? disponiveis.includes(normModel) : null;
      return res.json({
        configured: true,
        provider: "gemini",
        model: normModel,
        modeloServidoPelaChave: servido,
        modelosDisponiveis: disponiveis,
        cadeiaQueSeraUsada: cadeia,
      });
    }

    return res.json({
      configured: true,
      provider: serverAi.provider,
      model: serverAi.model,
      modeloServidoPelaChave: true,
      modelosDisponiveis: [serverAi.model],
      cadeiaQueSeraUsada: [serverAi.model],
    });
  };
  app.get("/api/ai-status", handleAiStatus);
  app.post("/api/ai-status", handleAiStatus);

  // 2. /api/chat/title
  app.post("/api/chat/title", (req, res) => {
    const msg = String(req.body?.message || "").trim();
    const clean = msg.replace(/\s+/g, " ").slice(0, 38);
    res.json({ title: clean || "Nova Conversa" });
  });

  // 3. /api/chat
  app.post("/api/chat", async (req, res) => {
    const serverAi = resolveServerAiConfig(req.body?.aiConfig);
    if (!serverAi) {
      return forwardToSupabaseEdge(req, res);
    }

    try {
      const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const companyData = req.body?.companyData;
      const activeEdital = req.body?.activeEditalAnalysis;

      const formattedHistory = messages.map((m: any) => {
        const parts: any[] = [];
        if (m.attachment && (m.attachment.data || m.attachment.uploadId)) {
          const part = fileAttachmentToPart({
            name: m.attachment.name,
            type: m.attachment.type,
            base64: m.attachment.data,
            uploadId: m.attachment.uploadId,
          });
          if (part) parts.push(part);
        }
        parts.push({ text: m.content || "Analise o documento anexado." });
        return {
          role: m.role === "assistant" ? "model" : "user",
          parts,
        };
      });

      const editalCompacto = activeEdital
        ? (() => {
            const { rawText, ...resto } = activeEdital;
            return resto;
          })()
        : null;

      const systemInstruction = `Você é a HORASIS AI, Assessora e Consultora Inteligente de Licitações e Pregões Eletrônicos (Lei Federal nº 14.133/2021).
Responda de forma clara, direta, prática e bem estruturada em português do Brasil. Não use fórmulas em LaTeX ($$ ou \\text).
${
  companyData
    ? `\nDados da Empresa do Usuário:\n- Razão Social: ${companyData.razonSocial || ""}\n- CNPJ: ${companyData.cnpj || ""}\n- Representante: ${companyData.representativeName || ""}`
    : ""
}
${editalCompacto ? `\nEdital Selecionado nesta Conversa:\n${JSON.stringify(editalCompacto, null, 2)}` : ""}`;

      const reply = await runServerLLMCall({
        aiConfig: serverAi,
        contents: formattedHistory,
        systemInstruction,
      });

      return res.json({ reply });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Erro ao processar o chat na IA." });
    }
  });

  // 4. /api/analyze-cert
  app.post("/api/analyze-cert", async (req, res) => {
    const serverAi = resolveServerAiConfig(req.body?.aiConfig);
    if (!serverAi) {
      return forwardToSupabaseEdge(req, res);
    }

    try {
      const bodyObj = req.body || {};
      const fileBase64 = bodyObj.fileBase64 || bodyObj.base64 || bodyObj.data;
      const fileName = bodyObj.fileName || bodyObj.name || "documento.pdf";
      const fileType = bodyObj.fileType || bodyObj.type || "application/pdf";
      const docName = bodyObj.docName || bodyObj.name || fileName;

      const parts: any[] = [];
      const filePart = fileAttachmentToPart({
        base64: fileBase64,
        name: fileName,
        type: fileType,
        uploadId: bodyObj.uploadId,
      });
      if (filePart) parts.push(filePart);

      parts.push({
        text: `Analise esta certidão/documento empresarial ("${docName}", arquivo "${fileName}") e retorne EXCLUSIVAMENTE um JSON válido com os campos:
{
  "documentName": "Nome oficial padronizado da certidão/documento identificado no conteúdo",
  "emissionDate": "YYYY-MM-DD ou vazio se não constar",
  "expirationDate": "YYYY-MM-DD (se constar prazo como 'válida por 90 dias' ou '180 dias', some os dias à data de emissão e retorne YYYY-MM-DD; se for permanente como CNPJ ou Contrato Social, retorne \"\")",
  "suggestedNotes": "Resumo curto de 1 a 2 frases do que comprova em licitações",
  "documentMatchesRow": true,
  "validationFeedback": "Frase confirmando a validade e compatibilidade do documento",
  "extractedCompanyData": {
    "razonSocial": "",
    "cnpj": "",
    "address": "",
    "phone": "",
    "email": "",
    "representativeName": "",
    "representativeCpf": ""
  }
}`,
      });

      const rawText = await runServerLLMCall({
        aiConfig: serverAi,
        contents: parts,
        jsonMode: true,
      });

      const parsed = cleanAndParseJsonServer(rawText);
      return res.json({ result: parsed });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Erro ao analisar certidão na IA." });
    }
  });

  // 5. /api/generate-cert-description
  app.post("/api/generate-cert-description", async (req, res) => {
    const serverAi = resolveServerAiConfig(req.body?.aiConfig);
    if (!serverAi) {
      return forwardToSupabaseEdge(req, res);
    }

    try {
      const name = String(req.body?.name || "Certidão").trim();
      const reply = await runServerLLMCall({
        aiConfig: serverAi,
        contents: [
          {
            text: `Explique em 1 frase curta (máximo 140 caracteres), direta e técnica para que serve o documento/certidão "${name}" em licitações públicas no Brasil.`,
          },
        ],
      });
      return res.json({ description: reply.trim() });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Erro ao gerar descrição da certidão." });
    }
  });

  // 6. /api/generate-document
  app.post("/api/generate-document", async (req, res) => {
    const serverAi = resolveServerAiConfig(req.body?.aiConfig);
    if (!serverAi) {
      return forwardToSupabaseEdge(req, res);
    }

    try {
      const { docType, analysisData, companyData, extraInstructions, uploadedTemplateText, proposalDetails } =
        req.body || {};
      let prompt = "";
      if (docType === "proposal") {
        const details = proposalDetails || {};
        const items = details.proposalItems || [];
        const itemsListText = items
          .map(
            (it: any, idx: number) =>
              `| ${idx + 1} | ${it.description} | ${it.quantity} | ${it.brandModel} | R$ ${it.unitValue} | R$ ${it.totalValue} |`
          )
          .join("\n");
        prompt = `Gere uma PROPOSTA COMERCIAL formal para licitação pública em Markdown profissional, cabendo em 1 folha A4:
- Empresa: ${companyData?.razonSocial || "[RAZÃO SOCIAL DA EMPRESA]"} | CNPJ: ${companyData?.cnpj || "[CNPJ DA EMPRESA]"}
- Endereço: ${companyData?.address || "[ENDEREÇO]"} | Tel: ${companyData?.phone || "[TELEFONE]"} | E-mail: ${companyData?.email || "[E-MAIL]"}
- Representante Legal: ${companyData?.representativeName || "[REPRESENTANTE LEGAL]"} | CPF: ${companyData?.representativeCpf || "[CPF]"}
- Dados Bancários: ${companyData?.bankDetails || "[DADOS BANCÁRIOS]"}
- Certame: ${details.proposalDispensa || ""} | Processo: ${details.proposalProcesso || ""} | Órgão: ${details.proposalOrgao || ""}
- Objeto: ${details.proposalObject || analysisData?.descricaoProduto || ""}
- Itens:\n${itemsListText}
- Valor Total Global: R$ ${details.totalValueGlobal || "0,00"} (${details.totalValueExtenso || ""})
- Validade: ${details.valPrazo || "60 dias"} | Pagamento: ${details.valPgto || "30 dias"} | Entrega: ${details.valEntrega || "Conforme edital"} | Local: ${details.valLocal || "Conforme edital"}
- Instruções adicionais: ${extraInstructions || "Nenhuma"}
Finalize com o bloco de assinatura centralizado de 3 linhas (Linha, Nome em negrito, Representante Legal / Titular, CPF | CNPJ). Retorne apenas o Markdown do documento.`;
      } else {
        prompt = `Redija o documento licitatório "${
          docType === "joint_declaration"
            ? "DECLARAÇÃO CONJUNTA DE HABILITAÇÃO (LEI 14.133/2021)"
            : uploadedTemplateText || "DECLARAÇÃO DE REGULARIDADE"
        }" em Markdown formal para 1 página A4.
Empresa: ${companyData?.razonSocial || "[RAZÃO SOCIAL DA EMPRESA]"}, CNPJ ${companyData?.cnpj || "[CNPJ DA EMPRESA]"}, Representante ${companyData?.representativeName || "[REPRESENTANTE LEGAL]"}, CPF ${companyData?.representativeCpf || "[CPF]"}.
Instruções extras: ${extraInstructions || "Nenhuma"}.
Finalize com assinatura formal de 3 linhas. Retorne apenas o documento em Markdown.`;
      }

      const markdown = await runServerLLMCall({
        aiConfig: serverAi,
        contents: [{ text: prompt }],
      });

      return res.json({
        markdown: markdown.replace(/^```markdown\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim(),
        title: docType === "proposal" ? proposalDetails?.proposalFileTitle || "Proposta Comercial.md" : undefined,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Erro ao gerar documento na IA." });
    }
  });

  // 7. /api/compare-products
  app.post("/api/compare-products", async (req, res) => {
    const serverAi = resolveServerAiConfig(req.body?.aiConfig);
    if (!serverAi) {
      return forwardToSupabaseEdge(req, res);
    }

    try {
      const { requiredSpecs, candidateProducts } = req.body || {};
      const list = Array.isArray(candidateProducts) ? candidateProducts : [];
      const results = await Promise.all(
        list.map(async (productModel: string) => {
          const prompt = `Compare rigorosamente o produto candidato "${productModel}" com as especificações exigidas no edital:
"${requiredSpecs}"
Retorne EXCLUSIVAMENTE um JSON válido no formato:
{
  "productName": "${productModel}",
  "matchStatus": "ATENDE" | "ATENDE_PARCIALMENTE" | "NAO_ATENDE",
  "suitabilityScore": 85,
  "specsAnalysis": [
    { "requirement": "...", "foundSpecText": "...", "status": "ATENDE" | "DIVERGENTE" | "NAO_ENCONTRADO", "comment": "..." }
  ],
  "pros": ["..."],
  "cons": ["..."],
  "conclusion": "..."
}`;
          const raw = await runServerLLMCall({
            aiConfig: serverAi,
            contents: [{ text: prompt }],
            jsonMode: true,
          });
          return {
            originalName: productModel,
            success: true,
            data: cleanAndParseJsonServer(raw),
            sources: [],
          };
        })
      );
      return res.json({ results });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Erro ao comparar produtos na IA." });
    }
  });

  // 8. /api/analyze-competitor
  app.post("/api/analyze-competitor", async (req, res) => {
    const serverAi = resolveServerAiConfig(req.body?.aiConfig);
    if (!serverAi) {
      return forwardToSupabaseEdge(req, res);
    }

    try {
      const { competitorName, competitorDocumentText, fileBase64, fileType, files, editalText, focusItems } =
        req.body || {};
      const rawFiles = [
        ...(Array.isArray(files) ? files : []),
        ...(fileBase64 ? [{ base64: fileBase64, type: fileType }] : []),
      ];
      const parts: any[] = [];
      for (const f of rawFiles) {
        const p = fileAttachmentToPart(f);
        if (p) parts.push(p);
      }
      parts.push({
        text: `Você é um Advogado Especialista em Licitações Públicas (Lei 14.133/2021). Audite a proposta/documentação do concorrente "${competitorName || "Concorrente"}" contra o Edital (${editalText || "regras gerais da Lei 14.133/2021"}). Foco: ${focusItems || "Análise Completa"}.
${competitorDocumentText ? `\nTexto do Concorrente:\n${competitorDocumentText}` : ""}
Retorne EXCLUSIVAMENTE um JSON válido com:
{
  "competitorName": "...",
  "isCompliant": false,
  "irregularidadesEncontradas": [
    { "campoExigido": "...", "propostaConcorrente": "...", "gravidade": "ALTA | MÉDIA | BAIXA", "baseLegal": "...", "impacto": "..." }
  ],
  "pontosFortesConcorrente": ["..."],
  "modeloRecurso": "Peça completa de Recurso Administrativo em Markdown...",
  "analiseEstiloMarkdown": "Relatório completo da auditoria em Markdown..."
}`,
      });

      const raw = await runServerLLMCall({
        aiConfig: serverAi,
        contents: parts,
        jsonMode: true,
      });
      return res.json({ analysis: cleanAndParseJsonServer(raw) });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Erro ao analisar concorrente na IA." });
    }
  });

  // 9. /api/analyze-edital
  app.post("/api/analyze-edital", async (req, res) => {
    const serverAi = resolveServerAiConfig(req.body?.aiConfig);
    if (!serverAi) {
      return forwardToSupabaseEdge(req, res);
    }

    try {
      const { textInput, fileBase64, fileName, fileType, attachments, attachedFiles, files, selectedItems } =
        req.body || {};
      const allFiles = [
        ...(Array.isArray(attachments) ? attachments : []),
        ...(Array.isArray(attachedFiles) ? attachedFiles : []),
        ...(Array.isArray(files) ? files : []),
        ...(fileBase64 ? [{ base64: fileBase64, name: fileName, type: fileType }] : []),
      ];

      const parts: any[] = [];
      for (const f of allFiles) {
        const p = fileAttachmentToPart(f);
        if (p) parts.push(p);
      }

      parts.push({
        text: buildEditalAnalysisPrompt(String(textInput || ""), selectedItems),
      });

      const rawJson = await runServerLLMCall({
        aiConfig: serverAi,
        contents: parts,
        jsonMode: true,
      });

      const parsed = cleanAndParseJsonServer(rawJson);
      const normalized = normalizeEditalAnalysisObject(parsed, String(textInput || ""));
      return res.json({ analysis: normalized });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Erro ao analisar o edital na IA." });
    }
  });

  // 10. Forward any remaining /api/* routes (e.g., /api/pncp/*, /api/user-config, /api/robos/*) to Supabase Edge Function
  app.all("/api/*splat", (req, res) => {
    return forwardToSupabaseEdge(req, res);
  });

  // Vite middleware for development or static serving for production
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
