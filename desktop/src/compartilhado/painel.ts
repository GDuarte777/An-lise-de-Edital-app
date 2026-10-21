/**
 * Contrato do painel de disputa.
 *
 * É o acordo entre quem produz o estado (o WebSocket do portal, a REST, ou a
 * demonstração) e quem o desenha (a interface). A tela nunca fala com o portal: ela
 * recebe `EstadoPainel` e devolve comandos. Quando o cliente STOMP entrar no lugar da
 * demonstração, nada aqui — nem na tela — muda.
 *
 * Regra que vale para todo campo numérico: `null` significa "não foi possível ler",
 * nunca zero. A interface mostra "—" e o motor se recusa a decidir no escuro.
 */

export type FaseItem = "aguardando" | "em-disputa" | "encerrado";

export type ModoDisputa = "assumir-primeiro" | "posicionar" | "manter" | "margem" | "fechado";

export const NOMES_MODO: Record<ModoDisputa, string> = {
  "assumir-primeiro": "Assumir 1º lugar",
  posicionar: "Melhor posição possível",
  manter: "Manter em disputa",
  margem: "Ficar na margem",
  fechado: "Lance fechado"
};

export const EXPLICACAO_MODO: Record<ModoDisputa, string> = {
  "assumir-primeiro": "Cobre o melhor lance usando o maior entre o seu intervalo e a variação do edital.",
  posicionar: "Busca a melhor posição possível; se o intervalo furaria o piso, oferta o próprio piso.",
  manter: "Reduz só o mínimo legal — segura o item em disputa sem queimar margem.",
  margem: "Mantém seu lance dentro de uma faixa percentual acima do melhor valor.",
  fechado: "Oferta um valor único, para a fase fechada."
};

/** O que o operador configurou para um item. Tudo que é dinheiro vive aqui. */
export interface ConfigItem {
  /** Lance mínimo (R$): o robô nunca desce abaixo disto. */
  pisoMinimo: number | null;
  /** Intervalo mínimo: quanto ele desce por lance. */
  passoTipo: "fixo" | "percentual";
  passoValor: number | null;
  modo: ModoDisputa;
  /** Só no modo "margem". */
  margemPercentual: number | null;
  /** Só no modo "fechado". */
  valorFechado: number | null;
  /** Permitir lances em casas decimais: 4 casas em vez de 2, para brigar nos centavos. */
  permitirDecimais: boolean;
  /** Disputar apenas nos segundos finais. */
  somenteSegundosFinais: boolean;
  segundosJanela: number;
}

export function configPadrao(): ConfigItem {
  return {
    pisoMinimo: null,
    passoTipo: "fixo",
    passoValor: 0.01,
    modo: "assumir-primeiro",
    margemPercentual: null,
    valorFechado: null,
    permitirDecimais: false,
    somenteSegundosFinais: false,
    segundosJanela: 30
  };
}

export interface ItemPainel {
  numero: string;
  descricao: string;
  fase: FaseItem;
  aceitaLance: boolean;
  /** Melhor (menor) lance do item, de qualquer fornecedor. */
  melhorValor: number | null;
  /** Nosso melhor lance registrado. */
  meuValor: number | null;
  minhaPosicao: number | null;
  participantes: number | null;
  /** Redução mínima exigida pelo edital sobre o melhor lance. */
  variacaoMinima: number | null;
  /** Item que aceita dízima: o portal opera em 4 casas. */
  permitirDizima: boolean;
  segundosRestantes: number | null;
  /** Robô ligado neste item. */
  armado: boolean;
  /** Última recusa da guarda de margem, para o operador saber por que parou. */
  ultimaRecusa: string | null;
  config: ConfigItem;
}

export interface MensagemChat {
  em: string;
  autor: string;
  texto: string;
  doPregoeiro: boolean;
}

export interface LinhaClassificacao {
  posicao: number;
  fornecedor: string;
  valor: number;
  eu: boolean;
  em: string | null;
}

export type NivelLog = "sistema" | "concorrente" | "proprio" | "alerta" | "sucesso" | "pregoeiro";

export interface EventoLog {
  em: string;
  nivel: NivelLog;
  msg: string;
}

export type EstadoConexao = "ligada" | "instavel" | "caiu";

/** De onde o estado veio. A interface mostra isso: o operador tem direito de saber. */
export type OrigemEstado = "websocket" | "rest" | "demonstracao";

export interface DisputaPainel {
  identificada: boolean;
  titulo: string;
  modalidade: string;
  numero: string;
  uasg: string;
  orgao: string;
  /** Já formatado (HH:MM:SS) para a tela não ter que decidir fuso. */
  tempoRestante: string | null;
  segundosRestantes: number | null;
  conexao: EstadoConexao;
  origem: OrigemEstado;
}

export interface EstadoPainel {
  disputa: DisputaPainel;
  itens: ItemPainel[];
  chat: MensagemChat[];
  log: EventoLog[];
  atualizadoEm: string;
}

/** O que a tela pode pedir. Nada aqui devolve dado cru do portal. */
export interface ComandosPainel {
  configurar(numeroItem: string, mudanca: Partial<ConfigItem>): void;
  armar(numeroItem: string): void;
  desarmar(numeroItem: string, motivo?: string): void;
  classificacao(numeroItem: string): Promise<LinhaClassificacao[]>;
}

/** Fonte de estado: assina e recebe. Implementada pela demonstração hoje, pelo STOMP amanhã. */
export interface FontePainel {
  estadoAtual(): EstadoPainel;
  assinar(ouvinte: (e: EstadoPainel) => void): () => void;
  comandos: ComandosPainel;
  encerrar(): void;
}

export function formatarSegundos(total: number | null): string | null {
  if (total === null || !Number.isFinite(total) || total < 0) return null;
  const s = Math.floor(total % 60);
  const m = Math.floor((total / 60) % 60);
  const h = Math.floor(total / 3600);
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${dois(h)}:${dois(m)}:${dois(s)}`;
}

export function formatarReal(valor: number | null, casas = 2): string {
  if (valor === null || !Number.isFinite(valor)) return "—";
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: casas,
    maximumFractionDigits: casas
  });
}

/**
 * Lê dinheiro digitado por humano: "1.250,50", "1250,50", "1250.50" e "1.250" precisam
 * todos virar o número que a pessoa quis dizer.
 *
 * Devolve `null` em vez de adivinhar quando o formato é ambíguo ou inválido — piso lido
 * errado é prejuízo, e aqui o piso é exatamente o que está sendo digitado.
 */
export function lerMoedaBR(texto: string): number | null {
  const limpo = String(texto ?? "")
    .replace(/R\$/gi, "")
    .replace(/[\s ]/g, "");
  if (!limpo) return null;
  if (!/^-?[\d.,]+$/.test(limpo)) return null;

  let normalizado: string;
  if (limpo.includes(",")) {
    // Vírgula presente: ela é o separador decimal e o ponto é milhar.
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else if ((limpo.match(/\./g) ?? []).length > 1) {
    normalizado = limpo.replace(/\./g, "");
  } else {
    const partes = limpo.split(".");
    // "1.250" é mil duzentos e cinquenta; "1250.50" é decimal.
    normalizado = partes.length === 2 && partes[1]!.length === 3 ? partes.join("") : limpo;
  }

  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}
