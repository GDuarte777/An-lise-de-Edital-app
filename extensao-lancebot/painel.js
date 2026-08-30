/**
 * Painel do operador: a única superfície do robô dentro da página da disputa.
 *
 * Três decisões que valem explicação:
 *
 *  1. Shadow DOM. O painel não pode herdar nem vazar CSS do portal, e — mais importante —
 *     os `input` e `button` dele NÃO podem ser confundidos com o campo e o botão de lance.
 *     O `conteudo.js` procura controles com `cartao.querySelector`, que não atravessa
 *     shadow root: dentro da sombra, o painel é invisível para o robô.
 *
 *  2. Fica pendurado em `documentElement`, não em `body`. O Angular troca a árvore inteira
 *     ao navegar entre telas da SPA; um intervalo curto reancora o painel se ele sumir.
 *
 *  3. Nada aqui decide lance. O painel só coleta configuração, valida e entrega ao
 *     `__lancebot.ligar`. Quem decide continua sendo a guarda de margem, sozinha.
 */
(() => {
  if (window.top !== window) return;          // só no quadro principal
  if (window.__lancebotPainel) return;

  const CHAVE = "lancebot.config";

  /* ------------------------------------------------------ leitura da entrada */

  /**
   * Entrada humana em real. "1.250,50", "1250,50", "1250.50" e "1.250" precisam todos
   * virar o número que o operador quis dizer — piso lido errado é prejuízo, então
   * formato que não dá para afirmar com certeza é recusado em vez de adivinhado.
   */
  function lerMoeda(txt) {
    const s = String(txt == null ? "" : txt).replace(/R\$/gi, "").replace(/[\s ]/g, "");
    if (!s) return null;
    if (!/^-?[\d.,]+$/.test(s)) return null;
    let n;
    if (s.indexOf(",") !== -1) n = Number(s.replace(/\./g, "").replace(",", "."));
    else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(s)) n = Number(s.replace(/\./g, ""));  // 1.250 = mil e duzentos e cinquenta
    else n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /** Valida o formulário inteiro antes de qualquer coisa ligar. */
  function validar(entrada) {
    const item = String(entrada.item == null ? "" : entrada.item).trim();
    if (!item) return { ok: false, erro: "Escolha o item da disputa." };

    const piso = lerMoeda(entrada.piso);
    if (piso === null) return { ok: false, erro: "Piso inválido. Use algo como 1.250,00." };
    if (piso < 0) return { ok: false, erro: "O piso não pode ser negativo." };

    const decremento = lerMoeda(entrada.decremento);
    if (decremento === null) return { ok: false, erro: "Decremento inválido." };
    if (decremento <= 0) return { ok: false, erro: "O decremento precisa ser maior que zero." };

    const tipo = entrada.tipo === "percentual" ? "percentual" : "fixo";
    if (tipo === "percentual" && decremento >= 100) {
      return { ok: false, erro: "Decremento percentual precisa ser menor que 100%." };
    }

    return { ok: true, item, cfg: { piso, decremento, tipo } };
  }

  const real = (n) =>
    typeof n === "number" && Number.isFinite(n)
      ? "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "—";

  /* ------------------------------------------------------------- construção */

  const CSS = `
  :host { all: initial; }
  .caixa {
    position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
    width: 320px; background: #12161f; color: #e8ecf4; border: 1px solid #2b3444;
    border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.45);
    font: 13px/1.45 system-ui, "Segoe UI", Roboto, sans-serif;
  }
  .topo { display: flex; align-items: center; gap: 8px; padding: 9px 11px;
          border-bottom: 1px solid #2b3444; cursor: move; user-select: none; }
  .marca { font-weight: 600; letter-spacing: .2px; flex: 1; }
  .pino { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; flex: none; }
  .pino.on { background: #22c55e; box-shadow: 0 0 8px #22c55e; }
  .pino.alerta { background: #f59e0b; }
  .encolher { background: none; border: none; color: #8b94a6; cursor: pointer;
              font-size: 16px; line-height: 1; padding: 0 2px; }
  .corpo { padding: 11px; display: grid; gap: 9px; }
  .caixa.min .corpo, .caixa.min .rodape { display: none; }
  label { display: grid; gap: 3px; font-size: 11px; color: #9aa4b6; text-transform: uppercase;
          letter-spacing: .4px; }
  input, select { font: inherit; background: #0b0e14; color: #e8ecf4;
                  border: 1px solid #2b3444; border-radius: 6px; padding: 6px 8px; width: 100%;
                  box-sizing: border-box; }
  input:focus, select:focus { outline: 2px solid #3b82f6; outline-offset: -1px; }
  .dupla { display: grid; grid-template-columns: 1fr 108px; gap: 8px; }
  .painelEstado { background: #0b0e14; border: 1px solid #222a38; border-radius: 6px;
                  padding: 7px 9px; display: grid; gap: 3px; font-size: 12px; }
  .linha { display: flex; justify-content: space-between; gap: 8px; }
  .linha b { font-weight: 600; }
  .fraco { color: #8b94a6; }
  .acao { font: 600 13px/1 system-ui, sans-serif; border: none; border-radius: 7px;
          padding: 10px; cursor: pointer; background: #1d4ed8; color: #fff; }
  .acao:hover { background: #2563eb; }
  .acao.parar { background: #b91c1c; }
  .acao.parar:hover { background: #dc2626; }
  .erro { color: #fca5a5; font-size: 12px; min-height: 1em; }
  .rodape { border-top: 1px solid #2b3444; max-height: 148px; overflow-y: auto; padding: 7px 11px; }
  .ev { display: grid; grid-template-columns: 48px 1fr; gap: 7px; padding: 2px 0;
        font-size: 11.5px; border-bottom: 1px solid #1a2230; }
  .ev time { color: #6b7280; font-variant-numeric: tabular-nums; }
  .ev.sucesso span { color: #86efac; }
  .ev.alerta span { color: #fcd34d; }
  .ev.concorrente span { color: #93c5fd; }
  .ev.sistema span { color: #9aa4b6; }
  `;

  const HTML = `
  <div class="caixa" part="caixa">
    <div class="topo" id="topo">
      <i class="pino" id="pino"></i>
      <span class="marca">HORASIS LanceBot</span>
      <button class="encolher" id="encolher" title="Encolher">–</button>
    </div>
    <div class="corpo">
      <label>Item da disputa
        <select id="item"></select>
      </label>
      <label>Piso — nunca ofertar abaixo disto
        <input id="piso" type="text" inputmode="decimal" placeholder="1.250,00" autocomplete="off">
      </label>
      <div class="dupla">
        <label>Decremento
          <input id="decremento" type="text" inputmode="decimal" placeholder="0,50" autocomplete="off">
        </label>
        <label>Tipo
          <select id="tipo"><option value="fixo">R$</option><option value="percentual">%</option></select>
        </label>
      </div>
      <div class="painelEstado">
        <div class="linha"><span class="fraco">Melhor lance</span><b id="eMelhor">—</b></div>
        <div class="linha"><span class="fraco">Seu lance</span><b id="eMeu">—</b></div>
        <div class="linha"><span class="fraco">Situação</span><b id="eFase">—</b></div>
        <div class="linha"><span class="fraco">Próximo lance</span><b id="ePrevisto">—</b></div>
      </div>
      <div class="erro" id="erro"></div>
      <button class="acao" id="acao">Ligar robô</button>
    </div>
    <div class="rodape" id="log"></div>
  </div>`;

  const hosp = document.createElement("div");
  hosp.id = "horasis-lancebot-painel";
  hosp.style.cssText = "all:initial;position:static";
  const raiz = hosp.attachShadow({ mode: "open" });
  const estilo = document.createElement("style");
  estilo.textContent = CSS;
  raiz.appendChild(estilo);
  const suporte = document.createElement("div");
  suporte.innerHTML = HTML;
  raiz.appendChild(suporte);

  const $ = (id) => raiz.getElementById(id);
  const caixa = raiz.querySelector(".caixa");

  /* --------------------------------------------------------------- ligação */

  const bot = () => window.__lancebot || null;

  function itensNaTela() {
    const b = bot();
    if (!b) return [];
    try { return b.cartoes().map(b.lerCartao); } catch (e) { return []; }
  }

  function sincronizarItens() {
    const sel = $("item");
    const atual = sel.value;
    const itens = itensNaTela();
    const chave = itens.map((i) => i.numero + ":" + (i.aberto ? "a" : "f")).join("|");
    if (sel.dataset.chave === chave) return itens;
    sel.dataset.chave = chave;
    sel.innerHTML = "";
    if (!itens.length) {
      const o = document.createElement("option");
      o.value = ""; o.textContent = "Nenhum item na tela";
      sel.appendChild(o);
      return itens;
    }
    itens.forEach((i) => {
      const o = document.createElement("option");
      o.value = i.numero;
      o.textContent = `Item ${i.numero} — ${i.aberto ? "em disputa" : "fechado"}`;
      sel.appendChild(o);
    });
    if (atual && itens.some((i) => i.numero === atual)) sel.value = atual;
    return itens;
  }

  const entradaAtual = () => ({
    item: $("item").value,
    piso: $("piso").value,
    decremento: $("decremento").value,
    tipo: $("tipo").value
  });

  function guardar() {
    try { chrome.storage.local.set({ [CHAVE]: entradaAtual() }); } catch (e) { /* fora da extensão */ }
  }

  function previsao(itens) {
    const v = validar(entradaAtual());
    if (!v.ok) return { texto: "—", aviso: "" };
    const item = itens.find((i) => i.numero === v.item);
    if (!item) return { texto: "—", aviso: "" };
    try {
      const d = window.__lancebotMargem.decidir(v.cfg, item, Date.now());
      if (d.acao === "enviar") return { texto: real(d.valor), aviso: "" };
      return { texto: "—", aviso: d.motivo || "" };
    } catch (e) {
      return { texto: "—", aviso: e.message };
    }
  }

  function pintar() {
    const b = bot();
    const itens = sincronizarItens();
    const ligado = Boolean(b && b.estado.ligado);
    const item = itens.find((i) => i.numero === $("item").value) || null;

    $("eMelhor").textContent = item ? real(item.melhorValor) : "—";
    $("eMeu").textContent = item ? real(item.meuValor) : "—";
    $("eFase").textContent = item ? (item.fase || "—").slice(0, 34) : "—";

    const p = previsao(itens);
    $("ePrevisto").textContent = p.texto;
    if (!ligado) $("erro").textContent = p.aviso;

    $("acao").textContent = ligado ? "Parar robô" : "Ligar robô";
    $("acao").classList.toggle("parar", ligado);
    ["item", "piso", "decremento", "tipo"].forEach((id) => ($(id).disabled = ligado));

    const pino = $("pino");
    pino.classList.toggle("on", ligado);
    pino.classList.toggle("alerta", Boolean(b && b.conexaoCaiu && b.conexaoCaiu()));
  }

  function anotar(nivel, msg) {
    const linha = document.createElement("div");
    linha.className = "ev " + nivel;
    const t = document.createElement("time");
    t.textContent = new Date().toLocaleTimeString("pt-BR", { hour12: false }).slice(0, 5);
    const s = document.createElement("span");
    s.textContent = msg;                       // textContent: nunca interpretar texto do portal como HTML
    linha.appendChild(t); linha.appendChild(s);
    const log = $("log");
    log.insertBefore(linha, log.firstChild);
    while (log.childNodes.length > 60) log.removeChild(log.lastChild);
    if (nivel === "alerta" || nivel === "sucesso") pintar();
  }

  $("acao").addEventListener("click", () => {
    const b = bot();
    if (!b) { $("erro").textContent = "O robô não carregou nesta página."; return; }

    if (b.estado.ligado) { b.parar("Parado pelo operador no painel."); pintar(); return; }

    const v = validar(entradaAtual());
    if (!v.ok) { $("erro").textContent = v.erro; return; }
    $("erro").textContent = "";
    guardar();
    b.ligar(v.item, v.cfg);
    pintar();
  });

  ["piso", "decremento", "tipo", "item"].forEach((id) => {
    $(id).addEventListener("change", () => { guardar(); pintar(); });
    $(id).addEventListener("input", pintar);
  });

  $("encolher").addEventListener("click", () => {
    const min = caixa.classList.toggle("min");
    $("encolher").textContent = min ? "+" : "–";
  });

  // Arrastar pelo cabeçalho: a disputa acontece embaixo do painel, e o operador precisa
  // poder tirá-lo da frente sem desligar nada.
  (() => {
    let solto = null;
    $("topo").addEventListener("mousedown", (ev) => {
      if (ev.target.id === "encolher") return;
      const r = caixa.getBoundingClientRect();
      solto = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      ev.preventDefault();
    });
    window.addEventListener("mousemove", (ev) => {
      if (!solto) return;
      caixa.style.left = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - solto.x)) + "px";
      caixa.style.top = Math.max(0, Math.min(window.innerHeight - 30, ev.clientY - solto.y)) + "px";
      caixa.style.right = "auto"; caixa.style.bottom = "auto";
    });
    window.addEventListener("mouseup", () => (solto = null));
  })();

  /* ----------------------------------------------------------- ancoragem */

  const ancorar = () => {
    if (!hosp.isConnected) document.documentElement.appendChild(hosp);
  };
  ancorar();
  setInterval(() => { ancorar(); pintar(); }, 1000);

  try {
    chrome.storage.local.get(CHAVE, (r) => {
      const c = r && r[CHAVE];
      if (!c) return;
      if (c.piso != null) $("piso").value = c.piso;
      if (c.decremento != null) $("decremento").value = c.decremento;
      if (c.tipo) $("tipo").value = c.tipo;
      pintar();
    });
  } catch (e) { /* fora da extensão (teste) */ }

  const b0 = bot();
  if (b0) {
    b0.estado.aoLog = anotar;
    (b0.estado.log || []).slice(-20).forEach((l) => anotar(l.nivel, l.msg));
  }
  pintar();

  window.__lancebotPainel = { lerMoeda, validar, pintar, anotar, raiz, hosp, entradaAtual };
})();
