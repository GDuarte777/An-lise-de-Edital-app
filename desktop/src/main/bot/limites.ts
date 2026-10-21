/**
 * Freio de requisições ao portal.
 *
 * Decisão de produto, não de engenharia: este freio não tem desligamento. O robô
 * analisado trazia `USAR_LIMITACAO_CNET=0` vindo de um servidor remoto — ou seja, o
 * fornecedor podia, a qualquer momento, fazer a máquina do cliente martelar um sistema
 * federal sem limite. Quem leva o bloqueio de CNPJ nesse arranjo é o cliente.
 *
 * Aqui o intervalo é configurável para CIMA do piso e nada mais.
 */

/** Menor intervalo admitido entre duas requisições ao portal, em ms. */
export const INTERVALO_MINIMO_MS = 200;

export class Freio {
  private proximoLivreEm = 0;
  private readonly intervaloMs: number;

  constructor(intervaloMs = INTERVALO_MINIMO_MS) {
    this.intervaloMs = Math.max(INTERVALO_MINIMO_MS, Math.floor(intervaloMs) || 0);
  }

  get intervalo(): number {
    return this.intervaloMs;
  }

  /** Resolve quando a próxima requisição pode sair. */
  async vez(agora = Date.now()): Promise<void> {
    const espera = Math.max(0, this.proximoLivreEm - agora);
    this.proximoLivreEm = Math.max(agora, this.proximoLivreEm) + this.intervaloMs;
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  }

  /** Quanto tempo a próxima chamada a `vez()` esperaria, sem consumir o slot. */
  esperaPrevista(agora = Date.now()): number {
    return Math.max(0, this.proximoLivreEm - agora);
  }
}

/**
 * Recuo exponencial para 429 e 5xx.
 *
 * Separado do freio porque são coisas diferentes: o freio é educação constante, o recuo é
 * reação a "você está pesando demais" dito pelo próprio portal.
 */
export class Recuo {
  private falhasSeguidas = 0;

  constructor(
    private readonly baseMs = 1_000,
    private readonly tetoMs = 60_000
  ) {}

  get nivel(): number {
    return this.falhasSeguidas;
  }

  registrarSucesso(): void {
    this.falhasSeguidas = 0;
  }

  /** Registra a falha e devolve quanto esperar antes de tentar de novo. */
  registrarFalha(): number {
    this.falhasSeguidas++;
    const bruto = this.baseMs * 2 ** (this.falhasSeguidas - 1);
    return Math.min(this.tetoMs, bruto);
  }
}
