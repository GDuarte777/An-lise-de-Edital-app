/**
 * Tradutor entre o que o portal manda e o que o motor entende.
 *
 * Duas regras governam este arquivo:
 *
 *  1. Campo que não pôde ser lido vira `null` e entra em `camposIlegiveis` — nunca zero,
 *     nunca "true por padrão". Zero em dinheiro e `true` em "aceita lance" são os dois
 *     palpites que custam lance errado.
 *  2. Os nomes de campo do portal ficam numa tabela só (`ALIASES`), marcada [inferido]
 *     onde ainda não vimos captura real. Quando a primeira disputa de verdade mostrar o
 *     nome certo, muda-se a tabela e nada mais.
 */
import { paraMicroDeTexto, type Micro } from "./decimal.js";
import type { EstadoItem } from "./estrategias.js";

/** [inferido] Nomes candidatos para cada campo, em ordem de preferência. */
export const ALIASES = {
  numero: ["numeroItem", "numero", "item", "idItem", "codigoItem"],
  melhorValor: ["valorMelhorLance", "melhorLance", "valorMenorLance", "menorLance", "melhorValor"],
  nossoValor: ["valorMeuLance", "meuLance", "valorUltimoLanceFornecedor", "meuMelhorLance"],
  aceitaLance: ["aceitaLance", "permiteLance", "itemAceitaLance"],
  situacao: ["situacaoItem", "situacao", "faseItem", "fase", "statusItem"],
  variacaoMelhorLance: [
    "valorVariacaoMinimaMelhorLance",
    "variacaoMinimaMelhorLance",
    "variacaoMelhorLance"
  ],
  variacaoFornecedor: [
    "valorVariacaoMinimaMesmoFornecedor",
    "variacaoMinimaEntreLancesMesmoFornecedor",
    "variacaoMinimaFornecedor"
  ],
  dizima: ["permitirDizima", "permiteDizima", "aceitaDizima"],
  segundos: ["segundosRestantes", "tempoRestanteSegundos", "tempoRestante"],
  milissegundos: ["tempoRestanteMs", "milissegundosRestantes"],
  encerramento: ["dataHoraEncerramento", "horaEncerramento", "dataEncerramento", "fimDisputa"],
  compra: ["numeroCompra", "idCompra", "compra", "numeroProcesso"],
  descricao: ["descricaoItem", "descricao", "objeto", "nomeItem", "especificacao"],
  posicao: ["posicao", "classificacao", "colocacao", "posicaoFornecedor"]
} as const;

export interface LeituraItem {
  estado: EstadoItem;
  /**
   * O que o portal disse sobre "aceita lance" e "permite dízima" nesta mensagem, antes de
   * virar booleano. `null` significa "esta mensagem não falou do assunto" — e é diferente
   * de `false`: evento parcial não pode apagar o que já se sabia (ver `fundir` no motor).
   */
  aceitaLida: boolean | null;
  dizimaLida: boolean | null;
  /** Vai no corpo do lance (`faseItem`). `null` quando o portal não disse. */
  fase: string | null;
  compra: string | null;
  /** Texto do item, só para a tela. Nada aqui entra em decisão. */
  descricao: string | null;
  recebidoEm: number;
  /** O que não pôde ser lido. A UI mostra isto em vez de inventar número. */
  camposIlegiveis: string[];
}

function objeto(bruto: unknown): Record<string, unknown> | null {
  return bruto && typeof bruto === "object" && !Array.isArray(bruto)
    ? (bruto as Record<string, unknown>)
    : null;
}

/** Primeiro alias presente com valor não-nulo. */
function campo(fonte: Record<string, unknown>, nomes: readonly string[]): unknown {
  for (const nome of nomes) {
    const v = fonte[nome];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/** Dinheiro: número ou texto. Zero e negativo viram `null` — não são preço. */
export function lerDinheiro(valor: unknown): Micro | null {
  let micro: Micro | null = null;
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return null;
    // Passa por texto de propósito: `toFixed` é exato até 4 casas e evita o caminho
    // float de multiplicar por 10.000.
    micro = paraMicroDeTexto(valor.toFixed(4));
  } else {
    micro = paraMicroDeTexto(valor);
  }
  if (micro === null || micro <= 0n) return null;
  return micro;
}

/** Posição na classificação. Zero, negativo ou ilegível viram `null`, nunca "1º". */
export function lerPosicao(valor: unknown): number | null {
  const n = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor.replace(/\D/g, "")) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
}

/** Booleano explícito. Texto "true"/"false"/"S"/"N" também vale; o resto é `null`. */
export function lerBooleano(valor: unknown): boolean | null {
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "string") {
    const t = valor.trim().toLowerCase();
    if (["true", "sim", "s", "1"].includes(t)) return true;
    if (["false", "nao", "não", "n", "0"].includes(t)) return false;
  }
  return null;
}

/** Texto da situação diz se o item aceita lance. Sem evidência positiva, não aceita. */
export function situacaoAceitaLance(texto: unknown): boolean | null {
  if (typeof texto !== "string" || !texto.trim()) return null;
  const t = texto.toLowerCase();
  if (/encerrad|fechad|finalizad|suspens|cancelad|homologad|adjudicad|aguardando/.test(t)) return false;
  if (/em.?disputa|abert|aceitando|lance/.test(t)) return true;
  return null;
}

/**
 * Segundos restantes. Lê campo nomeado em segundos, campo nomeado em milissegundos ou
 * timestamp de encerramento — nesta ordem. Nada legível ⇒ `null`, e o `relogio.ts`
 * transforma isso em "não oferta".
 */
export function lerSegundosRestantes(fonte: Record<string, unknown>, agora: number): number | null {
  const s = campo(fonte, ALIASES.segundos);
  if (typeof s === "number" && Number.isFinite(s)) return s;
  if (typeof s === "string" && /^-?\d+(\.\d+)?$/.test(s.trim())) return Number(s);

  const ms = campo(fonte, ALIASES.milissegundos);
  if (typeof ms === "number" && Number.isFinite(ms)) return ms / 1000;

  const fim = campo(fonte, ALIASES.encerramento);
  if (typeof fim === "string" || typeof fim === "number") {
    const instante = new Date(fim).getTime();
    if (Number.isFinite(instante)) return (instante - agora) / 1000;
  }
  return null;
}

/**
 * Normaliza um item vindo do portal (REST ou MESSAGE do WebSocket).
 *
 * Devolve `null` só quando nem o número do item dá para ler — aí não há do que falar.
 * Qualquer outra lacuna vira `null` no campo e um nome em `camposIlegiveis`.
 */
export function normalizarItem(bruto: unknown, opcoes: { agora?: number } = {}): LeituraItem | null {
  const fonte = objeto(bruto);
  if (!fonte) return null;
  const agora = opcoes.agora ?? Date.now();

  const numeroCru = campo(fonte, ALIASES.numero);
  const numero =
    typeof numeroCru === "string" || typeof numeroCru === "number" ? String(numeroCru).trim() : "";
  if (!numero) return null;

  const camposIlegiveis: string[] = [];
  const marcar = <T>(nome: string, valor: T | null): T | null => {
    if (valor === null) camposIlegiveis.push(nome);
    return valor;
  };

  const melhorValorGeral = marcar("melhorValorGeral", lerDinheiro(campo(fonte, ALIASES.melhorValor)));
  const nossoMelhorValor = lerDinheiro(campo(fonte, ALIASES.nossoValor)); // ausente é normal
  const variacaoMinimaMelhorLance = lerDinheiro(campo(fonte, ALIASES.variacaoMelhorLance));
  const variacaoMinimaFornecedor = lerDinheiro(campo(fonte, ALIASES.variacaoFornecedor));
  const segundosRestantes = marcar("segundosRestantes", lerSegundosRestantes(fonte, agora));

  const situacao = campo(fonte, ALIASES.situacao);
  const aceitaExplicito = lerBooleano(campo(fonte, ALIASES.aceitaLance));
  const aceitaPorSituacao = situacaoAceitaLance(situacao);
  const aceita = aceitaExplicito ?? aceitaPorSituacao;
  if (aceita === null) camposIlegiveis.push("aceitaLance");

  const dizimaLida = lerBooleano(campo(fonte, ALIASES.dizima));

  const estado: EstadoItem = {
    numero,
    // Sem evidência positiva, o item não aceita lance. Falha fechada.
    aceitaLance: aceita === true,
    melhorValorGeral,
    nossoMelhorValor,
    variacaoMinimaMelhorLance,
    variacaoMinimaFornecedor,
    permitirDizima: dizimaLida === true,
    posicao: lerPosicao(campo(fonte, ALIASES.posicao)),
    segundosRestantes
  };

  const compraCru = campo(fonte, ALIASES.compra);

  return {
    estado,
    aceitaLida: aceita,
    dizimaLida,
    fase: typeof situacao === "string" && situacao.trim() ? situacao.trim() : null,
    descricao: ((d) => (typeof d === "string" && d.trim() ? d.trim() : null))(campo(fonte, ALIASES.descricao)),
    compra: typeof compraCru === "string" || typeof compraCru === "number" ? String(compraCru) : null,
    recebidoEm: agora,
    camposIlegiveis
  };
}

/** Lista de itens vinda numa carga só. O que não der para ler é descartado, não chutado. */
export function normalizarItens(bruto: unknown, opcoes: { agora?: number } = {}): LeituraItem[] {
  const lista = Array.isArray(bruto)
    ? bruto
    : Array.isArray(objeto(bruto)?.itens)
      ? (objeto(bruto)!.itens as unknown[])
      : Array.isArray(objeto(bruto)?.content)
        ? (objeto(bruto)!.content as unknown[])
        : [];
  return lista.flatMap((cru) => {
    const leitura = normalizarItem(cru, opcoes);
    return leitura ? [leitura] : [];
  });
}
