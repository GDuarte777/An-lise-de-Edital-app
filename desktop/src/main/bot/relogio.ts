/**
 * Janela de disputa: decide se é hora de ofertar.
 *
 * O "sniping" de cronômetro (só ofertar nos últimos segundos) é o comportamento que o
 * operador liga para não dar tempo ao concorrente de reagir. Ele tem uma regra dura:
 *
 *   se o tempo restante não é legível, NÃO oferta.
 *
 * O contrário — ofertar quando não sabe que horas são — entrega o lance cedo justamente
 * na hipótese em que o operador pediu para esperar. Falha fechada, sempre.
 */

export interface JanelaFinal {
  ativo: boolean;
  /** Oferta só quando faltarem no máximo estes segundos. */
  segundos: number;
}

/** Padrões observados em robôs de mercado: 30s no modo aberto, 120s no fechado. */
export const JANELA_PADRAO_ABERTO = 30;
export const JANELA_PADRAO_FECHADO = 120;

export type VeredictoJanela =
  | { ofertar: true }
  | { ofertar: false; porque: string };

export function avaliarJanela(segundosRestantes: number | null, janela: JanelaFinal): VeredictoJanela {
  if (!janela.ativo) return { ofertar: true };

  if (!Number.isFinite(janela.segundos) || janela.segundos <= 0) {
    return { ofertar: false, porque: "Janela final configurada com valor inválido. Nada será ofertado." };
  }

  if (segundosRestantes === null || !Number.isFinite(segundosRestantes)) {
    return {
      ofertar: false,
      porque:
        "Não foi possível ler o tempo restante da disputa. Como você pediu para ofertar só nos " +
        "segundos finais, o robô espera em vez de arriscar ofertar cedo."
    };
  }

  if (segundosRestantes < 0) {
    return { ofertar: false, porque: "O cronômetro do item já zerou." };
  }

  if (segundosRestantes > janela.segundos) {
    return {
      ofertar: false,
      porque: `Faltam ${Math.round(segundosRestantes)}s; aguardando entrar nos últimos ${janela.segundos}s.`
    };
  }

  return { ofertar: true };
}
