import { getSupabaseClient } from "./supabaseClient";

export function getActiveAiConfig() {
  const provider = localStorage.getItem("ai_active_provider") || "gemini";
  const apiKey = localStorage.getItem(`ai_${provider}_key`) || "";
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
  const token = await getSupabaseToken();
  const aiConfig = getActiveAiConfig();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Merge aiConfig into body
  const bodyObj = options.body || {};
  const body = JSON.stringify({ ...bodyObj, aiConfig });

  return fetch(url, {
    method: options.method || "GET",
    headers,
    body
  });
}
