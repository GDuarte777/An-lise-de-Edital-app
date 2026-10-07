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
  "gemini-3.8-flash",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
  "gemini-3.1-pro-preview"
];

/**
 * Teto de chamadas ao provedor POR REQUISIÇÃO do usuário.
 *
 * O limite do plano gratuito que realmente aperta não é o diário, é o de
 * REQUISIÇÕES POR MINUTO: 5 no Flash. A cadeia de fallback disparava até doze
 * chamadas para uma única mensagem de chat (seis modelos, duas tentativas cada,
 * mais a repetição sem busca web), e a rota de título disparava outra cadeia em
 * paralelo. Da sexta chamada em diante o Google recusava com 429 — ou seja, a
 * plataforma produzia o próprio estouro de limite e depois esperava por ele.
 *
 * Com teto de três, uma mensagem cabe folgadamente dentro de 5/min mesmo
 * contando o título, e sobra limite para o usuário mandar a próxima.
 */
export const MAX_CHAMADAS_PROVEDOR = Number(process.env.AI_MAX_CHAMADAS_PROVEDOR || 3);

/**
 * Teto de tempo de UMA chamada ao provedor.
 *
 * O timeout por chamada era "todo o tempo que sobrar do orçamento", então uma
 * única requisição travada consumia os 60 s inteiros: no log de produção, a
 * segunda tentativa ficou 47 segundos pendurada e morreu no abort, sem que o
 * modelo reserva — que tem três vezes mais folga de limite — chegasse a ser
 * tentado. Um modelo que não responde em 20 s não vai responder em 60.
 */
export const TIMEOUT_POR_CHAMADA_MS = Number(process.env.AI_TIMEOUT_POR_CHAMADA_MS || 20_000);

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
  // Modelos aposentados → apontam para o substituto recomendado pelo próprio Google.
  //
  // 3.7, 3.6 e 3.5 entraram nesta lista por evidência de produção: o painel de
  // limites do projeto só expõe "3.8 Flash" e "3.1 Flash Lite", e toda chamada a
  // gemini-3.7-flash voltou 503 "high demand" — dias seguidos, em todas as
  // tentativas. O Google responde 503, e não 404, para um modelo que a chave não
  // serve, então a indisponibilidade parecia sobrecarga passageira e a plataforma
  // insistia nela até o orçamento acabar.
  "gemini-3.7-flash": "gemini-3.8-flash",
  "gemini-3.6-flash": "gemini-3.8-flash",
  "gemini-3.5-flash": "gemini-3.8-flash",
  "gemini-3.5-flash-lite": "gemini-3.1-flash-lite",
  "gemini-2.5-flash": "gemini-3.8-flash",
  "2.5-flash": "gemini-3.8-flash",
  "gemini-2.5-flash-lite": "gemini-3.1-flash-lite",
  "2.5-flash-lite": "gemini-3.1-flash-lite",
  "gemini-2.5-pro": "gemini-3.1-pro-preview"
};

export function normalizeGeminiModel(model: string | undefined): string {
  if (!model) return "gemini-3.8-flash";
  const trimmed = model.trim().toLowerCase();
  if (VALID_GEMINI_MODELS.includes(trimmed)) return trimmed;
  if (GEMINI_MODEL_ALIASES[trimmed]) return GEMINI_MODEL_ALIASES[trimmed];
  return "gemini-3.8-flash";
}

// Lista de fallback: mantém o modelo escolhido pelo usuário em primeiro lugar e,
// em caso de 429/503, rotaciona por modelos de famílias e cotas diferentes.
export function getFallbackModels(primaryModel: string): string[] {
  const normPrimary = normalizeGeminiModel(primaryModel);
  // O primeiro reserva é o Flash Lite de propósito: no plano gratuito ele tem
  // 15 req/min e 500 por dia, contra 5/min e 20/dia do Flash. Quando o Flash
  // recusa por limite de taxa, trocar para outro Flash encontra o mesmo teto —
  // quem tem folga é o Lite.
  //
  // A lista é curta porque cada entrada é uma chamada a mais contra um limite de
  // 5 por minuto: uma cadeia longa não aumenta a chance de sucesso, ela consome
  // o limite que a própria requisição seguinte vai precisar.
  const baseList = [
    normPrimary,
    "gemini-3.1-flash-lite",
    "gemini-flash-latest"
  ];
  return Array.from(new Set(baseList.filter(Boolean)));
}
