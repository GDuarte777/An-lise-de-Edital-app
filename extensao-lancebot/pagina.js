/**
 * Roda no MUNDO PRINCIPAL da página do Compras.gov.br.
 *
 * Existe por dois motivos que o mundo isolado de um content script não alcança:
 *
 * 1. **O WebSocket da disputa.** A coleta provou que o portal recebe lance empurrado por
 *    `wss://.../comprasnet-websocket/socket/websocket`. Este arquivo avisa a cada
 *    mensagem — mas NÃO tenta interpretar o conteúdo. O formato do payload é
 *    desconhecido, e adivinhar campo de JSON foi o erro que já derrubou este projeto
 *    duas vezes. A mensagem serve como gatilho: "algo mudou, releia a tela". Quem lê o
 *    valor continua sendo o DOM, que é o que o operador também vê.
 *
 * 2. **Queda de conexão.** O fechamento do socket é o sinal mais rápido de que a tela
 *    congelou. O portal só mostra "Recarregar página" depois; aqui sabemos antes.
 *
 * Também espelha as requisições, para reconhecer o desfecho de um lance enviado e para
 * aprender o endereço do POST de lance na primeira vez que ele acontecer.
 */
(() => {
  if (window.__lancebotPagina) return;
  window.__lancebotPagina = true;

  const avisar = (dados) => {
    try {
      window.postMessage(Object.assign({ __lancebot: true }, dados), "*");
    } catch (e) { /* payload não serializável */ }
  };

  const RE_LANCE = /lance|oferta|proposta/i;

  /* ------------------------------------------------------- tempo real */

  const WS = window.WebSocket;
  if (WS) {
    window.WebSocket = function (url, protocolos) {
      const ws = protocolos ? new WS(url, protocolos) : new WS(url);
      const ehDisputa = /comprasnet-websocket|socket/i.test(String(url));

      if (ehDisputa) {
        avisar({ tipo: "canal", estado: "abrindo", url: String(url) });
        ws.addEventListener("open", () => avisar({ tipo: "canal", estado: "aberto" }));
        // Só o fato de ter chegado mensagem interessa: o conteúdo não é interpretado.
        ws.addEventListener("message", () => avisar({ tipo: "mudou", origem: "websocket" }));
        ws.addEventListener("close", () => avisar({ tipo: "canal", estado: "fechado" }));
        ws.addEventListener("error", () => avisar({ tipo: "canal", estado: "erro" }));
      }
      return ws;
    };
    window.WebSocket.prototype = WS.prototype;
    Object.assign(window.WebSocket, WS);
  }

  /* ----------------------------------------------------------- rede */

  const RE_RETOKEN = /sessao\/fornecedor\/retoken/i;

  /**
   * Respostas de GET que valem espelhar inteiras.
   *
   * O chat é a razão principal: ele já vem por aqui quando o portal o carrega, e ler a
   * resposta é muito mais confiável do que depender de a gaveta de mensagens estar
   * aberta na tela. As demais alimentam o gravador de aprendizado — o material do robô
   * executável de amanhã.
   *
   * A lista é curta de propósito: espelhar o corpo de TODA requisição pesaria justamente
   * na hora do lance.
   */
  const RE_DADOS = /\/(chat|lances|itens\/(em-disputa|aguardando-disputa|disputa-encerrada)|propostas-iniciais|participacao)\b/i;

  const anotar = (metodo, url, status, corpo) => {
    // A renovação de token é sinal de saúde, não de queda: avisa para o robô NÃO
    // recarregar a página achando que perdeu a sessão.
    if (RE_RETOKEN.test(url) && status >= 200 && status < 300) {
      avisar({ tipo: "retoken", em: Date.now() });
      return;
    }
    if (metodo === "GET") {
      if (RE_DADOS.test(url)) {
        avisar({
          tipo: "dados", metodo, url: String(url).slice(0, 400),
          status, corpo: String(corpo || "").slice(0, 60000), em: Date.now()
        });
      }
      return;
    }
    if (!RE_LANCE.test(url)) return;
    avisar({
      tipo: "resposta-lance", metodo, url: String(url),
      status, corpo: String(corpo || "").slice(0, 400), em: Date.now()
    });
  };

  const fetchOriginal = window.fetch;
  if (typeof fetchOriginal === "function") {
    window.fetch = function (entrada, cfg) {
      const url = typeof entrada === "string" ? entrada : (entrada && entrada.url) || "";
      const metodo = String((cfg && cfg.method) || (entrada && entrada.method) || "GET").toUpperCase();
      const p = fetchOriginal.apply(this, arguments);
      if ((metodo !== "GET" && (RE_LANCE.test(url) || RE_RETOKEN.test(url))) ||
          (metodo === "GET" && RE_DADOS.test(url))) {
        p.then((r) => {
          const s = r.status;
          r.clone().text().then((t) => anotar(metodo, url, s, t)).catch(() => anotar(metodo, url, s, ""));
        }).catch(() => { /* falha de rede vira ausência de desfecho */ });
      }
      return p;
    };
  }

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const abrir = XHR.prototype.open;
    XHR.prototype.open = function (metodo, url) {
      this.__lb = { metodo: String(metodo).toUpperCase(), url: String(url) };
      return abrir.apply(this, arguments);
    };
    const enviar = XHR.prototype.send;
    XHR.prototype.send = function () {
      const i = this.__lb, x = this;
      const interessa = i && ((i.metodo !== "GET" && (RE_LANCE.test(i.url) || RE_RETOKEN.test(i.url))) ||
                              (i.metodo === "GET" && RE_DADOS.test(i.url)));
      if (interessa) {
        x.addEventListener("loadend", () => {
          let c = "";
          try { c = String(x.responseText || ""); } catch (e) { /* binário */ }
          anotar(i.metodo, i.url, x.status, c);
        });
      }
      return enviar.apply(this, arguments);
    };
  }
})();
