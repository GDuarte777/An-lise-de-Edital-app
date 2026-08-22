/**
 * Guarda de margem: decide o próximo lance e recusa qualquer valor abaixo do piso
 * configurado pelo operador.
 *
 * Esta é a única barreira entre o robô e um prejuízo real, então ela falha fechada:
 * qualquer entrada que não seja um número finito, ou qualquer resultado que não respeite
 * o piso, vira recusa — nunca um lance "aproximado".
 */

export type TipoDecremento = "fixo" | "percentual";

export interface ConfiguracaoMargem {
  /** Menor valor que o operador aceita receber pelo item. O robô nunca desce abaixo disto. */
  valorLimiteMinimo: number;
  tipoDecremento: TipoDecremento;
  /** Reais (fixo) ou pontos percentuais (percentual). Precisa ser > 0. */
  valorDecremento: number;
}

export type DecisaoLance =
  | { acao: "enviar"; valor: number }
  | { acao: "recusar"; motivo: string }
  | { acao: "aguardar"; motivo: string };

function ehNumeroUtil(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Arredonda para centavos evitando o erro de ponto flutuante de (x * 100) / 100. */
export function arredondarCentavos(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

export class EstrategiaMargem {
  private readonly cfg: ConfiguracaoMargem;

  constructor(cfg: ConfiguracaoMargem) {
    if (!ehNumeroUtil(cfg.valorLimiteMinimo) || cfg.valorLimiteMinimo < 0) {
      throw new Error("Valor limite mínimo inválido: informe um número maior ou igual a zero.");
    }
    if (!ehNumeroUtil(cfg.valorDecremento) || cfg.valorDecremento <= 0) {
      throw new Error("Valor de decremento inválido: informe um número maior que zero.");
    }
    if (cfg.tipoDecremento === "percentual" && cfg.valorDecremento >= 100) {
      throw new Error("Decremento percentual precisa ser menor que 100%.");
    }
    this.cfg = { ...cfg };
  }

  get limiteMinimo(): number {
    return this.cfg.valorLimiteMinimo;
  }

  /**
   * Decide o que fazer diante do menor lance atual da disputa.
   *
   * @param menorLanceAtual  Menor valor vigente no item, lido do portal.
   * @param nossoUltimoLance Último valor que nós enviamos, se houver.
   */
  decidir(menorLanceAtual: number, nossoUltimoLance?: number): DecisaoLance {
    if (!ehNumeroUtil(menorLanceAtual) || menorLanceAtual <= 0) {
      return {
        acao: "recusar",
        motivo: `Menor lance lido do portal é inválido (${String(menorLanceAtual)}). Nenhum lance será enviado.`
      };
    }

    // Já lideramos: cobrir o próprio lance só queima margem.
    if (ehNumeroUtil(nossoUltimoLance) && menorLanceAtual >= nossoUltimoLance) {
      return {
        acao: "aguardar",
        motivo: `Já lideramos com R$ ${nossoUltimoLance.toFixed(2)}. Aguardando lance de concorrente.`
      };
    }

    const proximo = arredondarCentavos(
      this.cfg.tipoDecremento === "percentual"
        ? menorLanceAtual * (1 - this.cfg.valorDecremento / 100)
        : menorLanceAtual - this.cfg.valorDecremento
    );

    if (proximo <= 0) {
      return {
        acao: "recusar",
        motivo: `O decremento configurado levaria o lance a R$ ${proximo.toFixed(2)}, que não é um valor válido.`
      };
    }

    if (proximo < this.cfg.valorLimiteMinimo) {
      return {
        acao: "recusar",
        motivo:
          `Margem estourada: o próximo lance seria R$ ${proximo.toFixed(2)}, ` +
          `abaixo do seu limite de R$ ${this.cfg.valorLimiteMinimo.toFixed(2)}. Robô parado.`
      };
    }

    return { acao: "enviar", valor: proximo };
  }
}
