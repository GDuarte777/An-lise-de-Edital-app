// ═══════════════════════════════════════════════════════════════════════
// HORASIS — Robô de Lances · motor da disputa (Licitanet)
//
// Mesma função do motor do Comprasnet, para a sala de disputa do Licitanet:
// o portal é outro, a leitura dos itens é outra, mas a regra de lance e o
// piso de margem são os mesmos.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window.__HZ_LI_MOTOR__) return;
  window.__HZ_LI_MOTOR__ = true;

  // Mesma paleta do motor do Comprasnet: os dois painéis são o mesmo produto
  // e precisam ser reconhecidos como tal mesmo em portais diferentes.
  var LOGO = chrome.runtime.getURL('icone-48.png');
  var NAVY = '#182548';
  var NAVY_DEEP = '#0C1428';
  var GOLD = '#C09A52';
  var GOLD_SOFT = '#E0C489';
  var PRIMARY = NAVY;
  var GREEN = '#0E9F6E';
  var RED = '#C2453F';
  var BORDER = '#E6E9F0';
  var TEXT = '#1B2436';
  var MUTED = '#6B7689';

  var settings = { token: '', appId: '', botId: '' };
  var botConfig = null;
  var botItems = [];
  var canBidOnItem = function Ig(e,t){if(!e)return!1;if(e.dispute_type!=="por_item")return!0;if(e.item_selection_enabled===!0){const r=Number(t&&t.valor_minimo);return!!t&&t.participar===!0&&Number.isFinite(r)&&r>0}return!t||t.participar!==!1};
  function authorizeItemBid(num, value) {
    if (!botConfig || botConfig.dispute_type !== 'por_item') return Promise.resolve(true);
    return new Promise(function (resolve) {
      callBackend({ bot_id: settings.botId, item_id: Number(num), bid_value: value, authorize_item_bid: true }, function (resp) {
        resolve(!!(resp && resp.ok && resp.data && resp.data.allowed === true));
      });
    });
  }
  var pregao = null;
  var running = false;
  var statusLabel = 'Aguardando';
  var bridgeReady = false;
  var items = {};        // codLote -> {id, caption, num, melhor, meu, tempo, desclassificado, fechado}
  var inFlight = {};     // codLote -> POST em andamento
  var lastSent = {};     // codLote -> {value, at}
  var cooldown = {};     // codLote -> timestamp de liberação pós-erro
  var lastSuggest = {};   // codLote -> timestamp da última consulta de sugestão
  var log = [];
  var dirty = true;
  var calibSent = false;
  var reqSeq = 0;
  var pendReqs = {};

  // ===== Detecção do pregão =====
  function detectPregao() {
    var m = window.location.pathname.match(/sala-disputa\/(\d+)/);
    if (m) return m[1];
    var el = document.getElementById('codPregao');
    return el ? (el.value || null) : null;
  }

  // ===== Helpers =====
  function pushLog(level, msg) {
    log.push({ t: new Date().toISOString(), l: level, m: msg });
    if (log.length > 120) log = log.slice(-120);
    dirty = true;
  }
  function parseMoney(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    var s = String(v).replace(/R\$/g, '').trim();
    if (!s || !/[0-9]/.test(s)) return null;
    if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  function fmtBR(n) { return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function fmtClock(ms) {
    var d = new Date(ms);
    function p(x) { return String(x).padStart(2, '0'); }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function callBackend(payload, cb) {
    try {
      chrome.runtime.sendMessage({ action: 'horasis_bid_assistant', payload: payload }, function (resp) {
        if (chrome.runtime.lastError) { cb({ ok: false, error: chrome.runtime.lastError.message }); return; }
        cb(resp || { ok: false, error: 'Sem resposta' });
      });
    } catch (e) { cb({ ok: false, error: String(e) }); }
  }

  // ===== Ponte com o MAIN world (requestUtils autenticado do portal) =====
  function bridgeCall(kind, url, perm, modulo, data) {
    return new Promise(function (resolve) {
      var reqId = 'li' + (++reqSeq);
      pendReqs[reqId] = {
        resolve: resolve,
        to: setTimeout(function () {
          delete pendReqs[reqId];
          resolve({ ok: false, status: 0, error: 'timeout' });
        }, 20000)
      };
      window.postMessage({ type: 'HZ_LI_REQ', reqId: reqId, kind: kind, url: url, perm: perm, modulo: modulo, data: data || null }, window.location.origin);
    });
  }
  window.addEventListener('message', function (ev) {
    if (ev.source !== window || !ev.data) return;
    if (ev.data.type === 'HZ_LI_ESTADO') {
      var wasReady = bridgeReady;
      bridgeReady = !!ev.data.ready;
      if (wasReady !== bridgeReady) dirty = true;
      if (!bridgeReady && running) statusLabel = 'Sem acesso — faça login no Licitanet';
      return;
    }
    if (ev.data.type === 'HZ_LI_RES' && ev.data.reqId && pendReqs[ev.data.reqId]) {
      clearTimeout(pendReqs[ev.data.reqId].to);
      var r = ev.data;
      pendReqs[ev.data.reqId].resolve(r);
      delete pendReqs[ev.data.reqId];
    }
  });
  function pingBridge() { try { window.postMessage({ type: 'HZ_LI_ESTADO_REQ' }, window.location.origin); } catch (e) {} }

  // ===== Sensor: tabela de itens/lotes renderizada pelo próprio portal =====
  // O portal atualiza a tabela em tempo real via Ably — os seletores são os
  // oficiais dos templates itemLoteTpl/itemLoteRowTpl.
  function scanDom() {
    var rows = document.querySelectorAll('tr[data-item]');
    var changed = false;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var id = row.getAttribute('data-item');
      if (!id) continue;
      var cur = items[id] || { id: id };
      if (cur.caption === undefined) {
        var capEl = row.querySelector('.custom-control-description');
        cur.caption = capEl ? (capEl.textContent || '').trim() : ('Item ' + id);
        var m = cur.caption.match(/(\d+)\s*$/);
        cur.num = m ? parseInt(m[1], 10) : null;
        changed = true;
      }
      var melhor = null;
      var tds = row.querySelectorAll('td');
      for (var t = 0; t < tds.length; t++) {
        if (tds[t].textContent.indexOf('Melhor:') > -1) {
          var b = tds[t].querySelector('.font-weight-bold');
          if (b) melhor = parseMoney(b.textContent);
        }
      }
      var meuEl = document.getElementById('meu-melhor-lance-' + id);
      var meu = meuEl ? parseMoney(meuEl.textContent) : null;
      var tempo = row.getAttribute('data-tempo');
      var desc = String(row.getAttribute('data-desclassificado') || '').toLowerCase() === 'true';
      var fechado = !row.querySelector('.badge-time, input.lance');
      ['melhor', 'meu', 'tempo', 'desclassificado', 'fechado'].forEach(function (f) {
        var v = f === 'melhor' ? melhor : f === 'meu' ? meu : f === 'tempo' ? tempo : f === 'desclassificado' ? desc : fechado;
        if (cur[f] !== v) { cur[f] = v; changed = true; }
      });
      items[id] = cur;
    }
    if (changed) dirty = true;
    // Calibração: primeira amostra REAL da tabela vai ao log do robô no app
    if (!calibSent && settings.botId && Object.keys(items).length) {
      calibSent = true;
      var sample = '';
      try { sample = JSON.stringify(items[Object.keys(items)[0]]).substring(0, 500); } catch (e) {}
      callBackend({ bot_id: settings.botId, log_message: { level: 'info', message: '[LICITANET] Sala ' + pregao + ' — amostra de item lida da tabela: ' + sample } }, function () {});
    }
    if (changed) maybeAutoBid();
  }

  // ===== Estratégia (backend) + envio =====
  function findBotItem(num) {
    for (var i = 0; i < botItems.length; i++) {
      if (String(botItems[i].numero_item) === String(num)) return botItems[i];
    }
    return null;
  }
  function weAreWinning(it) {
    return it.meu != null && it.melhor != null && it.meu <= it.melhor;
  }
  function roomIds() {
    return Object.keys(items).filter(function (id) { return !items[id].fechado; });
  }

  function maybeAutoBid() {
    if (!running || !botConfig) return;
    var mode = botConfig.mode || 'Manual Assistido';
    if (mode === 'Manual Assistido') return;
    var ids = roomIds();
    var singleItem = ids.length === 1;
    ids.forEach(function (codLote) {
      var it = items[codLote];
      if (it.melhor == null || it.fechado || it.desclassificado) return;
      if (!bridgeReady) return;
      if (inFlight[codLote]) return;
      if (cooldown[codLote] && Date.now() < cooldown[codLote]) return;
      if (lastSent[codLote] && lastSent[codLote].value === it.melhor) return;
      if (Date.now() - (lastSuggest[codLote] || 0) < 3000) return;
      if (weAreWinning(it)) return;
      lastSuggest[codLote] = Date.now();
      var bItem = findBotItem(it.num);
      if (!canBidOnItem(botConfig, bItem)) return;
      var payload = { bot_id: settings.botId, portal_url: window.location.href, purchase_id: pregao };
      if (bItem) {
        payload.item_id = it.num;
        payload.current_lowest_bid = it.melhor;
      } else if (!singleItem) {
        return; // múltiplos itens sem mapeamento: só dá lance item a item (configurado no app)
      } else {
        payload.current_lowest_bid = it.melhor;
      }
      callBackend(payload, function (resp) {
        if (!resp || !resp.ok) return;
        var d = resp.data || {};
        if (d.is_winning) return;
        if (!d.should_bid || d.suggested_bid == null) { if (d.message) pushLog('info', d.message); return; }
        sendLance(codLote, Number(d.suggested_bid), true);
      });
    });
  }

  function sendLance(codLote, valor, auto) {
    if (inFlight[codLote]) return;
    if (!canBidOnItem(botConfig, findBotItem((items[codLote] || {}).num))) {
      pushLog('warn', 'Item não selecionado ou sem preço mínimo — lance bloqueado.'); return;
    }
    inFlight[codLote] = true;
    var it = items[codLote] || {};
    var botIdAtSend = settings.botId;
    var delay = auto
      ? ((botConfig.mode === 'Estratégico') ? 600 + Math.floor(Math.random() * 1500) : 120)
      : 0;
    pushLog('info', (auto ? '🤖' : '✋') + ' Enviando lance ' + fmtBR(valor) + ' em "' + (it.caption || codLote) + '" via API oficial (CADLANCE)...');
    setTimeout(function () {
      authorizeItemBid(it.num, valor).then(function (allowed) {
        if (!allowed || settings.botId !== botIdAtSend || (auto && !running) || !items[codLote] || items[codLote].fechado || !canBidOnItem(botConfig, findBotItem(items[codLote].num))) {
          inFlight[codLote] = false;
          pushLog('warn', 'Envio cancelado: item não autorizado na configuração atual.');
          return null;
        }
        return bridgeCall('post', 'lance', 'CADLANCE', 'lance', { codPregao: Number(pregao), valor: valor, codLote: Number(codLote) });
      }).then(function (r) {
        inFlight[codLote] = false;
        if (!r) return;
        if (r.ok) {
          lastSent[codLote] = { value: valor, at: Date.now() };
          var cur = items[codLote] || { id: codLote };
          cur.meu = valor;
          if (cur.melhor == null || valor < cur.melhor) cur.melhor = valor;
          items[codLote] = cur;
          dirty = true;
          pushLog('success', '✅ Lance ' + fmtBR(valor) + ' ACEITO em "' + (cur.caption || codLote) + '" (HTTP ' + r.status + ').');
          var bItem = findBotItem(cur.num);
          var ack = { bot_id: settings.botId, action: 'bid_sent', current_lowest_bid: valor, portal_url: window.location.href };
          if (bItem) ack.item_id = Number(cur.num);
          callBackend(ack, function () {});
        } else {
          cooldown[codLote] = Date.now() + 20000;
          if (r.status === 401 || r.status === 403) {
            statusLabel = 'Sem acesso — faça login no Licitanet';
            dirty = true;
            pushLog('error', '🚫 Lance bloqueado (HTTP ' + r.status + ') — faça login no Licitanet e reabra a sala.');
          } else {
            pushLog('error', '🚫 Lance RECUSADO em "' + (it.caption || codLote) + '" (HTTP ' + r.status + '): ' + String(r.body || r.error || '').substring(0, 160));
          }
        }
      });
    }, delay);
  }

  // ===== Painel =====
  var STYLE = '#hz-li-painel{position:fixed;bottom:16px;right:16px;z-index:999999;width:560px;max-width:calc(100vw - 32px);max-height:82vh;background:#fff;border-radius:14px;box-shadow:0 18px 48px rgba(12,20,40,0.30);border:1px solid #DCE1EC;font-family:Inter,Segoe UI,system-ui,sans-serif;display:flex;flex-direction:column;color:' + TEXT + ';overflow:hidden}'
    + '#hz-li-painel.hz-min{height:42px !important;}'
    + '#hz-li-painel.hz-min .hzl-body{display:none;}'
    + '.hzl-head{background:linear-gradient(180deg,' + NAVY + ' 0%,#121D38 100%);box-shadow:inset 0 -2px 0 ' + GOLD + ';color:#fff;padding:10px 14px;display:flex;align-items:center;gap:9px;flex-shrink:0}'
    + '.hzl-head img{width:22px;height:22px;background:#fff;border-radius:50%;padding:2px;box-sizing:border-box}'
    + '.hzl-title{font-size:12px;font-weight:700;letter-spacing:.03em;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.hzl-badge{font-size:9px;font-weight:700;letter-spacing:.04em;padding:3px 9px;border-radius:999px;background:rgba(224,196,137,0.16);color:' + GOLD_SOFT + '}'
    + '.hzl-ico{background:none;border:none;color:#C3CDE2;cursor:pointer;font-size:13px}'
    + '.hzl-ico:hover{color:' + GOLD_SOFT + '}'
    + '.hzl-body{display:flex;flex-direction:column;overflow:hidden;flex:1;min-height:0}'
    + '.hzl-meta{padding:7px 12px;font-size:10px;color:' + MUTED + ';border-bottom:1px solid ' + BORDER + ';display:flex;justify-content:space-between;gap:8px;flex-shrink:0}'
    + '.hzl-twrap{overflow:auto;max-height:200px;flex-shrink:0}'
    + '.hzl-table{width:100%;border-collapse:collapse;font-size:11px}'
    + '.hzl-table th{position:sticky;top:0;background:#F2F4F8;text-align:left;padding:6px 8px;font-size:8px;text-transform:uppercase;letter-spacing:.06em;color:' + MUTED + ';border-bottom:1px solid ' + BORDER + '}'
    + '.hzl-table td{padding:5px 8px;border-bottom:1px solid #F3F5F9;vertical-align:top}'
    + '.hzl-table tbody tr:hover{background:#FAFBFD}'
    + '.hzl-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}'
    + '.hzl-win{color:' + GREEN + ';font-weight:700}.hzl-lose{color:' + RED + ';font-weight:700}'
    + '.hzl-empty{text-align:center;padding:16px;font-size:11px;color:' + MUTED + '}'
    + '.hzl-manual{display:flex;gap:6px;padding:8px 12px;border-top:1px solid ' + BORDER + ';flex-shrink:0}'
    + '.hzl-manual input{height:28px;border:1px solid ' + BORDER + ';border-radius:6px;padding:0 8px;font-size:12px;width:80px}'
    + '.hzl-manual input:focus{outline:none;border-color:' + GOLD + ';box-shadow:0 0 0 2px rgba(192,154,82,0.20)}'
    + '.hzl-btn{height:28px;padding:0 14px;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}'
    + '.hzl-btn:hover{filter:brightness(1.07)}'
    + '.hzl-btn-send{background:' + NAVY + ';color:#fff}'
    + '.hzl-btn-start{background:' + GOLD + ';color:' + NAVY + '}'
    + '.hzl-logwrap{background:' + NAVY_DEEP + ';color:#D7DEEC;font-family:JetBrains Mono,Consolas,monospace;font-size:10px;padding:7px 9px;overflow-y:auto;flex:1;min-height:60px}'
    + '.hzl-log-e{padding:1px 0;line-height:1.5}'
    + '.hzl-log-e.err{color:#FF9A9A}.hzl-log-e.ok{color:#65E0AE}.hzl-log-e.warn{color:#EFC36A}'
    + '.hzl-foot{display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid ' + BORDER + ';flex-shrink:0}'
    + '.hzl-mode{font-size:11px;font-weight:700;color:' + NAVY + '}'
    + '.hzl-note{font-size:9px;color:' + MUTED + ';flex:1;text-align:right}';

  function buildPanel() {
    if (document.getElementById('hz-li-painel')) return;
    if (!document.body) { setTimeout(buildPanel, 500); return; }
    var style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    var p = document.createElement('div');
    p.id = 'hz-li-painel';
    p.innerHTML = ''
      + '<div class="hzl-head">'
      +   '<img src="' + LOGO + '" alt="HORASIS" />'
      +   '<span class="hzl-title">HORASIS · Robô de Lances — Licitanet</span>'
      +   '<span class="hzl-badge" id="hzl-status">—</span>'
      +   '<span class="hzl-clock" id="hzl-clock" style="font-size:12px;font-family:JetBrains Mono,Consolas,monospace;color:#C3CDE2">--:--:--</span>'
      +   '<button class="hzl-ico" id="hzl-min" title="Minimizar">—</button>'
      +   '<button class="hzl-ico" id="hzl-close" title="Fechar">✕</button>'
      + '</div>'
      + '<div class="hzl-body">'
      +   '<div class="hzl-meta"><span id="hzl-pregao"></span><span id="hzl-mode-line"></span></div>'
      +   '<div class="hzl-twrap"><table class="hzl-table"><thead><tr><th>Item / Lote</th><th>Melhor Lance</th><th>Meu Lance</th><th>Tempo</th></tr></thead><tbody id="hzl-tbody"></tbody></table><div class="hzl-empty" id="hzl-tempty">Nenhum item na sala ainda.</div></div>'
      +   '<div class="hzl-manual"><input id="hzl-m-item" placeholder="Nº do item" /><input id="hzl-m-valor" type="number" step="0.01" placeholder="Lance R$" /><button class="hzl-btn hzl-btn-send" id="hzl-m-send">Enviar</button></div>'
      +   '<div class="hzl-logwrap" id="hzl-log"></div>'
      +   '<div class="hzl-foot"><button class="hzl-btn hzl-btn-start" id="hzl-run">▶ Iniciar</button><span class="hzl-mode" id="hzl-mode"></span><span class="hzl-note">Sensor: tabela oficial da sala · POST lance (CADLANCE) na sua sessão</span></div>'
      + '</div>';
    document.body.appendChild(p);
    document.getElementById('hzl-min').addEventListener('click', function () {
      var isMin = p.classList.toggle('hz-min');
      this.textContent = isMin ? '▢' : '—';
    });
    document.getElementById('hzl-close').addEventListener('click', function () { p.style.display = 'none'; });
    document.getElementById('hzl-run').addEventListener('click', function () {
      running = !running;
      if (running) {
        statusLabel = 'Em Disputa';
        callBackend({ bot_id: settings.botId, action: 'start', portal_url: window.location.href }, function () {});
        pushLog('success', '🟢 Motor iniciado — lances automáticos ativos conforme a estratégia do robô.');
        maybeAutoBid();
      } else {
        statusLabel = 'Pausado';
        callBackend({ bot_id: settings.botId, action: 'pause', portal_url: window.location.href }, function () {});
        pushLog('warn', '⏸ Motor pausado pelo operador.');
      }
      dirty = true;
    });
    document.getElementById('hzl-m-send').addEventListener('click', function () {
      var numInput = document.getElementById('hzl-m-item').value.trim();
      var raw = parseFloat(document.getElementById('hzl-m-valor').value);
      var target = null;
      if (numInput) {
        var num = parseInt(numInput, 10);
        var byNum = Object.keys(items).filter(function (id) { return String(items[id].num) === String(num); });
        target = byNum.length ? byNum[0] : (items[numInput] ? numInput : null);
      } else {
        var ids = roomIds();
        if (ids.length === 1) target = ids[0];
      }
      if (!target) { pushLog('warn', 'Informe o nº do item (ex.: 1 para ITEM-01) e um valor válido.'); return; }
      if (isNaN(raw) || raw <= 0) { pushLog('warn', 'Informe um valor válido para o lance manual.'); return; }
      sendLance(target, parseFloat(raw.toFixed(2)), false);
    });
  }

  function renderTick() {
    var p = document.getElementById('hz-li-painel');
    if (!p || !dirty) return;
    dirty = false;
    var st = document.getElementById('hzl-status');
    if (st) st.textContent = statusLabel;
    var ck = document.getElementById('hzl-clock');
    if (ck) ck.textContent = fmtClock(Date.now());
    var pg = document.getElementById('hzl-pregao');
    if (pg) pg.textContent = 'Pregão: ' + (pregao || '—') + ' · ' + Object.keys(items).length + ' item(ns) na sala' + (bridgeReady ? '' : ' · ponte sem sessão');
    var ml = document.getElementById('hzl-mode-line');
    if (ml) ml.textContent = botConfig ? ('Modo: ' + (botConfig.mode || '—')) : '';
    var md = document.getElementById('hzl-mode');
    if (md) md.textContent = botConfig ? (botConfig.mode || '') : '';
    var tbody = document.getElementById('hzl-tbody');
    var tempty = document.getElementById('hzl-tempty');
    if (tbody) {
      var ids = Object.keys(items);
      if (tempty) tempty.style.display = ids.length ? 'none' : 'block';
      tbody.innerHTML = ids.map(function (id) {
        var it = items[id];
        var win = weAreWinning(it);
        var melhor = it.melhor != null ? fmtBR(it.melhor) : '—';
        var meu = it.meu != null ? fmtBR(it.meu) : '—';
        var tempo = it.fechado ? 'Encerrado' : (it.tempo != null && String(it.tempo) !== '' ? String(it.tempo) + 's' : '—');
        return '<tr>'
          + '<td>' + esc(it.caption || it.id) + (it.desclassificado ? ' ⚠' : '') + '</td>'
          + '<td class="hzl-num">' + esc(melhor) + '</td>'
          + '<td class="hzl-num ' + (win ? 'hzl-win' : (it.meu != null ? 'hzl-lose' : '')) + '">' + esc(meu) + '</td>'
          + '<td>' + esc(tempo) + (win ? ' 🏆' : '') + '</td>'
          + '</tr>';
      }).join('');
    }
    var lg = document.getElementById('hzl-log');
    if (lg) {
      lg.innerHTML = log.slice(-40).reverse().map(function (e) {
        return '<div class="hzl-log-e ' + (e.l === 'error' ? 'err' : e.l === 'success' ? 'ok' : e.l === 'warn' ? 'warn' : '') + '">[' + fmtClock(Date.parse(e.t)) + '] ' + esc(e.m) + '</div>';
      }).join('');
    }
  }

  function setStatus(msg) { statusLabel = msg; dirty = true; }

  // ===== Init =====
  pregao = detectPregao();
  if (!pregao) return;
  chrome.storage.local.get(['hz_app_id', 'hz_token'], function (data) {
    settings.token = data.hz_token || '';
    settings.appId = data.hz_app_id || '';
    buildPanel();
    dirty = true;
    if (!settings.token || !settings.appId) {
      setStatus('Configuração incompleta');
      pushLog('error', 'Abra o popup do HORASIS e cole o App ID e o Token da página Conectar Robô.');
      return;
    }
    pingBridge();
    setInterval(pingBridge, 5000);
    setInterval(scanDom, 4000);
    setInterval(renderTick, 700);
    scanDom();
    loadBot();
  });

  function loadBot() {
    callBackend({
      fetch_details: true,
      portal_url: window.location.href,
      purchase_id: pregao,
      // Sem cadastro prévio: é daqui que o backend sabe de que sala se trata
      // na primeira vez que esta compra aparece.
      portal: { numero: String(pregao), titulo: 'Licitanet — pregão ' + pregao },
      portal_name: 'Licitanet'
    }, function (resp) {
      if (!resp || !resp.ok) { setStatus('Erro ao preparar o robô'); pushLog('error', 'Erro ao preparar o robô desta sala: ' + (resp && resp.error)); return; }
      botConfig = (resp.data && resp.data.bot_config) || null;
      botItems = (resp.data && resp.data.items) || [];
      // Todas as chamadas seguintes já viajam com o id devolvido pelo backend.
      if (botConfig && botConfig.id) settings.botId = String(botConfig.id);
      dirty = true;
      pushLog('success', 'Robô carregado: modo ' + (botConfig && botConfig.mode) + ' · ' + botItems.length + ' item(ns) configurado(s) · sala ' + pregao + '.');
      setStatus('Pronto');
      if (!bridgeReady) pushLog('warn', 'Ponte sem sessão: faça login no Licitanet — os lances só são enviados com sua sessão ativa.');
    });
  }
})();
