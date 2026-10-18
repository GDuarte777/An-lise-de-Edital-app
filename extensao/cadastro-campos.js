// ═══════════════════════════════════════════════════════════════════════
// HORASIS — Cadastro de fornecedor · catálogo de campos e regras
//
// Este arquivo não toca no DOM. Ele é o dicionário: diz quais dados do
// fornecedor existem, como reconhecer cada um pelo rótulo que o portal usa e
// em que formato escrevê-lo de volta. Quem varre a página é
// `cadastro-preenchimento.js`; quem desenha o formulário do painel é
// `cadastro.js`. Os dois leem daqui, então acrescentar um campo é mexer em um
// lugar só.
//
// Ser puro também é o que o deixa testável: `tests/cadastroCampos.test.ts`
// carrega este arquivo num escopo isolado e exercita as regras sem navegador.
//
// REGRA QUE VALE MAIS QUE AS OUTRAS: nada aqui inventa valor. O catálogo só
// descreve campos; preencher só acontece quando o fornecedor digitou aquele
// dado no painel. Campo sem dado guardado fica em branco e entra na lista do
// que o operador precisa conferir — cadastro de fornecedor é declaração com
// efeito legal, e um palpite plausível é pior que um campo vazio.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  if (globalThis.HZ_CADASTRO) return;

  // ─── Normalização ────────────────────────────────────────────────────
  // Tudo que vem da página (rótulo, atributo, opção de select) passa por
  // aqui antes de ser comparado: "Inscrição Estadual", "INSCRICAO_ESTADUAL"
  // e "inscrição-estadual" viram a mesma string.
  function normalizar(texto) {
    return String(texto == null ? '' : texto)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /**
   * Mesma normalização, para `name`/`id`/`placeholder`.
   *
   * Atributo vem em camelCase (`txtInscricaoEstadual`), que a normalização
   * comum transformaria numa palavra só — e nenhum padrão do catálogo casaria
   * com ela. Aqui o camelCase vira espaço antes de tudo.
   */
  function normalizarAtributos(texto) {
    return normalizar(String(texto == null ? '' : texto).replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
  }

  function soDigitos(texto) {
    return String(texto == null ? '' : texto).replace(/\D+/g, '');
  }

  // ─── Unidades da federação ───────────────────────────────────────────
  // Um portal pede "BA", o outro "Bahia", o terceiro "29". Guardamos a sigla
  // e deixamos a escolha da opção resolver o resto.
  const UFS = [
    ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapa'], ['AM', 'Amazonas'],
    ['BA', 'Bahia'], ['CE', 'Ceara'], ['DF', 'Distrito Federal'], ['ES', 'Espirito Santo'],
    ['GO', 'Goias'], ['MA', 'Maranhao'], ['MT', 'Mato Grosso'], ['MS', 'Mato Grosso do Sul'],
    ['MG', 'Minas Gerais'], ['PA', 'Para'], ['PB', 'Paraiba'], ['PR', 'Parana'],
    ['PE', 'Pernambuco'], ['PI', 'Piaui'], ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'],
    ['RS', 'Rio Grande do Sul'], ['RO', 'Rondonia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'],
    ['SP', 'Sao Paulo'], ['SE', 'Sergipe'], ['TO', 'Tocantins'],
  ];

  /** Sigla e nome por extenso de uma UF, a partir de qualquer um dos dois. */
  function sinonimosDeUf(valor) {
    const alvo = normalizar(valor);
    if (!alvo) return [];
    for (const [sigla, nome] of UFS) {
      if (alvo === normalizar(sigla) || alvo === normalizar(nome)) return [sigla, nome];
    }
    return [valor];
  }

  // ─── Catálogo ────────────────────────────────────────────────────────
  // `padroes` casa com o rótulo da página; `recusa` desqualifica o campo
  // mesmo que um padrão tenha casado (é o que separa "Nome" de "Nome do
  // titular"); `contexto` e `foraDeContexto` olham o título da seção, que é
  // o que separa a cidade do endereço da cidade da agência bancária — nos
  // dois casos o rótulo é só "Cidade".
  const SECOES = [
    {
      id: 'empresa',
      titulo: 'Empresa',
      nota: 'O que a Receita publica no cartão CNPJ. Copie do cartão, não de memória.',
      campos: [
        {
          id: 'pais', rotulo: 'País', tipo: 'texto',
          padroes: [/\bpais\b/], recusa: [/nascimento|origem do produto/],
        },
        {
          id: 'tipo_pessoa', rotulo: 'Tipo de pessoa', tipo: 'opcao',
          opcoes: ['Pessoa jurídica', 'Pessoa física'],
          padroes: [/tipo de pessoa/, /pessoa juridica ou fisica/, /natureza da pessoa/],
        },
        {
          id: 'cnpj', rotulo: 'CNPJ', tipo: 'cnpj',
          padroes: [/\bcnpj\b/, /cpf cnpj/, /cnpj cpf/, /numero de inscricao/],
        },
        {
          id: 'tipo_cadastro', rotulo: 'Tipo de cadastro', tipo: 'texto',
          padroes: [/tipo de cadastro/, /tipo do cadastro/],
        },
        {
          id: 'razao_social', rotulo: 'Razão social', tipo: 'texto',
          padroes: [/razao social/, /nome empresarial/, /^razao$/],
        },
        {
          id: 'nome_fantasia', rotulo: 'Nome fantasia', tipo: 'texto',
          padroes: [/nome fantasia/, /nome de fantasia/, /^fantasia$/, /titulo do estabelecimento/],
        },
        {
          id: 'natureza_juridica', rotulo: 'Natureza jurídica', tipo: 'texto',
          padroes: [/natureza juridica/],
        },
        {
          id: 'porte', rotulo: 'Porte', tipo: 'texto',
          padroes: [/^porte$/, /porte da empresa/, /porte empresarial/, /enquadramento/],
        },
        {
          id: 'mei', rotulo: 'É MEI?', tipo: 'sim-nao',
          padroes: [/^mei$/, /microempreendedor individual/, /\be mei\b/],
        },
        {
          id: 'lc123', rotulo: 'Beneficiário da LC 123/06 (ME/EPP)', tipo: 'sim-nao',
          padroes: [/lc 123/, /lei complementar 123/, /\bme epp\b/, /beneficio.*lc/],
        },
        {
          id: 'simples_nacional', rotulo: 'Optante pelo Simples Nacional', tipo: 'sim-nao',
          padroes: [/simples nacional/, /optante.*simples/],
        },
        {
          id: 'inicio_atividade', rotulo: 'Início da atividade', tipo: 'data',
          padroes: [/inicio da atividade/, /inicio das atividades/, /data de abertura/, /data de fundacao/, /data de constituicao/, /^abertura$/],
        },
        {
          id: 'capital_social', rotulo: 'Capital social', tipo: 'moeda',
          padroes: [/capital social/], recusa: [/integraliz/],
        },
        {
          id: 'capital_integralizado', rotulo: 'Capital integralizado', tipo: 'moeda',
          padroes: [/capital integralizado/, /capital realizado/],
        },
        {
          id: 'data_integralizacao', rotulo: 'Data de integralização', tipo: 'data',
          padroes: [/data de integralizacao/, /integralizacao/],
        },
        {
          id: 'patrimonio_liquido', rotulo: 'Patrimônio líquido', tipo: 'moeda',
          padroes: [/patrimonio liquido/],
        },
        {
          id: 'inscricao_estadual', rotulo: 'Inscrição estadual', tipo: 'texto',
          padroes: [/inscricao estadual/, /\bie\b/], recusa: [/isent|municipal/],
        },
        {
          id: 'inscricao_estadual_isento', rotulo: 'Isento de inscrição estadual', tipo: 'sim-nao',
          padroes: [/isento.*estadual/, /estadual.*isento/],
        },
        {
          id: 'inscricao_municipal', rotulo: 'Inscrição municipal', tipo: 'texto',
          padroes: [/inscricao municipal/, /inscricao mobiliaria/, /\bccm\b/], recusa: [/isent|estadual/],
        },
        {
          id: 'inscricao_municipal_isento', rotulo: 'Isento de inscrição municipal', tipo: 'sim-nao',
          padroes: [/isento.*municipal/, /municipal.*isento/],
        },
        {
          id: 'numero_funcionarios', rotulo: 'Número de funcionários', tipo: 'numero',
          padroes: [/numero de funcionarios/, /quantidade de funcionarios/, /numero de empregados/, /^funcionarios$/, /^empregados$/],
        },
        {
          id: 'indicativo_atividade', rotulo: 'Indicativo de atividade', tipo: 'multi',
          opcoes: ['Comércio', 'Indústria', 'Serviço'],
          padroes: [/indicativo de atividade/, /ramo de atuacao/, /tipo de atividade/],
        },
        {
          id: 'assinatura_digital', rotulo: 'Possui assinatura digital', tipo: 'sim-nao',
          padroes: [/assinatura digital/, /certificado digital/, /possui.*e cnpj/],
        },
        {
          id: 'cnae_principal', rotulo: 'CNAE principal', tipo: 'texto',
          padroes: [/cnae principal/, /atividade principal/, /atividade economica principal/, /^cnae$/],
        },
        {
          id: 'cnae_secundarios', rotulo: 'CNAEs secundários', tipo: 'lista',
          padroes: [/cnae secundari/, /atividades secundarias/, /atividades economicas secundarias/],
        },
      ],
    },
    {
      id: 'endereco',
      titulo: 'Endereço',
      nota: 'O endereço da sede, igual ao do cartão CNPJ.',
      campos: [
        { id: 'cep', rotulo: 'CEP', tipo: 'cep', padroes: [/\bcep\b/, /codigo postal/] },
        {
          id: 'logradouro', rotulo: 'Logradouro', tipo: 'texto',
          padroes: [/logradouro/, /^endereco$/, /^rua$/, /^avenida$/],
          recusa: [/numero|complemento|bairro|eletronico|mail|cobranca|entrega/],
        },
        {
          id: 'numero_endereco', rotulo: 'Número', tipo: 'texto',
          padroes: [/^numero$/, /numero do endereco/, /numero do logradouro/, /^n$/, /^nr$/],
          recusa: [/conta|agencia|telefone|funcionarios|empregados|documento|cnpj|cpf|processo|registro|inscricao|banco|protocolo|nota|contrato|whatsapp|celular/],
          foraDeContexto: /banc|agencia|conta/,
        },
        { id: 'complemento', rotulo: 'Complemento', tipo: 'texto', padroes: [/complemento/] },
        { id: 'bairro', rotulo: 'Bairro', tipo: 'texto', padroes: [/bairro/, /^distrito$/] },
        {
          id: 'uf', rotulo: 'Estado (UF)', tipo: 'uf',
          padroes: [/^uf$/, /^estado$/, /unidade da federacao/, /estado uf/],
          recusa: [/civil|situacao|nascimento/],
          foraDeContexto: /banc|agencia|conta|representante|socio/,
        },
        {
          id: 'cidade', rotulo: 'Cidade', tipo: 'texto',
          padroes: [/^cidade$/, /^municipio$/, /cidade municipio/],
          recusa: [/nascimento|naturalidade/],
          foraDeContexto: /banc|agencia|conta|representante|socio/,
        },
      ],
    },
    {
      id: 'contato',
      titulo: 'Contato e responsável',
      nota: 'Quem o órgão procura. Em muitos portais estes dados também viram o login da conta.',
      campos: [
        {
          id: 'contato_nome', rotulo: 'Nome do responsável', tipo: 'texto',
          padroes: [/^nome$/, /nome do contato/, /nome do responsavel/, /nome completo/, /^responsavel$/],
          recusa: [/fantasia|empresarial|razao|titular|banco|^nome da mae|^nome do pai|usuario|arquivo|socio|representante|conjuge/],
          foraDeContexto: /banc|agencia|representante|socio/,
        },
        { id: 'contato_cargo', rotulo: 'Cargo', tipo: 'texto', padroes: [/^cargo$/, /cargo funcao/, /^funcao$/] },
        {
          id: 'contato_cpf', rotulo: 'CPF', tipo: 'cpf',
          padroes: [/\bcpf\b/], recusa: [/cnpj|socio|representante/],
          foraDeContexto: /representante|socio/,
        },
        {
          id: 'contato_rg', rotulo: 'RG', tipo: 'texto',
          padroes: [/\brg\b/, /^identidade$/, /registro geral/, /documento de identidade/],
          foraDeContexto: /representante|socio/,
        },
        {
          id: 'contato_orgao_emissor', rotulo: 'Órgão emissor do RG', tipo: 'texto',
          padroes: [/orgao emissor/, /orgao expedidor/, /^emissor$/, /^expedidor$/],
        },
        {
          id: 'contato_nascimento', rotulo: 'Data de nascimento', tipo: 'data',
          padroes: [/data de nascimento/, /^nascimento$/, /data nasc/],
        },
        { id: 'contato_pis', rotulo: 'PIS/PASEP', tipo: 'texto', padroes: [/pis pasep/, /^pis$/, /^pasep$/, /\bnit\b/] },
        {
          id: 'contato_email', rotulo: 'E-mail', tipo: 'texto',
          padroes: [/e mail/, /^email$/, /correio eletronico/, /endereco eletronico/],
          recusa: [/confirm|repit|alternativ|secundari/],
        },
        {
          id: 'contato_email_confirmacao', rotulo: 'Confirmação de e-mail', tipo: 'texto',
          oculto: true, espelho: 'contato_email',
          padroes: [/confirma.*e mail/, /confirma.*email/, /repita.*e mail/, /e mail.*confirma/],
        },
        {
          id: 'contato_ddd', rotulo: 'DDD', tipo: 'texto',
          // Só quando está sozinho: "Telefone (com DDD)" é o campo do
          // telefone inteiro, não a caixinha do código de área.
          padroes: [/^ddd$/, /codigo de area/],
        },
        {
          id: 'contato_telefone', rotulo: 'Telefone', tipo: 'telefone',
          padroes: [/telefone/, /^fone$/, /^tel$/], recusa: [/celular|fax|whatsapp/],
        },
        {
          id: 'contato_celular', rotulo: 'Celular', tipo: 'telefone',
          padroes: [/celular/, /whatsapp/, /telefone movel/],
        },
        { id: 'contato_nacionalidade', rotulo: 'Nacionalidade', tipo: 'texto', padroes: [/nacionalidade/] },
        { id: 'contato_estado_civil', rotulo: 'Estado civil', tipo: 'texto', padroes: [/estado civil/] },
      ],
    },
    {
      id: 'representante',
      titulo: 'Representante legal',
      nota: 'Quem assina pela empresa. No MEI costuma ser a mesma pessoa do contato — o botão acima copia.',
      campos: [
        {
          id: 'rep_nome', rotulo: 'Nome do representante', tipo: 'texto',
          padroes: [/nome do representante/, /representante legal/, /nome do socio/, /socio administrador/, /^nome$/, /nome completo/],
          contexto: /representante|socio|procurador|administrador/,
        },
        {
          id: 'rep_cpf', rotulo: 'CPF do representante', tipo: 'cpf',
          padroes: [/cpf do representante/, /cpf do socio/, /\bcpf\b/],
          contexto: /representante|socio|procurador|administrador/,
        },
        {
          id: 'rep_rg', rotulo: 'RG do representante', tipo: 'texto',
          padroes: [/rg do representante/, /rg do socio/, /\brg\b/, /^identidade$/],
          contexto: /representante|socio|procurador|administrador/,
        },
        {
          id: 'rep_cargo', rotulo: 'Cargo do representante', tipo: 'texto',
          padroes: [/cargo do representante/, /qualificacao/, /^cargo$/],
          contexto: /representante|socio|procurador|administrador/,
        },
        {
          id: 'rep_participacao', rotulo: 'Participação societária (%)', tipo: 'numero',
          padroes: [/participacao/, /percentual.*capital/, /quota/],
        },
      ],
    },
    {
      id: 'banco',
      titulo: 'Dados bancários',
      nota: 'Conta que recebe o pagamento do empenho.',
      campos: [
        {
          id: 'banco_nome', rotulo: 'Banco', tipo: 'texto',
          padroes: [/^banco$/, /nome do banco/, /instituicao financeira/, /instituicao bancaria/],
          recusa: [/agencia|conta|codigo/],
        },
        {
          id: 'banco_codigo', rotulo: 'Código do banco', tipo: 'texto',
          padroes: [/codigo do banco/, /cod banco/, /numero do banco/, /banco codigo/],
        },
        {
          id: 'banco_tipo_conta', rotulo: 'Tipo de conta', tipo: 'opcao',
          opcoes: ['Conta corrente', 'Conta poupança', 'Conta pagamento', 'Conta salário'],
          padroes: [/tipo de conta/, /tipo da conta/, /natureza da conta/],
        },
        {
          id: 'banco_agencia', rotulo: 'Agência', tipo: 'texto',
          padroes: [/agencia/, /numero da agencia/], recusa: [/digito|\bdv\b|cidade|estado|endereco/],
        },
        {
          id: 'banco_agencia_digito', rotulo: 'Dígito da agência', tipo: 'texto',
          padroes: [/digito.*agencia/, /dv.*agencia/, /agencia.*digito/],
        },
        {
          id: 'banco_conta', rotulo: 'Número da conta', tipo: 'texto',
          padroes: [/numero da conta/, /^conta$/, /conta corrente/, /conta bancaria/],
          recusa: [/digito|\bdv\b|tipo|titular|banco/],
        },
        {
          id: 'banco_conta_digito', rotulo: 'Dígito da conta', tipo: 'texto',
          padroes: [/digito.*conta/, /dv.*conta/, /conta.*digito/, /^digito$/, /^dv$/],
        },
        { id: 'banco_operacao', rotulo: 'Operação', tipo: 'texto', padroes: [/^operacao$/, /codigo da operacao/] },
        {
          id: 'banco_titular', rotulo: 'Nome do titular', tipo: 'texto',
          padroes: [/titular/, /nome do titular/, /favorecido/],
        },
        {
          id: 'banco_uf', rotulo: 'Estado da agência', tipo: 'uf',
          padroes: [/^uf$/, /^estado$/, /uf da agencia/, /estado da agencia/],
          recusa: [/civil/], contexto: /banc|agencia|conta/,
        },
        {
          id: 'banco_cidade', rotulo: 'Cidade da agência', tipo: 'texto',
          padroes: [/^cidade$/, /^municipio$/, /cidade da agencia/],
          contexto: /banc|agencia|conta/,
        },
      ],
    },
    {
      id: 'fornecimento',
      titulo: 'Linha de fornecimento',
      nota: 'Só texto: a árvore de itens de cada portal é escolhida à mão. Guardar aqui serve para você copiar sempre a mesma lista.',
      campos: [
        {
          id: 'linhas_fornecimento', rotulo: 'Linhas de fornecimento', tipo: 'lista',
          padroes: [/linha de fornecimento/, /linhas de fornecimento/, /ramo de atividade/, /produtos e servicos/, /materiais e servicos/, /^segmento$/],
        },
      ],
    },
  ];

  /** Todos os campos, em lista única, na ordem em que aparecem nas seções. */
  const CAMPOS = SECOES.reduce((todos, secao) => todos.concat(secao.campos), []);
  const POR_ID = CAMPOS.reduce((mapa, campo) => { mapa[campo.id] = campo; return mapa; }, {});

  // ─── Reconhecimento ──────────────────────────────────────────────────

  /**
   * Especificidade de um padrão: quantas letras ele exige.
   *
   * É o que faz "nome fantasia" vencer "nome" quando os dois casam no mesmo
   * rótulo. Sem isso a ordem de declaração decidiria, e qualquer campo novo
   * no catálogo mudaria o resultado de outro sem aviso.
   */
  function especificidade(padrao) {
    return String(padrao.source).replace(/[^a-z0-9]/gi, '').length;
  }

  const PONTOS_ROTULO = 120;
  const PONTOS_ATRIBUTO = 60;
  const LIMIAR = 60;

  function pontuar(campo, pista) {
    const rotulo = pista.rotulo || '';
    const atributos = pista.atributos || '';
    const contexto = pista.contexto || '';

    if (campo.recusa && campo.recusa.some((r) => r.test(rotulo) || r.test(atributos))) return 0;

    let pontos = 0;
    for (const padrao of campo.padroes) {
      if (rotulo && padrao.test(rotulo)) {
        pontos = Math.max(pontos, PONTOS_ROTULO + especificidade(padrao));
      } else if (atributos && padrao.test(atributos)) {
        pontos = Math.max(pontos, PONTOS_ATRIBUTO + especificidade(padrao));
      }
    }
    if (!pontos) return 0;

    // O contexto é o desempate entre rótulos iguais em seções diferentes:
    // "Cidade" na seção do endereço e "Cidade" na seção da agência.
    if (campo.contexto) pontos += campo.contexto.test(contexto) ? 40 : -25;
    if (campo.foraDeContexto && campo.foraDeContexto.test(contexto)) pontos -= 70;

    return pontos;
  }

  /**
   * Qual campo do catálogo é este campo do formulário.
   *
   * Devolve `{ id, pontos }` ou null. Null é resposta legítima e frequente:
   * portal tem campo que não é dado nosso, e chutar o mais parecido é
   * exatamente o erro que não se pode cometer num cadastro de fornecedor.
   */
  function reconhecerCampo(pista) {
    const normalizada = {
      rotulo: normalizar(pista && pista.rotulo),
      atributos: normalizarAtributos(pista && pista.atributos),
      contexto: normalizar(pista && pista.contexto),
    };
    let melhor = null;
    for (const campo of CAMPOS) {
      const pontos = pontuar(campo, normalizada);
      if (pontos >= LIMIAR && (!melhor || pontos > melhor.pontos)) melhor = { id: campo.id, pontos };
    }
    return melhor;
  }

  /**
   * "Isento" sozinho não diz de que inscrição se trata.
   *
   * Nos formulários o checkbox vem imediatamente depois do campo que ele
   * dispensa (é o caso do print do Comprasnet), então quem resolve é a ordem:
   * o último campo reconhecido antes dele.
   */
  function resolverIsento(idAnterior) {
    if (idAnterior === 'inscricao_estadual') return 'inscricao_estadual_isento';
    if (idAnterior === 'inscricao_municipal') return 'inscricao_municipal_isento';
    return null;
  }

  /**
   * Dígito verificador sem rótulo próprio: a caixinha pequena depois da
   * agência ou da conta. Mesma lógica da anterior — quem diz o que ela é, é
   * o campo que veio antes.
   */
  function resolverDigitoSolto(idAnterior) {
    if (idAnterior === 'banco_agencia') return 'banco_agencia_digito';
    if (idAnterior === 'banco_conta') return 'banco_conta_digito';
    return null;
  }

  // ─── Formatação de saída ─────────────────────────────────────────────
  // O perfil guarda o dado cru (dígitos, data ISO, número com ponto). Cada
  // portal quer de um jeito, e é na hora de escrever que se decide.

  function aplicarMascara(digitos, mascara) {
    let saida = '';
    let i = 0;
    for (const caractere of mascara) {
      if (i >= digitos.length) break;
      if (caractere === '#') { saida += digitos[i]; i += 1; } else { saida += caractere; }
    }
    return saida + digitos.slice(i);
  }

  /**
   * Com máscara ou só dígitos?
   *
   * O campo mascarado do portal insere a pontuação sozinho quando recebe os
   * dígitos, mas o campo que tem `maxlength` do tamanho do número cru trunca
   * o texto pontuado pela metade — e o cadastro vai com o CNPJ errado. Então
   * o `maxlength` manda: se não cabe pontuado, vai cru.
   */
  function documentoFormatado(valor, mascara, alvo) {
    const digitos = soDigitos(valor);
    if (!digitos) return '';
    const pontuado = aplicarMascara(digitos, mascara);
    const limite = Number(alvo && alvo.maxlength);
    if (Number.isFinite(limite) && limite > 0 && limite < pontuado.length) return digitos;
    return pontuado;
  }

  /** Data guardada em ISO (aaaa-mm-dd) para o formato que o campo aceita. */
  function dataFormatada(valor, alvo) {
    const digitos = soDigitos(valor);
    if (digitos.length !== 8) return '';
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(String(valor).trim())
      ? String(valor).trim()
      : digitos.slice(4) + '-' + digitos.slice(2, 4) + '-' + digitos.slice(0, 2);
    const [ano, mes, dia] = iso.split('-');
    if (String(alvo && alvo.tipoInput).toLowerCase() === 'date') return iso;
    return dia + '/' + mes + '/' + ano;
  }

  /** Valor monetário guardado com ponto decimal, escrito como o campo pede. */
  function moedaFormatada(valor, alvo) {
    const texto = String(valor).trim();
    // O perfil guarda com ponto decimal ("10000.00"); um valor digitado à mão
    // pode chegar em pt-BR ("10.000,00"). A vírgula é o que separa os dois
    // casos — tratar todo ponto como separador de milhar multiplicaria o
    // capital social por cem.
    const numero = texto.includes(',')
      ? Number(texto.replace(/\./g, '').replace(',', '.'))
      : Number(texto);
    if (!Number.isFinite(numero)) return '';
    if (String(alvo && alvo.tipoInput).toLowerCase() === 'number') return numero.toFixed(2);
    return numero.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /**
   * Telefone, com ou sem DDD.
   *
   * O DDD é guardado à parte porque metade dos portais tem caixinha só para
   * ele (é o caso do print). Quando o campo é um só, o DDD volta junto.
   */
  function telefoneFormatado(numero, ddd, alvo) {
    const n = soDigitos(numero);
    if (!n) return '';
    const limite = Number(alvo && alvo.maxlength);
    const cabeSoONumero = Number.isFinite(limite) && limite > 0 && limite <= n.length + 1;
    const d = soDigitos(ddd);
    if (!d || cabeSoONumero) return n;

    const cru = d + n;
    const pontuado = n.length === 9
      ? '(' + d + ') ' + n.slice(0, 5) + '-' + n.slice(5)
      : '(' + d + ') ' + n.slice(0, 4) + '-' + n.slice(4);
    if (Number.isFinite(limite) && limite > 0 && limite < pontuado.length) return cru;
    return pontuado;
  }

  /**
   * O texto que vai para o campo da página.
   *
   * `alvo` descreve o campo encontrado: `{ tipoInput, maxlength }`. Devolver
   * string vazia significa "não escreva nada aqui" — e é o que acontece
   * sempre que o fornecedor não guardou esse dado.
   */
  function formatarParaCampo(campo, perfil, alvo) {
    const definicao = typeof campo === 'string' ? POR_ID[campo] : campo;
    if (!definicao) return '';
    const bruto = valorDoPerfil(perfil, definicao.id);
    if (bruto == null || bruto === '') return '';

    switch (definicao.tipo) {
      case 'cnpj': return documentoFormatado(bruto, '##.###.###/####-##', alvo);
      case 'cpf': return documentoFormatado(bruto, '###.###.###-##', alvo);
      case 'cep': return documentoFormatado(bruto, '#####-###', alvo);
      case 'data': return dataFormatada(bruto, alvo);
      case 'moeda': return moedaFormatada(bruto, alvo);
      case 'telefone': return telefoneFormatado(bruto, perfil && perfil.contato_ddd, alvo);
      case 'lista': return Array.isArray(bruto) ? bruto.join('\n') : String(bruto);
      default: return String(bruto);
    }
  }

  /** Lê o perfil respeitando campos espelhados (confirmação de e-mail). */
  function valorDoPerfil(perfil, id) {
    const definicao = POR_ID[id];
    const fonte = definicao && definicao.espelho ? definicao.espelho : id;
    return perfil ? perfil[fonte] : undefined;
  }

  // ─── Conversão para o painel e de volta ──────────────────────────────
  // O perfil guarda o dado cru: documento só com dígitos, data em ISO, valor
  // com ponto decimal. Assim o mesmo dado serve a um portal que pede CNPJ
  // pontuado e a outro que só aceita números, sem reinterpretar texto na
  // hora de preencher.

  /** O que o fornecedor digitou no painel → como o perfil guarda. */
  function paraPerfil(campo, bruto) {
    const definicao = typeof campo === 'string' ? POR_ID[campo] : campo;
    if (!definicao) return '';
    if (Array.isArray(bruto)) return bruto.slice();
    const texto = String(bruto == null ? '' : bruto).trim();
    if (!texto) return '';

    switch (definicao.tipo) {
      case 'cnpj': case 'cpf': case 'cep': case 'telefone':
        return soDigitos(texto);
      case 'data': {
        const digitos = soDigitos(texto);
        if (digitos.length !== 8) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
        return digitos.slice(4) + '-' + digitos.slice(2, 4) + '-' + digitos.slice(0, 2);
      }
      case 'moeda': {
        const numero = texto.includes(',')
          ? Number(texto.replace(/\./g, '').replace(',', '.'))
          : Number(texto);
        return Number.isFinite(numero) ? numero.toFixed(2) : '';
      }
      case 'lista':
        return texto.split(/[\n;]/).map((linha) => linha.trim()).filter(Boolean);
      default:
        return texto;
    }
  }

  /** Como o perfil guarda → o que o painel mostra na caixa de texto. */
  function paraFormulario(campo, valor) {
    const definicao = typeof campo === 'string' ? POR_ID[campo] : campo;
    if (!definicao || valor == null || valor === '') return definicao && definicao.tipo === 'multi' ? [] : '';
    switch (definicao.tipo) {
      case 'cnpj': return aplicarMascara(soDigitos(valor), '##.###.###/####-##');
      case 'cpf': return aplicarMascara(soDigitos(valor), '###.###.###-##');
      case 'cep': return aplicarMascara(soDigitos(valor), '#####-###');
      case 'moeda': return moedaFormatada(valor, {});
      case 'lista': return Array.isArray(valor) ? valor.join('\n') : String(valor);
      case 'multi': return Array.isArray(valor) ? valor : String(valor).split(/[;,]/).map((t) => t.trim()).filter(Boolean);
      default: return String(valor);
    }
  }

  // ─── Escolha de opção em select e radio ──────────────────────────────

  const DESCARTAVEIS = /^(selecione|selecionar|escolha|opcao|nenhum|nenhuma|todos|outro|outros|)$/;

  const IRRELEVANTES = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 's', 'sa', 'ltda', 'me', 'epp', 'banco']);

  function palavrasFortes(texto) {
    return normalizar(texto).split(' ').filter((p) => p.length >= 3 && !IRRELEVANTES.has(p));
  }

  /**
   * Qual das opções do select corresponde ao valor guardado.
   *
   * `opcoes` é `[{ texto, valor }]` — sem DOM, para poder ser testado. O
   * retorno é o índice, ou -1 quando nenhuma serve: aí o campo fica como
   * está e entra na lista de conferência. Escolher a opção "mais parecida"
   * num select de bancos é como trocar a conta que recebe o pagamento.
   */
  function escolherOpcao(opcoes, valor, tipo) {
    const alvos = tipo === 'uf' ? sinonimosDeUf(valor) : [valor];
    const normalizados = alvos.map(normalizar).filter(Boolean);
    if (!normalizados.length) return -1;

    const fortes = palavrasFortes(valor);
    let melhor = -1;
    let melhorPonto = 0;
    let segundoPonto = 0;

    for (let i = 0; i < opcoes.length; i += 1) {
      const opcao = opcoes[i] || {};
      const texto = normalizar(opcao.texto);
      const bruto = normalizar(opcao.valor);
      if (!texto && !bruto) continue;
      if (DESCARTAVEIS.test(texto)) continue;

      let pontos = 0;
      for (const alvo of normalizados) {
        if (texto === alvo || bruto === alvo) pontos = Math.max(pontos, 100);
        else if (texto.startsWith(alvo + ' ') || texto.endsWith(' ' + alvo)) pontos = Math.max(pontos, 90);
        else if (texto.split(' ').includes(alvo)) pontos = Math.max(pontos, 80);
      }

      // Casamento por palavras: "NUBANK - NU PAGAMENTOS S.A." contra
      // "260 - NU PAGAMENTOS S.A. - INSTITUICAO DE PAGAMENTO". O nome que o
      // fornecedor guardou quase nunca é o do select, mas as palavras fortes
      // coincidem.
      if (!pontos && fortes.length) {
        const presentes = fortes.filter((p) => texto.includes(p)).length;
        if (presentes === fortes.length) pontos = 70;
        else if (presentes / fortes.length >= 0.5) pontos = 60;
      }

      if (pontos > melhorPonto) { segundoPonto = melhorPonto; melhorPonto = pontos; melhor = i; }
      else if (pontos > segundoPonto) { segundoPonto = pontos; }
    }

    if (melhorPonto < 60) return -1;
    // Empate na faixa aproximada: duas opções parecidas com o que foi
    // guardado e nenhuma igual. Aqui o certo é não escolher — num select de
    // bancos, a segunda melhor opção é a conta de outra pessoa.
    if (melhorPonto < 80 && segundoPonto === melhorPonto) return -1;
    return melhor;
  }

  const SIM = /^(sim|s|true|1|yes)$/;
  const NAO = /^(nao|n|false|0|no)$/;

  /** Um rótulo de radio/checkbox ("Sim", "Não") contra um valor sim-nao. */
  function combinaSimNao(rotuloOpcao, valor) {
    const opcao = normalizar(rotuloOpcao);
    const guardado = normalizar(valor);
    if (!opcao || !guardado) return false;
    if (SIM.test(guardado)) return SIM.test(opcao);
    if (NAO.test(guardado)) return NAO.test(opcao);
    return opcao === guardado;
  }

  /**
   * "Comércio", "Indústria", "Serviço" são opções de um campo, não campos.
   *
   * O rótulo da caixinha é só o nome da opção, igual em qualquer formulário;
   * quem diz a que campo ela pertence é o bloco em volta ("Indicativo de
   * atividade"). Sem essa confirmação, uma caixinha "Serviço" de qualquer
   * outra parte do portal seria marcada.
   */
  function reconhecerOpcaoMulti(rotuloOpcao, pistaGrupo) {
    const opcao = normalizar(rotuloOpcao);
    if (!opcao) return null;
    const volta = normalizar(pistaGrupo && pistaGrupo.rotulo) + ' ' + normalizar(pistaGrupo && pistaGrupo.contexto);
    for (const campo of CAMPOS) {
      if (campo.tipo !== 'multi' || !campo.opcoes) continue;
      const correspondente = campo.opcoes.find((o) => normalizar(o) === opcao);
      if (!correspondente) continue;
      if (campo.padroes.some((padrao) => padrao.test(volta))) return { campoId: campo.id, opcao: correspondente };
    }
    return null;
  }

  /** Um rótulo de checkbox contra a lista marcada de um campo `multi`. */
  function marcadoEmMulti(rotuloOpcao, valor) {
    const lista = Array.isArray(valor) ? valor : String(valor || '').split(/[;,\n]/);
    const opcao = normalizar(rotuloOpcao);
    if (!opcao) return false;
    return lista.map(normalizar).filter(Boolean).some((item) => item === opcao || opcao.startsWith(item) || item.startsWith(opcao));
  }

  globalThis.HZ_CADASTRO = {
    SECOES,
    CAMPOS,
    POR_ID,
    UFS,
    normalizar,
    normalizarAtributos,
    soDigitos,
    sinonimosDeUf,
    reconhecerCampo,
    resolverIsento,
    resolverDigitoSolto,
    formatarParaCampo,
    valorDoPerfil,
    paraPerfil,
    paraFormulario,
    escolherOpcao,
    combinaSimNao,
    reconhecerOpcaoMulti,
    marcadoEmMulti,
  };
})();
