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

    if (geminiKey) return { provider: "gemini", apiKey: geminiKey, model: localStorage.getItem("ai_gemini_model") || "gemini-3.6-flash" };
    if (openaiKey) return { provider: "openai", apiKey: openaiKey, model: localStorage.getItem("ai_openai_model") || "gpt-4o" };
    if (anthropicKey) return { provider: "anthropic", apiKey: anthropicKey, model: localStorage.getItem("ai_anthropic_model") || "claude-3-7-sonnet-20250219" };
    if (deepseekKey) return { provider: "deepseek", apiKey: deepseekKey, model: localStorage.getItem("ai_deepseek_model") || "deepseek-chat" };
  }

  const model = localStorage.getItem(`ai_${provider}_model`) || "";
  return { provider, apiKey, model };
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

