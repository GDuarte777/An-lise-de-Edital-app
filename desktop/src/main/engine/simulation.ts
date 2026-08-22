import type { EstadoItem, PortalAdapter, ReferenciaItem, ResultadoEnvio } from "./portal.js";

/**
 * Adapter de simulação, para exercitar a guarda de margem e a interface sem um pregão ao vivo.
 *
 * `ehSimulacao` é true e a UI é obrigada a exibir isso. Nenhum dado daqui representa
 * disputa real — confundir os dois foi exatamente o defeito da estrutura anterior.
 */
export class SimulacaoAdapter implements PortalAdapter {
  readonly nome = "Simulação (nenhum lance real é enviado)";
  readonly ehSimulacao = true;

  private menorLance: number;
  private readonly enviados: number[] = [];

  constructor(valorInicial = 1000) {
    this.menorLance = valorInicial;
  }

  async lerEstado(_ref: ReferenciaItem): Promise<EstadoItem> {
    // Concorrente fictício cobre nosso lance de vez em quando.
    if (this.enviados.length > 0 && Math.random() < 0.5) {
      this.menorLance = Math.max(1, Math.round((this.menorLance - Math.random() * 10) * 100) / 100);
    }
    return {
      menorLance: this.menorLance,
      nossoLance: this.enviados.at(-1),
      aberto: true,
      lidoEm: new Date()
    };
  }

  async enviarLance(_ref: ReferenciaItem, valor: number): Promise<ResultadoEnvio> {
    this.enviados.push(valor);
    this.menorLance = valor;
    return { aceito: true, mensagem: `Simulação: lance de R$ ${valor.toFixed(2)} registrado localmente.` };
  }
}
