// ═══════════════════════════════════════════════════════════════════════
// HORASIS — Robô de Lances · motor da disputa (Comprasnet)
//
// Monta o painel sobre a sala de disputa, lê os itens pela API do próprio
// portal na sessão já autenticada do fornecedor e envia os lances segundo a
// configuração do robô. Nada é enviado sem passar por três confirmações:
// a compra da aba bate com a do robô, o item está autorizado e o valor está
// acima do piso de margem.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window.__HZ_MOTOR_DISPUTA__) return;
  window.__HZ_MOTOR_DISPUTA__ = true;
  chrome.runtime.onMessage.addListener(function (req, sender, reply) {
    if (req.action !== 'horasis_dispute_status') return;
    var panel = document.getElementById('hz-painel-disputa');
    if (panel && req.open) panel.style.display = 'flex';
    reply({ ok: !!panel, compra: compra || null, state: panel ? 'visible' : 'initializing' });
  });

  // ─── Identidade HORASIS ────────────────────────────────────────────────
  // Navy e dourado são as duas cores do símbolo; o resto da paleta existe
  // para servir a leitura rápida no meio do pregão: verde só significa
  // "estamos ganhando", vermelho só significa "perdemos ou foi recusado", e
  // o dourado só aparece onde há ação do operador. Cor com significado fixo
  // é o que permite ler a tabela de itens sem ler o texto.
  var LOGO = chrome.runtime.getURL('icone-48.png');
  var NAVY = '#182548';
  var NAVY_DEEP = '#0C1428';
  var GOLD = '#C09A52';
  var GOLD_SOFT = '#E0C489';
  var PRIMARY = NAVY;
  var GREEN = '#0E9F6E';
  var RED = '#C2453F';

  var settings = { token: '', appId: '', botId: '' };
  var botConfig = null;
  var bindingConfirmed = false;
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
  var myCnpj = '';
  var origPortal = '';
  var compra = null;
  var portalInfo = {};  // identificação da compra direto do portal (independe do robô)
  var running = false;
  var statusLabel = 'Aguardando';
  var clockSkewMs = 0;
  var items = {};        // numero -> {melhor, meu, fase, tempo, situacao, descricao, ...}
  var inFlight = {};     // numero -> POST em andamento
  var lastSent = {};     // numero -> {value, at}
  var cooldown = {};     // numero -> timestamp de liberação pós-erro
  var lastSuggest = {};  // numero -> timestamp da última consulta de sugestão
  var avisouSemPiso = {}; // numero -> já avisamos que falta piso neste item
  var log = [];
  var alerts = [];       // aba Alertas: menções, itens fechados, recusas
  var chatLog = [];      // aba Chat
  var chatSeenIds = {};
  var chatBusy = false;
  var qtdes = {};        // contagens por fase do portal
  var bearer = { token: '', exp: 0 };
  var bearerReq = null;
  var activeTab = 'chat';
  var ourBids = 0;
  var totalBids = 0;
  var disputeSecs = 0;
  var elapsedBefore = 0;
  var activeSince = 0;
  var startedAt = 0;
  var sessionHealthy = false;
  var sessionLost = false;
  var resumeRequested = false;
  var stateKey = '';
  var restored = false;
  var saveTimer = null;
  var nativeChatOpened = false;
  var lastNativeChatAttempt = 0;
  var pollMs = 7000;
  var dirty = true;
  var calibSent = false;
  var testMode = false;
  var testBusy = false;
  var testNextAt = 0;
  var noAccessLogged = false;
  var idsRendered = false;
  var lastRowsKey = '';
  var isMax = false;
  var clockTimer = null;
  var renderTimer = null;

  // ===== Detecção da compra (chaveCompra) =====
  function detectCompra() {
    var out = null;
    try {
      var sp = new URLSearchParams(window.location.search);
      var pref = ['compra', 'chaveCompra', 'idCompra', 'chave'];
      for (var i = 0; i < pref.length && !out; i++) {
        var v = sp.get(pref[i]);
        if (v && /^\d{10,}$/.test(v)) out = v;
      }
      if (!out) sp.forEach(function (val) { if (!out && val && /^\d{10,}$/.test(val)) out = val; });
      if (!out) { var m = window.location.pathname.match(/compras\/(\d{10,})/); if (m) out = m[1]; }
    } catch (e) {}
    return out;
  }

  // ===== Helpers =====
  function saveState() {
    if (!stateKey || !restored) return;
    var snapshot = { log: log.slice(-120), alerts: alerts.slice(-60), chatLog: chatLog.slice(-200),
      ourBids: ourBids, totalBids: totalBids, elapsedBefore: elapsedBefore,
      activeSince: activeSince, startedAt: startedAt, resumeRequested: running || resumeRequested, savedAt: Date.now() };
    var data = {}; data[stateKey] = snapshot;
    chrome.storage.local.set(data);
  }
  function queueSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () { saveTimer = null; saveState(); }, 500);
  }
  function restoreState(done) {
    stateKey = 'hz_dispute_v1_' + compra;
    var runningKey = 'hz_running_compra_' + compra;
    chrome.storage.local.get([stateKey, runningKey], function (data) {
      var s = data && data[stateKey];
      resumeRequested = data && data[runningKey] === true;
      if (s) {
        log = Array.isArray(s.log) ? s.log.slice(-120) : [];
        alerts = Array.isArray(s.alerts) ? s.alerts.slice(-60) : [];
        chatLog = Array.isArray(s.chatLog) ? s.chatLog.slice(-200) : [];
        chatLog.forEach(function (m) { if (m.id) chatSeenIds[m.id] = true; });
        ourBids = Number(s.ourBids) || 0;
        totalBids = Number(s.totalBids) || 0;
        elapsedBefore = (Number(s.elapsedBefore) || 0) + (s.activeSince && s.savedAt ? Math.max(0, Math.floor((s.savedAt - s.activeSince) / 1000)) : 0);
        disputeSecs = elapsedBefore;
        startedAt = Number(s.startedAt) || 0;
        // O comando Iniciar/Pausar gravado por compra prevalece sobre snapshots antigos.
        if (data[runningKey] === undefined) resumeRequested = s.resumeRequested === true;
      }
      restored = true;
      dirty = true;
      done();
    });
  }
  function pushLog(level, msg) {
    log.push({ t: new Date().toISOString(), l: level, m: msg });
    if (log.length > 120) log = log.slice(-120);
    dirty = true;
    queueSave();
  }
  function pushAlert(msg) {
    alerts.push({ t: new Date().toISOString(), m: msg });
    if (alerts.length > 60) alerts = alerts.slice(-60);
    dirty = true;
    queueSave();
  }
  function stopForSession(reason) {
    if (sessionLost) return;
    sessionLost = true;
    sessionHealthy = false;
    resumeRequested = false;
    if (running) {
      elapsedBefore = elapsedBefore + Math.max(0, Math.floor((Date.now() - activeSince) / 1000));
      disputeSecs = elapsedBefore;
      activeSince = 0;
      running = false;
      chrome.storage.local.set({ ['hz_running_compra_' + compra]: false });
      if (haveCreds()) callBackend({ bot_id: settings.botId, action: 'pause', portal_url: window.location.href }, function () {});
    }
    chrome.storage.local.set({ ['hz_running_compra_' + compra]: false });
    bearer.token = '';
    bearer.exp = 0;
    statusLabel = 'Sessão do portal encerrada — faça login';
    pushLog('error', reason + ' Lances suspensos. Entre novamente no portal e confirme para retomar.');
    saveState();
  }
  function hashStr(s) {
    var h = 5381;
    for (var i = 0; i < String(s).length; i++) h = ((h << 5) + h + String(s).charCodeAt(i)) & 0x7fffffff;
    return h;
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
  function fmtTimer(s) {
    function p(x) { return String(x).padStart(2, '0'); }
    return p(Math.floor(s / 3600)) + ':' + p(Math.floor((s % 3600) / 60)) + ':' + p(s % 60);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function el(id) { return document.getElementById(id); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // ===== Token de sessão do portal (mesma autenticação do SPA oficial) =====
  function findStoredToken() {
    var stores = [];
    try { stores.push(localStorage); } catch (e) {}
    try { stores.push(sessionStorage); } catch (e) {}
    for (var s = 0; s < stores.length; s++) {
      var st = stores[s];
      try {
        for (var i = 0; i < st.length; i++) {
          var k = st.key(i);
          var v = null;
          try { v = st.getItem(k); } catch (e) { continue; }
          if (!v) continue;
          if (/^eyJ[A-Za-z0-9_-]+\./.test(v)) return v;
          try {
            var j = JSON.parse(v);
            var t = j && (j.accessToken || j.access_token || (j.token && j.token.accessToken) || j.jwt);
            if (t && /^eyJ/.test(String(t))) return String(t);
          } catch (e) {}
        }
      } catch (e) {}
    }
    return null;
  }
  function ensureBearer(force) {
    if (!force && bearer.token && Date.now() < bearer.exp - 60000) return Promise.resolve(bearer.token);
    if (bearerReq) return bearerReq;
    var stored = force ? null : findStoredToken();
    if (stored) { bearer.token = stored; bearer.exp = Date.now() + 8 * 60 * 1000; return Promise.resolve(stored); }
    if (force) { bearer.token = ''; bearer.exp = 0; }
    bearerReq = fetch(window.location.origin + '/comprasnet-usuario/v2/sessao/fornecedor/retoken', { method: 'PUT', credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, status: r.status, text: t }; }); })
      .then(function (r) {
        bearerReq = null;
        if (!r.ok) return null;
        try {
          var j = JSON.parse(r.text);
          if (j && j.accessToken) { bearer.token = String(j.accessToken); bearer.exp = Date.now() + 8 * 60 * 1000; return bearer.token; }
        } catch (e) {}
        return null;
      })
      .catch(function () { bearerReq = null; return null; });
    return bearerReq;
  }

  function apiCall(method, path, bodyObj, noRetry) {
    var headers = { 'Accept': 'application/json' };
    if (bearer.token) headers['Authorization'] = 'Bearer ' + bearer.token;
    var opts = { method: method, credentials: 'include', headers: headers };
    if (bodyObj) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(bodyObj); }
    return fetch(window.location.origin + path, opts).then(function (r) {
      return r.text().then(function (t) { return { ok: r.ok, status: r.status, text: t }; });
    }).then(function (r) {
      if (r.status === 401 && !noRetry && bearer.token) {
        return ensureBearer(true).then(function (tk) { if (tk) return apiCall(method, path, bodyObj, true); return r; });
      }
      return r;
    });
  }

  function callBackend(payload, cb) {
    try {
      chrome.runtime.sendMessage({ action: 'horasis_bid_assistant', payload: payload }, function (resp) {
        if (chrome.runtime.lastError) { cb({ ok: false, error: chrome.runtime.lastError.message }); return; }
        cb(resp || { ok: false, error: 'Sem resposta' });
      });
    } catch (e) { cb({ ok: false, error: String(e) }); }
  }

  // ===== Relógio oficial do portal =====
  function applyClockText(txt) {
    var m = String(txt || '').match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return;
    var iso = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6];
    var srv = Date.parse(iso);
    if (!isNaN(srv)) { clockSkewMs = srv - Date.now(); dirty = true; }
  }
  function syncClock() {
    apiCall('GET', '/comprasnet-disputa/v1/datahorabrasilia').then(function (r) { if (r.ok) applyClockText(r.text); }).catch(function () {});
  }

  // ===== Extração tolerante de itens do JSON do portal =====
  function findItemArray(node) {
    var KEYS = ['numero', 'numeroitem', 'melhorvalor', 'melhorvaloratual', 'fase', 'faseitem', 'valor'];
    function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
    function walk(n, depth) {
      if (n == null || depth > 6) return null;
      if (Array.isArray(n)) {
        for (var i = 0; i < n.length; i++) {
          if (!isObj(n[i])) continue;
          var keys = Object.keys(n[i]).map(function (k) { return String(k).toLowerCase(); });
          for (var j = 0; j < KEYS.length; j++) if (keys.indexOf(KEYS[j]) > -1) return n;
        }
        return null;
      }
      if (isObj(n)) {
        var ks = Object.keys(n);
        for (var k = 0; k < ks.length; k++) {
          var found = walk(n[ks[k]], depth + 1);
          if (found) return found;
        }
      }
      return null;
    }
    return walk(node, 0);
  }

  function pick(o, keys) {
    for (var i = 0; i < keys.length; i++) { var v = o[keys[i]]; if (v !== undefined && v !== null && v !== '') return v; }
    var low = {};
    Object.keys(o).forEach(function (k) { low[String(k).toLowerCase()] = o[k]; });
    for (var j = 0; j < keys.length; j++) { var v2 = low[String(keys[j]).toLowerCase()]; if (v2 !== undefined && v2 !== null && v2 !== '') return v2; }
    return null;
  }

  
  var schedule = { start: null, end: null, source: '' };
  function brasilDay(ms) {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms || Date.now()));
    function part(k) { return p.find(function (x) { return x.type === k; }).value; }
    return part('year') + '-' + part('month') + '-' + part('day');
  }
  function portalDate(value, day) {
    if (value == null || value === '') return null;
    var s = String(value).trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/i);
    if (!m) {
      var br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
      if (br) m = [s, br[3], br[2], br[1], br[4] || '0', br[5] || '0'];
    }
    if (!m && /^([01]?\d|2[0-3]):[0-5]\d$/.test(s)) return portalDate((day || brasilDay()) + 'T' + s);
    if (!m || !m[4] || Number(m[4]) > 23 || Number(m[5]) > 59) return null;
    var iso = m[1] + '-' + m[2] + '-' + m[3] + 'T' + String(m[4]).padStart(2, '0') + ':' + m[5];
    var ms = m[6] ? Date.parse(iso + (m[6].toUpperCase() === 'Z' ? 'Z' : m[6])) : Date.parse(iso + '-03:00');
    return isNaN(ms) ? null : ms;
  }
  function scheduleDay(ms) { return brasilDay(ms); }
  function setSchedule(start, end, source) {
    if (!start || !end || end <= start || end - start > 48 * 3600000) return;
    if (schedule.source === 'api' && source !== 'api') return;
    if (schedule.start !== start || schedule.end !== end || schedule.source !== source) {
      schedule = { start: start, end: end, source: source };
      dirty = true;
    }
  }
  function readScheduleFromPurchase(j) {
    var a = pick(j, ['dataHoraInicioDisputa', 'dataInicioDisputa', 'inicioDisputa', 'horarioInicioDisputa']);
    var b = pick(j, ['dataHoraFimDisputa', 'dataHoraTerminoDisputa', 'dataHoraEncerramentoDisputa', 'fimDisputa', 'horarioFimDisputa', 'horarioTerminoDisputa']);
    var bDate = portalDate(b);
    var aTimeOnly = typeof a === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(a.trim());
    var start = portalDate(a, aTimeOnly && bDate ? scheduleDay(bDate) : null);
    var end = portalDate(b, start ? scheduleDay(start) : null);
    setSchedule(start, end, 'api');
  }
  function scanScheduleFromPage() {
    if (schedule.source === 'api' || !/dispensa/i.test(String(portalInfo.modalidade || ''))) return;
    var text = Array.from(document.body.children).filter(function (node) { return node.id !== 'hz-painel-disputa'; }).map(function (node) { return node.innerText || ''; }).join('\n');
    var lines = text.split('\n');
    var from = null, until = null;
    for (var i = 0; i < lines.length && i < 1000; i++) {
      var line = lines[i].trim();
      if (line.length > 130) continue;
      var range = line.match(/disputa.{0,30}(?:das|de)\s*([01]?\d|2[0-3]):([0-5]\d)\s*(?:às|as|até|a)\s*([01]?\d|2[0-3]):([0-5]\d)/i);
      if (range) { from = range[1] + ':' + range[2]; until = range[3] + ':' + range[4]; break; }
      var pair = line + ' ' + (lines[i + 1] || '').trim();
      var time = pair.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
      if (!time) continue;
      if (/(?:início|inicio|abertura).{0,45}(?:disputa|lances)/i.test(line)) from = time[1] + ':' + time[2];
      if (/(?:término|termino|fim|encerramento).{0,45}(?:disputa|lances)/i.test(line)) until = time[1] + ':' + time[2];
    }
    setSchedule(portalDate(from), portalDate(until), 'portal');
  }
  function renderSchedule() {
    var box = el('hzd-schedule');
    if (!box) return;
    box.style.display = schedule.start && schedule.end || /dispensa/i.test(String(portalInfo.modalidade || '')) ? 'block' : 'none';
    var label = el('hzd-schedule-label');
    var detail = el('hzd-schedule-detail');
    var track = el('hzd-schedule-track');
    var fill = el('hzd-schedule-fill');
    if (!schedule.start || !schedule.end) {
      label.textContent = 'Término da disputa: horário não identificado no portal';
      detail.textContent = '';
      track.style.display = 'none';
      return;
    }
    var fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    var now = Date.now() + clockSkewMs;
    var percent = clamp(Math.round(100 * (now - schedule.start) / (schedule.end - schedule.start)), 0, 100);
    label.textContent = 'Disputa: ' + fmt.format(new Date(schedule.start)) + ' → término previsto ' + fmt.format(new Date(schedule.end));
    detail.textContent = now < schedule.start ? 'Aguardando início' : now >= schedule.end ? 'Horário previsto atingido — confirme no portal' : percent + '% · faltam ' + fmtTimer(Math.ceil((schedule.end - now) / 1000));
    track.style.display = 'block';
    fill.style.width = percent + '%';
    track.setAttribute('aria-valuenow', String(percent));
  }
  

  // Valores monetários podem vir ANINHADOS no novo Comprasnet (formato real
  // observado em /itens/em-disputa): melhorValorGeral e melhorValorFornecedor
  // são objetos {valorInformado, valorCalculado} — não números planos.
  function moneyOf(v) {
    if (v == null) return null;
    if (typeof v === 'object') {
      if (v.valorInformado != null) return parseMoney(v.valorInformado);
      if (v.valorCalculado != null) {
        return (typeof v.valorCalculado === 'object') ? parseMoney(v.valorCalculado.valorUnitario) : parseMoney(v.valorCalculado);
      }
      return null;
    }
    return parseMoney(v);
  }

  function normItem(o) {
    var n = { numero: null };
    var num = pick(o, ['numero', 'numeroItem', 'num', 'item', 'numeroDoItem', 'identificador']);
    if (num == null) return n;
    var digits = String(num).replace(/\D/g, '');
    n.numero = digits ? (parseInt(digits, 10) || String(num)) : String(num);
    n.melhor = moneyOf(pick(o, ['melhorValorGeral', 'melhorValorAtual', 'melhorValor', 'melhorLance', 'valorMelhor']));
    n.estimado = moneyOf(pick(o, ['valorEstimado', 'valorEstimadoUnitario']));
    n.melhorUnit = moneyOf(pick(o, ['melhorValorUnitario', 'melhorValorUnitarioAtual']));
    n.meu = moneyOf(pick(o, ['melhorValorFornecedor', 'meuValor', 'meuValorAtual', 'meuValorUnitario']));
    n.intervalo = moneyOf(pick(o, ['variacaoMinimaEntreLances', 'valorMinimoEntreLances', 'intervaloMinimoEntreLances']));
    n.podeEnviar = pick(o, ['podeEnviarLances']);
    n.fase = pick(o, ['faseItem', 'fase', 'situacaoFase', 'faseItemEnum']);
    n.detalhe = pick(o, ['detalheSituacaoDisputaItem', 'detalheSituacao', 'rodada']);
    n.tempo = pick(o, ['tempoRestante', 'tempoRestanteSegundos', 'tempoAvisoPrevioValores', 'tempoAvisoPrevioValor']);
    var fim = pick(o, ['dataHoraFimContagem', 'dataHoraFim']);
    if (n.tempo == null && fim) {
      var msRest = Date.parse(String(fim)) - (Date.now() + clockSkewMs);
      if (!isNaN(msRest)) n.tempo = Math.floor(msRest / 1000);
    }
    n.situacao = pick(o, ['situacaoParticipanteDisputa', 'situacao', 'situacaoItem', 'situacaoParticipacao']);
    n.descricao = pick(o, ['descricao', 'descricaoItem', 'descricaoResumida']);
    var forn = pick(o, ['melhorValorFornecedor', 'fornecedorMelhorValor', 'identificacaoFornecedorMelhorValor']);
    n.fornecedorMelhorStr = (forn && typeof forn === 'object') ? JSON.stringify(forn) : String(forn || '');
    return n;
  }

  function applyItems(arr, fonte) {
    if (!Array.isArray(arr) || arr.length === 0) return;
    var changed = false;
    arr.forEach(function (o) {
      if (!o || typeof o !== 'object') return;
      var n = normItem(o);
      if (n.numero == null) return;
      var cur = items[n.numero] || { numero: n.numero };
      var previousBest = cur.melhor;
      ['melhor', 'melhorUnit', 'meu', 'fase', 'detalhe', 'tempo', 'situacao', 'descricao', 'fornecedorMelhorStr', 'intervalo', 'podeEnviar', 'estimado'].forEach(function (f) {
        if (n[f] !== undefined && n[f] !== null && cur[f] !== n[f]) { cur[f] = n[f]; changed = true; }
      });
      // Contar somente alterações reais após a primeira leitura, antes de sobrescrever o estado.
      if (n.melhor != null && previousBest != null && previousBest !== n.melhor) { totalBids++; queueSave(); }
      items[n.numero] = cur;
    });
    if (changed) dirty = true;
    if (!calibSent && settings.botId) {
      calibSent = true;
      var sample = '';
      try { sample = JSON.stringify(arr[0]).substring(0, 500); } catch (e) {}
      callBackend({ bot_id: settings.botId, log_message: { level: 'info', message: '[DISPUTA-API] Amostra de item (' + fonte + '): ' + sample } }, function () {});
    }
    // Retenta a estratégia após falhas transitórias mesmo quando o valor não muda.
    maybeAutoBid();
  }

  // ===== Estado real da sessão pelas contagens do portal =====
  function resumeAfterReload(arr) {
    if (!resumeRequested || running || !botConfig || !bindingConfirmed || !sessionHealthy || sessionLost || testMode || !haveCreds()) return;
    if (!Array.isArray(arr) || !arr.length || Number(pick(qtdes, ['qtdeItensEmDisputa'])) <= 0) return;
    if (!arr.some(function (o) { var n = normItem(o).numero; return n != null && items[n] && !isItemClosed(items[n]); })) return;
    if (schedule.start && schedule.end && (Date.now() + clockSkewMs < schedule.start || Date.now() + clockSkewMs >= schedule.end)) return;
    resumeRequested = false;
    running = true;
    if (!startedAt) startedAt = Date.now();
    activeSince = Date.now();
    statusLabel = 'Em Disputa';
    chrome.storage.local.set({ ['hz_running_compra_' + compra]: true });
    pushLog('success', 'Motor retomado automaticamente após validar sessão, robô e itens em disputa.');
    saveState();
    openNativeChatOnce();
    maybeAutoBid();
  }
  function finishWhenClosed() {
    if (Number(pick(qtdes, ['qtdeItensEmDisputa'])) || 0) return;
    if (Number(pick(qtdes, ['qtdeItensAguardandoDisputa'])) || 0) return;
    if (Number(pick(qtdes, ['qtdeItensAguardandoAbertura', 'qtdeItensAguardandoAberturaSessaoPublica'])) || 0) return;
    if (!(Number(pick(qtdes, ['qtdeItensComDisputaEncerrada', 'qtdeItensDisputaEncerrada'])) || 0)) return;
    if (!running && !resumeRequested) return;
    if (running) {
      elapsedBefore += Math.max(0, Math.floor((Date.now() - activeSince) / 1000));
      disputeSecs = elapsedBefore;
      activeSince = 0;
      running = false;
      if (haveCreds()) callBackend({ bot_id: settings.botId, action: 'pause', portal_url: window.location.href }, function () {});
    }
    resumeRequested = false;
    chrome.storage.local.set({ ['hz_running_compra_' + compra]: false });
    setStatus('Disputa encerrada no portal');
    pushLog('info', 'Disputa encerrada no portal; retomada automática desativada.');
    saveState();
  }
  function updateStatusFromCounts() {
    var em = Number(pick(qtdes, ['qtdeItensEmDisputa'])) || 0;
    var ag = Number(pick(qtdes, ['qtdeItensAguardandoDisputa'])) || 0;
    var ab = Number(pick(qtdes, ['qtdeItensAguardandoAbertura', 'qtdeItensAguardandoAberturaSessaoPublica'])) || 0;
    var enc = Number(pick(qtdes, ['qtdeItensComDisputaEncerrada', 'qtdeItensDisputaEncerrada'])) || 0;
    if (em > 0) statusLabel = running ? 'Em Disputa' : 'Pronto — ' + em + ' item(ns) em disputa';
    else if (ag > 0) statusLabel = ag + ' item(ns) aguardando início da disputa';
    else if (ab > 0) statusLabel = 'Aguardando abertura da sessão (' + ab + ' itens)';
    else if (enc > 0) statusLabel = 'Disputa encerrada';
    else statusLabel = 'Aguardando sessão do portal';
    if (botConfig && !bindingConfirmed) statusLabel = 'Vínculo da compra não confirmado — lances bloqueados';
    dirty = true;
  }

  // ===== Estratégia (backend) + envio =====
  function findBotItem(num) {
    for (var i = 0; i < botItems.length; i++) {
      if (String(botItems[i].numero_item) === String(num)) return botItems[i];
    }
    return null;
  }
  function portalEstimate() {
    var s = 0;
    Object.keys(items).forEach(function (num) { var it = items[num]; if (it.estimado != null) s += Number(it.estimado); });
    return s;
  }
  function globalBest() {
    var best = { num: null, value: null };
    Object.keys(items).forEach(function (num) {
      var it = items[num];
      if (it.fechado || it.melhor == null) return;
      if (best.value == null || it.melhor < best.value) { best = { num: num, value: it.melhor }; }
    });
    return best;
  }
  function weAreWinning(it) {
    if (it.meu != null && it.melhor != null && it.meu <= it.melhor) return true;
    if (myCnpj && it.fornecedorMelhorStr && it.fornecedorMelhorStr.indexOf(myCnpj) !== -1) return true;
    return false;
  }
  function isItemClosed(it) {
    if (it.fechado) return true;
    var f = String(it.fase || '') + ' ' + String(it.situacao || '') + ' ' + String(it.detalhe || '');
    if (/encerrad|fechad|finalizad|revogad|anulad|desert/i.test(f)) return true;
    return false;
  }
  function statusItemOf(it) {
    if (isItemClosed(it)) return { t: 'Encerrado', c: 'e' };
    if (it.meu != null && it.melhor != null) return weAreWinning(it) ? { t: 'Vencedor', c: 'w' } : { t: 'Perdedor', c: 'l' };
    return { t: 'Aguardando', c: 'a' };
  }

  function maybeAutoBid() {
    if (!running || !botConfig || !bindingConfirmed || !sessionHealthy || sessionLost) return;
    if (testMode) return; // disputa encerrada: modo teste é somente leitura
    var mode = botConfig.mode || 'Manual Assistido';
    if (mode === 'Manual Assistido') return; // só sugere — nunca envia sozinho
    Object.keys(items).forEach(function (num) {
      var it = items[num];
      if (it.melhor == null || isItemClosed(it)) return;
      if (inFlight[num]) return;
      if (cooldown[num] && Date.now() < cooldown[num]) return;
      if (lastSent[num] && lastSent[num].value === it.melhor) return;
      if (Date.now() - (lastSuggest[num] || 0) < 3000) return;
      if (weAreWinning(it)) return;
      lastSuggest[num] = Date.now();
      var observedBest = it.melhor;
      var bItem = findBotItem(num);
      if (!bItem) {
        if (!avisouSemPiso[num]) {
          avisouSemPiso[num] = true;
          pushLog('warn', 'Item ' + num + ' sem piso de margem — digite o valor em "Mínimo R$" na tabela para liberar o lance automático. O item segue monitorado.');
        }
        return;
      }
      if (!canBidOnItem(botConfig, bItem)) return;
      var botIdAtRequest = settings.botId;
      var payload = { bot_id: botIdAtRequest, item_id: Number(num), current_lowest_bid: it.melhor, meu_lance: it.meu, portal_url: window.location.href, purchase_id: compra };
      callBackend(payload, function (resp) {
        if (settings.botId !== botIdAtRequest) return;
        if (!resp || !resp.ok) { pushLog('warn', 'Item ' + num + ': estratégia indisponível — ' + String((resp && resp.error) || 'sem resposta') + '. Nova tentativa no próximo ciclo.'); return; }
        var d = resp.data || {};
        if (d.is_winning) return;
        if (!d.should_bid || d.suggested_bid == null) {
          if (d.message) {
            pushLog('info', d.message);
            if (/valor mínimo|atingimos/i.test(d.message)) pushAlert('Item ' + num + ': teto mínimo atingido — novos lances automáticos foram bloqueados.');
          }
          return;
        }
        if (!running || !sessionHealthy || sessionLost || !items[num] || isItemClosed(items[num]) || weAreWinning(items[num]) || items[num].melhor !== observedBest) return;
        sendLance(num, Number(d.suggested_bid), items[num].fase, true);
      });
    });
  }

  function sendLance(num, valor, fase, auto) {
    if (inFlight[num]) return;
    if (!canBidOnItem(botConfig, findBotItem(num))) {
      pushLog('warn', 'Item ' + num + ': não selecionado ou sem preço mínimo — lance bloqueado.'); return;
    }
    if (!bindingConfirmed || !sessionHealthy || sessionLost || !items[num] || isItemClosed(items[num])) {
      pushLog('warn', 'Lance bloqueado: confirme o vínculo do robô, a sessão e o item ativo no portal.'); return;
    }
    if (testMode) { pushLog('warn', '🎓 Modo Teste: envio de lances bloqueado (disputa encerrada) — somente leitura.'); return; }
    var it = items[num] || {};
    if (!Number.isFinite(valor) || valor <= 0 || (auto && (!running || !findBotItem(num)))) {
      pushLog('warn', 'Item ' + num + ': envio bloqueado — valor inválido ou robô não configurado para este item.'); return;
    }
    // Intervalo mínimo entre lances exigido pelo portal (ex.: R$ 5,00 na
    // dispensa eletrônica): sem este ajuste o portal RECUSA o lance.
    var minInt = Number(it.intervalo) || 0;
    if (minInt > 0 && it.melhor != null) {
      var maxBid = Math.round((it.melhor - minInt) * 100) / 100;
      if (!auto && valor > maxBid) {
        pushLog('warn', 'Lance manual mantido sem alteração: ' + fmtBR(valor) + '. O portal exige ao menos ' + fmtBR(minInt) + ' abaixo do melhor lance; envie um valor de até ' + fmtBR(maxBid) + '.');
        return;
      }
      if (auto && valor > maxBid) {
        valor = maxBid;
        pushLog('info', 'Intervalo mínimo entre lances do portal: ' + fmtBR(minInt) + ' — lance automático ajustado para ' + fmtBR(valor) + '.');
      }
    }
    var floor = Number((findBotItem(num) || {}).valor_minimo) || Number(botConfig && botConfig.minimum_value) || 0;
    if (auto && valor < floor) { pushLog('warn', 'Item ' + num + ': lance abaixo do mínimo configurado (' + fmtBR(floor) + ') — bloqueado.'); return; }
    if (it.melhor != null && valor >= it.melhor) {
      pushLog('warn', 'Lance de ' + fmtBR(valor) + ' não é inferior ao melhor atual (' + fmtBR(it.melhor) + ') — não enviado.');
      return;
    }
    inFlight[num] = true;
    var botIdAtSend = settings.botId;
    var urgent = (it.tempo != null && Number(it.tempo) < 180);
    // Respeita o TEMPO DE RESPOSTA configurado no robô (igual ao painel de
    // teste). Estratégico mantém o padrão ofensivo de últimos segundos.
    var respMs = Math.max(120, (Number(botConfig && botConfig.response_time) || 3) * 1000);
    var delay = auto
      ? ((botConfig.mode === 'Estratégico' && !urgent) ? 600 + Math.floor(Math.random() * 1500) : respMs)
      : 0;
    var body = { valorInformado: valor };
    if (fase) body.faseItem = fase;
    pushLog('info', (auto ? '🤖' : '✋') + ' Enviando lance ' + fmtBR(valor) + ' no item ' + num + (fase ? ' (fase ' + String(fase) + ')' : '') + ' via API oficial...');
    setTimeout(function () {
      if (settings.botId !== botIdAtSend || !bindingConfirmed || !sessionHealthy || sessionLost || (auto && !running) || !items[num] || isItemClosed(items[num])) {
        inFlight[num] = false;
        pushLog('warn', 'Envio cancelado: sessão ou estado do item mudou antes do lance.');
        return;
      }
      authorizeItemBid(num, valor).then(function (allowed) {
        if (!allowed || settings.botId !== botIdAtSend || !bindingConfirmed || !sessionHealthy || sessionLost || (auto && !running) || !items[num] || isItemClosed(items[num]) || !canBidOnItem(botConfig, findBotItem(num))) {
          inFlight[num] = false;
          pushLog('warn', 'Item ' + num + ': envio cancelado — seleção/configuração atual não autoriza este lance.');
          return null;
        }
        return apiCall('POST', '/comprasnet-disputa/v1/compras/' + compra + '/itens/' + num + '/lances', body);
      }).then(function (r) {
        inFlight[num] = false;
        if (!r) return;
        if (r.ok) {
          lastSent[num] = { value: valor, at: Date.now() };
          ourBids++; totalBids++;
          queueSave();
          var cur = items[num] || { numero: num };
          cur.meu = valor;
          cur.melhor = (cur.melhor == null || valor < cur.melhor) ? valor : cur.melhor;
          items[num] = cur;
          dirty = true;
          pushLog('success', '✅ Lance ' + fmtBR(valor) + ' ACEITO no item ' + num + ' (HTTP ' + r.status + ') — estado atualizado pela resposta do portal.');
          callBackend({ bot_id: settings.botId, item_id: Number(num), current_lowest_bid: valor, action: 'bid_sent', portal_url: window.location.href }, function () {});
          try { var arr = findItemArray(JSON.parse(r.text)); if (arr) applyItems(arr, 'resposta-post'); } catch (e) {}
        } else {
          cooldown[num] = Date.now() + 20000;
          if (r.status === 401 || r.status === 403) stopForSession('O portal recusou a autenticação do lance (HTTP ' + r.status + ').');
          pushLog('error', '🚫 Lance RECUSADO no item ' + num + ' (HTTP ' + r.status + '): ' + String(r.text || '').substring(0, 160));
          pushAlert('Lance recusado no item ' + num + ' (HTTP ' + r.status + ')');
        }
      }).catch(function (err) {
        inFlight[num] = false;
        cooldown[num] = Date.now() + 20000;
        pushLog('error', 'Falha de rede ao enviar lance (item ' + num + '): ' + String(err));
      });
    }, delay);
  }

  // ===== Sensores: netprobe (WS STOMP + HTTP) e polling fallback =====
  var chatUrlKnown = null;
  function installSensors() {
    // Pede ao netprobe o buffer do carregamento inicial (inclusive o token da
    // sessão capturado antes deste script rodar).
    window.addEventListener('message', function (ev) {
      if (ev.source !== window || !ev.data) return;
      // JWT real da sessão, repassado pelo netprobe (mesma página, mesma sessão)
      if (ev.data.type === 'HZ_NET_BEARER' && ev.data.t && /^eyJ/.test(String(ev.data.t))) {
        bearer.token = String(ev.data.t);
        bearer.exp = Date.now() + 8 * 60 * 1000;
        if (noAccessLogged) { noAccessLogged = false; pushLog('success', '🔑 Sessão do portal capturada em tempo real — autenticado. Retomando a leitura dos lances.'); }
        dirty = true;
        return;
      }
      // URL real do chat (com o captcha dinâmico) observada no tráfego do portal
      if (ev.data.type === 'HZ_NET_CHAT_URL' && ev.data.u) { chatUrlKnown = String(ev.data.u); return; }
      if (ev.data.type !== 'HZ_NET_SONDA' || !ev.data.d) return;
      var d = ev.data.d;
      if (d.m === 'WS') {
        var frame = String(d.b || '');
        var dm = frame.match(/destination:\s*(\/topic\/[^\s\n\r]+)/);
        var body = frame.substring(frame.indexOf('\n\n') + 2);
        if (dm && /datahorabrasilia/i.test(dm[1])) { applyClockText(body); return; }
        if (dm && /(disputa|compra)/i.test(dm[1])) {
          try {
            var arr = findItemArray(JSON.parse(body));
            if (arr) { statusLabel = running ? 'Em Disputa' : statusLabel; applyItems(arr, 'ws ' + dm[1]); }
          } catch (e) {}
        }
        return;
      }
      var u = String(d.u || '');
      // A abertura do painel "Mensagens" do próprio Comprasnet devolve o
      // histórico em JSON. Capturamos essa resposta observada e a exibimos
      // imediatamente no painel, sem depender do próximo ciclo de polling.
      if (d.s >= 200 && d.s < 300 && u.indexOf('comprasnet-mensagem/v2/chat/') !== -1) {
        nativeChatOpened = true;
        try {
          var chatJson = JSON.parse(String(d.b || ''));
          var chatRows = Array.isArray(chatJson) ? chatJson : (chatJson && (chatJson.content || chatJson.mensagens));
          if (Array.isArray(chatRows)) ingestChat(chatRows, true);
        } catch (e) {}
        return;
      }
      if (d.s >= 200 && d.s < 300 && u.indexOf('/comprasnet-disputa/v1/compras/' + compra) > -1) {
        try { var arr2 = findItemArray(JSON.parse(String(d.b || ''))); if (arr2) applyItems(arr2, 'http'); } catch (e) {}
      }
    });
    // Replay só depois do listener estar pronto: os primeiros dados chegam antes do painel.
    try { window.postMessage({ type: 'HZ_NET_SONDA_OLA' }, window.location.origin); } catch (e) {}
  }

  // Lista itens das fases anteriores (aguardando disputa / abertura) —
  // dá descrições e situação real enquanto a sessão não abre.
  function fetchAguardando() {
    apiCall('GET', '/comprasnet-fase-externa/v1/compras/' + compra + '/itens/aguardando-disputa').then(function (r) {
      if (r.ok) {
        try { var a = JSON.parse(r.text); if (Array.isArray(a) && a.length) { applyItems(a, 'aguardando-disputa'); return; } } catch (e) {}
      }
      return apiCall('GET', '/comprasnet-fase-externa/v1/compras/' + compra + '/itens/aguardando-abertura-sessao-publica').then(function (r2) {
        if (r2.ok) {
          try { var a2 = JSON.parse(r2.text); if (Array.isArray(a2)) applyItems(a2, 'aguardando-abertura'); } catch (e) {}
        }
      });
    }).catch(function () {});
  }

  function poll() {
    if (!compra) return;
    ensureBearer().then(function (tk) {
      apiCall('GET', '/comprasnet-disputa/v1/compras/' + compra + '/itens/qtdes').then(function (r) {
        if (r.ok) {
          try { qtdes = JSON.parse(r.text) || {}; } catch (e) { qtdes = {}; }
          if (!sessionLost) updateStatusFromCounts();
          finishWhenClosed();
        } else if (r.status === 401 || r.status === 403) {
          pollMs = 15000;
          if (sessionHealthy || running || (tk && (resumeRequested || r.status === 401))) stopForSession('Leitura da disputa não autorizada (HTTP ' + r.status + ').');
          else { sessionHealthy = false; setStatus('Aguardando liberação da disputa'); }
        }
        return apiCall('GET', '/comprasnet-disputa/v1/compras/' + compra + '/itens/em-disputa').then(function (r2) {
          if (r2.status === 429) { pollMs = 20000; sessionHealthy = false; return; }
          if (r2.status === 404) { sessionHealthy = false; if (!testMode) tryClosedDispute(); return; }
          if (!r2.ok) {
            pollMs = 15000;
            if ((r2.status === 401 || r2.status === 403) && (sessionHealthy || running || (tk && (resumeRequested || r2.status === 401)))) stopForSession('Itens da disputa não autorizados (HTTP ' + r2.status + ').');
            else sessionHealthy = false;
            return;
          }
          pollMs = 7000;
          if (r.ok) {
            var firstHealthyRead = !sessionHealthy;
            sessionHealthy = true;
            if (sessionLost) { sessionLost = false; pushLog('success', 'Sessão restabelecida. Confira os lances atuais e clique em Iniciar para retomar.'); }
            if (firstHealthyRead) syncChatLive();
          }
          var arr = null;
          try { arr = findItemArray(JSON.parse(r2.text)); } catch (e) {}
          if (arr && arr.length) {
            if (running && sessionHealthy) statusLabel = 'Em Disputa'; else if (sessionHealthy) updateStatusFromCounts();
            applyItems(arr, 'poll');
            resumeAfterReload(arr);
          } else {
            if (!testMode) fetchAguardando();
          }
        });
      }).catch(function () { pollMs = 15000; });
    });
  }
  function pollLoop() { poll(); setTimeout(pollLoop, pollMs); }

  // ===== Chat ao vivo (só com o robô Em Disputa) =====
  function normChatMsg(m) {
    var txt = String(pick(m, ['texto', 'mensagem', 'mensagemTexto', 'conteudo']) || '');
    var dh = String(pick(m, ['dataHora', 'dataEnvio', 'data', 'datahora', 'enviadaEm']) || '');
    var id = String(pick(m, ['chaveMensagemNaOrigem', 'id', 'codigo', 'sequencial', 'idMensagem']) || '');
    if (!id) id = 'c' + hashStr(txt + dh);
    return { id: id, quem: String(pick(m, ['remetente', 'autor', 'quem', 'nomeRemetente', 'de', 'enviadoPor']) || 'Portal'), data_hora: dh, mensagem: txt };
  }
  function ingestChat(arr, sendToBackend) {
    var fresh = [];
    arr.forEach(function (m) {
      if (!m || typeof m !== 'object') return;
      try {
        var cc = m.chaveCompra;
        if (cc && !portalInfo.uasg) {
          portalInfo.uasg = cc.idUasgIdentificacao != null ? String(cc.idUasgIdentificacao) : null;
          if (cc.numero != null) portalInfo.numero = String(cc.numero);
          if (cc.ano != null) portalInfo.ano = String(cc.ano);
          dirty = true;
        }
      } catch (e) {}
      var msg = normChatMsg(m);
      if (!msg.mensagem || chatSeenIds[msg.id]) return;
      chatSeenIds[msg.id] = true;
      chatLog.push(msg);
      fresh.push(msg);
    });
    if (chatLog.length > 200) chatLog = chatLog.slice(-200);
    if (fresh.length) {
      dirty = true;
      queueSave();
      // O chat cadastrado em Monitoramento usa sua própria fila e alertas;
      // o motor continua exibindo as mensagens, sem duplicar a ingestão.
      if (sendToBackend && settings.botId && !window.__HZ_MONITOR_CHAT_ATIVO__) {
        callBackend({ bot_id: settings.botId, chat_messages: fresh }, function (resp) {
          if (resp && resp.ok && resp.data && resp.data.mentions && resp.data.mentions.length) {
            resp.data.mentions.forEach(function (mn) {
              pushAlert('🚨 MENÇÃO no chat: ' + String(mn.mensagem || mn.termo_encontrado || '').substring(0, 100));
            });
          }
        });
      }
    }
  }
  function openNativeChatOnce() {
    if (nativeChatOpened || !sessionHealthy || Date.now() - lastNativeChatAttempt < 30000) return;
    // Aciona o controle oficial da página para que o próprio portal faça a
    // requisição autenticada (inclusive os parâmetros temporários que exigir).
    var selectors = ['button[aria-label*="mensag" i]', 'button[title*="mensag" i]',
      '[mattooltip*="mensag" i]', 'button[id*="mensag" i]', 'button[class*="mensag" i]',
      'button[aria-label*="chat" i]', 'button[title*="chat" i]'];
    var trigger = null;
    for (var i = 0; i < selectors.length && !trigger; i++) {
      try {
        var matches = document.querySelectorAll(selectors[i]);
        for (var j = 0; j < matches.length; j++) {
          if (matches[j].getClientRects().length && !matches[j].closest('#hz-painel-disputa')) { trigger = matches[j].closest('button') || matches[j]; break; }
        }
      } catch (e) {}
    }
    if (!trigger) {
      var icons = document.querySelectorAll('button i, button mat-icon, button svg, button span');
      for (var k = 0; k < icons.length; k++) {
        var icon = icons[k];
        var use = icon.querySelector('use');
        var iconText = (icon.textContent || '').trim().toLowerCase();
        var name = (icon.getAttribute('class') || '') + ' ' + (icon.getAttribute('aria-label') || '') + ' ' + (icon.getAttribute('title') || '') + ' ' + (icon.getAttribute('data-icon') || '') + ' ' + (use && (use.getAttribute('href') || use.getAttribute('xlink:href')) || '');
        if ((name.indexOf('fa-envelope') !== -1 || name.indexOf('pi-envelope') !== -1 || name.indexOf('mail_outline') !== -1 || name.indexOf('markunread') !== -1 || name.indexOf('icon-envelope') !== -1 || iconText === 'mail' || iconText === 'email') && icon.getClientRects().length) {
          trigger = icon.closest('button, [role="button"], p-button');
          if (trigger && trigger.tagName === 'P-BUTTON') trigger = trigger.querySelector('button') || trigger;
          if (trigger && !trigger.closest('#hz-painel-disputa')) break;
          trigger = null;
        }
      }
    }
    if (trigger && !trigger.disabled) {
      lastNativeChatAttempt = Date.now();
      trigger.click();
      pushLog('info', 'Controle de mensagens acionado; aguardando confirmação da resposta do portal.');
    } else pushLog('warn', 'Não foi possível abrir as mensagens automaticamente; o portal pode exigir interação manual.');
  }
  function syncChatLive() {
    // Leitura do chat não exige robô iniciado — as mensagens aparecem assim que
    // o painel abre (a própria sessão do portal autentica a leitura).
    if (testMode || chatBusy || !compra || !sessionHealthy || nativeChatOpened) return;
    chatBusy = true;
    var headers = { 'Accept': 'application/json' };
    if (bearer.token) headers['Authorization'] = 'Bearer ' + bearer.token;
    // O portal usa page=0&size=10. Não reutilizar captcha antigo nem alterar paginação.
    var chatUrl = window.location.origin + '/comprasnet-mensagem/v2/chat/' + compra + '?page=0&size=10';
    fetch(chatUrl, { credentials: 'include', headers: headers })
      .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, status: r.status, text: t }; }); })
      .then(function (r) {
        chatBusy = false;
        if (!r.ok) {
          if (r.status >= 400 && r.status < 500 && r.status !== 429) openNativeChatOnce();
          if (r.status !== 429 && !nativeChatOpened) pushLog('warn', 'Chat indisponível (HTTP ' + r.status + '); aguardando resposta do portal.');
          return;
        }
        var arr = null;
        try {
          var j = JSON.parse(r.text);
          if (Array.isArray(j)) arr = j;
          else if (j && Array.isArray(j.content)) arr = j.content;
          else if (j && Array.isArray(j.mensagens)) arr = j.mensagens;
        } catch (e) {}
        if (arr) {
          if (!arr.length) openNativeChatOnce();
          ingestChat(arr, true);
        }
      })
      .catch(function () { chatBusy = false; });
  }

  // ===== Modo Teste (disputa encerrada) — somente leitura =====
  function collectFiltroCands(node, out, depth) {
    if (!node || typeof node !== 'object' || depth > 5) return;
    Object.keys(node).forEach(function (k) {
      if (/filtro/i.test(k)) {
        var v = node[k];
        if (Array.isArray(v)) {
          v.forEach(function (e) {
            if (typeof e === 'string') out.push(e);
            else if (e && typeof e === 'object') {
              if (typeof e.value === 'string') out.push(e.value);
              if (typeof e.name === 'string') out.push(e.name);
            }
          });
        } else if (typeof v === 'string') { out.push(v); }
      }
      if (node[k] && typeof node[k] === 'object') collectFiltroCands(node[k], out, depth + 1);
    });
  }

  function discoverFiltro(cb) {
    apiCall('GET', '/comprasnet-fase-externa/v1/enums').then(function (r) {
      var cands = [];
      if (r.ok) { try { collectFiltroCands(JSON.parse(r.text), cands, 0); } catch (e) {} }
      var seen = {};
      cands = cands.filter(function (c) { var k = String(c); if (seen[k]) return false; seen[k] = true; return true; });
      ['TODOS', 'TODAS', 'GERAL', 'A', 'D', 'E'].forEach(function (f) { if (cands.indexOf(f) === -1) cands.push(f); });
      function tryCand(i) {
        if (i >= cands.length || i > 12) { cb(null); return; }
        apiCall('GET', '/comprasnet-disputa/v1/compras/' + compra + '/itens/disputa-encerrada?filtro=' + encodeURIComponent(cands[i])).then(function (r2) {
          if (r2.status === 400) { tryCand(i + 1); return; }
          cb(cands[i]);
        }).catch(function () { tryCand(i + 1); });
      }
      tryCand(0);
    }).catch(function () { cb(null); });
  }

  function tryClosedDispute() {
    if (testMode || testBusy || Date.now() < testNextAt) return;
    testBusy = true;
    discoverFiltro(function (filtro) {
      if (!filtro) { testBusy = false; testNextAt = Date.now() + 60000; return; }
      apiCall('GET', '/comprasnet-disputa/v1/compras/' + compra + '/itens/disputa-encerrada?filtro=' + encodeURIComponent(filtro)).then(function (r) {
        testBusy = false;
        if (!r.ok) { testNextAt = Date.now() + 60000; return; }
        var arr = null;
        try { arr = findItemArray(JSON.parse(r.text)); } catch (e) {}
        if (!arr || !arr.length) { testNextAt = Date.now() + 60000; return; }
        testMode = true;
        statusLabel = 'Modo Teste — disputa encerrada';
        dirty = true;
        pushLog('success', '🎓 MODO TESTE: disputa encerrada detectada — ' + arr.length + ' item(ns) recuperados. Extraindo lances e histórico do chat (somente leitura, envio de lances bloqueado)...');
        callBackend({ bot_id: settings.botId, log_message: { level: 'info', message: '[DISPUTA-API] MODO TESTE na compra ' + compra + ': ' + arr.length + ' itens encerrados (filtro=' + filtro + ').' } }, function () {});
        arr.forEach(function (o) { var n = normItem(o); if (n.numero != null) { var it = items[n.numero] || { numero: n.numero }; it.fechado = true; items[n.numero] = it; } });
        applyItems(arr, 'encerrada');
        fetchLancesHistorico(arr);
        fetchChatHistorico();
      }).catch(function () { testBusy = false; testNextAt = Date.now() + 60000; });
    });
  }

  function fetchLancesHistorico(arr) {
    var nums = [];
    arr.forEach(function (o) { var n = normItem(o).numero; if (n != null && nums.indexOf(n) === -1) nums.push(n); });
    nums = nums.slice(0, 15);
    pushLog('info', '🎓 Extraindo histórico de lances de ' + nums.length + ' item(ns)...');
    var i = 0;
    function next() {
      if (i >= nums.length) return;
      var num = nums[i]; i++;
      apiCall('GET', '/comprasnet-disputa/v1/compras/' + compra + '/itens/' + num + '/lances').then(function (r) {
        if (r.ok) {
          var lances = null;
          try { lances = findItemArray(JSON.parse(r.text)); } catch (e) {}
          if (Array.isArray(lances) && lances.length) {
            var vals = lances.map(function (l) { return parseMoney(pick(l, ['valorLance', 'valor', 'valorInformado', 'lance', 'valorUnitario', 'valorUnitarioLance'])); }).filter(function (v) { return v != null; });
            if (vals.length) {
              var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
              var it = items[num] || { numero: num };
              it.lancesCount = vals.length;
              items[num] = it;
              dirty = true;
              pushLog('info', 'Item ' + num + ': ' + vals.length + ' lances — melhor ' + fmtBR(min) + ' (evolução ' + fmtBR(max) + ' → ' + fmtBR(min) + ').');
            } else {
              pushLog('warn', 'Item ' + num + ': ' + lances.length + ' lances, formato de valor não reconhecido — amostra: ' + JSON.stringify(lances[0]).substring(0, 160));
            }
          } else {
            pushLog('warn', 'Item ' + num + ': sem lances acessíveis (HTTP ' + r.status + ') — amostra: ' + String(r.text || '').substring(0, 120));
          }
        } else {
          pushLog('warn', 'Item ' + num + ': lances indisponíveis (HTTP ' + r.status + ') ' + String(r.text || '').substring(0, 80));
        }
        setTimeout(next, 900);
      }).catch(function () { setTimeout(next, 900); });
    }
    next();
  }

  function fetchChatHistorico() {
    var msgs = [];
    var page = 0;
    pushLog('info', '🎓 Extraindo histórico do chat da disputa...');
    function walk() {
      if (page > 50) { summarize(); return; }
      var headers = { 'Accept': 'application/json' };
      if (bearer.token) headers['Authorization'] = 'Bearer ' + bearer.token;
      fetch(window.location.origin + '/comprasnet-mensagem/v2/chat/' + compra + '?size=10&page=' + page, { credentials: 'include', headers: headers })
        .then(function (r) { return r.text().then(function (t) { return { status: r.status, text: t }; }); })
        .then(function (r) {
          if (r.status === 429) { pushLog('warn', 'Chat: portal limitou as consultas (429) — continuando com o que foi extraído.'); summarize(); return; }
          var arr = null;
          try { var j = JSON.parse(r.text); if (Array.isArray(j)) arr = j; } catch (e) {}
          if (!arr) { summarize(); return; }
          for (var k = 0; k < arr.length; k++) msgs.push(arr[k]);
          if (arr.length < 10) { summarize(); return; }
          page++;
          setTimeout(walk, 900);
        })
        .catch(function () { summarize(); });
    }
    function summarize() {
      if (!msgs.length) { pushLog('warn', 'Chat: nenhuma mensagem acessível (vazio ou exige parâmetros do portal).'); return; }
      ingestChat(msgs, false); // exibe na aba Chat — não reenvia ao backend (somente leitura)
      pushLog('success', '💬 Chat: ' + msgs.length + ' mensagens recuperadas — exibidas na aba Chat.');
      callBackend({ bot_id: settings.botId, log_message: { level: 'info', message: '[DISPUTA-API] MODO TESTE compra ' + compra + ': chat com ' + msgs.length + ' mensagens.' } }, function () {});
    }
    walk();
  }

  // ═══ Painel da disputa ═══════════════════════════════════════════════
  // O painel fica por cima da sala de disputa do portal, então ele não pode
  // competir com ela: fundo claro para a tabela de itens, que é o que se lê o
  // tempo todo, e a marca concentrada na barra de título e nos fios dourados.
  // O console de eventos no pé é escuro de propósito — é o único bloco onde a
  // informação chega em fluxo e precisa ser distinguível de relance.
  var STYLE = '#hz-painel-disputa{position:fixed;bottom:16px;right:16px;z-index:999999;width:700px;max-width:calc(100vw - 24px);height:648px;max-height:calc(100vh - 32px);background:#fff;border-radius:14px;box-shadow:0 18px 48px rgba(12,20,40,0.30);border:1px solid #DCE1EC;font-family:Inter,Segoe UI,system-ui,sans-serif;display:flex;flex-direction:column;color:#1B2436;overflow:hidden}'
    + '#hz-painel-disputa.hz-min{height:44px !important}'
    + '#hz-painel-disputa.hz-min .hzd-body,#hz-painel-disputa.hz-min .hzd-foot{display:none}'
    + '#hz-painel-disputa.hz-max{left:10px !important;top:10px !important;right:10px !important;bottom:10px !important;width:auto !important;height:auto !important;max-height:none !important}'
    // Barra de título: o fio dourado embaixo é a assinatura da marca e se
    // repete no popup, para o painel ser reconhecido como da mesma extensão.
    + '.hzd-head{background:linear-gradient(180deg,' + NAVY + ' 0%,#121D38 100%);box-shadow:inset 0 -2px 0 ' + GOLD + ';color:#fff;padding:10px 14px;display:flex;align-items:center;gap:9px;flex-shrink:0;cursor:move;user-select:none}'
    + '.hzd-head img{width:22px;height:22px;background:#fff;border-radius:50%;padding:2px;box-sizing:border-box;pointer-events:none}'
    + '.hzd-title{font-size:12px;font-weight:700;letter-spacing:.03em;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.hzd-badge{font-size:9px;font-weight:700;letter-spacing:.04em;padding:3px 9px;border-radius:999px;background:rgba(224,196,137,0.16);color:' + GOLD_SOFT + ';max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.hzd-clock{font-size:12px;font-family:JetBrains Mono,Consolas,monospace;color:#C3CDE2;white-space:nowrap}'
    + '.hzd-ico{background:none;border:none;color:#C3CDE2;cursor:pointer;font-size:13px;padding:0 3px;line-height:1}'
    + '.hzd-ico:hover{color:' + GOLD_SOFT + '}'
    + '.hzd-body{overflow:hidden;padding:11px;display:flex;flex-direction:column;gap:10px;flex:1;min-height:0}'
    + '.hzd-schedule{background:#F6F7FA;border:1px solid #E6E9F0;border-radius:9px;padding:8px 11px;flex-shrink:0;font-size:11px;color:#1B2436}'
    + '.hzd-schedule-row{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-weight:600}'
    + '.hzd-schedule-track{height:6px;background:#E3E7EF;border-radius:999px;margin-top:7px;overflow:hidden}'
    + '.hzd-schedule-fill{height:100%;width:0;background:linear-gradient(90deg,' + NAVY + ',' + GOLD + ');border-radius:999px}'
    // Cada cartão é marcado por um traço dourado à esquerda do seu título:
    // é o que separa um bloco do outro sem precisar de mais linhas na tela.
    + '.hzd-card{border:1px solid #E6E9F0;border-radius:10px;overflow:hidden;flex-shrink:0;background:#fff;display:flex;flex-direction:column}'
    + '.hzd-card-title{background:#F6F7FA;box-shadow:inset 3px 0 0 ' + GOLD + ';padding:7px 11px;font-size:9px;font-weight:700;letter-spacing:.09em;color:#6B7689;text-transform:uppercase;border-bottom:1px solid #E6E9F0;display:flex;justify-content:space-between;align-items:center;gap:6px;flex-shrink:0}'
    + '.hzd-id-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px 16px;padding:10px 11px;font-size:10px;overflow:auto;max-height:110px}'
    + '.hzd-id-grid .k{color:#8A96AC;font-size:8px;text-transform:uppercase;letter-spacing:.06em;font-weight:700}'
    + '.hzd-id-grid .v{color:#1B2436;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}'
    + '.hzd-metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;flex-shrink:0}'
    + '.hzd-metric{background:#F6F7FA;border:1px solid #E6E9F0;border-radius:9px;padding:7px 9px}'
    + '.hzd-metric .k{font-size:8px;text-transform:uppercase;letter-spacing:.06em;color:#8A96AC;font-weight:700}'
    + '.hzd-metric .v{font-size:12.5px;font-weight:700;color:' + NAVY + ';margin-top:3px;white-space:nowrap;font-variant-numeric:tabular-nums}'
    + '.hzd-items{flex:1 1 auto !important;min-height:120px}'
    + '.hzd-tscroll{overflow:auto;flex:1;min-height:0}'
    + '.hzd-table{width:100%;border-collapse:collapse;font-size:10px}'
    + '.hzd-table th{background:#F2F4F8;text-align:left;padding:6px 7px;font-size:8px;text-transform:uppercase;letter-spacing:.06em;color:#6B7689;border-bottom:1px solid #E3E7EF;white-space:nowrap;position:sticky;top:0;z-index:1}'
    + '.hzd-table td{padding:5px 7px;border-bottom:1px solid #F3F5F9;vertical-align:top;white-space:nowrap}'
    + '.hzd-table tbody tr:hover{background:#FAFBFD}'
    + '.hzd-num{text-align:right;font-variant-numeric:tabular-nums}'
    + '.hzd-cfg{width:56px;height:22px;border:1px solid #D5DAE5;border-radius:6px;font-size:10px;padding:0 5px;text-align:right;font-family:inherit;color:#1B2436}'
    + '.hzd-cfg:focus{outline:none;border-color:' + GOLD + ';box-shadow:0 0 0 2px rgba(192,154,82,0.20)}'
    // Estado do item: verde é "vencendo", vermelho é "perdendo". Nada mais na
    // tabela usa essas duas cores, então elas são lidas sem o rótulo.
    + '.hzd-st{font-size:9px;font-weight:700;padding:2px 8px;border-radius:999px;letter-spacing:.02em}'
    + '.hzd-st-w{background:rgba(14,159,110,0.13);color:#0A7A54}'
    + '.hzd-st-l{background:rgba(194,69,63,0.12);color:#A8352F}'
    + '.hzd-st-a{background:#F1F3F8;color:#5B6780}'
    + '.hzd-st-e{background:#E8EAF0;color:#4A5468}'
    + '.hzd-cls{color:' + GREEN + ';font-weight:700;text-align:center}'
    + '.hzd-empty{text-align:center;padding:14px;font-size:10px;color:#8A96AC}'
    // Abas: o sublinhado dourado é o mesmo fio da barra de título.
    + '.hzd-tabs{display:flex;gap:2px;border-bottom:1px solid #E6E9F0;flex-shrink:0;padding:0 7px}'
    + '.hzd-tab{padding:6px 11px;font-size:10px;font-weight:700;letter-spacing:.03em;color:#6B7689;cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;white-space:nowrap;font-family:inherit}'
    + '.hzd-tab:hover{color:' + NAVY + '}'
    + '.hzd-tab.on{color:' + NAVY + ';border-bottom-color:' + GOLD + '}'
    + '.hzd-feed{height:124px;overflow-y:auto;padding:8px 11px;background:' + NAVY_DEEP + ';color:#D7DEEC;font-family:JetBrains Mono,Consolas,monospace;font-size:10px;flex-shrink:0}'
    + '.hzd-feed-e{padding:1px 0;line-height:1.5;word-break:break-word}'
    + '.hzd-feed-e.err{color:#FF9A9A}.hzd-feed-e.ok{color:#65E0AE}.hzd-feed-e.warn{color:#EFC36A}'
    + '.hzd-feed-e.chat b{color:' + GOLD_SOFT + '}'
    + '.hzd-feed a{color:' + GOLD_SOFT + '}'
    + '.hzd-feed-e.det b{color:' + GOLD_SOFT + '}'
    + '.hzd-foot{display:flex;align-items:center;gap:7px;padding:9px 12px;border-top:1px solid #E6E9F0;background:#FBFCFE;flex-shrink:0}'
    + '.hzd-foot input{height:28px;border:1px solid #D5DAE5;border-radius:7px;padding:0 9px;font-size:11px;width:76px;font-family:inherit;color:#1B2436}'
    + '.hzd-foot input:focus{outline:none;border-color:' + GOLD + ';box-shadow:0 0 0 2px rgba(192,154,82,0.20)}'
    + '.hzd-btn{height:28px;padding:0 13px;border:none;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit}'
    + '.hzd-btn:hover{filter:brightness(1.07)}'
    + '.hzd-btn-send{background:' + NAVY + ';color:#fff}'
    // Dourado sobre navy é a cor de ação do operador, a mesma do botão
    // principal do popup. Em disputa ele se esvazia: continuar rodando é o
    // estado normal, e o que precisa de destaque passa a ser parar.
    + '.hzd-btn-run{background:' + GOLD + ';color:' + NAVY + ';border:1px solid transparent}'
    + '.hzd-btn-run.on{background:#fff;color:' + NAVY + ';border:1px solid ' + GOLD + '}'
    + '.hzd-mode{font-size:10px;font-weight:600;color:#6B7689;flex:1;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.hzd-grip{position:absolute;left:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;opacity:.5;color:#8A96AC;font-size:11px;text-align:center;line-height:14px;user-select:none}'
    + '#hz-painel-disputa.hz-so-itens #hzd-ids-card,#hz-painel-disputa.hz-so-itens .hzd-metrics,#hz-painel-disputa.hz-so-itens #hzd-feed-card,#hz-painel-disputa.hz-so-itens #hzd-schedule{display:none}'
    + '#hz-painel-disputa.hz-so-itens .hzd-body{gap:6px}';

  function saveGeom() {
    try {
      var p = document.getElementById('hz-painel-disputa');
      if (!p || p.classList.contains('hz-max')) return;
      var r = p.getBoundingClientRect();
      localStorage.setItem('hzd-geom', JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }));
    } catch (e) {}
  }
  function restoreGeom() {
    try {
      var g = JSON.parse(localStorage.getItem('hzd-geom') || 'null');
      var p = document.getElementById('hz-painel-disputa');
      if (!g || !p) return;
      p.style.left = clamp(g.left, 0, window.innerWidth - 200) + 'px';
      p.style.top = clamp(g.top, 0, window.innerHeight - 60) + 'px';
      p.style.right = 'auto';
      p.style.bottom = 'auto';
      p.style.width = clamp(g.w, 400, window.innerWidth - 24) + 'px';
      p.style.height = clamp(g.h, 320, window.innerHeight - 24) + 'px';
    } catch (e) {}
  }

  function buildPanel() {
    if (document.getElementById('hz-painel-disputa')) return;
    if (!document.body) { setTimeout(buildPanel, 500); return; }
    var style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    var p = document.createElement('div');
    p.id = 'hz-painel-disputa';
    p.innerHTML = ''
      + '<div class="hzd-head" id="hzd-head">'
      +   '<img src="' + LOGO + '" alt="HORASIS" />'
      +   '<span class="hzd-title">HORASIS · Robô de Lances — Disputa</span>'
      +   '<span class="hzd-badge" id="hzd-status">—</span>'
      +   '<span class="hzd-clock" id="hzd-clock">--:--:--</span>'
      +   '<span class="hzd-clock" id="hzd-timer" title="Tempo em disputa">⏱ 00:00:00</span>'
      +   '<button class="hzd-ico" id="hzd-max" title="Maximizar">⛶</button>'
      +   '<button class="hzd-ico" id="hzd-min" title="Minimizar">—</button>'
      +   '<button class="hzd-ico" id="hzd-close" title="Fechar">✕</button>'
      + '</div>'
      + '<div class="hzd-body">'
      +   '<div class="hzd-card" id="hzd-ids-card"><div class="hzd-card-title"><span>Identificação do Portal</span><span id="hzd-robo-id"></span></div><div class="hzd-id-grid" id="hzd-ids"><div class="hzd-empty">Carregando configuração do robô...</div></div></div>'
      +   '<div class="hzd-metrics" id="hzd-metrics"></div>'
      +   '<div class="hzd-schedule" id="hzd-schedule" style="display:none"><div class="hzd-schedule-row"><span id="hzd-schedule-label"></span><span id="hzd-schedule-detail"></span></div><div class="hzd-schedule-track" id="hzd-schedule-track" role="progressbar" aria-label="Progresso do horário previsto da disputa" aria-valuemin="0" aria-valuemax="100"><div class="hzd-schedule-fill" id="hzd-schedule-fill"></div></div></div>'
      +   '<div class="hzd-card hzd-items"><div class="hzd-card-title"><span>Lances</span><span style="display:flex;gap:8px;align-items:center"><span id="hzd-items-count">0 item(ns) monitorado(s)</span><button class="hzd-ico" id="hzd-expand" title="Expandir somente a área de itens" style="color:#6B7689;font-size:11px;background:none;border:none;cursor:pointer">⤢</button></span></div>'
      +     '<div class="hzd-tscroll" id="hzd-tscroll"><table class="hzd-table"><thead><tr><th>#</th><th>Descrição</th><th>Status</th><th>Melhor Lance</th><th>Meu Lance</th><th>Lance Manual</th><th>Mínimo R$</th><th>Desc. R$</th><th>Var. %</th><th>Situação</th><th>Fechado</th></tr></thead><tbody id="hzd-tbody"></tbody></table><div class="hzd-empty" id="hzd-tempty">Nenhum item monitorado ainda.</div></div>'
      +   '</div>'
      +   '<div class="hzd-card" id="hzd-feed-card"><div class="hzd-tabs">'
      +     '<button class="hzd-tab on" id="hzd-tab-chat">Chat (0)</button>'
      +     '<button class="hzd-tab" id="hzd-tab-alerts">Alertas (0)</button>'
      +     '<button class="hzd-tab" id="hzd-tab-details">Detalhes</button>'
      +     '<button class="hzd-tab" id="hzd-tab-log">Log</button>'
      +   '</div><div class="hzd-feed" id="hzd-feed"></div></div>'
      + '</div>'
      + '<div class="hzd-foot">'
      +   '<input id="hzd-m-item" placeholder="Item nº" /><input id="hzd-m-valor" type="number" step="0.01" placeholder="Lance R$" /><button class="hzd-btn hzd-btn-send" id="hzd-m-send">Enviar</button>'
      +   '<span class="hzd-mode" id="hzd-mode"></span>'
      +   '<button class="hzd-btn hzd-btn-run" id="hzd-run">▶ Iniciar</button>'
      + '</div>'
      + '<div class="hzd-grip" title="Arraste para redimensionar">⤡</div>';
    document.body.appendChild(p);

    restoreGeom();

    // Arrastar pela barra de título
    var drag = null;
    document.getElementById('hzd-head').addEventListener('mousedown', function (e) {
      if (e.target.closest('button') || isMax) return;
      var r = p.getBoundingClientRect();
      drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (drag) {
        drag.moved = true;
        p.style.left = clamp(drag.ox + (e.clientX - drag.sx), 0, window.innerWidth - 80) + 'px';
        p.style.top = clamp(drag.oy + (e.clientY - drag.sy), 0, window.innerHeight - 42) + 'px';
        p.style.right = 'auto';
        p.style.bottom = 'auto';
      }
    });
    window.addEventListener('mouseup', function () { if (drag) { drag = null; saveGeom(); } });

    // Redimensionar pela alça (canto inferior esquerdo)
    var rs = null;
    p.querySelector('.hzd-grip').addEventListener('mousedown', function (e) {
      if (isMax) return;
      var r = p.getBoundingClientRect();
      rs = { sx: e.clientX, sy: e.clientY, w: r.width, h: r.height };
      e.preventDefault();
      e.stopPropagation();
    });
    window.addEventListener('mousemove', function (e) {
      if (rs) {
        p.style.width = clamp(rs.w - (e.clientX - rs.sx), 420, window.innerWidth - 24) + 'px';
        p.style.height = clamp(rs.h - (e.clientY - rs.sy), 320, window.innerHeight - 24) + 'px';
      }
    });
    window.addEventListener('mouseup', function () { if (rs) { rs = null; saveGeom(); } });

    // Minimizar / maximizar / fechar / expandir itens
    document.getElementById('hzd-min').addEventListener('click', function () {
      var isMin = p.classList.toggle('hz-min');
      this.textContent = isMin ? '▢' : '—';
    });
    document.getElementById('hzd-max').addEventListener('click', function () {
      isMax = !isMax;
      p.classList.toggle('hz-max', isMax);
      this.textContent = isMax ? '🗗' : '⛶';
      this.title = isMax ? 'Restaurar' : 'Maximizar';
    });
    document.getElementById('hzd-close').addEventListener('click', function () { p.style.display = 'none'; });
    document.getElementById('hzd-expand').addEventListener('click', function () {
      var on = p.classList.toggle('hz-so-itens');
      this.textContent = on ? '⤡' : '⤢';
      this.title = on ? 'Restaurar painel completo' : 'Expandir somente a área de itens';
    });

    // Iniciar / Pausar
    document.getElementById('hzd-run').addEventListener('click', function () {
      if (!running && (!bindingConfirmed || !sessionHealthy || sessionLost || !botConfig)) {
        pushLog('warn', 'Não é possível iniciar: aguarde a confirmação da sessão e da configuração do robô.'); return;
      }
      running = !running;
      resumeRequested = false;
      chrome.storage.local.set({ ['hz_running_compra_' + compra]: running });
      if (running) {
        if (!startedAt) startedAt = Date.now();
        activeSince = Date.now();
        statusLabel = 'Em Disputa';
        callBackend({ bot_id: settings.botId, action: 'start', portal_url: window.location.href }, function () {});
        pushLog('success', '🟢 Motor iniciado — lances automáticos ativos conforme a estratégia configurada. Chat do pregoeiro sendo monitorado.');
        openNativeChatOnce();
        maybeAutoBid();
        syncChatLive();
      } else {
        resumeRequested = false;
        elapsedBefore += Math.max(0, Math.floor((Date.now() - activeSince) / 1000));
        disputeSecs = elapsedBefore;
        activeSince = 0;
        statusLabel = 'Pausado';
        callBackend({ bot_id: settings.botId, action: 'pause', portal_url: window.location.href }, function () {});
        pushLog('warn', '⏸ Motor pausado pelo operador.');
      }
      dirty = true;
      saveState();
    });

    // Lance manual
    document.getElementById('hzd-m-send').addEventListener('click', function () {
      var num = document.getElementById('hzd-m-item').value.trim();
      var raw = parseFloat(document.getElementById('hzd-m-valor').value);
      if (!num) { var best = globalBest(); num = best.num; }
      if (!num || isNaN(raw) || raw <= 0) { pushLog('warn', 'Informe o item e um valor válido para o lance manual.'); return; }
      var it = items[num] || {};
      sendLance(num, parseFloat(raw.toFixed(2)), it.fase, false);
    });

    // Abas
    document.getElementById('hzd-tab-chat').addEventListener('click', function () { activeTab = 'chat'; dirty = true; });
    document.getElementById('hzd-tab-alerts').addEventListener('click', function () { activeTab = 'alerts'; dirty = true; });
    document.getElementById('hzd-tab-details').addEventListener('click', function () { activeTab = 'details'; dirty = true; });
    document.getElementById('hzd-tab-log').addEventListener('click', function () { activeTab = 'log'; dirty = true; });

    // Edição da configuração por item (LANCE MANUAL/MÍNIMO/DESCONTO/VARIAÇÃO) → backend
    document.getElementById('hzd-tbody').addEventListener('change', function (ev) {
      var inp = ev.target;
      if (!inp || !inp.dataset || !inp.dataset.f || !bindingConfirmed) return;
      var num = inp.dataset.n;
      var field = inp.dataset.f;
      var val = parseFloat(String(inp.value).replace(',', '.'));
      if (isNaN(val)) return;
      var bi = findBotItem(num);
      if (bi) {
        bi[field] = val;
      } else {
        // Sem cadastro prévio, a primeira configuração de um item acontece
        // aqui. Criar a linha local na hora é o que faz o valor digitado
        // sobreviver ao próximo redesenho e o que libera o lance automático
        // neste item — o motor exige que o item exista para dar lance sozinho.
        bi = {
          numero_item: Number(num),
          descricao: String((items[num] || {}).descricao || ''),
          participar: true,
          valor_minimo: null, lance_manual: null, desconto: null, variacao: null
        };
        bi[field] = val;
        botItems.push(bi);
        lastRowsKey = '';
        delete avisouSemPiso[num];
      }
      var upd = { participar: bi.participar === true, descricao: bi.descricao };
      upd[field] = val;
      callBackend({ bot_id: settings.botId, item_id: Number(num), item_update: upd }, function (resp) {
        pushLog(resp && resp.ok ? 'success' : 'error', resp && resp.ok ? 'Config do item ' + num + ' atualizada (' + field + ' = ' + val + ').' : 'Falha ao salvar config do item ' + num + '.');
      });
    });
  }

  function idCell(k, v) {
    return '<div><div class="k">' + esc(k) + '</div><div class="v" title="' + esc(v) + '">' + esc(v) + '</div></div>';
  }

  function renderTick() {
    var p = document.getElementById('hz-painel-disputa');
    if (!p || !dirty) return;
    dirty = false;
    var st = el('hzd-status');
    if (st) st.textContent = statusLabel;
    var ck = el('hzd-clock');
    if (ck) { ck.textContent = fmtClock(Date.now() + clockSkewMs); ck.title = 'Relógio oficial do portal'; }
    var tm = el('hzd-timer');
    if (tm) { tm.textContent = '⏱ ' + fmtTimer(disputeSecs); tm.title = startedAt ? 'Iniciado em ' + new Date(startedAt).toLocaleString('pt-BR') : 'Tempo em disputa'; }

    // Identificação — dados do robô quando carregado; identificação do portal caso contrário
    if (!botConfig) {
      var idsP = el('hzd-ids');
      var pKey = (portalInfo.uasg || '') + '|' + (portalInfo.orgao || '') + '|' + (portalInfo.titulo || '') + '|' + (portalInfo.numero || '') + '|' + (myCnpj || '') + '|' + (noCreds ? '1' : '0');
      if (idsP && idsP.getAttribute('data-mode') !== pKey) {
        idsP.setAttribute('data-mode', pKey);
        var pTitulo = portalInfo.titulo || ((portalInfo.modalidade || 'Compra') + (portalInfo.numero ? ' Nº ' + portalInfo.numero + (portalInfo.ano ? '/' + portalInfo.ano : '') : ''));
        var hasPortal = portalInfo.uasg || portalInfo.orgao || portalInfo.titulo || portalInfo.numero;
        idsP.innerHTML = hasPortal
          ? idCell('Licitação', pTitulo)
            + idCell('UASG', portalInfo.uasg || '—')
            + idCell('Órgão', portalInfo.orgao || '—')
            + idCell('UF', portalInfo.uf || '—')
            + idCell('Portal', 'Comprasnet')
            + idCell('Compra', compra || '—')
            + (portalInfo.link_pncp ? idCell('Edital PNCP', portalInfo.link_pncp) : '')
            + (myCnpj ? idCell('Fornecedor (CNPJ)', myCnpj) : '')
            + '<div style="grid-column:1/-1;font-size:10px;line-height:1.5;padding-top:4px;color:' + (noCreds ? '#B45309' : '#64748B') + '">' + (noCreds
              ? 'Extensão sem credenciais — abra o popup do HORASIS e cole o App ID e o Token da página Conectar Robô. O portal continua sendo monitorado; os lances ficam bloqueados até lá.'
              : 'Preparando o robô desta compra...') + '</div>'
          : '<div class="hzd-empty">Identificando a compra pelo portal...</div>';
      }
    } else if (botConfig && !idsRendered) {
      idsRendered = true;
      var c = botConfig;
      var local = ((c.municipio || '') + (c.uf ? ' - ' + c.uf : '')) || '—';
      el('hzd-ids').innerHTML =
        idCell('Nº Interno', c.numero_interno != null ? String(c.numero_interno) : '—') +
        idCell('Nº da Compra', c.numero_compra || '—') +
        idCell('ID Pregão', c.pregao_id || c.numero_compra || '—') +
        idCell('UASG', c.uasg || '—') +
        idCell('Portal', c.portal_name || '—') +
        idCell('Situação', c.situacao || '—') +
        idCell('Unidade Compradora', c.unidade_compradora || '—') +
        idCell('Órgão', c.orgao || '—') +
        idCell('Modalidade', c.modalidade || '—') +
        idCell('Abertura', c.data_abertura || '—') +
        idCell('Encerramento', c.data_encerramento || '—') +
        idCell('Local', local) +
        (portalInfo.link_pncp ? idCell('Edital PNCP', portalInfo.link_pncp) : '');
      var rid = el('hzd-robo-id');
      if (rid) rid.textContent = 'Robô: ' + String(c.title || '').substring(0, 40) + (c.mode ? ' · ' + c.mode : '');
    }

    // Métricas
    var met = el('hzd-metrics');
    if (met) {
      var monitored = botItems.length || Object.keys(items).length;
      var winning = 0;
      Object.keys(items).forEach(function (num) { if (weAreWinning(items[num])) winning++; });
      met.innerHTML =
        '<div class="hzd-metric"><div class="k">' + (botConfig ? 'Valor Inicial' : 'Valor Estimado') + '</div><div class="v">' + fmtBR(botConfig ? botConfig.initial_value : portalEstimate()) + '</div></div>'
        + '<div class="hzd-metric"><div class="k">' + (botConfig ? 'Valor Mínimo' : 'Melhor Lance') + '</div><div class="v" style="color:' + (botConfig ? RED : GREEN) + '">' + fmtBR(botConfig ? botConfig.minimum_value : (globalBest().value || 0)) + '</div></div>'
        + '<div class="hzd-metric"><div class="k">Vencendo</div><div class="v" style="color:' + GREEN + '">' + winning + '/' + monitored + '</div></div>'
        + '<div class="hzd-metric"><div class="k">Nossos Lances</div><div class="v" style="color:' + PRIMARY + '">' + ourBids + '</div></div>'
        + '<div class="hzd-metric"><div class="k">Total Lances</div><div class="v">' + totalBids + '</div></div>';
    }

    // Tabela de itens — reconstrói quando o conjunto muda
    var tbody = el('hzd-tbody');
    var tempty = el('hzd-tempty');
    var nums = Object.keys(items).sort(function (a, b) { return Number(a) - Number(b); });
    if (botItems.length) {
      botItems.forEach(function (bi) { if (nums.indexOf(String(bi.numero_item)) === -1) nums.push(String(bi.numero_item)); });
      nums.sort(function (a, b) { return Number(a) - Number(b); });
    }
    var rowsKey = nums.join(',');
    if (tbody && rowsKey !== lastRowsKey) {
      lastRowsKey = rowsKey;
      tbody.innerHTML = nums.map(function (num) {
        var bi = findBotItem(num) || {};
        function cfg(f) { return bi[f] != null ? bi[f] : ''; }
        return '<tr>'
          + '<td>' + esc(num) + '</td>'
          + '<td id="cell-ds-' + esc(num) + '" style="max-width:170px;overflow:hidden;text-overflow:ellipsis" title="' + esc(bi.descricao || '') + '">' + esc(String(bi.descricao || '').substring(0, 34) || '—') + '</td>'
          + '<td><span class="hzd-st hzd-st-a" id="cell-st-' + esc(num) + '">—</span></td>'
          + '<td class="hzd-num" id="cell-mb-' + esc(num) + '">—</td>'
          + '<td class="hzd-num" id="cell-mn-' + esc(num) + '">—</td>'
          + '<td><input class="hzd-cfg" data-f="lance_manual" data-n="' + esc(num) + '" value="' + cfg('lance_manual') + '" placeholder="—" title="Lance manual (override)"></td>'
          + '<td><input class="hzd-cfg" data-f="valor_minimo" data-n="' + esc(num) + '" value="' + cfg('valor_minimo') + '" placeholder="—" title="Valor mínimo do item"></td>'
          + '<td><input class="hzd-cfg" data-f="desconto" data-n="' + esc(num) + '" value="' + cfg('desconto') + '" placeholder="—" title="Desconto fixo por lance (R$)"></td>'
          + '<td><input class="hzd-cfg" data-f="variacao" data-n="' + esc(num) + '" value="' + cfg('variacao') + '" placeholder="—" title="Variação percentual por lance"></td>'
          + '<td id="cell-sit-' + esc(num) + '">—</td>'
          + '<td class="hzd-cls" id="cell-cls-' + esc(num) + '">—</td>'
          + '</tr>';
      }).join('');
    }
    if (tempty) tempty.style.display = nums.length ? 'none' : 'block';
    var ic = el('hzd-items-count');
    if (ic) ic.textContent = nums.length + ' item(ns) monitorado(s)';

    // Células dinâmicas
    nums.forEach(function (num) {
      var it = items[num];
      if (!it) return;
      var mb = el('cell-mb-' + num);
      var mn = el('cell-mn-' + num);
      var sit = el('cell-sit-' + num);
      var stc = el('cell-st-' + num);
      var cls = el('cell-cls-' + num);
      var ds = el('cell-ds-' + num);
      if (mb) {
        var melhor = it.melhor != null ? (it.melhorUnit != null && it.melhorUnit < it.melhor ? it.melhorUnit : it.melhor) : null;
        mb.textContent = melhor != null ? fmtBR(melhor) : (it.lancesCount ? it.lancesCount + ' lances' : '—');
      }
      if (mn) {
        mn.textContent = it.meu != null ? fmtBR(it.meu) : '—';
        mn.className = 'hzd-num ' + (it.meu != null ? (weAreWinning(it) ? 'hzd-st-w' : 'hzd-st-l') : '');
      }
      if (sit) {
        sit.textContent = String(it.detalhe || it.fase || it.situacao || '—');
        sit.title = 'fase: ' + String(it.fase || '—') + ' · situação: ' + String(it.situacao || '—');
      }
      if (stc) {
        var s = statusItemOf(it);
        stc.textContent = s.t;
        stc.className = 'hzd-st hzd-st-' + s.c;
      }
      if (cls) cls.textContent = isItemClosed(it) ? '✔' : '—';
      if (ds && it.descricao) {
        var d = String(it.descricao).substring(0, 34);
        if (ds.textContent === '—' || ds.textContent === '') { ds.textContent = d; ds.title = it.descricao; }
      }
    });

    // Feed: Chat / Alertas / Detalhes / Log
    var feed = el('hzd-feed');
    if (feed) {
      if (activeTab === 'chat') {
        feed.innerHTML = chatLog.length
          ? chatLog.slice(-60).map(function (m) {
              return '<div class="hzd-feed-e chat"><b>' + esc(m.quem) + '</b> ' + esc(String(m.data_hora).replace('T', ' ').substring(0, 16)) + '<br>' + esc(String(m.mensagem).substring(0, 200)) + '</div>';
            }).join('')
          : '<div class="hzd-feed-e">Aguardando mensagens do portal. Se a abertura automática não estiver disponível nesta sessão, abra Mensagens no próprio portal.</div>';
      } else if (activeTab === 'alerts') {
        feed.innerHTML = alerts.length
          ? alerts.slice(-40).map(function (a) {
              return '<div class="hzd-feed-e err">[' + fmtClock(Date.parse(a.t)) + '] ' + esc(a.m) + '</div>';
            }).join('')
          : '<div class="hzd-feed-e">Nenhum alerta ainda — menções do pregoeiro, itens fechados e lances recusados aparecem aqui.</div>';
      } else if (activeTab === 'details') {
        var c2 = botConfig || {};
        var emQ = Number(pick(qtdes, ['qtdeItensEmDisputa'])) || 0;
        var agQ = Number(pick(qtdes, ['qtdeItensAguardandoDisputa'])) || 0;
        var abQ = Number(pick(qtdes, ['qtdeItensAguardandoAbertura'])) || 0;
        var encQ = Number(pick(qtdes, ['qtdeItensComDisputaEncerrada'])) || 0;
        var pTituloD = portalInfo.titulo || ((portalInfo.modalidade || 'Compra') + (portalInfo.numero ? ' Nº ' + portalInfo.numero + (portalInfo.ano ? '/' + portalInfo.ano : '') : ''));
        feed.innerHTML =
          '<div class="hzd-feed-e det"><b>Licitação:</b> ' + esc(pTituloD) + (portalInfo.orgao ? ' — ' + esc(portalInfo.orgao) : '') + (portalInfo.uasg ? ' (UASG ' + esc(portalInfo.uasg) + ')' : '') + '</div>'
          + '<div class="hzd-feed-e det"><b>Robô:</b> ' + esc(c2.title || (noCreds ? 'não configurado (popup da extensão)' : '—')) + '</div>'
          + '<div class="hzd-feed-e det"><b>Modo:</b> ' + esc(c2.mode || '—') + ' · <b>Tipo:</b> ' + esc(c2.dispute_type || '—') + ' · <b>Status:</b> ' + esc(c2.status || '—') + '</div>'
          + '<div class="hzd-feed-e det"><b>Valor inicial:</b> ' + fmtBR(c2.initial_value) + ' · <b>Mínimo:</b> ' + fmtBR(c2.minimum_value) + '</div>'
          + '<div class="hzd-feed-e det"><b>Redução:</b> ' + esc(c2.min_reduction || '—') + '% a ' + esc(c2.max_reduction || '—') + '% · <b>Tempo de resposta:</b> ' + esc(c2.response_time || '—') + 's</div>'
          + '<div class="hzd-feed-e det"><b>Fornecedor (CNPJ):</b> ' + esc(myCnpj || '—') + '</div>'
          + '<div class="hzd-feed-e det"><b>Origem da licitação:</b> ' + esc(origPortal || '—') + ' · <b>Situação origem:</b> ' + esc(c2.situacao || '—') + '</div>'
          + '<div class="hzd-feed-e det"><b>Portal:</b> Comprasnet · <b>Compra:</b> ' + esc(compra || '—') + '</div>'
          + '<div class="hzd-feed-e det"><b>Itens do portal:</b> em disputa ' + emQ + ' · aguardando disputa ' + agQ + ' · aguardando abertura ' + abQ + ' · encerrados ' + encQ + '</div>'
          + (c2.link_sistema_origem ? '<div class="hzd-feed-e det"><b>Portal de origem:</b> <a href="' + esc(c2.link_sistema_origem) + '" target="_blank" rel="noopener">Abrir portal</a></div>' : '')
          + (portalInfo.link_pncp ? '<div class="hzd-feed-e det"><b>Edital PNCP:</b> <a href="' + esc(portalInfo.link_pncp) + '" target="_blank" rel="noopener">abrir no PNCP</a></div>' : '');
      } else {
        feed.innerHTML = log.slice(-40).reverse().map(function (e) {
          return '<div class="hzd-feed-e ' + (e.l === 'error' ? 'err' : e.l === 'success' ? 'ok' : e.l === 'warn' ? 'warn' : '') + '">[' + fmtClock(Date.parse(e.t)) + '] ' + esc(e.m) + '</div>';
        }).join('');
      }
    }
    var tabChat = el('hzd-tab-chat');
    if (tabChat) { tabChat.textContent = 'Chat (' + chatLog.length + ')'; tabChat.className = 'hzd-tab' + (activeTab === 'chat' ? ' on' : ''); }
    var tabAl = el('hzd-tab-alerts');
    if (tabAl) { tabAl.textContent = 'Alertas (' + alerts.length + ')'; tabAl.className = 'hzd-tab' + (activeTab === 'alerts' ? ' on' : ''); }
    var tabDet = el('hzd-tab-details');
    if (tabDet) tabDet.className = 'hzd-tab' + (activeTab === 'details' ? ' on' : '');
    var tabLog = el('hzd-tab-log');
    if (tabLog) tabLog.className = 'hzd-tab' + (activeTab === 'log' ? ' on' : '');

    // Rodapé
    var md = el('hzd-mode');
    if (md) md.textContent = (botConfig ? botConfig.mode : '') + (testMode ? ' · MODO TESTE (somente leitura)' : '');
    var run = el('hzd-run');
    if (run) {
      run.textContent = running ? '⏸ Pausar' : '▶ Iniciar';
      run.className = 'hzd-btn hzd-btn-run' + (running ? ' on' : '');
    }
  }

  function setStatus(msg) { statusLabel = msg; dirty = true; }

  // ===== Init =====
  compra = detectCompra();
  if (!compra) return;          // não parece a sala de disputa: não assume a página
  window.__HZ_MOTOR_ATIVO__ = true; // o content.js antigo não abre painel aqui
  var engineStarted = false;
  var noCreds = false;
  function applySettings(data) {
    settings.token = data.hz_token || '';
    settings.appId = data.hz_app_id || '';
  }
  // O robô desta compra não é escolhido a mão: o backend o cria (ou recupera)
  // a partir do código da compra lido da URL desta aba, e devolve o id em
  // bot_config.id. settings.botId só existe depois da primeira resposta, e por
  // isso não entra aqui — exigir o id antes de pedi-lo travaria o motor para
  // sempre.
  function haveCreds() { return !!(settings.token && settings.appId); }
  function startEngine() {
    if (engineStarted) return;
    engineStarted = true;
    installSensors();
    syncClock();
    clockTimer = setInterval(syncClock, 60000);
    setInterval(function () {
      if (running) {
        disputeSecs = elapsedBefore + Math.max(0, Math.floor((Date.now() - activeSince) / 1000));
        dirty = true;
        if (disputeSecs % 10 === 0) queueSave();
      }
    }, 1000);
    syncChatLive();
    setInterval(syncChatLive, 15000);
    pollLoop();
    setInterval(renderSchedule, 1000);
    setInterval(scanScheduleFromPage, 15000);
    window.addEventListener('pagehide', saveState);
    fetchPortalInfo();
    if (haveCreds()) {
      loadBot(0);
    } else {
      noCreds = true;
      setStatus('Monitorando sessão do portal');
      pushLog('warn', 'Extensão sem credenciais. Abra o popup do HORASIS, cole o App ID e o Token da página Conectar Robô e salve. O portal continua sendo monitorado; os lances ficam bloqueados até lá.');
    }
  }
  chrome.storage.local.get(['hz_app_id', 'hz_token'], function (data) {
    applySettings(data);
    // Só retoma após validar sessão, configuração e itens atuais do portal.
    running = false;
    restoreState(function () {
      buildPanel();
      renderTimer = setInterval(renderTick, 700);
      dirty = true;
      startEngine();
      pushLog('info', resumeRequested ? 'Histórico restaurado. Aguardando validação da sessão e dos itens para retomar automaticamente.' : 'Histórico restaurado. Motor aguardando comando Iniciar.');
    });
  });
  // Recarrega automaticamente quando o usuário salvar as credenciais no popup
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (!changes.hz_app_id && !changes.hz_token) return;
    chrome.storage.local.get(['hz_app_id', 'hz_token'], function (data) {
      if (data.hz_token === settings.token && data.hz_app_id === settings.appId) return;
      applySettings(data);
      if (!haveCreds()) {
        noCreds = true;
        setStatus('Cole o App ID e o Token no popup da extensão');
        return;
      }
      idsRendered = false;
      lastRowsKey = '';
      dirty = true;
      noCreds = false;
      if (engineStarted) { loadBot(0); return; }
      startEngine();
    });
  });

  // ===== Identificação da compra direto do portal (independe do robô) =====
  var MODS = { 1: 'Pregão Eletrônico', 4: 'Tomada de Preços', 5: 'Concorrência', 6: 'Dispensa Eletrônica', 7: 'Inexigibilidade Eletrônica', 8: 'Leilão Eletrônico' };
  function validateBinding() {
    bindingConfirmed = false;
    if (!botConfig) return;
    if (!portalInfo.uasg || !portalInfo.numero) {
      setStatus('Aguardando identificação da compra pelo portal — lances bloqueados');
      return;
    }
    // O robô nasce do código desta compra, então o vínculo é por construção.
    // A conferência fica porque custa nada e porque é ela que pega o caso em
    // que o backend devolve outro robô: um lance na licitação errada não tem
    // desfazer.
    if (String(botConfig.purchase_id || '') === String(compra)) {
      bindingConfirmed = true;
      setStatus(running ? 'Em Disputa' : 'Pronto — compra conferida');
      return;
    }
    if (running) {
      elapsedBefore += Math.max(0, Math.floor((Date.now() - activeSince) / 1000));
      running = false;
      activeSince = 0;
      chrome.storage.local.set({ ['hz_running_compra_' + compra]: false });
      callBackend({ bot_id: settings.botId, action: 'pause', portal_url: window.location.href }, function () {});
    }
    resumeRequested = false;
    saveState();
    setStatus('Robô não corresponde à compra desta aba — lances bloqueados');
    pushLog('error', 'Vínculo incorreto: o robô devolvido pelo servidor é de outra compra (' + (botConfig.purchase_id || '—') + ' em vez de ' + compra + '). Recarregue a página; se persistir, avise o suporte — nenhum lance sai neste estado.');
  }
  function fetchPortalInfo() {
    apiCall('GET', '/comprasnet-fase-externa/v1/compras/' + compra + '/participacao').then(function (r) {
      if (!r.ok) return;
      var j = null;
      try { j = JSON.parse(r.text) || {}; } catch (e) { return; }
      portalInfo.uasg = j.numeroUasg != null ? String(j.numeroUasg) : null;
      portalInfo.orgao = j.nomeUasg || null;
      portalInfo.uf = j.ufUasg || null;
      portalInfo.numero = j.numero != null ? String(j.numero) : null;
      portalInfo.ano = j.ano != null ? String(j.ano) : null;
      portalInfo.modalidade = MODS[Number(j.modalidade)] || (j.modalidade != null ? 'Modalidade ' + j.modalidade : null);
      portalInfo.link_pncp = j.linkPncp || null;
      portalInfo.chave_pncp = j.chaveCompraPncp || null;
      portalInfo.situacao = j.situacaoCompraFaseExterna || null;
      readScheduleFromPurchase(j);
      scanScheduleFromPage();
      // Título da compra na própria página (ex.: "Dispensa Eletrônica Nº 182/2026")
      try {
        var t = String(document.body.innerText || '').match(/(Pregão|Dispensa|Inexigibilidade|Leilão|Concorrência|Cotação)[^\n]{0,30}?N?º?\s*(\d{1,5})\s*[-\/ ]\s*(\d{4})/i);
        if (t) {
          portalInfo.titulo = t[0].trim();
          if (!portalInfo.modalidade) portalInfo.modalidade = t[1];
          if (portalInfo.numero == null) portalInfo.numero = t[2];
          if (portalInfo.ano == null) portalInfo.ano = t[3];
        }
      } catch (e) {}
      dirty = true;
      validateBinding();
      pushLog('info', 'Licitação identificada pelo portal: ' + (portalInfo.titulo || portalInfo.modalidade || ('Compra ' + compra)) + (portalInfo.orgao ? ' — ' + portalInfo.orgao : '') + (portalInfo.uasg ? ' (UASG ' + portalInfo.uasg + ')' : '') + (portalInfo.link_pncp ? ' · PNCP: ' + portalInfo.link_pncp : ''));
      // CNPJ do fornecedor logado — habilita Vencedor/Perdedor mesmo sem robô configurado
      apiCall('GET', '/comprasnet-usuario/v1/usuario').then(function (r2) {
        if (!r2.ok) return;
        try {
          var u = JSON.parse(r2.text) || {};
          var cnpj = u.fornecedor && (u.fornecedor.identificacao || u.fornecedor.identificacaoFornecedor);
          if (cnpj && !myCnpj) { myCnpj = String(cnpj).replace(/\D/g, ''); dirty = true; }
        } catch (e) {}
      }).catch(function () {});
    }).catch(function () {});
  }

  function loadBot(attempt) {
    var requestedBotId = settings.botId;
    setStatus(settings.botId ? 'Carregando robô...' : 'Preparando o robô desta compra...');
    // Watchdog: se o backend não responder em 15s (rede travada ou worker
    // reciclado), tenta de novo em vez de ficar preso em "Carregando...".
    var gotAnswer = false;
    var watchdog = setTimeout(function () {
      if (gotAnswer || settings.botId !== requestedBotId) return;
      if (attempt < 2) { pushLog('warn', 'Servidor demorou a responder — tentando carregar o robô novamente...'); loadBot(attempt + 1); }
      else { setStatus('Erro ao carregar robô'); pushLog('error', 'Sem resposta do servidor ao carregar o robô — recarregue a página (F5) ou clique em Tentar novamente.'); }
    }, 15000);
    callBackend({
      bot_id: requestedBotId || undefined,
      fetch_details: true,
      portal_url: window.location.href,
      purchase_id: compra,
      // Primeira vez nesta compra: é só daqui que o backend tem como saber de
      // que licitação se trata. Depois serve para corrigir o que o portal
      // ainda não tinha publicado quando o robô nasceu.
      portal: {
        uasg: portalInfo.uasg || '',
        numero: portalInfo.numero || '',
        ano: portalInfo.ano || '',
        titulo: portalInfo.titulo || '',
        orgao: portalInfo.orgao || '',
        modalidade: portalInfo.modalidade || '',
        situacao: portalInfo.situacao || '',
        uf: portalInfo.uf || '',
        link_pncp: portalInfo.link_pncp || ''
      }
    }, function (resp) {
      gotAnswer = true;
      clearTimeout(watchdog);
      if (settings.botId !== requestedBotId) return;
      if (!resp || !resp.ok) {
        // Retry com backoff: o Service Worker do Chrome pode ser reciclado no
        // meio do fetch ("Failed to fetch" transitório) — tenta 3 vezes antes
        // de declarar erro.
        if (attempt < 2) {
          pushLog('warn', 'Tentativa ' + (attempt + 1) + '/3 de carregar o robô falhou (' + ((resp && resp.error) || 'sem resposta') + '). Tentando novamente em 2s...');
          setTimeout(function () { loadBot(attempt + 1); }, 2000);
          return;
        }
        setStatus('Erro ao carregar robô');
        var errTxt = String((resp && resp.error) || 'sem resposta');
        pushLog('error', 'Erro ao preparar o robô desta compra: ' + errTxt);
        // Mostra o erro REAL na tela (não fica preso em "Carregando..." para sempre)
        var hint = 'Confira o App ID e o Token no popup da extensão (ícone do HORASIS).';
        if (/unauthorized|401|token/i.test(errTxt)) hint = 'Token inválido ou expirado — gere um novo na página Conectar Robô do HORASIS, cole no popup da extensão e salve.';
        else if (/fetch|network|rede|HTTP 5\d\d/i.test(errTxt)) hint = 'Falha de rede — verifique sua conexão e confirme que o App ID está correto (página Conectar Robô do HORASIS).';
        var errCard = el('hzd-ids');
        if (errCard && errCard.getAttribute('data-err') !== 'loaderr') {
          errCard.setAttribute('data-err', 'loaderr');
          errCard.innerHTML = '<div style="grid-column:1/-1;padding:14px;font-size:11px;line-height:1.7;color:#1E293B">' +
            '<span style="color:' + RED + ';font-weight:700">Não foi possível preparar o robô desta compra.</span><br>' +
            'Erro: ' + errTxt + '<br>' + hint + '<br>' +
            '<button id="hzd-retry-load" style="margin-top:8px;padding:6px 14px;border:0;border-radius:6px;background:' + NAVY + ';color:#fff;font-weight:700;font-size:11px;cursor:pointer">Tentar novamente</button></div>';
          var retryBtn = document.getElementById('hzd-retry-load');
          if (retryBtn) retryBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            var e2 = el('hzd-ids');
            if (e2) { e2.removeAttribute('data-err'); e2.innerHTML = '<div style="grid-column:1/-1" class="hzd-empty">Preparando o robô desta compra...</div>'; }
            setStatus('Preparando o robô desta compra...');
            loadBot(0);
          });
        }
        return;
      }
      botConfig = (resp.data && resp.data.bot_config) || null;
      botItems = (resp.data && resp.data.items) || [];
      // É aqui que o robô desta compra passa a existir para o motor. Todas as
      // chamadas seguintes (lance, pausa, log, chat) já viajam com este id.
      if (botConfig && botConfig.id) settings.botId = String(botConfig.id);
      validateBinding();
      var details = (resp.data && resp.data.licitation_details) || null;
      myCnpj = String((botConfig && botConfig.fornecedor_cnpj) || '');
      // PUXA AUTOMÁTICO: itens e informações do edital sempre que o robô carrega —
      // mesmo que o robô ainda não tenha itens/configuração preenchidos.
      if (details) {
        if (details.items && details.items.length && (!botItems || botItems.length === 0)) {
          botItems = details.items.map(function (it) {
            return {
              numero_item: it.index,
              descricao: it.description || '',
              quantidade: it.quantity,
              unidade_medida: it.unit_measure || '',
              valor_unitario_estimado: it.unit_price,
              valor_total: it.total_price,
              participar: false,
              valor_minimo: null, lance_manual: null, desconto: null, variacao: null
            };
          });
          pushLog('success', '📥 ' + botItems.length + ' item(ns) da licitação importados automaticamente (edital) — edite Lance Manual/Mínimo/Desconto na tabela.');
        }
        if (botConfig) {
          var mergePairs = [
            ['numero_interno', 'numero_interno'], ['orgao', 'organ'], ['unidade_compradora', 'unidade_compradora'],
            ['municipio', 'municipio'], ['uf', 'uf'], ['modalidade', 'modalidade'], ['situacao', 'situacao'],
            ['data_abertura', 'data_abertura'], ['data_encerramento', 'data_encerramento']
          ];
          mergePairs.forEach(function (pair) {
            if ((botConfig[pair[0]] == null || botConfig[pair[0]] === '') && details[pair[1]] != null) botConfig[pair[0]] = details[pair[1]];
          });
          if ((!botConfig.initial_value || Number(botConfig.initial_value) === 0) && details.total_value) botConfig.initial_value = details.total_value;
        }
      }
      if (botConfig) {
        // O robô roda na sala de disputa do Comprasnet — o painel mostra o
        // portal real; a origem (PNCP) fica registrada na aba Detalhes.
        origPortal = botConfig.portal_name || '';
        botConfig.portal_name = 'Comprasnet';
      }
      idsRendered = false;   // força redesenho da identificação
      lastRowsKey = '';      // força redesenho da tabela com a config dos itens
      dirty = true;
      pushLog('success', 'Robô carregado: modo ' + (botConfig && botConfig.mode) + ' · ' + botItems.length + ' item(ns) configurado(s) · compra ' + compra + '.');
      if (!sessionLost && bindingConfirmed) setStatus(running ? 'Em Disputa' : 'Pronto');
      maybeAutoBid();
    });
  }
})();
