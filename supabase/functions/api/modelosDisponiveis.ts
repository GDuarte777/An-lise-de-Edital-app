// ═══════════════════════════════════════════════════════════════════════
// QUAIS MODELOS ESTA CHAVE REALMENTE SERVE
//
// A lista de modelos do Gemini era fixa no código, e isso já tirou a IA do ar
// três vezes seguidas: gemini-3.7-flash, depois 3.6, depois 3.8 e
// gemini-flash-latest. O sintoma é sempre o mesmo e engana:
//
//   chamada 1/3  gemini-3.8-flash       -> 503 "high demand"      em 0,5 s
//   chamada 3/3  gemini-flash-latest    -> 503 "high demand"      em 0,5 s
//
// Sobrecarga de verdade demora e oscila. Um 503 que volta em meio segundo,
// sempre, para nomes diferentes, é o que o Google responde quando a chave NÃO
// SERVE aquele modelo — ele devolve 503, e não 404, então a indisponibilidade
// permanente se disfarça de pico passageiro e o código insiste nela.
//
// A única fonte confiável de quais modelos uma chave serve é a própria API.
// Perguntar custa uma chamada curta, fica em cache, e encerra o ciclo de
// adivinhar nome de modelo a cada vez que o Google renomeia a família.
// ═══════════════════════════════════════════════════════════════════════
import process from "node:process";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = Number(process.env.AI_MODELOS_TIMEOUT_MS || 6_000);
/** Quanto tempo a lista descoberta vale. O catálogo muda em semanas, não em minutos. */
const TTL_MS = Number(process.env.AI_MODELOS_TTL_MS || 10 * 60_000);

interface Cacheado {
  modelos: string[];
  quando: number;
}

const cache = new Map<string, Cacheado>();

/** Identifica a chave no cache sem guardar a chave em si. */
function impressao(apiKey: string): string {
  let h = 0;
  for (let i = 0; i < apiKey.length; i++) {
    h = (h * 31 + apiKey.charCodeAt(i)) | 0;
  }
  return String(h);
}

/**
 * Pergunta à API do Gemini quais modelos esta chave pode usar para gerar texto.
 *
 * Devolve `null` quando não dá para saber — rede, cota, chave inválida. Nesse
 * caso quem chama mantém o comportamento antigo: é melhor tentar a lista fixa
 * do que não tentar nada.
 */
export async function descobrirModelos(apiKey: string): Promise<string[] | null> {
  const chaveCache = impressao(apiKey);
  const guardado = cache.get(chaveCache);
  if (guardado && Date.now() - guardado.quando < TTL_MS) return guardado.modelos;

  try {
    const controle = new AbortController();
    const prazo = setTimeout(() => controle.abort(), TIMEOUT_MS);
    const resp = await fetch(`${BASE}?key=${encodeURIComponent(apiKey)}&pageSize=200`, {
      signal: controle.signal,
    });
    clearTimeout(prazo);

    if (!resp.ok) {
      console.warn(`[modelos] ListModels respondeu ${resp.status}`);
      return null;
    }

    const dados = await resp.json();
    const lista: string[] = (dados?.models || [])
      .filter((m: any) => Array.isArray(m?.supportedGenerationMethods)
        && m.supportedGenerationMethods.includes("generateContent"))
      .map((m: any) => String(m?.name || "").replace(/^models\//, ""))
      .filter(Boolean);

    if (lista.length === 0) {
      console.warn("[modelos] ListModels não devolveu nenhum modelo com generateContent");
      return null;
    }

    cache.set(chaveCache, { modelos: lista, quando: Date.now() });
    console.log(`[modelos] ${lista.length} modelos disponíveis para esta chave`);
    return lista;
  } catch (erro: any) {
    console.warn("[modelos] falha ao consultar ListModels:", erro?.message || erro);
    return null;
  }
}

/** Ordena do mais barato/liberado para o mais caro, dentro do que existe. */
function pontuar(nome: string): number {
  const n = nome.toLowerCase();
  if (n.includes("embedding") || n.includes("aqa") || n.includes("imagen") || n.includes("veo")) return -1;
  // Flash Lite primeiro: no plano gratuito ele tem o triplo do limite por
  // minuto do Flash, e é o que mantém o chat respondendo sob pressão.
  if (n.includes("flash-lite")) return 100;
  if (n.includes("flash")) return 80;
  if (n.includes("pro")) return 40;
  return 10;
}

/** Entre os modelos preferidos e os realmente disponíveis, monta a cadeia a tentar. */
export function escolherCadeia(
  preferido: string,
  disponiveis: string[] | null,
  maximo: number
): string[] {
  if (!disponiveis || disponiveis.length === 0) return [];

  const existe = (nome: string) => disponiveis.some((d) => d === nome);

  const cadeia: string[] = [];
  // O modelo que o usuário escolheu vem primeiro — mas só se a chave o servir.
  if (preferido && existe(preferido)) cadeia.push(preferido);

  const candidatos = disponiveis
    .filter((m) => pontuar(m) > 0 && !m.includes("-preview") && !m.includes("exp"))
    .sort((a, b) => pontuar(b) - pontuar(a) || a.localeCompare(b));

  for (const m of candidatos) {
    if (cadeia.length >= maximo) break;
    if (!cadeia.includes(m)) cadeia.push(m);
  }

  return cadeia.slice(0, maximo);
}
