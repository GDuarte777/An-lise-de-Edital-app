export function getActiveAiConfig() {
  const provider = localStorage.getItem("ai_active_provider") || "gemini";
  const apiKey = localStorage.getItem(`ai_${provider}_key`) || "";
  const model = localStorage.getItem(`ai_${provider}_model`) || "";
  return { provider, apiKey, model };
}
