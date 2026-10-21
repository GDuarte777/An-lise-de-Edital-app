/**
 * Cliente STOMP sobre o WebSocket do portal.
 *
 * O que ele faz: conecta, autentica no CONNECT, mantém o pulso, reassina os tópicos e
 * reconecta com recuo quando o socket cai. O que ele não faz: abrir socket. Quem abre é
 * injetado (`abrirSocket`), por dois motivos — o módulo continua sem depender do Electron,
 * e o comportamento de queda/reconexão fica testável sem rede.
 *
 * Regra de log: nada de corpo de mensagem nem de cabeçalho de autorização nos eventos.
 * Log existe para o operador entender a conexão, não para guardar sessão em disco.
 */
import { Recuo } from "../limites.js";
import { TEMPORIZADOR_REAL, type Temporizador } from "../tempo.js";
import { HOSTS, WEBSOCKET, type Ambiente } from "../endpoints.js";
import { analisarFluxo, negociarPulso, serializar, PULSO, type Quadro } from "./quadros.js";

export type EstadoConexao = "parado" | "conectando" | "conectado" | "aguardando-reconexao";

export interface SocketStomp {
  enviar(texto: string): void;
  fechar(): void;
}

export interface ManipuladoresSocket {
  aoAbrir(): void;
  aoTexto(texto: string): void;
  aoFechar(motivo: string): void;
  aoErro(erro: Error): void;
}

export type AbrirSocket = (
  url: string,
  subprotocolos: readonly string[],
  manipuladores: ManipuladoresSocket
) => SocketStomp;

/** Relógio e timers injetáveis vivem em `tempo.ts`; aqui só se reexporta. */
export type { Temporizador } from "../tempo.js";
export { TEMPORIZADOR_REAL } from "../tempo.js";

export type EventoStomp =
  | { tipo: "conectando"; tentativa: number }
  | { tipo: "conectado"; versao: string; enviarCadaMs: number; esperarCadaMs: number }
  | { tipo: "desconectado"; motivo: string; reconectarEmMs: number | null }
  | { tipo: "erro-servidor"; mensagem: string }
  | { tipo: "pulso-perdido"; silencioMs: number }
  | { tipo: "assinado"; destino: string; id: string }
  | { tipo: "quadro-ignorado"; comando: string };

export interface OpcoesCliente {
  url: string;
  subprotocolos?: readonly string[];
  /**
   * Lido a cada CONNECT, não uma vez só: entre uma queda e a reconexão o token pode ter
   * sido renovado. Devolver string vazia aborta a tentativa — melhor não conectar do que
   * conectar sem sessão.
   */
  autorizacao: () => string;
  /** Vai no cabeçalho `host` do CONNECT. Sem ele, deduzido da URL. */
  hospedeiro?: string;
  pulso?: { envio: number; recepcao: number };
  /** Quantos intervalos de silêncio até considerar o socket morto. */
  toleranciaPulso?: number;
  temporizador?: Temporizador;
  abrirSocket: AbrirSocket;
  aoEvento?: (evento: EventoStomp) => void;
}

interface Assinatura {
  id: string;
  destino: string;
  cabecalhos: Record<string, string>;
  aoMensagem: (quadro: Quadro) => void;
}

const PULSO_PADRAO = { envio: 10_000, recepcao: 10_000 } as const;

/** [da análise do SIGA 0.7.4] O portal espera `protocolVersion` na query do socket. */
export function montarUrlWebSocket(ambiente: Ambiente): string {
  const base = HOSTS[ambiente].replace(/^http/, "ws");
  return `${base}${WEBSOCKET.caminho}?protocolVersion=${WEBSOCKET.versaoProtocolo}`;
}

export class ClienteStomp {
  estado: EstadoConexao = "parado";

  private readonly opcoes: OpcoesCliente;
  private readonly tempo: Temporizador;
  private readonly recuo = new Recuo(1_000, 60_000);
  private readonly assinaturas = new Map<string, Assinatura>();

  private socket: SocketStomp | null = null;
  private acumulado = "";
  private proximoId = 1;
  private tentativa = 0;
  private desejaConexao = false;

  private ultimoRecebidoEm = 0;
  private cancelarEnvioPulso: (() => void) | null = null;
  private cancelarVigia: (() => void) | null = null;
  private cancelarReconexao: (() => void) | null = null;

  constructor(opcoes: OpcoesCliente) {
    this.opcoes = opcoes;
    this.tempo = opcoes.temporizador ?? TEMPORIZADOR_REAL;
  }

  conectar(): void {
    this.desejaConexao = true;
    if (this.estado === "conectando" || this.estado === "conectado") return;
    this.abrir();
  }

  /**
   * Assina um tópico. Pode ser chamado antes de conectar e sobrevive a reconexão: a
   * assinatura fica no registro e é reenviada em cada CONNECTED.
   */
  assinar(
    destino: string,
    aoMensagem: (quadro: Quadro) => void,
    cabecalhos: Record<string, string> = {}
  ): () => void {
    const id = `sub-${this.proximoId++}`;
    const assinatura: Assinatura = { id, destino, cabecalhos, aoMensagem };
    this.assinaturas.set(id, assinatura);
    if (this.estado === "conectado") this.enviarAssinatura(assinatura);
    return () => {
      this.assinaturas.delete(id);
      if (this.estado === "conectado") {
        this.enviarQuadro({ comando: "UNSUBSCRIBE", cabecalhos: { id }, corpo: "" });
      }
    };
  }

  enviar(destino: string, corpo: string, cabecalhos: Record<string, string> = {}): void {
    if (this.estado !== "conectado") throw new Error("Socket STOMP não está conectado.");
    this.enviarQuadro({
      comando: "SEND",
      cabecalhos: { destination: destino, "content-length": String(corpo.length), ...cabecalhos },
      corpo
    });
  }

  /** Encerra de propósito: nada de reconexão depois disto. */
  desconectar(motivo = "pedido do operador"): void {
    this.desejaConexao = false;
    if (this.estado === "conectado") {
      try {
        this.enviarQuadro({ comando: "DISCONNECT", cabecalhos: {}, corpo: "" });
      } catch {
        // socket já indo embora; o fechamento abaixo resolve.
      }
    }
    this.pararTimers();
    this.socket?.fechar();
    this.socket = null;
    this.acumulado = "";
    this.estado = "parado";
    this.aviso({ tipo: "desconectado", motivo, reconectarEmMs: null });
  }

  // ---------- conexão ----------

  private abrir(): void {
    const token = this.opcoes.autorizacao();
    if (!token) {
      this.estado = "parado";
      this.desejaConexao = false;
      this.aviso({ tipo: "desconectado", motivo: "sem token de sessão", reconectarEmMs: null });
      return;
    }

    this.tentativa++;
    this.estado = "conectando";
    this.acumulado = "";
    this.aviso({ tipo: "conectando", tentativa: this.tentativa });

    const pulso = this.opcoes.pulso ?? PULSO_PADRAO;
    const enviarConnect = () => {
      this.ultimoRecebidoEm = this.tempo.agora();
      this.enviarQuadro({
        comando: "CONNECT",
        cabecalhos: {
          "accept-version": "1.2",
          host: this.opcoes.hospedeiro ?? hospedeiroDaUrl(this.opcoes.url),
          "heart-beat": `${pulso.envio},${pulso.recepcao}`,
          Authorization: token
        },
        corpo: ""
      });
    };

    // Uma implementação de socket pode chamar aoAbrir ainda dentro de abrirSocket, antes
    // de `this.socket` existir. Nesse caso o CONNECT sai logo depois da atribuição.
    let abriuCedo = false;
    const socket = this.opcoes.abrirSocket(
      this.opcoes.url,
      this.opcoes.subprotocolos ?? WEBSOCKET.subprotocolos,
      {
        aoAbrir: () => {
          if (!this.socket) {
            abriuCedo = true;
            return;
          }
          enviarConnect();
        },
        aoTexto: (texto) => this.receber(texto),
        aoFechar: (motivo) => this.cair(motivo),
        aoErro: (erro) => this.cair(erro.message || "erro no socket")
      }
    );

    if (this.estado !== "conectando") {
      // Caiu antes de a atribuição acontecer: o socket não é mais de ninguém.
      socket.fechar();
      return;
    }
    this.socket = socket;
    if (abriuCedo) enviarConnect();
  }

  private receber(texto: string): void {
    this.ultimoRecebidoEm = this.tempo.agora();
    this.acumulado += texto;

    let lote: ReturnType<typeof analisarFluxo>;
    try {
      lote = analisarFluxo(this.acumulado);
    } catch (erro) {
      // Quadro impossível de ler: não há como seguir fingindo que o fluxo está são.
      this.cair(erro instanceof Error ? erro.message : "quadro STOMP ilegível");
      return;
    }
    this.acumulado = lote.resto;
    for (const quadro of lote.quadros) this.tratar(quadro);
  }

  private tratar(quadro: Quadro): void {
    switch (quadro.comando) {
      case "CONNECTED":
        this.aoConectar(quadro);
        return;
      case "MESSAGE": {
        const id = quadro.cabecalhos.subscription;
        const assinatura =
          (id ? this.assinaturas.get(id) : undefined) ??
          [...this.assinaturas.values()].find((a) => a.destino === quadro.cabecalhos.destination);
        if (!assinatura) {
          this.aviso({ tipo: "quadro-ignorado", comando: "MESSAGE" });
          return;
        }
        assinatura.aoMensagem(quadro);
        return;
      }
      case "ERROR":
        // `message` é o resumo do erro do portal; o corpo pode trazer dado de sessão e
        // por isso não entra no log.
        this.aviso({ tipo: "erro-servidor", mensagem: quadro.cabecalhos.message ?? "erro sem descrição" });
        this.cair("ERROR do portal");
        return;
      case "RECEIPT":
        return;
      default:
        this.aviso({ tipo: "quadro-ignorado", comando: quadro.comando });
    }
  }

  private aoConectar(quadro: Quadro): void {
    this.estado = "conectado";
    this.tentativa = 0;
    this.recuo.registrarSucesso();

    const meu = this.opcoes.pulso ?? PULSO_PADRAO;
    const { enviarCadaMs, esperarCadaMs } = negociarPulso(meu, quadro.cabecalhos["heart-beat"]);
    this.ligarPulso(enviarCadaMs, esperarCadaMs);

    for (const assinatura of this.assinaturas.values()) this.enviarAssinatura(assinatura);
    this.aviso({
      tipo: "conectado",
      versao: quadro.cabecalhos.version ?? "1.2",
      enviarCadaMs,
      esperarCadaMs
    });
  }

  private enviarAssinatura(assinatura: Assinatura): void {
    this.enviarQuadro({
      comando: "SUBSCRIBE",
      cabecalhos: { id: assinatura.id, destination: assinatura.destino, ack: "auto", ...assinatura.cabecalhos },
      corpo: ""
    });
    this.aviso({ tipo: "assinado", destino: assinatura.destino, id: assinatura.id });
  }

  private enviarQuadro(quadro: Quadro): void {
    if (!this.socket) throw new Error("Socket STOMP ausente.");
    this.socket.enviar(serializar(quadro));
  }

  // ---------- pulso ----------

  private ligarPulso(enviarCadaMs: number, esperarCadaMs: number): void {
    this.pararTimers();

    if (enviarCadaMs > 0) {
      const bater = () => {
        if (this.estado !== "conectado" || !this.socket) return;
        this.socket.enviar(PULSO);
        this.cancelarEnvioPulso = this.tempo.agendar(enviarCadaMs, bater);
      };
      this.cancelarEnvioPulso = this.tempo.agendar(enviarCadaMs, bater);
    }

    if (esperarCadaMs > 0) {
      const tolerancia = this.opcoes.toleranciaPulso ?? 2;
      const limite = esperarCadaMs * tolerancia;
      const vigiar = () => {
        if (this.estado !== "conectado") return;
        const silencio = this.tempo.agora() - this.ultimoRecebidoEm;
        if (silencio >= limite) {
          this.aviso({ tipo: "pulso-perdido", silencioMs: silencio });
          this.cair("silêncio do portal além do pulso combinado");
          return;
        }
        this.cancelarVigia = this.tempo.agendar(esperarCadaMs, vigiar);
      };
      this.cancelarVigia = this.tempo.agendar(esperarCadaMs, vigiar);
    }
  }

  private pararTimers(): void {
    this.cancelarEnvioPulso?.();
    this.cancelarVigia?.();
    this.cancelarReconexao?.();
    this.cancelarEnvioPulso = null;
    this.cancelarVigia = null;
    this.cancelarReconexao = null;
  }

  // ---------- queda e reconexão ----------

  private cair(motivo: string): void {
    if (this.estado === "parado") return;
    this.pararTimers();
    const socket = this.socket;
    this.socket = null;
    this.acumulado = "";
    socket?.fechar();

    if (!this.desejaConexao) {
      this.estado = "parado";
      this.aviso({ tipo: "desconectado", motivo, reconectarEmMs: null });
      return;
    }

    const espera = this.recuo.registrarFalha();
    this.estado = "aguardando-reconexao";
    this.aviso({ tipo: "desconectado", motivo, reconectarEmMs: espera });
    this.cancelarReconexao = this.tempo.agendar(espera, () => {
      this.cancelarReconexao = null;
      if (this.desejaConexao && this.estado === "aguardando-reconexao") this.abrir();
    });
  }

  private aviso(evento: EventoStomp): void {
    this.opcoes.aoEvento?.(evento);
  }
}

function hospedeiroDaUrl(url: string): string {
  const semEsquema = url.replace(/^\w+:\/\//, "");
  const corte = semEsquema.search(/[/?]/);
  return corte === -1 ? semEsquema : semEsquema.slice(0, corte);
}
