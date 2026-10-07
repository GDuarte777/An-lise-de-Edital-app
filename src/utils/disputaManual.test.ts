import { describe, it, expect } from "vitest";
import { parseDisputaDate } from "./disputaDates";
import {
  combinarDataHora,
  separarDataHora,
  normalizarLinkPncp,
  ehLinkPncpOficial,
  validarDisputaManual,
  disputaManualValida,
  criarDisputaManual,
  aplicarEdicaoManual,
  dadosDeDisputa,
  DadosDisputaManual,
} from "./disputaManual";
import { DisputaRow } from "../types";

const BASE: DadosDisputaManual = { orgao: "Prefeitura de Exemplo", data: "2026-11-20", hora: "09:30" };

describe("combinarDataHora", () => {
  it("junta data e hora no formato que o calendário lê", () => {
    expect(combinarDataHora("2026-11-20", "09:30")).toBe("2026-11-20 09:30");
  });

  it("aceita só a data", () => {
    expect(combinarDataHora("2026-11-20")).toBe("2026-11-20");
    expect(combinarDataHora("2026-11-20", "")).toBe("2026-11-20");
  });

  it("devolve vazio para data fora do formato", () => {
    expect(combinarDataHora("20/11/2026", "09:30")).toBe("");
    expect(combinarDataHora("")).toBe("");
  });

  it("produz string que parseDisputaDate consegue ler", () => {
    // Esta é a amarração que importa: gravar num formato que o parser do
    // calendário não entende salvaria a disputa e ela nunca apareceria.
    const texto = combinarDataHora("2026-11-20", "09:30");
    const d = parseDisputaDate(texto);
    expect(d).not.toBeNull();
    expect(d!.getTime()).toBe(new Date(2026, 10, 20, 9, 30).getTime());
  });

  it("a data sem hora também é legível pelo parser", () => {
    expect(parseDisputaDate(combinarDataHora("2026-11-20"))).not.toBeNull();
  });
});

describe("separarDataHora", () => {
  it("desmembra o formato ISO", () => {
    expect(separarDataHora("2026-11-20 09:30")).toEqual({ data: "2026-11-20", hora: "09:30" });
    expect(separarDataHora("2026-11-20")).toEqual({ data: "2026-11-20", hora: "" });
  });

  it("desmembra o formato brasileiro digitado à mão", () => {
    expect(separarDataHora("20/11/2026 09:30")).toEqual({ data: "2026-11-20", hora: "09:30" });
  });

  it("devolve vazio quando não há data legível", () => {
    expect(separarDataHora("a combinar")).toEqual({ data: "", hora: "" });
    expect(separarDataHora("")).toEqual({ data: "", hora: "" });
  });

  it("faz o caminho de ida e volta", () => {
    const { data, hora } = separarDataHora(combinarDataHora("2026-03-05", "14:00"));
    expect(data).toBe("2026-03-05");
    expect(hora).toBe("14:00");
  });
});

describe("normalizarLinkPncp", () => {
  it("completa o esquema quando falta", () => {
    // Sem isso o href vira caminho relativo e o clique fica dentro do app.
    expect(normalizarLinkPncp("pncp.gov.br/app/editais/123/2026/1")).toBe(
      "https://pncp.gov.br/app/editais/123/2026/1",
    );
  });

  it("preserva o link que já tem esquema", () => {
    expect(normalizarLinkPncp("https://pncp.gov.br/x")).toBe("https://pncp.gov.br/x");
    expect(normalizarLinkPncp("http://pncp.gov.br/x")).toBe("http://pncp.gov.br/x");
  });

  it("vazio continua vazio", () => {
    expect(normalizarLinkPncp("")).toBe("");
    expect(normalizarLinkPncp("   ")).toBe("");
  });
});

describe("ehLinkPncpOficial", () => {
  it("reconhece o domínio do PNCP", () => {
    expect(ehLinkPncpOficial("pncp.gov.br/app/editais/1/2026/1")).toBe(true);
    expect(ehLinkPncpOficial("https://www.pncp.gov.br/app")).toBe(true);
  });

  it("não confunde outros portais com o PNCP", () => {
    // Disputa acontece em BLL, Licitanet e afins: não é erro, só não é PNCP.
    expect(ehLinkPncpOficial("https://bllcompras.com/edital/1")).toBe(false);
    expect(ehLinkPncpOficial("")).toBe(false);
  });

  it("não cai em domínio que apenas termina parecido", () => {
    expect(ehLinkPncpOficial("https://pncp.gov.br.exemplo.com/x")).toBe(false);
  });
});

describe("validarDisputaManual", () => {
  it("aceita o preenchimento mínimo", () => {
    expect(validarDisputaManual(BASE)).toEqual({});
    expect(disputaManualValida({ orgao: "X", data: "2026-01-02" })).toBe(true);
  });

  it("exige um rótulo para a disputa", () => {
    // Sem ele a grade mostraria "Órgão não informado" e o evento seria inútil.
    expect(validarDisputaManual({ ...BASE, orgao: "   " }).orgao).toBeDefined();
  });

  it("exige data", () => {
    expect(validarDisputaManual({ ...BASE, data: "" }).data).toBeDefined();
  });

  it("recusa data que casa com o padrão mas não existe", () => {
    expect(validarDisputaManual({ ...BASE, data: "2026-02-31" }).data).toBeDefined();
    expect(validarDisputaManual({ ...BASE, data: "2026-13-01" }).data).toBeDefined();
  });

  it("NÃO trata data no passado como erro", () => {
    // Marcar sessão já ocorrida, para registrar o resultado, é uso legítimo.
    expect(validarDisputaManual({ orgao: "X", data: "2020-01-10" })).toEqual({});
  });

  it("valida a hora quando informada", () => {
    expect(validarDisputaManual({ ...BASE, hora: "25:00" }).hora).toBeDefined();
    expect(validarDisputaManual({ ...BASE, hora: "09:70" }).hora).toBeDefined();
    expect(validarDisputaManual({ ...BASE, hora: "9:30" }).hora).toBeDefined();
    expect(validarDisputaManual({ ...BASE, hora: "" })).toEqual({});
  });

  it("aceita link de qualquer portal, mas recusa texto que não é link", () => {
    expect(validarDisputaManual({ ...BASE, linkPNCP: "pncp.gov.br/app/editais/1/2026/1" })).toEqual({});
    expect(validarDisputaManual({ ...BASE, linkPNCP: "https://bllcompras.com/e/1" })).toEqual({});
    expect(validarDisputaManual({ ...BASE, linkPNCP: "não tenho o link" }).linkPNCP).toBeDefined();
  });

  it("link em branco é permitido", () => {
    expect(validarDisputaManual({ ...BASE, linkPNCP: "" })).toEqual({});
  });
});

describe("criarDisputaManual", () => {
  it("monta uma linha completa com os padrões da Planilha", () => {
    const row = criarDisputaManual(
      {
        orgao: "Prefeitura de Exemplo",
        data: "2026-11-20",
        hora: "09:30",
        numeroLicitacao: "PE 45/2026",
        produtoItem: "Notebooks",
        observacoes: "Cliente avisou por telefone",
        linkPNCP: "pncp.gov.br/app/editais/123/2026/1",
        portal: "Compras.gov.br",
      },
      { id: "id-1" },
    );

    expect(row.id).toBe("id-1");
    expect(row.orgao).toBe("Prefeitura de Exemplo");
    expect(row.dataHoraDisputa).toBe("2026-11-20 09:30");
    expect(row.linkPNCP).toBe("https://pncp.gov.br/app/editais/123/2026/1");
    expect(row.observacoes).toBe("Cliente avisou por telefone");
    expect(row.produtoItem).toBe("Notebooks");
    // Campos que a marcação manual não pede recebem o padrão da Planilha,
    // para a linha não parecer quebrada quando aberta lá.
    expect(row.quantidade).toBe(1);
    expect(row.unidadeMedida).toBe("Unidade");
    expect(row.valorMinimoPiso).toBe(0);
    expect(row.status).toBe("Agendada");
  });

  it("usa o status padrão informado pela tela", () => {
    const row = criarDisputaManual(BASE, { id: "x", statusPadrao: "Em Análise" });
    expect(row.status).toBe("Em Análise");
  });

  it("o status escolhido vence o padrão", () => {
    const row = criarDisputaManual({ ...BASE, status: "Em Disputa" }, { id: "x", statusPadrao: "Agendada" });
    expect(row.status).toBe("Em Disputa");
  });

  it("gera data que o calendário enxerga", () => {
    const row = criarDisputaManual(BASE, { id: "x" });
    expect(parseDisputaDate(row.dataHoraDisputa)).not.toBeNull();
  });
});

describe("aplicarEdicaoManual", () => {
  const original: DisputaRow = {
    id: "orig",
    orgao: "Órgão Antigo",
    uasgUndCompradora: "986531",
    numeroLicitacao: "PE 1/2026",
    portal: "BLL",
    produtoItem: "Item antigo",
    quantidade: 50,
    unidadeMedida: "Caixa",
    valorEstimadoItem: 1000,
    nossoValorAlvo: 900,
    valorMinimoPiso: 800,
    dataHoraDisputa: "2026-01-10 10:00",
    status: "Agendada",
    observacoes: "nota antiga",
    linkPNCP: "https://pncp.gov.br/antigo",
  };

  it("altera o que o formulário controla", () => {
    const editada = aplicarEdicaoManual(original, {
      orgao: "Órgão Novo",
      data: "2026-12-01",
      hora: "15:45",
      numeroLicitacao: "PE 9/2026",
      portal: "Compras.gov.br",
      produtoItem: "Item novo",
      observacoes: "nota nova",
      linkPNCP: "pncp.gov.br/novo",
      status: "Em Disputa",
    });

    expect(editada.orgao).toBe("Órgão Novo");
    expect(editada.dataHoraDisputa).toBe("2026-12-01 15:45");
    expect(editada.linkPNCP).toBe("https://pncp.gov.br/novo");
    expect(editada.status).toBe("Em Disputa");
  });

  it("preserva os campos que a marcação manual não controla", () => {
    // Editar no calendário não pode apagar o piso e os valores definidos na
    // Planilha — são a estratégia de lance da pessoa.
    const editada = aplicarEdicaoManual(original, { orgao: "X", data: "2026-12-01" });
    expect(editada.id).toBe("orig");
    expect(editada.uasgUndCompradora).toBe("986531");
    expect(editada.quantidade).toBe(50);
    expect(editada.unidadeMedida).toBe("Caixa");
    expect(editada.valorEstimadoItem).toBe(1000);
    expect(editada.nossoValorAlvo).toBe(900);
    expect(editada.valorMinimoPiso).toBe(800);
  });

  it("mantém o status quando o formulário não traz um", () => {
    expect(aplicarEdicaoManual(original, { orgao: "X", data: "2026-12-01" }).status).toBe("Agendada");
  });
});

describe("dadosDeDisputa", () => {
  it("preenche o formulário a partir da linha existente", () => {
    const dados = dadosDeDisputa({
      id: "1",
      orgao: "Órgão",
      uasgUndCompradora: "",
      numeroLicitacao: "PE 2/2026",
      portal: "PNCP",
      produtoItem: "Objeto",
      quantidade: 1,
      unidadeMedida: "Unidade",
      valorEstimadoItem: 0,
      nossoValorAlvo: 0,
      valorMinimoPiso: 0,
      dataHoraDisputa: "2026-05-07 08:15",
      status: "Agendada",
      observacoes: "obs",
      linkPNCP: "https://pncp.gov.br/x",
    });

    expect(dados).toEqual({
      orgao: "Órgão",
      data: "2026-05-07",
      hora: "08:15",
      numeroLicitacao: "PE 2/2026",
      portal: "PNCP",
      produtoItem: "Objeto",
      observacoes: "obs",
      linkPNCP: "https://pncp.gov.br/x",
      status: "Agendada",
    });
  });
});
