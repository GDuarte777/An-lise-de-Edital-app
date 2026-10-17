/**
 * Liga o adapter REST do robô à sessão do Electron onde o operador fez login.
 *
 * Por que passar pela `Session` em vez de usar fetch do Node: os cookies de sessão são
 * anexados pelo próprio Chromium, o TLS é negociado por ele (o que faz certificado A3
 * continuar funcionando, com a chave privada parada no token físico) e nada de sessão é
 * copiado, guardado ou transmitido por nós.
 *
 * Este arquivo é a fronteira: daqui para dentro (`bot/`) não existe Electron.
 */
import type { Session } from "electron";
import type { PedidoHttp, RespostaHttp, Transporte } from "../bot/rest/portal.js";

export interface OpcoesTransporte {
  /** Tempo máximo por requisição. Sem isso, um portal pendurado pendura o robô. */
  tempoLimiteMs?: number;
  /** Origin/Referer esperados pelo portal. */
  origem?: string;
}

export function criarTransporteElectron(sessao: Session, opcoes: OpcoesTransporte = {}): Transporte {
  const tempoLimiteMs = opcoes.tempoLimiteMs ?? 15_000;

  return async (pedido: PedidoHttp): Promise<RespostaHttp> => {
    const aborto = new AbortController();
    const relogio = setTimeout(() => aborto.abort(), tempoLimiteMs);
    try {
      const cabecalhos: Record<string, string> = { ...pedido.cabecalhos };
      if (opcoes.origem) {
        cabecalhos.Origin = opcoes.origem;
        cabecalhos.Referer = `${opcoes.origem}/`;
      }

      const resposta = await sessao.fetch(pedido.url, {
        method: pedido.metodo,
        headers: cabecalhos,
        body: pedido.corpo,
        signal: aborto.signal
      });
      return { status: resposta.status, corpo: await resposta.text() };
    } finally {
      clearTimeout(relogio);
    }
  };
}
