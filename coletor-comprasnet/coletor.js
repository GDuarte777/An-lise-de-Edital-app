/**
 * Coletor de estrutura da tela de lances.
 *
 * O robô nunca viu o HTML verdadeiro do portal — todo localizador escrito até aqui foi
 * chute. Este arquivo resolve isso: o operador abre um pregão real, clica em "Coletar",
 * e sai um arquivo com o ESQUELETO da página.
 *
 * O que sai: nomes de tag, id, classe, rótulo, placeholder, cabeçalho de tabela, caminho
 * CSS, e a lista de requisições que a própria página fez.
 *
 * O que NÃO sai: todo dígito é substituído por "#" antes de gravar. "R$ 1.250,50" vira
 * "R$ #.###,##". Valor de lance, CNPJ, número de pregão e nome de empresa não atravessam.
 * O arquivo fica no computador do operador — nada é enviado para lugar nenhum.
 */
(() => {
  if (window.__horasisColetorAtivo) return;
  window.__horasisColetorAtivo = true;

  const VERSAO = 1;
  const INICIO = Date.now();

  /* ------------------------------------------------------------ mascaramento */

  /** Todo dígito vira "#": preserva a forma do dado sem carregar o dado. */
  const mascarar = (texto, limite = 200) =>
    String(texto == null ? "" : texto).replace(/\s+/g, " ").trim().replace(/\d/g, "#").slice(0, limite);

  /**
   * Em URL o que interessa é o desenho da rota, não o identificador. Só corridas de
   * 3+ dígitos viram {n}, para não destruir "v1" ou "comprasnet-web".
   */
  const mascararUrl = (url) => String(url || "").replace(/\d{3,}/g, "{n}").slice(0, 300);

  /* -------------------------------------------------------------- utilidades */

  const visivel = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };

  const caminhoCss = (el) => {
    if (!el) return "";
    const partes = [];
    let n = el;
    while (n && n.nodeType === 1 && partes.length < 8) {
      const fc = n.getAttribute && n.getAttribute("formcontrolname");
      if (fc) { partes.unshift(n.tagName.toLowerCase() + '[formcontrolname="' + fc + '"]'); break; }
      if (n.id && !/\d{4,}/.test(n.id)) { partes.unshift("#" + n.id); break; }
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
  };

  const atributos = (el) => {
    const saida = {};
    for (const nome of ["type", "name", "id", "placeholder", "aria-label", "title", "formcontrolname", "role", "maxlength", "inputmode"]) {
      const v = el.getAttribute && el.getAttribute(nome);
      if (v) saida[nome] = mascarar(v, 80);
    }
    if (el.className && typeof el.className === "string") saida["class"] = mascarar(el.className, 120);
    return saida;
  };

  /** Rótulo do campo: <label for>, label envolvente, ou o texto da célula anterior. */
  const rotuloDe = (el) => {
    const pedacos = [];
    if (el.id) {
      try {
        const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (l) pedacos.push(l.textContent);
      } catch (e) { /* id inválido como seletor */ }
    }
    const env = el.closest && el.closest("label");
    if (env) pedacos.push(env.textContent);
    const celula = el.closest && el.closest("td");
    if (celula && celula.previousElementSibling) pedacos.push(celula.previousElementSibling.textContent);
    return mascarar(pedacos.join(" | "), 120);
  };

  /* --------------------------------------------------- buffers de observação */

  const rede = [];
  const tempoReal = [];
  const cliques = [];
  const mutacoes = new Map();

  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || d.__horasisColetor !== true) return;
    if (d.tipo === "rede") {
      rede.push({ via: d.via, metodo: d.metodo, url: mascararUrl(d.url), status: d.status, em: d.em, ms: d.ms });
      if (rede.length > 400) rede.shift();
    } else if (d.tipo === "tempo-real") {
      tempoReal.push({ canal: d.canal, url: mascararUrl(d.url), em: d.em });
    }
  });

  // Cada clique do operador é anotado. Depois correlacionamos com o que a rede fez em
  // seguida — é assim que descobrimos QUAL requisição o botão "Atualizar" dispara.
  document.addEventListener(
    "click",
    (ev) => {
      const alvo = ev.target && ev.target.closest
        ? ev.target.closest('button,[role="button"],a,input[type="submit"],input[type="button"]')
        : null;
      if (!alvo) return;
      cliques.push({
        em: Date.now(),
        texto: mascarar(alvo.innerText || alvo.value || alvo.getAttribute("aria-label") || "", 60),
        seletor: caminhoCss(alvo),
        atributos: atributos(alvo)
      });
      if (cliques.length > 60) cliques.shift();
    },
    true
  );

  // Regiões que se redesenham sozinhas. Se nada mudar sem clique, está provado que a
  // tela é estática e o robô precisa provocar a atualização.
  try {
    new MutationObserver((lista) => {
      for (const m of lista) {
        const alvo = m.target && m.target.nodeType === 1 ? m.target : m.target && m.target.parentElement;
        if (!alvo || !visivel(alvo)) continue;
        const chave = caminhoCss(alvo);
        if (!chave) continue;
        const atual = mutacoes.get(chave) || { vezes: 0, exemplo: "" };
        atual.vezes++;
        if (!atual.exemplo) atual.exemplo = mascarar(alvo.textContent, 100);
        mutacoes.set(chave, atual);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  } catch (e) { /* página sem body ainda */ }

  /* ------------------------------------------------------ contagem de recargas */

  const CHAVE_RECARGA = "__horasisRecargas";
  let recargas = 0;
  try {
    recargas = Number(sessionStorage.getItem(CHAVE_RECARGA) || "0") + 1;
    sessionStorage.setItem(CHAVE_RECARGA, String(recargas));
  } catch (e) { /* storage bloqueado */ }

  const tipoNavegacao = (() => {
    try {
      const e = performance.getEntriesByType("navigation")[0];
      return e ? e.type : "desconhecido";
    } catch (e) { return "desconhecido"; }
  })();

  /* --------------------------------------------------------------- varreduras */

  const RE_ATUALIZAR = /atualiz|refresh|recarreg|sincroniz/i;
  const RE_LANCE = /lance|oferta|proposta|ofertar|enviar/i;
  const RE_SESSAO = /sess[aã]o|expirad|desconect|inatividade|tempo\s+restante|permanecer\s+conectad|continuar\s+conectad/i;

  function varrerCampos() {
    return Array.prototype.filter.call(document.querySelectorAll("input,select,textarea"), visivel).map((el) => ({
      tag: el.tagName.toLowerCase(),
      seletor: caminhoCss(el),
      atributos: atributos(el),
      rotulo: rotuloDe(el),
      valorFormato: mascarar(el.value, 40),
      desabilitado: Boolean(el.disabled || el.readOnly)
    }));
  }

  function varrerBotoes() {
    const sel = 'button,[role="button"],input[type="submit"],input[type="button"],a.btn,a.button';
    return Array.prototype.filter.call(document.querySelectorAll(sel), visivel).map((el) => {
      const texto = mascarar(el.innerText || el.value || el.getAttribute("aria-label") || "", 60);
      return {
        seletor: caminhoCss(el),
        texto,
        atributos: atributos(el),
        desabilitado: Boolean(el.disabled || el.getAttribute("aria-disabled") === "true"),
        pareceAtualizar: RE_ATUALIZAR.test(texto),
        pareceLance: RE_LANCE.test(texto)
      };
    });
  }

  function varrerTabelas() {
    return Array.prototype.filter.call(document.querySelectorAll("table"), visivel).map((t) => ({
      seletor: caminhoCss(t),
      cabecalhos: Array.prototype.map.call(t.querySelectorAll("th"), (th) => mascarar(th.textContent, 60)),
      colunas: t.querySelectorAll("tr") .length ? (t.querySelector("tr") || { children: [] }).children.length : 0,
      linhas: t.querySelectorAll("tbody tr").length,
      primeiraLinhaFormato: Array.prototype.map.call(
        (t.querySelector("tbody tr") || { children: [] }).children,
        (td) => mascarar(td.textContent, 40)
      )
    }));
  }

  function varrerAvisosDeSessao() {
    const achados = [];
    const nos = document.querySelectorAll("body *");
    for (const el of nos) {
      if (el.children.length > 0 || !visivel(el)) continue;
      const t = (el.textContent || "").trim();
      if (!t || t.length > 200 || !RE_SESSAO.test(t)) continue;
      achados.push({ seletor: caminhoCss(el), texto: mascarar(t, 160) });
      if (achados.length >= 20) break;
    }
    return achados;
  }

  /** Correlaciona cada clique com o que a rede fez nos 4 segundos seguintes. */
  function correlacionarCliques() {
    return cliques.map((c) => ({
      texto: c.texto,
      seletor: c.seletor,
      atributos: c.atributos,
      requisicoesDepois: rede
        .filter((r) => r.em >= c.em && r.em <= c.em + 4000)
        .map((r) => ({ metodo: r.metodo, url: r.url, status: r.status, ms: r.ms }))
    }));
  }

  function montar() {
    const mut = [...mutacoes.entries()]
      .sort((a, b) => b[1].vezes - a[1].vezes)
      .slice(0, 25)
      .map(([seletor, v]) => ({ seletor, vezes: v.vezes, exemplo: v.exemplo }));

    return {
      versao: VERSAO,
      coletadoEm: new Date().toISOString(),
      janelaDeObservacaoSegundos: Math.round((Date.now() - INICIO) / 1000),
      pagina: {
        url: mascararUrl(location.href),
        titulo: mascarar(document.title, 120),
        ehTopo: window.top === window.self,
        tipoNavegacao,
        recargasNestaAba: recargas
      },
      temTempoReal: tempoReal.length > 0,
      tempoReal,
      campos: varrerCampos(),
      botoes: varrerBotoes(),
      tabelas: varrerTabelas(),
      atualizacao: {
        botoesComCaraDeAtualizar: varrerBotoes().filter((b) => b.pareceAtualizar),
        cliquesObservados: correlacionarCliques(),
        regioesQueMudaramSozinhas: mut
      },
      sessao: { avisosEncontrados: varrerAvisosDeSessao() },
      rede: rede.slice(-150)
    };
  }

  /* ----------------------------------------------------------------- botão */

  function baixar() {
    const dados = montar();
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const marca = new Date().toISOString().replace(/[:.]/g, "-");
    a.download = "horasis-estrutura-" + (window.top === window.self ? "topo" : "quadro") + "-" + marca + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    return dados;
  }

  // O botão vive dentro de um shadow root para o CSS do portal não alcançá-lo — e para
  // ele não alcançar o CSS do portal.
  function montarBotao() {
    const temCampo = document.querySelectorAll("input,button").length > 0;
    if (!temCampo && window.top !== window.self) return;

    const hospedeiro = document.createElement("div");
    hospedeiro.style.cssText = "position:fixed;z-index:2147483647;right:14px;bottom:14px";
    const raiz = hospedeiro.attachShadow({ mode: "closed" });
    raiz.innerHTML =
      '<style>' +
      '.cx{font:13px/1.4 system-ui,sans-serif;background:#0B0D12;color:#E9EDF5;padding:10px 12px;' +
      'border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.45);max-width:260px}' +
      '.b{margin-top:8px;width:100%;background:#2D6BF0;color:#fff;border:0;border-radius:6px;' +
      'padding:7px 10px;cursor:pointer;font:600 13px system-ui,sans-serif}' +
      '.f{opacity:.65;font-size:11px;margin-top:6px}' +
      '</style>' +
      '<div class="cx"><div><strong>Coletor HORASIS</strong></div>' +
      '<div class="f">Clique em "Atualizar" do portal uma vez, espere uns 20s, e então colete.</div>' +
      '<button class="b" id="ir">Coletar estrutura</button>' +
      '<div class="f" id="st">Nenhum dígito é gravado.</div></div>';

    const st = raiz.getElementById("st");

    // Mostra que o coletor está vivo ANTES de clicar. Sem isso o operador não tem como
    // saber se a captura está acontecendo, e descobriria só depois, no arquivo vazio.
    const atualizarPainel = () => {
      st.textContent =
        entradasCandidatasContagem() + " campos · " + rede.length + " requisições vistas · " +
        "tempo real: " + (tempoReal.length > 0 ? "SIM" : "não");
    };
    const entradasCandidatasContagem = () =>
      Array.prototype.filter.call(document.querySelectorAll("input,select,textarea"), visivel).length;
    setInterval(atualizarPainel, 2000);
    atualizarPainel();

    raiz.getElementById("ir").addEventListener("click", () => {
      const d = baixar();
      st.textContent =
        "SALVO: " + d.campos.length + " campos · " + d.botoes.length + " botões · " +
        d.rede.length + " requisições · tempo real: " + (d.temTempoReal ? "SIM" : "não");
    });

    document.documentElement.appendChild(hospedeiro);
  }

  // Exposto de propósito: se o botão não aparecer (portal com CSP agressivo, quadro
  // aninhado), o operador ainda consegue rodar `__horasisColetor.baixar()` pelo console.
  // É também o que torna este arquivo testável fora do navegador do operador.
  window.__horasisColetor = { montar, baixar };

  if (document.body) montarBotao();
  else document.addEventListener("DOMContentLoaded", montarBotao);
})();
