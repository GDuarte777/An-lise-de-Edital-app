// ═══════════════════════════════════════════════════════════════════════
// HORASIS — Robô de Lances · ponte do Licitanet
//
// Roda no mundo da página para alcançar o estado interno da sala de disputa,
// que o mundo isolado do content script não enxerga, e repassa ao motor.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window.__HZ_LI_PONTE__) return;
  window.__HZ_LI_PONTE__ = true;

  function post(msg) { try { window.postMessage(msg, window.location.origin); } catch (e) {} }

  function sendState() {
    var ru = null;
    try { ru = window.requestUtils; } catch (e) { ru = null; }
    post({
      type: 'HZ_LI_ESTADO',
      ready: !!(ru && ru.url && ru.token),
      hasToken: !!(ru && ru.token)
    });
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window || !ev.data) return;

    if (ev.data.type === 'HZ_LI_ESTADO_REQ') { sendState(); return; }

    if (ev.data.type !== 'HZ_LI_REQ') return;
    var d = ev.data;
    var ru = null;
    try { ru = window.requestUtils; } catch (e) { ru = null; }
    if (!ru || !ru.url || !ru.token) {
      post({ type: 'HZ_LI_RES', reqId: d.reqId, ok: false, status: 0, error: 'sem_sessao' });
      return;
    }
    var url = String(ru.url).replace(/\/+$/, '') + '/' + String(d.url || '').replace(/^\/+/, '');
    var opts = {
      method: d.kind === 'post' ? 'POST' : 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'token': String(ru.token),
        'perm': String(d.perm || ''),
        'modulo': String(d.modulo || '')
      }
    };
    if (d.kind === 'post') opts.body = JSON.stringify(d.data || {});
    fetch(url, opts).then(function (r) {
      r.text().then(function (t) {
        post({ type: 'HZ_LI_RES', reqId: d.reqId, ok: r.ok, status: r.status, body: t.substring(0, 20000) });
      }).catch(function (err) {
        post({ type: 'HZ_LI_RES', reqId: d.reqId, ok: false, status: r.status, error: String(err) });
      });
    }).catch(function (err) {
      post({ type: 'HZ_LI_RES', reqId: d.reqId, ok: false, status: 0, error: String(err && err.message || err) });
    });
  });
})();
