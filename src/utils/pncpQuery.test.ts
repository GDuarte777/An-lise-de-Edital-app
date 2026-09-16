import { describe, it, expect } from "vitest";
import {
  PNCP_TAMANHO_PAGINA_CONTRATACOES,
  PNCP_MODALIDADES_POR_RELEVANCIA,
  PNCP_MODALIDADES,
  montarQueryContratacoes,
  temProximaPagina,
  chaveContratacao,
  parseNumeroControlePNCP,
  escolherArquivoEdital,
  formatarDataPncp,
  nomeModalidade,
} from "./pncpQuery";

describe("tamanho de página", () => {
  it("respeita o teto de 50 das contratações", () => {
    // Esta é a regressão que zerava o Radar: 500 devolve 400 do PNCP.
    expect(PNCP_TAMANHO_PAGINA_CONTRATACOES).toBe(50);
  });

  it("nunca deixa a query passar do teto, mesmo se pedirem mais", () => {
    const query = montarQueryContratacoes({
      endpoint: "proposta",
      modalidade: "6",
      pagina: 1,
      dataFinal: "20270101",
      tamanhoPagina: 500,
    });
    expect(new URLSearchParams(query).get("tamanhoPagina")).toBe("50");
  });

  it("respeita o piso de 10", () => {
    const query = montarQueryContratacoes({
      endpoint: "proposta",
      modalidade: "6",
      pagina: 1,
      dataFinal: "20270101",
      tamanhoPagina: 1,
    });
    expect(new URLSearchParams(query).get("tamanhoPagina")).toBe("10");
  });
});

describe("montarQueryContratacoes", () => {
  it("inclui os parâmetros obrigatórios", () => {
    const p = new URLSearchParams(
      montarQueryContratacoes({ endpoint: "proposta", modalidade: "6", pagina: 2, dataFinal: "20270101" }),
    );
    expect(p.get("dataFinal")).toBe("20270101");
    expect(p.get("codigoModalidadeContratacao")).toBe("6");
    expect(p.get("pagina")).toBe("2");
  });

  it("manda dataInicial só no endpoint de publicação", () => {
    const publicacao = new URLSearchParams(
      montarQueryContratacoes({
        endpoint: "publicacao",
        modalidade: "6",
        pagina: 1,
        dataInicial: "20260101",
        dataFinal: "20270101",
      }),
    );
    expect(publicacao.get("dataInicial")).toBe("20260101");

    // No endpoint de proposta o parâmetro não existe, e mandá-lo rende 400.
    const proposta = new URLSearchParams(
      montarQueryContratacoes({
        endpoint: "proposta",
        modalidade: "6",
        pagina: 1,
        dataInicial: "20260101",
        dataFinal: "20270101",
      }),
    );
    expect(proposta.get("dataInicial")).toBeNull();
  });

  it("usa os nomes de parâmetro que a API espera para UF e município", () => {
    const p = new URLSearchParams(
      montarQueryContratacoes({
        endpoint: "proposta",
        modalidade: "6",
        pagina: 1,
        dataFinal: "20270101",
        uf: "SP",
        municipio: "3550308",
      }),
    );
    expect(p.get("uf")).toBe("SP");
    expect(p.get("codigoMunicipioIbge")).toBe("3550308");
  });

  it("omite UF e município quando não informados", () => {
    const p = new URLSearchParams(
      montarQueryContratacoes({ endpoint: "proposta", modalidade: "6", pagina: 1, dataFinal: "20270101" }),
    );
    expect(p.get("uf")).toBeNull();
    expect(p.get("codigoMunicipioIbge")).toBeNull();
  });
});

describe("modalidades", () => {
  it("cobre todas as da tabela de domínio", () => {
    expect(PNCP_MODALIDADES_POR_RELEVANCIA.length).toBe(Object.keys(PNCP_MODALIDADES).length);
    for (const codigo of Object.keys(PNCP_MODALIDADES)) {
      expect(PNCP_MODALIDADES_POR_RELEVANCIA).toContain(codigo);
    }
  });

  it("começa pelo Pregão Eletrônico, que é o de maior volume", () => {
    expect(PNCP_MODALIDADES_POR_RELEVANCIA[0]).toBe("6");
    expect(nomeModalidade(6)).toBe("Pregão - Eletrônico");
  });

  it("não confunde 5 com Pregão Eletrônico", () => {
    // O código antigo tratava 5 como Pregão Eletrônico; 5 é Concorrência Presencial.
    expect(nomeModalidade(5)).toBe("Concorrência - Presencial");
  });
});

describe("temProximaPagina", () => {
  it("segue enquanto a API disser que restam páginas", () => {
    expect(temProximaPagina({ data: [{}], paginasRestantes: 3 }, 1)).toBe(true);
    expect(temProximaPagina({ data: [{}], paginasRestantes: 0 }, 4)).toBe(false);
  });

  it("cai para totalPaginas quando paginasRestantes não vem", () => {
    expect(temProximaPagina({ data: [{}], totalPaginas: 3 }, 1)).toBe(true);
    expect(temProximaPagina({ data: [{}], totalPaginas: 3 }, 3)).toBe(false);
  });

  it("para em página vazia, mesmo se a API disser que há mais", () => {
    // Envelope malformado não pode virar laço infinito de requisições.
    expect(temProximaPagina({ data: [], paginasRestantes: 99 }, 1)).toBe(false);
    expect(temProximaPagina({}, 1)).toBe(false);
  });
});

describe("chaveContratacao", () => {
  it("usa o número de controle quando existe", () => {
    expect(chaveContratacao({ numeroControlePNCP: "X-1-000501/2026" })).toBe("X-1-000501/2026");
  });

  it("monta a chave a partir de CNPJ, ano e sequencial quando falta o número", () => {
    expect(
      chaveContratacao({ orgaoEntidade: { cnpj: "79151312000156" }, anoCompra: 2026, sequencialCompra: 501 }),
    ).toBe("79151312000156-2026-501");
  });
});

describe("parseNumeroControlePNCP", () => {
  it("decompõe o número de controle", () => {
    expect(parseNumeroControlePNCP("79151312000156-1-000501/2026")).toEqual({
      cnpj: "79151312000156",
      sequencial: "501",
      ano: "2026",
    });
  });

  it("devolve null para número fora do formato", () => {
    expect(parseNumeroControlePNCP("qualquer coisa")).toBeNull();
    expect(parseNumeroControlePNCP("")).toBeNull();
  });
});

describe("escolherArquivoEdital", () => {
  it("prefere o edital ao termo de referência e aos anexos", () => {
    const escolhido = escolherArquivoEdital([
      { titulo: "Anexo I - Planilha.xlsx", tipo: "Anexo", uri: "u1" },
      { titulo: "Termo de Referência", tipo: "Termo de Referência", uri: "u2" },
      { titulo: "Edital PE 45-2026.pdf", tipo: "Edital", uri: "u3" },
    ]);
    expect(escolhido?.uri).toBe("u3");
  });

  it("cai para o termo de referência quando não há edital", () => {
    const escolhido = escolherArquivoEdital([
      { titulo: "Anexo II - Mapa.png", tipo: "Anexo", uri: "u1" },
      { titulo: "Termo de Referência.pdf", tipo: "Termo de Referência", uri: "u2" },
    ]);
    expect(escolhido?.uri).toBe("u2");
  });

  it("não escolhe errata no lugar do edital", () => {
    const escolhido = escolherArquivoEdital([
      { titulo: "Errata do Edital", tipo: "Retificação", uri: "u1" },
      { titulo: "Edital.pdf", tipo: "Edital", uri: "u2" },
    ]);
    expect(escolhido?.uri).toBe("u2");
  });

  it("não escolhe ata nem resultado", () => {
    // São posteriores à disputa e não ajudam a decidir se vale participar.
    expect(
      escolherArquivoEdital([{ titulo: "Ata de Registro de Preços", tipo: "Ata", uri: "u1" }]),
    ).toBeNull();
  });

  it("devolve null quando não há candidato plausível", () => {
    expect(escolherArquivoEdital([])).toBeNull();
    expect(escolherArquivoEdital([{ titulo: "foto.jpg", tipo: "Imagem", uri: "u1" }])).toBeNull();
  });

  it("ignora arquivo sem uri", () => {
    expect(escolherArquivoEdital([{ titulo: "Edital.pdf", tipo: "Edital" }])).toBeNull();
  });
});

describe("formatarDataPncp", () => {
  it("usa AAAAMMDD", () => {
    expect(formatarDataPncp(new Date(2026, 8, 5))).toBe("20260905");
  });
});
