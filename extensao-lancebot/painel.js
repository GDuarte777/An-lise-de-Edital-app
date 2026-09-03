/**
 * Painel do operador, dentro da sala de disputa.
 *
 * Este é o produto: o operador entra no Compras.gov.br como sempre entra, abre a
 * disputa, e o painel aparece já sabendo qual disputa é e quais itens estão abertos.
 * Ele configura piso e decremento por item e liga. Não há login a fazer aqui, nem
 * sessão a verificar — a sessão é a do próprio navegador dele, na página de verdade.
 *
 * Três decisões que valem explicação:
 *
 *  1. Shadow DOM. Os `input` e `button` do painel NÃO podem ser confundidos com o campo
 *     e o botão de lance do item: o robô procura controles com `querySelector` dentro do
 *     bloco do item, e isso não atravessa shadow root. Há teste travando isso.
 *  2. Fica pendurado em `documentElement`, não em `body`: o Angular troca a árvore do
 *     body ao navegar entre telas da SPA.
 *  3. Nada aqui decide lance. O painel coleta configuração, valida e entrega. Quem
 *     decide continua sendo a guarda de margem, sozinha.
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
    const s = String(txt == null ? "" : txt).replace(/R\$/gi, "").replace(/[\s ]/g, "");
    if (!s) return null;
    if (!/^-?[\d.,]+$/.test(s)) return null;
    let n;
    if (s.indexOf(",") !== -1) n = Number(s.replace(/\./g, "").replace(",", "."));
    else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(s)) n = Number(s.replace(/\./g, ""));  // 1.250 = mil duzentos e cinquenta
    else n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function validar(entrada) {
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
    return { ok: true, cfg: { piso, decremento, tipo } };
  }

  const real = (n) =>
    typeof n === "number" && Number.isFinite(n)
      ? "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "—";

  /* --------------------------------------------------------------- estilo */

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .caixa {
    position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
    width: 380px; max-height: calc(100vh - 32px); display: flex; flex-direction: column;
    background: #0f1420; color: #e8ecf4; border: 1px solid #26304a; border-radius: 12px;
    box-shadow: 0 16px 48px rgba(0,0,0,.5);
    font: 13px/1.45 system-ui, "Segoe UI", Roboto, sans-serif;
  }
  .topo { display: flex; align-items: center; gap: 9px; padding: 10px 12px;
          border-bottom: 1px solid #26304a; cursor: move; user-select: none; flex: none; }
  .marca { font-weight: 700; letter-spacing: .3px; font-size: 13px; }
  .marca span { color: #6ea8ff; }
  .cresce { flex: 1; }
  .pino { width: 9px; height: 9px; border-radius: 50%; background: #6b7280; flex: none; }
  .pino.on { background: #22c55e; box-shadow: 0 0 9px #22c55e; }
  .pino.alerta { background: #f59e0b; box-shadow: 0 0 9px #f59e0b; }
  .icone { background: none; border: none; color: #8b94a6; cursor: pointer;
           font-size: 17px; line-height: 1; padding: 0 3px; }
  .icone:hover { color: #e8ecf4; }

  .disputa { padding: 9px 12px; border-bottom: 1px solid #1c2436; background: #0b0f18; flex: none; }
  .disputa .nome { font-weight: 600; font-size: 12.5px; }
  .disputa .org { color: #8b94a6; font-size: 11.5px; margin-top: 2px; }
  .disputa .barra { display: flex; gap: 12px; margin-top: 6px; font-size: 11.5px; align-items: center; }
  .relogio { font-variant-numeric: tabular-nums; font-weight: 700; color: #fcd34d; }
  .aviso { color: #fca5a5; }

  .corpo { overflow-y: auto; padding: 10px 12px; display: grid; gap: 10px; }
  .caixa.min .corpo, .caixa.min .rodape, .caixa.min .disputa { display: none; }

  .item { border: 1px solid #26304a; border-radius: 9px; background: #131a29; }
  .item.armado { border-color: #22c55e; box-shadow: 0 0 0 1px #22c55e33 inset; }
  .item.fechado { opacity: .55; }
  .itemTopo { display: flex; align-items: center; gap: 8px; padding: 8px 10px;
              border-bottom: 1px solid #1c2436; }
  .num { font-weight: 700; }
  .tag { font-size: 10.5px; text-transform: uppercase; letter-spacing: .5px;
         padding: 2px 7px; border-radius: 20px; background: #1c2436; color: #9aa4b6; }
  .tag.aberto { background: #14351f; color: #86efac; }
  .valores { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 10px; padding: 8px 10px;
             font-size: 12px; }
  .valores div { display: flex; justify-content: space-between; gap: 8px; }
  .valores span { color: #8b94a6; }
  .valores b { font-variant-numeric: tabular-nums; }
  .liderando b { color: #86efac; }
  .conf { display: grid; grid-template-columns: 1fr 84px 58px; gap: 7px; padding: 0 10px 9px; }
  label { display: grid; gap: 3px; font-size: 10px; color: #8b94a6; text-transform: uppercase;
          letter-spacing: .4px; }
  input, select { font: inherit; font-size: 12.5px; background: #080b12; color: #e8ecf4;
                  border: 1px solid #26304a; border-radius: 6px; padding: 6px 7px; width: 100%; }
  input:focus, select:focus { outline: 2px solid #3b82f6; outline-offset: -1px; }
  input:disabled, select:disabled { opacity: .6; }
  .previsto { padding: 0 10px 9px; font-size: 11.5px; color: #8b94a6; }
  .previsto b { color: #e8ecf4; }
  .erroItem { padding: 0 10px 9px; font-size: 11.5px; color: #fca5a5; }
  .acaoItem { margin: 0 10px 10px; width: calc(100% - 20px); font: 600 12.5px system-ui, sans-serif;
              border: none; border-radius: 7px; padding: 9px; cursor: pointer;
              background: #1d4ed8; color: #fff; }
  .acaoItem:hover { background: #2563eb; }
  .acaoItem.parar { background: #b91c1c; }
  .acaoItem.parar:hover { background: #dc2626; }
  .acaoItem:disabled { background: #26304a; color: #6b7280; cursor: not-allowed; }

  .vazio { text-align: center; color: #8b94a6; font-size: 12px; padding: 22px 10px; }
  .vazio b { color: #e8ecf4; display: block; margin-bottom: 5px; font-size: 13px; }

  .rodape { border-top: 1px solid #26304a; max-height: 150px; overflow-y: auto;
            padding: 7px 12px; flex: none; }
  .ev { display: grid; grid-template-columns: 42px 1fr; gap: 8px; padding: 3px 0;
        font-size: 11.5px; border-bottom: 1px solid #161d2c; }
  .ev time { color: #6b7280; font-variant-numeric: tabular-nums; }
  .ev.sucesso span { color: #86efac; }
  .ev.alerta span { color: #fcd34d; }
  .ev.concorrente span { color: #93c5fd; }
  .ev.sistema span { color: #9aa4b6; }
  `;

  /* ---------------------------------------------------------- construção */

  const hosp = document.createElement("div");
  hosp.id = "horasis-lancebot-painel";
  hosp.style.cssText = "all:initial;position:static";
  const raiz = hosp.attachShadow({ mode: "open" });
  const estilo = document.createElement("style");
  estilo.textContent = CSS;
  raiz.appendChild(estilo);

  const caixa = document.createElement("div");
  caixa.className = "caixa";
  caixa.innerHTML = `
    <div class="topo" id="topo">
      <i class="pino" id="pino"></i>
      <span class="marca">HORASIS <span>LanceBot</span></span>
      <span class="cresce"></span>
      <button class="icone" id="encolher" title="Encolher">–</button>
    </div>
    <div class="disputa" id="disputa"></div>
    <div class="corpo" id="corpo"></div>
    <div class="rodape" id="log"></div>`;
  raiz.appendChild(caixa);

  const $ = (id) => raiz.getElementById(id);
  const bot = () => window.__lancebot || null;

  /* ------------------------------------------------- estado do formulário */

  // Guardado por item, para o operador não perder o que digitou quando a tela redesenha.
  const rascunho = {};
  const erroDe = {};

  function entradaDoItem(numero) {
    const r = rascunho[numero] || {};
    return { piso: r.piso ?? "", decremento: r.decremento ?? "1,00", tipo: r.tipo ?? "fixo" };
  }

  function guardar() {
    try { chrome.storage.local.set({ [CHAVE]: rascunho }); } catch (e) { /* fora da extensão */ }
  }

  /* ----------------------------------------------------------- desenho */

  function desenharDisputa() {
    const b = bot();
    const alvo = $("disputa");
    if (!b) { alvo.innerHTML = ""; return; }

    const d = b.identificarDisputa();
    const partes = [];
    partes.push(`<div class="nome"></div>`);
    if (d.uasg || d.orgao) partes.push(`<div class="org"></div>`);
    partes.push(`<div class="barra">
      ${d.tempoRestante ? `<span>Tempo restante <b class="relogio"></b></span>` : ""}
      ${d.conexaoCaiu ? `<span class="aviso">⚠ o portal pediu recarga da página</span>` : ""}
    </div>`);
    alvo.innerHTML = partes.join("");

    // textContent: nada vindo do portal é interpretado como HTML.
    alvo.querySelector(".nome").textContent = d.titulo;
    const org = alvo.querySelector(".org");
    if (org) org.textContent = [d.uasg ? "UASG " + d.uasg : "", d.orgao].filter(Boolean).join(" · ");
    const rel = alvo.querySelector(".relogio");
    if (rel) rel.textContent = d.tempoRestante;
  }

  function cartaoDoItem(item, armado) {
    const el = document.createElement("div");
    el.className = "item" + (armado ? " armado" : "") + (item.aberto ? "" : " fechado");
    const ent = entradaDoItem(item.numero);
    const lidera = typeof item.meuValor === "number" && typeof item.melhorValor === "number" &&
                   item.meuValor <= item.melhorValor;

    el.innerHTML = `
      <div class="itemTopo">
        <span class="num">Item ${item.numero}</span>
        <span class="tag ${item.aberto ? "aberto" : ""}">${item.aberto ? "em disputa" : "fechado"}</span>
      </div>
      <div class="valores">
        <div><span>Melhor</span><b>${real(item.melhorValor)}</b></div>
        <div class="${lidera ? "liderando" : ""}"><span>Seu lance</span><b>${real(item.meuValor)}</b></div>
      </div>
      <div class="conf">
        <label>Piso (R$)<input data-c="piso" type="text" inputmode="decimal" placeholder="1.250,00" autocomplete="off"></label>
        <label>Decremento<input data-c="decremento" type="text" inputmode="decimal" autocomplete="off"></label>
        <label>Tipo<select data-c="tipo"><option value="fixo">R$</option><option value="percentual">%</option></select></label>
      </div>
      <div class="previsto"></div>
      <div class="erroItem"></div>
      <button class="acaoItem"></button>`;

    const campos = el.querySelectorAll("[data-c]");
    campos.forEach((c) => {
      c.value = ent[c.dataset.c];
      c.disabled = armado;
      c.addEventListener("input", () => {
        rascunho[item.numero] = { ...entradaDoItem(item.numero), [c.dataset.c]: c.value };
        erroDe[item.numero] = "";
        pintar();
      });
      c.addEventListener("change", guardar);
    });

    // Quanto sairia AGORA, pela mesma guarda de margem que decide de verdade. Ver o
    // número antes de ligar é a diferença entre configurar e apostar.
    const prev = el.querySelector(".previsto");
    const v = validar(ent);
    if (!v.ok) prev.textContent = "";
    else {
      try {
        const d = window.__lancebotMargem.decidir(v.cfg, item, Date.now());
        prev.innerHTML = d.acao === "enviar"
          ? `Próximo lance <b>${real(d.valor)}</b>`
          : `<span>${d.motivo || "sem lance a dar agora"}</span>`;
      } catch (e) { prev.textContent = ""; }
    }
    el.querySelector(".erroItem").textContent = erroDe[item.numero] || "";

    const acao = el.querySelector(".acaoItem");
    acao.textContent = armado ? "Parar item " + item.numero : "Ligar neste item";
    acao.classList.toggle("parar", armado);
    acao.disabled = !armado && !item.aberto;
    acao.addEventListener("click", () => {
      const b = bot();
      if (!b) return;
      if (armado) { b.desarmar(item.numero, "parado pelo operador."); pintar(); return; }
      const r = validar(entradaDoItem(item.numero));
      if (!r.ok) { erroDe[item.numero] = r.erro; pintar(); return; }
      erroDe[item.numero] = "";
      guardar();
      b.armar(item.numero, r.cfg);
      pintar();
    });

    return el;
  }

  function pintar() {
    const b = bot();
    desenharDisputa();

    const corpo = $("corpo");
    const itens = b ? b.cartoes().map(b.lerCartao) : [];
    const armados = b ? b.itensArmados() : [];

    corpo.innerHTML = "";
    if (!itens.length) {
      const v = document.createElement("div");
      v.className = "vazio";
      v.innerHTML = "<b>Nenhum item de disputa nesta tela</b>" +
        "Abra a sala da disputa (a tela com o campo de lance) que os itens aparecem aqui.";
      corpo.appendChild(v);
    } else {
      itens.forEach((i) => corpo.appendChild(cartaoDoItem(i, armados.indexOf(i.numero) !== -1)));
    }

    const pino = $("pino");
    pino.classList.toggle("on", armados.length > 0);
    pino.classList.toggle("alerta", Boolean(b && b.conexaoCaiu()));
  }

  function anotar(nivel, msg) {
    const linha = document.createElement("div");
    linha.className = "ev " + nivel;
    const t = document.createElement("time");
    t.textContent = new Date().toLocaleTimeString("pt-BR", { hour12: false }).slice(0, 5);
    const s = document.createElement("span");
    s.textContent = msg;                       // nunca interpretar texto do portal como HTML
    linha.appendChild(t); linha.appendChild(s);
    const log = $("log");
    log.insertBefore(linha, log.firstChild);
    while (log.childNodes.length > 80) log.removeChild(log.lastChild);
    if (nivel === "alerta" || nivel === "sucesso") pintar();
  }

  /* --------------------------------------------------------- interação */

  $("encolher").addEventListener("click", () => {
    const min = caixa.classList.toggle("min");
    $("encolher").textContent = min ? "+" : "–";
  });

  // A disputa acontece embaixo do painel: o operador precisa poder tirá-lo da frente
  // sem desligar nada.
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
      caixa.style.left = Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - solto.x)) + "px";
      caixa.style.top = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - solto.y)) + "px";
      caixa.style.right = "auto"; caixa.style.bottom = "auto";
    });
    window.addEventListener("mouseup", () => (solto = null));
  })();

  const ancorar = () => { if (!hosp.isConnected) document.documentElement.appendChild(hosp); };
  ancorar();
  setInterval(() => { ancorar(); pintar(); }, 1000);

  try {
    chrome.storage.local.get(CHAVE, (r) => {
      const c = r && r[CHAVE];
      if (c && typeof c === "object") Object.assign(rascunho, c);
      pintar();
    });
  } catch (e) { /* fora da extensão (teste) */ }

  const b0 = bot();
  if (b0) {
    b0.estado.aoLog = anotar;
    (b0.estado.log || []).slice(-20).forEach((l) => anotar(l.nivel, l.msg));
  }
  pintar();

  window.__lancebotPainel = { lerMoeda, validar, pintar, anotar, raiz, hosp, rascunho, entradaDoItem };
})();
