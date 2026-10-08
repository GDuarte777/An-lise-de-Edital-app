// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { CompanyData, DisputaRow } from "../types";
import { EVENTO_CHAT_DISPUTA, idSessaoDaDisputa } from "../utils/chatDisputa";

// O chat conversa com Supabase, IA, confetti e Google Drive. Nada disso é o
// alvo aqui: o que se verifica é que o pedido vindo do calendário ou da
// Planilha abre um canal daquela disputa, e que pedir de novo reaproveita o
// mesmo canal em vez de criar outro.
const salvas = vi.hoisted(() => ({ sessoes: [] as any[] }));

vi.mock("../utils/supabaseClient", () => ({
  callSupabaseGeminiEdgeFunction: vi.fn(async () => ({})),
  fetchChatSessionsFromSupabase: vi.fn(async () => null),
  saveChatSessionToSupabase: vi.fn(async (s: any) => {
    salvas.sessoes.push(s);
    return { success: true, message: "ok" };
  }),
  deleteChatSessionFromSupabase: vi.fn(async () => true),
  clearAllChatSessionsInSupabase: vi.fn(async () => true),
  subscribeToSupabaseTable: vi.fn(() => () => {}),
}));

vi.mock("../utils/aiClientHelper", () => ({
  getActiveAiConfig: vi.fn(() => ({})),
  apiFetch: vi.fn(async () => ({ ok: false, json: async () => ({}) })),
  formatAiError: vi.fn((e: any) => String(e)),
  readJsonResponse: vi.fn(async () => ({})),
}));

vi.mock("../utils/editalHistory", () => ({
  useEditalHistory: () => [],
  refreshEditalHistory: vi.fn(),
}));

vi.mock("../utils/googleSync", () => ({ addSyncedItem: vi.fn() }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

import FloatingAiChat from "./FloatingAiChat";

const EMPRESA: CompanyData = {
  razonSocial: "Empresa Teste",
  cnpj: "",
  address: "",
  phone: "",
  email: "",
  representativeName: "",
  representativeCpf: "",
  bankDetails: "",
};

const DISPUTA: DisputaRow = {
  id: "d-42",
  orgao: "Prefeitura de Exemplo",
  uasgUndCompradora: "986531",
  numeroLicitacao: "PE 45/2026",
  portal: "Compras.gov.br",
  produtoItem: "Notebooks 16GB",
  quantidade: 10,
  unidadeMedida: "Unidade",
  valorEstimadoItem: 50000,
  nossoValorAlvo: 45000,
  valorMinimoPiso: 40000,
  dataHoraDisputa: "2026-11-20 09:30",
  status: "Agendada",
  observacoes: "Cliente avisou por telefone",
  linkPNCP: "https://pncp.gov.br/app/editais/1/2026/1",
};

function pedirChatDaDisputa(row: DisputaRow = DISPUTA) {
  act(() => {
    window.dispatchEvent(new CustomEvent(EVENTO_CHAT_DISPUTA, { detail: { disputa: row } }));
  });
}

beforeEach(() => {
  localStorage.clear();
  salvas.sessoes = [];
  (window as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as any).scrollIntoView = () => {};
});

afterEach(() => cleanup());

describe("FloatingAiChat — abrir chat de uma disputa", () => {
  it("abre o painel e cria o canal daquela disputa", async () => {
    render(<FloatingAiChat companyData={EMPRESA} activeEdital={null} />);

    // Fechado: só o botão flutuante está na tela.
    expect(screen.queryByText(/Disputa: PE 45\/2026/)).toBeNull();

    pedirChatDaDisputa();

    // O canal aparece com o título derivado da disputa (na lista de canais e no
    // cabeçalho do canal ativo, daí o findAll)...
    expect((await screen.findAllByText(/Disputa: PE 45\/2026 — Prefeitura de Exemplo/)).length).toBeGreaterThan(0);
    // ...e a conversa já nasce com os dados reais da linha.
    expect(await screen.findByText(/Notebooks 16GB/)).toBeDefined();
    expect(screen.getByText(/Cliente avisou por telefone/)).toBeDefined();
  });

  it("avisa que não leu o edital, em vez de deixar a IA supor exigências", async () => {
    render(<FloatingAiChat companyData={EMPRESA} activeEdital={null} />);
    pedirChatDaDisputa();

    expect(await screen.findByText(/não li o edital desta disputa/i)).toBeDefined();
  });

  it("pedir duas vezes reaproveita o mesmo canal", async () => {
    render(<FloatingAiChat companyData={EMPRESA} activeEdital={null} />);

    pedirChatDaDisputa();
    await screen.findAllByText(/Disputa: PE 45\/2026 — Prefeitura de Exemplo/);
    pedirChatDaDisputa();
    pedirChatDaDisputa();

    expect(idSessaoDaDisputa(DISPUTA.id)).toBe("chat-disputa-d-42");
    // O contador de canais é a fonte autoritativa: o título se repete na tela
    // (lista + cabeçalho), mas o número de canais é o que prova a dedupe.
    // 2 = o "Chat Principal" padrão + o canal desta disputa.
    expect(await screen.findByText(/Canais \(2\/20\)/)).toBeDefined();
  });

  it("disputas diferentes abrem canais diferentes", async () => {
    render(<FloatingAiChat companyData={EMPRESA} activeEdital={null} />);

    pedirChatDaDisputa();
    await screen.findAllByText(/Disputa: PE 45\/2026/);
    pedirChatDaDisputa({ ...DISPUTA, id: "d-99", numeroLicitacao: "PE 99/2026" });

    expect((await screen.findAllByText(/Disputa: PE 99\/2026/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Canais \(3\/20\)/)).toBeDefined();
  });

  it("ignora pedido sem disputa", async () => {
    render(<FloatingAiChat companyData={EMPRESA} activeEdital={null} />);

    act(() => {
      window.dispatchEvent(new CustomEvent(EVENTO_CHAT_DISPUTA, { detail: {} }));
    });

    // Nenhum canal de disputa criado, e o painel não abriu.
    expect(screen.queryByText(/^Disputa:/)).toBeNull();
  });
});
