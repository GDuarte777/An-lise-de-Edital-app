// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";

// O calendário conversa com o Supabase. O que está sob verificação aqui é a
// tela: marcar uma disputa à mão, sem passar pela análise de edital, com link
// e descrição — e que o que foi marcado chegue ao banco.
const banco = vi.hoisted(() => ({
  linhas: [] as any[],
  tipos: [] as any[],
  ok: true,
  salvas: [] as any[],
  excluidas: [] as string[],
  falhaAoSalvar: null as string | null,
}));

vi.mock("../utils/supabaseClient", () => ({
  fetchDisputasComStatus: vi.fn(async () => ({ ok: banco.ok, rows: banco.linhas })),
  fetchStatusDisputasFromSupabase: vi.fn(async () => banco.tipos),
  subscribeToSupabaseTable: vi.fn(() => () => {}),
  saveDisputaToSupabase: vi.fn(async (row: any) => {
    banco.salvas.push(row);
    if (banco.falhaAoSalvar) return { success: false, message: banco.falhaAoSalvar };
    banco.linhas = [row, ...banco.linhas.filter((r) => r.id !== row.id)];
    return { success: true, message: "ok" };
  }),
  deleteDisputaFromSupabase: vi.fn(async (id: string) => {
    banco.excluidas.push(id);
    return true;
  }),
  generateUUID: vi.fn(() => "11111111-2222-3333-4444-555555555555"),
}));

import CalendarTab from "./CalendarTab";

// O calendário abre no mês corrente, então a disputa de teste precisa cair
// nele — uma data fixa sairia da grade conforme o tempo passa.
const HOJE = new Date();
const DIA_NO_MES = new Date(HOJE.getFullYear(), HOJE.getMonth(), 15);
const DATA_NO_MES = `${DIA_NO_MES.getFullYear()}-${String(DIA_NO_MES.getMonth() + 1).padStart(2, "0")}-15`;

beforeEach(() => {
  localStorage.clear();
  banco.linhas = [];
  banco.tipos = [{ id: "s1", label: "Agendada", color: "#3b82f6", position: 0 }];
  banco.ok = true;
  banco.salvas = [];
  banco.excluidas = [];
  banco.falhaAoSalvar = null;

  (window as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as any).scrollIntoView = () => {};
  (window as any).HTMLElement.prototype.hasPointerCapture = () => false;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function abrirFormulario() {
  render(<CalendarTab />);
  fireEvent.click(await screen.findByRole("button", { name: /Marcar disputa/i }));
  return screen.findByRole("dialog");
}

/** Preenche os campos obrigatórios e os que o usuário pediu: link e descrição. */
function preencher(dialogo: HTMLElement, dados: { orgao: string; data: string; hora?: string; link?: string; descricao?: string }) {
  fireEvent.change(within(dialogo).getByPlaceholderText(/Prefeitura de Camaçari/i), { target: { value: dados.orgao } });

  const campos = within(dialogo).getAllByDisplayValue("");
  const data = campos.find((el) => el.getAttribute("type") === "date")!;
  fireEvent.change(data, { target: { value: dados.data } });

  if (dados.hora) {
    const hora = within(dialogo).getAllByDisplayValue("").find((el) => el.getAttribute("type") === "time")!;
    fireEvent.change(hora, { target: { value: dados.hora } });
  }
  if (dados.link !== undefined) {
    fireEvent.change(within(dialogo).getByPlaceholderText(/pncp\.gov\.br\/app\/editais/i), { target: { value: dados.link } });
  }
  if (dados.descricao !== undefined) {
    fireEvent.change(within(dialogo).getByPlaceholderText(/Estratégia, piso de margem/i), { target: { value: dados.descricao } });
  }
}

describe("CalendarTab — marcar disputa à mão", () => {
  it("salva a disputa com link do PNCP e descrição, sem passar pela análise", async () => {
    const dialogo = await abrirFormulario();

    preencher(dialogo, {
      orgao: "Prefeitura de Exemplo",
      data: "2026-11-20",
      hora: "09:30",
      link: "pncp.gov.br/app/editais/123/2026/1",
      descricao: "Cliente avisou por telefone",
    });

    fireEvent.click(within(dialogo).getByRole("button", { name: /Marcar no calendário/i }));

    await waitFor(() => expect(banco.salvas.length).toBe(1));
    const salva = banco.salvas[0];
    expect(salva.orgao).toBe("Prefeitura de Exemplo");
    expect(salva.dataHoraDisputa).toBe("2026-11-20 09:30");
    // O esquema é completado: sem ele o href viraria caminho relativo.
    expect(salva.linkPNCP).toBe("https://pncp.gov.br/app/editais/123/2026/1");
    expect(salva.observacoes).toBe("Cliente avisou por telefone");
    expect(salva.status).toBe("Agendada");
  });

  it("exige rótulo e data antes de salvar", async () => {
    const dialogo = await abrirFormulario();
    fireEvent.click(within(dialogo).getByRole("button", { name: /Marcar no calendário/i }));

    expect(await within(dialogo).findByText(/Informe o órgão ou um título/i)).toBeDefined();
    expect(within(dialogo).getByText(/Informe a data da disputa/i)).toBeDefined();
    expect(banco.salvas.length).toBe(0);
  });

  it("recusa texto que não é link", async () => {
    const dialogo = await abrirFormulario();
    preencher(dialogo, { orgao: "X", data: "2026-11-20", link: "não tenho o link" });
    fireEvent.click(within(dialogo).getByRole("button", { name: /Marcar no calendário/i }));

    expect(await within(dialogo).findByText(/Link inválido/i)).toBeDefined();
    expect(banco.salvas.length).toBe(0);
  });

  it("avisa quando a gravação no banco falha, em vez de dar como salva", async () => {
    banco.falhaAoSalvar = "Tabela planilhas_disputas não existe no Supabase";
    const dialogo = await abrirFormulario();
    preencher(dialogo, { orgao: "X", data: "2026-11-20" });
    fireEvent.click(within(dialogo).getByRole("button", { name: /Marcar no calendário/i }));

    expect(await within(dialogo).findByText(/salva neste navegador, mas não no banco/i)).toBeDefined();
  });

  it("clicar num dia vazio já abre o formulário com aquela data", async () => {
    render(<CalendarTab />);

    // Sem disputas, TODO dia do mês é clicável para marcar — o que importa é
    // que o clique abre o formulário com a data daquele dia já preenchida.
    const celulas = await screen.findAllByTitle(/Marcar uma disputa neste dia/i);
    expect(celulas.length).toBeGreaterThan(20);

    fireEvent.click(celulas[14]); // 15º dia do mês na grade do mês corrente
    const dialogo = await screen.findByRole("dialog");

    const campoData = dialogo.querySelector('input[type="date"]') as HTMLInputElement;
    expect(campoData.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(campoData.value.slice(0, 7)).toBe(DATA_NO_MES.slice(0, 7));
  });
});

describe("CalendarTab — falar com a IA", () => {
  const comData = {
    id: "chat-1",
    orgao: "Prefeitura do Chat",
    uasgUndCompradora: "",
    numeroLicitacao: "PE 7/2026",
    portal: "",
    produtoItem: "Objeto",
    quantidade: 1,
    unidadeMedida: "Unidade",
    valorEstimadoItem: 0,
    nossoValorAlvo: 0,
    valorMinimoPiso: 0,
    dataHoraDisputa: `${DATA_NO_MES} 11:00`,
    status: "Agendada",
    observacoes: "",
    linkPNCP: "",
  };

  it("dispara o evento que abre o chat com a disputa clicada", async () => {
    banco.linhas = [comData];
    const recebidos: any[] = [];
    const ouvinte = (e: any) => recebidos.push(e.detail);
    window.addEventListener("aip_abrir_chat_disputa", ouvinte);

    try {
      render(<CalendarTab />);
      fireEvent.click(await screen.findByTitle(/Ver disputas deste dia/i));
      const dialogo = await screen.findByRole("dialog");
      fireEvent.click(within(dialogo).getByRole("button", { name: /Falar com a IA/i }));

      expect(recebidos).toHaveLength(1);
      expect(recebidos[0].disputa.id).toBe("chat-1");
      expect(recebidos[0].disputa.orgao).toBe("Prefeitura do Chat");
    } finally {
      window.removeEventListener("aip_abrir_chat_disputa", ouvinte);
    }
  });
});

describe("CalendarTab — disputa existente", () => {
  const existente = {
    id: "abc",
    orgao: "Órgão Existente",
    uasgUndCompradora: "1",
    numeroLicitacao: "PE 1/2026",
    portal: "BLL",
    produtoItem: "Objeto",
    quantidade: 10,
    unidadeMedida: "Unidade",
    valorEstimadoItem: 1000,
    nossoValorAlvo: 900,
    valorMinimoPiso: 800,
    dataHoraDisputa: `${DATA_NO_MES} 10:00`,
    status: "Agendada",
    observacoes: "nota",
    linkPNCP: "https://pncp.gov.br/x",
  };

  it("permite editar sem perder os valores definidos na Planilha", async () => {
    banco.linhas = [existente];
    render(<CalendarTab />);

    fireEvent.click(await screen.findByTitle(/Ver disputas deste dia/i));
    const diaDialogo = await screen.findByRole("dialog");
    fireEvent.click(within(diaDialogo).getByRole("button", { name: /Editar/i }));

    const form = await screen.findByRole("dialog");
    expect(within(form).getByDisplayValue("Órgão Existente")).toBeDefined();

    fireEvent.change(within(form).getByDisplayValue("Órgão Existente"), { target: { value: "Órgão Corrigido" } });
    fireEvent.click(within(form).getByRole("button", { name: /Salvar alterações/i }));

    await waitFor(() => expect(banco.salvas.length).toBe(1));
    const salva = banco.salvas[0];
    expect(salva.orgao).toBe("Órgão Corrigido");
    // A estratégia de lance não é do formulário do calendário e tem de sobreviver.
    expect(salva.valorMinimoPiso).toBe(800);
    expect(salva.nossoValorAlvo).toBe(900);
    expect(salva.quantidade).toBe(10);
  });

  it("não apaga o cache local quando o banco não responde", async () => {
    // Antes, qualquer falha voltava como lista vazia e o refresh zerava o
    // calendário — a disputa marcada à mão desaparecia sozinha.
    localStorage.setItem("aip_disputas_sheet", JSON.stringify([existente]));
    banco.ok = false;
    banco.linhas = [];

    render(<CalendarTab />);

    expect(await screen.findByTitle(/Ver disputas deste dia/i)).toBeDefined();
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("aip_disputas_sheet") || "[]").length).toBe(1);
    });
  });
});
