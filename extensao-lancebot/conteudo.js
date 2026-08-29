/**
 * Robô de lances, rodando dentro da página da disputa.
 *
 * O desenho vem inteiro do que a coleta na tela real mostrou:
 *
 *  - a lista de itens é `app-disputa-fornecedor-itens`, e cada item é um `app-card-item`
 *    (cartões do PrimeNG, não tabela — por isso nada aqui procura <table>);
 *  - os ids `pn_id_###` mudam a cada carga da página e NÃO servem de âncora; os nomes de
 *    componente Angular são estáveis e é neles que o robô se apoia;
 *  - o portal empurra lance por WebSocket, então não há polling: a mensagem serve de
 *    gatilho para reler a tela;
 *  - quando a conexão cai, o portal mostra "Recarregar página" dentro de
 *    `app-situacao-conexao-sistema`. É isso que faz o operador ter que atualizar na mão.
 *    O robô detecta e recarrega sozinho.
 *
 * O campo e o botão de lance ainda não foram vistos numa disputa ao vivo. Em vez de
 * adivinhar, o robô procura dentro do cartão do item e **aprende** os seletores na
 * primeira disputa real, guardando para as próximas. Enquanto não achar, ele recusa
 * operar em vez de improvisar.
 */
(() => {
  if (window.__lancebot) return;

  const M = window.__lancebotMargem;
  const CHAVE = "lancebot.seletores";

  /* ------------------------------------------------------------ básico */

  const visivel = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };

  const habilitado = (el) =>
    el && !el.disabled && !el.readOnly && el.getAttribute("aria-disabled") !== "true";

  const texto = (el) => ((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim();

  /**
   * O portal trabalha com QUATRO casas decimais — a coleta mostrou
   * "Valor estimado (unitário) R$ #.###,####". Ler isso com duas casas transformaria
   * 1.234,5678 em 1234,56: erro de dinheiro silencioso, do tipo que só aparece no
   * extrato. Por isso 2 a 4 casas, e a alternativa com milhar vem primeiro para
   * "1250,50" não ser lido como "250,50".
   */
  function paraNumero(t) {
    const m = String(t == null ? "" : t)
      .match(/-?\d{1,3}(?:\.\d{3})+,\d{1,4}|-?\d+,\d{1,4}|-?\d{1,3}(?:,\d{3})+\.\d{1,4}|-?\d+\.\d{1,4}|-?\d+/);
    if (!m) return null;
    let s = m[0];
    s = /,\d{1,4}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /** Só valor com casa decimal conta como dinheiro — número de item não é preço. */
  function valoresEm(t) {
    const re = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{2,4}|\d+,\d{2,4})/g;
    const saida = [];
    let m;
    while ((m = re.exec(String(t))) !== null) {
      const n = paraNumero(m[1]);
      if (n !== null && n > 0) saida.push(n);
    }
    return saida;
  }

  /** Valor associado a um rótulo, procurando nas folhas do cartão. */
  function valorRotulado(raiz, re) {
    const folhas = Array.prototype.filter.call(raiz.querySelectorAll("*"), (n) => n.children.length === 0 && visivel(n));
    for (let i = 0; i < folhas.length; i++) {
      const t = texto(folhas[i]);
      if (!t || t.length > 80 || !re.test(t)) continue;
      const proprios = valoresEm(t);
      if (proprios.length) return proprios[0];
      for (let j = i + 1; j < Math.min(folhas.length, i + 5); j++) {
        const v = valoresEm(texto(folhas[j]));
        if (v.length) return v[0];
      }
    }
    return null;
  }

  /* ------------------------------------------------- itens da disputa */

  const RE_MELHOR = /melhor\s+valor|melhor\s+lance|menor\s+valor|menor\s+lance|valor\s+do\s+lance|valor\s+ofertado|lance\s+atual/i;
  const RE_MEU = /seu\s+lance|meu\s+lance|sua\s+oferta|seu\s+valor|minha\s+oferta/i;
  const RE_ABERTO = /em\s+disputa|aberto|recebendo|em\s+andamento/i;
  const RE_FECHADO = /encerrad|finalizad|suspens|cancelad|homologad|adjudicad|julgad|deserto|fracassad|aguardando/i;

  const cartoes = () =>
    Array.prototype.filter.call(document.querySelectorAll("app-card-item"), visivel);

  /**
   * Histórico de lances do item, no componente `app-todos-lances` — uma p-table com
   * "Data/hora registro | Valor do lance (unitário)". É a fonte mais confiável do melhor
   * lance vigente: são os lances de verdade, não um resumo. Fica fora do cartão (num
   * painel do item selecionado), por isso é lido à parte e só entra como reforço.
   */
  function melhorDoHistorico() {
    const painel = document.querySelector("app-todos-lances");
    if (!painel || !visivel(painel)) return null;
    const valores = valoresEm(texto(painel));
    return valores.length ? Math.min.apply(null, valores) : null;
  }

  function lerCartao(cartao) {
    const t = texto(cartao);
    const fase = texto(cartao.querySelector("app-identificacao-e-fase-item")) || t.slice(0, 120);
    const numero = (fase.match(/\b(\d{1,5})\b/) || [])[1] || (t.match(/\b(\d{1,5})\b/) || [])[1] || "";

    let melhor = valorRotulado(cartao, RE_MELHOR);
    if (melhor === null) melhor = melhorDoHistorico();
    if (melhor === null) {
      const todos = valoresEm(t);
      melhor = todos.length ? Math.min.apply(null, todos) : null;
    }

    const aberto = RE_ABERTO.test(fase) && !RE_FECHADO.test(fase);

    return {
      numero: String(numero),
      melhorValor: melhor,
      meuValor: valorRotulado(cartao, RE_MEU),
      aberto,
      fase,
      lidoEm: Date.now(),
      cartao
    };
  }

  const acharItem = (numero) =>
    cartoes().map(lerCartao).find((i) => !numero || i.numero === String(numero)) || null;

  /* -------------------------------------------- campo e botão do lance */

  const RE_CAMPO = /lance|valor|oferta/i;
  const RE_BOTAO = /enviar|ofertar|registrar|dar\s+lance|confirmar/i;
  const RE_BOTAO_NAO = /cancelar|fechar|voltar|limpar|detalhes|expandir|favorit|download|informa/i;

  const rotuloDe = (el) => [
    el.getAttribute("aria-label"), el.getAttribute("placeholder"),
    el.getAttribute("formcontrolname"), el.getAttribute("name"),
    texto(el.closest("label") || el.closest(".field") || el.parentElement)
  ].join(" ");

  function controles(cartao, aprendido) {
    // NUNCA sair do cartão do item. O `document.querySelector` que estava aqui como
    // reserva fazia o seletor aprendido num item alcançar o campo de OUTRO item — o robô
    // digitaria o lance do item 3 no campo do item 1. O teste pegou isso; em disputa
    // real seria dinheiro no item errado.
    const dentro = (sel) => {
      if (!sel) return null;
      try {
        const el = cartao.querySelector(sel);
        return el && visivel(el) && habilitado(el) ? el : null;
      } catch (e) { return null; }
    };

    let campo = dentro(aprendido && aprendido.campo);
    if (!campo) {
      const entradas = Array.prototype.filter.call(cartao.querySelectorAll("input"), (el) => {
        const tipo = (el.getAttribute("type") || "text").toLowerCase();
        return ["text", "number", "tel", ""].indexOf(tipo) !== -1 && visivel(el) && habilitado(el);
      });
      campo = entradas.find((el) => RE_CAMPO.test(rotuloDe(el))) || (entradas.length === 1 ? entradas[0] : null);
    }

    let botao = dentro(aprendido && aprendido.botao);
    if (!botao) {
      botao = Array.prototype.filter.call(
        cartao.querySelectorAll('button,[role="button"],input[type="submit"]'), (b) => visivel(b) && habilitado(b)
      ).find((b) => {
        const t = texto(b) + " " + (b.getAttribute("aria-label") || "");
        return RE_BOTAO.test(t) && !RE_BOTAO_NAO.test(t);
      }) || null;
    }

    return { campo, botao };
  }

  /* ------------------------------------------------------- digitação */

  const setor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  const definir = (el, v) => (setor && setor.set ? setor.set.call(el, v) : (el.value = v));
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Caractere a caractere: máscara de moeda reescreve o campo a cada tecla. */
  async function digitar(el, txt) {
    el.focus();
    definir(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    for (const ch of String(txt)) {
      definir(el, el.value + ch);
      let ev;
      try { ev = new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }); }
      catch (e) { ev = new Event("input", { bubbles: true }); }
      el.dispatchEvent(ev);
      await espera(10);
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  /** Preenche e CONFERE. Nenhum clique se o campo não ficou com o valor exato. */
  async function preencher(el, valor) {
    // Duas e quatro casas: o portal usa 4 em valor unitário. A conferência depois de
    // cada tentativa é o que torna seguro tentar vários formatos — só passa o que o
    // campo leu de volta exatamente igual ao pedido.
    const tentativas = [
      valor.toFixed(2).replace(".", ","),
      valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      String(Math.round(valor * 100)),
      valor.toFixed(4).replace(".", ","),
      valor.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 }),
      String(Math.round(valor * 10000)),
      valor.toFixed(2)
    ];
    for (const t of tentativas) {
      await digitar(el, t);
      await espera(70);
      const lido = paraNumero(el.value);
      if (lido !== null && Math.abs(lido - valor) < 0.005) return { ok: true };
    }
    const restou = el.value;
    await digitar(el, "");
    return { ok: false, restou };
  }

  function clicar(el) {
    const op = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent("pointerdown", op)); } catch (e) { /* antigo */ }
    el.dispatchEvent(new MouseEvent("mousedown", op));
    try { el.dispatchEvent(new PointerEvent("pointerup", op)); } catch (e) { /* antigo */ }
    el.dispatchEvent(new MouseEvent("mouseup", op));
    el.click();
  }

  const RE_CONFIRMA = /^(sim|confirmar|confirmo|ok|enviar|continuar)\b/i;
  function botaoConfirmacao() {
    const sel = '[role="dialog"],[role="alertdialog"],.p-dialog,.modal,.br-modal';
    const modais = Array.prototype.filter.call(document.querySelectorAll(sel), visivel);
    for (let i = modais.length - 1; i >= 0; i--) {
      const b = Array.prototype.filter.call(modais[i].querySelectorAll('button,[role="button"]'), (x) => visivel(x) && habilitado(x))
        .find((x) => RE_CONFIRMA.test(texto(x)));
      if (b) return b;
    }
    return null;
  }

  /* ------------------------------------------------------------ estado */

  const estado = {
    ligado: false,
    item: "",
    cfg: { piso: 0, decremento: 1, tipo: "fixo" },
    canal: "desconhecido",
    ultimaResposta: null,
    aprendido: null,
    log: []
  };

  const registrar = (nivel, msg) => {
    estado.log.push({ em: new Date().toISOString(), nivel, msg });
    if (estado.log.length > 300) estado.log.shift();
    if (typeof estado.aoLog === "function") estado.aoLog(nivel, msg);
  };

  function guardarAprendido(campo, botao) {
    const novo = { campo, botao, em: new Date().toISOString() };
    estado.aprendido = novo;
    try { chrome.storage.local.set({ [CHAVE]: novo }); } catch (e) { /* fora da extensão */ }
    registrar("sistema", "Aprendi onde ficam o campo e o botão de lance deste portal.");
  }

  /* -------------------------------------------------------- envio */

  async function enviarLance(item, valor) {
    const { campo, botao } = controles(item.cartao, estado.aprendido);
    if (!campo) return { ok: false, motivo: "Não encontrei o campo de lance no cartão do item." };
    if (!botao) return { ok: false, motivo: "Não encontrei o botão de envio no cartão do item." };

    const p = await preencher(campo, valor);
    if (!p.ok) {
      return { ok: false, motivo: `O campo não aceitou R$ ${valor.toFixed(2)} (ficou "${p.restou}"). Nada foi enviado.` };
    }

    estado.ultimaResposta = null;
    const marco = Date.now();
    clicar(botao);

    for (let i = 0; i < 20; i++) {
      await espera(200);
      const c = botaoConfirmacao();
      if (c) { clicar(c); break; }
      if (estado.ultimaResposta && estado.ultimaResposta.em >= marco) break;
    }

    for (let i = 0; i < 30; i++) {
      if (estado.ultimaResposta && estado.ultimaResposta.em >= marco) {
        const r = estado.ultimaResposta;
        const aceito = r.status >= 200 && r.status < 300;
        if (aceito && !estado.aprendido) guardarAprendido(seletorDe(campo), seletorDe(botao));
        return { ok: true, aceito, confirmado: true, motivo: `HTTP ${r.status} · ${r.url.slice(-70)}` };
      }
      await espera(200);
    }

    return {
      ok: true, aceito: false, confirmado: false,
      motivo: "Cliquei em enviar, mas o portal não confirmou em 6s. Parando para não repetir um lance que pode ter entrado."
    };
  }

  /**
   * Seletor para reusar em OUTROS itens, então id fica por último: id é único de um
   * cartão e não serve para os demais. `formcontrolname` e `aria-label` se repetem em
   * todos os cartões, que é exatamente o que se quer aprender.
   */
  function seletorDe(el) {
    const fc = el.getAttribute("formcontrolname");
    if (fc) return el.tagName.toLowerCase() + '[formcontrolname="' + fc + '"]';
    const al = el.getAttribute("aria-label");
    if (al) return el.tagName.toLowerCase() + '[aria-label="' + al + '"]';
    if (el.id && !/\d/.test(el.id)) return "#" + el.id;
    return el.tagName.toLowerCase();
  }

  /* --------------------------------------------------------- ciclo */

  let ciclando = false;

  async function ciclo(origem) {
    if (!estado.ligado || ciclando) return;
    ciclando = true;
    try {
      const item = acharItem(estado.item);
      if (!item) return registrar("alerta", `Item ${estado.item} não está na tela.`);

      const d = M.decidir(estado.cfg, item, Date.now());

      if (d.acao === "aguardar") return;
      if (d.acao === "parar") {
        registrar("alerta", d.motivo);
        estado.ligado = false;
        return;
      }

      registrar("concorrente", `Melhor valor R$ ${item.melhorValor.toFixed(2)} (via ${origem}). Ofertando R$ ${d.valor.toFixed(2)}.`);
      const r = await enviarLance(item, d.valor);

      if (!r.ok) { registrar("alerta", r.motivo); estado.ligado = false; return; }
      if (!r.confirmado) { registrar("alerta", r.motivo); estado.ligado = false; return; }
      registrar(r.aceito ? "sucesso" : "alerta", (r.aceito ? "Lance aceito. " : "Portal recusou. ") + r.motivo);
    } finally {
      ciclando = false;
    }
  }

  /* ------------------------------------- conexão e gatilho de releitura */

  function conexaoCaiu() {
    const sit = document.querySelector("app-situacao-conexao-sistema");
    if (!sit) return false;
    return Array.prototype.some.call(sit.querySelectorAll("button"),
      (b) => visivel(b) && /recarregar/i.test(texto(b) + " " + (b.getAttribute("aria-label") || "")));
  }

  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || d.__lancebot !== true) return;

    if (d.tipo === "mudou") void ciclo("websocket");
    else if (d.tipo === "resposta-lance") estado.ultimaResposta = d;
    else if (d.tipo === "retoken") {
      // A coleta flagrou a sequência: GET → 401, PUT .../sessao/fornecedor/retoken → 200,
      // GET → 200. A própria SPA renova o token. Recarregar a página aqui seria destruir
      // uma sessão que já se consertou sozinha — e no meio de uma disputa isso custa caro.
      registrar("sistema", "O portal renovou o token da sessão sozinho. Seguindo.");
    }
    else if (d.tipo === "canal") {
      estado.canal = d.estado;
      if (d.estado === "fechado" || d.estado === "erro") {
        registrar("alerta", "Conexão em tempo real caiu. Recarregando a página para restabelecer.");
        if (estado.ligado) setTimeout(() => location.reload(), 1500);
      }
    }
  });

  // Rede de segurança: se o socket morrer sem avisar, o portal mostra "Recarregar
  // página". É exatamente o momento em que o operador atualiza na mão hoje.
  setInterval(() => {
    if (estado.ligado && conexaoCaiu()) {
      registrar("alerta", "O portal pediu recarga da página. Recarregando.");
      location.reload();
    }
  }, 5000);

  try {
    chrome.storage.local.get(CHAVE, (r) => { if (r && r[CHAVE]) estado.aprendido = r[CHAVE]; });
  } catch (e) { /* fora da extensão (teste) */ }

  window.__lancebot = {
    estado, ciclo, acharItem, cartoes, lerCartao, controles, enviarLance, melhorDoHistorico,
    conexaoCaiu, registrar,
    ligar: (item, cfg) => { estado.item = String(item); estado.cfg = cfg; estado.ligado = true; registrar("sistema", `Robô ligado no item ${item}.`); void ciclo("inicio"); },
    parar: (motivo) => { estado.ligado = false; registrar("sistema", motivo || "Parado pelo operador."); }
  };
})();
