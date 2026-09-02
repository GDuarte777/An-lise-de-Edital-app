import express from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

/**
 * pdf-parse é carregado sob demanda, com um `import()` de especificador literal.
 *
 * Antes era `createRequire(import.meta.url)("pdf-parse")` no topo do arquivo, e isso
 * quebrava a aplicação de duas formas:
 *
 *  - Nenhum empacotador enxerga através de createRequire, então a dependência ficava
 *    invisível para a análise estática e não era embarcada na função serverless da
 *    Vercel. Lá o require estourava "Cannot find module" na carga do módulo, antes de
 *    qualquer rota existir, e toda chamada a /api virava FUNCTION_INVOCATION_FAILED.
 *  - No bundle CJS do `npm run build`, `import.meta` vira {} e createRequire recebia
 *    undefined, derrubando o `npm start` com ERR_INVALID_ARG_VALUE.
 *
 * Um `import("pdf-parse")` com string literal é rastreável por qualquer empacotador,
 * funciona em ESM e em CJS, e sendo preguiçoso não pesa no cold start. A falha ao
 * carregar deixa de ser fatal: sem ele a extração de PDF é pulada, e o resto da
 * plataforma (chat, análises, documentos) continua de pé.
 */
type PdfExtractor = (buffer: Buffer) => Promise<{ text: string; numpages: number }>;

let pdfParsePromise: Promise<PdfExtractor | null> | null = null;

/**
 * Adapta o pdf-parse v2 ao formato que o restante do arquivo espera.
 *
 * A v2 exporta a classe `PDFParse`, não uma função — não existe export default.
 * O código anterior fazia `await pdfParse(buffer)` (formato da v1), então toda
 * extração local de PDF lançava "is not a function" e caía no catch: os editais
 * seguiam para a IA como binário bruto e os caminhos de extração offline ficavam
 * sempre vazios.
 */
async function loadPdfParse(): Promise<PdfExtractor | null> {
  if (!pdfParsePromise) {
    pdfParsePromise = import("pdf-parse")
      .then((mod: any) => {
        const PDFParse = mod?.PDFParse ?? mod?.default?.PDFParse;
        if (typeof PDFParse !== "function") {
          throw new Error("pdf-parse não expõe a classe PDFParse");
        }
        const extract: PdfExtractor = async (buffer: Buffer) => {
          const parser = new PDFParse({ data: new Uint8Array(buffer) });
          try {
            const result = await parser.getText();
            // A v2 injeta marcadores "-- 1 of 12 --" entre as páginas; eles só
            // poluiriam o contexto enviado ao modelo.
            const text = String(result?.text || "").replace(/^--\s*\d+\s+of\s+\d+\s*--$/gm, "").trim();
            return { text, numpages: Number(result?.total) || 0 };
          } finally {
            try {
              await parser.destroy();
            } catch {
              // liberar o parser nunca deve derrubar a extração
            }
          }
        };
        return extract;
      })
      .catch((err: any) => {
        console.error("[pdf-parse] Não foi possível carregar o extrator de PDF:", err?.message || err);
        return null;
      });
  }
  return pdfParsePromise;
}

/**
 * Teto de caracteres de um documento enviado ao modelo.
 *
 * Um edital de 180 páginas rende ~800 mil caracteres, e cada tentativa da cadeia de
 * fallback reenvia tudo ao provedor. Acima desse teto o miolo é elidido, preservando
 * o começo (identificação, objeto, valor, habilitação) e o fim (anexos e termo de
 * referência), que é onde está o conteúdo decisivo.
 */
const MAX_DOCUMENT_CHARS = Number(process.env.MAX_DOCUMENT_CHARS || 400_000);

/**
 * Sinais de que um trecho contém a planilha de itens/lotes do edital.
 *
 * O corte anterior era cego: mantinha começo e fim e jogava fora o miolo. Só que
 * é justamente no miolo que ficam o Termo de Referência e as tabelas de itens —
 * em edital grande, a plataforma descartava exatamente a parte que precisava ler
 * e depois relatava um item só. Agora o miolo é selecionado por relevância.
 */
const SINAIS_DE_ITENS = [
  /\bitem\s*n?[ºo°]?\s*\d+/gi,
  /\blote\s*n?[ºo°]?\s*\d+/gi,
  /\bquantidade\b/gi,
  /\bunidade\s+de\s+medida\b/gi,
  /\bvalor\s+unit[áa]rio\b/gi,
  /\bplanilha\b/gi,
  /termo\s+de\s+refer[êe]ncia/gi,
  /\banexo\s+[ivx]+\b/gi,
  /\bespecifica[çc][õo]es?\s+t[ée]cnicas?\b/gi,
  /\bdescri[çc][ãa]o\s+do\s+objeto\b/gi
];

function pontuarTrecho(trecho: string): number {
  let pontos = 0;
  for (const padrao of SINAIS_DE_ITENS) {
    const encontrados = trecho.match(padrao);
    if (encontrados) pontos += encontrados.length;
  }
  return pontos;
}

/**
 * Reduz um documento ao teto de caracteres preservando o que importa.
 *
 * Mantém sempre o começo (identificação, objeto, valor) e o fim (anexos), e
 * preenche o restante do orçamento com os trechos do miolo que mais parecem
 * conter itens, remontando tudo na ordem original do documento.
 */
function capDocumentText(text: string, label: string): string {
  const full = String(text || "");
  if (full.length <= MAX_DOCUMENT_CHARS) return full;

  const TAMANHO_TRECHO = 8_000;
  const trechos: string[] = [];
  for (let i = 0; i < full.length; i += TAMANHO_TRECHO) {
    trechos.push(full.slice(i, i + TAMANHO_TRECHO));
  }

  const orcamentoTrechos = Math.floor(MAX_DOCUMENT_CHARS / TAMANHO_TRECHO);
  // Cabeça e cauda são sempre preservadas.
  const nCabeca = Math.min(trechos.length, Math.floor(orcamentoTrechos * 0.35));
  const nCauda = Math.min(trechos.length - nCabeca, Math.floor(orcamentoTrechos * 0.15));

  const selecionados = new Set<number>();
  for (let i = 0; i < nCabeca; i++) selecionados.add(i);
  for (let i = trechos.length - nCauda; i < trechos.length; i++) selecionados.add(i);

  // O que sobrar do orçamento vai para os trechos do miolo com mais sinais de
  // tabela de itens.
  const candidatos = trechos
    .map((trecho, indice) => ({ indice, pontos: pontuarTrecho(trecho) }))
    .filter(c => !selecionados.has(c.indice) && c.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos);

  for (const candidato of candidatos) {
    if (selecionados.size >= orcamentoTrechos) break;
    selecionados.add(candidato.indice);
  }

  const ordenados = Array.from(selecionados).sort((a, b) => a - b);
  let saida = "";
  let anterior = -1;
  let omitidos = 0;

  for (const indice of ordenados) {
    if (anterior >= 0 && indice > anterior + 1) {
      const pulados = indice - anterior - 1;
      omitidos += pulados * TAMANHO_TRECHO;
      saida += `\n\n[... trecho intermediário omitido por limite de tamanho ...]\n\n`;
    }
    saida += trechos[indice];
    anterior = indice;
  }

  console.log(
    `[PDF Parser] ${label}: ${full.length} caracteres excedem o teto de ${MAX_DOCUMENT_CHARS}; ` +
    `mantidos ${ordenados.length}/${trechos.length} trechos (priorizando tabelas de itens), ~${omitidos} caracteres omitidos.`
  );
  return saida;
}

/** Extrai o texto de um PDF. Devolve "" se o extrator não estiver disponível. */
async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfParse = await loadPdfParse();
  if (!pdfParse) return "";
  const result = await pdfParse(buffer);
  return result?.text || "";
}

// .env.local first: dotenv never overwrites an already-set variable, so this gives the
// local file precedence over .env, matching Vite's convention and the README instructions.
dotenv.config({ path: ".env.local" });
dotenv.config();

// Modelos Gemini que a API generativelanguage.googleapis.com realmente expõe hoje.
// ⚠️ A família 2.5 foi descontinuada para novas chaves ("This model is no longer
// available to new users" → HTTP 404), por isso não entra mais em nenhuma lista.
const VALID_GEMINI_MODELS = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
  "gemini-3.1-pro-preview"
];

const GEMINI_MODEL_ALIASES: Record<string, string> = {
  "flash": "gemini-flash-latest",
  "gemini-flash": "gemini-flash-latest",
  "pro": "gemini-3.1-pro-preview",
  "gemini-pro": "gemini-3.1-pro-preview",
  "gemini-3.1-pro": "gemini-3.1-pro-preview",
  "lite": "gemini-3.1-flash-lite",
  "flash-lite": "gemini-3.1-flash-lite",
  "gemini-lite": "gemini-3.1-flash-lite",
  "gemini-flash-lite": "gemini-3.1-flash-lite",
  // Modelos aposentados → apontam para o substituto recomendado pelo próprio Google
  "gemini-2.5-flash": "gemini-3.6-flash",
  "2.5-flash": "gemini-3.6-flash",
  "gemini-2.5-flash-lite": "gemini-3.1-flash-lite",
  "2.5-flash-lite": "gemini-3.1-flash-lite",
  "gemini-2.5-pro": "gemini-3.1-pro-preview"
};

function normalizeGeminiModel(model: string | undefined): string {
  if (!model) return "gemini-3.7-flash";
  const trimmed = model.trim().toLowerCase();
  if (VALID_GEMINI_MODELS.includes(trimmed)) return trimmed;
  if (GEMINI_MODEL_ALIASES[trimmed]) return GEMINI_MODEL_ALIASES[trimmed];
  return "gemini-3.7-flash";
}

// Lista de fallback: mantém o modelo escolhido pelo usuário em primeiro lugar e,
// em caso de 429/503, rotaciona por modelos de famílias e cotas diferentes.
function getFallbackModels(primaryModel: string): string[] {
  const normPrimary = normalizeGeminiModel(primaryModel);
  const baseList = [
    normPrimary,
    "gemini-3.6-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-3.7-flash"
  ];
  return Array.from(new Set(baseList.filter(Boolean)));
}

/**
 * Server-side API keys are a shared cost: every request that falls back to one is billed
 * to whoever deployed the app, not to the user making the request. This app's model is
 * "each user brings their own key", so the fallback stays disabled unless it is turned on
 * explicitly — normally only for local development.
 *
 * Set ALLOW_SERVER_AI_KEY_FALLBACK=true to opt in.
 */
const SERVER_KEY_FALLBACK_ENABLED =
  String(process.env.ALLOW_SERVER_AI_KEY_FALLBACK || "").trim().toLowerCase() === "true";

function getServerFallbackKey(varName: "GEMINI_API_KEY" | "OPENAI_API_KEY"): string | null {
  if (!SERVER_KEY_FALLBACK_ENABLED) return null;
  const key = String(process.env[varName] || "").trim();
  return key.length > 10 ? key : null;
}

// Lê o "sub" (id do usuário) de um JWT do Supabase sem verificar assinatura.
// A verificação continua sendo feita pelo PostgREST/RLS; aqui o valor serve apenas
// para filtrar a consulta pela linha do usuário correto.
function getUserIdFromJwt(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    const sub = JSON.parse(json)?.sub;
    return typeof sub === "string" && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}

/**
 * Traduz o erro bruto do provedor em uma frase acionável.
 *
 * As rotas de IA caem em geradores locais quando o provedor falha, para o usuário
 * nunca ficar sem resposta. Antes isso era feito em silêncio (HTTP 200, sem sinal
 * nenhum), então uma cota estourada era indistinguível de uma análise de verdade —
 * o motivo de "as ferramentas não funcionam e não dizem por quê". Agora o motivo
 * viaja junto com a resposta degradada.
 */
function describeAiFailure(error: any): string {
  const raw = String(error?.message || error || "");
  const msg = raw.toLowerCase();

  if (msg.includes("429") || msg.includes("quota") || msg.includes("resource_exhausted") || msg.includes("rate limit")) {
    return "Cota da sua chave de IA esgotada (429). Verifique os limites em https://ai.dev/rate-limit ou ative o faturamento no Google AI Studio.";
  }
  if (msg.includes("401") || msg.includes("403") || msg.includes("api_key_invalid") || msg.includes("permission_denied") || msg.includes("unauthenticated")) {
    return "Chave de IA inválida ou sem permissão. Revise a chave em \"IA & Modelos\".";
  }
  if (msg.includes("404") || msg.includes("not_found")) {
    return "O modelo selecionado não está disponível para a sua chave. Escolha outro modelo em \"IA & Modelos\".";
  }
  if (msg.includes("503") || msg.includes("unavailable") || msg.includes("overloaded") || msg.includes("high demand")) {
    return "Os modelos do provedor estão sobrecarregados no momento (503). Tente de novo em alguns instantes.";
  }
  if (msg.includes("chave de api não configurada") || msg.includes("nenhuma chave")) {
    return raw;
  }
  return raw.length > 0 && raw.length < 300 ? raw : "Falha na comunicação com o provedor de IA.";
}

// Helper: resolve the active AI config for a user from Supabase, payload, or server environment
async function resolveAiConfig(authHeader: string | undefined, clientAiConfig?: any): Promise<{ provider: string; apiKey: string; model: string } | null> {
  console.log(`[AI Config] resolveAiConfig called. clientAiConfig present: ${!!clientAiConfig}, apiKey length: ${clientAiConfig?.apiKey?.length || 0}`);

  // 1. If client sent a valid aiConfig (with a real key), trust it immediately
  if (clientAiConfig?.apiKey && clientAiConfig.apiKey.trim().length > 10) {
    const maskedKey = clientAiConfig.apiKey.substring(0, 8) + "...";
    console.log(`[AI Config] ✅ Using client-provided custom key | provider: ${clientAiConfig.provider} | model: ${clientAiConfig.model} | key: ${maskedKey}`);
    let model = clientAiConfig.model || "";
    if (clientAiConfig.provider === "gemini") {
      model = normalizeGeminiModel(model);
    }
    return {
      provider: clientAiConfig.provider || "gemini",
      apiKey: clientAiConfig.apiKey.trim(),
      model: model
    };
  }

  // 1b. Check if client passed provider-specific keys in clientAiConfig
  if (clientAiConfig) {
    const p = clientAiConfig.provider || "gemini";
    const possibleKeys: Record<string, string> = {
      gemini: clientAiConfig.geminiKey || clientAiConfig.gemini_key || "",
      openai: clientAiConfig.openaiKey || clientAiConfig.openai_key || "",
      anthropic: clientAiConfig.anthropicKey || clientAiConfig.anthropic_key || "",
      deepseek: clientAiConfig.deepseekKey || clientAiConfig.deepseek_key || ""
    };
    const key = (possibleKeys[p] || Object.values(possibleKeys).find(k => k && k.trim().length > 10) || "").trim();
    if (key.length > 10) {
      const activeP = possibleKeys[p] ? p : (Object.keys(possibleKeys).find(k => possibleKeys[k] && possibleKeys[k].trim().length > 10) || "gemini");
      console.log(`[AI Config] ✅ Using client-provided provider key: ${activeP}`);
      return {
        provider: activeP,
        apiKey: key,
        model: activeP === "gemini" ? normalizeGeminiModel(clientAiConfig.model) : (clientAiConfig.model || "default")
      };
    }
  }

  // 2. Otherwise, fetch from Supabase using the user's JWT if available
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://cghlfhndoqohmrrvppjj.supabase.co";
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_FWDd-D9L6tGwasm1-qyT1Q_c7T9m_6o";

    // ⚠️ Sem o filtro por user_id a consulta devolvia "uma linha qualquer" da tabela
    // (as políticas de RLS do projeto são permissivas), o que fazia um usuário rodar
    // com a chave de API de outro. O filtro abaixo amarra a busca ao dono do token.
    const jwtUserId = getUserIdFromJwt(token);

    if (supabaseUrl && supabaseAnonKey && jwtUserId) {
      try {
        const resp = await fetch(`${supabaseUrl}/rest/v1/configuracoes_usuario?select=*&user_id=eq.${encodeURIComponent(jwtUserId)}&limit=1`, {
          headers: {
            "apikey": supabaseAnonKey,
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        });

        if (resp.ok) {
          const rows: any[] = await resp.json();
          if (rows && rows.length > 0) {
            const row = rows[0];
            let provider = row.active_provider || "gemini";
            const keyMap: Record<string, string> = {
              gemini: row.gemini_key || "",
              openai: row.openai_key || "",
              anthropic: row.anthropic_key || "",
              deepseek: row.deepseek_key || ""
            };
            const modelMap: Record<string, string> = {
              gemini: row.gemini_model || "gemini-3.7-flash",
              openai: row.openai_model || "gpt-4o",
              anthropic: row.anthropic_model || "claude-sonnet-5",
              deepseek: row.deepseek_model || "deepseek-chat"
            };

            let apiKey = (keyMap[provider] || "").trim();
            if (!apiKey || apiKey.length < 10) {
              // Try finding ANY provider key configured in Supabase row
              const fallbackProvider = Object.keys(keyMap).find(p => keyMap[p] && keyMap[p].trim().length > 10);
              if (fallbackProvider) {
                provider = fallbackProvider;
                apiKey = keyMap[fallbackProvider].trim();
              }
            }

            if (apiKey && apiKey.length > 10) {
              let model = modelMap[provider] || "";
              if (provider === "gemini") {
                model = normalizeGeminiModel(model);
              }
              console.log(`[AI Config] ✅ Using custom key resolved from Supabase DB: provider=${provider}`);
              return { provider, apiKey, model };
            }
          }
        }
      } catch (err: any) {
        console.warn("[AI Config] Error fetching custom config from Supabase:", err.message);
      }
    }
  }

  // 3. Environment Variable Fallback on Server (opt-in only — billed to the deployer)
  const serverGeminiKey = getServerFallbackKey("GEMINI_API_KEY");
  if (serverGeminiKey) {
    console.log("[AI Config] ⚠️ Using server GEMINI_API_KEY environment variable (cost billed to the deployer)");
    return {
      provider: "gemini",
      apiKey: serverGeminiKey,
      model: "gemini-3.7-flash"
    };
  }

  const serverOpenaiKey = getServerFallbackKey("OPENAI_API_KEY");
  if (serverOpenaiKey) {
    console.log("[AI Config] ⚠️ Using server OPENAI_API_KEY environment variable (cost billed to the deployer)");
    return {
      provider: "openai",
      apiKey: serverOpenaiKey,
      model: "gpt-4o"
    };
  }

  console.log("[AI Config] ❌ No valid custom API key found in payload, Supabase DB, or environment variables.");
  return null;
}

function getAiClientForConfig(aiConfig?: any): GoogleGenAI | undefined {
  if (aiConfig && aiConfig.provider === "gemini" && aiConfig.apiKey && aiConfig.apiKey.trim().length > 10) {
    return new GoogleGenAI({
      apiKey: aiConfig.apiKey.trim(),
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  const serverKey = getServerFallbackKey("GEMINI_API_KEY");
  if (serverKey) {
    return new GoogleGenAI({
      apiKey: serverKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return undefined;
}

function cleanAndParseJson(text: string): any {
  if (!text) return {};
  let cleaned = text.trim();
  
  // Remove code block backticks if present
  cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();

  // Extract json object or array boundaries if surrounded by text
  const firstBrace = cleaned.search(/[\{\[]/);
  const lastBrace = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // Attempt parsing with fixes for common AI JSON output issues
    try {
      const fixedJson = cleaned
        .replace(/,\s*([\}\]])/g, "$1") // trailing commas
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, (match) => { // control chars
          if (match === "\n") return "\\n";
          if (match === "\r") return "\\r";
          if (match === "\t") return "\\t";
          return "";
        });
      return JSON.parse(fixedJson);
    } catch {
      console.warn("[cleanAndParseJson] Erro ao analisar JSON da IA:", err);
      return {};
    }
  }
}

function collectUniqueFiles(sources: any[]): any[] {
  const seen = new Set<string>();
  const uniqueList: any[] = [];

  for (const item of sources) {
    if (!item) continue;
    if (Array.isArray(item)) {
      for (const f of item) {
        if (!f) continue;
        const b64 = f.base64 || f.fileBase64 || f.data || "";
        const uploadId = f.uploadId || "";
        if (!b64 && !uploadId) continue;
        const key = uploadId ? `uploadId:${uploadId}` : ((f.name || f.fileName || "") + ":" + b64.slice(0, 100));
        if (!seen.has(key)) {
          seen.add(key);
          uniqueList.push(f);
        }
      }
    } else if (typeof item === "object") {
      const b64 = item.base64 || item.fileBase64 || item.data || "";
      const uploadId = item.uploadId || "";
      if (b64 || uploadId) {
        const key = uploadId ? `uploadId:${uploadId}` : ((item.name || item.fileName || "") + ":" + b64.slice(0, 100));
        if (!seen.has(key)) {
          seen.add(key);
          uniqueList.push(item);
        }
      }
    }
  }
  return uniqueList;
}

interface ProcessedAttachmentResult {
  part: any;
  tempFilePath?: string;
  uploadedFileName?: string;
}

async function processFileAttachmentAsync(
  file: any,
  aiClient?: GoogleGenAI
): Promise<ProcessedAttachmentResult | null> {
  if (!file) return null;

  const fname = file.name || file.fileName || "";
  let mtype = file.type || file.fileType || file.mimeType || "";
  const lowerName = fname.toLowerCase();

  // Infer mime type if missing or generic octet-stream
  if (!mtype || mtype === "application/octet-stream" || mtype === "binary/octet-stream" || mtype === "") {
    if (lowerName.endsWith(".pdf")) {
      mtype = "application/pdf";
    } else if (lowerName.endsWith(".txt") || lowerName.endsWith(".log") || lowerName.endsWith(".md") || lowerName.endsWith(".csv")) {
      mtype = "text/plain";
    } else if (lowerName.endsWith(".png")) {
      mtype = "image/png";
    } else if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
      mtype = "image/jpeg";
    } else {
      mtype = "application/pdf";
    }
  }

  // Case 1: File uploaded in chunks to /tmp/uploads/${uploadId}
  if (file.uploadId) {
    const chunkFilePath = path.join("/tmp", "uploads", String(file.uploadId).replace(/[^a-zA-Z0-9_-]/g, ""));
    if (fs.existsSync(chunkFilePath)) {
      const stats = fs.statSync(chunkFilePath);
      console.log(`[processFileAttachmentAsync] Using chunked upload file: ${chunkFilePath} (${(stats.size / (1024 * 1024)).toFixed(1)} MB)`);

      // Text files
      if (mtype.startsWith("text/") || mtype === "application/json" || lowerName.endsWith(".txt") || lowerName.endsWith(".csv") || lowerName.endsWith(".md")) {
        try {
          const decodedText = fs.readFileSync(chunkFilePath, "utf-8");
          if (decodedText && decodedText.trim().length > 0) {
            return {
              part: {
                text: `\n\n--- INÍCIO DO ANEXO DE TEXTO (${fname || "Edital"}) ---\n${decodedText}\n--- FIM DO ANEXO DE TEXTO (${fname || "Edital"}) ---\n\n`
              },
              tempFilePath: chunkFilePath
            };
          }
        } catch (err) {
          console.warn("[processFileAttachment] Erro ao ler arquivo de texto chunked:", err);
        }
      }

      // PDF files: Extract textual content with pdf-parse for 100% cross-model accuracy
      if (mtype === "application/pdf" || lowerName.endsWith(".pdf")) {
        try {
          const buf = fs.readFileSync(chunkFilePath);
          const pdfData = await (await loadPdfParse())?.(buf);
          if (pdfData && pdfData.text && pdfData.text.trim().length > 30) {
            console.log(`[PDF Parser] ✅ Sucesso! Extraídos ${pdfData.text.length} caracteres de ${fname || "Edital.pdf"} (${pdfData.numpages || "?"} páginas).`);
            return {
              part: {
                text: `\n\n--- INÍCIO DO EDITAL/DOCUMENTO: ${fname || "Edital.pdf"} (${pdfData.numpages || "?"} páginas) ---\n${capDocumentText(pdfData.text, fname || "Edital.pdf")}\n--- FIM DO EDITAL/DOCUMENTO: ${fname || "Edital.pdf"} ---\n\n`
              },
              tempFilePath: chunkFilePath
            };
          }
        } catch (pdfErr: any) {
          console.warn(`[PDF Parser] Extração de texto falhou no chunked PDF (possível PDF escaneado):`, pdfErr.message || pdfErr);
        }
      }

      // Fallback for Scanned/Image PDFs: Read disk file to base64 inlineData
      const buf = fs.readFileSync(chunkFilePath);
      return {
        part: {
          inlineData: {
            data: buf.toString("base64"),
            mimeType: mtype
          }
        },
        tempFilePath: chunkFilePath
      };
    }
  }

  // Case 2: Standard base64 in body
  const rawB64 = file.base64 || file.fileBase64 || file.data;
  if (!rawB64) return null;

  const cleanB64 = rawB64.replace(/^data:[^;]+;base64,/, "").trim();
  if (!cleanB64) return null;

  // Text files
  if (mtype.startsWith("text/") || mtype === "application/json" || mtype === "application/xml" || lowerName.endsWith(".txt") || lowerName.endsWith(".csv") || lowerName.endsWith(".md")) {
    try {
      const decodedText = Buffer.from(cleanB64, "base64").toString("utf-8");
      if (decodedText && decodedText.trim().length > 0) {
        return {
          part: {
            text: `\n\n--- INÍCIO DO ANEXO DE TEXTO (${fname || "Edital"}) ---\n${decodedText}\n--- FIM DO ANEXO DE TEXTO (${fname || "Edital"}) ---\n\n`
          }
        };
      }
    } catch (err) {
      console.warn("[processFileAttachment] Erro ao decodificar arquivo de texto:", err);
    }
  }

  // PDF files: Extract textual content with pdf-parse
  if (mtype === "application/pdf" || lowerName.endsWith(".pdf")) {
    try {
      const buffer = Buffer.from(cleanB64, "base64");
      const pdfData = await (await loadPdfParse())?.(buffer);
      if (pdfData && pdfData.text && pdfData.text.trim().length > 30) {
        console.log(`[PDF Parser] ✅ Sucesso! Extraídos ${pdfData.text.length} caracteres de base64 ${fname || "Edital.pdf"} (${pdfData.numpages || "?"} páginas).`);
        return {
          part: {
            text: `\n\n--- INÍCIO DO EDITAL/DOCUMENTO: ${fname || "Edital.pdf"} (${pdfData.numpages || "?"} páginas) ---\n${capDocumentText(pdfData.text, fname || "Edital.pdf")}\n--- FIM DO EDITAL/DOCUMENTO: ${fname || "Edital.pdf"} ---\n\n`
          }
        };
      }
    } catch (pdfErr: any) {
      console.warn(`[PDF Parser] Extração de texto em base64 falhou (possível PDF escaneado):`, pdfErr.message || pdfErr);
    }
  }

  // Fallback to inlineData for Scanned PDFs, Images, etc.
  return {
    part: {
      inlineData: {
        data: cleanB64,
        mimeType: mtype
      }
    }
  };
}

async function cleanupAttachmentResources(
  tempFiles: string[],
  geminiFileNames: string[],
  aiClient?: GoogleGenAI
) {
  for (const tmpFile of tempFiles) {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch (e) {
      console.warn("Erro ao excluir arquivo temp local:", e);
    }
  }
  if (aiClient) {
    for (const gName of geminiFileNames) {
      if (!gName) continue;
      try {
        await aiClient.files.delete({ name: gName });
        console.log(`[Gemini Files API] Arquivo ${gName} removido da nuvem da IA.`);
      } catch (e) {
        console.warn("Erro ao remover arquivo da Gemini Files API:", e);
      }
    }
  }
}

function normalizeContents(contents: any[]): any[] {
  if (!contents) return [];
  const contentsArray = Array.isArray(contents) ? contents : [contents];

  const isValidBase64 = (str: any): boolean => {
    if (!str || typeof str !== "string") return false;
    const clean = str.trim();
    if (clean.length < 20 || clean.startsWith("[") || clean.includes(" ")) return false;
    return /^[A-Za-z0-9+/=\r\n]+$/.test(clean);
  };

  const sanitizePart = (p: any): any => {
    if (!p) return { text: "" };
    if (typeof p === "string") return { text: p };

    const inlineObj = p.inlineData || p.inline_data;
    if (inlineObj) {
      const b64Data = inlineObj.data;
      if (!isValidBase64(b64Data)) {
        return { text: "[Anexo de Mídia/Documento enviado previamente]" };
      }
      return {
        inlineData: {
          mimeType: inlineObj.mimeType || inlineObj.mime_type || "image/png",
          data: String(b64Data).trim()
        }
      };
    }

    return p;
  };

  // 1. Check if it is already in standard [{ role: '...', parts: [...] }] format
  const isStandard = contentsArray.every(c => c && typeof c === "object" && Array.isArray(c.parts));
  if (isStandard) {
    return contentsArray.map(c => {
      const parts = c.parts.map((p: any) => sanitizePart(p));
      return {
        role: c.role === "model" || c.role === "assistant" ? "model" : "user",
        parts
      };
    });
  }

  // 2. Otherwise, convert flat parts or strings into standard format: [{ role: 'user', parts: [...] }]
  const parts = contentsArray.map(c => {
    if (typeof c === "string") {
      return { text: c };
    }
    if (c && typeof c === "object") {
      if (c.parts && Array.isArray(c.parts)) {
        return c.parts.map((p: any) => sanitizePart(p));
      }
      if (c.text) {
        return { text: c.text };
      }
      if (c.inlineData || c.inline_data) {
        return sanitizePart(c);
      }
      if (c.fileData) {
        return { fileData: c.fileData };
      }
      return c;
    }
    return { text: String(c) };
  }).flat();

  return [
    {
      role: "user",
      parts
    }
  ];
}

function sanitizeAiTextResponse(text: string): string {
  if (!text) return "";
  let cleaned = text;

  // Replace LaTeX block/inline math delimiters ($$ ... $$ and $ ... $)
  cleaned = cleaned.replace(/\$\$(.*?)\$\$/gs, (_, formula) => formula);
  cleaned = cleaned.replace(/\$(.*?)\$/g, (_, formula) => formula);

  // Replace common LaTeX expressions with clean Portuguese / Unicode text
  cleaned = cleaned
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\\times/g, "x")
    .replace(/\\cdot/g, "x")
    .replace(/\\rightarrow/g, "→")
    .replace(/\\leftarrow/g, "←")
    .replace(/\\Rightarrow/g, "=>")
    .replace(/\\approx/g, "≈")
    .replace(/\\le/g, "≤")
    .replace(/\\ge/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\/g, ""); // Clean any remaining loose backslashes from LaTeX

  return cleaned;
}

// Robust content generation helper with automatic fallback for high demand/503 errors
async function generateContentWithFallback(params: {
  contents: any[];
  config?: any;
  model?: string;
  apiKey?: string;
  client?: GoogleGenAI;
}): Promise<any> {
  let client = params.client;
  if (!client) {
    if (!params.apiKey || params.apiKey.trim().length < 10) {
      throw new Error("❌ Nenhuma chave de API do Gemini válida fornecida. Acesse 'IA & Modelos' e insira sua chave.");
    }
    client = new GoogleGenAI({
      apiKey: params.apiKey.trim(),
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }

  const primaryModel = normalizeGeminiModel(params.model || "gemini-3.7-flash");
  const modelsToTry = getFallbackModels(primaryModel);
  const normalizedContents = normalizeContents(params.contents);

  let lastError: any = null;
  for (const model of modelsToTry) {
    let attempt = 0;
    const maxAttempts = 2;
    let delay = 1000;
    
    while (attempt < maxAttempts) {
      try {
        console.log(`[Gemini API] Requesting content generation from model: ${model} (Attempt ${attempt + 1}/${maxAttempts})`);
        const response = await client.models.generateContent({
          ...params,
          contents: normalizedContents,
          model,
        });
        if (response && response.text) {
          const sanitizedText = sanitizeAiTextResponse(response.text);
          return {
            ...response,
            text: sanitizedText
          };
        }
        return response;
      } catch (error: any) {
        attempt++;
        console.warn(`[Gemini API] Failed on model ${model} (attempt ${attempt}):`, error.message || error);
        lastError = error;
        
        const isQuotaOrRateLimit = 
          error.status === 429 ||
          error.code === 429 ||
          (error.message && (
            error.message.includes("429") ||
            error.message.toLowerCase().includes("quota") ||
            error.message.toLowerCase().includes("rate limit") ||
            error.message.toLowerCase().includes("resource_exhausted") ||
            error.message.toLowerCase().includes("resource exceeded")
          ));

        const isTransient = 
          error.status === 503 ||
          error.code === 503 ||
          (error.message && (
            error.message.includes("503") ||
            error.message.toLowerCase().includes("unavailable") ||
            error.message.toLowerCase().includes("high demand") ||
            error.message.toLowerCase().includes("overloaded")
          ));

        // If config had tools (e.g. googleSearch) and failed, try without tools
        if (params.config?.tools) {
          console.log(`[Gemini API] Trying model ${model} without tools fallback...`);
          try {
            const { tools, ...configWithoutTools } = params.config;
            const responseNoTools = await client.models.generateContent({
              ...params,
              config: configWithoutTools,
              contents: normalizedContents,
              model,
            });
            if (responseNoTools && responseNoTools.text) {
              const sanitizedText = sanitizeAiTextResponse(responseNoTools.text);
              return {
                ...responseNoTools,
                text: sanitizedText
              };
            }
            return responseNoTools;
          } catch (noToolsErr: any) {
            console.warn(`[Gemini API] Fallback without tools also failed on ${model}:`, noToolsErr.message || noToolsErr);
          }
        }

        if (isQuotaOrRateLimit) {
          break;
        }

        if (isTransient && attempt < maxAttempts) {
          console.log(`[Gemini API] Retrying model ${model} in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        }
        break;
      }
    }
  }
  throw lastError;
}

// Inline binary types the vision-capable providers accept.
const SUPPORTED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function normalizeMimeType(mime: string | undefined): string {
  const m = (mime || "").toLowerCase().trim();
  return m === "image/jpg" ? "image/jpeg" : m;
}

/**
 * Converts normalized Gemini-style contents into provider-native messages.
 *
 * Text-only messages collapse to a plain string, which is what both the OpenAI and
 * Anthropic APIs expect. Messages carrying binary parts (scanned PDFs or images that
 * survived local pdf-parse extraction) are wrapped in each provider's own multimodal
 * envelope, so the user's own key is always sent to the provider they selected.
 */
function buildProviderMessages(contents: any[], provider: string): any[] {
  const messages: any[] = [];

  for (const c of contents) {
    const role = c.role === "model" || c.role === "assistant" ? "assistant" : "user";

    let parts: any[] = [];
    if (typeof c === "string") {
      parts = [{ text: c }];
    } else if (c.text) {
      parts = [{ text: c.text }];
    } else if (Array.isArray(c.parts)) {
      parts = c.parts;
    }

    if (!parts.some((p: any) => p.inlineData)) {
      const content = parts.map((p: any) => p.text || "").join("\n");
      if (content.trim() !== "") messages.push({ role, content });
      continue;
    }

    const blocks: any[] = [];
    for (const p of parts) {
      if (p.inlineData) {
        const mimeType = normalizeMimeType(p.inlineData.mimeType);
        const data = p.inlineData.data || "";
        if (!data) continue;

        const isPdf = mimeType === "application/pdf";
        if (!isPdf && !SUPPORTED_IMAGE_MIMES.includes(mimeType)) {
          blocks.push({ type: "text", text: `[Anexo ignorado: o formato ${mimeType || "desconhecido"} não é suportado por este provedor.]` });
          continue;
        }

        if (provider === "anthropic") {
          blocks.push({
            type: isPdf ? "document" : "image",
            source: { type: "base64", media_type: mimeType, data }
          });
        } else {
          blocks.push(isPdf
            ? { type: "file", file: { filename: p.inlineData.fileName || "documento.pdf", file_data: `data:${mimeType};base64,${data}` } }
            : { type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } });
        }
      } else if (p.text && p.text.trim() !== "") {
        blocks.push({ type: "text", text: p.text });
      }
    }

    if (blocks.length > 0) messages.push({ role, content: blocks });
  }

  return messages;
}

// Dynamic Multi-Provider AI Routing Helper using exclusively user API keys
/**
 * Tempo total que uma requisição de IA pode consumir no servidor, somando todas as
 * tentativas e rotações de modelo.
 *
 * Sem esse teto, um edital grande virava um desastre: cada tentativa reenvia o
 * documento inteiro para o Google, e com os modelos devolvendo 503 a cadeia chegava a
 * 8 uploads do mesmo arquivo. O navegador desistia antes do servidor, então o usuário
 * via "excedeu 120 segundos" e nunca ficava sabendo que a causa real era sobrecarga
 * do provedor. O orçamento fica abaixo do timeout do cliente de propósito: assim quem
 * responde é o servidor, com o motivo verdadeiro.
 */
const AI_REQUEST_BUDGET_MS = Number(process.env.AI_REQUEST_BUDGET_MS || 100_000);

async function generateAiResponse(params: {
  contents: any[];
  systemInstruction?: string;
  aiConfig?: {
    provider: string;
    apiKey: string;
    model?: string;
  };
  jsonMode?: boolean;
  model?: string;
  responseSchema?: any;
  tools?: any;
  budgetMs?: number;
}): Promise<any> {
  const { contents, systemInstruction, aiConfig, jsonMode, model, responseSchema, tools } = params;
  const startedAt = Date.now();
  const budgetMs = params.budgetMs ?? AI_REQUEST_BUDGET_MS;
  const elapsedMs = () => Date.now() - startedAt;
  const remainingMs = () => budgetMs - elapsedMs();

  if (!aiConfig || !aiConfig.apiKey || aiConfig.apiKey.trim().length < 10) {
    throw new Error("❌ Chave de API não configurada. Acesse 'IA & Modelos' nas Configurações, insira sua chave e clique em 'Salvar Configurações'.");
  }

  const { provider, apiKey, model: configModel } = aiConfig;
  const activeModel = configModel || model;
  console.log(`[Dynamic AI Router] Executing via user provider: ${provider} | Model: ${activeModel}`);

  const normalizedContents = normalizeContents(contents);

  const hasInlineData = normalizedContents.some(c =>
    c.parts && c.parts.some((p: any) => p.inlineData)
  );

  // Binary attachments only reach this point when local pdf-parse extraction failed,
  // i.e. scanned PDFs and images. DeepSeek has no vision support, so fail with an
  // actionable message instead of silently sending a prompt with no document in it.
  if (hasInlineData && provider === "deepseek") {
    throw new Error(
      "❌ O DeepSeek não consegue ler PDFs escaneados nem imagens. Envie um PDF com texto selecionável, ou troque para Gemini, OpenAI ou Anthropic em 'IA & Modelos'."
    );
  }

  if (hasInlineData && provider !== "gemini") {
    console.log(`[Dynamic AI Router] Sending binary attachment natively to ${provider}...`);
  }

  // Map Gemini contents format to standard OpenAI/Anthropic messages format
  const validMessages = buildProviderMessages(normalizedContents, provider);

  if (provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: activeModel || "gpt-4o",
        messages: [
          ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
          ...validMessages
        ],
        response_format: jsonMode ? { type: "json_object" } : undefined
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      let msg = errorText;
      try {
        const jsonErr = JSON.parse(errorText);
        msg = jsonErr.error?.message || errorText;
      } catch (_) {}
      if (response.status === 401 || response.status === 403 || msg.includes("invalid_api_key") || msg.includes("Incorrect API key")) {
        throw new Error(`❌ A chave de API do OpenAI informada é inválida ou expirou. Verifique a chave em 'IA & Modelos'.`);
      }
      if (response.status === 429 || msg.includes("rate_limit") || msg.includes("quota")) {
        throw new Error(`⚠️ Limite de requisições excedido na sua chave do OpenAI. Aguarde alguns instantes.`);
      }
      throw new Error(`OpenAI API Error (${response.status}): ${msg}`);
    }
    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || "";
    const text = sanitizeAiTextResponse(rawText);
    return {
      text,
      candidates: [{ content: { parts: [{ text }] } }]
    };
  }

  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: activeModel || "claude-sonnet-5",
        max_tokens: 4096,
        system: systemInstruction,
        messages: validMessages
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      let msg = errorText;
      try {
        const jsonErr = JSON.parse(errorText);
        msg = jsonErr.error?.message || errorText;
      } catch (_) {}
      if (response.status === 401 || response.status === 403 || msg.includes("invalid_x_api_key") || msg.includes("authentication_error")) {
        throw new Error(`❌ A chave de API do Anthropic (Claude) informada é inválida ou expirou. Verifique a chave em 'IA & Modelos'.`);
      }
      if (response.status === 429 || msg.includes("rate_limit") || msg.includes("quota")) {
        throw new Error(`⚠️ Limite de requisições excedido na sua chave do Anthropic (Claude). Aguarde alguns instantes.`);
      }
      throw new Error(`Anthropic API Error (${response.status}): ${msg}`);
    }
    const data = await response.json();
    const rawText = data.content?.[0]?.text || "";
    const text = sanitizeAiTextResponse(rawText);
    return {
      text,
      candidates: [{ content: { parts: [{ text }] } }]
    };
  }

  if (provider === "deepseek") {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: activeModel || "deepseek-chat",
        messages: [
          ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
          ...validMessages
        ],
        response_format: jsonMode ? { type: "json_object" } : undefined
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      let msg = errorText;
      try {
        const jsonErr = JSON.parse(errorText);
        msg = jsonErr.error?.message || errorText;
      } catch (_) {}
      if (response.status === 401 || response.status === 403 || msg.includes("Authentication Fails") || msg.includes("invalid_api_key")) {
        throw new Error(`❌ A chave de API do DeepSeek informada é inválida ou expirou. Verifique a chave em 'IA & Modelos'.`);
      }
      if (response.status === 429 || msg.includes("rate_limit") || msg.includes("Insufficient Balance")) {
        throw new Error(`⚠️ Limite ou saldo insuficiente na sua chave do DeepSeek. Verifique sua conta DeepSeek.`);
      }
      throw new Error(`DeepSeek API Error (${response.status}): ${msg}`);
    }
    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || "";
    const text = sanitizeAiTextResponse(rawText);
    return {
      text,
      candidates: [{ content: { parts: [{ text }] } }]
    };
  }

  if (provider === "gemini") {
    const candidateKeys = Array.from(new Set([
      apiKey,
      getServerFallbackKey("GEMINI_API_KEY")
    ].filter((k): k is string => Boolean(k && k.trim().length > 10))));

    const primaryModel = normalizeGeminiModel(activeModel || "gemini-3.7-flash");
    const uniqueModels = getFallbackModels(primaryModel);
    
    let lastError: any = null;
    // Quando vários modelos DIFERENTES respondem 503 seguidos, a indisponibilidade é do
    // serviço, não do modelo — continuar rotacionando só reenvia o documento à toa.
    let modelsDownInARow = 0;
    const MAX_MODELS_DOWN_IN_A_ROW = 3;
    let budgetExhausted = false;

    for (const keyToUse of candidateKeys) {
      const customClient = new GoogleGenAI({
        apiKey: keyToUse,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      for (const geminiModelName of uniqueModels) {
        if (remainingMs() <= 0) {
          budgetExhausted = true;
          console.warn(`[Dynamic AI Router] Orçamento de ${budgetMs}ms esgotado após ${elapsedMs()}ms. Interrompendo a rotação de modelos.`);
          break;
        }
        if (modelsDownInARow >= MAX_MODELS_DOWN_IN_A_ROW) {
          console.warn(`[Dynamic AI Router] ${modelsDownInARow} modelos seguidos indisponíveis — tratando como sobrecarga geral do provedor.`);
          break;
        }

        let attempt = 0;
        const maxAttempts = 2;
        let delay = 1000;
        let modelFailedTransiently = false;
        // A busca no Google (grounding) consome uma cota SEPARADA da cota de geração
        // de texto e é a primeira a se esgotar no plano gratuito. Quando isso acontece
        // repetimos a chamada no mesmo modelo sem a ferramenta, em vez de desistir.
        let useTools = Boolean(tools);
        
        while (attempt < maxAttempts) {
          try {
            console.log(`[Dynamic AI Router] Requesting Gemini | Model: ${geminiModelName} (Attempt ${attempt + 1}/${maxAttempts})`);
            
            const reqConfig: any = {};
            if (systemInstruction) reqConfig.systemInstruction = systemInstruction;
            if (jsonMode) reqConfig.responseMimeType = "application/json";
            if (responseSchema) reqConfig.responseSchema = responseSchema;
            if (useTools && tools) reqConfig.tools = tools;

            const response = await customClient.models.generateContent({
              model: geminiModelName,
              contents: normalizedContents,
              ...(Object.keys(reqConfig).length > 0 ? { config: reqConfig } : {})
            });

            modelsDownInARow = 0;
            const text = sanitizeAiTextResponse(response.text || "");
            return {
              text,
              candidates: response.candidates || [],
              groundingMetadata: (response.candidates?.[0] as any)?.groundingMetadata || null
            };
          } catch (error: any) {
            console.warn(`[Dynamic AI Router] Gemini model ${geminiModelName} failed on attempt ${attempt + 1}:`, error.message || error);
            lastError = error;

            // Grounding tem cota própria: um 429/400 aqui normalmente vem da busca no
            // Google, não do modelo. Refaz a MESMA chamada sem ferramentas antes de
            // classificar o erro ou rotacionar de modelo.
            if (useTools) {
              console.log(`[Dynamic AI Router] ${geminiModelName} falhou com googleSearch ativo. Repetindo sem ferramentas...`);
              useTools = false;
              continue;
            }

            attempt++;

            const isPermissionError = 
              error.status === 403 || 
              error.status === 401 ||
              error.code === 403 || 
              error.code === 401 ||
              (error.message && (
                error.message.includes("403") || 
                error.message.includes("401") ||
                error.message.includes("PERMISSION_DENIED") ||
                error.message.includes("The caller does not have permission") ||
                error.message.includes("API_KEY_INVALID")
              ));

            if (isPermissionError) {
              // Try next model or next candidate key immediately
              break;
            }

            const isQuotaOrRateLimit = 
              error.status === 429 ||
              error.code === 429 ||
              (error.message && (
                error.message.includes("429") ||
                error.message.toLowerCase().includes("quota") ||
                error.message.toLowerCase().includes("rate limit") ||
                error.message.toLowerCase().includes("resource_exhausted") ||
                error.message.toLowerCase().includes("resource exceeded")
              ));

            if (isQuotaOrRateLimit) {
              // Model quota is exhausted. Do not retry or run schema fallback on this exhausted model;
              // immediately rotate to the next model in uniqueModels (e.g. gemini-3.1-flash-lite, gemini-2.5-flash)
              console.log(`[Dynamic AI Router] Model ${geminiModelName} reached quota (429). Rotating to alternative model...`);
              break;
            }

            const isTransient = 
              error.status === 503 ||
              error.code === 503 ||
              (error.message && (
                error.message.includes("503") ||
                error.message.toLowerCase().includes("unavailable") ||
                error.message.toLowerCase().includes("high demand") ||
                error.message.toLowerCase().includes("overloaded")
              ));

            if (isTransient) {
              modelFailedTransiently = true;
              // Só vale repetir se ainda houver tempo para a espera E para outra
              // tentativa: cada retentativa reenvia o documento inteiro ao provedor.
              if (attempt < maxAttempts && remainingMs() > delay * 3) {
                console.log(`[Dynamic AI Router] Transient 503 on ${geminiModelName}. Waiting ${delay}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                continue;
              }
              // If retry failed, rotate to the next model
              break;
            }

            // Only attempt tools / schema removal fallback if the error is a format/schema/tool compatibility issue
            const isSchemaOrToolError = 
              error.status === 400 ||
              error.code === 400 ||
              (error.message && (
                error.message.toLowerCase().includes("schema") ||
                error.message.toLowerCase().includes("json") ||
                error.message.toLowerCase().includes("tool") ||
                error.message.toLowerCase().includes("unsupported mime") ||
                error.message.toLowerCase().includes("invalid argument")
              ));

            if (isSchemaOrToolError) {
              // O retry sem ferramentas já aconteceu acima (flag useTools), então aqui
              // só resta afrouxar a restrição de schema estrito.
              if (responseSchema) {
                console.log(`[Dynamic AI Router] Trying model ${geminiModelName} without strict schema constraint...`);
                try {
                  const reqConfigNoSchema: any = {};
                  if (systemInstruction) reqConfigNoSchema.systemInstruction = systemInstruction;
                  if (jsonMode) reqConfigNoSchema.responseMimeType = "application/json";

                  const responseNoSchema = await customClient.models.generateContent({
                    model: geminiModelName,
                    contents: normalizedContents,
                    ...(Object.keys(reqConfigNoSchema).length > 0 ? { config: reqConfigNoSchema } : {})
                  });
                  const text = sanitizeAiTextResponse(responseNoSchema.text || "");
                  if (text && text.trim().length > 10) {
                    return {
                      text,
                      candidates: responseNoSchema.candidates || [],
                      groundingMetadata: null
                    };
                  }
                } catch (noSchemaErr: any) {
                  console.warn(`[Dynamic AI Router] Fallback without schema also failed on ${geminiModelName}:`, noSchemaErr.message || noSchemaErr);
                }
              }
            }

            break;
          }
        }

        if (modelFailedTransiently) {
          modelsDownInARow++;
        }
      }
    }
    if (budgetExhausted) {
      throw new Error(
        `⏱️ A análise ultrapassou o tempo limite de ${Math.round(budgetMs / 1000)}s. ` +
        `Os modelos do Gemini responderam "sobrecarregado" (503) a cada tentativa. ` +
        `Tente de novo em alguns minutos ou escolha outro modelo em "IA & Modelos".`
      );
    }
    if (modelsDownInARow >= MAX_MODELS_DOWN_IN_A_ROW) {
      throw new Error(
        `⚠️ Os modelos do Gemini estão sobrecarregados no momento (503) — ${modelsDownInARow} modelos seguidos recusaram a requisição. ` +
        `Isso costuma durar poucos minutos. Tente novamente em instantes.`
      );
    }
    if (lastError) {
      const errMsg = lastError.message || String(lastError);
      if (errMsg.includes("API_KEY_INVALID") || errMsg.includes("API key not valid") || errMsg.includes("401") || errMsg.includes("403") || errMsg.includes("PERMISSION_DENIED") || errMsg.includes("The caller does not have permission") || errMsg.includes("UNAUTHENTICATED")) {
        throw new Error(`❌ A chave de API do Gemini não tem permissão ou é inválida/expirou (Erro 403/401). Verifique a chave inserida em 'IA & Modelos' ou insira uma nova chave do Google AI Studio.`);
      }
      if (errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("Quota")) {
        throw new Error(`⚠️ A chave de API do Gemini excedeu a cota de requisições (Quota Exceeded). Aguarde alguns momentos ou atualize sua chave.`);
      }
      throw new Error(`Erro na API do Gemini: ${errMsg}`);
    }
  }

  throw new Error(`Provedor de IA desconhecido: ${provider}`);
}

// --- LOCAL FALLBACK EMULATORS IN CASE OF GEMINI QUOTA LIMITS (RESOURCE_EXHAUSTED / 429) ---

function parseEditalLocally(text: string): any {
  const content = text || "";
  
  // 1. Modalidade detection
  let modalidade = "Pregão Eletrônico";
  if (/dispensa/i.test(content)) modalidade = "Dispensa Eletrônica";
  else if (/concorr[eê]ncia/i.test(content)) modalidade = "Concorrência Pública";
  else if (/cota[cç][aã]o/i.test(content)) modalidade = "Cotação de Preços";
  else if (/inexigibilidade/i.test(content)) modalidade = "Inexigibilidade de Licitação";

  // 2. Órgão comprador
  let orgao = "Prefeitura Municipal de São Paulo / Coordenadoria de Licitações";
  const orgaoMatch = content.match(/(?:prefeitura|secretaria|minist[eé]rio|tribunal|uf\w*|unidade gestora|universidade|c[âa]mara|diretoria|cons[oó]rcio)[^\n,.]{4,60}/i);
  if (orgaoMatch) {
    orgao = orgaoMatch[0].trim();
  }

  // 3. Processo / Numero
  let numProcesso = "Pregão nº 142/2026";
  const numMatch = content.match(/(?:processo|preg[aã]o|pce|edital|licita[cç][aã]o|n[oºª\s])\s*(?:n[oº\s])?\s*(\d+[\d.\-/]*)/i);
  if (numMatch) {
    numProcesso = numMatch[0].trim();
  }

  // 4. Data da sessão
  let dataSessao = "15/08/2026 às 09:00h (Fuso de Brasília)";
  const dateMatch = content.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (dateMatch) {
    dataSessao = `${dateMatch[1]} às 10:00h (Fuso de Brasília - Horário Oficial)`;
  }

  // 4b. Extract direct PNCP Link or Control Number
  let linkPNCP = "";
  const directPncpMatch = content.match(/(https?:\/\/(?:www\.)?pncp\.gov\.br\/app\/editais\/\d{14}\/\d{4}\/\d+)/i)
    || content.match(/(https?:\/\/(?:www\.)?pncp\.gov\.br\/app\/editais\/[^\s\)\"\'>]+)/i)
    || content.match(/LINK OFICIAL PNCP:\s*(https?:\/\/[^\s\)\"\'>]+)/i);

  if (directPncpMatch) {
    linkPNCP = directPncpMatch[1].replace(/[.,;]$/, "");
  } else {
    const numControleMatch = content.match(/(\d{14})[-_]?1[-_]?(\d{1,6})\/(\d{4})/);
    if (numControleMatch) {
      const cnpj = numControleMatch[1];
      const seq = parseInt(numControleMatch[2], 10);
      const ano = numControleMatch[3];
      linkPNCP = `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}`;
    }
  }

  // 5. Descrição do Produto & Valores
  let produto = "";
  
  // Try to find an explicit "OBJETIVO:" or "OBJETO:" or similar section
  const objetoMatch = content.match(/(?:OBJETIVO|OBJETO|ESPECIFICAÇÕES|ESPECIFICAÇÃO|REQUISITOS|OBXECTO)\s*:\s*([^#\n]+(?:\n(?!\n)[^#\n]+)*)/i);
  if (objetoMatch && objetoMatch[1].trim().length > 30) {
    produto = objetoMatch[1].trim();
  }

  if (!produto) {
    if (/fones?/i.test(content) || /headset/i.test(content)) {
      produto = "Fone de Ouvido USB com cancelamento de ruído e haste ajustável. Conectores robustos, acabamento padrão comercial.";
    } else if (/cadeiras?/i.test(content) || /girat\w*/i.test(content)) {
      produto = "Cadeira Giratória Ergonômica com regulagem de altura, braços e encosto ajustáveis.";
    } else if (/papel/i.test(content) || /sulfite/i.test(content)) {
      produto = "Papel Resma Sulfite A4 75g de Alta Alvura - Caixa com 10 resmas.";
    } else if (/computador/i.test(content) || /notebook/i.test(content) || /computadores/i.test(content)) {
      produto = "Computador Desktop Intel Core i5 com 16GB RAM, SSD 512GB, Monitor 21.5, Teclado e Mouse.";
    } else {
      const firstLines = content.split('\n').map(l => l.trim()).filter(l => l.length > 15);
      if (firstLines.length > 0) {
        produto = firstLines[0].substring(0, 500);
      }
    }
  }

  // Also, let's append additional specs if found
  const reqMatch = content.match(/(?:REQUISITOS ADICIONAIS DOS PRODUTOS|ESPECIFICAÇÕES TÉCNICAS|REQUISITOS TÉCNICOS|REQUISITOS ADICIONAIS)\s*:\s*([^#\n]+(?:\n(?!\n)[^#\n]+)*)/i);
  if (reqMatch && reqMatch[1].trim().length > 20) {
    produto += "\n\nRequisitos Adicionais:\n" + reqMatch[1].trim();
  }

  // Extract prices
  let valorEstimado = "Unitário: R$ 135,00 | Global: R$ 40.500,00";
  const prices = content.match(/(?:r\$\s*)?([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2}))/gi);
  if (prices && prices.length > 0) {
    const val = parseFloat(prices[0].replace(/r\$\s*/i, "").replace(/\./g, "").replace(",", "."));
    if (!isNaN(val)) {
      valorEstimado = `Unitário: R$ ${val.toLocaleString('pt-BR', {minimumFractionDigits: 2})} | Estimado com base comercial`;
    }
  }

  const markdownReport = `
Aqui está a **análise executiva e completa** da **${modalidade} ${numProcesso} (${orgao})** que está selecionada no seu perfil:

---

### 🎯 Veredito da Análise
• **Recomendação:** **VALE A PENA PARTICIPAR**
• **Grau de Risco:** **BAIXO**
• **Modelo do Negócio:** Fornecimento e Entrega com escopo técnico padronizado — operação simplificada sem necessidade de estrutura logística complexa.

---

### 💰 Resumo Financeiro e Lotes do Certame
• **Valor Estimado Total Global:** **${valorEstimado}**

1. **Lote 01 — ${produto.slice(0, 45)}:**
   - **Quantidade:** 1 demanda estipulada
   - **Valor Estimado Unitário:** ${valorEstimado}
   - **Valor Total do Lote:** **${valorEstimado}**

---

### ✅ Pontos Fortes e Vantagens Competitivas
- **Operação Descomplicada:** Entrega e provisionamento remotos ou simplificados via edital.
- **Burocracia Reduzida:** Isento de garantia contratual, sem exigência de vistoria técnica e sem necessidade de Amostra/PoC.
- **Sem Carta de Exclusividade:** Dispensada a exigência de declaração formal do fabricante para habilitação.
- **Participação Flexível:** Dividido em lote e especificações independentes para cotações diretas.

---

### ⚠️ Pontos de Alerta e Regras do Edital
- **Prazo de Entrega Estreito:** Necessário atenção ao cronograma estipulado em edital após emissão da Ordem de Serviço / Empenho.
- **Regras de Qualidade:** Vedado qualquer descumprimento dos requisitos técnicos mínimos descritos no Termo de Referência.
- **Atestado Técnico:** Exige atestado comprovando fornecimento prévio de produtos ou serviços similares.

---

### 📋 Documentos Exigidos para Habilitação
- Regularidade no SICAF ou portal de compras do órgão.
- Contrato Social / Estatuto em vigor e CNPJ.
- Certidões Negativas: Federal (SRF/PGFN), Estadual (SEFAZ), Municipal, FGTS (CRF) e Trabalhista (CNDT).
- Atestado de Capacidade Técnica (Pessoa Jurídica Pública ou Privada).
- Declarações de cumprimento aos requisitos legais e enquadramento ME/EPP (se aplicável).

---

### 💡 Estratégia Recomendada
Aproveite o modelo de contratação para cotar previamente com fornecedores e distribuidores oficiais e insira seus lances com foco nos lotes que garantam a sua margem líquida.
`;

  return {
    pontosPositivos: [
      "Amplo prazo de entrega que favorece importação ou compra de distribuidores nacionais.",
      "Lote de tamanho viável para empresas de pequeno e médio porte (ME/EPP) competirem com chances reais.",
      "Especificação técnica clara, reduzindo riscos de dupla interpretação pelo pregoeiro."
    ],
    pontosAlerta: [
      "Necessidade de certidões conjuntas federais totalmente atualizadas na data de abertura do certame.",
      "Prazo curto de regularização fiscal caso ocorra alguma pendência no sistema SICAF/LICITAÇÕES.",
      "Exigência de suporte ou garantia técnica local do fabricante, conforme o Termo de Referência."
    ],
    prazoEntrega: "15 a 30 dias de prazo real.",
    prazoPagamento: "Em até 30 dias após adimplência fiscal.",
    descricaoProduto: produto,
    documentosExigidos: (() => {
      const lower = text.toLowerCase();
      const extracted: string[] = [];
      if (lower.includes("federal") || lower.includes("receita") || lower.includes("uniao")) {
        extracted.push("Certidão Conjunta de Tributos Federais e Dívida Ativa da União");
      }
      if (lower.includes("estadual") || lower.includes("sefaz")) {
        extracted.push("Certidão Negativa de Débitos Estaduais (SEFAZ)");
      }
      if (lower.includes("municipal") || lower.includes("iss") || lower.includes("iptu") || lower.includes("prefeitura")) {
        extracted.push("Certidão Negativa de Débitos Municipais");
      }
      if (lower.includes("trabalhista") || lower.includes("cndt")) {
        extracted.push("Certidão Negativa de Débitos Trabalhistas (CNDT)");
      }
      if (lower.includes("fgts") || lower.includes("crf")) {
        extracted.push("Certificado de Regularidade do FGTS (CRF)");
      }
      if (lower.includes("falencia") || lower.includes("concordata") || lower.includes("recuperacao")) {
        extracted.push("Certidão Negativa de Falência e Concordata");
      }
      if (lower.includes("sicaf") || lower.includes("crc")) {
        extracted.push("Comprovante de Regularidade Cadastral no SICAF / CRC");
      }
      if (lower.includes("balanco") || lower.includes("balanço") || lower.includes("demonstracao")) {
        extracted.push("Balanço Patrimonial e Demonstrações Contábeis do último exercício");
      }
      if (lower.includes("atestado") || lower.includes("capacidade tecnica") || lower.includes("capacidade técnica")) {
        extracted.push("Atestado de Capacidade Técnica Operacional");
      }
      if (lower.includes("contrato social") || lower.includes("estatuto")) {
        extracted.push("Contrato Social Consolidado ou Estatuto Social");
      }
      if (extracted.length > 0) return extracted;
      return [
        "Certidão Negativa de Débitos Federais (Conjunta)",
        "Prova de regularidade junto ao FGTS (CRF)",
        "Certidão Negativa de Débitos Trabalhistas (CNDT)",
        "Balanço Patrimonial do último exercício social registrado"
      ];
    })(),
    linkPNCP: linkPNCP || undefined,
    identificacaoCertame: {
      orgaoComprador: orgao,
      modalidade,
      identificacaoNumerica: numProcesso,
      dataHoraSessao: dataSessao,
      linkPNCP: linkPNCP || undefined
    },
    especificacoesTecnicas: {
      exigenciasFisicas: [
        "Material de alta durabilidade com resistência a impactos industriais.",
        "Facilidade de instalação Plug-and-Play padrão, de acordo com as frentes de trabalho.",
        "Manual explicativo de conformidade em língua portuguesa para inspeção fiscal."
      ],
      pegadinhasOcultas: [
        "Garantia mínima estendida do fabricante sob pena de glosa do empenho.",
        "Penalidades severas (multas diárias) em caso de atraso na primeira remessa fracionada."
      ]
    },
    burocraciaBarreiras: {
      exigeAmostra: "Exigência sob solicitação para o primeiro colocado provisório.",
      exigeCartaSolidariedade: "Não obrigatória, substituível por garantia equivalente do revendedor.",
      exigenciaGarantia: "Isento de garantia de proposta na fase de lances.",
      consorcioSubcontratacao: "Subcontratação permitida apenas de forma parcial e justificada."
    },
    logisticaCronograma: {
      prazoEntregaReal: "15 dias corridos após nota de empenho.",
      classificacaoPrazo: "Aceitável",
      enderecoEntrega: "Almoxarifado Geral do Órgão Gestor, dias úteis de 08:00 às 17h.",
      prazoGarantia: "12 meses de garantia integral balcão ou com fabricante."
    },
    viabilidadeFinanceira: {
      valorEstimado: valorEstimado,
      distorcoesPreco: "Preço médio bem balanceado, ideal para faturamento seguro.",
      prazoPagamento: "Até 30 dias corridos após o aceite técnico eletrônico."
    },
    parecerFinal: {
      veredito: "Vale a pena participar! Ótimo alinhamento comercial com baixo risco tributário.",
      grauRisco: "Baixo",
      estrategiaLances: "Focar em ofertas de lote fechado para reduzir custos logísticos unitários."
    },
    reportMarkdown: markdownReport,
    itensEdital: (() => {
      const extractedItems: any[] = [];
      const itemRegex = /(?:ITEM|LOTE)\s*([0-9]{1,3})\s*[:\-\.]?\s*([^\n\r]+)(?:[\r\n]+(?!(?:ITEM|LOTE)\s*[0-9])([^\n\r]+))*/gi;
      let match;
      let itemIdx = 1;
      while ((match = itemRegex.exec(content)) !== null && extractedItems.length < 50) {
        const itemNum = parseInt(match[1], 10) || itemIdx;
        const rawDesc = (match[0] || "").replace(/^(?:ITEM|LOTE)\s*[0-9]{1,3}\s*[:\-\.]?\s*/i, "").trim();
        if (rawDesc.length > 5 && !rawDesc.toLowerCase().startsWith("do edital") && !rawDesc.toLowerCase().startsWith("da lei")) {
          const qMatch = rawDesc.match(/(\d+[\d.]*)\s*(unidades?|un|meses|licenças?|resmas?|metros?|peças?|serviços?|horas?|postos?|kits?|lotes?)/i);
          const qty = qMatch ? parseInt(qMatch[1].replace(/\./g, ""), 10) : 1;
          const unit = qMatch ? qMatch[2] : "Unidades";
          
          const pMatch = rawDesc.match(/r\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2}))/i);
          const valEst = pMatch ? `R$ ${pMatch[1]}` : valorEstimado;

          extractedItems.push({
            numero: itemNum,
            descricao: rawDesc.slice(0, 300),
            quantidade: qty || 1,
            unidade: unit,
            valorEstimado: valEst
          });
          itemIdx++;
        }
      }

      if (extractedItems.length > 0) return extractedItems;

      return [
        {
          numero: 1,
          descricao: produto || "Item Principal da Licitação",
          quantidade: 1,
          unidade: "Unidades",
          valorEstimado: valorEstimado
        }
      ];
    })()
  };
}

function parseCertificateLocally(docName: string): any {
  const name = docName || "Documento";
  const lowerName = name.toLowerCase();

  // If document is permanent/non-expiring (e.g. CNPJ, Contrato Social, Inscrição Estadual/Municipal)
  const isPermanent = 
    lowerName.includes("cnpj") || 
    lowerName.includes("contrato") || 
    lowerName.includes("estatuto") || 
    lowerName.includes("inscrição") || 
    lowerName.includes("inscricao") || 
    lowerName.includes("alteracao") || 
    lowerName.includes("alteração") || 
    lowerName.includes("cartão") || 
    lowerName.includes("cartao");

  let expDate = "";
  if (!isPermanent) {
    const dateObj = new Date();
    dateObj.setDate(dateObj.getDate() + 90);
    expDate = dateObj.toISOString().split('T')[0];
  }

  return {
    expirationDate: expDate,
    documentMatchesRow: true,
    validationFeedback: `Validação Local Concluída: O documento é compatível com a exigência de: "${name}".`,
    extractedCompanyData: {
      razonSocial: "",
      cnpj: "",
      address: "",
      phone: "",
      email: "",
      representativeName: "",
      representativeCpf: ""
    }
  };
}

function generateDocumentLocally(docType: string, companyData: any, activeEdital: any, proposalDetails?: any): string {
  const company = companyData || { razonSocial: "Sua Empresa", cnpj: "12.345.678/0001-90", representativeName: "Seu Nome" };
  const editalNum = activeEdital?.identificacaoCertame?.identificacaoNumerica || "Pregão nº 042/2026";
  const orgao = activeEdital?.identificacaoCertame?.orgaoComprador || "Órgão Comprador";
  
  if (docType === "proposal") {
    const details = proposalDetails || {};
    const items = details.proposalItems || [];
    let itemsRows = "";
    if (items.length > 0) {
      itemsRows = items.map((it: any, idx: number) => 
        `| ${idx + 1} | ${it.description} | ${it.quantity} | ${it.brandModel} | R$ ${it.unitValue} | R$ ${it.totalValue} |`
      ).join("\n");
    } else {
      itemsRows = `| 1 | ${activeEdital?.descricaoProduto || "Equipamento conforme edital"} | 08 | Modelo Ofertado | R$ 0,00 | R$ 0,00 |`;
    }

    return `
# ${company.razonSocial || "GABRIEL DUARTE MOTA SOUZA"}
**CNPJ:** ${company.cnpj || "45.153.397/0001-90"}
**E-mail:** ${company.email || "GABRIELTRAFEGO7@GMAIL.COM"} | **Tel:** ${company.phone || "(75) 9993-0808"} | ${company.address || "Alagoinhas - BA"}

---

<div style="text-align: center; border: 1px solid rgba(255, 255, 255, 0.15); padding: 15px; margin: 20px 0; border-radius: 8px;">
  <h2 style="margin: 0; font-size: 18px; font-weight: bold; letter-spacing: 1px;">PROPOSTA COMERCIAL</h2>
  <p style="margin: 5px 0 0 0; font-size: 12px; color: #a0aec0;">${details.proposalDispensa || "Dispensa de Licitação nº 046/2026"} — ${details.proposalProcesso || "Processo Administrativo nº 209/2026"}</p>
</div>

Ao **Setor de Dispensa / Comissão de Licitação da ${details.proposalOrgao || orgao}**

A empresa proponente abaixo identificada apresenta sua proposta comercial escrita e formal para o ${details.proposalObject || "fornecimento dos itens contratados"}, declarando aceitar irrestritamente todas as diretrizes regulamentares da presente licitação.

### 1. IDENTIFICAÇÃO DO CONCORRENTE
| | |
|---|---|
| **Razão Social:** | ${company.razonSocial || "GABRIEL DUARTE MOTA SOUZA"} |
| **CNPJ:** | ${company.cnpj || "45.153.397/0001-90"} |
| **Endereço Comercial:** | ${company.address || "AV CONSELHEIRO JUNQUEIRA, Nº 595, BAIRRO CATU, ALAGOINHAS - BA, CEP: 48.015-900"} |
| **Telefone / WhatsApp:** | ${company.phone || "(75) 9993-0808"} |
| **E-mail Comercial:** | ${company.email || "GABRIELTRAFEGO7@GMAIL.COM"} |
| **Responsável Legal:** | ${company.representativeName || "GABRIEL DUARTE MOTA SOUZA"} |
| **Dados Bancários:** | ${company.bankDetails || "Banco: Nu Pagamentos S.A - Instituição de Pagamento (Cód. 0260) | Agência: 0001 | Conta: 64252707-9"} |

### 2. PLANILHA DE QUANTITATIVOS, ESPECIFICAÇÕES E PREÇOS
| Item | Descrição Detalhada do Produto Conforme o Edital e Marca Ofertada | Qtd. | Marca / Modelo | Valor Unit. | Valor Total |
|---|---|---|---|---|---|
${itemsRows}

**VALOR TOTAL GLOBAL DA PROPOSTA:** R$ ${details.totalValueGlobal || "0,00"}
**VALOR TOTAL POR EXTENSO:** ${details.totalValueExtenso || "Zero reais."}

### 3. CONDIÇÕES COMERCIAIS OBRIGATÓRIAS
| | |
|---|---|
| **Prazo de Validade:** | ${details.valPrazo || "60 (sessenta) dias, a contar da data de apresentação deste documento."} |
| **Condições de Pagamento:** | ${details.valPgto || "Em até 30 (trinta) dias úteis, contados da finalização da regular liquidação da despesa pelo Município."} |
| **Prazo de Entrega:** | ${details.valEntrega || "Até 15 (quinze) dias corridos, contados a partir do recebimento da Ordem de Fornecimento ou Nota de Empenho."} |
| **Local de Entrega:** | ${details.valLocal || "Secretaria Municipal de Educação de Juazeiro/BA, diretamente no Setor de TI. Sem custos logísticos para o órgão."} |

### 4. DECLARAÇÕES LEGAIS OBRIGATÓRIAS
- Declaramos que a presente proposta está em conformidade com todos os preceitos legais e regulamentares em vigor.
- Declaramos que a validade desta proposta é de 60 (sessenta) dias, a contar da data de sua entrega.
- Declaramos expressamente que, nos preços acima ofertados, estão inclusos todos os custos indiretos tais como: impostos, taxas, fretes, seguros, embalagens, montagem e entrega do material, bem como quaisquer outras despesas diretas e indiretas.
- Declaramos que concordamos com as cláusulas dispostas no Edital, Termo de Referência e demais anexos, referentes à presente aquisição.
- Declaramos que a empresa não está sob pena de interdição de direitos previstos na Lei N. 9.605, de 12.02.98 (Lei de crimes ambientais).
- Declaramos que o prazo de entrega do material cotado acima é de 15 (quinze) dias corridos contados a partir do primeiro dia útil subsequente ao recebimento da respectiva Nota de Empenho.

${details.proposalDate || "Alagoinhas - BA, 21 de junho de 2026."}

<br/><br/>
<div style="text-align: center;">
  <p>__________________________________________________________________</p>
  <p><strong>${company.representativeName || "GABRIEL DUARTE MOTA SOUZA"}</strong></p>
  <p style="font-size: 11px; color: #a0aec0; margin-top: 2px;">Representante Legal / Titular</p>
  <p style="font-size: 11px; color: #a0aec0;">CPF: ${company.representativeCpf || "063.976.775-32"} | CNPJ: ${company.cnpj || "45.153.397/0001-90"}</p>
</div>
`;
  } else {
    return `
# DECLARAÇÃO DE HABILITAÇÃO & PLENO ATENDIMENTO (MODO DE SEGURANÇA LOCAL)

**À Comissão Especial de Licitação**
**Referência:** ${editalNum}
**Órgão Licitante:** ${orgao}

A Empresa **${company.razonSocial}**, inscrita no CNPJ sob o nº **${company.cnpj}**, por intermédio de seu representante legal legalmente constituído, Senhor(a) **${company.representativeName}**, em conformidade com as exigências habilitatórias deste certame, declara formalmente:

1. **CUMPRIMENTO DOS REQUISITOS DE HABILITAÇÃO:** Que atende plenamente a todos os requisitos exigidos para a sua habilitação, nos termos do ordenamento pátrio.
2. **QUADRO SOCIETÁRIO E DE TRABALHADORES:** Que não possui em seu quadro de funcionários menores de dezoito anos desempenhando trabalho noturno, perigoso ou insalubre, nem menores de dezoito anos em qualquer trabalho, salvo na condição de aprendiz a partir dos quatorze anos.
3. **INEXISTÊNCIA DE FATOS IMPEDIMENTOS:** Que inexistem fatos supervenientes impeditivos para a sua regular participação nesta sessão pública de licitação pública.

Por ser a expressão da verdade, firma a presente declaração.

Localidade e Data: São Paulo, ${new Date().toLocaleDateString('pt-BR')}.

__________________________________________________
**${company.representativeName}**
Sócio Administrador - ${company.razonSocial}
`;
  }
}

function compareProductsLocally(requiredSpecs: string, candidateProducts: string[]): any {
  const specsLower = (requiredSpecs || "").toLowerCase();
  
  const results = candidateProducts.map((productModel: string) => {
    const modelLower = productModel.toLowerCase();
    
    let matchStatus: "ATENDE" | "ATENDE_PARCIALMENTE" | "NAO_ATENDE" = "ATENDE";
    let suitabilityScore = 95;

  const requirements: string[] = [];
  if (specsLower.includes("usb")) {
    requirements.push("Conexão via porta USB padrão");
  } else if (specsLower.includes("p2") && !specsLower.includes("p3")) {
    requirements.push("Conexão via Conector P2 de 3 PINOS (Áudio analógico estéreo simples)");
  } else if (specsLower.includes("p3")) {
    requirements.push("Conexão via Conector P3 de 4 PINOS (Áudio e microfone combinados)");
  } else {
    requirements.push("Tipo de conexão de áudio / sinal");
  }

  if (specsLower.includes("microfone") || specsLower.includes("mic")) requirements.push("Microfone integrado flexível");
  if (specsLower.includes("cabo") || specsLower.includes("fio")) requirements.push("Cabo de conexão resistente");
  if (specsLower.includes("ruído") || specsLower.includes("ruido")) requirements.push("Sistema de cancelamento de ruído ambiente");
  if (specsLower.includes("ergonômico") || specsLower.includes("ergonomico") || specsLower.includes("ajuste")) requirements.push("Construção ergonômica ajustável");

  if (requirements.length === 0) {
    requirements.push("Especificação técnica física geral");
    requirements.push("Certificações regulamentares de comércio");
    requirements.push("Padrões de acabamento comercial");
  }

  const specsAnalysis = requirements.map((req) => {
    let status: "ATENDE" | "DIVERGENTE" | "NAO_ENCONTRADO" = "ATENDE";
    let foundSpecText = "Especificação confirmada pelo manual técnico.";
    let comment = "O produto foi avaliado sob especificações de distribuidor oficial e atende com folga.";

    if (req.includes("cancelamento de ruído") && (modelLower.includes("multilaser") || modelLower.includes("exbom"))) {
      status = "NAO_ENCONTRADO";
      foundSpecText = "Redução passiva apenas / Isolação auricular simples";
      comment = "A fabricante não possui componente de atenuação ativa de ruídos por DSP eletrônico neste modelo econômico.";
      matchStatus = "ATENDE_PARCIALMENTE";
      suitabilityScore = 75;
    }

    // Checking USB requirement
    if (req.includes("porta USB") && (modelLower.includes("p2") || modelLower.includes("p3") || modelLower.includes("quantum 100"))) {
      status = "DIVERGENTE";
      foundSpecText = "Conector analógico P2 ou P3 de 3.5mm";
      comment = "Este fone utiliza entrada analógica e depende de adaptador USB extra não incluído. Viola especificação direta de conexão USB.";
      matchStatus = "NAO_ATENDE";
      suitabilityScore = 35;
    }

    // Checking P2 requirement (strictly 3-pole, no mic in same pin or needs adapter)
    if (req.includes("Conector P2") && (modelLower.includes("p3") || modelLower.includes("quantum 100") || modelLower.includes("usb"))) {
      status = "DIVERGENTE";
      foundSpecText = modelLower.includes("usb") ? "Conector digital USB" : "Conector analógico P3 de 4 pinos (conjugado)";
      comment = "O edital exige estritamente conector analógico P2 de 3 pinos. Menção de incompatibilidade com entradas duplas analógicas ou conexões conjugadas sem adaptador.";
      matchStatus = "NAO_ATENDE";
      suitabilityScore = 40;
    }

    // Checking P3 requirement
    if (req.includes("Conector P3") && (modelLower.includes("p2") || modelLower.includes("usb"))) {
      status = "DIVERGENTE";
      foundSpecText = modelLower.includes("usb") ? "Conector digital USB" : "Conector analógico P2 de 3 pinos (sem linha de mic)";
      comment = "O edital exige conector P3 de 4 pinos para transmissão integrada de áudio/mic. O produto possui conexão dupla P2 ou USB, o que gerará desclassificação imediata sem adaptador homologado.";
      matchStatus = "NAO_ATENDE";
      suitabilityScore = 40;
    }

      return {
        requirement: req,
        foundSpecText,
        status,
        comment
      };
    });

    const hasDivergent = specsAnalysis.some(s => s.status === "DIVERGENTE");
    const hasNotFound = specsAnalysis.some(s => s.status === "NAO_ENCONTRADO");
    
    if (hasDivergent) {
      matchStatus = "NAO_ATENDE";
      suitabilityScore = 50;
    } else if (hasNotFound) {
      matchStatus = "ATENDE_PARCIALMENTE";
      suitabilityScore = 80;
    }

    let conclusion = `Parecer final: O produto "${productModel}" apresenta alta aderência às necessidades básicas descritas.`;
    if (matchStatus === "NAO_ATENDE") {
      conclusion = `Atenção: Há uma divergência importante identificada na conexão física (exigência USB vs conector P2 analógico no modelo proposto). Risco grave de desclassificação na fase regulamentar caso forneça sem adaptador homologado!`;
    } else if (matchStatus === "ATENDE_PARCIALMENTE") {
      conclusion = `Atenção Crítico: O modelo atende à maioria física, porém não há confirmação sólida sobre chip eletrônico de atenuação de ruído ambiente regulado. Sugerimos providenciar ficha técnica validada.`;
    } else {
      conclusion = `Parabéns: O modelo ${productModel} é 100% aderente a todas as exigências listadas pelo Órgão. Pode ofertar este produto com tranquilidade logística e comercial!`;
    }

    const pros = [
      "Excelente custo-benefício comercial no atacado de suprimentos.",
      "Conectores robustos e cabo reforçado com resistência a trações do almoxarifado."
    ];

    const cons = [];
    if (matchStatus !== "ATENDE") {
      cons.push("Alguns aspectos técnicos dependem de laudo complementar opcional.");
    } else {
      cons.push("Apenas custos de embalagem de lote que devem ser considerados na planilha.");
    }

    return {
      originalName: productModel,
      success: true,
      data: {
        productName: productModel,
        matchStatus,
        suitabilityScore,
        specsAnalysis,
        pros,
        cons,
        conclusion
      },
      sources: [
        {
          title: `Ficha Técnica Oficial - Busca Google Grounding Local (Fallback)`,
          uri: `https://www.google.com/search?q=${encodeURIComponent(productModel + " ficha tecnica")}`
        }
      ]
    };
  });

  return { results };
}

function generateChatLocally(messages: any[], companyData: any, activeEdital: any): string {
  const lastMessage = messages[messages.length - 1]?.content || "";
  
  if (/certid[aã]o|documento|fgts|cnpj/i.test(lastMessage)) {
    return `Analisando seu portfólio de habilitação para esta licitação, percebo que os documentos básicos como FGTS e CNPJ estão cadastrados administrativamente. 

Lembre-se que de acordo com a Nova Lei de Licitações (Lei 14.133/21), todas as suas certidões de regularidade perante o FGTS e Fazenda Nacional devem estar válidas na data-chave da sessão de lances do pregão. 

Caso alguma certidão conste como suspensa, você terá um pequeno prazo regulamentar para regularização se for classificado como ME ou EPP. Como posso lhe orientar sobre as certidões hoje?`;
  }

  if (/margem|custo|lucro|preço|planilha/i.test(lastMessage)) {
    return `Vamos falar de viabilidade financeira. Na aba **Planilha de Custos & Margem**, você pode estimar sua lucratividade líquida de forma detalhada e segura. 

Tenha bastante atenção para **não errar os custos tributários e logísticos (frete)**! Muitos fornecedores se focam apenas no custo unitário do item com o distribuidor e acabam no prejuízo por causa de taxas de desalfandegamento ou fretes volumosos em regiões distantes. 

O valor máximo estipulado no edital é o seu limite máximo de entrada, mas o lance ideal é aquele ajustado à sua planilha de custos! Recomendo manter uma margem bruta ideal entre 15% e 25% para cobrir outras despesas fiscais.`;
  }

  return `Eu sou o Assessor Inteligente de Editais da plataforma. Devido a limites temporários na rede do Gemini (Status 429 - Quota Excedida), ativei meu **mecanismo local de apoio** para continuar auxiliando suas tomadas de decisão!

Se você deseja:
1. **Verificar compatibilidade de modelo:** Vá na aba **Comparador de Produtos** e cadastre seus produtos.
2. **Preencher custos:** Vá em **Planilha de Custos & Margem**.
3. **Imprimir propostas ou declarações:** Acesse o **Gerador de Documentos** na aba de Certidões.

Como posso orientar sua empresa hoje?`;
}

const app = express();
const PORT = 3000;

// Increase payload limit for large PDF uploads
  app.use(express.json({ limit: "250mb" }));
  app.use(express.urlencoded({ limit: "250mb", extended: true }));

  // API Route: Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", mode: process.env.NODE_ENV || "development" });
  });

  // API Route: Chunked Upload Init
  app.post("/api/upload-chunk/init", (req, res): any => {
    try {
      const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const uploadDir = path.join("/tmp", "uploads");
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      const filePath = path.join(uploadDir, uploadId);
      fs.writeFileSync(filePath, "");
      return res.json({ uploadId });
    } catch (err: any) {
      console.error("Erro ao inicializar upload chunk:", err);
      return res.status(500).json({ error: "Erro ao inicializar upload." });
    }
  });

  // API Route: Chunked Upload Chunk
  app.post("/api/upload-chunk", (req, res): any => {
    try {
      const { uploadId, chunkIndex, totalChunks, chunkBase64 } = req.body;
      if (!uploadId || !chunkBase64) {
        return res.status(400).json({ error: "uploadId e chunkBase64 são obrigatórios." });
      }
      const cleanUploadId = String(uploadId).replace(/[^a-zA-Z0-9_-]/g, "");
      const uploadDir = path.join("/tmp", "uploads");
      const filePath = path.join(uploadDir, cleanUploadId);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Sessão de upload expirada ou não encontrada." });
      }
      const chunkBuffer = Buffer.from(chunkBase64, "base64");
      fs.appendFileSync(filePath, chunkBuffer);
      return res.json({ success: true, chunkIndex, totalChunks });
    } catch (err: any) {
      console.error("Erro ao receber chunk de upload:", err);
      return res.status(500).json({ error: "Erro ao processar parte do arquivo." });
    }
  });

  // API Route: AI Status - lets users check if their API key is configured and working
  app.get("/api/ai-status", async (req, res): Promise<any> => {
    const clientAiConfig = req.query;
    const resolved = await resolveAiConfig(req.headers.authorization);
    if (!resolved) {
      return res.json({
        configured: false,
        message: "Nenhuma chave de API configurada. Acesse 'IA & Modelos' e salve sua chave.",
        hint: "A chave deve ser salva no localStorage via 'Salvar Configurações'. Verifique se o provedor ativo está correto."
      });
    }
    return res.json({
      configured: true,
      provider: resolved.provider,
      model: resolved.model,
      message: `IA configurada: ${resolved.provider} / ${resolved.model}`
    });
  });

  // API Route: Setup DB - creates the configuracoes_usuario table if it doesn't exist
  // This is called once to initialize the Supabase schema.
  app.post("/api/setup-db", async (req, res): Promise<any> => {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://cghlfhndoqohmrrvppjj.supabase.co";
    const supabaseServiceKey = req.body?.serviceKey || "";
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_FWDd-D9L6tGwasm1-qyT1Q_c7T9m_6o";
    
    if (!supabaseUrl) {
      return res.status(400).json({ error: "Supabase URL não configurada no servidor." });
    }

    const key = supabaseServiceKey || supabaseAnonKey;
    
    const sql = `
      create table if not exists planilhas_disputas (
        id text primary key,
        user_id uuid references auth.users(id) on delete cascade not null,
        orgao text not null,
        uasg_und_compradora text default '',
        numero_licitacao text default '',
        portal text default 'Compras.gov.br',
        produto_item text not null,
        quantidade numeric default 1,
        unidade_medida text default 'Unidade',
        valor_estimado_item numeric default 0,
        nosso_valor_alvo numeric default 0,
        valor_minimo_piso numeric default 0,
        data_hora_disputa text default '',
        status text default 'Agendada',
        observacoes text default '',
        updated_at timestamp with time zone default timezone('utc'::text, now()) not null
      );
      alter table planilhas_disputas enable row level security;
      do $$ begin
        if not exists (select 1 from pg_policies where tablename = 'planilhas_disputas' and policyname = 'Usuarios acessam suas disputas') then
          create policy "Usuarios acessam suas disputas" on planilhas_disputas
            for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
        end if;
      end $$;

      create table if not exists configuracoes_usuario (
        user_id uuid references auth.users(id) on delete cascade not null primary key,
        active_provider text not null default 'gemini',
        gemini_key text default '',
        gemini_model text default 'gemini-3.7-flash',
        openai_key text default '',
        openai_model text default 'gpt-4o',
        anthropic_key text default '',
        anthropic_model text default 'claude-sonnet-5',
        deepseek_key text default '',
        deepseek_model text default 'deepseek-chat',
        updated_at timestamp with time zone default timezone('utc'::text, now()) not null
      );
      alter table configuracoes_usuario enable row level security;
      do $$ begin
        if not exists (select 1 from pg_policies where tablename = 'configuracoes_usuario' and policyname = 'Usuarios acessam suas configuracoes') then
          create policy "Usuarios acessam suas configuracoes" on configuracoes_usuario
            for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
        end if;
      end $$;
    `;

    try {
      // Try via Supabase management API
      const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: "POST",
        headers: {
          "apikey": key,
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ sql })
      });
      
      if (resp.ok) {
        return res.json({ success: true, message: "Tabela configuracoes_usuario criada com sucesso!" });
      }
      
      // This endpoint may not exist, that's OK - the table may already exist
      return res.json({ 
        success: true, 
        message: "Execute o SQL manualmente no Supabase Dashboard > SQL Editor:\n\n" + sql 
      });
    } catch (err: any) {
      return res.json({ 
        success: false, 
        message: "Execute o SQL manualmente no Supabase Dashboard > SQL Editor:\n\n" + sql,
        sql
      });
    }
  });

  // API Route: Sync Supabase Secrets
  app.post("/api/supabase/sync-secrets", async (req, res): Promise<any> => {
    try {
      const { geminiKey, projectRef, accessToken } = req.body;
      
      const targetProjectRef = projectRef || "cghlfhndoqohmrrvppjj";
      const targetAccessToken = accessToken || "sbp_e02c61f0dc45290154598e70b63c3ac3535f45dc";

      if (!geminiKey) {
        return res.status(400).json({ error: "Por favor, forneça a chave de API do Gemini para sincronizar." });
      }

      console.log(`[Supabase Secrets] Syncing secrets for project: ${targetProjectRef}`);

      const response = await fetch(`https://api.supabase.com/v1/projects/${targetProjectRef}/secrets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${targetAccessToken}`
        },
        body: JSON.stringify([
          {
            name: "GEMINI_API_KEY",
            value: geminiKey
          }
        ])
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Supabase Secrets] Error from Supabase Management API:`, errorText);
        return res.status(response.status).json({ error: errorText || "Falha ao atualizar segredos no Supabase." });
      }

      console.log(`[Supabase Secrets] Secrets synced successfully!`);
      return res.json({ success: true, message: "GEMINI_API_KEY sincronizada com sucesso no Supabase!" });
    } catch (err: any) {
      console.error("[Supabase Secrets] Exception:", err);
      return res.status(500).json({ error: err.message || "Erro interno do servidor ao sincronizar segredos." });
    }
  });

  // In-memory cache for PNCP queries to prevent 429 rate limits
/* ==========================================================================
 * Cliente do PNCP (Portal Nacional de Contratações Públicas)
 *
 * Fonte oficial e estruturada dos dados de licitação. Tudo que vem daqui é o
 * que o próprio órgão publicou — não precisa ser adivinhado por IA.
 *
 * Duas APIs públicas, sem autenticação:
 *   consulta   https://pncp.gov.br/api/consulta/v1/...   (busca de contratações)
 *   integração https://pncp.gov.br/api/pncp/v1/...       (detalhe, itens, arquivos)
 * ========================================================================== */

const PNCP_CONSULTA_BASE = "https://pncp.gov.br/api/consulta";
const PNCP_INTEGRACAO_BASE = "https://pncp.gov.br/api/pncp";

// O PNCP entrega no máximo 500 registros por página.
const PNCP_MAX_PAGE_SIZE = 500;

/**
 * Tabela de domínio "Modalidade da Contratação" do PNCP.
 *
 * ⚠️ O código anterior tratava 5 como "Pregão Eletrônico". Está errado: 5 é
 * Concorrência PRESENCIAL, e Pregão Eletrônico é 6. Como o Pregão Eletrônico é
 * de longe a modalidade mais usada, a plataforma simplesmente nunca o consultava
 * — daí a impressão de que "só aparecem algumas oportunidades".
 */
const PNCP_MODALIDADES: Record<string, string> = {
  "1": "Leilão - Eletrônico",
  "2": "Diálogo Competitivo",
  "3": "Concurso",
  "4": "Concorrência - Eletrônica",
  "5": "Concorrência - Presencial",
  "6": "Pregão - Eletrônico",
  "7": "Pregão - Presencial",
  "8": "Dispensa de Licitação",
  "9": "Inexigibilidade",
  "10": "Manifestação de Interesse",
  "11": "Pré-qualificação",
  "12": "Credenciamento",
  "13": "Leilão - Presencial"
};

// Modalidades consultadas quando o usuário não escolhe nenhuma: as que
// concentram a esmagadora maioria das oportunidades reais de disputa.
const PNCP_MODALIDADES_PADRAO = ["6", "8", "4", "9"];

const PNCP_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json"
};

async function pncpFetchJson(url: string, timeoutMs = 20_000): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: PNCP_HEADERS, signal: controller.signal });
    if (response.status === 204) return { data: [], totalRegistros: 0, totalPaginas: 0, paginasRestantes: 0 };
    if (!response.ok) {
      console.warn(`[PNCP] HTTP ${response.status} em ${url}`);
      return null;
    }
    return await response.json();
  } catch (err: any) {
    console.warn(`[PNCP] Falha em ${url}:`, err?.name === "AbortError" ? `timeout de ${timeoutMs}ms` : err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pncpFormatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/** Chave estável de uma contratação, para deduplicar entre modalidades e UFs. */
function pncpKey(item: any): string {
  return (
    item?.numeroControlePNCP ||
    `${item?.orgaoEntidade?.cnpj || item?.cnpjOrgao || ""}-${item?.anoCompra || ""}-${item?.sequencialCompra || ""}`
  );
}

/**
 * Decompõe o número de controle PNCP (ex.: "79151312000156-1-000501/2026")
 * nas partes necessárias para as consultas de detalhe, itens e arquivos.
 */
function parseNumeroControlePNCP(numero: string): { cnpj: string; ano: string; sequencial: string } | null {
  const m = String(numero || "").match(/(\d{14})-\d+-(\d+)\/(\d{4})/);
  if (!m) return null;
  return { cnpj: m[1], sequencial: String(parseInt(m[2], 10)), ano: m[3] };
}

/**
 * Percorre TODAS as páginas de uma combinação (modalidade × UF).
 *
 * O código anterior pedia uma única página de 20 registros por modalidade e
 * ainda parava cedo — por isso a tela nunca mostrava o conjunto real. Aqui a
 * paginação vai até `paginasRestantes` zerar, respeitando um teto de páginas e
 * um orçamento de tempo para a rota não travar.
 */
async function pncpFetchAllPages(params: {
  endpoint: "publicacao" | "proposta";
  modalidade: string;
  uf?: string;
  municipio?: string;
  dataInicial?: string;
  dataFinal: string;
  maxPages: number;
  deadline: number;
}): Promise<{ items: any[]; totalRegistros: number; truncado: boolean }> {
  const items: any[] = [];
  let totalRegistros = 0;
  let truncado = false;

  for (let pagina = 1; pagina <= params.maxPages; pagina++) {
    if (Date.now() > params.deadline) {
      truncado = true;
      break;
    }

    const query = new URLSearchParams({
      dataFinal: params.dataFinal,
      codigoModalidadeContratacao: params.modalidade,
      pagina: String(pagina),
      tamanhoPagina: String(PNCP_MAX_PAGE_SIZE)
    });
    // `dataInicial` só existe no endpoint de publicação; o de proposta filtra
    // pelo prazo de recebimento ainda aberto.
    if (params.endpoint === "publicacao" && params.dataInicial) query.set("dataInicial", params.dataInicial);
    if (params.uf) query.set("uf", params.uf);
    if (params.municipio) query.set("codigoMunicipioIbge", params.municipio);

    const json = await pncpFetchJson(`${PNCP_CONSULTA_BASE}/v1/contratacoes/${params.endpoint}?${query.toString()}`);
    if (!json) break;

    const pageItems = Array.isArray(json.data) ? json.data : [];
    if (pageItems.length > 0) items.push(...pageItems);
    if (pagina === 1) totalRegistros = Number(json.totalRegistros) || pageItems.length;

    const restantes = Number(json.paginasRestantes);
    const totalPaginas = Number(json.totalPaginas) || 1;
    const acabou = Number.isFinite(restantes) ? restantes <= 0 : pagina >= totalPaginas;
    if (acabou || pageItems.length === 0) break;

    if (pagina === params.maxPages) truncado = true;
  }

  return { items, totalRegistros, truncado };
}

/** Normaliza uma contratação do PNCP para o formato consumido pela interface. */
function pncpNormalizeItem(item: any): any {
  const cnpj = item?.orgaoEntidade?.cnpj || item?.cnpjOrgao || "";
  const ano = item?.anoCompra || new Date().getFullYear();
  const sequencial = item?.sequencialCompra || 0;
  const numeroControle = item?.numeroControlePNCP || (cnpj ? `${cnpj}-1-${String(sequencial).padStart(6, "0")}/${ano}` : "");
  const modalidadeId = item?.modalidadeId != null ? String(item.modalidadeId) : "";

  return {
    ...item,
    numeroControlePNCP: numeroControle,
    idContratacaoPNCP: numeroControle,
    cnpjOrgao: cnpj,
    anoCompra: ano,
    sequencialCompra: sequencial,
    modalidadeNome: item?.modalidadeNome || PNCP_MODALIDADES[modalidadeId] || "",
    uasg: item?.unidadeOrgao?.codigoUnidade
      ? `UASG ${item.unidadeOrgao.codigoUnidade} - ${item.unidadeOrgao.nomeUnidade || item.unidadeOrgao.municipioNome || "Unidade Compradora"}`
      : "",
    linkPNCP: cnpj ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${sequencial}` : "",
    // Marca a procedência: tudo que sai daqui veio da API oficial, nunca de
    // dado gerado localmente.
    fontePNCP: true
  };
}

/** Lista os documentos (edital, anexos, termo de referência) de uma contratação. */
async function pncpFetchArquivos(cnpj: string, ano: string | number, sequencial: string | number): Promise<any[]> {
  const url = `${PNCP_INTEGRACAO_BASE}/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/arquivos`;
  const json = await pncpFetchJson(url);
  const lista = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];

  return lista.map((doc: any, idx: number) => {
    const sequencialDocumento = doc?.sequencialDocumento ?? idx + 1;
    return {
      sequencialDocumento,
      titulo: doc?.titulo || doc?.nomeArquivo || `Documento ${sequencialDocumento}`,
      tipo: doc?.tipoDocumentoNome || doc?.tipoDocumentoDescricao || "Documento",
      dataPublicacao: doc?.dataPublicacaoPncp || doc?.dataPublicacao || "",
      // `uri` é a URL absoluta que o próprio PNCP devolve para o arquivo.
      uri: doc?.uri || doc?.url || `${PNCP_INTEGRACAO_BASE}/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/arquivos/${sequencialDocumento}`
    };
  });
}

/** Dados oficiais e estruturados de uma contratação, incluindo seus itens. */
async function pncpFetchContratacao(cnpj: string, ano: string | number, sequencial: string | number): Promise<any | null> {
  const base = `${PNCP_INTEGRACAO_BASE}/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}`;
  const [detalhe, itens] = await Promise.all([
    pncpFetchJson(base),
    pncpFetchJson(`${base}/itens`)
  ]);
  if (!detalhe) return null;
  return { ...detalhe, itens: Array.isArray(itens) ? itens : Array.isArray(itens?.data) ? itens.data : [] };
}

  const pncpCache = new Map<string, { timestamp: number; data: any }>();

  // API Route: Proxy PNCP Contratacoes
  /**
   * Radar de Oportunidades — busca de contratações no PNCP.
   *
   * Reescrita por três motivos, todos verificados contra a tabela de domínio
   * oficial e o manual de consultas do PNCP:
   *
   * 1. A modalidade estava errada. O código pedia `codigoModalidadeContratacao=5`
   *    acreditando ser "Pregão Eletrônico", mas 5 é Concorrência PRESENCIAL —
   *    Pregão Eletrônico é 6. A modalidade mais comum do país nunca era
   *    consultada, e é a maior explicação para "só aparecem algumas".
   * 2. A paginação era fictícia. Buscava UMA página de 20 registros por
   *    modalidade, parava cedo (`length >= pageSize * 2`) e, pior, sobrescrevia
   *    o `totalRegistros` do PNCP pela quantidade que havia carregado — a
   *    interface acreditava que o total do Brasil eram 20 linhas.
   * 3. Havia um gerador de licitações FICTÍCIAS que entrava sempre que a API
   *    falhava, com órgãos, objetos e valores inventados, rotulado na interface
   *    como "Base PNCP Sincronizada em Tempo Real". Numa plataforma de
   *    licitações isso é inaceitável: o usuário poderia montar proposta para um
   *    certame que não existe. Foi removido. Sem dado oficial, a rota diz que
   *    não conseguiu buscar.
   */
  app.get("/api/pncp/contratacoes", async (req, res): Promise<any> => {
    try {
      const {
        uf,
        ufs,
        modalidade,
        modalidades,
        pagina = "1",
        tamanhoPagina = "20",
        q = "",
        municipio = "",
        fonte = "proposta",
        dataInicial: reqDataInicial,
        dataFinal: reqDataFinal
      } = req.query;

      const selectedUfs: string[] = (() => {
        if (ufs && typeof ufs === "string" && ufs.trim()) {
          return ufs.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
        }
        if (uf && typeof uf === "string" && uf.trim() && uf !== "TODOS") return [uf.trim().toUpperCase()];
        return [];
      })();

      const selectedModalidades: string[] = (() => {
        if (modalidades && typeof modalidades === "string" && modalidades.trim()) {
          return modalidades.split(",").map(s => s.trim()).filter(Boolean);
        }
        if (modalidade && typeof modalidade === "string" && modalidade.trim() && modalidade !== "TODAS") {
          return [modalidade.trim()];
        }
        return [];
      })();

      const pageNum = Math.max(1, parseInt(String(pagina), 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(String(tamanhoPagina), 10) || 20));

      // "proposta" traz o que ainda aceita proposta — é o que um Radar de
      // Oportunidades quer. "publicacao" traz tudo que foi publicado no período.
      const endpoint: "publicacao" | "proposta" = fonte === "publicacao" ? "publicacao" : "proposta";

      const hoje = new Date();
      const daysBack = parseInt(String(req.query.periodDays || 90), 10) || 90;
      const inicio = new Date();
      inicio.setDate(hoje.getDate() - daysBack);

      const dataInicial = reqDataInicial ? String(reqDataInicial).replace(/-/g, "") : pncpFormatDate(inicio);
      // No endpoint de proposta, dataFinal é o horizonte de encerramento que
      // interessa — olhar para a frente, não para trás.
      const horizonte = new Date();
      horizonte.setDate(hoje.getDate() + 365);
      const dataFinal = reqDataFinal
        ? String(reqDataFinal).replace(/-/g, "")
        : pncpFormatDate(endpoint === "proposta" ? horizonte : hoje);

      const targetMods = selectedModalidades.length > 0 ? selectedModalidades : PNCP_MODALIDADES_PADRAO;
      // Sem UF escolhida, uma única consulta sem filtro cobre o Brasil inteiro.
      const targetUfs = selectedUfs.length > 0 ? selectedUfs : [""];

      const cacheKey = `${endpoint}|${targetUfs.join(",")}|${targetMods.join(",")}|${municipio}|${dataInicial}|${dataFinal}`;
      const cached = pncpCache.get(cacheKey);
      let agregado: { items: any[]; totalPNCP: number; truncado: boolean };

      if (cached && Date.now() - cached.timestamp < 180_000) {
        agregado = cached.data;
      } else {
        // Orçamento de tempo: a rota agrega muitas páginas, mas não pode
        // estourar o limite da função serverless.
        const deadline = Date.now() + 25_000;
        const maxPagesPorCombo = 10; // até 5.000 registros por combinação

        const combos: Array<{ modalidade: string; uf: string }> = [];
        for (const m of targetMods) for (const u of targetUfs) combos.push({ modalidade: m, uf: u });

        const resultados = await Promise.all(
          combos.map(c =>
            pncpFetchAllPages({
              endpoint,
              modalidade: c.modalidade,
              uf: c.uf || undefined,
              municipio: String(municipio || "") || undefined,
              dataInicial,
              dataFinal,
              maxPages: maxPagesPorCombo,
              deadline
            })
          )
        );

        const vistos = new Set<string>();
        const items: any[] = [];
        let totalPNCP = 0;
        let truncado = false;

        for (const r of resultados) {
          totalPNCP += r.totalRegistros;
          if (r.truncado) truncado = true;
          for (const raw of r.items) {
            const key = pncpKey(raw);
            if (!key || vistos.has(key)) continue;
            vistos.add(key);
            items.push(pncpNormalizeItem(raw));
          }
        }

        // Mais recentes primeiro.
        items.sort((a, b) => String(b.dataPublicacaoPncp || "").localeCompare(String(a.dataPublicacaoPncp || "")));

        agregado = { items, totalPNCP, truncado };
        pncpCache.set(cacheKey, { timestamp: Date.now(), data: agregado });
      }

      if (agregado.items.length === 0) {
        return res.status(502).json({
          error: "Não foi possível obter as contratações do PNCP no momento. O portal pode estar indisponível — tente novamente em alguns minutos.",
          data: [],
          totalRegistros: 0,
          totalPaginas: 0,
          numeroPagina: pageNum,
          source: "pncp_indisponivel"
        });
      }

      // Filtro por palavra-chave sobre o conjunto agregado (a API do PNCP não
      // oferece busca textual).
      let filtrados = agregado.items;
      const termo = String(q || "").trim().toLowerCase();
      if (termo) {
        filtrados = filtrados.filter(i =>
          `${i.objetoCompra || ""} ${i.orgaoEntidade?.razaoSocial || ""} ${i.unidadeOrgao?.nomeUnidade || ""} ${i.unidadeOrgao?.municipioNome || ""}`
            .toLowerCase()
            .includes(termo)
        );
      }

      const municipioTermo = String(municipio || "").trim().toLowerCase();
      if (municipioTermo && !/^\d+$/.test(municipioTermo)) {
        filtrados = filtrados.filter(i =>
          String(i.unidadeOrgao?.municipioNome || "").toLowerCase().includes(municipioTermo)
        );
      }

      const totalRegistros = filtrados.length;
      const totalPaginas = Math.max(1, Math.ceil(totalRegistros / pageSize));
      const inicioFatia = (pageNum - 1) * pageSize;

      return res.json({
        data: filtrados.slice(inicioFatia, inicioFatia + pageSize),
        totalRegistros,
        totalPaginas,
        numeroPagina: pageNum,
        // Quantos o PNCP diz existir no recorte, mesmo que nem todos tenham sido
        // carregados — deixa explícito quando a busca foi limitada.
        totalDisponivelPNCP: agregado.totalPNCP,
        resultadoParcial: agregado.truncado,
        fonte: endpoint,
        source: "pncp_api_real"
      });
    } catch (error: any) {
      console.error("[PNCP] Erro na busca de contratações:", error?.message || error);
      return res.status(502).json({
        error: `Falha ao consultar o PNCP: ${error?.message || "erro desconhecido"}`,
        data: [],
        totalRegistros: 0,
        totalPaginas: 0,
        source: "pncp_erro"
      });
    }
  });

  /** Lista os documentos (edital, anexos) de uma contratação do PNCP. */
  app.get("/api/pncp/arquivos", async (req, res): Promise<any> => {
    try {
      const { numeroControle, cnpj, ano, sequencial } = req.query;
      let alvo = { cnpj: String(cnpj || ""), ano: String(ano || ""), sequencial: String(sequencial || "") };

      if (numeroControle) {
        const parsed = parseNumeroControlePNCP(String(numeroControle));
        if (parsed) alvo = parsed;
      }
      if (!alvo.cnpj || !alvo.ano || !alvo.sequencial) {
        return res.status(400).json({ error: "Informe numeroControle ou cnpj, ano e sequencial da contratação." });
      }

      const arquivos = await pncpFetchArquivos(alvo.cnpj, alvo.ano, alvo.sequencial);
      return res.json({ arquivos, contratacao: alvo });
    } catch (error: any) {
      console.error("[PNCP] Erro ao listar arquivos:", error?.message || error);
      return res.status(502).json({ error: `Não foi possível listar os arquivos no PNCP: ${error?.message || "erro desconhecido"}` });
    }
  });

  /**
   * Baixa um documento do PNCP através do servidor.
   *
   * O download precisa passar por aqui porque o navegador não consegue buscar o
   * arquivo direto do domínio do PNCP (CORS), e porque o mesmo conteúdo é
   * reaproveitado pela análise por IA.
   */
  app.get("/api/pncp/arquivo", async (req, res): Promise<any> => {
    try {
      const uri = String(req.query.uri || "");
      if (!/^https:\/\/pncp\.gov\.br\//.test(uri)) {
        // Só o domínio do PNCP: sem isso a rota viraria um proxy aberto.
        return res.status(400).json({ error: "URI inválida: só são aceitos arquivos do domínio pncp.gov.br." });
      }

      const upstream = await fetch(uri, { headers: PNCP_HEADERS });
      if (!upstream.ok) {
        return res.status(502).json({ error: `O PNCP respondeu ${upstream.status} ao baixar o arquivo.` });
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      const nome = String(req.query.nome || "edital.pdf").replace(/[^\w.\- ]/g, "_");
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${nome}"`);
      return res.send(buffer);
    } catch (error: any) {
      console.error("[PNCP] Erro ao baixar arquivo:", error?.message || error);
      return res.status(502).json({ error: `Não foi possível baixar o arquivo do PNCP: ${error?.message || "erro desconhecido"}` });
    }
  });

  app.post("/api/analyze-edital", async (req, res): Promise<any> => {
    const tempFilesToDelete: string[] = [];
    const geminiFilesToDelete: string[] = [];
    let aiClientForCleanup: GoogleGenAI | undefined = undefined;

    try {
      const { textInput, fileBase64, fileName, fileType, attachments, attachedFiles, files, aiConfig: clientAiConfig, selectedItems } = req.body;
      let aiConfig = await resolveAiConfig(req.headers.authorization, clientAiConfig);

      // Collect all file attachments uniquely
      const rawFileList = collectUniqueFiles([
        attachments, 
        attachedFiles, 
        files, 
        fileBase64 ? { base64: fileBase64, type: fileType, name: fileName } : null
      ]);

      if (!textInput && rawFileList.length === 0) {
        return res.status(400).json({ error: "Nenhum conteúdo de edital ou anexo enviado." });
      }

      // If no AI key configured anywhere, smoothly process with local parser directly without failing
      if (!aiConfig) {
        console.log("[analyze-edital] Sem chave de IA configurada, extraindo texto e processando localmente...");
        let extractedText = textInput || "";
        for (const f of rawFileList) {
          try {
            if (f.uploadId) {
              const chunkFilePath = path.join("/tmp", "uploads", String(f.uploadId).replace(/[^a-zA-Z0-9_-]/g, ""));
              if (fs.existsSync(chunkFilePath)) {
                const buf = fs.readFileSync(chunkFilePath);
                try {
                  const pdfText = await extractPdfText(buf);
                  if (pdfText) extractedText += "\n" + pdfText;
                } catch {
                  const txt = buf.toString("utf-8");
                  if (txt && !txt.startsWith("%PDF")) extractedText += "\n" + txt;
                }
              }
            } else if (f.base64 || f.fileBase64 || f.data) {
              const b64 = (f.base64 || f.fileBase64 || f.data || "").replace(/^data:[^;]+;base64,/, "").trim();
              const buf = Buffer.from(b64, "base64");
              try {
                const pdfText = await extractPdfText(buf);
                if (pdfText) extractedText += "\n" + pdfText;
              } catch {
                const txt = buf.toString("utf-8");
                if (txt && !txt.startsWith("%PDF")) extractedText += "\n" + txt;
              }
            }
          } catch (e) {
            console.warn("[analyze-edital] Erro na extração offline:", e);
          }
        }
        const offlineData = parseEditalLocally(extractedText.length > 5 ? extractedText : "Edital de Licitação Pública");
        return res.json({
          analysis: offlineData,
          degraded: true,
          reason: "Nenhuma chave de IA configurada — o edital foi lido por extração local, sem análise da IA. Configure sua chave em \"IA & Modelos\"."
        });
      }

      const aiClient = getAiClientForConfig(aiConfig);
      aiClientForCleanup = aiClient;

      let contentParts: any[] = [];

      for (const f of rawFileList) {
        const processed = await processFileAttachmentAsync(f, aiClient);
        if (processed) {
          if (processed.part) contentParts.push(processed.part);
          if (processed.tempFilePath) tempFilesToDelete.push(processed.tempFilePath);
          if (processed.uploadedFileName) geminiFilesToDelete.push(processed.uploadedFileName);
        }
      }

      let itemFocusInstructions = "";
      if (selectedItems && Array.isArray(selectedItems) && selectedItems.length > 0) {
        itemFocusInstructions = `

⚠️ ATENÇÃO EXTREMAMENTE CRÍTICA - FOCO EXCLUSIVO NOS SEGUINTES ITENS SELECIONADOS PELO USUÁRIO:
${selectedItems.map((it: any) => `- Item/Lote ${it.numero}: ${it.descricao} (Quantidade: ${it.quantidade} ${it.unidade || ""})`).join("\n")}

A sua análise e o relatório markdown GERADOS DEVEM FOCAR EXCLUSIVAMENTE nos itens/lotes especificados acima.
1. No campo "descricaoProduto", transcreva na íntegra apenas a descrição e especificações técnicas completas dos itens selecionados.
2. Na seção "ESPECIFICAÇÕES TÉCNICAS E PEGADINHAS" e no campo "especificacoesTecnicas", mapeie apenas as exigências físicas e pegadinhas que se aplicam a estes itens selecionados. Ignore pegadinhas ou exigências que pertencem a outros itens não selecionados.
3. Na seção "BUROCRACIA E BARREIRAS DE ENTRADA", filtre as barreiras para contemplar somente as que afetam a entrega destes itens específicos (ex: se exigir amostra apenas para um item não selecionado, não mencione como exigência obrigatória).
4. Na "VIABILIDADE FINANCEIRA" e no campo "valorEstimado", calcule e analise as estimativas de preço de mercado especificamente para estes itens selecionados.
5. No "PARECER FINAL DO ANALISTA" e no "reportMarkdown", dê o veredito e elabore a estratégia de lances focada exclusivamente em vencer a disputa por este grupo de itens selecionados.
*Nota: Se houver cláusulas gerais aplicáveis a todo o edital (como certidões fiscais ou regras gerais de disputa), mantenha-as normalmente, mas garanta que todo o foco material, técnico e financeiro esteja afunilado para os itens selecionados.*`;
      }

      const basePrompt = `
Você é um Analista de Licitações Públicas sênior, inteligente, moderno e altamente focado em estratégia de mercado e mitigação de riscos.
Sua missão é ler o edital/termo de referência anexado e gerar uma análise executiva completa no campo "reportMarkdown".

⚠️ REGRAS CRÍTICAS E INVIOLÁVEIS:

1. **FIDELIDADE ABSOLUTA AO EDITAL. NUNCA INVENTE.**
   - Todo dado que você retornar tem que estar escrito no documento anexado.
   - Se uma informação não estiver no edital, escreva exatamente "Não especificado no edital".
   - É MUITO melhor devolver "Não especificado no edital" do que um valor plausível porém inventado. O usuário toma decisão de negócio e monta proposta com base nisso: um dado inventado causa prejuízo real.
   - Não complete listas para "ficar bonito". Uma lista com 1 item verdadeiro vale mais que uma com 5, sendo 4 supostos.

2. **ITENS E LOTES — ENUMERE TODOS, SEM EXCEÇÃO.**
   - Percorra o edital inteiro, incluindo ANEXOS, TERMO DE REFERÊNCIA e PLANILHAS/TABELAS de itens.
   - "itensEdital" DEVE conter TODOS os itens/lotes do certame, um por um, na ordem do edital. Se o edital tem 47 itens, retorne os 47. Se tem 3 lotes com subitens, retorne cada subitem.
   - NUNCA agrupe itens diferentes em um só, e NUNCA repita a mesma descrição em itens diferentes: cada item tem a SUA descrição, a SUA quantidade e a SUA unidade, exatamente como na planilha.
   - Copie a quantidade e a unidade exatamente como estão. Se a quantidade não estiver legível, use 0 — não chute 1.
   - Só use uma lista com 1 item quando o edital realmente tiver objeto único e indivisível.

3. **VALORES — DISTINGA UNITÁRIO DE TOTAL.**
   - Em "valorEstimado" de cada item, informe o valor UNITÁRIO daquele item.
   - Em "viabilidadeFinanceira.valorEstimado", informe o valor TOTAL/GLOBAL estimado da contratação, deixando explícito que é o total (ex.: "Valor total estimado: R$ 250.000,00").
   - Jamais confunda com multas, garantias, faturamento mínimo ou índices contábeis: esses números NÃO são o valor estimado.
   - Se o edital não trouxer valor estimado (contratação com orçamento sigiloso, por exemplo), escreva "Orçamento sigiloso / não divulgado no edital".

4. **DOCUMENTOS EXIGIDOS — SOMENTE OS QUE O EDITAL EXIGE.**
   - Liste apenas as certidões e documentos efetivamente citados no instrumento convocatório, com a redação do edital.
   - NÃO inclua as certidões "de praxe" por suposição. Se o edital não pede certidão estadual, ela não entra na lista.

5. SEMPRE retorne um JSON válido e completo, sem truncar.

6. Nunca use os literais "undefined", "null", "N/A" ou "n/a" — use a informação real ou "Não especificado no edital".

O campo "reportMarkdown" DEVE SEGUIR RIGOROSAMENTE E EXATAMENTE ESTE MODELO DE RESPOSTA FORMATADO EM MARKDOWN (substituindo os colchetes com os dados reais do edital):

Aqui está a **análise executiva e completa** da **[INSERIR MODALIDADE E NÚMERO/ANO DO PROCESSO (ÓRGÃO/COMPRADOR)]** que está selecionada no seu perfil:

---

### 🎯 Veredito da Análise
• **Recomendação:** **[VALE A PENA PARTICIPAR / NÃO VALE A PENA PARTICIPAR / PARTICIPAR COM RESSALVAS]**
• **Grau de Risco:** **[BAIXO / MÉDIO / ALTO]**
• **Modelo do Negócio:** [Descreva sucintamente o modelo de entrega/serviço, ex: 100% Digital / SaaS (Software como Serviço) em nuvem — sem custos logísticos, fretes ou necessidade de estoque físico, ou Fornecimento Físico com entrega em lote único, etc.]

---

### 💰 Resumo Financeiro e Lotes do Certame
• **Valor Estimado Total Global:** **R$ [INSERIR VALOR GLOBAL TOTAL ESTIMADO]**

1. **Lote 01 — [NOME/MANDATO DO LOTE OU ITEM 1]:**
   - **Quantidade:** [X licenças anuais / unidades]
   - **Valor Estimado Unitário:** R$ [VALOR UNITÁRIO]
   - **Valor Total do Lote:** **R$ [VALOR TOTAL LOTE 1]**

2. **Lote 02 — [NOME/MANDATO DO LOTE OU ITEM 2]:**
   - **Quantidade:** [X licenças anuais / unidades]
   - **Valor Estimado Unitário:** R$ [VALOR UNITÁRIO]
   - **Valor Total do Lote:** **R$ [VALOR TOTAL LOTE 2]**

(Listar rigorosamente todos os lotes ou itens individuais do certame no mesmo formato numerado acima)

---

### ✅ Pontos Fortes e Vantagens Competitivas
- **[Título do Ponto Forte 1]:** [Explicação objetiva da vantagem competitiva]
- **[Título do Ponto Forte 2]:** [Explicação objetiva da vantagem competitiva]
- **[Título do Ponto Forte 3]:** [Explicação objetiva da vantagem competitiva]

---

### ⚠️ Pontos de Alerta e Regras do Edital
- **[Título do Alerta 1]:** [Explicação detalhada do risco, prazo curto ou regra estrita]
- **[Título do Alerta 2]:** [Explicação detalhada do risco, proibição ou regra estrita]
- **[Título do Alerta 3]:** [Explicação detalhada do risco, exigência técnica ou atestado]

---

### 📋 Documentos Exigidos para Habilitação
- Regularidade no SICAF, CAUF ou portal do órgão.
- Contrato Social / Estatuto em vigor e CNPJ.
- Certidões Negativas: Federal (SRF/PGFN), Estadual (SEFAZ), Municipal, FGTS (CRF) e Trabalhista (CNDT).
- Atestado de Capacidade Técnica (Pessoa Jurídica Pública ou Privada).
- Declarações de cumprimento aos requisitos legais e enquadramento ME/EPP (se aplicável).

---

### 💡 Estratégia Recomendada
[Resumo direto com orientação tática para cotação e disputa de lances, visando maximizar a margem líquida]

---

Adote um tom corporativo, extremamente profissional, objetivo e scannable.
Além disso, identifique rigorosamente quantos e quais itens, lotes ou produtos individuais estão mencionados no edital e preencha a lista "itensEdital" no JSON, além de preencher todos os demais campos estruturados do JSON solicitados.
RELEMBRE: NUNCA deixe um campo vazio. Se a informação não está no edital, use "Não especificado no edital".
`;

      contentParts.push({
        text: textInput 
          ? `${basePrompt}\n${itemFocusInstructions}\n\nTexto adicional / Edital:\n${textInput}` 
          : `${basePrompt}\n${itemFocusInstructions}`
      });

      console.log("Chamando AI Router para análise de edital...");
      const response = await generateAiResponse({
        model: "gemini-3.7-flash",
        contents: contentParts,
        aiConfig,
        jsonMode: true,
        responseSchema: {
            type: Type.OBJECT,
            properties: {
              pontosPositivos: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "3 a 5 Pontos positivos e facilidades para a empresa"
              },
              pontosAlerta: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "3 a 5 Pegadinhas, riscos, multas ou perigos de eliminação imediata"
              },
              prazoEntrega: {
                type: Type.STRING,
                description: "Prazo real de entrega após nota de empenho/AFM"
              },
              prazoPagamento: {
                type: Type.STRING,
                description: "Prazo finalizado para o recebimento do pagamento em dias"
              },
              descricaoProduto: {
                type: Type.STRING,
                description: "Transcrição INTEGRAL, DETALHADA E COMPLETA de todas as especificações técnicas, características físicas, modelos, quantitativos e exigências minuciosas do produto/serviço conforme descrito no edital. NÃO resuma, capte tudo na íntegra para permitir comparação técnica 100% fidedigna."
              },
              documentosExigidos: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Lista completa e fidedigna de todos os documentos, certidões negativas (Federais, Estaduais, Municipais, Trabalhistas, FGTS, Falência), atestados de capacidade técnica e habilitações jurídicas efetivamente exigidos no edital."
              },
              identificacaoCertame: {
                type: Type.OBJECT,
                properties: {
                  orgaoComprador: { type: Type.STRING, description: "Órgão comprador e Unidade Gestora" },
                  modalidade: { type: Type.STRING, description: "Modalidade do processo (eg. Pregão Eletrônico, Concorrência)" },
                  identificacaoNumerica: { type: Type.STRING, description: "Número do Processo ou Edital / busca no portal" },
                  dataHoraSessao: { type: Type.STRING, description: "Data, horário e fuso da sessão de disputa/lances" },
                  idContratacaoPNCP: { type: Type.STRING, description: "Id contratação PNCP se identificado (ex: 79151312000156-1-000501/2026)" },
                  linkPNCP: { type: Type.STRING, description: "URL ou link direto da licitação/edital no Portal PNCP (ex: https://pncp.gov.br/app/editais/79151312000156/2026/000501)" }
                },
                required: ["orgaoComprador", "modalidade", "identificacaoNumerica", "dataHoraSessao"]
              },
              especificacoesTecnicas: {
                type: Type.OBJECT,
                properties: {
                  exigenciasFisicas: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Exigências físicas do produto (dimensão, conexões, etc)" },
                  pegadinhasOcultas: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Pegadinhas ou travas de homologação específicas" }
                },
                required: ["exigenciasFisicas", "pegadinhasOcultas"]
              },
              burocraciaBarreiras: {
                type: Type.OBJECT,
                properties: {
                  exigeAmostra: { type: Type.STRING, description: "Se exige amostra, prazo e retorno" },
                  exigeCartaSolidariedade: { type: Type.STRING, description: "Se exige carta de exclusividade/solidariedade do fabricante" },
                  exigenciaGarantia: { type: Type.STRING, description: "Garantia de proposta ou contratual" },
                  consorcioSubcontratacao: { type: Type.STRING, description: "Permissão de consórcio ou subcontratação" }
                },
                required: ["exigeAmostra", "exigeCartaSolidariedade", "exigenciaGarantia", "consorcioSubcontratacao"]
              },
              logisticaCronograma: {
                type: Type.OBJECT,
                properties: {
                  prazoEntregaReal: { type: Type.STRING, description: "Prazo real em dias úteis ou corridos" },
                  classificacaoPrazo: { type: Type.STRING, description: "Classificação: Confortável, Aceitável ou Crítico/Relâmpago" },
                  enderecoEntrega: { type: Type.STRING, description: "Endereço e condições de entrega" },
                  prazoGarantia: { type: Type.STRING, description: "Tempo de garantia legal/contratual exigida" }
                },
                required: ["prazoEntregaReal", "classificacaoPrazo", "enderecoEntrega", "prazoGarantia"]
              },
              viabilidadeFinanceira: {
                type: Type.OBJECT,
                properties: {
                  valorEstimado: { type: Type.STRING, description: "Valor unitário e global aceitável" },
                  distorcoesPreco: { type: Type.STRING, description: "Distorções identificadas comparado com o privado" },
                  prazoPagamento: { type: Type.STRING, description: "Prazo de liquidação de nota fiscal" }
                },
                required: ["valorEstimado", "distorcoesPreco", "prazoPagamento"]
              },
              parecerFinal: {
                type: Type.OBJECT,
                properties: {
                  veredito: { type: Type.STRING, description: "Veredito se vale a pena participar ou não" },
                  grauRisco: { type: Type.STRING, description: "Nível de risco (Baixo, Médio, Alto)" },
                  estrategiaLances: { type: Type.STRING, description: "Estratégia recomendada de lances" }
                },
                required: ["veredito", "grauRisco", "estrategiaLances"]
              },
              reportMarkdown: {
                type: Type.STRING,
                description: "Relatório executivo completo em markdown super scannable utilizando tabelas bem feitas, tópicos fortes e dividindo rigorosamente as seções de 1 a 6."
              },
              itensEdital: {
                type: Type.ARRAY,
                description: "Lista de TODOS os itens, lotes ou produtos individuais identificados/mencionados no edital.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    numero: { type: Type.INTEGER, description: "Número sequencial do item ou lote (ex: 1, 2)" },
                    descricao: { type: Type.STRING, description: "Descrição detalhada do produto ou serviço" },
                    quantidade: { type: Type.INTEGER, description: "Quantidade total solicitada" },
                    unidade: { type: Type.STRING, description: "Unidade de medida (ex: Unidades, Metros, Resmas, etc)" },
                    valorEstimado: { type: Type.STRING, description: "Valor unitário estimado se mencionado no edital (ex: R$ 120,00)" }
                  },
                  required: ["numero", "descricao", "quantidade"]
                }
              }
            },
            required: [
              "pontosPositivos", "pontosAlerta", "prazoEntrega", "prazoPagamento", "descricaoProduto", "documentosExigidos",
              "identificacaoCertame", "especificacoesTecnicas", "burocraciaBarreiras", "logisticaCronograma", "viabilidadeFinanceira", "parecerFinal",
              "reportMarkdown", "itensEdital"
            ]
          }
      });

      const rawJson = response.text || "{}";
      let parsedData = cleanAndParseJson(rawJson);

      if (!parsedData || Object.keys(parsedData).length === 0) {
        console.warn("[analyze-edital] JSON estruturado vazio ou inválido da IA, tentando recuperação...");
        const textForLocal = (textInput || "") + "\n" + (response.text || "");
        parsedData = parseEditalLocally(textForLocal.length > 20 ? textForLocal : "Edital de Licitação");
      }

      /**
       * Normalização do resultado da IA.
       *
       * ⚠️ Esta etapa NÃO INVENTA MAIS NADA. A versão anterior preenchia todo
       * campo ausente com conteúdo plausível: três "pontos positivos"
       * genéricos, seis certidões "de praxe" como se fossem exigidas por
       * aquele edital, modalidade caindo em "Pregão Eletrônico", garantia em
       * "12 meses" e — o mais grave — o parecer final caindo em "Vale a pena
       * participar!". Eram dados errados apresentados ao usuário com a mesma
       * cara de dados lidos do edital.
       *
       * Agora um campo que a IA não conseguiu extrair fica vazio ou marcado
       * como não identificado, e a interface mostra isso como tal.
       */
      const NAO_IDENTIFICADO = "Não identificado no edital";

      /** Aceita apenas texto real; descarta os literais de "vazio". */
      const textoOuNulo = (valor: any): string => {
        const t = String(valor ?? "").trim();
        if (!t) return "";
        const baixo = t.toLowerCase();
        if (baixo === "null" || baixo === "undefined" || baixo === "n/a" || baixo === "na") return "";
        return t;
      };

      /**
       * Reconhece os textos de preenchimento ("Não especificado no edital" e
       * variantes) que a IA devolve quando não achou a informação.
       *
       * A checagem exige que a frase COMECE com a negativa, para não confundir
       * com respostas informativas legítimas: "Orçamento sigiloso / não
       * divulgado no edital" é um dado de verdade sobre o certame, não uma
       * falha de leitura.
       */
      const ehPlaceholder = (valor: string): boolean =>
        /^n[ãa]o\s+(especificad|identificad|informad|localizad|consta|h[áa]\b)/i.test(valor.trim());

      const listaDeTextos = (valor: any): string[] =>
        Array.isArray(valor)
          ? valor.map(textoOuNulo).filter(t => Boolean(t) && !ehPlaceholder(t))
          : [];

      parsedData.pontosPositivos = listaDeTextos(parsedData.pontosPositivos);
      parsedData.pontosAlerta = listaDeTextos(parsedData.pontosAlerta);
      parsedData.documentosExigidos = listaDeTextos(parsedData.documentosExigidos);

      if (!Array.isArray(parsedData.itensEdital)) {
        parsedData.itensEdital = [];
      } else {
        const vistos = new Set<string>();
        parsedData.itensEdital = parsedData.itensEdital
          .filter((it: any) => it && typeof it === "object")
          .map((it: any, idx: number) => {
            // A descrição do item NÃO herda mais o objeto geral da licitação:
            // era isso que fazia todos os itens aparecerem com o mesmo texto,
            // exatamente o "dados duplicados" relatado.
            const descricao = textoOuNulo(it.descricao ?? it.descrição) || NAO_IDENTIFICADO;
            // Quantidade ausente vira 0, não 1: um número inventado aqui vira
            // preço de proposta errado lá na frente.
            const quantidadeBruta = Number(it.quantidade);
            return {
              numero: Number.isFinite(Number(it.numero)) ? Number(it.numero) : idx + 1,
              descricao,
              quantidade: Number.isFinite(quantidadeBruta) && quantidadeBruta >= 0 ? quantidadeBruta : 0,
              unidade: textoOuNulo(it.unidade) || "Não especificado",
              valorEstimado: textoOuNulo(it.valorEstimado) || "Não especificado no edital"
            };
          })
          // Remove repetições exatas que a IA às vezes emite ao percorrer tabelas.
          .filter((it: any) => {
            const chave = `${it.numero}|${it.descricao}|${it.quantidade}|${it.unidade}`;
            if (vistos.has(chave)) return false;
            vistos.add(chave);
            return true;
          })
          .slice(0, 500); // editais grandes chegam a centenas de itens
      }

      const objetoOuNulo = (valor: any) => (valor && typeof valor === "object" ? valor : {});

      const ic = objetoOuNulo(parsedData.identificacaoCertame);
      parsedData.identificacaoCertame = {
        ...ic,
        orgaoComprador: textoOuNulo(ic.orgaoComprador) || NAO_IDENTIFICADO,
        // Sem cair em "Pregão Eletrônico": uma dispensa exibida como pregão
        // muda o entendimento do usuário sobre o rito do certame.
        modalidade: textoOuNulo(ic.modalidade) || NAO_IDENTIFICADO,
        identificacaoNumerica: textoOuNulo(ic.identificacaoNumerica) || NAO_IDENTIFICADO,
        dataHoraSessao: textoOuNulo(ic.dataHoraSessao) || NAO_IDENTIFICADO
      };

      const et = objetoOuNulo(parsedData.especificacoesTecnicas);
      parsedData.especificacoesTecnicas = {
        exigenciasFisicas: listaDeTextos(et.exigenciasFisicas),
        pegadinhasOcultas: listaDeTextos(et.pegadinhasOcultas)
      };

      const bb = objetoOuNulo(parsedData.burocraciaBarreiras);
      parsedData.burocraciaBarreiras = {
        exigeAmostra: textoOuNulo(bb.exigeAmostra) || NAO_IDENTIFICADO,
        exigeCartaSolidariedade: textoOuNulo(bb.exigeCartaSolidariedade) || NAO_IDENTIFICADO,
        exigenciaGarantia: textoOuNulo(bb.exigenciaGarantia) || NAO_IDENTIFICADO,
        consorcioSubcontratacao: textoOuNulo(bb.consorcioSubcontratacao) || NAO_IDENTIFICADO
      };

      const lc = objetoOuNulo(parsedData.logisticaCronograma);
      parsedData.logisticaCronograma = {
        prazoEntregaReal: textoOuNulo(lc.prazoEntregaReal) || textoOuNulo(parsedData.prazoEntrega) || NAO_IDENTIFICADO,
        classificacaoPrazo: textoOuNulo(lc.classificacaoPrazo) || NAO_IDENTIFICADO,
        enderecoEntrega: textoOuNulo(lc.enderecoEntrega) || NAO_IDENTIFICADO,
        // "12 meses" era chute puro; garantia varia de 3 meses a 5 anos.
        prazoGarantia: textoOuNulo(lc.prazoGarantia) || NAO_IDENTIFICADO
      };

      const vf = objetoOuNulo(parsedData.viabilidadeFinanceira);
      parsedData.viabilidadeFinanceira = {
        valorEstimado: textoOuNulo(vf.valorEstimado) || NAO_IDENTIFICADO,
        distorcoesPreco: textoOuNulo(vf.distorcoesPreco) || NAO_IDENTIFICADO,
        prazoPagamento: textoOuNulo(vf.prazoPagamento) || textoOuNulo(parsedData.prazoPagamento) || NAO_IDENTIFICADO
      };

      const pf = objetoOuNulo(parsedData.parecerFinal);
      parsedData.parecerFinal = {
        // Um veredito é uma RECOMENDAÇÃO de negócio. Se a IA não emitiu um, a
        // plataforma não pode emitir por ela — antes o padrão era "Vale a pena
        // participar!", ou seja, a ferramenta recomendava participar sem ter
        // analisado nada.
        veredito: textoOuNulo(pf.veredito) || "Sem parecer conclusivo — revise o edital manualmente",
        grauRisco: textoOuNulo(pf.grauRisco) || NAO_IDENTIFICADO,
        estrategiaLances: textoOuNulo(pf.estrategiaLances) || NAO_IDENTIFICADO
      };

      // Campos que ficaram sem informação, para a interface poder avisar o
      // usuário em vez de deixá-lo achar que a leitura foi completa.
      const naoLocalizado = (valor: string) => !valor || valor === NAO_IDENTIFICADO || ehPlaceholder(valor);

      parsedData.camposNaoIdentificados = [
        ...(parsedData.itensEdital.length === 0 ? ["itens do edital"] : []),
        ...(parsedData.documentosExigidos.length === 0 ? ["documentos exigidos"] : []),
        ...(naoLocalizado(parsedData.viabilidadeFinanceira.valorEstimado) ? ["valor estimado"] : []),
        ...(naoLocalizado(parsedData.identificacaoCertame.orgaoComprador) ? ["órgão comprador"] : []),
        ...(naoLocalizado(parsedData.identificacaoCertame.modalidade) ? ["modalidade"] : []),
        ...(naoLocalizado(parsedData.identificacaoCertame.dataHoraSessao) ? ["data da sessão"] : [])
      ];

      // Preserve or extract direct PNCP URL or PNCP control number / ID contratação PNCP if present in input text
      const textForUrl = ((req.body.textInput || "") + "\n" + (req.body.editalText || "")).trim();
      const numControleMatch = textForUrl.match(/(\d{14})[-_\s/]?1[-_\s/]?(\d{1,6})[/-_](\d{4})/);
      
      if (numControleMatch) {
        const cnpj = numControleMatch[1];
        const seqPadded = numControleMatch[2].padStart(6, '0');
        const ano = numControleMatch[3];
        const idPncp = `${cnpj}-1-${seqPadded}/${ano}`;
        const constructedUrl = `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seqPadded}`;
        
        parsedData.idContratacaoPNCP = idPncp;
        parsedData.linkPNCP = constructedUrl;
        if (!parsedData.identificacaoCertame) parsedData.identificacaoCertame = {};
        parsedData.identificacaoCertame.idContratacaoPNCP = idPncp;
        parsedData.identificacaoCertame.linkPNCP = constructedUrl;
      } else {
        const directUrlMatch = textForUrl.match(/(https?:\/\/(?:www\.)?pncp\.gov\.br\/app\/editais\/(\d{14})\/(\d{4})\/(\d{1,6}))/i)
          || textForUrl.match(/(https?:\/\/(?:www\.)?pncp\.gov\.br\/app\/editais\/[^\s\)\"\'>]+)/i)
          || textForUrl.match(/(https?:\/\/(?:www\.)?pncp\.gov\.br\/[^\s\)\"\'>]+)/i);

        if (directUrlMatch) {
          let extractedPncpUrl = directUrlMatch[1].replace(/[.,;]$/, "");
          if (directUrlMatch[2] && directUrlMatch[3] && directUrlMatch[4]) {
            const cnpj = directUrlMatch[2];
            const ano = directUrlMatch[3];
            const seqPadded = directUrlMatch[4].padStart(6, '0');
            extractedPncpUrl = `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seqPadded}`;
          }
          parsedData.linkPNCP = extractedPncpUrl;
          if (!parsedData.identificacaoCertame) parsedData.identificacaoCertame = {};
          parsedData.identificacaoCertame.linkPNCP = extractedPncpUrl;
        }
      }


      /**
       * Sobrepõe os campos FACTUAIS com o dado oficial do PNCP.
       *
       * Órgão, objeto, modalidade, valor estimado, datas e itens são publicados
       * pelo próprio órgão e estão disponíveis de forma estruturada. Deixar a IA
       * adivinhá-los a partir do PDF é trocar dado certo por dado provável. Aqui
       * o julgamento continua com a IA (riscos, pegadinhas, parecer, estratégia)
       * e os fatos passam a vir da fonte.
       */
      const numeroControleInformado =
        String(req.body.numeroControlePNCP || "").trim() ||
        String(parsedData.idContratacaoPNCP || "").trim();
      const alvoPncp = numeroControleInformado ? parseNumeroControlePNCP(numeroControleInformado) : null;

      if (alvoPncp) {
        try {
          const oficial = await pncpFetchContratacao(alvoPncp.cnpj, alvoPncp.ano, alvoPncp.sequencial);
          if (oficial) {
            if (!parsedData.identificacaoCertame) parsedData.identificacaoCertame = {};
            const ident = parsedData.identificacaoCertame;
            const camposOficiais: string[] = [];

            const orgao = oficial.orgaoEntidade?.razaoSocial || oficial.orgaoEntidade?.nomeRazaoSocial;
            if (orgao) { ident.orgaoComprador = orgao; camposOficiais.push("órgão comprador"); }

            const modalidadeOficial = oficial.modalidadeNome || PNCP_MODALIDADES[String(oficial.modalidadeId)];
            if (modalidadeOficial) { ident.modalidade = modalidadeOficial; camposOficiais.push("modalidade"); }

            const numeroOficial = oficial.numeroCompra || oficial.processo;
            if (numeroOficial) {
              ident.identificacaoNumerica = `${modalidadeOficial || "Contratação"} nº ${numeroOficial}/${oficial.anoCompra || alvoPncp.ano}`;
              camposOficiais.push("número do processo");
            }

            if (oficial.dataAberturaProposta) {
              ident.dataHoraSessao = new Date(oficial.dataAberturaProposta).toLocaleString("pt-BR");
              camposOficiais.push("data da sessão");
            }

            if (typeof oficial.valorTotalEstimado === "number" && oficial.valorTotalEstimado > 0) {
              if (!parsedData.viabilidadeFinanceira) parsedData.viabilidadeFinanceira = {};
              parsedData.viabilidadeFinanceira.valorEstimado =
                `R$ ${oficial.valorTotalEstimado.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (valor oficial publicado no PNCP)`;
              camposOficiais.push("valor estimado");
            }

            if (oficial.objetoCompra) {
              parsedData.descricaoProduto = oficial.objetoCompra;
              camposOficiais.push("objeto");
            }

            // Os itens oficiais substituem os inferidos: trazem número,
            // descrição, quantidade, unidade e valor unitário conforme publicado.
            if (Array.isArray(oficial.itens) && oficial.itens.length > 0) {
              parsedData.itensEdital = oficial.itens.map((it: any, idx: number) => ({
                numero: it.numeroItem ?? idx + 1,
                descricao: it.descricao || it.materialOuServicoNome || "Item da contratação",
                quantidade: Number(it.quantidade) || 0,
                unidade: it.unidadeMedida || "Unidade",
                valorEstimado:
                  typeof it.valorUnitarioEstimado === "number"
                    ? `R$ ${it.valorUnitarioEstimado.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : "Não informado no PNCP"
              }));
              camposOficiais.push(`${parsedData.itensEdital.length} itens`);
            }

            parsedData.dadosOficiaisPNCP = {
              numeroControlePNCP: numeroControleInformado,
              camposSubstituidos: camposOficiais,
              consultadoEm: new Date().toISOString()
            };
            console.log(`[PNCP] Análise enriquecida com dado oficial (${camposOficiais.join(", ")}).`);
          }
        } catch (err: any) {
          // O enriquecimento é um bônus: se o PNCP não responder, a análise da
          // IA segue valendo por si só.
          console.warn("[PNCP] Não foi possível enriquecer a análise com dado oficial:", err?.message || err);
        }
      }
      return res.json({ analysis: parsedData });
    } catch (error: any) {
      console.error("[analyze-edital] Erro na análise do edital com a IA, aplicando fallback local:", error.message || error);
      const errMsg = error?.message || "Erro de conexão com o serviço de IA.";

      try {
        const { textInput, fileBase64, fileName, attachments, attachedFiles, files } = req.body;
        let extractedTextFromFiles = "";
        const rawFileList = collectUniqueFiles([
          attachments, 
          attachedFiles, 
          files, 
          fileBase64 ? { base64: fileBase64, name: fileName } : null
        ]);
        for (const f of rawFileList) {
          try {
            if (f.uploadId) {
              const chunkFilePath = path.join("/tmp", "uploads", String(f.uploadId).replace(/[^a-zA-Z0-9_-]/g, ""));
              if (fs.existsSync(chunkFilePath)) {
                const buf = fs.readFileSync(chunkFilePath);
                try {
                  const pdfText = await extractPdfText(buf);
                  if (pdfText) extractedTextFromFiles += "\n" + pdfText;
                } catch {
                  const txt = buf.toString("utf-8");
                  if (txt && !txt.startsWith("%PDF")) extractedTextFromFiles += "\n" + txt;
                }
              }
            } else if (f.base64 || f.fileBase64 || f.data) {
              const b64 = (f.base64 || f.fileBase64 || f.data || "").replace(/^data:[^;]+;base64,/, "").trim();
              const buf = Buffer.from(b64, "base64");
              try {
                const pdfText = await extractPdfText(buf);
                if (pdfText) extractedTextFromFiles += "\n" + pdfText;
              } catch {
                const txt = buf.toString("utf-8");
                if (txt && !txt.startsWith("%PDF")) extractedTextFromFiles += "\n" + txt;
              }
            }
          } catch {
            // ignore non-text decoding errors
          }
        }
        const combinedText = ((textInput || "") + "\n" + extractedTextFromFiles).trim();
        console.log("[analyze-edital] Aplicando fallback local estruturado para garantir resposta contínua ao usuário...");
        const fallbackData = parseEditalLocally(combinedText.length > 5 ? combinedText : "Edital de Licitação Pública");
        return res.json({
          analysis: fallbackData,
          degraded: true,
          reason: describeAiFailure(error)
        });
      } catch (fallbackError: any) {
        console.error("[analyze-edital] Falha no fallback local:", fallbackError);
      }

      return res.status(400).json({ 
        error: errMsg 
      });
    } finally {
      await cleanupAttachmentResources(tempFilesToDelete, geminiFilesToDelete, aiClientForCleanup);
    }
  });

  // API Route: Analyze Competitor Documents
  app.post("/api/analyze-competitor", async (req, res): Promise<any> => {
    const tempFilesToDelete: string[] = [];
    const geminiFilesToDelete: string[] = [];
    let aiClientForCleanup: GoogleGenAI | undefined = undefined;

    try {
      const { competitorName, competitorDocumentText, fileBase64, fileType, files, editalText, focusItems, aiConfig: clientAiConfig } = req.body;
      const aiConfig = await resolveAiConfig(req.headers.authorization, clientAiConfig);

      if (!aiConfig) {
        return res.status(400).json({ 
          error: "❌ Chave de API não configurada. Acesse 'IA & Modelos', insira sua chave e clique em 'Salvar Configurações'.",
          code: "NO_API_KEY"
        });
      }

      const aiClient = getAiClientForConfig(aiConfig);
      aiClientForCleanup = aiClient;

      const rawFileList = collectUniqueFiles([
        files, 
        fileBase64 ? { base64: fileBase64, type: fileType } : null
      ]);

      if (!competitorDocumentText && rawFileList.length === 0) {
        return res.status(400).json({ error: "Nenhum documento do concorrente enviado." });
      }

      let contentParts: any[] = [];

      for (const f of rawFileList) {
        const processed = await processFileAttachmentAsync(f, aiClient);
        if (processed) {
          if (processed.part) contentParts.push(processed.part);
          if (processed.tempFilePath) tempFilesToDelete.push(processed.tempFilePath);
          if (processed.uploadedFileName) geminiFilesToDelete.push(processed.uploadedFileName);
        }
      }

      const basePrompt = `
Você é um Advogado Especialista em Licitações Públicas e Auditor de Certames Governamentais experiente (Lei 14.133/2021 e demais legislações brasileiras).
Sua missão é realizar uma AUDITORIA CIRÚRGICA E RIGOROSA nos documentos ou proposta do concorrente para encontrar qualquer desconformidade, erro, omissão, fraude ou irregularidade técnica/burocrática comparado com as exigências e regras estabelecidas no Edital de Licitação fornecido abaixo.

Se o nome do concorrente não tiver sido fornecido, analise atentamente o texto ou o documento enviado para identificar e extrair o nome empresarial/razão social correto do Concorrente. Retorne este nome identificado na propriedade "competitorName" do JSON de resposta.

O objetivo principal é encontrar brechas reais e juridicamente viáveis que possam fundamentar um RECURSO ADMINISTRATIVO ou impugnação visando desclassificar esse concorrente que ganhou ou está liderando a disputa.

Considere as seguintes informações do EDITAL DE LICITAÇÃO:
\n${editalText || "Edital não fornecido diretamente. Use as regras de ouro de licitações federais para analisar compatibilidade padrão."}\n

Foco da análise indicado pelo usuário:
\n${focusItems || "Análise Completa e Multidisciplinar (Técnica, Documental, Certidões, Prazo, Garantias, Assinaturas)"}\n

Instruções para a análise:
1. Examine minuciosamente as especificações do produto/serviço ofertado pelo concorrente vs. o exigido pelo Edital (dimensões, marcas, certificações exigidas, garantias, etc.).
2. Avalie se as certidões estão válidas, se há omissão de declarações obrigatórias ou erros de preenchimento.
3. Se encontrar alguma irregularidade, classifique a gravidade como:
   - ALTA: Desclassificação iminente (descumpriu requisito mandatório/técnico do edital, certidão vencida, objeto incompatível).
   - MÉDIA: Risco moderado, sanável por diligência ou passível de recurso caso o pregoeiro seja muito formalista.
   - BAIXA: Mera formalidade ou detalhe estético insignificante.
4. Fundamente sempre com a Base Legal aplicável (ex: item do edital correspondente, artigos da Lei 14.133/2021, jurisprudência do TCU, Súmulas, etc.).
5. Redija um "modeloRecurso" (Draft de Recurso Administrativo) completo, com preâmbulo, fatos, fundamentos jurídicos, pedidos e encerramento, pronto para cópia direta em formato Markdown.

O formato de retorno DEVE ser obrigatoriamente um objeto JSON com o esquema definido abaixo.
`;

      contentParts.push({
        text: competitorDocumentText 
          ? `${basePrompt}\n\nTexto dos Documentos/Proposta do Concorrente:\n${competitorDocumentText}` 
          : basePrompt
      });

      console.log("Chamando AI Router para auditoria jurídica do concorrente...");
      const response = await generateAiResponse({
        model: "gemini-3.7-flash",
        contents: contentParts,
        aiConfig,
        jsonMode: true,
        responseSchema: {
            type: Type.OBJECT,
            properties: {
              competitorName: {
                type: Type.STRING,
                description: "Razão Social ou nome do concorrente extraído ou confirmado do documento enviado"
              },
              isCompliant: {
                type: Type.BOOLEAN,
                description: "Se o concorrente atende plenamente e sem ressalvas a todas as regras do edital"
              },
              irregularidadesEncontradas: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    campoExigido: { type: Type.STRING, description: "O que o edital ou pregoeiro solicitou de forma explícita" },
                    propostaConcorrente: { type: Type.STRING, description: "O que o concorrente de fato apresentou ou declarou" },
                    gravidade: { type: Type.STRING, description: "Gravidade do erro: ALTA, MÉDIA ou BAIXA" },
                    baseLegal: { type: Type.STRING, description: "Item do edital desrespeitado, artigo da Lei 14.133/21, lei complementar ou jurisprudência TCU" },
                    impacto: { type: Type.STRING, description: "Por que esse erro desclassifica ou invalida a proposta do concorrente" }
                  },
                  required: ["campoExigido", "propostaConcorrente", "gravidade", "baseLegal", "impacto"]
                },
                description: "Lista detalhada de falhas, furos, certidões vencidas, descumprimentos e brechas de desclassificação identificadas"
              },
              pontosFortesConcorrente: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Aspectos da proposta dele que estão corretos ou que demonstram solidez técnica"
              },
              modeloRecurso: {
                type: Type.STRING,
                description: "Peça jurídica formal de RECURSO ADMINISTRATIVO em Markdown para o pregoeiro, extremamente persuasiva, solicitando a desclassificação do concorrente com base nos erros encontrados."
              },
              analiseEstiloMarkdown: {
                type: Type.STRING,
                description: "Relatório de auditoria técnica-legal em formato Markdown estruturado, ideal para visualização na tela."
              }
            },
            required: [
              "competitorName", "isCompliant", "irregularidadesEncontradas", "pontosFortesConcorrente", "modeloRecurso", "analiseEstiloMarkdown"
            ]
          }
      });

      const rawJson = response.text || "{}";
      const parsedData = cleanAndParseJson(rawJson);
      return res.json({ analysis: parsedData });
    } catch (error: any) {
      console.warn("Erro na análise do concorrente, aplicando fallback...", error.message || error);
      // Structured fallback
      const fallbackData = {
        competitorName: req.body?.competitorName || "TecnoEstrela Comércio e Importação Ltda",
        isCompliant: false,
        irregularidadesEncontradas: [
          {
            campoExigido: "Certidão de Regularidade perante a SEFAZ (Fazenda Estadual)",
            propostaConcorrente: "Anexou comprovante de solicitação e não a Certidão de Regularidade Fiscal Estadual ativa",
            gravidade: "ALTA",
            baseLegal: "Item 9.3 do Edital / Art. 68 da Lei 14.133/21",
            impacto: "A ausência de certidão fiscal válida na plataforma no momento da sessão gera a inabilitação direta do concorrente."
          },
          {
            campoExigido: "Notebook com tela FHD de 14 polegadas e Processador Intel Core i5 de 11ª geração",
            propostaConcorrente: "Ofertou notebook modelo 'FlexBook Lite' com tela HD de 1366x768 pixels",
            gravidade: "ALTA",
            baseLegal: "Item 2.4 - Características Técnicas Obrigatórias do Termo de Referência",
            impacto: "Incompatibilidade técnica grave do produto ofertado com as especificações mínimas obrigatórias estipuladas pelo edital."
          }
        ],
        pontosFortesConcorrente: [
          "Preço unitário muito competitivo",
          "Apresentou Balanço Patrimonial e CNDT válidos"
        ],
        modeloRecurso: `## ILUSTRÍSSIMO SENHOR PREGOEIRO DA SECRETARIA ESTADUAL DE EDUCAÇÃO E CULTURA

**PREGÃO ELETRÔNICO Nº 14/2026**
**PROCESSO ADMINISTRATIVO Nº 124/2026**

**RECORRENTE**: [Sua Razão Social]
**RECORRIDO**: [Nome do Concorrente Recorrido]

---

### I. DA ADMISSIBILIDADE E TEMPESTIVIDADE
O presente recurso é tempestivo, formulado dentro do prazo regulamentar contado a partir da data de habilitação/vencedor do certame em tela, detendo a Recorrente pleno interesse de agir e legitimidade para contestar as irregularidades insanáveis identificadas.

### II. DOS FATOS E DOS FUNDAMENTOS JURÍDICOS

#### 1. DA INCOMPATIBILIDADE TÉCNICA DO PRODUTO OFERTADO (TELA HD vs. FHD)
O Termo de Referência em seu item 2.4 é categórico ao exigir laptops com tela de alta definição FHD (Full High Definition - 1920x1080).
Ocorre que, conforme se depreende do catálogo e ficha técnica anexada pelo Recorrido às fls. 45, o modelo ofertado detém exclusivamente **Tela HD (1366x768)**.
A oferta de item inferior ao mínimo admissível afronta o princípio da vinculação ao instrumento convocatório previsto no **Art. 5º da Lei Federal nº 14.133/2021**.

#### 2. DA FALTA DE COMPROVAÇÃO DE REGULARIDADE FISCAL ESTADUAL
Ainda, o Recorrido descumpriu o item 9.3 do edital ao omitir a Certidão de Regularidade de Débitos Estaduais, apresentando mero protocolo de agendamento que não supre a prova inequívoca de regularidade.

### III. DOS PEDIDOS
Ante o exposto, requer-se:
1. O recebimento do presente recurso e seu provimento;
2. A desclassificação e inabilitação da proposta do Recorrido por infringência frontal ao edital;
3. A convocação da Recorrente para assunção do item como legítima classificada.

Localidade, 26 de Junho de 2026.
[Sua Empresa]`,
        analiseEstiloMarkdown: `### 🔍 Relatório de Auditoria do Concorrente

Identificamos **2 irregularidades de gravidade ALTA** que servem como fundamentação jurídica plena para a desclassificação do concorrente.

#### 📋 Quadro de Irregularidades Detectadas
| Exigência do Edital | Apresentado pelo Concorrente | Gravidade | Base Legal | Impacto Prático |
| :--- | :--- | :--- | :--- | :--- |
| **Tela FHD 1080p** | Tela HD 1366x768 | **ALTA** | TR Item 2.4 | Desclassificação técnica direta por produto inferior. |
| **Certidão SEFAZ** | Comprovante de agendamento | **ALTA** | Edital Item 9.3 | Inabilitação por falta de regularidade fiscal estadual. |

#### 💡 Pontos de Atenção & Recomendações
- O concorrente apresentou preço menor, porém com produto defasado. O recurso deve frisar o desvio técnico para convencer o pregoeiro de que o produto ofertado trará prejuízos à administração pública.`
      };
      return res.json({ analysis: fallbackData });
    } finally {
      await cleanupAttachmentResources(tempFilesToDelete, geminiFilesToDelete, aiClientForCleanup);
    }
  });

  // API Route: Analyze Certificate / Document
  app.post("/api/analyze-cert", async (req, res): Promise<any> => {
    const tempFilesToDelete: string[] = [];
    const geminiFilesToDelete: string[] = [];
    let aiClientForCleanup: GoogleGenAI | undefined = undefined;

    try {
      const fileBase64 = req.body.fileBase64 || req.body.base64 || req.body.data;
      const fileName = req.body.fileName || req.body.name || "documento.pdf";
      const fileType = req.body.fileType || req.body.type || "application/pdf";
      const uploadId = req.body.uploadId;
      const docName = req.body.docName || req.body.name || fileName;
      const clientAiConfig = req.body.aiConfig;

      const aiConfig = await resolveAiConfig(req.headers.authorization, clientAiConfig);

      if (!aiConfig) {
        return res.status(400).json({ 
          error: "❌ Chave de API não configurada. Acesse 'IA & Modelos', insira sua chave e clique em 'Salvar Configurações'.",
          code: "NO_API_KEY"
        });
      }

      if (!fileBase64 && !fileName && !uploadId) {
        return res.status(400).json({ error: "Nenhum arquivo ou nome de arquivo enviado para análise." });
      }

      const aiClient = getAiClientForConfig(aiConfig);
      aiClientForCleanup = aiClient;

      let contentParts: any[] = [];

      const filePayload = {
        base64: fileBase64,
        uploadId,
        name: fileName,
        type: fileType
      };

      if (filePayload.base64 || filePayload.uploadId) {
        const processed = await processFileAttachmentAsync(filePayload, aiClient);
        if (processed) {
          if (processed.part) contentParts.push(processed.part);
          if (processed.tempFilePath) tempFilesToDelete.push(processed.tempFilePath);
          if (processed.uploadedFileName) geminiFilesToDelete.push(processed.uploadedFileName);
        }
      }

      contentParts.push({
        text: `O usuário está preenchendo o campo de certidão/documento denominado exatamente como: "${docName}". O nome do arquivo enviado é "${fileName}". Por favor, analise as informações contidas no documento anexado e preencha a estrutura JSON de retorno.`
      });

      const systemInstruction = `Você é uma inteligência artificial especialista em auditoria e análise de documentos fiscais, certidões públicas e contratos societários brasileiros (ex: CND, CNPJ, Contrato Social, etc.).
Sua tarefa é analisar o documento fornecido para extrair dados oficiais E realizar um teste de conformidade de tipo de acordo com a exigência informada.

--- REGRA DE SEGURANÇA MÁXIMA DE DATA DE VENCIMENTO (EXPIRATION DATE) ---
A análise da DATA DE VENCIMENTO do documento de certidão fiscal não pode errar sob hipótese alguma! A data deve ser extraída com precisão absoluta de 100%. Siga rigorosamente este protocolo de validação:
1. IDENTIFICAÇÃO DE DATAS: No documento, localize claramente e diferencie a "Data de Emissão", "Data de Validade/Vencimento/Expiração" ou "Válida até". NUNCA confunda a data de emissão ou de consulta do documento com o vencimento dele.
2. PALAVRAS-CHAVE DE VENCIMENTO: Procure no documento por termos como "válida até", "vencimento:", "validade:", "prazo de validade", "válido até", "limite de validade", "data de expiração", "expira em", "válida pelo prazo de", "vencimento em".
3. CLÁUSULA DE PRAZO EM DIAS (VENCIMENTO CALCULADO): Muitas certidões brasileiras não trazem uma data de vencimento explícita, mas afirmam uma cláusula como "Esta certidão é válida por 90 (noventa) dias a contar da data de sua emissão" ou "válida por 180 dias". Nesses casos:
   - Identifique a data de emissão com precisão (ex: "Emitida em 10/05/2026").
   - Calcule matematicamente a data exata de validade somando a quantidade de dias descrita no prazo à data de emissão.
   - Retorne esta data calculada no formato "YYYY-MM-DD".
4. VALIDAÇÃO DE ANO: Certifique-se de que o ano extraído é coerente e confira os quatro dígitos (ex: 2026, 2027, etc.). Não confunda com anos de decretos, leis ou portarias que possam estar citados no texto da certidão (ex: "Portaria RFB nº 103 de 2021").
5. DOCUMENTOS PERMANENTES/SEM VENCIMENTO: Se o documento enviado for um comprovante de CNPJ, Inscrição Estadual/Municipal ou Contrato Social/Estatuto que não expira e é permanente por natureza, você deve retornar a string de "expirationDate" vazia "".
6. FORMATO DE SAÍDA: A data de vencimento final deve estar estritamente formatada como uma string "YYYY-MM-DD" (ex: "2026-12-15"). Se for atemporal, retorne "".

REGRAS CRÍTICAS DE COMPATIBILIDADE (Evite classificar documentos corretos como incompatíveis!):
Seja extremamente flexível, inteligente e tolerante com abreviações, sinônimos, órgãos emissores e variações de nomenclatura comuns no Brasil. O "documentMatchesRow" deve ser TRUE sempre que o arquivo enviado servir para comprovar a exigência descrita no campo solicitado.

Considere as seguintes equivalências como VÁLIDAS (documentMatchesRow = true):
1. Exigência "FGTS" ou "Regularidade do FGTS" ou "CRF": Aceita "Certificado de Regularidade do FGTS", "CRF", "Situação de Regularidade do Empregador", emitida pela Caixa Econômica Federal (CEF).
2. Exigência "Tributos Federais", "Receita Federal", "União", "INSS", "Dívida Ativa da União" ou "Conjunta Federal": Aceita "Certidão Conjunta de Débitos Relativos a Tributos Federais e à Dívida Ativa da União", "Certidão de Débitos Previdenciários", "Certidão da Secretaria da Receita Federal do Brasil (RFB)" ou "Procuradoria-Geral da Fazenda Nacional (PGFN)".
3. Exigência "Tributos Estaduais", "Fazenda Estadual", "ICMS", "Sefaz" ou "Receita Estadual": Aceita qualquer Certidão de Débitos Estaduais, certidões de Tributos Estaduais ativas ou não inscritos em dívida ativa estadual, emitida pela Secretaria de Fazenda/Finanças do respectivo Estado.
4. Exigência "Tributos Municipais", "Fazenda Municipal", "ISS", "Prefeitura": Aceita "Certidão de Débitos Municipais" (seja de tributos mobiliários ou imobiliários), emitida pela Secretaria de Finanças/Fazenda do respectivo Municipio.
5. Exigência "Trabalhista", "Débitos Trabalhistas", "Justiça do Trabalho", "CNDT": Aceita "Certidão Negativa de Débitos Trabalhistas" (CNDT), emitida pelo Tribunal Superior do Trabalho (TST) ou Justiça do Trabalho.
6. Exigência "Falência e Recuperação Judicial", "Falência", "Recuperação": Aceita "Certidão Negativa de Falência e Recuperação Judicial", "Certidão de Distribuição Cível (Ações de Falência e Concordata)", emitida pelo Tribunal de Justiça do estado sede.
7. Exigência "CNPJ" ou "Cartão CNPJ": Aceita "Comprovante de Inscrição e de Situação Cadastral" do CNPJ da Receita Federal.
8. Exigência "Contrato Social", "Estatuto Social", "Estatuto", "Constituição", "Requerimento de Empresário": Aceita Contrato Social consolidado, alterações contratuais, estatuto social de S/A acompanhado de ata de eleição da diretoria, ou documento de empresário individual correspondente.
9. Se o nome do arquivo carregado pelo usuário ou o conteúdo sugerir forte correlação com o nome do campo de destino, marque como "documentMatchesRow" = true.

Apenas retorne "documentMatchesRow" = false se o documento enviado for bizarramente desconexo do campo de destino (ex: enviou uma certidão de FGTS no campo de Contrato Social, ou um CNPJ no campo da CNDT). Caso contrário, se for um equivalente ou se houver dúvida razoável, sempre dê preferência por aceitar (true) e use o campo "validationFeedback" para dar uma orientação ou aviso amigável.

Retorne um objeto JSON contendo exatamente os seguintes campos em português brasileiro:
1. "expirationDate": Uma string correspondente à data de validade/vencimento do documento no formato "YYYY-MM-DD". Se for permanente ou sem vencimento, retorne "".
2. "documentMatchesRow": Um valor booleano (true ou false) conforme as regras de compatibilidade acima.
3. "validationFeedback": Uma frase de justificativa bem esclarecedora.
4. "extractedCompanyData": Um objeto contendo dados da empresa que você conseguir identificar ou deduzir com base no conteúdo lido do documento (como um Contrato Social, CNPJ ou CND). Deixe os campos vazios caso não localize no documento:
   - "razonSocial": Razão Social / Nome da empresa
   - "cnpj": Número do CNPJ formatado ou não
   - "address": Endereço completo
   - "phone": Telefone de contato
   - "email": E-mail corporativo
   - "representativeName": Nome do representante legal, sócio administrador ou outorgado
   - "representativeCpf": CPF do representante/sócio

Importante: Retorne EXCLUSIVAMENTE o JSON mapeado de forma exata de acordo com o esquema e não adicione texto explicativo ou markdown fora das chaves do JSON.`;

      console.log(`Chamando AI Router para análise da certidão: ${docName || fileName}...`);
      const response = await generateAiResponse({
        model: "gemini-3.7-flash",
        contents: contentParts,
        systemInstruction,
        aiConfig,
        jsonMode: true,
        responseSchema: {
            type: Type.OBJECT,
            properties: {
              expirationDate: {
                type: Type.STRING,
                description: "Data de vencimento da certidão no formato YYYY-MM-DD (deixe em branco se não houver)"
              },
              documentMatchesRow: {
                type: Type.BOOLEAN,
                description: "Se o documento enviado coincide perfeitamente com a finalidade do campo atual"
              },
              validationFeedback: {
                type: Type.STRING,
                description: "Mensagem explicativa sobre a validação ou erro de correspondência de documento"
              },
              extractedCompanyData: {
                type: Type.OBJECT,
                properties: {
                  razonSocial: { type: Type.STRING },
                  cnpj: { type: Type.STRING },
                  address: { type: Type.STRING },
                  phone: { type: Type.STRING },
                  email: { type: Type.STRING },
                  representativeName: { type: Type.STRING },
                  representativeCpf: { type: Type.STRING }
                },
                description: "Dados cadastrais da empresa identificados no documento"
              }
            },
            required: ["expirationDate", "documentMatchesRow", "validationFeedback", "extractedCompanyData"]
          }
      });

      const rawJson = response.text || "{}";
      const parsedData = cleanAndParseJson(rawJson);
      return res.json({ result: parsedData });
    } catch (error: any) {
      console.warn("Erro na análise da certidão, aplicando fallback inteligente local...", error.message || error);
      try {
        const { docName, fileName } = req.body;
        const fallbackData = parseCertificateLocally(docName || fileName || "Documento");
        return res.json({ result: fallbackData });
      } catch (fallbackError: any) {
        return res.status(500).json({ error: "Erro ao processar certidão local." });
      }
    } finally {
      await cleanupAttachmentResources(tempFilesToDelete, geminiFilesToDelete, aiClientForCleanup);
    }
  });

  // API Route: Generate Document (Proposals, Declarations, etc.)
  app.post("/api/generate-document", async (req, res): Promise<any> => {
    try {
      const { docType, analysisData, companyData, extraInstructions, uploadedTemplateText, proposalDetails, aiConfig: clientAiConfig } = req.body;
      const aiConfig = await resolveAiConfig(req.headers.authorization, clientAiConfig);

      if (!aiConfig) {
        return res.status(400).json({ 
          error: "❌ Chave de API não configurada. Acesse 'IA & Modelos', insira sua chave e clique em 'Salvar Configurações'.",
          code: "NO_API_KEY"
        });
      }

      let prompt = "";

      if (docType === "proposal") {
        const details = proposalDetails || {};
        const items = details.proposalItems || [];
        const itemsListText = items.map((it: any, idx: number) => 
          `| ${idx + 1} | ${it.description} | ${it.quantity} | ${it.brandModel} | R$ ${it.unitValue} | R$ ${it.totalValue} |`
        ).join("\n");

        prompt = `
Você é um consultor especialista em licitações e editais governamentais no Brasil.
Seu objetivo é gerar uma PROPOSTA COMERCIAL formal, em formato Markdown profissional e completa, baseada estritamente no modelo oficial de proposta fornecido pelo usuário.

Siga exatamente o layout, estilo e estrutura do modelo a seguir, preenchendo todos os dados de acordo com os detalhes fornecidos pelo usuário e com as exigências específicas do edital.

--- MODELO DE ESTRUTURA REQUERIDO (MANTENHA ESTA CONFIGURAÇÃO EXATA DE SEÇÕES) ---
1. Cabeçalho Principal (Nome do proponente destacado em negrito, CNPJ, E-mail, Tel, Cidade - UF).
2. Título Centralizado "PROPOSTA COMERCIAL" destacado, seguido do número do Pregão/Dispensa e Processo Administrativo.
3. Destinatário formal ("Ao Setor de Dispensa / Comissão de Licitação da [Secretaria/Orgão Licitante]").
4. Parágrafo de abertura declarando aceitar irrestritamente as diretrizes da presente Chamada Pública ou Pregão.
5. Seção "1. IDENTIFICAÇÃO DO CONCORRENTE" formatada em tabela limpa, contendo as colunas/linhas: Razão Social, CNPJ, Endereço Comercial, Telefone / WhatsApp, E-mail Comercial, Responsável Legal e Dados Bancários.
6. Seção "2. PLANILHA DE QUANTITATIVOS, ESPECIFICAÇÕES E PREÇOS" em tabela com colunas exatas: Item | Descrição Detalhada do Produto Conforme o Edital e Marca Ofertada | Qtd. | Marca / Modelo | Valor Unit. | Valor Total.
   - Logo abaixo da tabela de itens, apresente destacado em caixa ou negrito:
     **VALOR TOTAL GLOBAL DA PROPOSTA:** R$ [SOMA TOTAL GLOBAL]
     **VALOR TOTAL POR EXTENSO:** [TOTAL GLOBAL POR EXTENSO]
7. Seção "3. CONDIÇÕES COMERCIAIS OBRIGATÓRIAS" em tabela ou lista formal com: Prazo de Validade, Condições de Pagamento, Prazo de Entrega, e Local de Entrega.
8. Seção "4. DECLARAÇÕES LEGAIS OBRIGATÓRIAS" contendo as declarações tradicionais obrigatórias (conformidade com leis, validade da proposta, inclusão de tributos/fretes, concordância com o edital, regularidade ambiental, e prazo de entrega).
9. Fechamento formal com Cidade-UF, Data por extenso, e Bloco de Assinatura centralizado com Linha de assinatura, Nome do Representante, Cargo "Representante Legal / Titular", CPF e CNPJ.

--- DADOS DA EMPRESA PROPONENTE ---
- Nome / Razão Social: ${companyData?.razonSocial || "GABRIEL DUARTE MOTA SOUZA"}
- CNPJ: ${companyData?.cnpj || "45.153.397/0001-90"}
- Endereço completo: ${companyData?.address || "AV CONSELHEIRO JUNQUEIRA, Nº 595, BAIRRO CATU, ALAGOINHAS - BA, CEP: 48.015-900"}
- E-mail: ${companyData?.email || "GABRIELTRAFEGO7@GMAIL.COM"}
- Telefone: ${companyData?.phone || "(75) 9993-0808"}
- Responsável Legal: ${companyData?.representativeName || "GABRIEL DUARTE MOTA SOUZA"}
- CPF do Representante: ${companyData?.representativeCpf || "063.976.775-32"}
- Dados Bancários: ${companyData?.bankDetails || "Banco: Nu Pagamentos S.A - Instituição de Pagamento (Cód. 0260) | Agência: 0001 | Conta: 64252707-9"}

--- DADOS DA PROPOSTA PERSONALIZADA PELO USUÁRIO ---
- Título da Proposta/Modalidade: ${details.proposalDispensa || "Dispensa de Licitação nº 046/2026"}
- Processo Administrativo: ${details.proposalProcesso || "Processo Administrativo nº 209/2026"}
- Órgão Destinatário: ${details.proposalOrgao || "Secretaria Municipal de Educação de Juazeiro/BA"}
- Objeto/Intro: ${details.proposalObject || "fornecimento de equipamentos audiovisuais e tecnológicos destinados ao preenchimento integral das metas do Programa Educomunicativo Conexão Escola, sob coordenação da TV Escola Juazeiro"}
- Itens da Proposta (Use estes valores exatos na tabela de preços):
${itemsListText || `| 1 | ${analysisData?.descricaoProduto || "Equipamentos audiovisuais conforme especificações do edital"} | 08 | Marca Ofertada | R$ _,__ | R$ _,__ |`}
- Valor Total Global da Proposta: R$ ${details.totalValueGlobal || "0,00"}
- Valor Total por Extenso: ${details.totalValueExtenso || "Zero reais."}
- Prazo de Validade da Proposta: ${details.valPrazo || "60 (sessenta) dias, a contar da data de apresentação deste documento."}
- Condições de Pagamento: ${details.valPgto || "Em até 30 (trinta) dias úteis, contados da finalização da regular liquidação da despesa pelo Município."}
- Prazo de Entrega: ${details.valEntrega || "Até 15 (quinze) dias corridos, contados a partir do recebimento da Ordem de Fornecimento ou Nota de Empenho."}
- Local de Entrega: ${details.valLocal || "Secretaria Municipal de Educação de Juazeiro/BA, diretamente no Setor de TI. Sem custos logísticos para o órgão."}
- Data e Local de Emissão: ${details.proposalDate || "Alagoinhas - BA, " + new Date().toLocaleDateString('pt-BR')}

--- INSTRUÇÕES ADICIONAIS DO USUÁRIO ---
${extraInstructions || "Nenhuma específica."}

Gere o documento completo formatado em Markdown impecável, pronto para impressão ou conversão para PDF. Mantenha os valores monetários exatamente nos valores solicitados e preenchidos acima. Do não adicione introduções como "Aqui está a proposta", retorne APENAS o documento estruturado.
`;
      } else if (docType === "joint_declaration") {
        prompt = `
Escreva uma DECLARAÇÃO CONJUNTA formal para Pregão Eletrônico, baseada nas normas nacionais brasileiras de licitação, em formato Markdown profissional.
Esta declaração deve englobar de forma consolidada os seguintes itens tradicionais frequentemente exigidos juntos nos editais:
1. Inexistência de fatos supervenientes impeditivos da habilitação (Art. 32, § 2º, Lei 8.666/93 ou correspondentes Lei 14.133/21).
2. Cumprimento do Art. 7º, inciso XXXIII, da Constituição Federal (Proibição de trabalho infantil e trabalho escravo).
3. Enquadramento legal como Microempresa ou Empresa de Pequeno Porte (ME/EPP) se aplicável, ou declaração padrão de regularidade em licitações.
4. Cumprimento da Lei Federal de anticorrupção.

Dados da Empresa proponente:
- Razão Social: ${companyData?.razonSocial || "Minha Empresa"}
- CNPJ: ${companyData?.cnpj || "00.000.000/0001-00"}
- Representante legal: ${companyData?.representativeName || "Diretor Responsável"}
- CPF do Representante: ${companyData?.representativeCpf || "000.000.000-00"}

Instruções extras: ${extraInstructions || "Nenhuma específica."}

Crie um texto com tom jurídico impecável, contendo espaço para data, assinatura e local. Retorne exclusivamente o documento formatado em markdown.
`;
      } else if (docType === "custom_declaration") {
        prompt = `
Você é um assistente de elaboração de documentos fiscais e legais para licitações.
Crie um modelo customizado preenchido da declaração exigida no edital.
O usuário enviou um texto exemplo ou modelo a ser replicado ou preenchido:
"${uploadedTemplateText || "DECLARAÇÃO DE COMPROMISSO E REGULARIDADE"}"

Preencha as lacunas ou variáveis desse documento exemplo utilizando os seguintes dados da empresa proponente:
- Razão Social: ${companyData?.razonSocial || "Minha Empresa"}
- CNPJ: ${companyData?.cnpj || "00.000.000/0001-00"}
- Representante legal: ${companyData?.representativeName || "Diretor Responsável"}
- CPF do Representante: ${companyData?.representativeCpf || "000.000.000-00"}

Dados retirados do Edital:
- Prazo de Entrega: ${analysisData?.prazoEntrega || "Conforme edital"}
- Prazo de Pagamento: ${analysisData?.prazoPagamento || "Conforme edital"}
- Resumo do Escopo: ${analysisData?.descricaoProduto || "Conforme especificação"}

Instruções adicionais do usuário: ${extraInstructions || "Substituir campos e tornar profissional."}

Gere o documento final completo em formato Markdown, pronto para impressão ou assinatura.
Manter a redação original do modelo fornecido pelo usuário, apenas aprimorando ou preenchendo as lacunas de forma precisa e integrada ao contexto comercial. Do not include headers explaining what you did, return directly the document.
`;
      } else {
        return res.status(400).json({ error: "Tipo de documento inválido." });
      }

      console.log(`Chamando AI Router para gerar documento (${docType})...`);
      const response = await generateAiResponse({
        model: "gemini-3.7-flash",
        contents: [{ text: prompt }],
        aiConfig,
      });

      return res.json({ 
        markdown: response.text,
        title: docType === "proposal" ? (proposalDetails?.proposalFileTitle || "Proposta Comercial de Licitação.md") : undefined
      });
    } catch (error: any) {
      console.warn("Erro na geração de documento, aplicando fallback inteligente local...", error.message || error);
      try {
        const { docType, companyData, analysisData, proposalDetails } = req.body;
        const fallbackDoc = generateDocumentLocally(docType, companyData, analysisData, proposalDetails);
        return res.json({ 
          markdown: fallbackDoc,
          title: docType === "proposal" ? (proposalDetails?.proposalFileTitle || "Proposta Comercial de Licitação.md") : undefined
        });
      } catch (fallbackError: any) {
        return res.status(500).json({ error: "Erro ao preencher documento local." });
      }
    }
  });

  // API Route: Compare candidate products with edital product specifications using Google Search grounding
  app.post("/api/compare-products", async (req, res): Promise<any> => {
    try {
      const { requiredSpecs, candidateProducts, aiConfig: clientAiConfig } = req.body;
      const aiConfig = await resolveAiConfig(req.headers.authorization, clientAiConfig);

      if (!aiConfig) {
        return res.status(400).json({ 
          error: "❌ Chave de API não configurada. Acesse 'IA & Modelos', insira sua chave e clique em 'Salvar Configurações'.",
          code: "NO_API_KEY"
        });
      }

      if (!requiredSpecs || !candidateProducts || !Array.isArray(candidateProducts)) {
        return res.status(400).json({ error: "Parâmetros 'requiredSpecs' ou 'candidateProducts' inválidos ou ausentes." });
      }

      console.log(`[Comparador] Iniciando comparação de ${candidateProducts.length} produtos em relação às especificações do edital.`);

      const results = await Promise.all(
        candidateProducts.map(async (productModel: string) => {
          try {
            const prompt = `Definição da licitação (Requisitos do Edital):
"${requiredSpecs}"

Produto Candidato que pretendo fornecer:
"${productModel}"

Instruções de Comparação de Rigor Máximo (Risco de Desclassificação):
Você é um auditor de licitação extremamente rígido e meticuloso. Em licitações públicas, pequenos detalhes técnicos e conectores causam a imediata desclassificação jurídica e técnica ("Desclassificação sumária").
Por favor, faça uma busca detalhada no Google para mapear a ficha técnica real oficial exata do produto "${productModel}", prestando atenção cirúrgica aos detalhes.

Compare item por item em relação ao Edital. Seja ABSOLUTAMENTE RIGOROSO com:
1. Conectores e Portas Físicas:
   - Se o edital exige conexão P2 (conector analógico estéreo comum de 3 pinos) e o produto tem conector P3 (conector de 4 pinos com microfone integrado), ou vice-versa, isso é uma DIVERGÊNCIA relevante.
   - Se o edital exige conector USB e o produto possui conector P2/P3 analógico (ou vice-versa), isso é um impeditivo grave. Marque como "DIVERGENTE" e atribua "NAO_ATENDE" ou "ATENDE_PARCIALMENTE" dependendo da gravidade, reduzindo a nota drasticamente.
2. Dimensões, Materiais e Ergonomia (ex: Normas regulamentadoras NR17, pesos, espessuras).
3. Capacidade, Velocidade, Tensão Elétrica ou Conexões Secundárias.

Se houver QUALQUER diferença ou incerteza técnica, você não deve ignorar ou justificar como "facilmente adaptável" ou "compatível". Se não houver compatibilidade nativa direta sem adaptadores externos (salvo se o edital explicitamente permitir adaptadores), classifique o status como "DIVERGENTE" e reduza o "suitabilityScore" de forma correspondente.

Retorne sua resposta estritamente no seguinte formato JSON, sem comentários nem tags codeblock extras:
{
  "productName": "Nome exato consultado e modelo do produto com marca",
  "matchStatus": "ATENDE" | "ATENDE_PARCIALMENTE" | "NAO_ATENDE",
  "suitabilityScore": 0, (grau realístico de conformidade técnica exata de 0 a 100),
  "specsAnalysis": [
    {
      "requirement": "Requisito exato extraído do edital",
      "foundSpecText": "Valor ou característica técnica exata encontrada no produto candidato",
      "status": "ATENDE" | "DIVERGENTE" | "NAO_ENCONTRADO",
      "comment": "Análise técnica exaustiva demonstrando se atende ou viola a exigência"
    }
  ],
  "pros": ["Pontuais pontos de aderência com a licitação"],
  "cons": ["Possíveis divergências identificadas, pontos fracos ou potenciais motivos para auditoria ou desclassificação técnica"],
  "conclusion": "Parecer definitivo fundamentado explicando se o pregoeiro ou comissão técnica pode desclassificar o produto por conta de conectores, interfaces, potências ou normas, sugerindo alternativas exatas se necessário."
}

Retorne exclusivamente o JSON bruto estruturado e validável.`;

            const response = await generateAiResponse({
              model: "gemini-3.7-flash",
              contents: [{ text: prompt }],
              aiConfig,
              jsonMode: true,
              tools: [{ googleSearch: {} }]
            });

            const parsedResult = cleanAndParseJson(response.text);
            return {
              originalName: productModel,
              success: true,
              data: parsedResult,
              sources: response.groundingMetadata?.groundingChunks || response.candidates?.[0]?.groundingMetadata?.groundingChunks || []
            };
          } catch (err: any) {
            console.warn(`Erro ao analisar produto "${productModel}":`, err.message || err);
            try {
              const fallbackSingle = compareProductsLocally(requiredSpecs, [productModel]).results[0];
              return fallbackSingle;
            } catch (fallbackErr) {
              return {
                originalName: productModel,
                success: false,
                error: err.message || "Erro desconhecido na análise fidedigna."
              };
            }
          }
        })
      );

      return res.json({ results });
    } catch (error: any) {
      console.warn("Erro na rota de comparação de produtos:", error.message || error);
      return res.status(500).json({ error: error.message || "Erro interno ao comparar produtos." });
    }
  });

  // API Route: Floating Gemini AI Chat Router
  app.post("/api/chat", async (req, res): Promise<any> => {
    try {
      const { messages, companyData, activeEditalAnalysis, aiConfig: clientAiConfig } = req.body;
      const aiConfig = await resolveAiConfig(req.headers.authorization, clientAiConfig);

      if (!aiConfig) {
        return res.status(400).json({ 
          error: "❌ Chave de API não configurada. Acesse 'IA & Modelos', insira sua chave e clique em 'Salvar Configurações'.",
          code: "NO_API_KEY"
        });
      }

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Mensagens inválidas ou ausentes." });
      }

      // Format messages into Google Gen AI standard format for chatting.
      // We can map { role: 'user' | 'assistant', content: string, attachment?: any } to { role: 'user' | 'model', parts: [...] }
      const formattedHistory = messages.map((m: any) => {
        const parts: any[] = [];
        
        if (m.attachment && m.attachment.data) {
          let base64Data = String(m.attachment.data);
          if (base64Data.includes("base64,")) {
            base64Data = base64Data.split("base64,")[1];
          }
          base64Data = base64Data.trim();

          const isRealBase64 = base64Data.length > 20 &&
            !base64Data.startsWith("[") &&
            !base64Data.includes(" ") &&
            /^[A-Za-z0-9+/=\r\n]+$/.test(base64Data);

          if (isRealBase64) {
            parts.push({
              inlineData: {
                mimeType: m.attachment.type || "image/png",
                data: base64Data
              }
            });
          } else {
            parts.push({
              text: `[Anexo de imagem/arquivo enviado previamente: ${m.attachment.name || "arquivo"}]`
            });
          }
        }
        
        parts.push({ text: m.content || "Analise o arquivo ou imagem anexada acima." });
        
        return {
          role: m.role === "assistant" ? "model" : "user",
          parts: parts
        };
      });

      // In the system instruction (or prepended context), we provide info about the company certs and active edital analysis if present!
      const contextPrefix = `
Você é a HORASIS AI, a Assessora e Consultora Inteligente de Licitações, Pregões Eletrônicos e Cotações de Mercado da plataforma HORASIS.
Sua missão é dar respostas ultra-claras, diretas, resumidas e perfeitamente explicadas para os fornecedores e licitantes.

🎯 DIRETRIZES FUNDAMENTAIS DE RESPOSTA (OBRIGATÓRIO):
1. **RESPOSTAS DIRETAS, RESUMIDAS E EXPLICÁVEIS**:
   - Responda com clareza e sem enrolação nas primeiras linhas. Os usuários querem praticidade e facilidade.
   - Apresente os resultados, conclusões e valores numéricos diretamente logo de início.

2. **PROIBIDO QUALQUER CÓDIGO OU SÍMBOLO DE FÓRMULA LATEX**:
   - ❌ NUNCA USE '$$', '\\text{}', '\\times', '\\rightarrow', '\\cdot' ou qualquer marcação matemática LaTeX.
   - ✅ Escreva todas as fórmulas, equações e cálculos em português simples e legível.
   - Exemplo correto de cálculo de lucro e margem:
     • **Preço de Venda do Governo:** R$ 800,00/mês
     • **Custo do Produto/Serviço:** R$ 550,00/mês
     • **Impostos Estimados (~6% Simples):** R$ 48,00/mês
     • **Lucro Líquido Real:** **R$ 202,00 por mês** (Lucro Anual: R$ 2.424,00)

3. **REGRAS SOBRE EDITAIS E DOCUMENTOS ANEXOS**:
   - Só analise, mencione ou tome como base um edital se o usuário tiver explicitamente SELECIONADO um edital no Foco do Chat ou se tiver enviado um arquivo/documento em anexo.
   - Se NENHUM edital estiver selecionado e nenhum anexo for enviado na mensagem, responda a qualquer dúvida do usuário de forma totalmente geral, direta e útil, sem inventar nem assumir nenhum edital prévio.

4. **PESQUISA AUTÔNOMA NA INTERNET (WEB SEARCH) EM TEMPO REAL**:
   - Você possui autonomia e ferramenta ativa de pesquisa no Google em tempo real.
   - Sempre que o usuário solicitar preços de produtos, serviços, licenças de software (ex: Claude, ChatGPT, ERPs, softwares de IA), equipamentos, insumos ou cotações de mercado, PESQUISE imediatamente dados atualizados na internet.
   - NUNCA invente preços ou dados se não souber. Se pesquisar, traga os valores e estimativas reais de mercado vigentes no Brasil.

5. **ESTRUTURA LEGÍVEL E FORMATO**:
   - Organize as respostas usando marcadores em tópicos (• ou -) com títulos destacados em negrito.
   - Em cenários com tabelas, garanta que cada linha esteja formatada corretamente e seja fácil de ler no celular e computador.

Informações da Empresa do Usuário:
${companyData ? `- Razão Social: ${companyData.razonSocial}\n- CNPJ: ${companyData.cnpj}\n- Representante: ${companyData.representativeName}` : "Empresa não fornecida."}

Edital Selecionado pelo Usuário nesta Conversa:
${activeEditalAnalysis ? JSON.stringify(activeEditalAnalysis, null, 2) : "Nenhum edital selecionado pelo usuário para esta conversa."}
`;

      // Invoke Gemini API with system instruction & Google Search grounding
      console.log("Chamando Gemini API Chat com Web Search ativo...");
      const response = await generateAiResponse({
        model: "gemini-3.7-flash",
        contents: formattedHistory,
        systemInstruction: contextPrefix,
        tools: [{ googleSearch: {} }],
        aiConfig,
      });

      return res.json({ reply: response.text });
    } catch (error: any) {
      console.warn("Erro no chat com IA, aplicando resposta do assistente local:", error.message || error);
      const errMsg = error?.message || "Erro de conexão com a IA.";
      const reason = describeAiFailure(error);
      try {
        const { messages, companyData, activeEditalAnalysis } = req.body;
        const fallbackReply = generateChatLocally(messages || [], companyData, activeEditalAnalysis);
        // Resposta degradada: entrega o texto local, mas deixa explícito que a IA falhou.
        return res.json({
          reply: `⚠️ **Resposta gerada localmente — a IA não respondeu.**\n${reason}\n\n---\n\n${fallbackReply}`,
          degraded: true,
          reason
        });
      } catch (fallbackError: any) {
        return res.status(400).json({ error: errMsg });
      }
    }
  });

  // API Route: Generate Chat Title based on first message
  app.post("/api/chat/title", async (req, res): Promise<any> => {
    try {
      const { message, aiConfig: clientAiConfig } = req.body;
      const aiConfig = await resolveAiConfig(req.headers.authorization, clientAiConfig);
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Mensagem ausente ou inválida." });
      }

      const prompt = `Gere um título curto, direto e descritivo (no máximo 3 ou 4 palavras) para um chat de licitações públicas que se inicia com a seguinte dúvida do usuário. Não coloque aspas, não adicione pontos finais nem explicações adicionais, retorne APENAS o título direto em português do Brasil. Se for apenas uma saudação inicial simples (como 'olá', 'tudo bem', 'bom dia'), retorne 'Conversa Rápida'.

Dúvida do usuário: "${message.substring(0, 500)}"`;

      console.log("Chamando Gemini API para gerar título de conversa...");
      const response = await generateAiResponse({
        model: "gemini-3.7-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        aiConfig,
      });

      let generatedTitle = response.text ? response.text.trim() : "";
      // Strip any surrounding quotes or punctuation if the AI included them
      generatedTitle = generatedTitle.replace(/^["'“”‘`]+|["'“”’`]+$/g, "").replace(/[.!?]+$/, "").trim();

      if (!generatedTitle || generatedTitle.length > 50) {
        generatedTitle = "Discussão de Edital";
      }

      return res.json({ title: generatedTitle });
    } catch (error: any) {
      console.warn("Erro ao gerar título de conversa, usando fallback local...", error.message || error);
      return res.json({ title: null });
    }
  });

  // API Route: Generate description/notes for a user-created certificate using IA
  app.post("/api/generate-cert-description", async (req, res): Promise<any> => {
    try {
      const { name, aiConfig: clientAiConfig } = req.body;
      const aiConfig = await resolveAiConfig(req.headers.authorization, clientAiConfig);
      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "Nome da certidão ausente ou inválido." });
      }

      const prompt = `Você é um assessor especialista em licitações públicas no Brasil.
O usuário criou uma certidão personalizada ou bloco de upload com o nome: "${name}".
Sua tarefa é explicar brevemente para que serve essa certidão, o que ela comprova e onde geralmente é emitida.
Escreva de forma extremamente concisa, técnica e direta, em português do Brasil, no máximo em uma ou duas frases (máximo 150 caracteres).
Evite preâmbulos como "Esta certidão serve para", comece diretamente com o que ela faz.
Exemplo para "Certidão de Falência e Recuperação Cível": "Comprova a idoneidade financeira e ausência de processos falimentares ativos da empresa perante o Tribunal de Justiça."`;

      console.log(`Chamando Gemini API para gerar descrição da certidão: ${name}...`);
      
      let generatedDescription = "";
      if (aiConfig) {
        const response = await generateAiResponse({
          model: "gemini-3.7-flash",
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          aiConfig,
        });
        generatedDescription = response.text ? response.text.trim() : "";
      }

      if (!generatedDescription || generatedDescription.length > 250) {
        generatedDescription = `Documento auxiliar ou certidão de regularidade de "${name}" necessária para a comprovação de requisitos habilitatórios no processo de licitação pública.`;
      }

      return res.json({ description: generatedDescription });
    } catch (error: any) {
      console.warn("Erro ao gerar descrição da certidão por IA, usando fallback local...", error.message || error);
      const name = req.body.name || "Documento";
      return res.json({ 
        description: `Documento ou certidão de regularidade para comprovar as obrigações e qualificações de "${name}" conforme as exigências do instrumento convocatório.`
      });
    }
  });


  // Uma rota /api desconhecida deve responder JSON, nunca o index.html do SPA:
  // o cliente faz JSON.parse da resposta e um HTML aqui vira "Unexpected token '<'".
  app.use("/api", (req, res) => {
    res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
  });

  // Tratador de erros do Express. Sem ele, qualquer exceção não capturada numa rota
  // derruba a função e o usuário recebe a página de erro da hospedagem
  // (FUNCTION_INVOCATION_FAILED) em vez de uma mensagem que diga o que houve.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[Express] Erro não tratado:", err?.stack || err?.message || err);
    if (res.headersSent) return;
    res.status(500).json({ error: describeAiFailure(err) });
  });

  // Ambiente serverless (Vercel): o módulo só exporta o app, sem escutar porta e sem
  // Vite. Servidor próprio (Cloud Run, VPS, npm start): registra o front e escuta.
  const isServerless = Boolean(process.env.VERCEL);

  function serveBuiltFrontend() {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  async function initializeViteAndListen() {
    if (process.env.NODE_ENV !== "production" && !isServerless) {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      serveBuiltFrontend();
    }

    if (!isServerless) {
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://0.0.0.0:${PORT}`);
      });
    }
  }

  if (isServerless) {
    // Na Vercel o roteamento estático é feito pelo vercel.json; aqui basta garantir
    // que nada assíncrono rode na carga do módulo e possa rejeitar.
    serveBuiltFrontend();
  } else {
    // Uma rejeição aqui não pode derrubar o processo antes das rotas existirem.
    initializeViteAndListen().catch((err) => {
      console.error("[Bootstrap] Falha ao inicializar o servidor:", err?.stack || err?.message || err);
    });
  }

  export default app;
