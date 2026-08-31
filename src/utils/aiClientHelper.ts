import { getSupabaseClient } from "./supabaseClient";

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
    const geminiKey = (localStorage.getItem("ai_gemini_key") || localStorage.getItem("gemini_api_key") || localStorage.getItem("GEMINI_API_KEY") || "").trim();
    const openaiKey = (localStorage.getItem("ai_openai_key") || localStorage.getItem("openai_api_key") || localStorage.getItem("OPENAI_API_KEY") || "").trim();
    const anthropicKey = (localStorage.getItem("ai_anthropic_key") || localStorage.getItem("anthropic_api_key") || localStorage.getItem("ANTHROPIC_API_KEY") || "").trim();
    const deepseekKey = (localStorage.getItem("ai_deepseek_key") || localStorage.getItem("deepseek_api_key") || localStorage.getItem("DEEPSEEK_API_KEY") || "").trim();

    if (geminiKey) {
      return { provider: "gemini", apiKey: geminiKey, model: localStorage.getItem("ai_gemini_model") || "gemini-3.6-flash" };
    }
    if (openaiKey) return { provider: "openai", apiKey: openaiKey, model: localStorage.getItem("ai_openai_model") || "gpt-4o" };
    if (anthropicKey) return { provider: "anthropic", apiKey: anthropicKey, model: localStorage.getItem("ai_anthropic_model") || "claude-sonnet-5" };
    if (deepseekKey) return { provider: "deepseek", apiKey: deepseekKey, model: localStorage.getItem("ai_deepseek_model") || "deepseek-chat" };
  }

  const model = localStorage.getItem(`ai_${provider}_model`) || "";
  return { provider, apiKey, model };
}

/**
 * Validates if an API key has the correct format for the given provider.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateApiKeyFormat(apiKey: string, provider: string): string | null {
  const key = (apiKey || "").trim();
  if (!key || key.length < 10) {
    return `Chave de API não configurada. Acesse "IA & Modelos" no menu de Configurações e insira sua chave de API do ${provider === "gemini" ? "Google AI Studio" : provider}.`;
  }

  // O Google emite chaves do Gemini em dois formatos:
  //  - "AIza..."  → chave de API clássica
  //  - "AQ.Ab8..." → nova "auth key" gerada pelo AI Studio (formato padrão desde 2026)
  // Ambos são aceitos pelo endpoint generativelanguage.googleapis.com.
  if (provider === "gemini" && !key.startsWith("AIza") && !key.startsWith("AQ.")) {
    return `A chave do Gemini parece inválida — ela deve começar com "AIza" ou "AQ.". Verifique a chave em "IA & Modelos".`;
  }
  if (provider === "openai" && !key.startsWith("sk-")) {
    return `A chave do OpenAI parece inválida — ela deve começar com "sk-". Verifique a chave em "IA & Modelos".`;
  }
  if (provider === "anthropic" && !key.startsWith("sk-ant-")) {
    return `A chave do Anthropic (Claude) parece inválida — ela deve começar com "sk-ant-". Verifique a chave em "IA & Modelos".`;
  }

  return null; // key looks valid
}

/**
 * Returns a user-friendly error message for AI errors.
 */
export function formatAiError(error: any): string {
  const msg = (error?.message || String(error || "")).toLowerCase();

  if (msg.includes("401") || msg.includes("403") || msg.includes("api_key_invalid") ||
      msg.includes("permission_denied") || msg.includes("unauthenticated") ||
      msg.includes("invalid api key") || msg.includes("api key not valid")) {
    return "❌ Chave de API inválida ou sem permissão. Acesse \"IA & Modelos\" e verifique/atualize sua chave.";
  }
  if (msg.includes("429") || msg.includes("quota") || msg.includes("resource_exhausted") ||
      msg.includes("rate limit") || msg.includes("insufficient balance")) {
    return "⚠️ Limite de requisições atingido (cota excedida). Aguarde alguns instantes e tente novamente, ou troque o modelo em \"IA & Modelos\".";
  }
  if (msg.includes("503") || msg.includes("unavailable") || msg.includes("overloaded") ||
      msg.includes("high demand")) {
    return "⚠️ O serviço de IA está sobrecarregado no momento. Aguarde alguns segundos e tente novamente.";
  }
  if (msg.includes("network") || msg.includes("failed to fetch") || msg.includes("econnrefused") ||
      msg.includes("enotfound") || msg.includes("timeout") || msg.includes("aborted")) {
    return "🌐 Sem conexão com o servidor. Verifique sua internet e se o servidor está online.";
  }
  if (msg.includes("nenhuma chave") || msg.includes("não configurada") || msg.includes("not configured")) {
    return "⚙️ Nenhuma chave de API configurada. Acesse \"IA & Modelos\" e insira sua chave.";
  }

  // Return the original message if it's already friendly (starts with ❌/⚠️/etc)
  const original = error?.message || String(error || "Erro desconhecido.");
  return original.length < 300 ? original : "Erro ao processar a solicitação. Tente novamente.";
}

/**
 * Lê o corpo da resposta como JSON.
 *
 * Quando a hospedagem devolve a própria página de erro (HTML ou texto puro, como
 * "A server error has occurred"), `response.json()` estoura com
 * "Unexpected token 'A'... is not valid JSON" — uma mensagem que não diz nada sobre
 * o que de fato aconteceu. Aqui o corpo é lido como texto primeiro, para o erro
 * carregar o status HTTP e o início da resposta real.
 */
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

/** Igual à anterior, mas nunca lança — para ramos que só querem extrair a mensagem de erro. */
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

// Authenticated fetch wrapper: automatically sends JWT + aiConfig on every AI request
export async function apiFetch(url: string, options: { method?: string; body?: Record<string, any>; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<Response> {
  try {
    const token = await getSupabaseToken();
    const aiConfig = getActiveAiConfig();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const method = options.method || "GET";
    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: options.signal,
    };

    if (method !== "GET" && method !== "HEAD") {
      const bodyObj = options.body || {};
      const finalAiConfig = bodyObj.aiConfig || aiConfig;
      fetchOptions.body = JSON.stringify({ ...bodyObj, aiConfig: finalAiConfig });
    }

    const response = await fetch(url, fetchOptions);
    return response;
  } catch (error: any) {
    if (error?.message?.includes("Failed to fetch") || error?.message?.includes("fetch")) {
      console.warn(`[apiFetch Network Warning] Failed request to ${url} (server offline or restarting):`, error?.message);
    } else {
      console.error(`[apiFetch Error] Failed request to ${url}:`, {
        url,
        method: options.method || "GET",
        errorMsg: error?.message,
        error
      });
    }
    throw error;
  }
}

// Chunked file upload helper for large files (> 2MB) to prevent HTTP 413 Payload Too Large
export async function prepareAttachmentForServer(fileObj: any): Promise<any> {
  if (!fileObj) return fileObj;

  const base64Str = fileObj.base64 || fileObj.fileBase64 || fileObj.data || "";
  // If no base64, or small base64 (< 3MB base64 string ~ 2.2MB binary), or already has uploadId
  if (fileObj.uploadId || !base64Str || base64Str.length < 3 * 1024 * 1024) {
    return fileObj;
  }

  // Large file (> 2.2MB binary) -> upload in 2.5MB base64 chunks to /api/upload-chunk
  try {
    const fileName = fileObj.name || fileObj.fileName || "arquivo";
    const fileType = fileObj.type || fileObj.fileType || "application/pdf";

    const initRes = await apiFetch("/api/upload-chunk/init", {
      method: "POST",
      body: { name: fileName, type: fileType }
    });

    if (!initRes.ok) {
      console.warn("Falha ao inicializar upload por partes, enviando formato bruto.");
      return fileObj;
    }

    const { uploadId } = await initRes.json();
    if (!uploadId) return fileObj;

    const chunkSize = 2.5 * 1024 * 1024; // 2.5MB base64 slice (~1.8MB per chunk)
    const totalChunks = Math.ceil(base64Str.length / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const chunkBase64 = base64Str.slice(i * chunkSize, (i + 1) * chunkSize);
      const chunkRes = await apiFetch("/api/upload-chunk", {
        method: "POST",
        body: {
          uploadId,
          chunkIndex: i,
          totalChunks,
          chunkBase64
        }
      });
      if (!chunkRes.ok) {
        throw new Error(`Falha no envio do bloco ${i + 1}/${totalChunks}`);
      }
    }

    // Return sanitized object with uploadId and without the giant base64 payload
    const { base64, fileBase64, data, ...rest } = fileObj;
    return {
      ...rest,
      name: fileName,
      type: fileType,
      uploadId
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

