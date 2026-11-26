import { describe, expect, it } from "vitest";
import { DisputaRow, EditalAnalysis } from "../types";
import { EditalHistoryItem } from "./editalHistory";
import {
  encontrarEditalDaDisputa,
  extrairChavePncpNormalizada,
  extrairNucleoNumeroLicitacao,
  rotuloDisputaResumido,
} from "./disputaDossie";

function criarDisputa(partial: Partial<DisputaRow> = {}): DisputaRow {
  return {
    id: "disp-1",
    orgao: "Prefeitura Municipal de São Leopoldo",
    uasgUndCompradora: "988877",
    numeroLicitacao: "PE 45/2026",
    portal: "Compras.gov.br",
    produtoItem: "Aquisição de luvas nitrílicas descartáveis e botas de segurança",
    quantidade: 100,
    unidadeMedida: "Unidade",
    valorEstimadoItem: 15000,
    nossoValorAlvo: 12000,
    valorMinimoPiso: 10000,
    dataHoraDisputa: "2026-12-10 09:00",
    status: "Agendada",
    ...partial,
  };
}

function criarEdital(partial: Partial<EditalAnalysis> = {}): EditalAnalysis {
  return {
    descricaoProduto: "Aquisição de luvas nitrílicas descartáveis e botas de segurança",
    pontosPositivos: [],
    pontosAlerta: [],
    documentosExigidos: [],
    prazoEntrega: "15 dias",
    prazoPagamento: "30 dias",
    identificacaoCertame: {
      orgaoComprador: "Prefeitura Municipal de São Leopoldo",
      uasg: "988877",
      modalidade: "Pregão Eletrônico",
      identificacaoNumerica: "Pregão Eletrônico nº 045/2026",
      dataHoraSessao: "10/12/2026 09:00",
      linkPNCP: "https://pncp.gov.br/app/editais/88123456000199/2026/000045",
      idContratacaoPNCP: "88123456000199-1-000045/2026",
    },
    ...partial,
  };
}

describe("disputaDossie", () => {
  it("normaliza URL oficial do PNCP e código de controle para a mesma chave", () => {
    expect(
      extrairChavePncpNormalizada("https://pncp.gov.br/app/editais/88123456000199/2026/000045")
    ).toBe("88123456000199/2026/45");

    expect(extrairChavePncpNormalizada("88123456000199-1-000045/2026")).toBe(
      "88123456000199/2026/45"
    );
  });

  it("extrai o núcleo numérico sem zeros à esquerda", () => {
    expect(extrairNucleoNumeroLicitacao("Pregão Eletrônico nº 00045/2026")).toBe("45/2026");
    expect(extrairNucleoNumeroLicitacao("PE 45/2026")).toBe("45/2026");
  });

  it("encontra o edital pelo link PNCP mesmo quando órgão ou número diferem", () => {
    const edital = criarEdital();
    const historico: EditalHistoryItem[] = [
      { id: "hist-1", title: "Análise São Leopoldo", date: "01/11/2026", analysis: edital },
    ];
    const disputa = criarDisputa({
      orgao: "PM SL",
      numeroLicitacao: "S/N",
      uasgUndCompradora: "",
      linkPNCP: "https://pncp.gov.br/app/editais/88123456000199/2026/45",
    });

    const match = encontrarEditalDaDisputa(disputa, historico);
    expect(match).not.toBeNull();
    expect(match?.historyId).toBe("hist-1");
    expect(match?.edital).toBe(edital);
  });

  it("encontra o edital por número da licitação + órgão ignorando acentos e zeros à esquerda", () => {
    const edital = criarEdital({
      identificacaoCertame: {
        orgaoComprador: "Prefeitura de Sao Leopoldo",
        modalidade: "Pregão Eletrônico",
        identificacaoNumerica: "Pregao 045/2026",
        dataHoraSessao: "10/12/2026 09:00",
      },
    });
    const historico: EditalHistoryItem[] = [
      { id: "hist-2", title: "Análise", date: "01/11/2026", analysis: edital },
    ];
    const disputa = criarDisputa({
      linkPNCP: "",
      uasgUndCompradora: "",
      orgao: "Prefeitura Municipal de São Leopoldo",
      numeroLicitacao: "PE 45/2026",
    });

    const match = encontrarEditalDaDisputa(disputa, historico);
    expect(match?.historyId).toBe("hist-2");
  });

  it("não confunde duas disputas diferentes do mesmo órgão com números de certame distintos", () => {
    const editalOutro = criarEdital({
      identificacaoCertame: {
        orgaoComprador: "Prefeitura Municipal de São Leopoldo",
        modalidade: "Pregão Eletrônico",
        identificacaoNumerica: "Pregão Eletrônico nº 099/2026",
        dataHoraSessao: "12/12/2026 09:00",
      },
    });
    const historico: EditalHistoryItem[] = [
      { id: "hist-99", title: "PE 99/2026", date: "01/11/2026", analysis: editalOutro },
    ];
    const disputa = criarDisputa({
      linkPNCP: "",
      numeroLicitacao: "PE 45/2026",
    });

    const match = encontrarEditalDaDisputa(disputa, historico);
    expect(match).toBeNull();
  });

  it("encontra por órgão + objeto quando o número da licitação não foi preenchido", () => {
    const edital = criarEdital({
      identificacaoCertame: {
        orgaoComprador: "Prefeitura Municipal de Campinas",
        modalidade: "Pregão Eletrônico",
        identificacaoNumerica: "",
        dataHoraSessao: "",
      },
      descricaoProduto: "Fornecimento de computadores desktop i7 e monitores ultrawide",
    });
    const historico: EditalHistoryItem[] = [
      { id: "hist-camp", title: "Campinas", date: "01/11/2026", analysis: edital },
    ];
    const disputa = criarDisputa({
      orgao: "Prefeitura Municipal de Campinas",
      numeroLicitacao: "",
      uasgUndCompradora: "",
      linkPNCP: "",
      produtoItem: "Computadores desktop i7 e monitores ultrawide para laboratório",
    });

    const match = encontrarEditalDaDisputa(disputa, historico);
    expect(match?.historyId).toBe("hist-camp");
  });

  it("retorna null para disputa manual sem nenhum Dossiê correspondente", () => {
    const edital = criarEdital();
    const historico: EditalHistoryItem[] = [
      { id: "hist-1", title: "São Leopoldo", date: "01/11/2026", analysis: edital },
    ];
    const disputaManual = criarDisputa({
      id: "disp-manual",
      orgao: "Hospital Estadual do Paraná",
      numeroLicitacao: "DL 12/2026",
      uasgUndCompradora: "123456",
      produtoItem: "Serviço de manutenção predial elétrica",
      linkPNCP: "",
    });

    expect(encontrarEditalDaDisputa(disputaManual, historico)).toBeNull();
  });

  it("formata o rótulo resumido da disputa corretamente", () => {
    expect(
      rotuloDisputaResumido({ orgao: "Prefeitura X", numeroLicitacao: "PE 10/2026" })
    ).toBe("Prefeitura X (PE 10/2026)");
    expect(rotuloDisputaResumido({ orgao: "Prefeitura X" })).toBe("Prefeitura X");
    expect(rotuloDisputaResumido({})).toBe("esta disputa");
  });
});
