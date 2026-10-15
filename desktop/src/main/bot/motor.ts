/**
 * Motor do robô, movido a evento.
 *
 * O desenho antigo (e o do robô analisado) era um laço: pergunta o estado, decide, dorme,
 * repete. Aqui não há laço de leitura. Cada mudança de estado que chega do portal entra em
 * `aplicarLeitura` e é um convite a decidir — o único timer que existe é o da janela final,
 * para o caso de o cronômetro entrar na janela sem nenhuma mensagem nova chegar.
 *
 * As travas que importam, todas aqui e não espalhadas:
 *
 *  - um lance em voo por item, nunca dois (`emVoo`);
 *  - tempo restante é projetado a partir de quando a leitura chegou, não do que ela dizia
 *    há cinco segundos;
 *  - recusa de piso, item fechado ou configuração inválida desarma o item: o robô para e
 *    espera o operador, em vez de insistir contra a margem dele;
 *  - falha de rede ou de variação segura o item e tenta no próximo evento, com limite de
 *    falhas seguidas antes de desarmar;
 *  - sessão caída desarma tudo de uma vez.
 */
import type { Casas, Micro } from "./decimal.js";
import { formatar } from "./decimal.js";
import type { LeituraItem } from "./eventos.js";
import { decidir, type CodigoRecusa, type ConfiguracaoDisputa, type Decisao, type EstadoItem } from "./estrategias.js";
import type { ResultadoLance } from "./rest/portal.js";
import { TEMPORIZADOR_REAL, type Temporizador } from "./tempo.js";

export interface PedidoLance {
  compra: string;
  item: string;
  valor: Micro;
  casas: Casas;
  fase: string;
}

export type Lancador = (pedido: PedidoLance) => Promise<ResultadoLance>;

export type EventoMotor =
  | { tipo: "armado"; item: string }
  | { tipo: "desarmado"; item: string; porque: string; codigo?: CodigoRecusa }
  | { tipo: "aguardando"; item: string; porque: string }
  | { tipo: "enviando"; item: string; valor: Micro; casas: Casas; porque: string }
  | { tipo: "aceito"; item: string; valor: Micro; casas: Casas }
  | { tipo: "recusado"; item: string; codigo: CodigoRecusa; mensagem: string }
  | { tipo: "falhou"; item: string; mensagem: string; seguidas: number }
  | { tipo: "sessao-caiu" }
  | { tipo: "leitura-incompleta"; item: string; campos: string[] };

export interface OpcoesMotor {
  lancador: Lancador;
  temporizador?: Temporizador;
  /** Intervalo mínimo entre dois lances NOSSOS no mesmo item. */
  intervaloEntreLancesMs?: number;
  /** Falhas seguidas (rede/5xx) toleradas por item antes de desarmar. */
  falhasToleradas?: number;
  aoEvento?: (evento: EventoMotor) => void;
}

interface Alvo {
  numero: string;
  cfg: ConfiguracaoDisputa;
  leitura: LeituraItem | null;
  armado: boolean;
  emVoo: boolean;
  ultimoEnvioEm: number | null;
  ultimoValorEnviado: Micro | null;
  falhasSeguidas: number;
  cancelarJanela: (() => void) | null;
  ultimoMotivo: string | null;
}

/** Códigos que param o item até o operador voltar. */
const DESARMAM: CodigoRecusa[] = ["ULTRAPASSA_VALOR_MINIMO", "CONFIG_INVALIDA", "ITEM_NAO_ACEITA_LANCE"];

export class Motor {
  private readonly alvos = new Map<string, Alvo>();
  private readonly tempo: Temporizador;

  constructor(private readonly opcoes: OpcoesMotor) {
    this.tempo = opcoes.temporizador ?? TEMPORIZADOR_REAL;
  }

  /** Arma (ou rearma) um item. Rearmar limpa o contador de falhas e o motivo anterior. */
  armar(numero: string, cfg: ConfiguracaoDisputa): void {
    const atual = this.alvos.get(numero);
    const alvo: Alvo = atual ?? {
      numero,
      cfg,
      leitura: null,
      armado: false,
      emVoo: false,
      ultimoEnvioEm: null,
      ultimoValorEnviado: null,
      falhasSeguidas: 0,
      cancelarJanela: null,
      ultimoMotivo: null
    };
    alvo.cfg = cfg;
    alvo.armado = true;
    alvo.falhasSeguidas = 0;
    alvo.ultimoMotivo = null;
    this.alvos.set(numero, alvo);
    this.aviso({ tipo: "armado", item: numero });
    void this.avaliar(numero);
  }

  desarmar(numero: string, porque: string, codigo?: CodigoRecusa): void {
    const alvo = this.alvos.get(numero);
    if (!alvo || !alvo.armado) return;
    alvo.armado = false;
    alvo.ultimoMotivo = porque;
    alvo.cancelarJanela?.();
    alvo.cancelarJanela = null;
    this.aviso({ tipo: "desarmado", item: numero, porque, codigo });
  }

  pararTudo(porque = "robô parado pelo operador"): void {
    for (const numero of [...this.alvos.keys()]) this.desarmar(numero, porque);
  }

  estaArmado(numero: string): boolean {
    return this.alvos.get(numero)?.armado === true;
  }

  motivoDe(numero: string): string | null {
    return this.alvos.get(numero)?.ultimoMotivo ?? null;
  }

  /** Estado do item como o motor o vê agora, com o tempo já projetado. */
  estadoProjetado(numero: string, agora = this.tempo.agora()): EstadoItem | null {
    const alvo = this.alvos.get(numero);
    if (!alvo?.leitura) return null;
    return projetar(alvo.leitura, agora);
  }

  /** O que o painel mostra em "Próximo lance", sem enviar nada. */
  prever(numero: string, agora = this.tempo.agora()): Decisao | null {
    const alvo = this.alvos.get(numero);
    if (!alvo?.leitura) return null;
    return decidir(projetar(alvo.leitura, agora), alvo.cfg);
  }

  /** Porta de entrada: toda mudança de estado do portal passa por aqui. */
  aplicarLeitura(leitura: LeituraItem): void {
    const numero = leitura.estado.numero;
    const alvo = this.alvos.get(numero);
    if (!alvo) {
      // Item que o operador não armou: guarda para a UI, não decide nada.
      this.alvos.set(numero, {
        numero,
        cfg: { modo: "assumir-primeiro", pisoMinimo: 0 },
        leitura,
        armado: false,
        emVoo: false,
        ultimoEnvioEm: null,
        ultimoValorEnviado: null,
        falhasSeguidas: 0,
        cancelarJanela: null,
        ultimoMotivo: null
      });
      return;
    }

    alvo.leitura = fundir(alvo.leitura, leitura);
    if (leitura.camposIlegiveis.length > 0) {
      this.aviso({ tipo: "leitura-incompleta", item: numero, campos: leitura.camposIlegiveis });
    }
    void this.avaliar(numero);
  }

  /** Sessão caída não é problema de um item: desarma tudo e avisa uma vez. */
  sessaoCaiu(): void {
    this.aviso({ tipo: "sessao-caiu" });
    this.pararTudo("sessão do portal caiu; refaça o login para continuar");
  }

  // ---------- decisão ----------

  private async avaliar(numero: string): Promise<void> {
    const alvo = this.alvos.get(numero);
    if (!alvo || !alvo.armado || alvo.emVoo || !alvo.leitura) return;

    const agora = this.tempo.agora();
    const estado = projetar(alvo.leitura, agora);
    const decisao = decidir(estado, alvo.cfg);

    if (decisao.acao === "parar") {
      if (DESARMAM.includes(decisao.codigo)) {
        this.desarmar(numero, decisao.porque, decisao.codigo);
      } else {
        // Variação mínima e leitura inválida podem mudar no próximo evento.
        alvo.ultimoMotivo = decisao.porque;
        this.aviso({ tipo: "aguardando", item: numero, porque: decisao.porque });
      }
      return;
    }

    if (decisao.acao === "aguardar") {
      alvo.ultimoMotivo = decisao.porque;
      this.aviso({ tipo: "aguardando", item: numero, porque: decisao.porque });
      this.agendarJanela(alvo, estado, agora);
      return;
    }

    const espera = this.esperaDoIntervalo(alvo, agora);
    if (espera > 0) {
      this.aviso({
        tipo: "aguardando",
        item: numero,
        porque: `Intervalo mínimo entre lances: faltam ${espera} ms.`
      });
      alvo.cancelarJanela?.();
      alvo.cancelarJanela = this.tempo.agendar(espera, () => {
        alvo.cancelarJanela = null;
        void this.avaliar(numero);
      });
      return;
    }

    const compra = alvo.leitura.compra;
    const fase = alvo.leitura.fase;
    if (!compra || !fase) {
      // Sem compra e fase o POST não existe. Não se inventa corpo de requisição.
      const porque = !compra
        ? "A leitura não trouxe o número da compra; sem ele o lance não pode ser enviado."
        : "A leitura não trouxe a fase do item; sem ela o lance não pode ser enviado.";
      alvo.ultimoMotivo = porque;
      this.aviso({ tipo: "aguardando", item: numero, porque });
      return;
    }

    await this.enviar(alvo, decisao, compra, fase);
  }

  private esperaDoIntervalo(alvo: Alvo, agora: number): number {
    const intervalo = this.opcoes.intervaloEntreLancesMs ?? 0;
    if (intervalo <= 0 || alvo.ultimoEnvioEm === null) return 0;
    return Math.max(0, alvo.ultimoEnvioEm + intervalo - agora);
  }

  /**
   * Se o item está esperando a janela final, agenda a reavaliação para quando ela abrir.
   * Sem isso o robô dependeria de o portal mandar mensagem no segundo exato.
   */
  private agendarJanela(alvo: Alvo, estado: EstadoItem, agora: number): void {
    const janela = alvo.cfg.janelaFinal;
    if (!janela?.ativo || !(janela.segundos > 0)) return;
    if (estado.segundosRestantes === null || !Number.isFinite(estado.segundosRestantes)) return;
    const faltaParaJanela = (estado.segundosRestantes - janela.segundos) * 1000;
    if (faltaParaJanela <= 0) return;

    alvo.cancelarJanela?.();
    // +50 ms para entrar na janela já dentro dela, não na borda.
    alvo.cancelarJanela = this.tempo.agendar(faltaParaJanela + 50, () => {
      alvo.cancelarJanela = null;
      void this.avaliar(alvo.numero);
    });
    void agora;
  }

  private async enviar(
    alvo: Alvo,
    decisao: Extract<Decisao, { acao: "enviar" }>,
    compra: string,
    fase: string
  ): Promise<void> {
    alvo.emVoo = true;
    this.aviso({
      tipo: "enviando",
      item: alvo.numero,
      valor: decisao.valor,
      casas: decisao.casas,
      porque: decisao.porque
    });

    let resultado: ResultadoLance;
    try {
      resultado = await this.opcoes.lancador({
        compra,
        item: alvo.numero,
        valor: decisao.valor,
        casas: decisao.casas,
        fase
      });
    } catch (erro) {
      resultado = {
        estado: "falha",
        status: 0,
        mensagem: erro instanceof Error ? erro.message : "falha ao enviar o lance"
      };
    } finally {
      alvo.emVoo = false;
      alvo.ultimoEnvioEm = this.tempo.agora();
    }

    this.aplicarResultado(alvo, decisao, resultado);
  }

  private aplicarResultado(
    alvo: Alvo,
    decisao: Extract<Decisao, { acao: "enviar" }>,
    resultado: ResultadoLance
  ): void {
    switch (resultado.estado) {
      case "aceito": {
        alvo.falhasSeguidas = 0;
        alvo.ultimoValorEnviado = decisao.valor;
        alvo.ultimoMotivo = `Lance de ${formatar(decisao.valor, decisao.casas)} aceito.`;
        // Otimista de propósito: o portal vai confirmar por evento, mas até lá o motor já
        // sabe que este valor é nosso — é o que impede um segundo lance redundante.
        if (alvo.leitura) {
          alvo.leitura = {
            ...alvo.leitura,
            estado: {
              ...alvo.leitura.estado,
              nossoMelhorValor: decisao.valor,
              melhorValorGeral:
                alvo.leitura.estado.melhorValorGeral === null ||
                decisao.valor < alvo.leitura.estado.melhorValorGeral
                  ? decisao.valor
                  : alvo.leitura.estado.melhorValorGeral
            }
          };
        }
        this.aviso({ tipo: "aceito", item: alvo.numero, valor: decisao.valor, casas: decisao.casas });
        return;
      }

      case "recusado": {
        alvo.falhasSeguidas = 0;
        this.aviso({
          tipo: "recusado",
          item: alvo.numero,
          codigo: resultado.codigo,
          mensagem: resultado.mensagem
        });
        if (DESARMAM.includes(resultado.codigo)) {
          this.desarmar(alvo.numero, resultado.mensagem, resultado.codigo);
        } else {
          alvo.ultimoMotivo = resultado.mensagem;
        }
        return;
      }

      case "sessao-caiu":
        this.sessaoCaiu();
        return;

      case "falha": {
        alvo.falhasSeguidas++;
        const toleradas = this.opcoes.falhasToleradas ?? 3;
        this.aviso({
          tipo: "falhou",
          item: alvo.numero,
          mensagem: resultado.mensagem,
          seguidas: alvo.falhasSeguidas
        });
        if (alvo.falhasSeguidas >= toleradas) {
          this.desarmar(
            alvo.numero,
            `${alvo.falhasSeguidas} falhas seguidas ao enviar lance (${resultado.mensagem}). ` +
              "Robô parado neste item para não ficar martelando o portal."
          );
        } else {
          alvo.ultimoMotivo = resultado.mensagem;
        }
        return;
      }
    }
  }

  private aviso(evento: EventoMotor): void {
    this.opcoes.aoEvento?.(evento);
  }
}

/** Projeta o tempo restante a partir de quando a leitura chegou. */
function projetar(leitura: LeituraItem, agora: number): EstadoItem {
  const base = leitura.estado;
  if (base.segundosRestantes === null) return base;
  const decorrido = Math.max(0, (agora - leitura.recebidoEm) / 1000);
  return { ...base, segundosRestantes: base.segundosRestantes - decorrido };
}

/**
 * Funde a leitura nova na anterior: campo que veio ilegível não apaga o que já se sabia.
 * Um evento parcial do portal (só o melhor lance, por exemplo) não deve cegar o motor.
 */
function fundir(anterior: LeituraItem | null, nova: LeituraItem): LeituraItem {
  if (!anterior) return nova;
  const a = anterior.estado;
  const n = nova.estado;
  return {
    ...nova,
    compra: nova.compra ?? anterior.compra,
    fase: nova.fase ?? anterior.fase,
    aceitaLida: nova.aceitaLida ?? anterior.aceitaLida,
    dizimaLida: nova.dizimaLida ?? anterior.dizimaLida,
    estado: {
      ...n,
      // Mensagem que não falou de "aceita lance" não fecha o item, e mensagem que não
      // falou de dízima não muda o número de casas.
      aceitaLance: nova.aceitaLida === null ? a.aceitaLance : n.aceitaLance,
      permitirDizima: nova.dizimaLida === null ? a.permitirDizima : n.permitirDizima,
      melhorValorGeral: n.melhorValorGeral ?? a.melhorValorGeral,
      nossoMelhorValor: n.nossoMelhorValor ?? a.nossoMelhorValor,
      variacaoMinimaMelhorLance: n.variacaoMinimaMelhorLance ?? a.variacaoMinimaMelhorLance,
      variacaoMinimaFornecedor: n.variacaoMinimaFornecedor ?? a.variacaoMinimaFornecedor,
      segundosRestantes: n.segundosRestantes ?? a.segundosRestantes
    }
  };
}
