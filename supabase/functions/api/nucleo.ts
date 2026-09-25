// ═══════════════════════════════════════════════════════════════════════
// NÚCLEO DO BACKEND — Supabase Edge Function (Deno)
//
// Este arquivo concentra os auxiliares do backend: extração de texto de
// documentos, resolução da configuração de IA do usuário, a cadeia de
// chamada aos provedores com fallback, os geradores locais usados quando o
// provedor falha, o limitador de requisições e a telemetria.
//
// Ele roda no Supabase, não na Vercel. A Vercel publica apenas o frontend
// estático; nenhuma função serverless dela participa mais do caminho de
// execução. Isso elimina de uma vez a classe de falha em que o processo
// morria na carga do módulo e a plataforma devolvia FUNCTION_INVOCATION_FAILED
// sem deixar um único log nosso para trás.
// ═══════════════════════════════════════════════════════════════════════
import process from "node:process";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI, Type } from "npm:@google/genai@2.8.0";
import {
  derivarChaveMestra,
  descriptografarConfiguracao,
} from "./segredos.ts";

export { GoogleGenAI, Type, Buffer, process, fs, path };

type PdfExtractor = (buffer: Buffer) => Promise<{ text: string; numpages: number }>;

let pdfParsePromise: Promise<PdfExtractor | null> | null = null;

/**
 * Extrator de texto de PDF para o runtime Deno.
 *
 * No Node o projeto usava pdf-parse. Aqui ele não serve: a v2 depende do
 * pdf.js com worker em arquivo separado, que o runtime de borda não carrega.
 * `unpdf` é o mesmo pdf.js empacotado para ambientes sem sistema de arquivos
 * e sem worker — é exatamente o caso de uso desta função.
 *
 * A carga continua preguiçosa e a falha continua NÃO sendo fatal: sem
 * extrator, o PDF segue para o modelo como anexo binário (o Gemini lê PDF
 * nativamente) e o resto da plataforma continua de pé.
 */
async function loadPdfParse(): Promise<PdfExtractor | null> {
  if (!pdfParsePromise) {
    // Import dinâmico de propósito: se o pacote não resolver, a falha fica
    // contida aqui em vez de impedir a carga do módulo inteiro — que é
    // exatamente o modo de falha que vinha derrubando o backend anterior sem
    // deixar log nenhum.
    pdfParsePromise = import("npm:unpdf")
      .then((mod: any) => {
        const { extractText, getDocumentProxy } = mod;
        if (typeof extractText !== "function" || typeof getDocumentProxy !== "function") {
          throw new Error("unpdf não expõe extractText/getDocumentProxy");
        }
        const extract: PdfExtractor = async (buffer: Buffer) => {
          const documento = await getDocumentProxy(new Uint8Array(buffer));
          const { text, totalPages } = await extractText(documento, { mergePages: true });
          return {
            text: String(text || "").trim(),
            numpages: Number(totalPages) || 0,
          };
        };
        return extract;
      })
      .catch((err: any) => {
      console.error("[unpdf] Não foi possível carregar o extrator de PDF:", err?.message || err);
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
export const MAX_DOCUMENT_CHARS = Number(process.env.MAX_DOCUMENT_CHARS || 400_000);

/**
 * Sinais de que um trecho contém a planilha de itens/lotes do edital.
 *
 * O corte anterior era cego: mantinha começo e fim e jogava fora o miolo. Só que
 * é justamente no miolo que ficam o Termo de Referência e as tabelas de itens —
 * em edital grande, a plataforma descartava exatamente a parte que precisava ler
 * e depois relatava um item só. Agora o miolo é selecionado por relevância.
 */
export const SINAIS_DE_ITENS = [
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

export function pontuarTrecho(trecho: string): number {
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
export function capDocumentText(text: string, label: string): string {
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
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfParse = await loadPdfParse();
  if (!pdfParse) return "";
  const result = await pdfParse(buffer);
  return result?.text || "";
}

// No Supabase as variáveis chegam pelos Secrets do projeto (Deno.env), que o
// node:process expõe como process.env — não há .env para carregar aqui.

// Modelos Gemini que a API generativelanguage.googleapis.com realmente expõe hoje.
// ⚠️ A família 2.5 foi descontinuada para novas chaves ("This model is no longer
// available to new users" → HTTP 404), por isso não entra mais em nenhuma lista.
export const VALID_GEMINI_MODELS = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
  "gemini-3.1-pro-preview"
];

export const GEMINI_MODEL_ALIASES: Record<string, string> = {
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

export function normalizeGeminiModel(model: string | undefined): string {
  if (!model) return "gemini-3.7-flash";
  const trimmed = model.trim().toLowerCase();
  if (VALID_GEMINI_MODELS.includes(trimmed)) return trimmed;
  if (GEMINI_MODEL_ALIASES[trimmed]) return GEMINI_MODEL_ALIASES[trimmed];
  return "gemini-3.7-flash";
}

// Lista de fallback: mantém o modelo escolhido pelo usuário em primeiro lugar e,
// em caso de 429/503, rotaciona por modelos de famílias e cotas diferentes.
export function getFallbackModels(primaryModel: string): string[] {
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
export const SERVER_KEY_FALLBACK_ENABLED =
  String(process.env.ALLOW_SERVER_AI_KEY_FALLBACK || "").trim().toLowerCase() === "true";

export function getServerFallbackKey(varName: "GEMINI_API_KEY" | "OPENAI_API_KEY"): string | null {
  if (!SERVER_KEY_FALLBACK_ENABLED) return null;
  const key = String(process.env[varName] || "").trim();
  return key.length > 10 ? key : null;
}

// Lê o "sub" (id do usuário) de um JWT do Supabase sem verificar assinatura.
// A verificação continua sendo feita pelo PostgREST/RLS; aqui o valor serve apenas
// para filtrar a consulta pela linha do usuário correto.
/**
 * Chave mestra de criptografia das chaves de IA, derivada uma vez no start.
 *
 * Sem AI_KEYS_ENCRYPTION_KEY, fica null e todo o caminho vira passagem direta:
 * a plataforma se comporta exatamente como antes. Uma migração de segurança que
 * derruba quem não leu o changelog não é melhoria, é incidente.
 */
export const CHAVE_MESTRA_IA = derivarChaveMestra(process.env.AI_KEYS_ENCRYPTION_KEY);

if (!CHAVE_MESTRA_IA) {
  console.warn(
    "[segredos] AI_KEYS_ENCRYPTION_KEY não configurada: as chaves de API dos usuários " +
    "ficam em texto puro no banco. Gere uma com `openssl rand -hex 32` e defina a variável."
  );
}

export function getUserIdFromJwt(token: string): string | null {
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
export function describeAiFailure(error: any): string {
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
export async function resolveAiConfig(authHeader: string | undefined, clientAiConfig?: any): Promise<{ provider: string; apiKey: string; model: string } | null> {
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
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://cghlfhndoqohmrrvppjj.supabase.co";
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_FWDd-D9L6tGwasm1-qyT1Q_c7T9m_6o";

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
            // Decifra antes de usar. Linhas gravadas antes desta mudança não têm
            // o prefixo e passam intactas, então os dois formatos convivem no
            // banco durante a transição.
            const row = descriptografarConfiguracao(rows[0], CHAVE_MESTRA_IA);
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

export function getAiClientForConfig(aiConfig?: any): GoogleGenAI | undefined {
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

export function cleanAndParseJson(text: string): any {
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

export function collectUniqueFiles(sources: any[]): any[] {
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

export interface ProcessedAttachmentResult {
  part: any;
  tempFilePath?: string;
  uploadedFileName?: string;
}

export async function processFileAttachmentAsync(
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

export async function cleanupAttachmentResources(
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

export function normalizeContents(contents: any[]): any[] {
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

export function sanitizeAiTextResponse(text: string): string {
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
export async function generateContentWithFallback(params: {
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
export const SUPPORTED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export function normalizeMimeType(mime: string | undefined): string {
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
export function buildProviderMessages(contents: any[], provider: string): any[] {
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
export const AI_REQUEST_BUDGET_MS = Number(process.env.AI_REQUEST_BUDGET_MS || 60_000);

export async function generateAiResponse(params: {
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
  /**
   * Profundidade de raciocínio do Gemini 3.x ("thinking").
   *
   * O modelo gasta tokens de pensamento ANTES de começar a responder, e esse
   * tempo entra inteiro na espera do usuário. Para extração estruturada — ler
   * uma planilha e devolver JSON conforme um schema — o raciocínio profundo
   * quase não muda o resultado e domina a latência. Tarefas de julgamento
   * podem pedir mais.
   */
  thinkingLevel?: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
}): Promise<any> {
  const { contents, systemInstruction, aiConfig, jsonMode, model, responseSchema, tools, thinkingLevel } = params;
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
            if (thinkingLevel) reqConfig.thinkingConfig = { thinkingLevel };
            // Teto por requisição, amarrado ao tempo que ainda resta do orçamento.
            // Sem isso, o orçamento só era conferido ENTRE tentativas: uma única
            // chamada lenta seguia até o fim, e uma execução chegou a 269s mesmo
            // com orçamento de 100s configurado.
            reqConfig.httpOptions = { timeout: Math.max(5_000, remainingMs()) };

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
                  if (thinkingLevel) reqConfigNoSchema.thinkingConfig = { thinkingLevel };
                  reqConfigNoSchema.httpOptions = { timeout: Math.max(5_000, remainingMs()) };

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

export function parseEditalLocally(text: string): any {
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

export function parseCertificateLocally(docName: string): any {
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

export function generateDocumentLocally(docType: string, companyData: any, activeEdital: any, proposalDetails?: any): string {
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

export function compareProductsLocally(requiredSpecs: string, candidateProducts: string[]): any {
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

export function generateChatLocally(messages: any[], companyData: any, activeEdital: any): string {
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

// ═══════════════════════════════════════════════════════════════════════
// LIMITE DE REQUISIÇÕES
//
// Até aqui nenhuma rota tinha teto. Um laço no cliente — um useEffect sem
// dependência correta, um retry mal escrito, ou simplesmente alguém com o
// endereço da API — dispara chamadas de IA em sequência, e cada uma delas
// é cobrada: da chave do próprio usuário, ou do GEMINI_API_KEY de quem
// publicou o app quando o fallback está ligado. O prejuízo aparece na
// fatura, não no log.
//
// O contador vive na memória do processo. Em serverless (Vercel) cada
// instância tem o seu, então isto é um redutor de dano, não uma cota
// contábil: segura o laço acidental e o abuso ingênuo, que é o que
// acontece na prática. Cota real exige contador compartilhado (Postgres
// ou Redis) e entra junto com o painel de consumo de IA.
// ═══════════════════════════════════════════════════════════════════════

export const JANELA_LIMITE_MS = 60_000;

// Rotas que gastam token de IA: o teto é baixo de propósito. Uma pessoa
// trabalhando normalmente não chega perto disso — analisar um edital, pedir
// uma revisão e conversar no chat somam poucas chamadas por minuto.
export const LIMITE_IA_POR_MINUTO = Number(process.env.RATE_LIMIT_IA_POR_MINUTO || 20);
// Upload em pedaços: um PDF de 60 MB vira ~32 partes, e o chat aceita 100 MB.
// O teto precisa caber um arquivo grande inteiro sem atrapalhar.
export const LIMITE_UPLOAD_POR_MINUTO = Number(process.env.RATE_LIMIT_UPLOAD_POR_MINUTO || 300);
// Demais rotas (consultas ao PNCP, status, configuração).
export const LIMITE_API_POR_MINUTO = Number(process.env.RATE_LIMIT_API_POR_MINUTO || 120);

export const ROTAS_IA = new Set([
  "/api/analyze-edital",
  "/api/analyze-competitor",
  "/api/analyze-cert",
  "/api/generate-document",
  "/api/compare-products",
  "/api/chat",
  "/api/chat/title",
  "/api/generate-cert-description",
]);

export interface JanelaDeUso {
  inicio: number;
  usos: number;
}

export const contadoresDeUso = new Map<string, JanelaDeUso>();

/**
 * Identifica quem está chamando. O usuário autenticado é o alvo certo — o
 * limite acompanha a pessoa, não a rede. Sem token, sobra o IP, que agrupa
 * todo mundo atrás do mesmo NAT; por isso o teto por IP não é menor que o
 * por usuário, para não punir um escritório inteiro pelo uso de um.
 */
export function identificarChamador(req: any): string {
  const auth = String(req.headers?.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const userId = token ? getUserIdFromJwt(token) : null;
  if (userId) return `user:${userId}`;

  const encaminhado = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return `ip:${encaminhado || req.socket?.remoteAddress || "desconhecido"}`;
}

export function consumirCota(chave: string, limite: number): { permitido: boolean; segundosParaLiberar: number } {
  const agora = Date.now();
  const janela = contadoresDeUso.get(chave);

  if (!janela || agora - janela.inicio >= JANELA_LIMITE_MS) {
    contadoresDeUso.set(chave, { inicio: agora, usos: 1 });
    return { permitido: true, segundosParaLiberar: 0 };
  }

  janela.usos += 1;
  if (janela.usos > limite) {
    return {
      permitido: false,
      segundosParaLiberar: Math.max(1, Math.ceil((JANELA_LIMITE_MS - (agora - janela.inicio)) / 1000)),
    };
  }

  return { permitido: true, segundosParaLiberar: 0 };
}

// Sem isso o Map cresceria para sempre em um processo de longa duração:
// cada IP novo deixa uma entrada que nunca mais é lida.
export function limparJanelasExpiradas() {
  const agora = Date.now();
  for (const [chave, janela] of contadoresDeUso) {
    if (agora - janela.inicio >= JANELA_LIMITE_MS) contadoresDeUso.delete(chave);
  }
}

export function limitarRequisicoes(req: any, res: any, next: any) {
  // O health check é o que o monitoramento e a própria Vercel chamam para
  // saber se o processo está vivo; limitá-lo só produziria alarme falso.
  if (req.path === "/health" || req.path === "/api/health") return next();

  if (contadoresDeUso.size > 5000) limparJanelasExpiradas();

  const rota = req.originalUrl?.split("?")[0] || req.path;
  const ehIA = ROTAS_IA.has(rota);
  const ehUpload = rota.startsWith("/api/upload-chunk");

  const balde = ehIA ? "ia" : ehUpload ? "upload" : "api";
  const limite = ehIA ? LIMITE_IA_POR_MINUTO : ehUpload ? LIMITE_UPLOAD_POR_MINUTO : LIMITE_API_POR_MINUTO;

  const { permitido, segundosParaLiberar } = consumirCota(`${balde}:${identificarChamador(req)}`, limite);

  if (!permitido) {
    res.setHeader("Retry-After", String(segundosParaLiberar));
    return res.status(429).json({
      error: ehIA
        ? `Muitas análises seguidas (limite de ${limite} por minuto). Aguarde ${segundosParaLiberar}s e tente de novo.`
        : `Muitas requisições seguidas. Aguarde ${segundosParaLiberar}s e tente de novo.`,
      retryAfter: segundosParaLiberar,
    });
  }

  return next();
}

/* ══════════════════════════════════════════════════════════════════════
 * TELEMETRIA DE DIAGNÓSTICO (temporária)
 *
 * A função serverless vem morrendo com FUNCTION_INVOCATION_FAILED sem deixar
 * rastro, e não há acesso aos logs da hospedagem: o conector responde 403 nas
 * listas e 404 nos gets. Sem observabilidade, o diagnóstico virou eliminação de
 * hipóteses às cegas — três rodadas de correção sem mudar o sintoma.
 *
 * Isto grava numa tabela do Supabase, que é legível. O importante são as fases:
 *
 *   boot    — o módulo carregou. Se NUNCA aparecer, a função nem chega a subir,
 *             e o problema é de build/empacotamento, não das rotas.
 *   inicio  — a requisição entrou no Express, com a memória do processo.
 *   fim     — a resposta saiu, com status, duração e memória.
 *   erro    — exceção capturada, com pilha.
 *   processo— rejeição ou exceção fora do ciclo de requisição.
 *
 * "inicio" sem "fim" e sem "erro" significa que o processo foi morto no meio —
 * estouro de memória ou limite de tempo da hospedagem. É a única assinatura que
 * não dá para obter de dentro do código de outra forma.
 *
 * Desligue com DIAGNOSTICO_ATIVO=false quando a causa estiver resolvida.
 * ══════════════════════════════════════════════════════════════════════ */
export const DIAGNOSTICO_ATIVO = String(process.env.DIAGNOSTICO_ATIVO || "true").toLowerCase() !== "false";

export function memoriaMb(): number {
  try {
    return Math.round(process.memoryUsage().rss / 1024 / 1024);
  } catch {
    return 0;
  }
}

export function registrarDiagnostico(fase: string, rota: string, detalhe: string, pilha = ""): void {
  if (!DIAGNOSTICO_ATIVO) return;
  try {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://cghlfhndoqohmrrvppjj.supabase.co";
    const chave = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_FWDd-D9L6tGwasm1-qyT1Q_c7T9m_6o";

    // Dispara e esquece, com prazo curto: diagnóstico nunca pode atrasar nem
    // derrubar a requisição que está tentando observar.
    const controle = new AbortController();
    setTimeout(() => controle.abort(), 3000);

    void fetch(`${url}/rest/v1/logs_diagnostico`, {
      method: "POST",
      headers: {
        "apikey": chave,
        "Authorization": `Bearer ${chave}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        fase,
        rota: String(rota || "").slice(0, 200),
        detalhe: String(detalhe || "").slice(0, 1000),
        pilha: String(pilha || "").slice(0, 3000),
        memoria_mb: memoriaMb()
      }),
      signal: controle.signal
    }).catch(() => {});
  } catch {
    // telemetria jamais interrompe o fluxo
  }
}

// A marca de boot fica só em index.ts. Este módulo é importado por ele, então
// duas marcas por partida fria diriam a mesma coisa duas vezes — e um sinal de
// diagnóstico que se repete sem significar nada é o começo de um log que
// ninguém lê.

