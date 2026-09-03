/**
 * Painel do operador — a interface do robô, dentro da sala de disputa.
 *
 * O operador entra no Compras.gov.br como sempre, abre a disputa, e o painel aparece já
 * sabendo qual disputa é, quais itens estão em cada fase, quanto tempo falta e o que se
 * fala no chat. Configura e liga. Não há login do gov.br a fazer aqui, nem sessão a
 * verificar: a sessão é a do próprio navegador dele, na página de verdade.
 *
 * Decisões que valem explicação:
 *
 *  1. Shadow DOM. Os `input` e `button` do painel NÃO podem ser confundidos com o campo e
 *     o botão de lance do item — o robô procura controles com `querySelector` dentro do
 *     bloco do item, e isso não atravessa shadow root. Há teste travando exatamente isso.
 *  2. Fica pendurado em `documentElement`, não em `body`: o Angular troca a árvore do
 *     body ao navegar entre telas da SPA.
 *  3. Nada aqui decide lance. O painel coleta configuração, valida e entrega. Quem decide
 *     é a guarda de margem, sozinha.
 *  4. Tudo que vem do portal entra por `textContent`, nunca por `innerHTML`.
 */
(() => {
  if (window.top !== window) return;          // só no quadro principal
  if (window.__lancebotPainel) return;

  const CHAVE = "lancebot.config";
  const bot = () => window.__lancebot || null;
  const auth = () => window.__horasisAuth || null;

  /* ------------------------------------------------------ leitura da entrada */

  /**
   * Entrada humana em real. "1.250,50", "1250,50", "1250.50" e "1.250" precisam todos
   * virar o número que o operador quis dizer — mínimo lido errado é prejuízo, então
   * formato que não dá para afirmar com certeza é recusado em vez de adivinhado.
   */
  function lerMoeda(txt) {
    const s = String(txt == null ? "" : txt).replace(/R\$/gi, "").replace(/[\s ]/g, "");
    if (!s) return null;
    if (!/^-?[\d.,]+$/.test(s)) return null;
    let n;
    if (s.indexOf(",") !== -1) n = Number(s.replace(/\./g, "").replace(",", "."));
    else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(s)) n = Number(s.replace(/\./g, ""));
    else n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function validar(entrada) {
    const piso = lerMoeda(entrada.piso);
    if (piso === null) return { ok: false, erro: "Lance mínimo inválido. Use algo como 1.250,00." };
    if (piso < 0) return { ok: false, erro: "O lance mínimo não pode ser negativo." };

    const decremento = lerMoeda(entrada.decremento);
    if (decremento === null) return { ok: false, erro: "Intervalo mínimo inválido." };
    if (decremento <= 0) return { ok: false, erro: "O intervalo mínimo precisa ser maior que zero." };

    const tipo = entrada.tipo === "percentual" ? "percentual" : "fixo";
    if (tipo === "percentual" && decremento >= 100) {
      return { ok: false, erro: "Intervalo percentual precisa ser menor que 100%." };
    }

    let segundosFinais = null;
    if (entrada.soNoFinal) {
      segundosFinais = Number(String(entrada.segundos || "").replace(/\D/g, ""));
      if (!Number.isFinite(segundosFinais) || segundosFinais <= 0) {
        return { ok: false, erro: "Informe quantos segundos finais (ex.: 10)." };
      }
      if (segundosFinais > 600) return { ok: false, erro: "Use no máximo 600 segundos finais." };
    }

    return { ok: true, cfg: { piso, decremento, tipo, decimais: Boolean(entrada.decimais), segundosFinais } };
  }

  const real = (n, casas) =>
    typeof n === "number" && Number.isFinite(n)
      ? "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: casas || 2, maximumFractionDigits: casas || 2 })
      : "—";

  /* --------------------------------------------------------------- estilo */

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .caixa {
    position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
    width: 396px; max-height: calc(100vh - 36px); display: flex; flex-direction: column;
    background: #0b0f17; color: #eef2f9;
    border: 1px solid rgba(255,255,255,.09); border-radius: 16px;
    box-shadow: 0 24px 64px rgba(0,0,0,.6), 0 0 0 1px rgba(0,0,0,.4);
    font: 13px/1.5 ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
    overflow: hidden;
  }
  .topo { display: flex; align-items: center; gap: 10px; padding: 12px 14px; cursor: move;
          user-select: none; flex: none;
          background: linear-gradient(180deg, rgba(110,168,255,.09), transparent); }
  .marca { font-weight: 650; letter-spacing: -.2px; font-size: 13.5px; }
  .marca i { font-style: normal; color: #6ea8ff; }
  .cresce { flex: 1; }
  .pino { width: 8px; height: 8px; border-radius: 50%; background: #4b5563; flex: none;
          transition: background .2s, box-shadow .2s; }
  .pino.on { background: #34d399; box-shadow: 0 0 0 4px rgba(52,211,153,.16); }
  .pino.alerta { background: #fbbf24; box-shadow: 0 0 0 4px rgba(251,191,36,.16); }
  .icone { background: none; border: none; color: #7c8699; cursor: pointer; font-size: 16px;
           line-height: 1; padding: 2px 4px; border-radius: 5px; }
  .icone:hover { color: #eef2f9; background: rgba(255,255,255,.07); }

  .conta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #7c8699; }

  .disputa { padding: 0 14px 12px; flex: none; }
  .disputa .nome { font-weight: 600; font-size: 13px; letter-spacing: -.1px; }
  .disputa .org { color: #7c8699; font-size: 11.5px; margin-top: 3px; }
  .cronometro { display: flex; align-items: baseline; gap: 8px; margin-top: 9px; }
  .cronometro b { font: 700 22px/1 ui-monospace, "SF Mono", Menlo, monospace;
                  letter-spacing: -.5px; color: #fbbf24; font-variant-numeric: tabular-nums; }
  .cronometro.urgente b { color: #f87171; }
  .cronometro span { font-size: 10.5px; color: #7c8699; text-transform: uppercase; letter-spacing: .6px; }
  .queda { margin-top: 8px; font-size: 11.5px; color: #fca5a5;
           background: rgba(248,113,113,.09); border: 1px solid rgba(248,113,113,.2);
           border-radius: 8px; padding: 6px 9px; }

  .abas { display: flex; gap: 6px; padding: 0 14px 10px; flex: none; }
  .aba { flex: 1; border: 1px solid rgba(255,255,255,.08); background: transparent;
         color: #7c8699; border-radius: 9px; padding: 7px 4px; cursor: pointer;
         font: 600 10.5px ui-sans-serif, system-ui, sans-serif; letter-spacing: .2px; }
  .aba:hover { border-color: rgba(255,255,255,.18); color: #eef2f9; }
  .aba.ativa { background: #eef2f9; color: #0b0f17; border-color: #eef2f9; }
  .aba small { display: block; font-size: 13px; margin-top: 2px; }

  .corpo { overflow-y: auto; padding: 0 14px 14px; display: grid; gap: 10px; }
  .caixa.min .corpo, .caixa.min .rodape, .caixa.min .disputa, .caixa.min .abas { display: none; }

  .item { border: 1px solid rgba(255,255,255,.08); border-radius: 12px; background: #10151f; }
  .item.armado { border-color: rgba(52,211,153,.55); background: #0f1a17; }
  .itemTopo { display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px; }
  .num { font-weight: 650; font-size: 12.5px; }
  .selo { font-size: 9.5px; text-transform: uppercase; letter-spacing: .6px; padding: 3px 7px;
          border-radius: 20px; background: rgba(255,255,255,.06); color: #7c8699; }
  .selo.aberto { background: rgba(52,211,153,.14); color: #6ee7b7; }
  .valores { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 0 12px 10px; }
  .valores > div { background: #0b0f17; border-radius: 9px; padding: 7px 9px; }
  .valores span { display: block; font-size: 9.5px; color: #7c8699; text-transform: uppercase;
                  letter-spacing: .6px; }
  .valores b { font: 600 14px/1.3 ui-monospace, "SF Mono", Menlo, monospace;
               font-variant-numeric: tabular-nums; }
  .lidera b { color: #6ee7b7; }

  .conf { display: grid; grid-template-columns: 1fr 1fr 54px; gap: 8px; padding: 0 12px 9px; }
  label { display: grid; gap: 4px; font-size: 9.5px; color: #7c8699; text-transform: uppercase;
          letter-spacing: .6px; }
  input, select { font: inherit; font-size: 12.5px; background: #060910; color: #eef2f9;
                  border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 7px 8px;
                  width: 100%; }
  input:focus, select:focus { outline: none; border-color: #6ea8ff;
                              box-shadow: 0 0 0 3px rgba(110,168,255,.16); }
  input:disabled, select:disabled { opacity: .55; }

  .opcoes { padding: 0 12px 9px; display: grid; gap: 6px; }
  .op { display: flex; align-items: flex-start; gap: 8px; font-size: 11.5px; color: #c3cbd9;
        cursor: pointer; }
  .op input { width: 15px; height: 15px; margin: 1px 0 0; flex: none; accent-color: #6ea8ff; }
  .op em { font-style: normal; color: #7c8699; display: block; font-size: 10.5px; margin-top: 1px; }
  .op input[type="number"] { width: 52px; padding: 3px 5px; font-size: 11.5px; }

  .previsto { padding: 0 12px 9px; font-size: 11.5px; color: #7c8699; }
  .previsto b { color: #eef2f9; font-variant-numeric: tabular-nums; }
  .previsto .desempate { color: #fbbf24; }
  .erroItem { padding: 0 12px 9px; font-size: 11.5px; color: #fca5a5; }

  .linhaBotoes { display: flex; gap: 8px; padding: 0 12px 12px; }
  .acaoItem { flex: 1; font: 650 12.5px ui-sans-serif, system-ui, sans-serif; border: none;
              border-radius: 9px; padding: 10px; cursor: pointer; background: #2563eb; color: #fff; }
  .acaoItem:hover { background: #3b82f6; }
  .acaoItem.parar { background: #b91c1c; }
  .acaoItem.parar:hover { background: #dc2626; }
  .acaoItem:disabled { background: rgba(255,255,255,.06); color: #4b5563; cursor: not-allowed; }
  .secundario { border: 1px solid rgba(255,255,255,.12); background: transparent; color: #c3cbd9;
                border-radius: 9px; padding: 10px 12px; cursor: pointer; font: 600 12px sans-serif; }
  .secundario:hover { border-color: #6ea8ff; color: #eef2f9; }

  .rank { padding: 0 12px 11px; font-size: 11.5px; }
  .rank .pos { font: 700 15px ui-sans-serif, sans-serif; color: #6ea8ff; }
  .rank ol { margin: 6px 0 0; padding-left: 20px; color: #7c8699; }
  .rank li { font-variant-numeric: tabular-nums; padding: 1px 0; }
  .rank li.meu { color: #6ee7b7; font-weight: 600; }
  .rank .obs { color: #7c8699; font-size: 10.5px; margin-top: 5px; }

  .vazio { text-align: center; color: #7c8699; font-size: 12px; padding: 26px 12px;
           border: 1px dashed rgba(255,255,255,.1); border-radius: 12px; }
  .vazio b { color: #eef2f9; display: block; margin-bottom: 5px; font-size: 13px; }

  .chat { border-top: 1px solid rgba(255,255,255,.07); flex: none; }
  .chatTopo { display: flex; align-items: center; gap: 8px; padding: 9px 14px; cursor: pointer;
              font: 600 10.5px ui-sans-serif, sans-serif; text-transform: uppercase;
              letter-spacing: .6px; color: #7c8699; }
  .chatTopo:hover { color: #eef2f9; }
  .chatLista { max-height: 132px; overflow-y: auto; padding: 0 14px 10px; display: grid; gap: 7px; }
  .msg { background: #10151f; border-radius: 9px; padding: 7px 9px; font-size: 11.5px; }
  .msg .quem { font-size: 9.5px; color: #6ea8ff; text-transform: uppercase; letter-spacing: .5px; }
  .msg .qd { font-size: 9.5px; color: #4b5563; float: right; }

  .rodape { border-top: 1px solid rgba(255,255,255,.07); max-height: 130px; overflow-y: auto;
            padding: 8px 14px; flex: none; }
  .ev { display: grid; grid-template-columns: 38px 1fr; gap: 8px; padding: 3px 0; font-size: 11px; }
  .ev time { color: #4b5563; font-variant-numeric: tabular-nums; }
  .ev.sucesso span { color: #6ee7b7; }
  .ev.alerta span { color: #fbbf24; }
  .ev.concorrente span { color: #93c5fd; }
  .ev.sistema span { color: #7c8699; }

  .aprend { display: flex; align-items: center; gap: 8px; padding: 8px 14px;
            border-top: 1px solid rgba(255,255,255,.07); font-size: 10.5px; color: #4b5563; flex: none; }
  .linkzinho { background: none; border: none; color: #6ea8ff; cursor: pointer; font: inherit;
               text-decoration: underline; padding: 0; }
  .linkzinho:hover { color: #93c5fd; }

  .porta { padding: 22px 18px; display: grid; gap: 12px; }
  .porta h2 { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -.2px; }
  .porta p { margin: 0; font-size: 12px; color: #7c8699; }
  .porta .erro { font-size: 11.5px; color: #fca5a5; min-height: 1em; }
  .porta button { font: 650 13px ui-sans-serif, sans-serif; border: none; border-radius: 9px;
                  padding: 11px; cursor: pointer; background: #2563eb; color: #fff; }
  .porta button:hover { background: #3b82f6; }
  .porta button:disabled { background: rgba(255,255,255,.06); color: #4b5563; }
  `;

  /* ---------------------------------------------------------- estrutura */

  const hosp = document.createElement("div");
  hosp.id = "horasis-lancebot-painel";
  hosp.style.cssText = "all:initial;position:static";
  const raiz = hosp.attachShadow({ mode: "open" });
  const estilo = document.createElement("style");
  estilo.textContent = CSS;
  raiz.appendChild(estilo);

  const caixa = document.createElement("div");
  caixa.className = "caixa";
  raiz.appendChild(caixa);

  const $ = (id) => raiz.getElementById(id);

  /* ----------------------------------------------------- estado da tela */

  const rascunho = {};          // configuração por item, para não perder o digitado
  const erroDe = {};
  const rankDe = {};
  let abaAtiva = "aberto";
  let chatAberto = false;
  let sessao = null;
  let entrando = false;
  let erroLogin = "";

  const entradaDoItem = (n) => {
    const r = rascunho[n] || {};
    return {
      piso: r.piso ?? "", decremento: r.decremento ?? "0,01", tipo: r.tipo ?? "fixo",
      decimais: Boolean(r.decimais), soNoFinal: Boolean(r.soNoFinal), segundos: r.segundos ?? "10"
    };
  };
  const guardar = () => { try { chrome.storage.local.set({ [CHAVE]: rascunho }); } catch (e) { /* fora da extensão */ } };

  /* --------------------------------------------------------- a porta */

  function desenharPorta() {
    caixa.innerHTML = `
      <div class="topo" id="topo">
        <i class="pino"></i><span class="marca">HORASIS <i>LanceBot</i></span>
        <span class="cresce"></span>
      </div>
      <div class="porta">
        <h2>Entre com sua conta HORASIS</h2>
        <p>O robô é exclusivo para assinantes da plataforma. Use o mesmo e-mail e senha do site.</p>
        <label>E-mail<input id="email" type="email" autocomplete="username" placeholder="voce@empresa.com.br"></label>
        <label>Senha<input id="senha" type="password" autocomplete="current-password"></label>
        <div class="erro" id="erroLogin"></div>
        <button id="entrar">${entrando ? "Entrando…" : "Entrar"}</button>
      </div>`;
    $("erroLogin").textContent = erroLogin;
    $("entrar").disabled = entrando;

    const tentar = () => {
      const a = auth();
      if (!a || entrando) return;
      entrando = true; erroLogin = ""; desenharPorta();
      a.entrar($("email").value, $("senha").value).then((r) => {
        entrando = false;
        if (r.ok) { sessao = r.sessao; erroLogin = ""; pintar(); }
        else { erroLogin = r.erro; desenharPorta(); }
      });
    };
    $("entrar").addEventListener("click", tentar);
    $("senha").addEventListener("keydown", (e) => { if (e.key === "Enter") tentar(); });
    ligarArraste();
  }

  /* ------------------------------------------------------- o painel */

  function desenharMoldura() {
    caixa.innerHTML = `
      <div class="topo" id="topo">
        <i class="pino" id="pino"></i>
        <span class="marca">HORASIS <i>LanceBot</i></span>
        <span class="cresce"></span>
        <span class="conta" id="conta"></span>
        <button class="icone" id="sair" title="Sair da conta">⏻</button>
        <button class="icone" id="encolher" title="Encolher">–</button>
      </div>
      <div class="disputa" id="disputa"></div>
      <div class="abas" id="abas"></div>
      <div class="corpo" id="corpo"></div>
      <div class="chat" id="chat"></div>
      <div class="rodape" id="log"></div>
      <div class="aprend" id="aprend"></div>`;

    $("encolher").addEventListener("click", () => {
      const min = caixa.classList.toggle("min");
      $("encolher").textContent = min ? "+" : "–";
    });
    $("sair").addEventListener("click", () => {
      const a = auth();
      if (a) a.sair();
      sessao = null;
      desenharPorta();
    });
    ligarArraste();
  }

  function desenharDisputa(d) {
    const alvo = $("disputa");
    alvo.innerHTML = `
      <div class="nome"></div>
      <div class="org"></div>
      <div class="cronometro"><b></b><span>até o fim dos lances</span></div>
      <div class="queda" hidden>⚠ O portal pediu recarga da página — o robô recarrega sozinho.</div>`;
    alvo.querySelector(".nome").textContent = d.titulo;
    alvo.querySelector(".org").textContent =
      [d.uasg ? "UASG " + d.uasg : "", d.orgao].filter(Boolean).join(" · ");

    const cron = alvo.querySelector(".cronometro");
    cron.querySelector("b").textContent = d.tempoRestante || "--:--:--";
    cron.classList.toggle("urgente", typeof d.segundosRestantes === "number" && d.segundosRestantes <= 60);
    alvo.querySelector(".queda").hidden = !d.conexaoCaiu;
  }

  const NOME_ABA = { aguardando: "Aguardando", aberto: "Em disputa", encerrado: "Encerrados" };

  function desenharAbas(fases) {
    const alvo = $("abas");
    alvo.innerHTML = "";
    ["aguardando", "aberto", "encerrado"].forEach((k) => {
      const b = document.createElement("button");
      b.className = "aba" + (abaAtiva === k ? " ativa" : "");
      b.innerHTML = `${NOME_ABA[k]}<small>${fases[k] || 0}</small>`;
      b.addEventListener("click", () => { abaAtiva = k; pintar(); });
      alvo.appendChild(b);
    });
  }

  function cartaoDoItem(item, armado) {
    const el = document.createElement("div");
    el.className = "item" + (armado ? " armado" : "");
    const ent = entradaDoItem(item.numero);
    const lidera = typeof item.meuValor === "number" && typeof item.melhorValor === "number" &&
                   item.meuValor <= item.melhorValor;

    el.innerHTML = `
      <div class="itemTopo">
        <span class="num">Item ${item.numero}</span>
        <span class="selo ${item.situacao === "aberto" ? "aberto" : ""}">${
          item.situacao === "aberto" ? "em disputa" : item.situacao}</span>
      </div>
      <div class="valores">
        <div><span>Melhor lance</span><b class="mel"></b></div>
        <div class="${lidera ? "lidera" : ""}"><span>Meu lance</span><b class="meu"></b></div>
      </div>
      <div class="conf">
        <label>Lance mínimo (R$)<input data-c="piso" type="text" inputmode="decimal" placeholder="1.250,00" autocomplete="off"></label>
        <label>Intervalo mínimo<input data-c="decremento" type="text" inputmode="decimal" autocomplete="off"></label>
        <label>Tipo<select data-c="tipo"><option value="fixo">R$</option><option value="percentual">%</option></select></label>
      </div>
      <div class="opcoes">
        <label class="op"><input data-c="decimais" type="checkbox"><span>Permitir lances em casas decimais
          <em>Desempata quem ofertou o mesmo valor, indo R$ 0,0001 abaixo do seu mínimo.</em></span></label>
        <label class="op"><input data-c="soNoFinal" type="checkbox"><span>Disputar apenas nos segundos finais
          <em>Só oferta quando faltar <input data-c="segundos" type="number" min="1" max="600"> s ou menos.</em></span></label>
      </div>
      <div class="previsto"></div>
      <div class="erroItem"></div>
      <div class="rank"></div>
      <div class="linhaBotoes">
        <button class="acaoItem"></button>
        <button class="secundario">Classificação</button>
      </div>`;

    el.querySelector(".mel").textContent = real(item.melhorValor, ent.decimais ? 4 : 2);
    el.querySelector(".meu").textContent = real(item.meuValor, ent.decimais ? 4 : 2);

    el.querySelectorAll("[data-c]").forEach((c) => {
      const k = c.dataset.c;
      if (c.type === "checkbox") c.checked = Boolean(ent[k]); else c.value = ent[k];
      c.disabled = armado;
      const mudou = () => {
        rascunho[item.numero] = { ...entradaDoItem(item.numero),
          [k]: c.type === "checkbox" ? c.checked : c.value };
        erroDe[item.numero] = "";
        guardar(); pintar();
      };
      c.addEventListener(c.type === "checkbox" ? "change" : "input", mudou);
    });

    // Quanto sairia AGORA, pela mesma guarda de margem que decide de verdade. Ver o
    // número antes de ligar é a diferença entre configurar e apostar.
    const prev = el.querySelector(".previsto");
    const v = validar(ent);
    if (v.ok) {
      try {
        const d = window.__lancebotMargem.decidir(v.cfg, item, Date.now());
        if (d.acao === "enviar") {
          prev.innerHTML = `Próximo lance <b>${real(d.valor, d.desempate ? 4 : 2)}</b>` +
            (d.desempate ? ` <span class="desempate">· desempate</span>` : "");
        } else {
          prev.textContent = d.motivo || "sem lance a dar agora";
        }
      } catch (e) { prev.textContent = ""; }
    }
    el.querySelector(".erroItem").textContent = erroDe[item.numero] || "";

    const r = rankDe[item.numero];
    if (r) {
      const cx = el.querySelector(".rank");
      cx.innerHTML = `<div>Sua posição: <span class="pos"></span></div><ol></ol>
                      <div class="obs">Classificação por valor, montada com os lances e propostas
                      que o portal mostra nesta tela — não é a classificação oficial do pregoeiro.</div>`;
      cx.querySelector(".pos").textContent = r.posicao ? `${r.posicao}º de ${r.total}` : "sem lance seu ainda";
      const ol = cx.querySelector("ol");
      r.valores.slice(0, 8).forEach((val) => {
        const li = document.createElement("li");
        li.textContent = real(val, 4);
        if (r.meuValor !== null && Math.abs(val - r.meuValor) < 0.00005) li.className = "meu";
        ol.appendChild(li);
      });
    }

    const acao = el.querySelector(".acaoItem");
    acao.textContent = armado ? "Parar item " + item.numero : "Ligar neste item";
    acao.classList.toggle("parar", armado);
    acao.disabled = !armado && item.situacao !== "aberto";
    acao.addEventListener("click", () => {
      const b = bot();
      if (!b) return;
      if (armado) { b.desarmar(item.numero, "parado pelo operador."); pintar(); return; }
      const r2 = validar(entradaDoItem(item.numero));
      if (!r2.ok) { erroDe[item.numero] = r2.erro; pintar(); return; }
      erroDe[item.numero] = "";
      guardar();
      b.armar(item.numero, r2.cfg);
      pintar();
    });

    el.querySelector(".secundario").addEventListener("click", () => {
      const b = bot();
      if (!b) return;
      rankDe[item.numero] = b.classificacao(item.numero);
      pintar();
    });

    return el;
  }

  function desenharChat(msgs) {
    const alvo = $("chat");
    alvo.innerHTML = `<div class="chatTopo" id="chatTopo">
        <span>Chat da disputa</span><span class="cresce"></span><span>${msgs.length}</span>
        <span>${chatAberto ? "▾" : "▸"}</span></div>`;
    $("chatTopo").addEventListener("click", () => { chatAberto = !chatAberto; pintar(); });
    if (!chatAberto) return;

    const lista = document.createElement("div");
    lista.className = "chatLista";
    if (!msgs.length) {
      const v = document.createElement("div");
      v.className = "msg";
      v.textContent = "Nada capturado ainda. As mensagens aparecem aqui conforme o portal as carrega — " +
                      "abrir a aba de mensagens da compra uma vez costuma trazer o histórico.";
      lista.appendChild(v);
    }
    msgs.slice(-30).reverse().forEach((m) => {
      const d = document.createElement("div");
      d.className = "msg";
      const quem = document.createElement("div");
      quem.className = "quem";
      quem.textContent = m.autor || "portal";
      if (m.em) { const q = document.createElement("span"); q.className = "qd"; q.textContent = m.em; quem.appendChild(q); }
      const t = document.createElement("div");
      t.textContent = m.texto;                    // nunca innerHTML com texto do portal
      d.appendChild(quem); d.appendChild(t);
      lista.appendChild(d);
    });
    alvo.appendChild(lista);
  }

  /**
   * O gravador da disputa, e o botão de levar o material embora.
   *
   * Tudo fica na máquina do operador. Nada sai daqui sozinho — só quando ele exporta.
   */
  function desenharAprendizado() {
    const alvo = $("aprend");
    if (!alvo) return;
    const a = window.__lancebotAprendizado;
    if (!a) { alvo.innerHTML = ""; return; }
    alvo.innerHTML = `<span id="qtd"></span><span class="cresce"></span>
                      <button class="linkzinho" id="exportar">Exportar aprendizado</button>`;
    $("qtd").textContent = `${a.quantos()} eventos gravados nesta máquina`;
    $("exportar").addEventListener("click", () => {
      const b = bot();
      a.salvar();
      const n = a.exportar(b ? b.identificarDisputa() : null);
      anotar("sistema", `Aprendizado exportado: ${n} eventos.`);
    });
  }

  /* ------------------------------------------------------------ pintar */

  function pintar() {
    if (!sessao) { if (!raiz.getElementById("entrar")) desenharPorta(); return; }
    if (!raiz.getElementById("corpo")) desenharMoldura();

    const b = bot();
    const d = b ? b.identificarDisputa() : { titulo: "Disputa", fases: {}, tempoRestante: "" };
    $("conta").textContent = sessao.email || "";
    desenharDisputa(d);
    desenharAbas(d.fases || {});

    const itens = b ? b.cartoes().map(b.lerCartao) : [];
    const armados = b ? b.itensArmados() : [];
    const daAba = itens.filter((i) => i.situacao === abaAtiva);

    const corpo = $("corpo");
    corpo.innerHTML = "";
    if (!itens.length) {
      const v = document.createElement("div");
      v.className = "vazio";
      v.innerHTML = "<b>Nenhum item nesta tela</b>Abra a sala da disputa — a tela com o campo de lance.";
      corpo.appendChild(v);
    } else if (!daAba.length) {
      const v = document.createElement("div");
      v.className = "vazio";
      v.textContent = `Nenhum item ${NOME_ABA[abaAtiva].toLowerCase()} agora.`;
      corpo.appendChild(v);
    } else {
      daAba.forEach((i) => corpo.appendChild(cartaoDoItem(i, armados.indexOf(i.numero) !== -1)));
    }

    desenharChat(b ? b.chat() : []);
    desenharAprendizado();

    const pino = $("pino");
    pino.classList.toggle("on", armados.length > 0);
    pino.classList.toggle("alerta", Boolean(b && b.conexaoCaiu()));
  }

  function anotar(nivel, msg) {
    const log = raiz.getElementById("log");
    if (!log) return;
    const linha = document.createElement("div");
    linha.className = "ev " + nivel;
    const t = document.createElement("time");
    t.textContent = new Date().toLocaleTimeString("pt-BR", { hour12: false }).slice(0, 5);
    const s = document.createElement("span");
    s.textContent = msg;
    linha.appendChild(t); linha.appendChild(s);
    log.insertBefore(linha, log.firstChild);
    while (log.childNodes.length > 80) log.removeChild(log.lastChild);
  }

  /* --------------------------------------------------------- interação */

  function ligarArraste() {
    const topo = raiz.getElementById("topo");
    if (!topo) return;
    let solto = null;
    topo.addEventListener("mousedown", (ev) => {
      if (ev.target.classList && ev.target.classList.contains("icone")) return;
      const r = caixa.getBoundingClientRect();
      solto = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      ev.preventDefault();
      const mover = (e) => {
        if (!solto) return;
        caixa.style.left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - solto.x)) + "px";
        caixa.style.top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - solto.y)) + "px";
        caixa.style.right = "auto"; caixa.style.bottom = "auto";
      };
      const largar = () => {
        solto = null;
        window.removeEventListener("mousemove", mover);
        window.removeEventListener("mouseup", largar);
      };
      window.addEventListener("mousemove", mover);
      window.addEventListener("mouseup", largar);
    });
  }

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

  const a0 = auth();
  if (a0) a0.sessaoAtual().then((s) => { sessao = s; pintar(); });

  const b0 = bot();
  if (b0) {
    b0.estado.aoLog = anotar;
    (b0.estado.log || []).slice(-20).forEach((l) => anotar(l.nivel, l.msg));
  }
  desenharPorta();

  window.__lancebotPainel = {
    lerMoeda, validar, pintar, anotar, raiz, hosp, rascunho, entradaDoItem,
    abrir: (s) => { sessao = s || { email: "teste" }; pintar(); },
    get aba() { return abaAtiva; },
    set aba(v) { abaAtiva = v; pintar(); }
  };
})();
