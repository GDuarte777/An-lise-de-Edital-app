import { getSupabaseClient } from "./supabaseClient";

export function getActiveAiConfig() {
  const provider = localStorage.getItem("ai_active_provider") || "gemini";
  const apiKey = (localStorage.getItem(`ai_${provider}_key`) || "").trim();
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
export async function apiFetch(url: string, options: { method?: string; body?: Record<string, any>; headers?: Record<string, string> } = {}): Promise<Response> {
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
    };

    if (method !== "GET" && method !== "HEAD") {
      const bodyObj = options.body || {};
      const finalAiConfig = bodyObj.aiConfig || aiConfig;
      fetchOptions.body = JSON.stringify({ ...bodyObj, aiConfig: finalAiConfig });
    }

    const response = await fetch(url, fetchOptions);

    const hasUserKey = aiConfig?.apiKey && aiConfig.apiKey.trim().length > 10;

    if (response.status === 429) {
      if (typeof window !== "undefined") {
        const message = hasUserKey
          ? "A sua chave de API personalizada atingiu o limite de cota (429 Rate Limit). Verifique o saldo ou limites da sua conta no Google AI Studio."
          : "A chave de API gratuita e compartilhada do servidor atingiu o limite de cota (429 Rate Limit). Para continuar usando com velocidade ilimitada, por favor insira sua própria chave de API na aba 'IA & Modelos'.";
        window.dispatchEvent(new CustomEvent("ai-quota-warning", {
          detail: { message }
        }));
      }
    } else if (!response.ok) {
      // Clone response to check body for quota-related error messages in JSON
      try {
        const cloned = response.clone();
        cloned.json().then(data => {
          const errorMsg = data?.error?.message || data?.error || "";
          if (errorMsg && (
            errorMsg.toLowerCase().includes("quota") ||
            errorMsg.toLowerCase().includes("rate limit") ||
            errorMsg.toLowerCase().includes("429") ||
            errorMsg.toLowerCase().includes("limit exceeded")
          )) {
            if (typeof window !== "undefined") {
              const message = hasUserKey
                ? "A sua chave de API personalizada atingiu o limite de cota (429 Rate Limit). Verifique o saldo ou limites da sua conta no Google AI Studio."
                : "A chave de API gratuita e compartilhada do servidor atingiu o limite de cota (429 Rate Limit). Para continuar usando com velocidade ilimitada, por favor insira sua própria chave de API na aba 'IA & Modelos'.";
              window.dispatchEvent(new CustomEvent("ai-quota-warning", {
                detail: { message }
              }));
            }
          }
        }).catch(() => {});
      } catch (err) {
        // Safe catch
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
        error
      });
    }
    throw error;
  }
}
