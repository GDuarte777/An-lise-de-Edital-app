/**
 * Agente que roda DENTRO da página da sala de disputa.
 *
 * Por que operar a interface do portal em vez de repetir a chamada HTTP dele:
 *
 * A versão anterior tentava reproduzir o POST de lance capturado do operador
 * (`corpoModelo` em discovery.ts). Isso não funciona na prática e é a razão de o robô
 * nunca ter dado um lance real:
 *
 *  1. o robô só podia enviar depois que o operador enviasse um lance manualmente —
 *     o primeiro lance, que é o que interessa, nunca saía dele;
 *  2. o corpo capturado carrega token anti-CSRF, id de conexão do canal em tempo real
 *     e carimbo de tempo; repetido minutos depois, o portal recusa;
 *  3. qualquer mudança de campo no portal quebrava o modelo em silêncio.
 *
 * Aqui o lance é digitado no campo do próprio portal e o botão do próprio portal é
 * clicado. Quem monta a requisição é o JavaScript da sala, com os tokens que ele
 * mesmo acabou de emitir — exatamente como quando um humano clica. É o único caminho
 * que sobrevive a CSRF, sessão e validação do servidor.
 *
 * O agente falha fechado: se não encontrar o campo, se o campo não aceitar exatamente
 * o valor pedido, ou se o portal não confirmar o envio, ele diz que não deu certo em
 * vez de deixar o motor supor que deu.
 */

/** Marca do espelho de eventos, para separar do console normal da página. */
export const VERSAO_AGENTE = 3;

export interface DiagnosticoSala {
  url: string;
  titulo: string;
  escopoEncontrado: boolean;
  textoEscopo: string;
  campoLance: string | null;
  botaoEnvio: string | null;
  entradasVisiveis: number;
  botoesVisiveis: number;
  valoresNaTela: number[];
}

export interface LeituraSala {
  ok: boolean;
  menorLance: number | null;
  nossoLance: number | null;
  aberto: boolean;
  evidencia: string;
  motivo?: string;
}

export interface EnvioSala {
  ok: boolean;
  etapa: "campo" | "botao" | "preencher" | "ensaio" | "enviado";
  aceito: boolean;
  /** Falso quando o portal não deu nenhum sinal de desfecho — o motor precisa parar. */
  confirmado: boolean;
  mensagem: string;
  seletores?: { campo: string; botao: string };
  diagnostico?: DiagnosticoSala;
}

export interface ItemVisivel {
  pregaoId: string;
  itemNum: string;
  descricao: string;
  situacao: string;
}

export interface SeletoresAprendidos {
  campo?: string;
  botao?: string;
  aprendidoEm?: string;
}

/**
 * Fonte do agente. Precisa ser autocontida: roda no mundo principal da página do
 * portal, sem acesso a nada do aplicativo.
 *
 * `seletores` são os caminhos CSS aprendidos de um envio manual anterior, quando
 * existirem. Eles têm prioridade sobre a busca automática — a busca automática é o
 * caminho normal, e o aprendizado só existe para o dia em que o portal mudar o
 * suficiente para a heurística errar.
 */
export function scriptAgenteSala(seletores: SeletoresAprendidos = {}): string {
  return `
(() => {
  const VERSAO = ${VERSAO_AGENTE};
  const APRENDIDO = ${JSON.stringify(seletores)};

  if (window.__lancebotSala && window.__lancebotSala.versao === VERSAO) {
    window.__lancebotSala.aprendido = APRENDIDO;
    return "ja-ativo";
  }

  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------------------------------------------------------------- números */

  function paraNumero(txt) {
    if (typeof txt === "number") return Number.isFinite(txt) ? txt : null;
    if (typeof txt !== "string") return null;
    const m = txt.match(/-?\\d{1,3}(?:\\.\\d{3})+,\\d{1,2}|-?\\d+,\\d{1,2}|-?\\d{1,3}(?:,\\d{3})+\\.\\d{1,2}|-?\\d+\\.\\d{1,2}|-?\\d+/);
    if (!m) return null;
    let s = m[0];
    if (/,\\d{1,2}$/.test(s)) s = s.replace(/\\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /** Só valores com centavos contam como dinheiro: evita ler número de item como preço. */
  function valoresEm(texto) {
    const re = /(?:R\\$\\s*)?(\\d{1,3}(?:\\.\\d{3})+,\\d{2}|\\d+,\\d{2})/g;
    const saida = [];
    let m;
    while ((m = re.exec(String(texto))) !== null) {
      const n = paraNumero(m[1]);
      if (n !== null && n > 0) saida.push(n);
    }
    return saida;
  }

  /* ------------------------------------------------------------- elementos */

  function visivel(el) {
    if (!el || el.nodeType !== 1) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  }

  function habilitado(el) {
    if (!el) return false;
    if (el.disabled === true || el.readOnly === true) return false;
    if (el.getAttribute && el.getAttribute("aria-disabled") === "true") return false;
    return !/\\b(disabled|desabilitado|bloqueado)\\b/i.test(el.className || "");
  }

  function textoDe(el) {
    if (!el) return "";
    const partes = [
      el.innerText || el.textContent || "",
      el.getAttribute ? el.getAttribute("aria-label") || "" : "",
      el.getAttribute ? el.getAttribute("title") || "" : "",
      el.tagName === "INPUT" ? el.value || "" : ""
    ];
    return partes.join(" ").replace(/\\s+/g, " ").trim();
  }

  /** Tudo que possa nomear um campo: rótulo, placeholder, nome do controle Angular. */
  function rotuloDe(el) {
    const partes = [];
    const attr = (n) => (el.getAttribute ? el.getAttribute(n) || "" : "");
    partes.push(attr("aria-label"), attr("placeholder"), attr("name"), attr("id"), attr("formcontrolname"), attr("title"));
    if (el.id) {
      try {
        const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lbl) partes.push(lbl.textContent || "");
      } catch (e) { /* id inválido para seletor */ }
    }
    const envolvente = el.closest ? el.closest("label") : null;
    if (envolvente) partes.push(envolvente.textContent || "");
    const campo = el.closest ? el.closest(".field,.form-group,.br-input,mat-form-field,.p-field,td,div") : null;
    if (campo) partes.push((campo.textContent || "").slice(0, 120));
    return partes.join(" ").replace(/\\s+/g, " ").trim();
  }

  function caminhoCss(el) {
    if (!el) return "";
    const seguro = (v) => v && !/\\d{4,}/.test(v);
    if (seguro(el.id)) { try { return "#" + CSS.escape(el.id); } catch (e) { /* segue */ } }
    const partes = [];
    let n = el;
    while (n && n.nodeType === 1 && partes.length < 6) {
      const fc = n.getAttribute ? n.getAttribute("formcontrolname") : null;
      if (fc) { partes.unshift(n.tagName.toLowerCase() + '[formcontrolname="' + fc + '"]'); break; }
      if (seguro(n.id)) { partes.unshift("#" + n.id); break; }
      let p = n.tagName.toLowerCase();
      const pai = n.parentElement;
      if (pai) {
        const irmaos = Array.prototype.filter.call(pai.children, (c) => c.tagName === n.tagName);
        if (irmaos.length > 1) p += ":nth-of-type(" + (irmaos.indexOf(n) + 1) + ")";
      }
      partes.unshift(p);
      n = n.parentElement;
    }
    return partes.join(" > ");
  }

  function porSeletor(sel) {
    if (!sel) return null;
    try {
      const el = document.querySelector(sel);
      return el && visivel(el) && habilitado(el) ? el : null;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------ escopo do item na tela */

  /**
   * Acha o menor bloco da página que fale deste item. É o que impede o robô de digitar
   * o lance do item 3 no campo do item 1 quando a sala mostra vários itens juntos.
   */
  function escopoItem(itemNum) {
    const alvo = String(itemNum || "").replace(/^0+/, "").trim();
    if (!alvo) return null;
    const re = new RegExp("(^|[^\\\\d])0*" + alvo + "([^\\\\d]|$)");

    // Duas exigências, cada uma consertando um erro concreto:
    //
    //  - o bloco precisa ter um controle OU ser uma linha de lista com valor. Sem isso,
    //    "R$ 1.250,50" sozinho num <div> vencia por ser o menor texto que contém o
    //    dígito 1, e o robô passava a ler a tela errada;
    //  - o controle NÃO precisa estar habilitado. Item encerrado tem campo e botão
    //    desabilitados, e o robô precisa justamente conseguir ler que ele fechou.
    const candidatos = [];
    const nos = document.querySelectorAll('tr,[role="row"],li,article,section,fieldset,div');
    for (const el of nos) {
      if (!visivel(el)) continue;
      const t = (el.innerText || "").replace(/\\s+/g, " ").trim();
      if (!t || t.length > 1500) continue;
      if (!re.test(t)) continue;

      const temControle = Boolean(el.querySelector('input,button,[role="button"]'));
      const ehLinha = el.tagName === "TR" || el.tagName === "LI" || el.tagName === "ARTICLE" ||
                      (el.getAttribute && el.getAttribute("role") === "row");
      if (!temControle && !(ehLinha && valoresEm(t).length > 0)) continue;

      candidatos.push({ el: el, tam: t.length, operavel: entradasCandidatas(el).length > 0 ? 0 : 1,
                        semMencao: /\\bitem\\b/i.test(t) ? 0 : 1 });
    }
    if (candidatos.length === 0) return null;
    // Menor bloco vence: é a linha do item, não a tabela inteira que também cita o número.
    candidatos.sort((a, b) => a.tam - b.tam || a.operavel - b.operavel || a.semMencao - b.semMencao);
    return candidatos[0].el;
  }

  /* ------------------------------------------------------ campo e botão */

  const RE_CAMPO = /lance|oferta|valor|proposta|proposto|unit[aá]rio/i;
  const RE_BOTAO = /enviar|registrar|ofertar|dar\\s+lance|confirmar|lance/i;
  const RE_BOTAO_NAO = /cancelar|fechar|voltar|sair|limpar|desistir|excluir|filtrar|buscar|pesquisar|atualizar|imprimir|exportar/i;
  const TIPOS_TEXTO = ["text", "number", "tel", "search", ""];

  function entradasCandidatas(raiz) {
    return Array.prototype.filter.call(raiz.querySelectorAll("input"), (el) => {
      const tipo = (el.getAttribute("type") || "").toLowerCase();
      if (TIPOS_TEXTO.indexOf(tipo) === -1) return false;
      return visivel(el) && habilitado(el);
    });
  }

  function campoLance(escopo, itemNum) {
    const aprendido = porSeletor(APRENDIDO.campo);
    if (aprendido && (!escopo || escopo.contains(aprendido) || !escopoItem(itemNum))) return aprendido;

    const raizes = escopo ? [escopo, document.body] : [document.body];
    for (const raiz of raizes) {
      const entradas = entradasCandidatas(raiz);
      if (entradas.length === 0) continue;
      const porRotulo = entradas.filter((el) => RE_CAMPO.test(rotuloDe(el)));
      if (porRotulo.length === 1) return porRotulo[0];
      if (porRotulo.length > 1) {
        // Empate: fica com o que está mais perto de um botão de envio.
        const comBotao = porRotulo.filter((el) => botaoPerto(el));
        return (comBotao[0] || porRotulo[0]);
      }
      const monetarios = entradas.filter((el) => valoresEm(el.value || "").length > 0);
      if (monetarios.length === 1) return monetarios[0];
      if (raiz !== document.body && entradas.length === 1) return entradas[0];
    }
    return null;
  }

  function botoesCandidatos(raiz) {
    const sel = 'button,[role="button"],input[type="submit"],input[type="button"],a.btn,a.button';
    return Array.prototype.filter.call(raiz.querySelectorAll(sel), (el) => {
      if (!visivel(el) || !habilitado(el)) return false;
      const t = textoDe(el);
      return RE_BOTAO.test(t) && !RE_BOTAO_NAO.test(t);
    });
  }

  function botaoPerto(campo) {
    let no = campo.parentElement;
    for (let i = 0; i < 6 && no; i++) {
      const achados = botoesCandidatos(no);
      if (achados.length > 0) return achados[0];
      no = no.parentElement;
    }
    return null;
  }

  function botaoEnvio(escopo, campo) {
    const aprendido = porSeletor(APRENDIDO.botao);
    if (aprendido) return aprendido;
    if (campo) {
      const perto = botaoPerto(campo);
      if (perto) return perto;
    }
    if (escopo) {
      const noEscopo = botoesCandidatos(escopo);
      if (noEscopo.length > 0) return noEscopo[0];
    }
    const naPagina = botoesCandidatos(document.body).filter((b) => /lance|oferta/i.test(textoDe(b)));
    return naPagina[0] || null;
  }

  /* ----------------------------------------------- espelho do POST de lance */

  const RE_URL_LANCE = /lance|oferta|proposta|bid/i;
  let ultimoHttp = null;

  if (!window.__lancebotHttp) {
    window.__lancebotHttp = true;

    const fetchOriginal = window.fetch;
    if (typeof fetchOriginal === "function") {
      window.fetch = function (entrada, cfg) {
        const url = typeof entrada === "string" ? entrada : (entrada && entrada.url) || "";
        const metodo = String((cfg && cfg.method) || (entrada && entrada.method) || "GET").toUpperCase();
        const p = fetchOriginal.apply(this, arguments);
        if (metodo !== "GET" && RE_URL_LANCE.test(url)) {
          p.then((resp) => {
            const status = resp.status;
            resp.clone().text().then((t) => {
              ultimoHttp = { url: url, status: status, corpo: String(t).slice(0, 400), em: Date.now() };
            }).catch(() => {
              ultimoHttp = { url: url, status: status, corpo: "", em: Date.now() };
            });
          }).catch(() => { /* falha de rede aparece no desfecho como ausência de sinal */ });
        }
        return p;
      };
    }

    const XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const abrirOriginal = XHR.prototype.open;
      XHR.prototype.open = function (metodo, url) {
        this.__lb = { metodo: String(metodo).toUpperCase(), url: String(url) };
        return abrirOriginal.apply(this, arguments);
      };
      const enviarOriginal = XHR.prototype.send;
      XHR.prototype.send = function () {
        const info = this.__lb;
        if (info && info.metodo !== "GET" && RE_URL_LANCE.test(info.url)) {
          const xhr = this;
          xhr.addEventListener("loadend", () => {
            let corpo = "";
            try { corpo = String(xhr.responseText || "").slice(0, 400); } catch (e) { /* responseType binário */ }
            ultimoHttp = { url: info.url, status: xhr.status, corpo: corpo, em: Date.now() };
          });
        }
        return enviarOriginal.apply(this, arguments);
      };
    }
  }

  /* -------------------------------------------------- digitação e clique */

  const setorNativo = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  function definir(el, v) {
    if (setorNativo && setorNativo.set) setorNativo.set.call(el, v);
    else el.value = v;
  }

  /**
   * Digita caractere a caractere. Máscaras de moeda reescrevem o campo a cada tecla;
   * anexar o próximo caractere ao que a máscara deixou é o que faz o resultado bater.
   */
  async function digitar(el, texto) {
    el.focus();
    definir(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    for (const ch of String(texto)) {
      definir(el, el.value + ch);
      let evt;
      try { evt = new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }); }
      catch (e) { evt = new Event("input", { bubbles: true }); }
      el.dispatchEvent(evt);
      await espera(10);
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  /**
   * Preenche e CONFERE. Nenhum clique acontece se o campo não estiver exatamente com o
   * valor pedido — é a barreira contra máscara comendo centavo e virar lance errado.
   */
  async function preencher(el, valor) {
    const tentativas = [
      valor.toFixed(2).replace(".", ","),
      valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      String(Math.round(valor * 100)),
      valor.toFixed(2)
    ];
    for (const texto of tentativas) {
      await digitar(el, texto);
      await espera(70);
      const lido = paraNumero(el.value);
      if (lido !== null && Math.abs(lido - valor) < 0.005) return { ok: true, digitado: texto, campo: el.value };
    }
    const restou = el.value;
    await digitar(el, "");
    return { ok: false, campo: restou };
  }

  function clicar(el) {
    const op = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent("pointerdown", op)); } catch (e) { /* navegador antigo */ }
    el.dispatchEvent(new MouseEvent("mousedown", op));
    try { el.dispatchEvent(new PointerEvent("pointerup", op)); } catch (e) { /* idem */ }
    el.dispatchEvent(new MouseEvent("mouseup", op));
    el.click();
  }

  const RE_CONFIRMA = /^(sim|confirmar|confirmo|ok|enviar|continuar|prosseguir)\\b/i;
  function botaoConfirmacao() {
    const sel = '[role="dialog"],[role="alertdialog"],.modal,.p-dialog,.mat-dialog-container,.swal2-popup,.br-modal';
    const modais = Array.prototype.filter.call(document.querySelectorAll(sel), visivel);
    for (let i = modais.length - 1; i >= 0; i--) {
      const botoes = Array.prototype.filter.call(
        modais[i].querySelectorAll('button,[role="button"],input[type="submit"]'),
        (b) => visivel(b) && habilitado(b)
      );
      const alvo = botoes.find((b) => RE_CONFIRMA.test(textoDe(b)));
      if (alvo) return alvo;
    }
    return null;
  }

  const RE_SUCESSO = /sucesso|registrad|aceit|enviado com|lance efetuado|cadastrad/i;
  const RE_FALHA = /erro|inv[aá]lid|recusad|n[aã]o foi poss[ií]vel|maior que|menor que|n[aã]o permitid|expirad|falha/i;

  function mensagensDaTela() {
    const sel = '[role="alert"],[role="status"],.toast,.p-toast-message,.alert,.mat-snack-bar-container,.swal2-html-container,.br-message,.mensagem';
    return Array.prototype.filter.call(document.querySelectorAll(sel), visivel)
      .map((el) => (el.innerText || "").replace(/\\s+/g, " ").trim())
      .filter((t) => t.length > 0 && t.length < 300);
  }

  /* ------------------------------------------------------------ leitura */

  const RE_MENOR = /melhor\\s+lance|menor\\s+lance|lance\\s+atual|valor\\s+atual|melhor\\s+oferta|menor\\s+valor/i;
  const RE_NOSSO = /seu\\s+lance|meu\\s+lance|minha\\s+oferta|sua\\s+oferta|seu\\s+valor|[uú]ltimo\\s+lance\\s+enviado/i;

  function folhas(raiz) {
    return Array.prototype.filter.call(raiz.querySelectorAll("*"), (n) => n.children.length === 0 && visivel(n));
  }

  /** Valor de uma coluna de tabela identificada pelo cabeçalho. */
  function valorNaColuna(escopo, re) {
    const linha = escopo.closest ? escopo.closest("tr") : null;
    const tabela = linha ? linha.closest("table") : null;
    if (!linha || !tabela) return null;
    const cabecalhos = tabela.querySelectorAll("th");
    for (let i = 0; i < cabecalhos.length; i++) {
      if (!re.test(cabecalhos[i].textContent || "")) continue;
      const celulas = linha.querySelectorAll("td");
      const celula = celulas[i] || celulas[i - 1];
      if (!celula) continue;
      const v = valoresEm(celula.textContent || "");
      if (v.length) return v[0];
    }
    return null;
  }

  function valorRotulado(escopo, re) {
    const naColuna = valorNaColuna(escopo, re);
    if (naColuna !== null) return naColuna;

    const nos = folhas(escopo);
    for (let i = 0; i < nos.length; i++) {
      const t = (nos[i].textContent || "").replace(/\\s+/g, " ").trim();
      if (!t || t.length > 80 || !re.test(t)) continue;
      const proprios = valoresEm(t);
      if (proprios.length) return proprios[0];
      for (let j = i + 1; j < Math.min(nos.length, i + 5); j++) {
        const v = valoresEm((nos[j].textContent || "").trim());
        if (v.length) return v[0];
      }
    }
    return null;
  }

  const RE_FECHADO = /encerrad|fechad|finalizad|suspens|cancelad|homologad|adjudicad|desert|fracassad/i;
  const RE_ABERTO = /em\\s+disputa|aberto|recebendo\\s+lances|fase\\s+de\\s+lances|em\\s+andamento|aberta/i;

  function ler(itemNum) {
    const escopo = escopoItem(itemNum);
    if (!escopo) {
      return { ok: false, menorLance: null, nossoLance: null, aberto: true, evidencia: "",
               motivo: "Não encontrei o item " + itemNum + " na tela da sala. Confira se a sala aberta é a deste item." };
    }
    const texto = (escopo.innerText || "").replace(/\\s+/g, " ").trim();
    const campo = campoLance(escopo, itemNum);
    const noCampo = campo ? paraNumero(campo.value) : null;

    let menor = valorRotulado(escopo, RE_MENOR);
    const nosso = valorRotulado(escopo, RE_NOSSO);

    if (menor === null) {
      const todos = valoresEm(texto).filter((v) => noCampo === null || Math.abs(v - noCampo) > 0.005);
      menor = todos.length ? Math.min.apply(null, todos) : null;
    }

    let aberto = true;
    if (RE_FECHADO.test(texto) && !RE_ABERTO.test(texto)) aberto = false;

    return { ok: menor !== null, menorLance: menor, nossoLance: nosso, aberto: aberto,
             evidencia: texto.slice(0, 240),
             motivo: menor === null ? "Não achei nenhum valor de lance no bloco do item." : undefined };
  }

  /* ------------------------------------------------------------ diagnóstico */

  function diagnostico(itemNum) {
    const escopo = escopoItem(itemNum);
    const campo = campoLance(escopo, itemNum);
    const botao = botaoEnvio(escopo, campo);
    const raiz = escopo || document.body;
    return {
      url: location.href.slice(0, 200),
      titulo: document.title.slice(0, 120),
      escopoEncontrado: Boolean(escopo),
      textoEscopo: ((raiz.innerText || "").replace(/\\s+/g, " ").trim()).slice(0, 400),
      campoLance: campo ? caminhoCss(campo) + "  ·  rótulo: " + rotuloDe(campo).slice(0, 80) : null,
      botaoEnvio: botao ? caminhoCss(botao) + "  ·  texto: " + textoDe(botao).slice(0, 60) : null,
      entradasVisiveis: entradasCandidatas(raiz).length,
      botoesVisiveis: botoesCandidatos(raiz).length,
      valoresNaTela: valoresEm((raiz.innerText || "")).slice(0, 12)
    };
  }

  /* --------------------------------------------------------------- envio */

  async function enviar(itemNum, valor, opcoes) {
    const seco = Boolean(opcoes && opcoes.seco);
    const escopo = escopoItem(itemNum);
    const campo = campoLance(escopo, itemNum);
    if (!campo) {
      return { ok: false, etapa: "campo", aceito: false, confirmado: true,
               mensagem: "Não encontrei o campo de lance do item " + itemNum + " na sala aberta.",
               diagnostico: diagnostico(itemNum) };
    }
    const botao = botaoEnvio(escopo, campo);
    if (!botao) {
      return { ok: false, etapa: "botao", aceito: false, confirmado: true,
               mensagem: "Encontrei o campo de lance, mas nenhum botão de envio habilitado.",
               diagnostico: diagnostico(itemNum) };
    }

    const seletores = { campo: caminhoCss(campo), botao: caminhoCss(botao) };
    const confirmOriginal = window.confirm;
    const marco = Date.now();
    ultimoHttp = null;

    try {
      window.confirm = () => true;

      const p = await preencher(campo, valor);
      if (!p.ok) {
        return { ok: false, etapa: "preencher", aceito: false, confirmado: true,
                 mensagem: 'O campo não aceitou R$ ' + valor.toFixed(2) + ' (ficou "' + p.campo + '"). ' +
                           "Nenhum clique foi dado e o campo foi limpo.",
                 seletores: seletores };
      }

      if (seco) {
        await digitar(campo, "");
        return { ok: true, etapa: "ensaio", aceito: false, confirmado: true,
                 mensagem: "Ensaio: campo e botão localizados e o valor R$ " + valor.toFixed(2) +
                           " foi aceito pelo campo. Nenhum lance foi enviado.",
                 seletores: seletores };
      }

      clicar(botao);

      for (let i = 0; i < 20; i++) {
        await espera(200);
        const c = botaoConfirmacao();
        if (c) { clicar(c); break; }
        if (ultimoHttp && ultimoHttp.em >= marco) break;
      }

      for (let i = 0; i < 30; i++) {
        if (ultimoHttp && ultimoHttp.em >= marco) {
          const okHttp = ultimoHttp.status >= 200 && ultimoHttp.status < 300;
          return { ok: true, etapa: "enviado", aceito: okHttp, confirmado: true,
                   mensagem: "HTTP " + ultimoHttp.status + " · " +
                             String(ultimoHttp.url).replace(/^https?:\\/\\//, "").slice(0, 80) +
                             (ultimoHttp.corpo ? " · " + ultimoHttp.corpo.slice(0, 160) : ""),
                   seletores: seletores };
        }
        const avisos = mensagensDaTela();
        const falha = avisos.find((a) => RE_FALHA.test(a));
        if (falha) {
          return { ok: true, etapa: "enviado", aceito: false, confirmado: true,
                   mensagem: "O portal respondeu: " + falha, seletores: seletores };
        }
        const sucesso = avisos.find((a) => RE_SUCESSO.test(a));
        if (sucesso) {
          return { ok: true, etapa: "enviado", aceito: true, confirmado: true,
                   mensagem: "O portal respondeu: " + sucesso, seletores: seletores };
        }
        await espera(200);
      }

      return { ok: true, etapa: "enviado", aceito: false, confirmado: false,
               mensagem: "Cliquei no botão de lance, mas o portal não confirmou o envio em 6 segundos. " +
                         "O robô para aqui para não repetir um lance que pode ter sido registrado — confira a sala.",
               seletores: seletores };
    } finally {
      window.confirm = confirmOriginal;
    }
  }

  /* ------------------------------------------------- disputas visíveis */

  function acharPregao(texto) {
    const t = String(texto || "");
    const m = t.match(/[?&]compra(?:Id)?=(\\d{4,12})/i) ||
              t.match(/\\b(\\d{5,6}\\s*\\/\\s*\\d{4})\\b/) ||
              t.match(/preg[aã]o[^\\d]{0,15}(\\d{4,9})/i) ||
              t.match(/\\bcompra[^\\d]{0,10}(\\d{4,9})/i) ||
              t.match(/\\bUASG[^\\d]{0,10}(\\d{6})\\b/i);
    return m ? String(m[1] || m[0]).replace(/\\s+/g, "") : "";
  }

  /**
   * Pregão do cabeçalho da página. Dentro da sala, o número do pregão aparece uma vez no
   * topo e as linhas trazem só os itens — sem este passo, "listar" não devolvia nada
   * justamente na tela onde o robô opera.
   */
  function pregaoDaPagina() {
    const fontes = [location.search, location.pathname, document.title];
    const titulo = document.querySelector("h1,h2,.titulo,.page-title,header");
    if (titulo) fontes.push((titulo.textContent || "").slice(0, 300));
    for (const f of fontes) {
      const achado = acharPregao(f);
      if (achado) return achado;
    }
    return "";
  }

  /** Número do item pela coluna "Item" da tabela, quando a linha não o escreve por extenso. */
  function itemNaColuna(linha) {
    const tabela = linha.closest ? linha.closest("table") : null;
    if (!tabela) return "";
    const cabecalhos = tabela.querySelectorAll("th");
    for (let i = 0; i < cabecalhos.length; i++) {
      if (!/^\\s*(n[ºo°.]?\\s*)?item\\b/i.test(cabecalhos[i].textContent || "")) continue;
      const celulas = linha.querySelectorAll("td");
      const m = celulas[i] ? (celulas[i].textContent || "").match(/\\d{1,5}/) : null;
      if (m) return m[0];
    }
    return "";
  }

  function listar() {
    const doPregaoDaPagina = pregaoDaPagina();
    const vistos = new Set();
    const saida = [];
    const linhas = document.querySelectorAll('tr,[role="row"],li,.card,.item,article');

    for (const el of linhas) {
      if (!visivel(el)) continue;
      const t = (el.innerText || "").replace(/\\s+/g, " ").trim();
      if (!t || t.length < 6 || t.length > 400) continue;

      const pregaoId = acharPregao(t) || doPregaoDaPagina;
      if (!pregaoId) continue;

      const mItem = t.match(/\\bitem[^\\d]{0,6}(\\d{1,5})\\b/i);
      const itemNum = mItem ? mItem[1] : itemNaColuna(el);

      // Linha sem item e sem valor não descreve disputa nenhuma — é cabeçalho ou menu.
      if (!itemNum && valoresEm(t).length === 0) continue;

      const chave = pregaoId + "#" + itemNum;
      if (vistos.has(chave)) continue;
      vistos.add(chave);

      const mSit = t.match(/(em\\s+disputa|fase\\s+de\\s+lances|recebendo\\s+lances|em\\s+andamento|encerrad\\w*|suspens\\w*|homologad\\w*|adjudicad\\w*|julgament\\w*|abert\\w*|aguardando[^.,;]{0,25})/i);
      saida.push({
        pregaoId: pregaoId,
        itemNum: itemNum,
        descricao: t.slice(0, 180),
        situacao: mSit ? mSit[1] : ""
      });
      if (saida.length >= 200) break;
    }
    return saida;
  }

  /* ------------------------------------- aprendizado a partir do operador */

  // Registra qual campo e qual botão o operador usou de verdade. Não é pré-requisito
  // para operar — é o conserto para o dia em que o portal mudar e a heurística errar.
  let ultimoCampoTocado = null;
  document.addEventListener("input", (ev) => {
    const el = ev.target;
    if (el && el.tagName === "INPUT" && RE_CAMPO.test(rotuloDe(el))) ultimoCampoTocado = el;
  }, true);

  document.addEventListener("click", (ev) => {
    const botao = ev.target && ev.target.closest ? ev.target.closest('button,[role="button"],input[type="submit"]') : null;
    if (!botao) return;
    const t = textoDe(botao);
    if (!RE_BOTAO.test(t) || RE_BOTAO_NAO.test(t)) return;
    if (!ultimoCampoTocado) return;
    window.__lancebotSala.aprendido = {
      campo: caminhoCss(ultimoCampoTocado),
      botao: caminhoCss(botao),
      aprendidoEm: new Date().toISOString()
    };
    window.__lancebotSala.aprendidoNovo = true;
  }, true);

  window.__lancebotSala = {
    versao: VERSAO,
    aprendido: APRENDIDO,
    aprendidoNovo: false,
    ler: ler,
    enviar: enviar,
    listar: listar,
    diagnostico: diagnostico
  };

  return "ativo";
})();
`;
}
