// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { EditalAnalysis } from "../types";

// A aba conversa com o Supabase e com o histórico compartilhado de editais.
// Nenhum dos dois existe em teste, então ficam dublados: o que está sob
// verificação aqui é que o componente monta, cruza os dados e mostra o
// veredito certo — não a camada de rede.
vi.mock("../utils/supabaseClient", () => ({
  fetchCertificatesFromSupabase: vi.fn(async () => []),
  subscribeToSupabaseTable: vi.fn(() => () => {}),
}));

vi.mock("../utils/editalHistory", () => ({
  useEditalHistory: () => [],
}));

import HabilitacaoChecklistTab from "./HabilitacaoChecklistTab";

const EDITAL: EditalAnalysis = {
  pontosPositivos: [],
  pontosAlerta: [],
  prazoEntrega: "",
  prazoPagamento: "",
  descricaoProduto: "Notebooks",
  documentosExigidos: [
    "Prova de regularidade para com a Fazenda Nacional",
    "Certificado de Regularidade do FGTS",
    "Declaração de que não emprega menor de 18 anos",
  ],
  identificacaoCertame: {
    orgaoComprador: "Prefeitura de Exemplo",
    modalidade: "Pregão Eletrônico",
    identificacaoNumerica: "PE 45/2026",
    // Data distante para o teste não depender do relógio de quem roda a suíte.
    dataHoraSessao: "15/03/2099 09:00",
  },
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("HabilitacaoChecklistTab", () => {
  it("orienta a analisar um edital quando não há nenhum", async () => {
    render(<HabilitacaoChecklistTab activeEdital={null} />);
    expect(await screen.findByText(/Nenhum edital analisado ainda/i)).toBeDefined();
  });

  it("monta o checklist e separa bloqueios de itens cobertos", async () => {
    localStorage.setItem(
      "aip_certificates",
      JSON.stringify([
        {
          id: "c1",
          name: "CND Receita Federal e INSS",
          emissionDate: "",
          expirationDate: "2099-12-31",
          status: "valid",
          fileUploaded: true,
        },
      ]),
    );

    render(<HabilitacaoChecklistTab activeEdital={EDITAL} />);

    // Federal está coberta; FGTS não foi cadastrada; a declaração é gerada por
    // disputa e não deve ser contada como bloqueio.
    expect(await screen.findByText(/Bloqueiam a habilitação/i)).toBeDefined();
    expect(screen.getByText(/1 bloqueio\(s\)/i)).toBeDefined();
    expect(screen.getByText(/1 de 3 exigências cobertas/i)).toBeDefined();
    expect(screen.getByText(/Certificado de Regularidade do FGTS/i)).toBeDefined();
  });

  it("acusa a certidão que vence entre hoje e a sessão", async () => {
    localStorage.setItem(
      "aip_certificates",
      JSON.stringify([
        {
          id: "c1",
          name: "CND Receita Federal e INSS",
          emissionDate: "",
          // Válida hoje, mas muito antes da sessão de 2099.
          expirationDate: "2099-01-01",
          status: "valid",
          fileUploaded: true,
        },
      ]),
    );

    render(<HabilitacaoChecklistTab activeEdital={EDITAL} />);

    expect(await screen.findByText(/VENCE ANTES DA SESSÃO/i)).toBeDefined();
  });

  it("avisa quando a análise não trouxe exigências", async () => {
    render(
      <HabilitacaoChecklistTab
        activeEdital={{ ...EDITAL, documentosExigidos: [] }}
      />,
    );

    expect(
      await screen.findByText(/não listou documentos de habilitação/i),
    ).toBeDefined();
  });
});
