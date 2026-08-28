/**
 * Roda no MUNDO PRINCIPAL da página, para enxergar o `fetch`, o `XMLHttpRequest` e o
 * `WebSocket` do próprio portal — um content script normal vive num mundo isolado e
 * veria apenas cópias vazias desses objetos.
 *
 * Ele só ANOTA o que a página já faz sozinha. Não dispara requisição, não lê formulário,
 * não toca em credencial. O que é anotado vai para o coletor, que mascara antes de salvar.
 *
 * A pergunta que este arquivo existe para responder: a tela recebe lance empurrado pelo
 * servidor (WebSocket/SSE) ou depende de alguém apertar "Atualizar"? A resposta muda todo
 * o desenho do robô.
 */
(() => {
  const MARCA = "__horasisColetorGancho";
  if (window[MARCA]) return;
  window[MARCA] = true;

  const enviar = (dados) => {
    try {
      window.postMessage(Object.assign({ __horasisColetor: true }, dados), "*");
    } catch (e) {
      /* payload não serializável: descartar é melhor que quebrar a página */
    }
  };

  const fetchOriginal = window.fetch;
  if (typeof fetchOriginal === "function") {
    window.fetch = function (entrada, cfg) {
      const url = typeof entrada === "string" ? entrada : (entrada && entrada.url) || "";
      const metodo = String((cfg && cfg.method) || (entrada && entrada.method) || "GET").toUpperCase();
      const em = Date.now();
      const p = fetchOriginal.apply(this, arguments);
      p.then(
        (r) => enviar({ tipo: "rede", via: "fetch", metodo, url, status: r.status, em, ms: Date.now() - em }),
        () => enviar({ tipo: "rede", via: "fetch", metodo, url, status: 0, em, ms: Date.now() - em })
      );
      return p;
    };
  }

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const abrirOriginal = XHR.prototype.open;
    XHR.prototype.open = function (metodo, url) {
      this.__h = { metodo: String(metodo).toUpperCase(), url: String(url), em: Date.now() };
      return abrirOriginal.apply(this, arguments);
    };
    const enviarOriginal = XHR.prototype.send;
    XHR.prototype.send = function () {
      const info = this.__h;
      const xhr = this;
      if (info) {
        xhr.addEventListener("loadend", () =>
          enviar({
            tipo: "rede", via: "xhr", metodo: info.metodo, url: info.url,
            status: xhr.status, em: info.em, ms: Date.now() - info.em
          })
        );
      }
      return enviarOriginal.apply(this, arguments);
    };
  }

  // Tempo real: se nada aparecer aqui, está confirmado que a tela depende de atualização.
  const WS = window.WebSocket;
  if (WS) {
    window.WebSocket = function (url, protocolos) {
      enviar({ tipo: "tempo-real", canal: "websocket", url: String(url), em: Date.now() });
      return protocolos ? new WS(url, protocolos) : new WS(url);
    };
    window.WebSocket.prototype = WS.prototype;
    Object.assign(window.WebSocket, WS);
  }

  const ES = window.EventSource;
  if (ES) {
    window.EventSource = function (url, cfg) {
      enviar({ tipo: "tempo-real", canal: "eventsource", url: String(url), em: Date.now() });
      return new ES(url, cfg);
    };
    window.EventSource.prototype = ES.prototype;
    Object.assign(window.EventSource, ES);
  }
})();
