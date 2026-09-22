import type { WebContents } from "electron";

/**
 * Captura em tempo real de dentro da própria sala de disputa.
 *
 * A pergunta natural é "como ler os lances sem conhecer a API do portal?". A resposta
 * não é captura de tela: OCR erra dígito, e ler 1.250,50 como 1.250,60 custa dinheiro
 * real numa disputa. Também não é adivinhar endpoints REST.
 *
 * A sala de disputa já recebe os lances em tempo real — por WebSocket ou SSE — e já os
 * decodifica para desenhar a tela. Em vez de refazer esse trabalho por fora, este módulo
 * injeta um observador DENTRO da página que:
 *
 *  1. envolve `WebSocket` e `EventSource` para espelhar cada mensagem que chega;
 *  2. observa mutações no DOM como rede de segurança, caso o portal use polling comum.
 *
 * Vantagens sobre as alternativas: os dados chegam já decodificados, no mesmo instante
 * em que a página os recebe, sem erro de leitura e sem depender de engenharia reversa.
 *
 * O observador não lê formulários, não toca em credenciais e não envia nada: só espelha
 * o que a página já recebeu do servidor.
 */

export type TipoEventoSala = "mensagem-stream" | "mutacao-dom";

export interface EventoSala {
  tipo: TipoEventoSala;
  origem: string;
  /** Conteúdo cru, como a página recebeu. A interpretação acontece do lado do motor. */
  dados: string;
  em: string;
}

/** Prefixo que separa o que é nosso do console normal da página. */
const MARCA = "__LANCEBOT_EVT__";

/**
 * Script injetado no mundo principal da página. Precisa ser autocontido: roda no
 * contexto do portal, sem acesso a nada do aplicativo.
 */
function scriptObservador(): string {
  return `
(() => {
  if (window.__lancebotAtivo) return "ja-ativo";
  window.__lancebotAtivo = true;

  const emitir = (tipo, origem, dados) => {
    try {
      // Recorta payloads gigantes: o que interessa cabe folgado neste limite.
      const texto = typeof dados === "string" ? dados : JSON.stringify(dados);
      console.log("${MARCA}" + JSON.stringify({
        tipo: tipo,
        origem: String(origem).slice(0, 200),
        dados: String(texto).slice(0, 4000),
        em: new Date().toISOString()
      }));
    } catch (e) { /* nunca deixar o observador quebrar a página */ }
  };

  // --- WebSocket: onde a disputa normalmente trafega em tempo real ---
  const WSOriginal = window.WebSocket;
  if (WSOriginal) {
    window.WebSocket = function (url, protocolos) {
      const ws = protocolos ? new WSOriginal(url, protocolos) : new WSOriginal(url);
      ws.addEventListener("message", (ev) => emitir("mensagem-stream", url, ev.data));
      return ws;
    };
    window.WebSocket.prototype = WSOriginal.prototype;
    Object.assign(window.WebSocket, WSOriginal);
  }

  // --- Server-Sent Events ---
  const ESOriginal = window.EventSource;
  if (ESOriginal) {
    window.EventSource = function (url, cfg) {
      const es = new ESOriginal(url, cfg);
      es.addEventListener("message", (ev) => emitir("mensagem-stream", url, ev.data));
      return es;
    };
    window.EventSource.prototype = ESOriginal.prototype;
    Object.assign(window.EventSource, ESOriginal);
  }

  // --- DOM: rede de segurança para portais que atualizam por polling ---
  // Só reporta trechos que contenham valor monetário, para não inundar com ruído.
  const MOEDA = /R\\$\\s*[\\d.]+,\\d{2}/;
  let ultimoEnvio = 0;
  const observador = new MutationObserver((mutacoes) => {
    const agora = Date.now();
    if (agora - ultimoEnvio < 250) return; // no máximo 4 amostras por segundo
    for (const m of mutacoes) {
      const alvo = m.target;
      const texto = alvo && alvo.textContent ? alvo.textContent.trim() : "";
      if (texto && texto.length < 400 && MOEDA.test(texto)) {
        ultimoEnvio = agora;
        emitir("mutacao-dom", location.pathname, texto);
        break;
      }
    }
  });
  observador.observe(document.body, { childList: true, subtree: true, characterData: true });

  return "observador-ativo";
})();
`;
}

/**
 * Liga o observador numa janela do portal e encaminha cada evento capturado.
 * Reinjeta a cada navegação, porque a página perde o script ao trocar de rota.
 */
const jaObservados = new WeakSet<WebContents>();

export function observarSala(conteudo: WebContents, aoEvento: (e: EventoSala) => void): void {
  // Chamar duas vezes na mesma janela empilhava listeners de console e duplicava cada
  // evento no log — e a janela da sala passa por aqui a cada "conferir" e cada início.
  if (jaObservados.has(conteudo)) return;
  jaObservados.add(conteudo);

  const injetar = () => {
    conteudo.executeJavaScript(scriptObservador(), true).catch(() => {
      // Página ainda carregando ou navegação cancelada: a próxima tentativa cobre.
    });
  };

  conteudo.on("dom-ready", injetar);
  conteudo.on("did-navigate-in-page", injetar);

  conteudo.on("console-message", (_evento, _nivel, mensagem) => {
    if (!mensagem.startsWith(MARCA)) return;
    try {
      aoEvento(JSON.parse(mensagem.slice(MARCA.length)) as EventoSala);
    } catch {
      // Mensagem truncada pelo console: descartar é melhor que propagar lixo.
    }
  });

  injetar();
}

/** Extrai valores monetários de um texto cru, do maior para o menor. */
export function extrairValores(texto: string): number[] {
  const achados = [...texto.matchAll(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2})/g)];
  return achados
    .map((m) => {
      const bruto = m[1];
      return Number(bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto);
    })
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);
}
