import { describe, it, expect } from "vitest";
import {
  PNCP_TAMANHO_PAGINA_CONTRATACOES,
  PNCP_MODALIDADES_POR_RELEVANCIA,
  PNCP_MODALIDADES,
  montarQueryContratacoes,
  montarQueryBuscaIndexadaPncp,
  normalizarItemBuscaIndexadaPncp,
  temProximaPagina,
  chaveContratacao,
  parseNumeroControlePNCP,
  escolherArquivoEdital,
  escolherArquivosPrincipaisEdital,
  formatarDataPncp,
  nomeModalidade,
  PNCP_LATENCIA_OK_MEDIDA_MS,
  PNCP_TIMEOUT_PADRAO_MS,
  PNCP_ORCAMENTO_PADRAO_MS,
  PNCP_MAX_DURACAO_PADRAO_S,
  classificarStatusPncp
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

  it("decompõe URL direta de edital do PNCP", () => {
    expect(parseNumeroControlePNCP("https://pncp.gov.br/app/editais/79151312000156/2026/000501")).toEqual({
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

describe("escolherArquivoEdital e escolherArquivosPrincipaisEdital", () => {
  it("prefere o edital ao termo de referência e aos anexos", () => {
    const escolhido = escolherArquivoEdital([
      { titulo: "Anexo I - Planilha.xlsx", tipo: "Anexo", uri: "u1" },
      { titulo: "Termo de Referência", tipo: "Termo de Referência", uri: "u2" },
      { titulo: "Edital PE 45-2026.pdf", tipo: "Edital", uri: "u3" },
    ]);
    expect(escolhido?.uri).toBe("u3");
  });

  it("seleciona tanto o Edital quanto o Termo de Referência quando publicados em arquivos separados", () => {
    const principais = escolherArquivosPrincipaisEdital([
      { titulo: "Anexo I - Planilha.xlsx", tipo: "Anexo", uri: "u1" },
      { titulo: "Termo de Referência.pdf", tipo: "Termo de Referência", uri: "u2" },
      { titulo: "Edital PE 45-2026.pdf", tipo: "Edital", uri: "u3" },
    ]);
    expect(principais.map(a => a.uri)).toEqual(["u3", "u2"]);
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

describe("montarQueryBuscaIndexadaPncp e normalizarItemBuscaIndexadaPncp", () => {
  it("usa status=todos por padrão para exibir licitações abertas e encerradas", () => {
    const p = new URLSearchParams(montarQueryBuscaIndexadaPncp({ pagina: 1, tamanhoPagina: 20 }));
    expect(p.get("status")).toBe("todos");
    expect(p.get("tipos_documento")).toBe("edital");
    expect(p.get("ordenacao")).toBe("-data");
  });

  it("normaliza item do índice /api/search/ para o formato da aplicação", () => {
    const norm = normalizarItemBuscaIndexadaPncp({
      numero_controle_pncp: "79151312000156-1-000501/2026",
      orgao_cnpj: "79151312000156",
      orgao_nome: "Município de Teste",
      unidade_codigo: "987654",
      unidade_nome: "Secretaria de Administração",
      municipio_nome: "Curitiba",
      uf: "PR",
      ano: "2026",
      numero_sequencial: "501",
      modalidade_licitacao_id: "6",
      modalidade_licitacao_nome: "Pregão - Eletrônico",
      description: "Aquisição de notebooks corporativos",
      valor_global: 125000.5
    });
    expect(norm.numeroControlePNCP).toBe("79151312000156-1-000501/2026");
    expect(norm.linkPNCP).toBe("https://pncp.gov.br/app/editais/79151312000156/2026/000501");
    expect(norm.valorTotalEstimado).toBe(125000.5);
    expect(norm.objetoCompra).toBe("Aquisição de notebooks corporativos");
  });
});

describe("formatarDataPncp", () => {
  it("usa AAAAMMDD", () => {
    expect(formatarDataPncp(new Date(2026, 8, 5))).toBe("20260905");
  });
});

describe("prazos calibrados pela medição do portal", () => {
  it("o timeout por consulta fica acima da resposta 200 mais lenta já medida", () => {
    expect(PNCP_TIMEOUT_PADRAO_MS).toBeGreaterThan(PNCP_LATENCIA_OK_MEDIDA_MS);
  });

  it("o orçamento da varredura comporta ao menos uma consulta inteira", () => {
    expect(PNCP_ORCAMENTO_PADRAO_MS).toBeGreaterThanOrEqual(PNCP_TIMEOUT_PADRAO_MS);
  });

  it("a duração da função comporta o orçamento, com folga para responder", () => {
    expect(PNCP_MAX_DURACAO_PADRAO_S * 1000).toBeGreaterThan(PNCP_ORCAMENTO_PADRAO_MS);
  });

  it("não ultrapassa o teto de 60 s do plano Hobby da Vercel", () => {
    expect(PNCP_MAX_DURACAO_PADRAO_S).toBeLessThanOrEqual(60);
  });
});

describe("classificarStatusPncp", () => {
  it("trata 429 como condição do portal, não violação de contrato", () => {
    expect(classificarStatusPncp(429)).toBe("portal");
  });

  it("trata esperas (408, 425) como condição do portal", () => {
    expect(classificarStatusPncp(408)).toBe("portal");
    expect(classificarStatusPncp(425)).toBe("portal");
  });

  it("mantém 5xx como condição do portal", () => {
    expect(classificarStatusPncp(500)).toBe("portal");
    expect(classificarStatusPncp(502)).toBe("portal");
    expect(classificarStatusPncp(504)).toBe("portal");
  });

  it("continua acusando violação de contrato nos 4xx que dizem respeito à consulta", () => {
    expect(classificarStatusPncp(400)).toBe("contrato");
    expect(classificarStatusPncp(404)).toBe("contrato");
    expect(classificarStatusPncp(422)).toBe("contrato");
  });

  it("trata as respostas de sucesso como ok", () => {
    expect(classificarStatusPncp(200)).toBe("ok");
    expect(classificarStatusPncp(204)).toBe("ok");
  });
});

describe("buscarContratacoesPncp (cliente híbrido navegador + fallback)", () => {
  it("retorna resultados imediatos quando /api/search/ responde no navegador", async () => {
    const { buscarContratacoesPncp } = await import("./pncpClient");
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          total: 1,
          items: [
            {
              numero_controle_pncp: "79151312000156-1-000501/2026",
              orgao_cnpj: "79151312000156",
              orgao_nome: "Prefeitura Municipal",
              municipio_nome: "São Paulo",
              uf: "SP",
              ano: "2026",
              numero_sequencial: "501",
              modalidade_licitacao_id: "6",
              description: "Aquisição de computadores",
              valor_global: 50000,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as any;

    try {
      const res = await buscarContratacoesPncp({
        pagina: 1,
        tamanhoPagina: 15,
        status: "todos",
      });
      expect(res.data).toHaveLength(1);
      expect(res.totalRegistros).toBe(1);
      expect(res.resultadoParcial).toBe(false);
      expect(res.data[0].numeroControlePNCP).toBe("79151312000156-1-000501/2026");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("nunca marca resultadoParcial=true quando a lista retornada pelo fallback está vazia", async () => {
    const { buscarContratacoesPncp } = await import("./pncpClient");
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes("pncp.gov.br")) {
        throw new Error("CORS blocked in test");
      }
      return new Response(
        JSON.stringify({
          data: [],
          totalRegistros: 0,
          totalPaginas: 1,
          resultadoParcial: true,
          source: "pncp_api_real",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    try {
      const res = await buscarContratacoesPncp({
        pagina: 1,
        tamanhoPagina: 15,
        status: "todos",
      });
      expect(res.data).toHaveLength(0);
      expect(res.resultadoParcial).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("envia ufs no plural (nunca uf), aceita propostas_encerradas e fontes na busca indexada", () => {
    const p = new URLSearchParams(
      montarQueryBuscaIndexadaPncp({
        ufs: ["sp", "rj"],
        modalidades: ["6", "8"],
        fontes: ["3", "5"],
        status: "propostas_encerradas",
      })
    );
    expect(p.get("ufs")).toBe("SP|RJ");
    expect(p.get("uf")).toBeNull();
    expect(p.get("modalidades")).toBe("6|8");
    expect(p.get("fontes")).toBe("3|5");
    expect(p.get("status")).toBe("propostas_encerradas");
  });

  it("filtra defensivamente por UF, município sem acento e período de publicação na Camada 1", async () => {
    const { buscarContratacoesPncp } = await import("./pncpClient");
    const origFetch = globalThis.fetch;
    let urlChamada = "";
    const hojeIso = new Date().toISOString();
    const antigoIso = new Date(Date.now() - 200 * 86_400_000).toISOString();

    globalThis.fetch = (async (url: string) => {
      urlChamada = String(url);
      return new Response(
        JSON.stringify({
          total: 3,
          items: [
            {
              numero_controle_pncp: "11111111000111-1-000001/2026",
              orgao_cnpj: "11111111000111",
              orgao_nome: "Prefeitura de São Paulo",
              municipio_nome: "São Paulo",
              uf: "SP",
              ano: "2026",
              numero_sequencial: "1",
              data_publicacao_pncp: hojeIso,
              description: "Compra recente SP",
            },
            {
              numero_controle_pncp: "22222222000122-1-000002/2026",
              orgao_cnpj: "22222222000122",
              orgao_nome: "Prefeitura de Maceió",
              municipio_nome: "São Paulo",
              uf: "AL",
              ano: "2026",
              numero_sequencial: "2",
              data_publicacao_pncp: hojeIso,
              description: "Item de outro estado",
            },
            {
              numero_controle_pncp: "33333333000133-1-000003/2025",
              orgao_cnpj: "33333333000133",
              orgao_nome: "Prefeitura de São Paulo",
              municipio_nome: "São Paulo",
              uf: "SP",
              ano: "2025",
              numero_sequencial: "3",
              data_publicacao_pncp: antigoIso,
              description: "Compra antiga fora do período",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    try {
      const res = await buscarContratacoesPncp({
        pagina: 1,
        tamanhoPagina: 15,
        status: "todos",
        ufs: ["SP"],
        municipio: "Sao Paulo",
        periodDays: 30,
      });
      expect(urlChamada).toContain("ufs=SP");
      expect(urlChamada).not.toMatch(/[?&]uf=/);
      expect(res.data).toHaveLength(1);
      expect(res.data[0].numeroControlePNCP).toBe("11111111000111-1-000001/2026");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("repassa fontes e status=propostas_encerradas ao proxy na Camada 3", async () => {
    const { buscarContratacoesPncp } = await import("./pncpClient");
    const origFetch = globalThis.fetch;
    let proxyUrl = "";

    globalThis.fetch = (async (url: string) => {
      if (String(url).includes("pncp.gov.br")) {
        throw new Error("CORS blocked in test");
      }
      proxyUrl = String(url);
      return new Response(
        JSON.stringify({ data: [], totalRegistros: 0, totalPaginas: 1, source: "pncp_api_real" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    try {
      await buscarContratacoesPncp({
        pagina: 1,
        tamanhoPagina: 15,
        status: "propostas_encerradas",
        ufs: ["SP", "MG"],
        fontes: ["3", "5"],
      });
      expect(proxyUrl).toContain("ufs=SP%2CMG");
      expect(proxyUrl).toContain("fontes=3%2C5");
      expect(proxyUrl).toContain("status=propostas_encerradas");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
