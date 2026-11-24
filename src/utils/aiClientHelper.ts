import { getSupabaseClient } from "./supabaseClient";
import { urlDaApi, cabecalhosDaApi } from "./apiBase";
import { extrairCodigoUasg, normalizarCodigoUasg } from "./identificacaoEdital";

export function normalizeGeminiModelName(model?: string | null): string {
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

function normalizeModelForRemoteEdge(provider: string, model?: string | null): string {
  if (provider !== "gemini") return model || "";
  return normalizeGeminiModelName(model);
}

export function getActiveAiConfig() {
  const provider = localStorage.getItem("ai_active_provider") || "gemini";
  let apiKey = (localStorage.getItem(`ai_${provider}_key`) || "").trim();

  // Check fallback keys for active provider
  if (!apiKey) {
    if (provider === "gemini") {
      apiKey = (localStorage.getItem("gemini_api_key") || localStorage.getItem("GEMINI_API_KEY") || "").trim();
    } else if (provider === "openai") {
      apiKey = (localStorage.getItem("openai_api_key") || localStorage.getItem("OPENAI_API_KEY") || "").trim();
    } else if (provider === "anthropic") {
      apiKey = (localStorage.getItem("anthropic_api_key") || localStorage.getItem("ANTHROPIC_API_KEY") || "").trim();
    } else if (provider === "deepseek") {
      apiKey = (localStorage.getItem("deepseek_api_key") || localStorage.getItem("DEEPSEEK_API_KEY") || "").trim();
    }
  }

  // If still no key for chosen provider, check if ANY provider has a key in localStorage
  if (!apiKey) {
    const geminiKey = (
      localStorage.getItem("ai_gemini_key") ||
      localStorage.getItem("gemini_api_key") ||
      localStorage.getItem("GEMINI_API_KEY") ||
      ""
    ).trim();
    const openaiKey = (
      localStorage.getItem("ai_openai_key") ||
      localStorage.getItem("openai_api_key") ||
      localStorage.getItem("OPENAI_API_KEY") ||
      ""
    ).trim();
    const anthropicKey = (
      localStorage.getItem("ai_anthropic_key") ||
      localStorage.getItem("anthropic_api_key") ||
      localStorage.getItem("ANTHROPIC_API_KEY") ||
      ""
    ).trim();
    const deepseekKey = (
      localStorage.getItem("ai_deepseek_key") ||
      localStorage.getItem("deepseek_api_key") ||
      localStorage.getItem("DEEPSEEK_API_KEY") ||
      ""
    ).trim();

    if (geminiKey) {
      return {
        provider: "gemini",
        apiKey: geminiKey,
        model: normalizeGeminiModelName(localStorage.getItem("ai_gemini_model")),
      };
    }
    if (openaiKey) {
      return {
        provider: "openai",
        apiKey: openaiKey,
        model: localStorage.getItem("ai_openai_model") || "gpt-4o",
      };
    }
    if (anthropicKey) {
      return {
        provider: "anthropic",
        apiKey: anthropicKey,
        model: localStorage.getItem("ai_anthropic_model") || "claude-sonnet-5",
      };
    }
    if (deepseekKey) {
      return {
        provider: "deepseek",
        apiKey: deepseekKey,
        model: localStorage.getItem("ai_deepseek_model") || "deepseek-chat",
      };
    }
  }

  const rawModel = localStorage.getItem(`ai_${provider}_model`) || "";
  const model = provider === "gemini" ? normalizeGeminiModelName(rawModel) : rawModel;
  return { provider, apiKey, model };
}

/** Prefixo das chaves cifradas em repouso (ver src/utils/segredos.ts). */
export const PREFIXO_CHAVE_CIFRADA = "enc:v1:";

/** A chave está cifrada: só o servidor consegue lê-la, e isso é esperado. */
export function chaveEstaCifrada(valor: string | undefined | null): boolean {
  return String(valor || "").startsWith(PREFIXO_CHAVE_CIFRADA);
}

/**
 * Validates if a user-supplied API key has the correct format for the given provider.
 * When empty, returns null so the server can use its own GEMINI_API_KEY or encrypted user key.
 */
export function validateApiKeyFormat(apiKey: string, provider: string): string | null {
  const key = (apiKey || "").trim();
  if (!key || key.length < 10) {
    return `Chave de API não configurada. Acesse "IA & Modelos" no menu de Configurações e insira sua chave de API do ${provider === "gemini" ? "Google AI Studio" : provider}.`;
  }

  if (chaveEstaCifrada(key)) return null;

  if (provider === "gemini" && !key.startsWith("AIza") && !key.startsWith("AQ.")) {
    return `A chave do Gemini parece inválida — ela deve começar com "AIza" ou "AQ.". Verifique a chave em "IA & Modelos".`;
  }
  if (provider === "openai" && !key.startsWith("sk-")) {
    return `A chave do OpenAI parece inválida — ela deve começar com "sk-". Verifique a chave em "IA & Modelos".`;
  }
  if (provider === "anthropic" && !key.startsWith("sk-ant-")) {
    return `A chave do Anthropic (Claude) parece inválida — ela deve começar com "sk-ant-". Verifique a chave em "IA & Modelos".`;
  }

  return null;
}

/**
 * Returns a user-friendly error message for AI errors.
 */
export function formatAiError(error: any): string {
  const msg = (error?.message || String(error || "")).toLowerCase();

  if (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("api_key_invalid") ||
    msg.includes("permission_denied") ||
    msg.includes("unauthenticated") ||
    msg.includes("invalid api key") ||
    msg.includes("api key not valid")
  ) {
    return '❌ Chave de API inválida ou sem permissão. Acesse "IA & Modelos" e verifique/atualize sua chave.';
  }
  if (
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("insufficient balance")
  ) {
    return '⚠️ Limite de requisições atingido (cota excedida). Aguarde alguns instantes e tente novamente, ou troque o modelo em "IA & Modelos".';
  }
  if (
    msg.includes("503") ||
    msg.includes("unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("high demand")
  ) {
    return "⚠️ O serviço de IA está sobrecarregado no momento. Aguarde alguns segundos e tente novamente.";
  }
  if (
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("timeout") ||
    msg.includes("aborted")
  ) {
    return "🌐 Sem conexão com o servidor. Verifique sua internet e se o servidor está online.";
  }
  if (msg.includes("nenhuma chave") || msg.includes("não configurada") || msg.includes("not configured")) {
    return '⚙️ Nenhuma chave de API configurada. Acesse "IA & Modelos" e insira sua chave.';
  }

  const original = error?.message || String(error || "Erro desconhecido.");
  return original.length < 300 ? original : "Erro ao processar a solicitação. Tente novamente.";
}

export async function readJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const snippet = text
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    throw new Error(
      `O servidor respondeu HTTP ${response.status} sem JSON — a rota /api falhou antes de chegar na IA.` +
        (snippet ? ` Resposta do servidor: "${snippet}"` : "")
    );
  }
}

export async function readJsonResponseSafe(response: Response): Promise<any> {
  try {
    return await readJsonResponse(response);
  } catch (err: any) {
    return { error: err?.message || `Erro HTTP ${response.status}.` };
  }
}

// Get the current Supabase session JWT (used to authenticate server-side AI calls)
export async function getSupabaseToken(): Promise<string> {
  try {
    const client = getSupabaseClient();
    if (!client) return "";
    const { data } = await client.auth.getSession();
    return data?.session?.access_token || "";
  } catch {
    return "";
  }
}

function cleanAndParseJsonFallback(text: string): any {
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
    return {};
  }
}

function normalizeEditalAnalysisFallback(parsedData: any, rawTextInput = ""): any {
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
  result.itensEdital = Array.isArray(result.itensEdital) ? result.itensEdital : [];

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
  return result;
}

const SERVER_AI_ROUTES = new Set([
  "/api/ai-status",
  "/api/chat",
  "/api/chat/title",
  "/api/analyze-cert",
  "/api/generate-cert-description",
  "/api/generate-document",
  "/api/compare-products",
  "/api/analyze-competitor",
  "/api/analyze-edital",
  "/api/upload-chunk/init",
  "/api/upload-chunk",
]);

// Authenticated fetch wrapper: sends requests to the backend server (/api/*) with automatic fallback
export async function apiFetch(
  url: string,
  options: { method?: string; body?: Record<string, any>; headers?: Record<string, string>; signal?: AbortSignal } = {}
): Promise<Response> {
  try {
    const token = await getSupabaseToken();
    const aiConfig = getActiveAiConfig();
    const bodyObj = options.body || {};
    const rawAiConfig = bodyObj.aiConfig || aiConfig;

    const cleanPath = url.replace(/^https?:\/\/[^/]+(\/functions\/v1)?/, "").split("?")[0];
    const isServerAiRoute = SERVER_AI_ROUTES.has(cleanPath);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...cabecalhosDaApi(),
      ...(options.headers || {}),
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const method = options.method || "GET";
    const remoteAiConfig = rawAiConfig
      ? {
          ...rawAiConfig,
          model: normalizeModelForRemoteEdge(rawAiConfig.provider || "gemini", rawAiConfig.model),
        }
      : aiConfig;

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: options.signal,
    };

    if (method !== "GET" && method !== "HEAD") {
      fetchOptions.body = JSON.stringify({ ...bodyObj, aiConfig: remoteAiConfig });
    }

    // 1. Call the app's own Node.js server endpoint (/api/...) first for AI routes
    if (isServerAiRoute && url.startsWith("/api/")) {
      try {
        const localResp = await fetch(url, fetchOptions);
        const contentType = localResp.headers.get("content-type") || "";
        // Ensure it hit the Express API route and not an HTML SPA fallback
        if (localResp.status !== 404 && contentType.includes("application/json")) {
          return localResp;
        }
      } catch {
        // Fall through to Supabase Edge Function URL if local server is not running
      }
    }

    // 2. Fallback to Supabase Edge Function URL
    const response = await fetch(urlDaApi(url), fetchOptions);

    if (cleanPath === "/api/analyze-edital" && response.ok) {
      const cloned = response.clone();
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
          ];
          const firstFileWithB64 = allFiles.find((f: any) => f && (f.base64 || f.fileBase64 || f.data));
          const chatMessages: any[] = [
            {
              role: "user",
              content: `Analise o Edital anexado e retorne EXCLUSIVAMENTE um JSON válido com identificacaoCertame, itensEdital, documentosExigidos, viabilidadeFinanceira, logisticaCronograma, especificacoesTecnicas, burocraciaBarreiras, parecerFinal, dossieExecutivo e reportMarkdown.\n${String(bodyObj.textInput || "")}`,
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

          const chatResp = await fetch(urlDaApi("/api/chat"), {
            method: "POST",
            headers,
            signal: options.signal,
            body: JSON.stringify({
              messages: chatMessages,
              aiConfig: remoteAiConfig,
            }),
          });

          if (chatResp.ok) {
            const chatJson = await chatResp.json().catch(() => null);
            if (chatJson?.reply && !chatJson?.degraded) {
              const parsed = cleanAndParseJsonFallback(chatJson.reply);
              if (parsed && Object.keys(parsed).length > 2) {
                const normalized = normalizeEditalAnalysisFallback(parsed, String(bodyObj.textInput || ""));
                if (jsonData.analysis?.dadosOficiaisPNCP) {
                  normalized.dadosOficiaisPNCP = jsonData.analysis.dadosOficiaisPNCP;
                }
                return new Response(JSON.stringify({ analysis: normalized }), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                });
              }
            }
          }
        } catch (recoverErr) {
          console.warn("[apiFetch] Falha na recuperação de analyze-edital via /api/chat:", recoverErr);
        }
      }
    }

    return response;
  } catch (error: any) {
    if (error?.message?.includes("Failed to fetch") || error?.message?.includes("fetch")) {
      console.warn(`[apiFetch Network Warning] Failed request to ${url} (server offline or restarting):`, error?.message);
    } else {
      console.error(`[apiFetch Error] Failed request to ${url}:`, {
        url,
        method: options.method || "GET",
        errorMsg: error?.message,
        error,
      });
    }
    throw error;
  }
}

// Chunked file upload helper for large files (> 2MB) to prevent HTTP 413 Payload Too Large
export async function prepareAttachmentForServer(fileObj: any): Promise<any> {
  if (!fileObj) return fileObj;

  const base64Str = fileObj.base64 || fileObj.fileBase64 || fileObj.data || "";
  if (fileObj.uploadId || !base64Str || base64Str.length < 3 * 1024 * 1024) {
    return fileObj;
  }

  try {
    const fileName = fileObj.name || fileObj.fileName || "arquivo";
    const fileType = fileObj.type || fileObj.fileType || "application/pdf";

    const initRes = await apiFetch("/api/upload-chunk/init", {
      method: "POST",
      body: { name: fileName, type: fileType },
    });

    if (!initRes.ok) {
      console.warn("Falha ao inicializar upload por partes, enviando formato bruto.");
      return fileObj;
    }

    const { uploadId } = await initRes.json();
    if (!uploadId) return fileObj;

    const chunkSize = 2.5 * 1024 * 1024;
    const totalChunks = Math.ceil(base64Str.length / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const chunkBase64 = base64Str.slice(i * chunkSize, (i + 1) * chunkSize);
      const chunkRes = await apiFetch("/api/upload-chunk", {
        method: "POST",
        body: {
          uploadId,
          chunkIndex: i,
          totalChunks,
          chunkBase64,
        },
      });
      if (!chunkRes.ok) {
        throw new Error(`Falha no envio do bloco ${i + 1}/${totalChunks}`);
      }
    }

    const { base64, fileBase64, data, ...rest } = fileObj;
    return {
      ...rest,
      name: fileName,
      type: fileType,
      uploadId,
    };
  } catch (err: any) {
    console.error("Upload em partes falhou, enviando diretamente:", err);
    return fileObj;
  }
}

export async function prepareAttachmentsForServer(attachments: any[]): Promise<any[]> {
  if (!Array.isArray(attachments)) return [];
  const processed = [];
  for (const att of attachments) {
    processed.push(await prepareAttachmentForServer(att));
  }
  return processed;
}
