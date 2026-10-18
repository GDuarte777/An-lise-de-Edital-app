// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// Teste do content script que escreve nos campos do portal. Ele monta um DOM
// com a estrutura dos formulários reais — rótulo em `<label for>`, seção com
// título, dígito verificador numa caixinha sem rótulo, "Isento" solto ao lado
// da inscrição — e confere o que foi escrito.
//
// Não há radix nem React aqui, só DOM puro, então a armadilha de desmontagem
// descrita no CLAUDE.md não se aplica: o arquivo roda em ~100 ms.

const raiz = resolve(__dirname, "..");
const fonteCatalogo = readFileSync(resolve(raiz, "extensao/cadastro-campos.js"), "utf-8");
const fontePreenchimento = readFileSync(resolve(raiz, "extensao/cadastro-preenchimento.js"), "utf-8");

type Resposta = { ok: boolean; preenchidos: number; semDado: number; semPerfil?: boolean };
type Ouvinte = (m: { action: string }, r: unknown, responder: (x: Resposta) => void) => boolean;

/** O perfil dos prints, com os dados já normalizados como o painel grava. */
const PERFIL = {
  pais: "BRASIL",
  cnpj: "45153397000190",
  razao_social: "45.153.397 GABRIEL DUARTE MOTA SOUZA",
  nome_fantasia: "45.153.397 GABRIEL DUARTE MOTA SOUZA",
  inicio_atividade: "2022-02-04",
  patrimonio_liquido: "10000.00",
  assinatura_digital: "Sim",
  indicativo_atividade: ["Serviço"],
  cep: "48015020",
  logradouro: "AVENIDA CONSELHEIRO JUNQUEIRA 595",
  numero_endereco: "595",
  bairro: "CATU",
  uf: "BA",
  cidade: "ALAGOINHAS",
  inscricao_estadual: "246.424.31-4",
  contato_nome: "GABRIEL DUARTE MOTA SOUZA",
  contato_cpf: "06397677532",
  contato_nascimento: "1999-09-07",
  banco_nome: "NUBANK - NU PAGAMENTOS S.A.",
  banco_agencia: "0001",
  banco_conta: "64252707",
  banco_conta_digito: "9",
  banco_titular: "GABRIEL DUARTE MOTA SOUZA",
  banco_uf: "BA",
  banco_cidade: "ALAGOINHAS",
};

/**
 * Carrega os dois arquivos da extensão e devolve o gatilho de preenchimento.
 *
 * O content script pede o perfil ao `chrome.storage` e expõe o preenchimento
 * por `chrome.runtime.onMessage` — então o dublê de `chrome` entrega o perfil
 * e guarda o ouvinte, que é por onde o teste manda preencher. As preferências
 * vão com `auto: false` para o script não disparar sozinho no meio do teste.
 */
function carregar(html: string, perfil: Record<string, unknown> | null = PERFIL) {
  document.body.innerHTML = html;
  let ouvinte: Ouvinte | null = null;

  const global = globalThis as unknown as Record<string, unknown>;
  delete global.HZ_CADASTRO;
  delete (window as unknown as Record<string, unknown>).__HZ_CADASTRO_ATIVO__;
  global.chrome = {
    storage: {
      local: {
        get: (_chaves: string[], responder: (d: unknown) => void) =>
          responder({ hz_cadastro_perfil: perfil, hz_cadastro_opcoes: { auto: false, sobrescrever: false } }),
      },
    },
    runtime: {
      onMessage: { addListener: (fn: Ouvinte) => { ouvinte = fn; } },
      sendMessage: () => undefined,
      getURL: (caminho: string) => caminho,
    },
  };

  new Function(fonteCatalogo)();
  new Function(fontePreenchimento)();

  return () => new Promise<Resposta>((resolver) => {
    (ouvinte as unknown as Ouvinte)({ action: "horasis_cadastro_preencher" }, null, resolver);
  });
}

const valor = (id: string) => (document.getElementById(id) as HTMLInputElement).value;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("preenchimento de um cadastro em passos", () => {
  const PASSO_GERAL = `
    <section>
      <h2>GERAL</h2>
      <div><label for="pais">País</label><input id="pais" /></div>
      <div><label for="cnpj">CNPJ</label><input id="cnpj" maxlength="18" /></div>
      <div><label for="razao">Razão social</label><input id="razao" /></div>
      <div><label for="fantasia">Nome fantasia</label><input id="fantasia" /></div>
      <div>
        <label>Indicativo de atividade</label>
        <label><input type="checkbox" id="atvCom" />Comércio</label>
        <label><input type="checkbox" id="atvInd" />Indústria</label>
        <label><input type="checkbox" id="atvSer" />Serviço</label>
      </div>
      <div><label for="inicio">Início da atividade</label><input id="inicio" type="date" /></div>
      <div><label for="patrimonio">Patrimônio líquido</label><input id="patrimonio" /></div>
      <div>
        <label>Possui assinatura digital</label>
        <label><input type="radio" name="assdig" value="S" />Sim</label>
        <label><input type="radio" name="assdig" value="N" />Não</label>
      </div>
    </section>
    <section>
      <h2>ENDEREÇO</h2>
      <div><label for="cep">CEP</label><input id="cep" maxlength="9" /></div>
      <div><label for="log">Logradouro</label><input id="log" /></div>
      <div><label for="num">Número</label><input id="num" /></div>
      <div><label for="bairro">Bairro</label><input id="bairro" /></div>
      <div><label for="uf">Estado</label>
        <select id="uf"><option value="">SELECIONE</option><option value="BA">BAHIA</option><option value="SP">SÃO PAULO</option></select>
      </div>
      <div><label for="cid">Cidade</label>
        <select id="cid"><option value="">SELECIONE</option><option>ALAGOINHAS</option><option>SALVADOR</option></select>
      </div>
    </section>
    <section>
      <h2>DADOS COMPLEMENTARES</h2>
      <div><label for="ie">Inscrição estadual</label><input id="ie" /><label><input type="checkbox" id="ieIsento" />Isento</label></div>
      <div><label for="cpf">CPF</label><input id="cpf" maxlength="14" /></div>
      <div><label for="nasc">Data de nascimento</label><input id="nasc" type="date" /></div>
      <div><label for="senha">Senha</label><input id="senha" type="password" /></div>
    </section>`;

  it("escreve os campos do passo de dados gerais", async () => {
    const preencher = carregar(PASSO_GERAL);
    const resposta = await preencher();

    expect(resposta.ok).toBe(true);
    expect(valor("pais")).toBe("BRASIL");
    expect(valor("cnpj")).toBe("45.153.397/0001-90");
    expect(valor("razao")).toBe("45.153.397 GABRIEL DUARTE MOTA SOUZA");
    expect(valor("fantasia")).toBe("45.153.397 GABRIEL DUARTE MOTA SOUZA");
    expect(valor("cep")).toBe("48015-020");
    expect(valor("log")).toBe("AVENIDA CONSELHEIRO JUNQUEIRA 595");
    expect(valor("num")).toBe("595");
    expect(valor("bairro")).toBe("CATU");
    expect(valor("ie")).toBe("246.424.31-4");
    expect(valor("cpf")).toBe("063.976.775-32");
  });

  it("escreve data no formato do campo e moeda em pt-BR", async () => {
    const preencher = carregar(PASSO_GERAL);
    await preencher();
    expect(valor("inicio")).toBe("2022-02-04");
    expect(valor("nasc")).toBe("1999-09-07");
    expect(valor("patrimonio")).toBe("10.000,00");
  });

  it("escolhe a opção certa nos selects de estado e cidade", async () => {
    const preencher = carregar(PASSO_GERAL);
    await preencher();
    expect((document.getElementById("uf") as HTMLSelectElement).value).toBe("BA");
    expect((document.getElementById("cid") as HTMLSelectElement).value).toBe("ALAGOINHAS");
  });

  it("marca o radio pelo rótulo do grupo e as atividades declaradas", async () => {
    const preencher = carregar(PASSO_GERAL);
    await preencher();
    const sim = document.querySelector('input[name="assdig"][value="S"]') as HTMLInputElement;
    const nao = document.querySelector('input[name="assdig"][value="N"]') as HTMLInputElement;
    expect(sim.checked).toBe(true);
    expect(nao.checked).toBe(false);
    expect((document.getElementById("atvSer") as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById("atvCom") as HTMLInputElement).checked).toBe(false);
  });

  it("nunca toca em campo de senha", async () => {
    const preencher = carregar(PASSO_GERAL);
    await preencher();
    expect(valor("senha")).toBe("");
  });

  it("deixa em branco o que o fornecedor não guardou, e diz o que faltou", async () => {
    // O núcleo da regra: sem dado guardado, nada é escrito. Um "não informado"
    // ou um palpite plausível num cadastro de fornecedor é declaração falsa.
    const preencher = carregar(`
      <section><h2>GERAL</h2>
        <div><label for="cnpj">CNPJ</label><input id="cnpj" /></div>
        <div><label for="im">Inscrição municipal</label><input id="im" /></div>
        <div><label for="func">Número de funcionários</label><input id="func" /></div>
        <div><label for="nat">Natureza jurídica</label><input id="nat" /></div>
        <div><label for="cap">Capital social</label><input id="cap" /></div>
        <div><label for="porte">Porte</label><input id="porte" /></div>
      </section>`);
    const resposta = await preencher();
    expect(valor("im")).toBe("");
    expect(valor("func")).toBe("");
    expect(valor("nat")).toBe("");
    expect(resposta.semDado).toBe(5);
    expect(resposta.preenchidos).toBe(1);
  });

  it("não escreve em campo que o operador já preencheu", async () => {
    const preencher = carregar(PASSO_GERAL);
    (document.getElementById("log") as HTMLInputElement).value = "ENDEREÇO QUE EU CORRIGI";
    await preencher();
    expect(valor("log")).toBe("ENDEREÇO QUE EU CORRIGI");
  });

  it("ignora o passo ainda fechado do assistente", async () => {
    // Preencher um passo escondido faz a validação do portal reclamar de um
    // campo que o operador nunca viu.
    const preencher = carregar(`
      <section><h2>GERAL</h2><div><label for="cnpj">CNPJ</label><input id="cnpj" /></div>
        <div><label for="razao">Razão social</label><input id="razao" /></div>
        <div><label for="cep">CEP</label><input id="cep" /></div>
        <div><label for="bairro">Bairro</label><input id="bairro" /></div></section>
      <section style="display:none"><h2>DADOS BANCÁRIOS</h2>
        <div><label for="titular">Nome do titular</label><input id="titular" /></div>
        <div><label for="ag">Número da agência</label><input id="ag" /></div>
      </section>`);
    await preencher();
    expect(valor("cnpj")).not.toBe("");
    expect(valor("titular")).toBe("");
    expect(valor("ag")).toBe("");
  });
});

describe("passo de dados bancários", () => {
  const PASSO_BANCO = `
    <section>
      <h2>DADOS BANCÁRIOS</h2>
      <div><label for="banco">Banco</label>
        <select id="banco"><option value="">SELECIONE</option><option value="001">001 - BANCO DO BRASIL S.A.</option><option value="260">260 - NU PAGAMENTOS S.A. - INSTITUIÇÃO DE PAGAMENTO</option></select>
      </div>
      <div><label for="tipoConta">Tipo de conta</label>
        <select id="tipoConta"><option value="">SELECIONE</option><option>CONTA CORRENTE</option><option>CONTA POUPANÇA</option></select>
      </div>
      <div><label for="titular">Nome do titular</label><input id="titular" /></div>
      <div><label for="bUf">Estado</label>
        <select id="bUf"><option value="">SELECIONE</option><option value="BA">BAHIA</option></select>
      </div>
      <div><label for="bCidade">Cidade</label>
        <select id="bCidade"><option value="">SELECIONE</option><option>ALAGOINHAS</option></select>
      </div>
      <div><label for="ag">Número da agência</label><input id="ag" /> - <input id="agDv" maxlength="1" /></div>
      <div><label for="conta">Número da conta</label><input id="conta" /> - <input id="contaDv" maxlength="1" /></div>
    </section>`;

  it("acha o banco pelo nome, mesmo escrito de outro jeito", async () => {
    const preencher = carregar(PASSO_BANCO);
    await preencher();
    expect((document.getElementById("banco") as HTMLSelectElement).value).toBe("260");
  });

  it("não escolhe tipo de conta que o fornecedor não declarou", async () => {
    const preencher = carregar(PASSO_BANCO);
    await preencher();
    expect((document.getElementById("tipoConta") as HTMLSelectElement).value).toBe("");
  });

  it("separa a conta do seu dígito verificador", async () => {
    // A caixinha do dígito fica na mesma linha, sem rótulo próprio. Se ela
    // herdasse o rótulo do vizinho, receberia o número da conta inteiro.
    const preencher = carregar(PASSO_BANCO);
    await preencher();
    expect(valor("ag")).toBe("0001");
    expect(valor("conta")).toBe("64252707");
    expect(valor("contaDv")).toBe("9");
    expect(valor("agDv")).toBe("");
  });

  it("a cidade e o estado da seção bancária recebem os da agência", async () => {
    const preencher = carregar(PASSO_BANCO);
    await preencher();
    expect((document.getElementById("bUf") as HTMLSelectElement).value).toBe("BA");
    expect((document.getElementById("bCidade") as HTMLSelectElement).value).toBe("ALAGOINHAS");
  });
});

describe("formulário montado em tabela", () => {
  it("lê o rótulo da célula anterior", async () => {
    // Boa parte dos portais estaduais ainda monta o formulário em tabela, sem
    // um `<label for>` em lugar nenhum.
    const preencher = carregar(`
      <h3>Dados do fornecedor</h3>
      <table>
        <tr><td>CNPJ</td><td><input id="a" /></td></tr>
        <tr><td>Razão Social</td><td><input id="b" /></td></tr>
        <tr><td>CEP</td><td><input id="c" /></td></tr>
        <tr><td>Bairro</td><td><input id="d" /></td></tr>
        <tr><td>Telefone</td><td><input id="e" /></td></tr>
        <tr><td>E-mail</td><td><input id="f" /></td></tr>
      </table>`, { ...PERFIL, contato_ddd: "75", contato_telefone: "999930808", contato_email: "gabriel@exemplo.com" });
    await preencher();
    expect(valor("a")).toBe("45.153.397/0001-90");
    expect(valor("b")).toBe("45.153.397 GABRIEL DUARTE MOTA SOUZA");
    expect(valor("c")).toBe("48015-020");
    expect(valor("e")).toBe("(75) 99993-0808");
    expect(valor("f")).toBe("gabriel@exemplo.com");
  });
});

describe("sem perfil guardado", () => {
  it("não escreve nada e avisa", async () => {
    const preencher = carregar(`<div><label for="cnpj">CNPJ</label><input id="cnpj" /></div>`, null);
    const resposta = await preencher();
    expect(resposta.semPerfil).toBe(true);
    expect(valor("cnpj")).toBe("");
  });
});
