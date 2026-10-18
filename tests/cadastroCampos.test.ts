import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// `extensao/cadastro-campos.js` é um content script clássico: não tem `export`
// porque o Chrome não carrega módulo ES como content script. Para testá-lo sem
// manter uma segunda cópia em src/, o arquivo é avaliado aqui num escopo
// próprio — o parâmetro `globalThis` sombreia o global de verdade, então o que
// o arquivo publica cai no objeto abaixo e não vaza para a suíte.
type Pista = { rotulo?: string; atributos?: string; contexto?: string };
type Alvo = { tipoInput?: string; maxlength?: number };
type Opcao = { texto?: string; valor?: string };
type Catalogo = {
  SECOES: { id: string; titulo: string; campos: { id: string; rotulo: string; tipo: string }[] }[];
  CAMPOS: { id: string; rotulo: string; tipo: string; oculto?: boolean }[];
  normalizar: (t: unknown) => string;
  reconhecerCampo: (p: Pista) => { id: string; pontos: number } | null;
  resolverIsento: (id: string | null) => string | null;
  resolverDigitoSolto: (id: string | null) => string | null;
  formatarParaCampo: (campo: string, perfil: Record<string, unknown>, alvo?: Alvo) => string;
  escolherOpcao: (opcoes: Opcao[], valor: unknown, tipo?: string) => number;
  combinaSimNao: (rotulo: string, valor: unknown) => boolean;
  marcadoEmMulti: (rotulo: string, valor: unknown) => boolean;
};

const codigo = readFileSync(resolve(__dirname, "../extensao/cadastro-campos.js"), "utf-8");
const escopo: { HZ_CADASTRO?: Catalogo } = {};
new Function("globalThis", codigo)(escopo);
const HZ = escopo.HZ_CADASTRO as Catalogo;

/** Atalho: só o que importa é o id reconhecido. */
const quem = (pista: Pista) => (HZ.reconhecerCampo(pista) || { id: null }).id;

describe("catálogo", () => {
  it("publica as seções e nenhum id repetido", () => {
    expect(HZ.SECOES.length).toBeGreaterThan(3);
    const ids = HZ.CAMPOS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("reconhecimento pelo rótulo", () => {
  it.each([
    ["CNPJ", "cnpj"],
    ["Razão social", "razao_social"],
    ["Nome fantasia", "nome_fantasia"],
    ["Início da atividade", "inicio_atividade"],
    ["Patrimônio líquido", "patrimonio_liquido"],
    ["Capital integralizado", "capital_integralizado"],
    ["Data de integralização", "data_integralizacao"],
    ["Inscrição estadual", "inscricao_estadual"],
    ["Inscrição municipal", "inscricao_municipal"],
    ["Número de funcionários", "numero_funcionarios"],
    ["Possui assinatura digital", "assinatura_digital"],
    ["LC 123/06", "lc123"],
    ["CEP", "cep"],
    ["Logradouro", "logradouro"],
    ["Bairro", "bairro"],
    ["Complemento", "complemento"],
    ["Data de nascimento", "contato_nascimento"],
    ["PIS/PASEP", "contato_pis"],
    ["Telefone (com DDD)", "contato_telefone"],
    ["Confirmação de e-mail", "contato_email_confirmacao"],
    ["Tipo de conta", "banco_tipo_conta"],
    ["Número da agência", "banco_agencia"],
    ["Número da conta", "banco_conta"],
    ["Nome do titular", "banco_titular"],
  ])("%s → %s", (rotulo, esperado) => {
    expect(quem({ rotulo })).toBe(esperado);
  });

  it("o rótulo mais específico vence o mais genérico", () => {
    // "Nome fantasia" contém "nome". Sem a especificidade por padrão, a ordem
    // de declaração no catálogo decidiria — e acrescentar um campo novo
    // mudaria em silêncio o destino de outro.
    expect(quem({ rotulo: "Nome fantasia" })).toBe("nome_fantasia");
    expect(quem({ rotulo: "Nome do titular" })).toBe("banco_titular");
    expect(quem({ rotulo: "Nome" })).toBe("contato_nome");
  });

  it("não confunde e-mail com a confirmação dele", () => {
    expect(quem({ rotulo: "E-mail" })).toBe("contato_email");
    expect(quem({ rotulo: "Confirmação de e-mail" })).toBe("contato_email_confirmacao");
  });

  it("devolve null para campo que não é dado nosso", () => {
    // Resposta legítima e frequente. Chutar o campo mais parecido é o erro
    // que não se pode cometer num cadastro com efeito legal.
    expect(quem({ rotulo: "Senha" })).toBeNull();
    expect(quem({ rotulo: "Código de acesso do edital" })).toBeNull();
    expect(quem({ rotulo: "Digite o texto da imagem" })).toBeNull();
  });

  it("'Estado civil' não é a UF do endereço", () => {
    expect(quem({ rotulo: "Estado" })).toBe("uf");
    expect(quem({ rotulo: "Estado civil" })).toBe("contato_estado_civil");
  });
});

describe("desempate por contexto da seção", () => {
  it("Cidade vai para o endereço, ou para a agência, conforme a seção", () => {
    expect(quem({ rotulo: "Cidade", contexto: "Endereço" })).toBe("cidade");
    expect(quem({ rotulo: "Cidade", contexto: "Dados bancários" })).toBe("banco_cidade");
    expect(quem({ rotulo: "Estado", contexto: "Dados bancários" })).toBe("banco_uf");
  });

  it("Nome e CPF na seção de representantes vão para o representante", () => {
    expect(quem({ rotulo: "Nome", contexto: "Representantes e sócios" })).toBe("rep_nome");
    expect(quem({ rotulo: "CPF", contexto: "Representantes e sócios" })).toBe("rep_cpf");
    expect(quem({ rotulo: "CPF", contexto: "Contato" })).toBe("contato_cpf");
  });

  it("'Número' do endereço não é capturado dentro da seção bancária", () => {
    expect(quem({ rotulo: "Número", contexto: "Endereço" })).toBe("numero_endereco");
    expect(quem({ rotulo: "Número", contexto: "Dados bancários" })).toBeNull();
  });
});

describe("reconhecimento pelos atributos, quando não há rótulo", () => {
  it("usa name e id do campo", () => {
    expect(quem({ atributos: "txtInscricaoEstadual" })).toBe("inscricao_estadual");
    expect(quem({ atributos: "fornecedor_cnpj" })).toBe("cnpj");
  });

  it("o rótulo vence o atributo quando os dois dizem coisas diferentes", () => {
    expect(quem({ rotulo: "Nome fantasia", atributos: "razaoSocial" })).toBe("nome_fantasia");
  });
});

describe("campos sem rótulo próprio", () => {
  it("'Isento' herda a inscrição que veio antes", () => {
    expect(HZ.resolverIsento("inscricao_estadual")).toBe("inscricao_estadual_isento");
    expect(HZ.resolverIsento("inscricao_municipal")).toBe("inscricao_municipal_isento");
    expect(HZ.resolverIsento("cnpj")).toBeNull();
  });

  it("a caixinha do dígito herda a agência ou a conta que veio antes", () => {
    expect(HZ.resolverDigitoSolto("banco_agencia")).toBe("banco_agencia_digito");
    expect(HZ.resolverDigitoSolto("banco_conta")).toBe("banco_conta_digito");
    expect(HZ.resolverDigitoSolto("cep")).toBeNull();
  });
});

describe("formatação de saída", () => {
  const perfil = {
    cnpj: "45153397000190",
    contato_cpf: "06397677532",
    cep: "48015020",
    inicio_atividade: "2022-02-04",
    capital_social: "10000.00",
    contato_ddd: "75",
    contato_telefone: "999930808",
  };

  it("documento sai pontuado quando cabe", () => {
    expect(HZ.formatarParaCampo("cnpj", perfil)).toBe("45.153.397/0001-90");
    expect(HZ.formatarParaCampo("contato_cpf", perfil)).toBe("063.976.775-32");
    expect(HZ.formatarParaCampo("cep", perfil)).toBe("48015-020");
  });

  it("documento sai cru quando o maxlength não comporta a pontuação", () => {
    // O campo mascarado insere a pontuação sozinho; o campo com maxlength do
    // tamanho do número cru truncaria o texto pontuado pela metade, e o
    // cadastro iria com o CNPJ errado.
    expect(HZ.formatarParaCampo("cnpj", perfil, { maxlength: 14 })).toBe("45153397000190");
    expect(HZ.formatarParaCampo("cnpj", perfil, { maxlength: 18 })).toBe("45.153.397/0001-90");
  });

  it("data sai no formato que o campo aceita", () => {
    expect(HZ.formatarParaCampo("inicio_atividade", perfil)).toBe("04/02/2022");
    expect(HZ.formatarParaCampo("inicio_atividade", perfil, { tipoInput: "date" })).toBe("2022-02-04");
  });

  it("moeda sai em pt-BR, ou com ponto decimal em campo numérico", () => {
    expect(HZ.formatarParaCampo("capital_social", perfil)).toBe("10.000,00");
    expect(HZ.formatarParaCampo("capital_social", perfil, { tipoInput: "number" })).toBe("10000.00");
  });

  it("telefone leva o DDD junto, menos quando o campo só comporta o número", () => {
    expect(HZ.formatarParaCampo("contato_telefone", perfil)).toBe("(75) 99993-0808");
    expect(HZ.formatarParaCampo("contato_telefone", perfil, { maxlength: 9 })).toBe("999930808");
  });

  it("campo que o fornecedor não guardou sai vazio", () => {
    // O que sustenta a regra inteira: sem dado guardado, nada é escrito.
    expect(HZ.formatarParaCampo("inscricao_estadual", perfil)).toBe("");
    expect(HZ.formatarParaCampo("patrimonio_liquido", {})).toBe("");
  });

  it("a confirmação de e-mail espelha o e-mail", () => {
    expect(HZ.formatarParaCampo("contato_email_confirmacao", { contato_email: "a@b.com" })).toBe("a@b.com");
  });
});

describe("escolha de opção em select", () => {
  const ufs = [
    { texto: "Selecione", valor: "" },
    { texto: "BAHIA", valor: "BA" },
    { texto: "SÃO PAULO", valor: "SP" },
  ];

  it("acha a UF pela sigla ou pelo nome", () => {
    expect(HZ.escolherOpcao(ufs, "BA", "uf")).toBe(1);
    expect(HZ.escolherOpcao(ufs, "Bahia", "uf")).toBe(1);
    expect(HZ.escolherOpcao(ufs, "São Paulo", "uf")).toBe(2);
  });

  it("nunca escolhe a opção de placeholder", () => {
    expect(HZ.escolherOpcao(ufs, "Selecione", "uf")).toBe(-1);
  });

  it("acha o banco mesmo com o nome escrito de outro jeito", () => {
    const bancos = [
      { texto: "SELECIONE", valor: "" },
      { texto: "001 - BANCO DO BRASIL S.A.", valor: "001" },
      { texto: "260 - NU PAGAMENTOS S.A. - INSTITUIÇÃO DE PAGAMENTO", valor: "260" },
    ];
    expect(HZ.escolherOpcao(bancos, "NUBANK - NU PAGAMENTOS S.A.")).toBe(2);
    expect(HZ.escolherOpcao(bancos, "Banco do Brasil")).toBe(1);
  });

  it("devolve -1 quando nenhuma opção serve", () => {
    // Escolher a opção "mais parecida" num select de bancos é trocar a conta
    // que recebe o pagamento do empenho.
    const bancos = [
      { texto: "SELECIONE", valor: "" },
      { texto: "001 - BANCO DO BRASIL S.A.", valor: "001" },
    ];
    expect(HZ.escolherOpcao(bancos, "NUBANK - NU PAGAMENTOS S.A.")).toBe(-1);
  });

  it("acha o tipo de conta", () => {
    const tipos = [
      { texto: "SELECIONE", valor: "" },
      { texto: "CONTA CORRENTE", valor: "1" },
      { texto: "CONTA POUPANÇA", valor: "2" },
    ];
    expect(HZ.escolherOpcao(tipos, "Conta corrente")).toBe(1);
    expect(HZ.escolherOpcao(tipos, "Conta poupança")).toBe(2);
  });
});

describe("sim/não e múltipla escolha", () => {
  it("casa o rótulo do radio com o valor guardado", () => {
    expect(HZ.combinaSimNao("Sim", "Sim")).toBe(true);
    expect(HZ.combinaSimNao("Não", "Sim")).toBe(false);
    expect(HZ.combinaSimNao("Não", "Não")).toBe(true);
    expect(HZ.combinaSimNao("Sim", "")).toBe(false);
  });

  it("marca só as atividades que o fornecedor declarou", () => {
    expect(HZ.marcadoEmMulti("Serviço", ["Serviço"])).toBe(true);
    expect(HZ.marcadoEmMulti("Comércio", ["Serviço"])).toBe(false);
    expect(HZ.marcadoEmMulti("Indústria", [])).toBe(false);
  });
});
