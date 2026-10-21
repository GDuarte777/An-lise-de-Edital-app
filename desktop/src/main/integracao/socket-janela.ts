/**
 * Abre o WebSocket da disputa de dentro da janela do portal.
 *
 * Poderia ser um socket do processo principal, mas aí o handshake sairia sem os cookies e
 * sem a origem que o portal espera — e passaria a depender de WebSocket global do Node,
 * que varia de versão. Abrindo na própria janela em que o operador está logado, quem faz
 * o handshake é o Chromium, com a sessão que ele já tem.
 *
 * O caminho de volta é dreno por `executeJavaScript`: o script da página empilha o que
 * chega numa fila e o processo principal esvazia a fila em intervalo curto. Não é "push"
 * de verdade, mas o atraso é o do intervalo (padrão 50 ms) — ordens de grandeza menor que
 * o laço de leitura por REST que isto substitui.
 */
import type { WebContents } from "electron";
import type { AbrirSocket, ManipuladoresSocket, SocketStomp } from "../bot/stomp/cliente.js";

const PONTE = "__horasisPonteStomp";

/** Script instalado uma vez por janela. Idempotente: recarregar a página reinstala. */
function fonteDaPonte(): string {
  return `
(() => {
  if (window.${PONTE}) return true;
  const sockets = new Map();
  window.${PONTE} = {
    abrir(id, url, protocolos) {
      const entrada = { fila: [], aberto: false, fechado: null, erro: null, socket: null };
      sockets.set(id, entrada);
      try {
        const s = protocolos && protocolos.length ? new WebSocket(url, protocolos) : new WebSocket(url);
        entrada.socket = s;
        s.onopen = () => { entrada.aberto = true; };
        s.onmessage = (ev) => {
          if (typeof ev.data === "string") entrada.fila.push(ev.data);
          else entrada.erro = "quadro binário não suportado";
        };
        s.onclose = (ev) => { entrada.fechado = "codigo " + ev.code + (ev.reason ? ": " + ev.reason : ""); };
        s.onerror = () => { entrada.erro = "erro no socket"; };
      } catch (e) {
        entrada.erro = String((e && e.message) || e);
      }
      return true;
    },
    enviar(id, texto) {
      const e = sockets.get(id);
      if (!e || !e.socket || e.socket.readyState !== 1) return false;
      e.socket.send(texto);
      return true;
    },
    drenar(id) {
      const e = sockets.get(id);
      if (!e) return { ausente: true, aberto: false, textos: [], fechado: null, erro: null };
      const textos = e.fila;
      e.fila = [];
      const abriu = e.aberto;
      e.aberto = false;
      const erro = e.erro;
      e.erro = null;
      return { ausente: false, aberto: abriu, textos, fechado: e.fechado, erro };
    },
    fechar(id) {
      const e = sockets.get(id);
      if (e && e.socket) { try { e.socket.close(); } catch (_) {} }
      sockets.delete(id);
      return true;
    }
  };
  return true;
})();`;
}

interface Dreno {
  ausente: boolean;
  aberto: boolean;
  textos: string[];
  fechado: string | null;
  erro: string | null;
}

export interface OpcoesSocketJanela {
  /** De quanto em quanto tempo esvaziar a fila da página. */
  intervaloDrenoMs?: number;
  aoRegistrar?: (nivel: "sistema" | "alerta", msg: string) => void;
}

/**
 * `obterConteudo` é função, não valor: a janela da disputa pode ser fechada e reaberta
 * entre uma reconexão e a seguinte, e o cliente STOMP não precisa saber disso.
 */
export function criarAbrirSocketEmJanela(
  obterConteudo: () => WebContents | null,
  opcoes: OpcoesSocketJanela = {}
): AbrirSocket {
  const intervalo = Math.max(10, opcoes.intervaloDrenoMs ?? 50);
  let sequencia = 0;

  return (url: string, subprotocolos: readonly string[], m: ManipuladoresSocket): SocketStomp => {
    const id = `s${++sequencia}`;
    let vivo = true;
    let relogio: NodeJS.Timeout | null = null;

    const falhar = (mensagem: string) => {
      if (!vivo) return;
      vivo = false;
      if (relogio) clearInterval(relogio);
      m.aoErro(new Error(mensagem));
    };

    const avaliar = async () => {
      const conteudo = obterConteudo();
      if (!conteudo || conteudo.isDestroyed()) {
        falhar("janela da disputa não está aberta");
        return;
      }
      const dreno = (await conteudo.executeJavaScript(
        `window.${PONTE} ? window.${PONTE}.drenar(${JSON.stringify(id)}) : {ausente:true,aberto:false,textos:[],fechado:null,erro:null}`,
        true
      )) as Dreno;

      if (!vivo) return;
      if (dreno.ausente) {
        // A página recarregou e levou a ponte com ela.
        falhar("ponte do socket perdida (página recarregada)");
        return;
      }
      if (dreno.aberto) m.aoAbrir();
      for (const texto of dreno.textos) {
        if (!vivo) return;
        m.aoTexto(texto);
      }
      if (dreno.erro) {
        falhar(dreno.erro);
        return;
      }
      if (dreno.fechado) {
        vivo = false;
        if (relogio) clearInterval(relogio);
        m.aoFechar(dreno.fechado);
      }
    };

    void (async () => {
      try {
        const conteudo = obterConteudo();
        if (!conteudo || conteudo.isDestroyed()) throw new Error("janela da disputa não está aberta");
        await conteudo.executeJavaScript(fonteDaPonte(), true);
        await conteudo.executeJavaScript(
          `window.${PONTE}.abrir(${JSON.stringify(id)}, ${JSON.stringify(url)}, ${JSON.stringify([...subprotocolos])})`,
          true
        );
        opcoes.aoRegistrar?.("sistema", "WebSocket da disputa aberto na janela do portal.");
        relogio = setInterval(() => {
          void avaliar().catch((e: unknown) => falhar(e instanceof Error ? e.message : "falha no dreno do socket"));
        }, intervalo);
      } catch (erro) {
        falhar(erro instanceof Error ? erro.message : "falha ao abrir o socket na janela");
      }
    })();

    return {
      enviar(texto: string): void {
        const conteudo = obterConteudo();
        if (!conteudo || conteudo.isDestroyed()) {
          falhar("janela da disputa não está aberta");
          return;
        }
        // Fire-and-forget de propósito: o contrato de SocketStomp é síncrono e o cliente
        // já trata queda pelo caminho de erro.
        void conteudo
          .executeJavaScript(`window.${PONTE}.enviar(${JSON.stringify(id)}, ${JSON.stringify(texto)})`, true)
          .then((enviou: unknown) => {
            if (enviou === false) falhar("socket não estava pronto para enviar");
          })
          .catch((e: unknown) => falhar(e instanceof Error ? e.message : "falha ao enviar pelo socket"));
      },
      fechar(): void {
        vivo = false;
        if (relogio) clearInterval(relogio);
        const conteudo = obterConteudo();
        if (!conteudo || conteudo.isDestroyed()) return;
        void conteudo
          .executeJavaScript(`window.${PONTE} && window.${PONTE}.fechar(${JSON.stringify(id)})`, true)
          .catch(() => {
            // janela indo embora; nada a fazer
          });
      }
    };
  };
}
