// ═══════════════════════════════════════════════════════════════════════
// HORASIS — Robô de Lances · sonda de rede (somente leitura)
//
// Roda no mundo da própria página do portal, que é o único lugar de onde se
// enxerga o tráfego que o Comprasnet gera. Ela não altera nenhuma requisição:
// envolve fetch, XMLHttpRequest e WebSocket apenas para LER a resposta depois
// que ela chega, e repassa o conteúdo ao motor da extensão.
//
// Token, senha, captcha e afins saem mascarados antes de qualquer repasse — o
// que vai ao motor é o dado da disputa, nunca a credencial.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window.__HZ_NET_SONDA__) return;
  window.__HZ_NET_SONDA__ = true;

  var MASK_URL = /([?&][^=]*(token|sessao|sess|jsession|ticket|auth|key|hash|senha|password|captcha)[^=]*=)[^&]*/gi;
  var MASK_PAYLOAD = /("(token|senha|password|authorization|auth)[^"]*")\s*:\s*"[^"]*"/gi;
  function maskUrl(u) { try { return String(u).replace(MASK_URL, '$1=[MASCARADO]'); } catch (e) { return '[url]'; } }
  function maskPayload(p) { try { return String(p).replace(MASK_PAYLOAD, '$1:"[MASCARADO]"'); } catch (e) { return '[payload]'; } }
  function relevant() { try { return window.location.href.indexOf('comprasnet-web') > -1 || window.location.hostname === 'cnetmobile.estaleiro.serpro.gov.br' || window.location.pathname.indexOf('acompanhamento-compra') > -1; } catch (e) { return false; } }

  // Buffer: requests do carregamento inicial acontecem ANTES do content.js
  // (document_idle) instalar o listener. Guardamos e reenviamos no HELLO.
  var queue = [];
  var lastBearer = null;
  function post(d) {
    var msg = { type: 'HZ_NET_SONDA', d: d };
    try { window.postMessage(msg, window.location.origin); } catch (e) {}
    if (queue.length < 80) queue.push(msg);
  }
  window.addEventListener('message', function (ev) {
    if (ev.source !== window || !ev.data || ev.data.type !== 'HZ_NET_SONDA_OLA') return;
    try { for (var i = 0; i < queue.length; i++) window.postMessage(queue[i], window.location.origin); } catch (e) {}
    try { if (lastBearer) window.postMessage({ type: 'HZ_NET_BEARER', t: lastBearer }, window.location.origin); } catch (e) {}
  });

  // Comando do content script: busca uma página do chat NO CONTEXTO DA PÁGINA
  // (mesma sessão/cookies do usuário no portal). Somente leitura (GET).
  function chatResult(req, ok, status, body) {
    try { window.postMessage({ type: 'HZ_NET_CHAT_RESULTADO', req: req, ok: ok, s: status, b: String(body || '').substring(0, 40000) }, window.location.origin); } catch (e) {}
  }
  window.addEventListener('message', function (ev) {
    if (ev.source !== window || !ev.data || ev.data.type !== 'HZ_NET_BUSCAR_CHAT' || !ev.data.url) return;
    fetch(ev.data.url, { credentials: 'include' }).then(function (r) {
      r.text().then(function (t) { chatResult(ev.data.req, r.ok, r.status, t); }).catch(function () { chatResult(ev.data.req, false, r.status, ''); });
    }).catch(function () { chatResult(ev.data.req, false, 0, ''); });
  });

  function isChatUrl(u) { return String(u || '').indexOf('comprasnet-mensagem/v2/chat/') !== -1; }
  function send(method, url, status, ct, payload, body, ra) {
    if (!relevant()) return;
    // URL real (com o captcha dinâmico) do endpoint do chat — enviada APENAS ao
    // content script (nunca ao console). Ele a usa para buscar as páginas
    // restantes nesta mesma sessão legítima do portal.
    try { if (isChatUrl(url)) window.postMessage({ type: 'HZ_NET_CHAT_URL', u: String(url) }, window.location.origin); } catch (e) {}
    // Token de sessão do portal (JWT real da sessão do fornecedor logado) —
    // repassado APENAS ao content script desta mesma página, para autenticar
    // as leituras da disputa na mesma sessão. NUNCA vai para log/console.
    try {
      if (String(url).indexOf('/comprasnet-usuario/') > -1) {
        var tm = String(body || '').match(/"accessToken"\s*:\s*"([A-Za-z0-9._-]+)"/);
        if (tm && tm[1]) { lastBearer = tm[1]; window.postMessage({ type: 'HZ_NET_BEARER', t: tm[1] }, window.location.origin); }
      }
    } catch (e) {}
    post({
      m: String(method || 'GET'),
      u: maskUrl(url),
      s: status,
      ra: ra ? String(ra) : '',
      c: String(ct || ''),
      p: payload ? maskPayload(payload).substring(0, 400) : null,
      b: body ? String(body).substring(0, 20000) : ''
    });
  }

  // --- fetch (clona a resposta: o original segue intacto para o portal) ---
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      var args = arguments;
      var url = '';
      var method = 'GET';
      var payload = null;
      try {
        url = typeof args[0] === 'string' ? args[0] : ((args[0] && args[0].url) || '');
        method = ((args[1] && args[1].method) || 'GET').toUpperCase();
        payload = (args[1] && args[1].body) || null;
      } catch (e) {}
      try { if (isChatUrl(url)) window.postMessage({ type: 'HZ_NET_CHAT_REQ', u: maskUrl(url), m: String(method || 'GET') }, window.location.origin); } catch (e) {}
      var p = origFetch.apply(this, args);
      p.then(function (res) {
        try {
          var ct = '';
          var ra = '';
          try { ct = res.headers.get('content-type') || ''; } catch (e) {}
          try { ra = res.headers.get('retry-after') || ''; } catch (e) {}
          res.clone().text().then(function (txt) {
            send(method, url, res.status, ct, payload, txt, ra);
          }).catch(function () {});
        } catch (e) {}
      }).catch(function (err) {
        // Requisição ao chat rejeitada SEM resposta (falha de rede) — sem isto
        // ela seria invisível para o diagnóstico (pareceria "sem requisição").
        try { if (isChatUrl(url)) window.postMessage({ type: 'HZ_NET_CHAT_REQ_FALHA', u: maskUrl(url), e: String((err && err.message) || err || 'fetch_rejected') }, window.location.origin); } catch (e) {}
      });
      return p;
    };
  }

  // --- XMLHttpRequest (lê responseText APÓS o load: somente leitura) ---
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) {
    try { this.__lcNet = { m: String(m || 'GET').toUpperCase(), u: String(u || '') }; } catch (e) {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var xhr = this;
    if (xhr.__lcNet) {
      // Diagnóstico da retomada (v2.0.20): registra o INÍCIO da requisição ao
      // chat e a falha de rede (sem resposta). captcha permanece mascarado.
      try { if (isChatUrl(xhr.__lcNet.u)) window.postMessage({ type: 'HZ_NET_CHAT_REQ', u: maskUrl(xhr.__lcNet.u), m: xhr.__lcNet.m }, window.location.origin); } catch (e) {}
      xhr.addEventListener('error', function () {
        try { if (isChatUrl(xhr.__lcNet.u)) window.postMessage({ type: 'HZ_NET_CHAT_REQ_FALHA', u: maskUrl(xhr.__lcNet.u), e: 'xhr_network_error' }, window.location.origin); } catch (e) {}
      });
      xhr.addEventListener('load', function () {
        var ct = '';
        var txt = '';
        var ra = '';
        try { ct = xhr.getResponseHeader('content-type') || ''; } catch (e) {}
        try { ra = xhr.getResponseHeader('retry-after') || ''; } catch (e) {}
        try { txt = xhr.responseText || ''; } catch (e) {}
        send(xhr.__lcNet.m, xhr.__lcNet.u, xhr.status, ct, body, txt, ra);
      });
    }
    return origSend.apply(this, arguments);
  };

  // --- WebSocket (apenas escuta frames recebidos; não toca na conexão) ---
  try {
    var OrigWS = window.WebSocket;
    if (OrigWS) {
      var HookedWS = function (url, protocols) {
        var ws = (protocols === undefined) ? new OrigWS(url) : new OrigWS(url, protocols);
        try { ws.addEventListener('message', function (ev) { send('WS', url, 0, 'websocket', null, String(ev.data), ''); }); } catch (e) {}
        return ws;
      };
      HookedWS.prototype = OrigWS.prototype;
      HookedWS.OPEN = OrigWS.OPEN; HookedWS.CONNECTING = OrigWS.CONNECTING;
      HookedWS.CLOSING = OrigWS.CLOSING; HookedWS.CLOSED = OrigWS.CLOSED;
      window.WebSocket = HookedWS;
    }
  } catch (e) {}
})();
