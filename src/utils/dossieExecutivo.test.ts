import { describe, it, expect, vi } from "vitest";
import {
  construirDossieExecutivo,
  parseValorMonetario,
  formatarMoedaBR,
  gerarPdfDossieExecutivo,
} from "./dossieExecutivo";
import { EditalAnalysis } from "../types";

describe("dossieExecutivo", () => {
  const mockEdital: EditalAnalysis = {
    pontosPositivos: ["Exclusivo para ME/EPP", "Pagamento em 30 dias"],
    pontosAlerta: [
      "PONTO DE ATENÇÃO 1 — Indicação de C.A. Específico (Itens 01 a 09): O Termo de Referência cita diretamente o número do Certificado de Aprovação C.A. 44694.",
      "Proibição de Copiar o Texto do Edital na Proposta (Itens 10.5 e 10.7): O Item 10.5 determina que a proposta deve detalhar marca e modelo.",
    ],
    prazoEntrega: "Até 10 (dez) dias úteis",
    prazoPagamento: "Em até 30 dias corridos após recebimento definitivo",
    descricaoProduto:
      "Calçado ocupacional de uso profissional (EPI — NR-06), tipo tênis esportivo, fechamento em atacador.",
    documentosExigidos: [
      "Proposta Comercial em R$ com marca e modelo",
      "Contrato Social consolidado e Cartão CNPJ",
      "CND Federal, Estadual, Municipal, FGTS e CNDT",
      "Certidão Negativa de Falência e CEIS/CNEP",
      "Atestado de Capacidade Técnica de fornecimento de EPIs",
    ],
    identificacaoCertame: {
      orgaoComprador: "Prefeitura Municipal de São Leopoldo/RS",
      modalidade: "Dispensa de Licitação",
      identificacaoNumerica: "TR nº 07/2026",
      dataHoraSessao: "27/11/2026 às 08h30min",
    },
    viabilidadeFinanceira: {
      valorEstimado: "R$ 15.920,08",
      distorcoesPreco: "Média de cotações dentro do mercado",
      prazoPagamento: "Até 30 dias corridos após o recebimento definitivo",
    },
    logisticaCronograma: {
      prazoEntregaReal: "Até 10 (dez) dias úteis contados da Ordem de Compra",
      classificacaoPrazo: "Aceitável",
      enderecoEntrega: "Rua Flores da Cunha, nº 274, Bairro Centro, São Leopoldo/RS",
      prazoGarantia: "Garantia do fabricante + CDC",
    },
    burocraciaBarreiras: {
      exigeAmostra: "Exige folheto técnico ou link oficial do fabricante",
      exigeCartaSolidariedade: "Não exigida",
      exigenciaGarantia: "Não exigida",
      consorcioSubcontratacao: "Vedada subcontratação sem prévia anuência",
    },
    parecerFinal: {
      veredito: "Vale a Pena Participar",
      grauRisco: "Baixo",
      estrategiaLances: "Menor Preço por Lote Único",
    },
    itensEdital: [
      {
        numero: 1,
        descricao: "Tênis Ocupacional Hidrofugado (C.A. 44694) — Tam. 34",
        quantidade: 3,
        unidade: "Par",
        valorEstimado: "R$ 180,91",
      },
      {
        numero: 2,
        descricao: "Tênis Ocupacional Hidrofugado (C.A. 44694) — Tam. 35",
        quantidade: 8,
        unidade: "Par",
        valorEstimado: "R$ 180,91",
      },
    ],
  };

  it("converte valores monetários em formato brasileiro corretamente", () => {
    expect(parseValorMonetario("R$ 1.334.139,00")).toBe(1334139);
    expect(parseValorMonetario("R$ 180,91")).toBe(180.91);
    expect(formatarMoedaBR(15920.08)).toContain("15.920,08");
  });

  it("constrói a estrutura completa do Dossiê Executivo a partir de qualquer EditalAnalysis", () => {
    const dossie = construirDossieExecutivo(mockEdital);
    expect(dossie.kicker).toContain("INTELIGÊNCIA LICITATÓRIA");
    expect(dossie.kicker).toContain("EPI");
    expect(dossie.titulo).toContain("Dossiê Executivo: Dispensa de Licitação");
    expect(dossie.subtituloOrgao).toContain("São Leopoldo/RS");
    expect(dossie.sinteseTexto).toContain("São Leopoldo/RS");
    expect(dossie.dadosOficiais.length).toBeGreaterThanOrEqual(6);
    expect(dossie.pontosAtencao.length).toBe(2);
    expect(dossie.pontosAtencao[0].titulo).toContain("Indicação de C.A. Específico");
    expect(dossie.checklistCategorizado.length).toBe(4);
  });

  it("preserva edições customizadas do usuário no dossieExecutivo", () => {
    const customEdital: EditalAnalysis = {
      ...mockEdital,
      dossieExecutivo: {
        ...construirDossieExecutivo(mockEdital),
        titulo: "Dossiê Executivo Customizado pelo Usuário",
        temaCor: "terracotta",
      },
    };
    const dossie = construirDossieExecutivo(customEdital);
    expect(dossie.titulo).toBe("Dossiê Executivo Customizado pelo Usuário");
    expect(dossie.temaCor).toBe("terracotta");
  });

  it("gera o arquivo PDF A4 paginado sem erros", () => {
    const dossie = construirDossieExecutivo(mockEdital);
    const pdfDoc = gerarPdfDossieExecutivo(dossie, mockEdital.itensEdital || [], {
      veredito: "Vale a Pena Participar",
      grauRisco: "Baixo",
      capagLabel: "Nota B (Bom Pagador)",
      valorGlobalFormatado: "R$ 1.990,01",
      salvarArquivo: false,
    });

    expect(pdfDoc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});
