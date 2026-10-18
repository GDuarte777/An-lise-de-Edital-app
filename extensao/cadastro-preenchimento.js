// ═══════════════════════════════════════════════════════════════════════
// HORASIS — Cadastro de fornecedor · preenchimento automático
//
// Roda na página do portal e escreve nos campos do formulário de cadastro. As
// regras de "que campo é este" e "em que formato escrever" não estão aqui:
// estão em `cadastro-campos.js`, que é puro e testado. Aqui fica só o que
// depende do DOM — achar o rótulo de um campo, disparar os eventos que fazem
// a máscara e o framework da página perceberem o texto, e montar o painel.
//
// Três coisas que esta extensão nunca faz, e que são o motivo de ela poder
// rodar sozinha num cadastro com efeito legal:
//
//   1. Nunca inventa valor. Campo sem dado guardado fica em branco e vai para
//      a lista de conferência do painel.
//   2. Nunca envia o formulário. Não clica em Salvar, Continuar ou Enviar —
//      quem confere e assina é o fornecedor.
//   3. Nunca toca em campo de senha, de arquivo ou de captcha.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  if (window.__HZ_CADASTRO_ATIVO__) return;
  window.__HZ_CADASTRO_ATIVO__ = true;

  const HZ = globalThis.HZ_CADASTRO;
  if (!HZ) {
    console.warn('[HORASIS] cadastro-campos.js não carregou; o preenchimento não vai rodar.');
    return;
  }

  const TIPOS_IGNORADOS = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file', 'password', 'range', 'color']);
  const MARCA = 'hzCadastro';

  let perfil = null;
  let opcoes = { auto: true, sobrescrever: false };
  let ultimoResultado = { preenchidos: [], semDado: [], naoReconhecidos: 0 };

  // ─── Leitura da página ───────────────────────────────────────────────

  /**
   * O campo está à vista?
   *
   * Importa por causa do assistente de vários passos: os campos do passo 4
   * existem no DOM enquanto o passo 1 está aberto, só que escondidos — e
   * preenchê-los antes da hora faz a validação do portal reclamar de campo
   * que o operador nem viu. O caminho rápido é `offsetParent`; quando ele é
   * nulo (elemento fixo, ou página sem layout calculado) quem decide é o
   * estilo, que é o que marca o passo fechado.
   */
  function visivel(el) {
    if (el.offsetParent !== null) return true;
    const caixa = el.getBoundingClientRect();
    if (caixa.width > 0 || caixa.height > 0) return true;
    for (let no = el; no && no.nodeType === 1; no = no.parentElement) {
      const estilo = getComputedStyle(no);
      if (estilo.display === 'none' || estilo.visibility === 'hidden') return false;
    }
    return true;
  }

  function utilizavel(el) {
    if (el.disabled || el.readOnly) return false;
    const tipo = String(el.type || '').toLowerCase();
    if (TIPOS_IGNORADOS.has(tipo)) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('#hz-cad-painel')) return false;
    // Campo em passo ainda não aberto do assistente: o observador volta aqui
    // quando ele aparecer.
    return visivel(el);
  }

  /** Texto de um elemento, sem o texto dos campos que ele contém. */
  function textoProprio(el) {
    const copia = el.cloneNode(true);
    copia.querySelectorAll('input, select, textarea, button, script, style').forEach((n) => n.remove());
    return copia.textContent || '';
  }

  function limparRotulo(texto) {
    return String(texto || '')
      .replace(/\s+/g, ' ')
      .replace(/[*:•]+\s*$/, '')
      .trim()
      .slice(0, 120);
  }

  const SELETOR_TITULO = 'legend, h1, h2, h3, h4, h5, .card-header, .panel-heading, .titulo, .title, .form-section-title';

  /**
   * O rótulo quando o portal não usa `<label for>`.
   *
   * Metade dos portais estaduais monta o formulário em tabela, ou em `div`s
   * com o texto solto antes do campo. Sem esta busca por proximidade, o
   * reconhecimento cairia para os atributos `name`/`id` — que em sistema
   * antigo costumam ser `txt01`, `campo7`.
   */
  function rotuloPorProximidade(el, usados) {
    const livre = (no) => !usados || !usados.has(no);
    const usar = (no, texto) => { if (usados) usados.add(no); return texto; };

    let no = el;
    for (let altura = 0; altura < 4 && no; altura += 1) {
      const pai = no.parentElement;
      if (!pai) break;

      const etiqueta = pai.querySelector(':scope > label, :scope > .control-label, :scope > .form-label');
      if (etiqueta && !etiqueta.contains(el) && livre(etiqueta)) {
        const texto = limparRotulo(textoProprio(etiqueta));
        if (texto) return usar(etiqueta, texto);
      }

      // Layout em tabela: o rótulo é a célula anterior, ou o cabeçalho.
      const celula = no.closest ? no.closest('td, th') : null;
      const anterior = celula && celula.previousElementSibling;
      if (anterior && livre(anterior)) {
        const texto = limparRotulo(textoProprio(anterior));
        if (texto && texto.length <= 60) return usar(anterior, texto);
      }

      // Texto solto imediatamente antes do campo, dentro do mesmo bloco.
      let irmao = no.previousElementSibling;
      for (let passos = 0; irmao && passos < 3; passos += 1) {
        if (!irmao.querySelector('input, select, textarea') && livre(irmao)) {
          const texto = limparRotulo(textoProprio(irmao));
          if (texto && texto.length <= 60) return usar(irmao, texto);
        }
        irmao = irmao.previousElementSibling;
      }

      no = pai;
    }
    return '';
  }

  function rotuloDe(el, usados) {
    const partes = [];
    const consumir = (no, texto) => {
      if (!texto) return;
      if (usados) {
        if (usados.has(no)) return;
        usados.add(no);
      }
      partes.push(texto);
    };

    if (el.id) {
      try {
        const etiqueta = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (etiqueta) consumir(etiqueta, textoProprio(etiqueta));
      } catch (_) { /* id com caractere que o seletor não aceita */ }
    }
    const envolvente = el.closest('label');
    if (envolvente) consumir(envolvente, textoProprio(envolvente));
    const aria = el.getAttribute('aria-label');
    if (aria) partes.push(aria);
    const referencias = el.getAttribute('aria-labelledby');
    if (referencias) {
      referencias.split(/\s+/).forEach((id) => {
        const no = document.getElementById(id);
        if (no) consumir(no, no.textContent);
      });
    }
    const texto = limparRotulo(partes.filter(Boolean).join(' '));
    return texto || rotuloPorProximidade(el, usados);
  }

  /**
   * O rótulo de um grupo de radios ou de caixas.
   *
   * Ele não fica antes do bloco, e sim dentro dele, como irmão das opções:
   * um `<label>Possui assinatura digital</label>` seguido dos rótulos "Sim" e
   * "Não". Procurar só na vizinhança do bloco acharia o título da seção.
   */
  function rotuloDoBloco(bloco, usados) {
    if (!bloco) return '';
    const candidatos = bloco.querySelectorAll(
      ':scope > label, :scope > legend, :scope > .control-label, :scope > .form-label, '
      + ':scope > span, :scope > p, :scope > b, :scope > strong, :scope > div, :scope > td, :scope > th',
    );
    for (const candidato of candidatos) {
      if (candidato.querySelector('input, select, textarea')) continue;
      if (usados && usados.has(candidato)) continue;
      const texto = limparRotulo(textoProprio(candidato));
      if (texto && texto.length <= 80) {
        if (usados) usados.add(candidato);
        return texto;
      }
    }
    return '';
  }

  function atributosDe(el) {
    return [el.getAttribute('name'), el.getAttribute('id'), el.getAttribute('placeholder'), el.getAttribute('title')]
      .filter(Boolean)
      .join(' ');
  }

  /**
   * O título da seção em que o campo está.
   *
   * É o que separa a "Cidade" do endereço da "Cidade" da agência bancária —
   * os dois rótulos são a mesma palavra, e só a seção diz qual é qual.
   */
  function contextoDe(el) {
    const pedacos = [];
    let no = el;
    for (let altura = 0; altura < 6 && no && pedacos.length < 3; altura += 1) {
      const pai = no.parentElement;
      if (!pai) break;
      const proprio = pai.querySelector(':scope > ' + SELETOR_TITULO.split(', ').join(', :scope > '));
      if (proprio && !proprio.contains(el)) pedacos.push(textoProprio(proprio));

      let irmao = pai.previousElementSibling;
      for (let passos = 0; irmao && passos < 4; passos += 1) {
        if (irmao.matches && irmao.matches(SELETOR_TITULO)) { pedacos.push(textoProprio(irmao)); break; }
        irmao = irmao.previousElementSibling;
      }
      no = pai;
    }
    return limparRotulo(pedacos.join(' ')).slice(0, 160);
  }

  // ─── Escrita ─────────────────────────────────────────────────────────

  /**
   * Escreve no campo de um jeito que o portal perceba.
   *
   * Atribuir `el.value` direto não basta em lugar nenhum: o React guarda o
   * valor anterior num rastreador interno e descarta o evento se o valor
   * dele não mudou, e as máscaras em jQuery só reformatam no `keyup`. Por
   * isso o valor vai pelo setter nativo do protótipo (que o React não
   * substitui) e os quatro eventos saem em seguida.
   */
  function escrever(el, texto) {
    const prototipo = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descritor = Object.getOwnPropertyDescriptor(prototipo, 'value');
    try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
    if (descritor && descritor.set) descritor.set.call(el, texto); else el.value = texto;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function escreverSelect(el, indice) {
    const descritor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    const valor = el.options[indice].value;
    if (descritor && descritor.set) descritor.set.call(el, valor); else el.selectedIndex = indice;
    if (el.selectedIndex !== indice) el.selectedIndex = indice;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function marcar(el, deveEstarMarcado) {
    if (el.checked === deveEstarMarcado) return false;
    el.click();
    if (el.checked !== deveEstarMarcado) {
      el.checked = deveEstarMarcado;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  function destacar(el) {
    el.style.transition = 'box-shadow .3s, background-color .3s';
    el.style.boxShadow = '0 0 0 2px rgba(192, 154, 82, .85)';
    el.style.backgroundColor = 'rgba(192, 154, 82, .10)';
    setTimeout(() => { el.style.boxShadow = ''; el.style.backgroundColor = ''; }, 4000);
  }

  function jaPreenchido(el) {
    if (el.tagName === 'SELECT') return el.selectedIndex > 0 && !!(el.value || '').trim();
    return !!String(el.value || '').trim();
  }

  // ─── A varredura ─────────────────────────────────────────────────────

  /** Agrupa os radios por `name`, que é o que o HTML usa para formar grupo. */
  function agruparRadios(campos) {
    const grupos = new Map();
    campos.forEach((el) => {
      if (String(el.type).toLowerCase() !== 'radio') return;
      const chave = el.name || el.id;
      if (!chave) return;
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(el);
    });
    return grupos;
  }

  /** O menor elemento que contém o grupo inteiro — é onde mora o rótulo dele. */
  function ancestralComum(elementos) {
    let no = elementos[0];
    while (no && no.parentElement) {
      no = no.parentElement;
      if (elementos.every((el) => no.contains(el))) return no;
    }
    return elementos[0].parentElement;
  }

  function preencher({ manual }) {
    const preenchidos = [];
    const semDado = [];
    let naoReconhecidos = 0;

    if (!perfil) return { preenchidos, semDado, naoReconhecidos, semPerfil: true };

    const campos = Array.from(document.querySelectorAll('input, select, textarea')).filter(utilizavel);
    const gruposRadio = agruparRadios(campos);
    const radiosTratados = new Set();
    // Cada rótulo serve a um campo só. É o que distingue a caixinha do
    // dígito verificador, que fica na mesma linha da agência e sem rótulo
    // próprio, de um segundo campo de agência: sem isso ela herdaria o
    // rótulo do vizinho e receberia o número da agência inteiro.
    const rotulosUsados = new Set();
    let ultimoId = null;

    for (const el of campos) {
      if (el.dataset[MARCA] === 'ok' && !manual) continue;

      const tipo = String(el.type || '').toLowerCase();
      const rotulo = rotuloDe(el, rotulosUsados);
      const contexto = contextoDe(el);

      // ─── Grupo de radios (Sim/Não, Pessoa física/jurídica) ───────────
      if (tipo === 'radio') {
        const chave = el.name || el.id;
        if (radiosTratados.has(chave)) continue;
        radiosTratados.add(chave);
        const grupo = gruposRadio.get(chave) || [el];
        const bloco = ancestralComum(grupo);
        const rotuloGrupo = rotuloDoBloco(bloco, rotulosUsados)
          || rotuloPorProximidade(bloco, rotulosUsados)
          || contextoDe(bloco);
        const achado = HZ.reconhecerCampo({ rotulo: rotuloGrupo, atributos: chave, contexto });
        if (!achado) { naoReconhecidos += 1; continue; }

        const definicao = HZ.POR_ID[achado.id];
        const valor = HZ.valorDoPerfil(perfil, achado.id);
        if (valor == null || valor === '') { semDado.push(definicao.rotulo); continue; }

        const escolhido = grupo.find((radio) => {
          const texto = rotuloDe(radio);
          return definicao.tipo === 'sim-nao'
            ? HZ.combinaSimNao(texto, valor)
            : HZ.normalizar(texto) === HZ.normalizar(valor);
        });
        if (!escolhido) { semDado.push(definicao.rotulo); continue; }
        if (marcar(escolhido, true)) { destacar(escolhido); preenchidos.push(definicao.rotulo); }
        grupo.forEach((radio) => { radio.dataset[MARCA] = 'ok'; });
        ultimoId = achado.id;
        continue;
      }

      // ─── Caixa de seleção isolada ────────────────────────────────────
      if (tipo === 'checkbox') {
        let id = (HZ.reconhecerCampo({ rotulo, atributos: atributosDe(el), contexto }) || {}).id;
        // "Isento", sozinho, não diz de que inscrição se trata: quem diz é o
        // campo que veio imediatamente antes dele no formulário.
        if (!id && /^isent/.test(HZ.normalizar(rotulo))) id = HZ.resolverIsento(ultimoId);
        // "Comércio", "Indústria", "Serviço": opções de um campo múltiplo.
        const multi = id ? null : HZ.reconhecerOpcaoMulti(rotulo, { rotulo: rotuloPorProximidade(el.parentElement), contexto });
        if (multi) {
          const valor = HZ.valorDoPerfil(perfil, multi.campoId);
          if (valor == null || valor === '') { semDado.push(HZ.POR_ID[multi.campoId].rotulo); continue; }
          if (marcar(el, HZ.marcadoEmMulti(multi.opcao, valor))) destacar(el);
          el.dataset[MARCA] = 'ok';
          preenchidos.push(HZ.POR_ID[multi.campoId].rotulo + ' · ' + multi.opcao);
          continue;
        }
        if (!id) { naoReconhecidos += 1; continue; }
        const definicao = HZ.POR_ID[id];
        const valor = HZ.valorDoPerfil(perfil, id);
        if (valor == null || valor === '') { semDado.push(definicao.rotulo); continue; }
        if (marcar(el, /^(sim|s|true|1)$/.test(HZ.normalizar(valor)))) { destacar(el); preenchidos.push(definicao.rotulo); }
        el.dataset[MARCA] = 'ok';
        ultimoId = id;
        continue;
      }

      // ─── Campo de texto, data, número e select ───────────────────────
      let id = (HZ.reconhecerCampo({ rotulo, atributos: atributosDe(el), contexto }) || {}).id;
      if (!id) {
        // A caixinha pequena logo depois da agência ou da conta é o dígito
        // verificador; ela quase nunca tem rótulo próprio.
        const limite = Number(el.getAttribute('maxlength'));
        if (!rotulo && Number.isFinite(limite) && limite > 0 && limite <= 2) id = HZ.resolverDigitoSolto(ultimoId);
      }
      if (!id) { naoReconhecidos += 1; continue; }

      const definicao = HZ.POR_ID[id];
      ultimoId = id;

      if (jaPreenchido(el) && !opcoes.sobrescrever) continue;

      if (el.tagName === 'SELECT') {
        const valor = HZ.valorDoPerfil(perfil, id);
        if (valor == null || valor === '') { semDado.push(definicao.rotulo); continue; }
        const lista = Array.from(el.options).map((o) => ({ texto: o.textContent, valor: o.value }));
        const indice = HZ.escolherOpcao(lista, valor, definicao.tipo);
        if (indice < 0) {
          // Nenhuma opção corresponde ao que o fornecedor guardou. Escolher a
          // mais parecida seria declarar outra coisa — fica para ele.
          semDado.push(definicao.rotulo + ' (nenhuma opção corresponde a "' + valor + '")');
          continue;
        }
        escreverSelect(el, indice);
        destacar(el);
        el.dataset[MARCA] = 'ok';
        preenchidos.push(definicao.rotulo);
        continue;
      }

      const texto = HZ.formatarParaCampo(definicao, perfil, {
        tipoInput: tipo,
        maxlength: Number(el.getAttribute('maxlength')) || null,
      });
      if (!texto) { semDado.push(definicao.rotulo); continue; }

      escrever(el, texto);
      destacar(el);
      el.dataset[MARCA] = 'ok';
      preenchidos.push(definicao.rotulo);
    }

    return { preenchidos, semDado: Array.from(new Set(semDado)), naoReconhecidos };
  }

  // ─── Painel ──────────────────────────────────────────────────────────

  const CSS_PAINEL = `
    #hz-cad-painel {
      position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
      width: 320px; max-height: 70vh; overflow: auto;
      background: #0C1428; color: #EEF1F7; border: 1px solid #2A3A63; border-radius: 12px;
      box-shadow: 0 16px 40px rgba(0,0,0,.45); font: 12px/1.5 'Segoe UI', Inter, system-ui, sans-serif;
    }
    #hz-cad-painel * { box-sizing: border-box; }
    .hzc-topo {
      display: flex; align-items: center; gap: 8px; padding: 11px 13px;
      background: linear-gradient(180deg, #182548, #121D38);
      border-bottom: 1px solid #2A3A63; box-shadow: inset 0 -2px 0 #C09A52;
      border-radius: 12px 12px 0 0;
    }
    .hzc-topo b { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; flex: 1; }
    .hzc-x { cursor: pointer; color: #96A3BE; font-size: 15px; line-height: 1; background: none; border: none; }
    .hzc-corpo { padding: 12px 13px 13px; }
    .hzc-numero { font-size: 22px; font-weight: 700; color: #C09A52; line-height: 1.1; }
    .hzc-legenda { color: #96A3BE; font-size: 11px; margin: 2px 0 10px; }
    .hzc-aviso {
      background: rgba(192,154,82,.10); border: 1px solid rgba(192,154,82,.35);
      border-radius: 8px; padding: 8px 9px; color: #E0C489; font-size: 11px; margin-bottom: 10px;
    }
    .hzc-lista { margin: 0 0 10px; padding: 0; list-style: none; max-height: 150px; overflow: auto; }
    .hzc-lista li { padding: 3px 0; border-bottom: 1px solid #1B2745; color: #96A3BE; }
    .hzc-lista li:last-child { border-bottom: none; }
    .hzc-botoes { display: flex; gap: 7px; }
    .hzc-botoes button {
      flex: 1; padding: 8px; border-radius: 8px; border: 1px solid #2A3A63;
      background: transparent; color: #EEF1F7; font: inherit; font-weight: 700; cursor: pointer;
    }
    .hzc-botoes button.hzc-primario { background: #C09A52; color: #0C1428; border-color: #C09A52; }
    .hzc-detalhe summary { cursor: pointer; color: #96A3BE; font-size: 11px; margin-bottom: 6px; }
  `;

  function painel() {
    let no = document.getElementById('hz-cad-painel');
    if (no) return no;
    const estilo = document.createElement('style');
    estilo.textContent = CSS_PAINEL;
    document.documentElement.appendChild(estilo);
    no = document.createElement('div');
    no.id = 'hz-cad-painel';
    document.documentElement.appendChild(no);
    return no;
  }

  function escapar(texto) {
    return String(texto).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function desenharPainel(resultado) {
    const no = painel();
    const semDado = resultado.semDado || [];

    if (resultado.semPerfil) {
      no.innerHTML = `
        <div class="hzc-topo"><b>Horasis · Cadastro</b><button class="hzc-x" title="Fechar">✕</button></div>
        <div class="hzc-corpo">
          <div class="hzc-aviso">Nenhum dado guardado ainda. Abra o painel de dados, preencha uma vez e a extensão passa a preencher este formulário sozinha.</div>
          <div class="hzc-botoes"><button class="hzc-primario" data-acao="abrir">Preencher meus dados</button></div>
        </div>`;
    } else {
      no.innerHTML = `
        <div class="hzc-topo"><b>Horasis · Cadastro</b><button class="hzc-x" title="Fechar">✕</button></div>
        <div class="hzc-corpo">
          <div class="hzc-numero">${resultado.preenchidos.length}</div>
          <div class="hzc-legenda">campo${resultado.preenchidos.length === 1 ? '' : 's'} preenchido${resultado.preenchidos.length === 1 ? '' : 's'} nesta tela</div>
          <div class="hzc-aviso">Confira antes de enviar. A extensão não clica em Salvar nem em Continuar.</div>
          ${semDado.length ? `
            <details class="hzc-detalhe">
              <summary>${semDado.length} campo${semDado.length === 1 ? '' : 's'} que a extensão reconheceu mas não tem dado guardado</summary>
              <ul class="hzc-lista">${semDado.map((t) => '<li>' + escapar(t) + '</li>').join('')}</ul>
            </details>` : ''}
          <div class="hzc-botoes">
            <button data-acao="repetir">Preencher de novo</button>
            <button data-acao="abrir">Meus dados</button>
          </div>
        </div>`;
    }

    no.querySelector('.hzc-x').addEventListener('click', () => no.remove());
    const repetir = no.querySelector('[data-acao="repetir"]');
    if (repetir) repetir.addEventListener('click', () => rodar({ manual: true }));
    const abrir = no.querySelector('[data-acao="abrir"]');
    if (abrir) abrir.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'horasis_cadastro_abrir_painel' }));
  }

  // ─── Ciclo ───────────────────────────────────────────────────────────

  function carregarPerfil() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['hz_cadastro_perfil', 'hz_cadastro_opcoes'], (dados) => {
        perfil = dados && dados.hz_cadastro_perfil ? dados.hz_cadastro_perfil : null;
        opcoes = Object.assign({ auto: true, sobrescrever: false }, (dados && dados.hz_cadastro_opcoes) || {});
        resolve();
      });
    });
  }

  /** Contagem barata, para não varrer página que não é formulário. */
  function pareceFormulario() {
    return document.querySelectorAll('input, select, textarea').length >= 6;
  }

  async function rodar({ manual }) {
    // No automático a extensão roda em todo o portal, não só na tela de
    // cadastro. Varrer uma página de consulta a cada mudança do DOM seria
    // peso sem retorno.
    if (!manual && !pareceFormulario()) return { preenchidos: [], semDado: [], naoReconhecidos: 0 };
    await carregarPerfil();
    if (!perfil) {
      if (manual) desenharPainel({ semPerfil: true });
      return { semPerfil: true, preenchidos: [], semDado: [] };
    }
    if (manual) {
      document.querySelectorAll('[data-hz-cadastro]').forEach((el) => { delete el.dataset[MARCA]; });
    }
    const resultado = preencher({ manual: !!manual });
    ultimoResultado = resultado;

    // No modo automático o painel só sobe quando a página é mesmo um
    // cadastro: quatro campos reconhecidos é a diferença entre o formulário
    // de fornecedor e a busca de licitações, que também tem CNPJ.
    const confiante = resultado.preenchidos.length + resultado.semDado.length >= 4;
    if (manual || (resultado.preenchidos.length && confiante)) desenharPainel(resultado);
    return resultado;
  }

  /**
   * Assistente de sete passos: os campos do passo 4 não existem no DOM
   * enquanto o passo 1 está aberto. O observador é o que faz os passos
   * seguintes serem preenchidos sem o operador pedir de novo.
   */
  let agendado = null;
  const observador = new MutationObserver(() => {
    if (!opcoes.auto || !pareceFormulario()) return;
    clearTimeout(agendado);
    agendado = setTimeout(() => { rodar({ manual: false }); }, 700);
  });

  chrome.runtime.onMessage.addListener((mensagem, _remetente, responder) => {
    if (mensagem && mensagem.action === 'horasis_cadastro_preencher') {
      rodar({ manual: true }).then((r) => responder({
        ok: true,
        preenchidos: r.preenchidos.length,
        semDado: r.semDado.length,
        semPerfil: !!r.semPerfil,
      }));
      return true;
    }
    if (mensagem && mensagem.action === 'horasis_cadastro_status') {
      responder({ ok: true, preenchidos: ultimoResultado.preenchidos.length });
      return false;
    }
    return false;
  });

  (async () => {
    await carregarPerfil();
    observador.observe(document.documentElement, { childList: true, subtree: true });
    if (opcoes.auto) {
      // Um tempo para o portal montar o formulário: quase todos são
      // aplicações de página única que desenham os campos depois do load.
      setTimeout(() => rodar({ manual: false }), 900);
    }
  })();
})();
