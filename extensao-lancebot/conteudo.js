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

  /**
   * Campo de lance, como o portal REALMENTE entrega (coleta feita em disputa ao vivo):
   * um `input` SEM formcontrolname, SEM aria-label, SEM placeholder e SEM rótulo — cujo
   * `id` é o NÚMERO DO ITEM ("2", "3"). O campo já diz de que item ele é.
   *
   * Detalhe que sozinho quebrava tudo: `#2` NÃO é seletor CSS válido (id não pode
   * começar com dígito), então `querySelector("#2")` lança erro. Por isso aqui se usa
   * sempre `input[id]` + teste do valor, nunca `#` + id.
   */
  const ehNumeroDeItem = (v) => /^\d{1,5}$/.test(String(v == null ? "" : v));

  function camposDeLance(raiz) {
    return Array.prototype.filter.call((raiz || document).querySelectorAll("input[id]"), (el) => {
      if (!ehNumeroDeItem(el.id)) return false;
      const tipo = (el.getAttribute("type") || "text").toLowerCase();
      return ["text", "number", "tel", ""].indexOf(tipo) !== -1 && visivel(el);
    });
  }

  /**
   * Botão de envio. Na disputa ao vivo ele não tem aria-label, nem id estável, nem
   * classe própria — o que tem é
   * `title="Clique aqui ou tecle enter para enviar seu lance."`. É essa a âncora.
   */
  const RE_BOTAO_LANCE = /enviar\s+(seu\s+)?lance|ofertar|registrar\s+lance/i;

  function botaoDeLance(raiz) {
    return Array.prototype.filter.call(
      raiz.querySelectorAll('button,[role="button"],input[type="submit"]'),
      (b) => {
        if (!visivel(b)) return false;
        const t = texto(b) + " " + (b.getAttribute("title") || "") + " " + (b.getAttribute("aria-label") || "");
        return RE_BOTAO_LANCE.test(t) && !RE_BOTAO_NAO.test(t);
      }
    )[0] || null;
  }

  /**
   * Bloco do item: o MENOR ancestral do campo que também contém o botão de envio, sem
   * englobar o campo de outro item.
   *
   * Substitui o `app-card-item` que o robô procurava: na tela de disputa que o operador
   * capturou esse componente NÃO EXISTE — os itens são `div` dentro de `p-dataview`.
   * Procurar por ele devolvia lista vazia, e o robô não enxergava item nenhum.
   */
  const CONTAINERS = /^(p-dataview|app-disputa-fornecedor-itens|app-root|main|body|html)$/i;

  function escopoDoCampo(campo) {
    // O MAIOR bloco que ainda pertence só a este item — não o menor. O menor contém
    // apenas o campo e o botão, e deixa os valores do item de fora: o robô achava os
    // controles e não achava preço nenhum.
    let n = campo.parentElement;
    let melhor = null;
    for (let i = 0; i < 14 && n; i++) {
      if (CONTAINERS.test(n.tagName)) break;                  // passou do cartão do item
      if (camposDeLance(n).some((c) => c !== campo)) break;    // englobaria outro item
      if (botaoDeLance(n)) melhor = n;                         // ainda é só deste item
      n = n.parentElement;
    }
    return melhor || campo.parentElement || campo;
  }

  const cartoes = () => {
    const campos = camposDeLance(document);
    if (campos.length) return campos.map(escopoDoCampo);
    // Sem campo de lance na tela (disputa encerrada, ou layout antigo com app-card-item).
    return Array.prototype.filter.call(document.querySelectorAll("app-card-item"), visivel);
  };

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

    const c = controles(cartao, estado.aprendido);
    const numero = c.campo && ehNumeroDeItem(c.campo.id)
      ? c.campo.id
      : ((fase.match(/\b(\d{1,5})\b/) || [])[1] || (t.match(/\b(\d{1,5})\b/) || [])[1] || "");

    let melhor = valorRotulado(cartao, RE_MELHOR);
    if (melhor === null) melhor = melhorDoHistorico();
    if (melhor === null) {
      const todos = valoresEm(t);
      melhor = todos.length ? Math.min.apply(null, todos) : null;
    }

    // Fecha por evidência, não por texto. Quando a disputa encerrou, a coleta mostrou a
    // tela SEM nenhum campo de lance: sem campo e botão habilitados não há lance a dar,
    // e dizer "aberto" só faria o robô tentar e falhar.
    const operavel = Boolean(c.campo && c.botao && habilitado(c.campo) && habilitado(c.botao));
    const aberto = operavel && !RE_FECHADO.test(fase);

    return {
      numero: String(numero),
      melhorValor: melhor,
      meuValor: valorRotulado(cartao, RE_MEU),
      aberto,
      situacao: situacaoDoItem(fase, operavel),
      fase,
      lidoEm: Date.now(),
      segundosRestantes: segundosRestantes(),
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

    // 1) A regra que veio da disputa ao vivo: o id do input É o número do item.
    let campo = camposDeLance(cartao)[0] || null;
    // 2) Seletor aprendido num envio anterior.
    if (!campo) campo = dentro(aprendido && aprendido.campo);
    // 3) Heurística por rótulo, para telas que ainda não vimos.
    if (!campo) {
      const entradas = Array.prototype.filter.call(cartao.querySelectorAll("input"), (el) => {
        const tipo = (el.getAttribute("type") || "text").toLowerCase();
        return ["text", "number", "tel", ""].indexOf(tipo) !== -1 && visivel(el) && habilitado(el);
      });
      campo = entradas.find((el) => RE_CAMPO.test(rotuloDe(el))) || (entradas.length === 1 ? entradas[0] : null);
    }

    let botao = botaoDeLance(cartao);
    if (!botao) botao = dentro(aprendido && aprendido.botao);
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

  const RE_CONFIRMA = /^(sim|confirmar|confirmo|enviar|continuar)\b/i;
  const RE_MODAL_LANCE = /lance|oferta|valor/i;
  const RE_MODAL_NAO = /encerrad|aguarde|julgamento|sess[aã]o\s+p[uú]blica/i;

  /**
   * Só clica em modal que seja de fato confirmação de LANCE.
   *
   * A coleta em disputa ao vivo mostrou que não existe modal de confirmação de lance: o
   * POST sai direto do clique, em ~86ms. O único diálogo que aparece é o de fim de
   * sessão ("todos os itens estão encerrados"), com um botão "Ok" — e a versão anterior
   * daqui aceitava "ok", ou seja, dispensaria sozinha um aviso que o operador precisa
   * ver, achando que estava confirmando um lance.
   */
  function botaoConfirmacao() {
    const sel = '[role="dialog"],[role="alertdialog"],.p-dialog,.modal,.br-modal,app-dialog-confirmacao';
    const modais = Array.prototype.filter.call(document.querySelectorAll(sel), visivel);
    for (let i = modais.length - 1; i >= 0; i--) {
      const t = texto(modais[i]);
      if (!RE_MODAL_LANCE.test(t) || RE_MODAL_NAO.test(t)) continue;
      const b = Array.prototype.filter.call(modais[i].querySelectorAll('button,[role="button"]'), (x) => visivel(x) && habilitado(x))
        .find((x) => RE_CONFIRMA.test(texto(x)));
      if (b) return b;
    }
    return null;
  }

  /**
   * O portal avisa o desfecho num toast: "Lance registrado com sucesso." É a segunda
   * testemunha do envio, além do POST — e a única que sobra se a resposta HTTP não for
   * espelhada.
   */
  const RE_SUCESSO = /lance\s+registrado\s+com\s+sucesso|lance\s+registrado|lance\s+enviado\s+com\s+sucesso/i;
  const RE_RECUSA = /erro|falha|n[aã]o\s+foi\s+poss[ií]vel|inv[aá]lid|recusad|menor\s+que|superior\s+a/i;

  function avisoDoPortal() {
    const el = document.querySelector("#toast-msgs") || document.querySelector("p-toast");
    return el && visivel(el) ? texto(el) : "";
  }

  const APREND = () => window.__lancebotAprendizado || null;
  const gravar = (tipo, dados) => { const a = APREND(); if (a) a.anotar(tipo, dados); };

  /* ------------------------------------------------------- tempo e fases */

  /** Segundos até o fim do envio de lances, lidos do relógio do próprio portal. */
  function segundosRestantes() {
    const el = document.querySelector("app-tempo-restante");
    if (!el || !visivel(el)) return null;
    const m = texto(el).match(/(\d{1,3}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    return m[3] !== undefined
      ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
      : Number(m[1]) * 60 + Number(m[2]);
  }

  const RE_ENCERRADO_DE_VEZ = /encerrad|finalizad|cancelad|homologad|adjudicad|desert|fracassad|julgad/i;

  /**
   * As três fases que o portal mostra em abas: aguardando, em disputa, encerrados.
   * Item operável é "em disputa" por evidência — tem campo e botão habilitados.
   */
  function situacaoDoItem(fase, operavel) {
    if (operavel) return "aberto";
    return RE_ENCERRADO_DE_VEZ.test(fase) ? "encerrado" : "aguardando";
  }

  /* --------------------------------------------------------------- chat */

  const mensagens = [];
  const vistas = new Set();

  function guardarMensagem(m) {
    const chave = (m.em || "") + "|" + (m.texto || "").slice(0, 80);
    if (!m.texto || vistas.has(chave)) return;
    vistas.add(chave);
    mensagens.push(m);
    if (mensagens.length > 200) mensagens.shift();
  }

  /**
   * Mensagens do chat da disputa.
   *
   * Vêm da resposta que o próprio portal busca (`/comprasnet-mensagem/v2/chat/...`),
   * espelhada por `pagina.js`. Ler dali é mais confiável do que depender de a gaveta de
   * mensagens estar aberta na tela — e ela quase nunca está.
   *
   * O formato do JSON nunca foi observado por este projeto, então a leitura é
   * deliberadamente genérica: procura, em qualquer lugar da resposta, objetos que tenham
   * um texto e (de preferência) uma data. Se o portal mudar o nome dos campos, isso
   * continua funcionando; se não achar nada, o painel diz que não achou em vez de
   * inventar.
   */
  const CAMPOS_TEXTO = ["mensagem", "texto", "conteudo", "descricao", "corpo", "message", "text"];
  const CAMPOS_DATA = ["dataHora", "data", "dataEnvio", "criadoEm", "horario", "dataCadastro", "createdAt"];
  const CAMPOS_AUTOR = ["autor", "remetente", "usuario", "nome", "origem", "perfil", "papel"];

  function colher(v, saida, prof) {
    const p = prof || 0;
    if (!v || p > 6 || saida.length > 200) return;
    if (Array.isArray(v)) { v.forEach((x) => colher(x, saida, p + 1)); return; }
    if (typeof v !== "object") return;

    const achar = (nomes) => {
      for (const k of Object.keys(v)) {
        if (nomes.indexOf(k) !== -1 && typeof v[k] === "string" && v[k].trim()) return v[k].trim();
      }
      return "";
    };
    const txt = achar(CAMPOS_TEXTO);
    if (txt) saida.push({ texto: txt.slice(0, 600), em: achar(CAMPOS_DATA), autor: achar(CAMPOS_AUTOR) });

    for (const k of Object.keys(v)) colher(v[k], saida, p + 1);
  }

  function absorverChat(corpo) {
    let dados;
    try { dados = JSON.parse(corpo); } catch (e) { return 0; }
    const achadas = [];
    colher(dados, achadas, 0);
    achadas.forEach(guardarMensagem);
    return achadas.length;
  }

  const chat = () => mensagens.slice(-60);

  /* ------------------------------------------------------ classificação */

  /**
   * Onde o operador está na fila de valores do item.
   *
   * Montada com o que o portal mostra na tela — o histórico de lances e o painel de
   * melhores valores. É classificação POR VALOR: quantos valores distintos estão abaixo
   * do dele. O painel diz isso com todas as letras, porque não é a classificação oficial
   * do pregoeiro, é o que dá para afirmar a partir da tela.
   */
  function classificacao(numero) {
    const item = acharItem(numero);
    const fontes = ["app-todos-lances", "app-melhores-valores", "app-propostas-iniciais"];
    const valores = [];
    fontes.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        if (visivel(el)) valoresEm(texto(el)).forEach((v) => valores.push(v));
      });
    });
    if (item && typeof item.melhorValor === "number") valores.push(item.melhorValor);

    const distintos = Array.from(new Set(valores.map((v) => Math.round(v * 10000)))).map((v) => v / 10000);
    distintos.sort((a, b) => a - b);

    const meu = item && typeof item.meuValor === "number" ? item.meuValor : null;
    const posicao = meu === null ? null : distintos.filter((v) => v < meu).length + 1;

    return { item: String(numero), meuValor: meu, posicao, total: distintos.length, valores: distintos.slice(0, 30) };
  }

  /* --------------------------------------------- identidade da disputa */

  /**
   * Quem é esta disputa, lido do cabeçalho que o portal desenha.
   *
   * A coleta em disputa ao vivo mostrou o cabeçalho assim:
   *   "Dispensa Eletrônica N° ##/#### (Lei ##.###/####) UASG ##### - TCU-TRIBUNAL ..."
   * e o tempo em `app-tempo-restante`, ao lado do rótulo
   * "Tempo restante para envio de lances:".
   */
  /** Quantos itens em cada fase — é o que alimenta as três abas do painel. */
  function contarFases() {
    const contas = { aguardando: 0, aberto: 0, encerrado: 0 };
    cartoes().map(lerCartao).forEach((i) => { contas[i.situacao] = (contas[i.situacao] || 0) + 1; });
    return contas;
  }

  function identificarDisputa() {
    const cab = document.querySelector("app-cabecalho-disputa-fornecedor") ||
                document.querySelector("app-cabecalho-compra");
    const t = texto(cab) || texto(document.body).slice(0, 400);

    const m = t.match(/((?:preg[ãa]o|dispensa|concorr[êe]ncia|cota[çc][ãa]o|leil[ãa]o)[^,;|]{0,60}?n[°ºo.]?\s*[\d./-]+)/i);
    const uasg = (t.match(/UASG\s*([\d]{3,8})/i) || [])[1] || "";
    const orgao = (t.match(/UASG\s*[\d]{3,8}\s*[-–]\s*([^|]{3,70})/i) || [])[1] || "";

    let compra = "";
    try { compra = new URL(location.href).searchParams.get("compra") || ""; } catch (e) { /* url estranha */ }

    const rel = document.querySelector("app-tempo-restante");
    const tempo = (texto(rel).match(/\d{1,3}:\d{2}:\d{2}|\d{1,3}:\d{2}/) || [])[0] || "";

    return {
      titulo: (m && m[1] ? m[1].trim() : "") || (compra ? `Compra ${compra}` : "Disputa"),
      uasg,
      orgao: orgao.trim(),
      compra,
      tempoRestante: tempo,
      segundosRestantes: segundosRestantes(),
      conexaoCaiu: conexaoCaiu(),
      naSalaDeDisputa: cartoes().length > 0,
      fases: contarFases()
    };
  }

  /* ------------------------------------------------------------ estado */

  /**
   * Uma disputa tem vários itens abertos ao mesmo tempo — a coleta do operador mostrou
   * dois. Por isso o robô arma POR ITEM: cada um com seu piso e seu decremento, ligado e
   * desligado à parte. Um item que para (piso atingido, portal recusou, leitura velha)
   * não derruba os outros.
   */
  const estado = {
    armados: {},                 // { "<item>": { piso, decremento, tipo } }
    ligado: false,               // derivado: existe algum item armado
    canal: "desconhecido",
    ultimaResposta: null,
    aprendido: null,
    log: []
  };

  const itensArmados = () => Object.keys(estado.armados);
  const sincronizarLigado = () => { estado.ligado = itensArmados().length > 0; };

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
    // O POST do lance carrega o número do item na URL:
    // POST /comprasnet-disputa/v1/compras/{n}/itens/{item}/lances
    // Conferir isso é o que impede a resposta de OUTRO item de contar como confirmação
    // deste — numa disputa com vários itens abertos, é fácil acontecer.
    const alvo = "/itens/" + item.numero + "/lances";

    // O toast do lance ANTERIOR fica na tela. Sem guardar o texto de antes, ele contaria
    // como confirmação deste envio — o robô diria "aceito" sem ter mandado nada, e
    // seguiria baixando preço em cima de um lance que não existe.
    const avisoAntes = avisoDoPortal();
    clicar(botao);

    const respostaDoItem = () => {
      const r = estado.ultimaResposta;
      if (!r || r.em < marco) return null;
      if (item.numero && r.url && String(r.url).indexOf(alvo) === -1) return null;
      return r;
    };

    for (let i = 0; i < 30; i++) {
      const r = respostaDoItem();
      if (r) {
        const aceito = r.status >= 200 && r.status < 300;
        if (aceito && !estado.aprendido) {
          // Só aprende seletor específico. "input" ou "button" pelados pegariam o
          // controle errado no próximo item.
          const sc = seletorDe(campo), sb = seletorDe(botao);
          if (/[[#]/.test(sc) && /[[#]/.test(sb)) guardarAprendido(sc, sb);
        }
        return { ok: true, aceito, confirmado: true, motivo: `HTTP ${r.status} · ${String(r.url).slice(-70)}` };
      }

      // A resposta HTTP é a testemunha principal, porque traz o número do item. O toast
      // só entra depois de um tempo e só se MUDOU — nunca o que já estava na tela.
      const aviso = i >= 5 ? avisoDoPortal() : "";
      if (aviso && aviso === avisoAntes) {
        await espera(200);
        continue;
      }
      if (RE_SUCESSO.test(aviso)) {
        return { ok: true, aceito: true, confirmado: true, motivo: "O portal respondeu: “Lance registrado com sucesso.”" };
      }
      if (RE_RECUSA.test(aviso)) {
        return { ok: true, aceito: false, confirmado: true, motivo: "O portal recusou: " + aviso.slice(0, 140) };
      }

      const c = botaoConfirmacao();
      if (c) clicar(c);
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
    // O botão de lance real não tem aria-label — tem title.
    const ti = el.getAttribute("title");
    if (ti) return el.tagName.toLowerCase() + '[title="' + ti + '"]';
    if (el.id && !/\d/.test(el.id)) return "#" + el.id;
    return el.tagName.toLowerCase();
  }

  /* --------------------------------------------------------- ciclo */

  let ciclando = false;

  /** Desarma UM item, sem tocar nos outros. */
  function desarmar(numero, motivo) {
    if (!estado.armados[numero]) return;
    delete estado.armados[numero];
    sincronizarLigado();
    if (motivo) registrar("alerta", `Item ${numero}: ${motivo}`);
  }

  async function ciclo(origem) {
    if (!estado.ligado || ciclando) return;
    ciclando = true;
    try {
      for (const numero of itensArmados()) {
        const cfg = estado.armados[numero];
        if (!cfg) continue;

        const item = acharItem(numero);
        if (!item) { registrar("alerta", `Item ${numero} não está na tela.`); continue; }

        const d = M.decidir(cfg, item, Date.now());
        // Cada decisão fica gravada com a tela que a produziu: é isso que permite
        // reconstruir depois por que o robô fez o que fez.
        gravar("decisao", {
          item: numero, origem, cfg,
          leitura: { melhor: item.melhorValor, meu: item.meuValor, situacao: item.situacao,
                     segundos: item.segundosRestantes },
          decisao: d
        });
        if (d.acao === "aguardar") continue;
        if (d.acao === "parar") { desarmar(numero, d.motivo); continue; }

        registrar("concorrente",
          `Item ${numero}: melhor R$ ${item.melhorValor.toFixed(2)} (via ${origem}). ` +
          `Ofertando R$ ${d.valor.toFixed(d.desempate ? 4 : 2)}${d.desempate ? " — desempate por casas decimais." : "."}`);
        const r = await enviarLance(item, d.valor);
        gravar("envio", { item: numero, valor: d.valor, desempate: Boolean(d.desempate), resultado: r });

        if (!r.ok || !r.confirmado) { desarmar(numero, r.motivo); continue; }
        registrar(r.aceito ? "sucesso" : "alerta",
          `Item ${numero}: ` + (r.aceito ? "lance aceito. " : "portal recusou. ") + r.motivo);
        if (!r.aceito) desarmar(numero, "o portal recusou o lance — confira antes de ligar de novo.");
      }
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

    if (d.tipo === "mudou") { gravar("tempo-real", { origem: d.origem }); void ciclo("websocket"); }
    else if (d.tipo === "dados") {
      // Chat e dados de disputa que o próprio portal buscou.
      if (/\/chat\b/i.test(d.url)) {
        const n = absorverChat(d.corpo);
        if (n) gravar("chat", { url: d.url, mensagens: n });
      }
      gravar("resposta-portal", { url: d.url, status: d.status, corpo: String(d.corpo || "").slice(0, 4000) });
    }
    else if (d.tipo === "resposta-lance") {
      estado.ultimaResposta = d;
      gravar("resposta-lance", { url: d.url, status: d.status, corpo: d.corpo });
    }
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
    conexaoCaiu, registrar, botaoConfirmacao, avisoDoPortal, camposDeLance, botaoDeLance,
    identificarDisputa, itensArmados, desarmar, ciclo, contarFases,
    segundosRestantes, situacaoDoItem, chat, absorverChat, classificacao,

    armar: (item, cfg) => {
      estado.armados[String(item)] = cfg;
      sincronizarLigado();
      registrar("sistema", `Item ${item} armado: piso R$ ${Number(cfg.piso).toFixed(2)}, decremento ${cfg.tipo === "percentual" ? cfg.decremento + "%" : "R$ " + Number(cfg.decremento).toFixed(2)}.`);
      void ciclo("inicio");
    },

    // Mantidos: `ligar` arma um item, `parar` desarma todos.
    ligar: (item, cfg) => { window.__lancebot.armar(item, cfg); },
    parar: (motivo) => {
      estado.armados = {};
      sincronizarLigado();
      registrar("sistema", motivo || "Parado pelo operador.");
    }
  };
})();
