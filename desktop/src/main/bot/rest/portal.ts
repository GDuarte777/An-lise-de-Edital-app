/**
 * Adapter REST do portal.
 *
 * Divisão de trabalho com o WebSocket: o estado da disputa chega empurrado pelo socket;
 * o REST é para o que o socket não dá (carga inicial, classificação, histórico) e para o
 * que só existe aqui — o envio do lance.
 *
 * Três decisões que valem mais que o código:
 *
 *  1. Quem faz a requisição é injetado (`transporte`). Em produção é a `Session` do
 *     Electron onde o operador logou no gov.br, então cookie e TLS são do próprio
 *     Chromium e nada de sessão passa pelas nossas mãos. Aqui dentro não há Electron.
 *  2. Leitura que exige captcha e não tem token não é tentada. Fail-closed: é melhor não
 *     ler do que gastar requisição para levar 403 — e não existe fazenda de captcha neste
 *     projeto, o token vem da janela do próprio operador.
 *  3. Lance não é repetido automaticamente. Um 5xx pode ter sido aplicado do outro lado;
 *     repetir às cegas é arriscar dois lances. O resultado volta para o motor, que decide
 *     de novo a partir do estado novo.
 */
import { paraCorpoRequisicao, type Casas, type Micro } from "../decimal.js";
import type { CodigoRecusa } from "../estrategias.js";
import { Freio, Recuo } from "../limites.js";
import { ENVIO_LANCE, LEITURAS, SESSAO, montar, type Ambiente } from "../endpoints.js";

export interface PedidoHttp {
  url: string;
  metodo: "GET" | "POST";
  cabecalhos: Record<string, string>;
  corpo?: string;
}

export interface RespostaHttp {
  status: number;
  corpo: string;
}

export type Transporte = (pedido: PedidoHttp) => Promise<RespostaHttp>;

export type EventoRest =
  | { tipo: "requisicao"; rota: string; status: number; tentativa: number }
  | { tipo: "sem-captcha"; rota: string }
  | { tipo: "recuo"; rota: string; status: number; esperaMs: number }
  | { tipo: "sessao-caiu"; rota: string; status: number };

export interface OpcoesPortal {
  ambiente: Ambiente;
  transporte: Transporte;
  /** Token da sessão do fornecedor. Lido a cada requisição: ele é renovado em voo. */
  autorizacao: () => string;
  /** Token de hCaptcha da janela do operador. `null` quando não há — e aí não se lê. */
  captcha?: () => Promise<string | null>;
  freio?: Freio;
  recuo?: Recuo;
  /** Tentativas por leitura (só para 429/5xx). O lance nunca é repetido. */
  tentativasMaximas?: number;
  esperar?: (ms: number) => Promise<void>;
  aoEvento?: (evento: EventoRest) => void;
}

export type ResultadoLeitura =
  | { estado: "ok"; dados: unknown; status: number }
  | { estado: "sem-captcha" }
  | { estado: "sessao-caiu"; status: number }
  | { estado: "falha"; status: number; mensagem: string };

export type ResultadoLance =
  | { estado: "aceito"; status: number; dados: unknown }
  | { estado: "recusado"; codigo: CodigoRecusa; mensagem: string; status: number }
  | { estado: "sessao-caiu"; status: number }
  | { estado: "falha"; status: number; mensagem: string };

/** Fase do item, como o portal a nomeia no corpo do lance. */
export type FaseEnvio = string;

const CODIGOS: CodigoRecusa[] = [
  "ULTRAPASSA_VALOR_MINIMO",
  "NAO_RESPEITA_VARIACAO_MELHOR_LANCE",
  "NAO_RESPEITA_VARIACAO_FORNECEDOR",
  "ITEM_NAO_ACEITA_LANCE"
];

/** Acha o código de recusa do portal no corpo da resposta, sem adivinhar. */
export function extrairCodigoRecusa(corpo: string): CodigoRecusa | null {
  for (const codigo of CODIGOS) if (corpo.includes(codigo)) return codigo;
  return null;
}

/** Mensagem legível para o operador, sem despejar o corpo cru da resposta. */
function resumirMensagem(corpo: string): string {
  try {
    const json: unknown = JSON.parse(corpo);
    if (json && typeof json === "object") {
      const campos = json as Record<string, unknown>;
      for (const chave of ["message", "mensagem", "detail", "erro", "error"]) {
        const v = campos[chave];
        if (typeof v === "string" && v.trim()) return v.trim().slice(0, 300);
      }
    }
  } catch {
    // não era JSON; cai no corte abaixo
  }
  return corpo.trim().slice(0, 300);
}

function ehSessaoCaida(status: number): boolean {
  return status === 401 || status === 403;
}

function vaiRetentar(status: number): boolean {
  return status === 429 || status >= 500;
}

export class PortalRest {
  private readonly freio: Freio;
  private readonly recuo: Recuo;
  private readonly esperar: (ms: number) => Promise<void>;

  constructor(private readonly opcoes: OpcoesPortal) {
    this.freio = opcoes.freio ?? new Freio();
    this.recuo = opcoes.recuo ?? new Recuo(1_000, 60_000);
    this.esperar = opcoes.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // ---------- leituras ----------

  /** Lê uma rota do mapa de `endpoints.ts`. Rota desconhecida é erro de programação. */
  async ler(rota: keyof typeof LEITURAS | string, params: { compra?: string; item?: string } = {}): Promise<ResultadoLeitura> {
    const definicao = LEITURAS[rota];
    if (!definicao) throw new Error(`Rota de leitura desconhecida: ${rota}.`);

    let url = montar(this.opcoes.ambiente, definicao.caminho, params);
    if (definicao.exigeCaptcha) {
      const token = (await this.opcoes.captcha?.()) ?? null;
      if (!token) {
        this.aviso({ tipo: "sem-captcha", rota });
        return { estado: "sem-captcha" };
      }
      url += `${url.includes("?") ? "&" : "?"}captcha=${encodeURIComponent(token)}`;
    }

    const tentativas = Math.max(1, this.opcoes.tentativasMaximas ?? 3);
    let ultima: RespostaHttp = { status: 0, corpo: "" };

    for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
      await this.freio.vez();
      ultima = await this.chamar({ url, metodo: "GET", cabecalhos: this.cabecalhos() });
      this.aviso({ tipo: "requisicao", rota, status: ultima.status, tentativa });

      if (ultima.status >= 200 && ultima.status < 300) {
        this.recuo.registrarSucesso();
        return { estado: "ok", dados: interpretar(ultima.corpo), status: ultima.status };
      }
      if (ehSessaoCaida(ultima.status)) {
        this.aviso({ tipo: "sessao-caiu", rota, status: ultima.status });
        return { estado: "sessao-caiu", status: ultima.status };
      }
      if (!vaiRetentar(ultima.status) || tentativa === tentativas) break;

      const espera = this.recuo.registrarFalha();
      this.aviso({ tipo: "recuo", rota, status: ultima.status, esperaMs: espera });
      await this.esperar(espera);
    }

    return { estado: "falha", status: ultima.status, mensagem: resumirMensagem(ultima.corpo) };
  }

  /** [confirmado] Sem captcha: serve para saber se a sessão ainda está viva. */
  async usuario(): Promise<ResultadoLeitura> {
    await this.freio.vez();
    const url = montar(this.opcoes.ambiente, SESSAO.usuario);
    const r = await this.chamar({ url, metodo: "GET", cabecalhos: this.cabecalhos() });
    this.aviso({ tipo: "requisicao", rota: "usuario", status: r.status, tentativa: 1 });
    if (r.status >= 200 && r.status < 300) return { estado: "ok", dados: interpretar(r.corpo), status: r.status };
    if (ehSessaoCaida(r.status)) {
      this.aviso({ tipo: "sessao-caiu", rota: "usuario", status: r.status });
      return { estado: "sessao-caiu", status: r.status };
    }
    return { estado: "falha", status: r.status, mensagem: resumirMensagem(r.corpo) };
  }

  /** [confirmado] Renova o token antes de ele vencer. Sem captcha. */
  async renovarToken(): Promise<ResultadoLeitura> {
    await this.freio.vez();
    const url = montar(this.opcoes.ambiente, SESSAO.renovarToken);
    const r = await this.chamar({ url, metodo: "POST", cabecalhos: this.cabecalhos(), corpo: "" });
    this.aviso({ tipo: "requisicao", rota: "renovarToken", status: r.status, tentativa: 1 });
    if (r.status >= 200 && r.status < 300) return { estado: "ok", dados: interpretar(r.corpo), status: r.status };
    if (ehSessaoCaida(r.status)) {
      this.aviso({ tipo: "sessao-caiu", rota: "renovarToken", status: r.status });
      return { estado: "sessao-caiu", status: r.status };
    }
    return { estado: "falha", status: r.status, mensagem: resumirMensagem(r.corpo) };
  }

  // ---------- envio do lance ----------

  /**
   * Envia o lance. Uma tentativa, sempre.
   *
   * O valor sai como string formada por aritmética inteira (`paraCorpoRequisicao`), nunca
   * por número de ponto flutuante: é exatamente aqui que o robô analisado perdia centavo,
   * truncando `v * 10 ** casas` na última linha antes de enviar.
   */
  async enviarLance(pedido: {
    compra: string;
    item: string;
    valor: Micro;
    casas: Casas;
    fase: FaseEnvio;
  }): Promise<ResultadoLance> {
    const url = montar(this.opcoes.ambiente, ENVIO_LANCE.caminho, {
      compra: pedido.compra,
      item: pedido.item
    });
    const corpo = JSON.stringify({
      [ENVIO_LANCE.campos.valor]: paraCorpoRequisicao(pedido.valor, pedido.casas),
      [ENVIO_LANCE.campos.fase]: pedido.fase
    });

    await this.freio.vez();
    const r = await this.chamar({
      url,
      metodo: ENVIO_LANCE.metodo,
      cabecalhos: { ...this.cabecalhos(), "content-type": "application/json" },
      corpo
    });
    this.aviso({ tipo: "requisicao", rota: "enviarLance", status: r.status, tentativa: 1 });

    if (r.status >= 200 && r.status < 300) {
      this.recuo.registrarSucesso();
      return { estado: "aceito", status: r.status, dados: interpretar(r.corpo) };
    }
    if (ehSessaoCaida(r.status)) {
      this.aviso({ tipo: "sessao-caiu", rota: "enviarLance", status: r.status });
      return { estado: "sessao-caiu", status: r.status };
    }
    const codigo = extrairCodigoRecusa(r.corpo);
    if (codigo) return { estado: "recusado", codigo, mensagem: resumirMensagem(r.corpo), status: r.status };
    return { estado: "falha", status: r.status, mensagem: resumirMensagem(r.corpo) };
  }

  // ---------- encanamento ----------

  private cabecalhos(): Record<string, string> {
    const token = this.opcoes.autorizacao();
    if (!token) throw new Error("Sem token de sessão: requisição ao portal abortada.");
    return { Authorization: token, Accept: "application/json" };
  }

  private async chamar(pedido: PedidoHttp): Promise<RespostaHttp> {
    try {
      return await this.opcoes.transporte(pedido);
    } catch (erro) {
      // Rede caída não é resposta do portal: status 0 separa as duas coisas no log.
      return { status: 0, corpo: erro instanceof Error ? erro.message : "falha de rede" };
    }
  }

  private aviso(evento: EventoRest): void {
    this.opcoes.aoEvento?.(evento);
  }
}

/** Corpo vazio é `null`, não erro; corpo não-JSON volta como texto. */
function interpretar(corpo: string): unknown {
  const limpo = corpo.trim();
  if (!limpo) return null;
  try {
    return JSON.parse(limpo);
  } catch {
    return limpo;
  }
}
