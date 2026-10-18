// ═══════════════════════════════════════════════════════════════════════
// HORASIS — Cadastro de fornecedor · painel de dados
//
// A tela onde o fornecedor digita os dados uma única vez. O formulário não
// está escrito no HTML: é montado a partir de `HZ_CADASTRO.SECOES`, o mesmo
// catálogo que o preenchimento usa para reconhecer os campos do portal.
//
// É de propósito. Campo que existe aqui e não lá seria campo que o fornecedor
// digita e a extensão nunca usa; campo que existe lá e não aqui seria campo
// que ela procura e nunca encontra. Com uma lista só, acrescentar um dado é
// mexer em `cadastro-campos.js` e mais nada.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  const HZ = globalThis.HZ_CADASTRO;
  const elemento = (id) => document.getElementById(id);

  function mostrar(tipo, texto) {
    const alvo = elemento('status');
    alvo.className = 'status ' + tipo;
    alvo.textContent = texto;
    if (tipo === 'ok') setTimeout(() => { if (alvo.textContent === texto) alvo.textContent = ''; }, 6000);
  }

  // ─── Montagem do formulário ──────────────────────────────────────────

  const MASCARAS = {
    cnpj: '00.000.000/0000-00',
    cpf: '000.000.000-00',
    cep: '00000-000',
    telefone: '999930808 (só os números)',
    moeda: '10.000,00',
  };

  function controleDoCampo(campo) {
    const nome = 'campo-' + campo.id;

    if (campo.tipo === 'multi') {
      const caixa = document.createElement('div');
      caixa.className = 'caixas';
      caixa.id = nome;
      campo.opcoes.forEach((opcao) => {
        const etiqueta = document.createElement('label');
        const entrada = document.createElement('input');
        entrada.type = 'checkbox';
        entrada.value = opcao;
        etiqueta.appendChild(entrada);
        etiqueta.appendChild(document.createTextNode(opcao));
        caixa.appendChild(etiqueta);
      });
      return caixa;
    }

    if (campo.tipo === 'lista') {
      const area = document.createElement('textarea');
      area.id = nome;
      area.placeholder = 'Um por linha';
      return area;
    }

    if (campo.tipo === 'uf' || campo.tipo === 'opcao' || campo.tipo === 'sim-nao') {
      const select = document.createElement('select');
      select.id = nome;
      const valores = campo.tipo === 'uf'
        ? HZ.UFS.map(([sigla, nomeUf]) => [sigla, sigla + ' — ' + nomeUf])
        : (campo.tipo === 'sim-nao' ? [['Sim', 'Sim'], ['Não', 'Não']] : campo.opcoes.map((o) => [o, o]));
      // A primeira opção é vazia e é o padrão: enquanto o fornecedor não
      // escolher, o campo continua sem dado — e sem dado nada é preenchido.
      const vazia = document.createElement('option');
      vazia.value = '';
      vazia.textContent = '— em branco —';
      select.appendChild(vazia);
      valores.forEach(([valor, rotulo]) => {
        const opcao = document.createElement('option');
        opcao.value = valor;
        opcao.textContent = rotulo;
        select.appendChild(opcao);
      });
      return select;
    }

    const entrada = document.createElement('input');
    entrada.id = nome;
    entrada.autocomplete = 'off';
    if (campo.tipo === 'data') entrada.type = 'date';
    else if (campo.tipo === 'numero') entrada.inputMode = 'numeric';
    else if (MASCARAS[campo.tipo]) { entrada.inputMode = 'decimal'; entrada.placeholder = MASCARAS[campo.tipo]; }
    return entrada;
  }

  function montar() {
    const raiz = elemento('secoes');
    HZ.SECOES.forEach((secao) => {
      const bloco = document.createElement('section');
      const titulo = document.createElement('h2');
      titulo.textContent = secao.titulo;
      bloco.appendChild(titulo);
      if (secao.nota) {
        const nota = document.createElement('p');
        nota.className = 'nota';
        nota.textContent = secao.nota;
        bloco.appendChild(nota);
      }

      // O representante legal costuma ser a mesma pessoa do contato — no MEI
      // é sempre. Copiar é escolha do fornecedor, com um clique: deduzir
      // sozinho seria inventar quem assina pela empresa.
      if (secao.id === 'representante') {
        const copiar = document.createElement('button');
        copiar.type = 'button';
        copiar.textContent = 'Copiar do contato';
        copiar.style.marginBottom = '12px';
        copiar.addEventListener('click', () => {
          [['contato_nome', 'rep_nome'], ['contato_cpf', 'rep_cpf'], ['contato_rg', 'rep_rg'], ['contato_cargo', 'rep_cargo']]
            .forEach(([de, para]) => {
              const origem = elemento('campo-' + de);
              const destino = elemento('campo-' + para);
              if (origem && destino) destino.value = origem.value;
            });
          mostrar('ok', 'Copiado do contato. Confira e salve.');
        });
        bloco.appendChild(copiar);
      }

      const grade = document.createElement('div');
      grade.className = 'grade';
      secao.campos.forEach((campo) => {
        if (campo.oculto) return; // confirmação de e-mail: espelha o e-mail
        const caixa = document.createElement('div');
        caixa.className = 'campo' + (campo.tipo === 'lista' || campo.tipo === 'multi' ? ' largo' : '');
        const etiqueta = document.createElement('label');
        etiqueta.setAttribute('for', 'campo-' + campo.id);
        etiqueta.textContent = campo.rotulo;
        caixa.appendChild(etiqueta);
        caixa.appendChild(controleDoCampo(campo));
        grade.appendChild(caixa);
      });
      bloco.appendChild(grade);
      raiz.appendChild(bloco);
    });
  }

  // ─── Carregar e salvar ───────────────────────────────────────────────

  function aplicarPerfil(perfil) {
    HZ.CAMPOS.forEach((campo) => {
      if (campo.oculto) return;
      const controle = elemento('campo-' + campo.id);
      if (!controle) return;
      const valor = HZ.paraFormulario(campo, perfil ? perfil[campo.id] : '');
      if (campo.tipo === 'multi') {
        const marcados = Array.isArray(valor) ? valor.map(HZ.normalizar) : [];
        controle.querySelectorAll('input[type="checkbox"]').forEach((caixa) => {
          caixa.checked = marcados.includes(HZ.normalizar(caixa.value));
        });
      } else {
        controle.value = valor;
      }
    });
  }

  function lerFormulario() {
    const perfil = {};
    HZ.CAMPOS.forEach((campo) => {
      if (campo.oculto) return;
      const controle = elemento('campo-' + campo.id);
      if (!controle) return;
      let bruto;
      if (campo.tipo === 'multi') {
        bruto = Array.from(controle.querySelectorAll('input[type="checkbox"]'))
          .filter((caixa) => caixa.checked)
          .map((caixa) => caixa.value);
      } else {
        bruto = controle.value;
      }
      const valor = HZ.paraPerfil(campo, bruto);
      // Campo em branco não entra no perfil. É o que garante que ele fique em
      // branco no portal em vez de receber um palpite.
      if (valor === '' || (Array.isArray(valor) && !valor.length)) return;
      perfil[campo.id] = valor;
    });
    return perfil;
  }

  function salvar() {
    const perfil = lerFormulario();
    const preferencias = { auto: elemento('optAuto').checked, sobrescrever: elemento('optSobrescrever').checked };
    chrome.storage.local.set({ hz_cadastro_perfil: perfil, hz_cadastro_opcoes: preferencias }, () => {
      if (chrome.runtime.lastError) {
        mostrar('err', 'Não foi possível salvar: ' + chrome.runtime.lastError.message);
        return;
      }
      mostrar('ok', Object.keys(perfil).length + ' campos guardados neste navegador.');
    });
  }

  // ─── Exportar e importar ─────────────────────────────────────────────
  // Serve para levar o perfil a outro computador e para guardar uma cópia
  // antes de mexer. O arquivo sai do navegador com CPF, conta bancária e
  // PIS dentro — vale tratá-lo como documento, não como configuração.

  function exportar() {
    const conteudo = JSON.stringify({ versao: 1, perfil: lerFormulario() }, null, 2);
    const url = URL.createObjectURL(new Blob([conteudo], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'horasis-cadastro-fornecedor.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function importar(arquivo) {
    const leitor = new FileReader();
    leitor.onload = () => {
      try {
        const dados = JSON.parse(String(leitor.result));
        const perfil = dados && dados.perfil ? dados.perfil : dados;
        if (!perfil || typeof perfil !== 'object') throw new Error('arquivo sem perfil');
        // Só os campos do catálogo entram, e cada um passa pela normalização
        // do seu tipo: um JSON editado à mão não tem como plantar chave
        // estranha no storage nem data em formato que o portal não aceite.
        const limpo = {};
        HZ.CAMPOS.forEach((campo) => {
          if (campo.oculto || perfil[campo.id] == null) return;
          const valor = HZ.paraPerfil(campo, perfil[campo.id]);
          if (valor === '' || (Array.isArray(valor) && !valor.length)) return;
          limpo[campo.id] = valor;
        });
        aplicarPerfil(limpo);
        mostrar('ok', Object.keys(limpo).length + ' campos lidos do arquivo. Confira e clique em Salvar.');
      } catch (erro) {
        mostrar('err', 'Arquivo inválido: ' + (erro && erro.message ? erro.message : String(erro)));
      }
    };
    leitor.readAsText(arquivo);
  }

  // ─── Início ──────────────────────────────────────────────────────────

  montar();
  chrome.storage.local.get(['hz_cadastro_perfil', 'hz_cadastro_opcoes'], (dados) => {
    aplicarPerfil((dados && dados.hz_cadastro_perfil) || null);
    const preferencias = Object.assign({ auto: true, sobrescrever: false }, (dados && dados.hz_cadastro_opcoes) || {});
    elemento('optAuto').checked = !!preferencias.auto;
    elemento('optSobrescrever').checked = !!preferencias.sobrescrever;
  });

  elemento('salvar').addEventListener('click', salvar);
  elemento('exportar').addEventListener('click', exportar);
  elemento('importar').addEventListener('click', () => elemento('arquivo').click());
  elemento('arquivo').addEventListener('change', (evento) => {
    const arquivo = evento.target.files && evento.target.files[0];
    if (arquivo) importar(arquivo);
    evento.target.value = '';
  });
})();
