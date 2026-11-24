// ═══════════════════════════════════════════════════════════════════════
// MODELOS DO GEMINI: QUAIS EXISTEM, E EM QUE ORDEM TENTAR
//
// Este módulo não importa nada. É de propósito: a escolha de modelo já derrubou
// o chat em produção duas vezes — uma por pedir um modelo que a chave não serve,
// outra por tentar seis modelos contra um limite de cinco requisições por minuto
// — e código sem dependência é código que o conjunto de testes do projeto
// consegue cobrir.
// ═══════════════════════════════════════════════════════════════════════
import process from "node:process";

export const VALID_GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.8-flash",
  "gemini-3.8-flash-lite",
  "gemini-4-hydrogen",
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-4-neon"
];

export const MAX_CHAMADAS_PROVEDOR = Number(process.env.AI_MAX_CHAMADAS_PROVEDOR || 3);

export const TIMEOUT_POR_CHAMADA_MS = Number(process.env.AI_TIMEOUT_POR_CHAMADA_MS || 25_000);

export const GEMINI_MODEL_ALIASES: Record<string, string> = {
  "flash": "gemini-3.5-flash",
  "gemini-flash": "gemini-3.5-flash",
  "gemini-flash-latest": "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest": "gemini-3.5-flash-lite",
  "pro": "gemini-3.1-pro-preview",
  "gemini-pro": "gemini-3.1-pro-preview",
  "gemini-3.1-pro": "gemini-3.1-pro-preview",
  "gemini-3.7-pro": "gemini-3.1-pro-preview",
  "lite": "gemini-3.5-flash-lite",
  "flash-lite": "gemini-3.5-flash-lite",
  "gemini-lite": "gemini-3.5-flash-lite",
  "gemini-flash-lite": "gemini-3.5-flash-lite",
  "gemini-3.7-flash": "gemini-3.5-flash-lite",
  "gemini-3.6-flash": "gemini-3.5-flash-lite",
  "2.5-flash": "gemini-3.5-flash-lite",
  "2.5-flash-lite": "gemini-3.5-flash-lite",
  "gemini-2.5-flash": "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
  "gemini-2.5-pro": "gemini-3.1-pro-preview",
  "gemini-2.0-flash": "gemini-3.5-flash-lite",
  "gemini-2.0-flash-lite": "gemini-3.5-flash-lite",
  "gemini-1.5-flash": "gemini-3.5-flash-lite",
  "gemini-1.5-pro": "gemini-3.1-pro-preview"
};

export function normalizeGeminiModel(model: string | undefined): string {
  if (!model) return "gemini-3.5-flash-lite";
  const trimmed = model.trim().toLowerCase();
  if (VALID_GEMINI_MODELS.includes(trimmed)) return trimmed;
  if (GEMINI_MODEL_ALIASES[trimmed]) return GEMINI_MODEL_ALIASES[trimmed];
  return "gemini-3.5-flash-lite";
}

// Lista de fallback: mantém o modelo escolhido pelo usuário em primeiro lugar e,
// em caso de 429/503, rotaciona por modelos de famílias e cotas diferentes.
export function getFallbackModels(primaryModel: string): string[] {
  const normPrimary = normalizeGeminiModel(primaryModel);
  const baseList = [
    normPrimary,
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite"
  ];
  return Array.from(new Set(baseList.filter(Boolean))).slice(0, MAX_CHAMADAS_PROVEDOR);
}
