// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DisputasSheetTab from "./DisputasSheetTab";
import { DisputaRow, EditalAnalysis } from "../types";

vi.mock("../utils/supabaseClient", () => ({
  fetchDisputasFromSupabase: vi.fn().mockResolvedValue(null),
  fetchDisputasComStatus: vi.fn().mockResolvedValue({ ok: false, rows: [] }),
  saveDisputaToSupabase: vi.fn().mockResolvedValue({ success: true }),
  deleteDisputaFromSupabase: vi.fn().mockResolvedValue({ success: true }),
  subscribeToSupabaseTable: vi.fn().mockReturnValue(() => {}),
  mapDisputaFromDb: vi.fn((r: any) => r),
  generateUUID: vi.fn(() => "uuid-mock-1"),
  getSupabaseFullSchemaSQL: vi.fn(() => ""),
  fetchStatusDisputasFromSupabase: vi.fn().mockResolvedValue([]),
  saveStatusDisputaToSupabase: vi.fn().mockResolvedValue({ success: true }),
  deleteStatusDisputaToSupabase: vi.fn().mockResolvedValue({ success: true }),
  deleteStatusDisputaFromSupabase: vi.fn().mockResolvedValue({ success: true }),
  definirDisputaNoCalendarioLocal: vi.fn(),
  lerDisputasForaDoCalendario: vi.fn(() => new Set<string>()),
}));

const MOCK_EDITAL: EditalAnalysis = {
  descricaoProduto: "Fornecimento de equipamentos médicos hospitalares",
  pontosPositivos: [],
  pontosAlerta: [],
  documentosExigidos: [],
  prazoEntrega: "20 dias",
  prazoPagamento: "30 dias",
  identificacaoCertame: {
    orgaoComprador: "Prefeitura Municipal de Curitiba",
    uasg: "987535",
    modalidade: "Pregão Eletrônico",
    identificacaoNumerica: "PE 77/2026",
    dataHoraSessao: "15/12/2026 09:00",
    linkPNCP: "https://pncp.gov.br/app/editais/76417005000186/2026/000077",
  },
};

vi.mock("../utils/editalHistory", () => ({
  useEditalHistory: () => [
    {
      id: "hist-curitiba",
      title: "Análise Curitiba",
      date: "10/11/2026",
      analysis: MOCK_EDITAL,
    },
  ],
}));

const DISPUTA_COM_DOSSIE: DisputaRow = {
  id: "disp-com-dossie",
  orgao: "Prefeitura Municipal de Curitiba",
  uasgUndCompradora: "987535",
  numeroLicitacao: "PE 77/2026",
  portal: "Compras.gov.br",
  produtoItem: "Fornecimento de equipamentos médicos hospitalares",
  quantidade: 10,
  unidadeMedida: "Unidade",
  valorEstimadoItem: 50000,
  nossoValorAlvo: 45000,
  valorMinimoPiso: 40000,
  dataHoraDisputa: "",
  status: "Agendada",
  linkPNCP: "https://pncp.gov.br/app/editais/76417005000186/2026/000077",
  noCalendario: true,
};

const DISPUTA_SEM_DOSSIE: DisputaRow = {
  id: "disp-sem-dossie",
  orgao: "Câmara Municipal de Londrina",
  uasgUndCompradora: "111222",
  numeroLicitacao: "DL 09/2026",
  portal: "PNCP",
  produtoItem: "Serviços de limpeza predial",
  quantidade: 1,
  unidadeMedida: "Serviço",
  valorEstimadoItem: 12000,
  nossoValorAlvo: 11000,
  valorMinimoPiso: 9500,
  dataHoraDisputa: "",
  status: "Agendada",
  linkPNCP: "",
  noCalendario: true,
};

describe("DisputasSheetTab — botão Ver Dossiê", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      "aip_disputas_sheet",
      JSON.stringify([DISPUTA_COM_DOSSIE, DISPUTA_SEM_DOSSIE])
    );
    localStorage.setItem("aip_disputas_view_mode", "spreadsheet");
  });

  it("exibe o botão Ver Dossiê nos cards do Painel e envia o edital correspondente ou null", () => {
    const onOpenDisputaDossie = vi.fn();

    render(<DisputasSheetTab onOpenDisputaDossie={onOpenDisputaDossie} />);

    const botoes = screen.getAllByRole("button", { name: /Ver Dossiê/i });
    expect(botoes.length).toBe(2);

    // 1º card: disputa com Dossiê encontrado
    fireEvent.click(botoes[0]);
    expect(onOpenDisputaDossie).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "disp-com-dossie" }),
      MOCK_EDITAL
    );

    // 2º card: disputa manual sem Dossiê
    fireEvent.click(botoes[1]);
    expect(onOpenDisputaDossie).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "disp-sem-dossie" }),
      null
    );
  });

  it("exibe o botão Ver Dossiê também nos cards do Kanban", () => {
    localStorage.setItem("aip_disputas_view_mode", "kanban");
    const onOpenDisputaDossie = vi.fn();

    render(<DisputasSheetTab onOpenDisputaDossie={onOpenDisputaDossie} />);

    const botoes = screen.getAllByRole("button", { name: /Ver Dossiê/i });
    expect(botoes.length).toBe(2);

    fireEvent.click(botoes[0]);
    expect(onOpenDisputaDossie).toHaveBeenCalledWith(
      expect.objectContaining({ id: "disp-com-dossie" }),
      MOCK_EDITAL
    );
  });

  it("exibe o botão Ver Dossiê também no modo Calendário (disputas sem data)", () => {
    localStorage.setItem("aip_disputas_view_mode", "calendar");
    const onOpenDisputaDossie = vi.fn();

    render(<DisputasSheetTab onOpenDisputaDossie={onOpenDisputaDossie} />);

    const botoes = screen.getAllByRole("button", { name: /Ver Dossiê/i });
    expect(botoes.length).toBe(2);

    fireEvent.click(botoes[0]);
    expect(onOpenDisputaDossie).toHaveBeenCalledWith(
      expect.objectContaining({ id: "disp-com-dossie" }),
      MOCK_EDITAL
    );
  });
});
