import { EstrategiaMargem, type ConfiguracaoMargem } from "./strategy.js";
import type { PortalAdapter, ReferenciaItem } from "./portal.js";

export type NivelLog = "sistema" | "concorrente" | "proprio" | "alerta" | "sucesso" | "pregoeiro";

export interface EntradaLog {
  em: string;
  nivel: NivelLog;
  msg: string;
}

export interface ConfiguracaoRobo extends ConfiguracaoMargem {
  ref: ReferenciaItem;
  /** Intervalo entre leituras do portal, em ms. Abaixo de 300ms é pressão desnecessária. */
  intervaloMs: number;
}

export type EstadoRobo = "parado" | "rodando" | "pausado-por-margem" | "erro";

/**
 * Laço de disputa: lê o estado do item, consulta a guarda de margem e envia o lance.
 *
 * Regras de parada — todas param o robô em vez de seguir no escuro:
 *  - margem estourada (o piso do operador seria violado);
 *  - sessão expirada ou erro de autenticação;
 *  - respostas do portal fora do formato esperado, repetidas vezes.
 */
export class MotorLances {
  private estado: EstadoRobo = "parado";
  private timer: NodeJS.Timeout | null = null;
  private readonly estrategia: EstrategiaMargem;
  private nossoUltimoLance: number | undefined;
  private errosSeguidos = 0;
  private readonly maxErrosSeguidos = 3;
  private ciclando = false;
  /** Assinaturas das mensagens já registradas, para não repetir o chat a cada ciclo. */
  private readonly mensagensVistas = new Set<string>();

  constructor(
    private readonly cfg: ConfiguracaoRobo,
    private readonly portal: PortalAdapter,
    private readonly aoRegistrar: (e: EntradaLog) => void,
    private readonly aoMudarEstado: (e: EstadoRobo) => void
  ) {
    this.estrategia = new EstrategiaMargem(cfg);
  }

  private log(nivel: NivelLog, msg: string): void {
    this.aoRegistrar({ em: new Date().toISOString(), nivel, msg });
  }

  private mudarEstado(novo: EstadoRobo): void {
    this.estado = novo;
    this.aoMudarEstado(novo);
  }

  get estadoAtual(): EstadoRobo {
    return this.estado;
  }

  iniciar(): void {
    if (this.estado === "rodando") return;

    this.mudarEstado("rodando");
    this.errosSeguidos = 0;

    this.log("sistema", `Robô iniciado — pregão ${this.cfg.ref.pregaoId}, item ${this.cfg.ref.itemNum}.`);
    this.log("sistema", `Portal: ${this.portal.nome}${this.portal.ehSimulacao ? " — NENHUM LANCE REAL SERÁ ENVIADO" : ""}.`);
    this.log(
      "sistema",
      `Piso R$ ${this.cfg.valorLimiteMinimo.toFixed(2)} | decremento ${this.cfg.valorDecremento}` +
        `${this.cfg.tipoDecremento === "percentual" ? "%" : " reais"} | leitura a cada ${this.cfg.intervaloMs}ms.`
    );

    const intervalo = Math.max(300, this.cfg.intervaloMs);
    this.timer = setInterval(() => void this.ciclo(), intervalo);
    void this.ciclo();
  }

  parar(motivo = "Parado pelo operador."): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.estado === "rodando") this.mudarEstado("parado");
    this.log("sistema", motivo);
  }

  private async ciclo(): Promise<void> {
    // Evita sobreposição quando o portal responde mais devagar que o intervalo.
    if (this.ciclando || this.estado !== "rodando") return;
    this.ciclando = true;

    try {
      const estadoItem = await this.portal.lerEstado(this.cfg.ref);
      this.errosSeguidos = 0;

      // O chat é informativo: uma falha aqui não pode interromper a disputa.
      if (this.portal.lerMensagens) {
        try {
          for (const m of await this.portal.lerMensagens(this.cfg.ref)) {
            const assinatura = `${m.em ?? ""}|${m.texto}`;
            if (this.mensagensVistas.has(assinatura)) continue;
            this.mensagensVistas.add(assinatura);
            this.log("pregoeiro", `${m.autor}: ${m.texto}`);
          }
        } catch {
          // Sem chat, o robô segue operando normalmente.
        }
      }

      if (!estadoItem.aberto) {
        this.log("sistema", "Disputa fechada para este item. Encerrando.");
        this.parar("Robô encerrado: item não aceita mais lances.");
        return;
      }

      // O portal é a fonte da verdade sobre o nosso lance, quando informa.
      if (typeof estadoItem.nossoLance === "number") this.nossoUltimoLance = estadoItem.nossoLance;

      const decisao = this.estrategia.decidir(estadoItem.menorLance, this.nossoUltimoLance);

      if (decisao.acao === "aguardar") return;

      if (decisao.acao === "recusar") {
        this.log("alerta", decisao.motivo);
        this.mudarEstado("pausado-por-margem");
        this.parar("Robô pausado para proteger sua margem. Ajuste o piso ou o decremento para retomar.");
        return;
      }

      this.log("concorrente", `Menor lance no item: R$ ${estadoItem.menorLance.toFixed(2)}.`);
      const envio = await this.portal.enviarLance(this.cfg.ref, decisao.valor);

      if (envio.aceito) {
        this.nossoUltimoLance = decisao.valor;
        this.log("sucesso", `Lance de R$ ${decisao.valor.toFixed(2)} aceito. ${envio.mensagem}`);
      } else {
        this.log("alerta", `Portal recusou o lance de R$ ${decisao.valor.toFixed(2)}. ${envio.mensagem}`);
      }
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      this.errosSeguidos++;
      this.log("alerta", `Falha no ciclo (${this.errosSeguidos}/${this.maxErrosSeguidos}): ${msg}`);

      if (this.errosSeguidos >= this.maxErrosSeguidos) {
        this.mudarEstado("erro");
        this.parar("Robô parado após falhas consecutivas. Verifique a sessão e o mapeamento do portal.");
      }
    } finally {
      this.ciclando = false;
    }
  }
}
