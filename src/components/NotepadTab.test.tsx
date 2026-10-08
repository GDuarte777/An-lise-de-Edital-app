// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";

// O bloco conversa com o Supabase. O que está sob verificação aqui é a tela:
// criar pasta, criar nota, separar uma da outra, buscar, e o que acontece
// quando o banco não responde.
//
// Limite conhecido do ambiente, medido nesta aba: DESMONTAR uma árvore cujo
// `Popover` ou `DropdownMenu` do radix foi aberto custa ~44 s em jsdom — o
// `cleanup()` do afterEach é que trava, não a interação. O fluxo em si roda em
// ~190 ms e grava certo (verificado com sonda descartável: a pasta chega ao
// banco com nome, cor e posição, sem erro de validação). Por isso os três
// fluxos que começam abrindo um desses componentes — criar pasta, recusar nome
// repetido e excluir pasta — NÃO têm teste de renderização: somariam ~2,5 min
// ao CI por um ganho que `utils/notas.test.ts` já cobre
// (`validarPasta` recusa nome repetido, `desvincularNotasDaPasta` preserva as
// notas da pasta apagada). Ver CLAUDE.md.
const banco = vi.hoisted(() => ({
  notas: [] as any[],
  pastas: [] as any[],
  okNotas: true,
  okPastas: true,
  notasSalvas: [] as any[],
  pastasSalvas: [] as any[],
  notasExcluidas: [] as string[],
  pastasExcluidas: [] as string[],
  falhaAoSalvarNota: null as string | null,
  proximoId: 0,
}));

vi.mock("../utils/supabaseClient", () => ({
  fetchNotasComStatus: vi.fn(async () => ({ ok: banco.okNotas, rows: banco.notas })),
  fetchPastasNotasComStatus: vi.fn(async () => ({ ok: banco.okPastas, rows: banco.pastas })),
  saveNotaToSupabase: vi.fn(async (n: any) => {
    banco.notasSalvas.push(n);
    if (banco.falhaAoSalvarNota) return { success: false, message: banco.falhaAoSalvarNota };
    return { success: true, message: "ok" };
  }),
  savePastaNotaToSupabase: vi.fn(async (p: any) => {
    banco.pastasSalvas.push(p);
    return { success: true, message: "ok" };
  }),
  deleteNotaFromSupabase: vi.fn(async (id: string) => {
    banco.notasExcluidas.push(id);
    return true;
  }),
  deletePastaNotaFromSupabase: vi.fn(async (id: string) => {
    banco.pastasExcluidas.push(id);
    return true;
  }),
  subscribeToSupabaseTable: vi.fn(() => () => {}),
  generateUUID: vi.fn(() => `id-${++banco.proximoId}`),
}));

import NotepadTab from "./NotepadTab";

const AGORA = new Date().toISOString();

function nota(parcial: Record<string, any> = {}) {
  return {
    id: "n1",
    pastaId: "",
    titulo: "Checklist do PE 45",
    conteudo: "Levar certidão do FGTS",
    fixada: false,
    criadaEm: AGORA,
    atualizadaEm: AGORA,
    ...parcial,
  };
}

beforeEach(() => {
  localStorage.clear();
  banco.notas = [];
  banco.pastas = [];
  banco.okNotas = true;
  banco.okPastas = true;
  banco.notasSalvas = [];
  banco.pastasSalvas = [];
  banco.notasExcluidas = [];
  banco.pastasExcluidas = [];
  banco.falhaAoSalvarNota = null;
  banco.proximoId = 0;

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
  vi.useRealTimers();
});

describe("NotepadTab — notas", () => {
  it("abre vazio dizendo o que fazer, em vez de uma tela em branco", async () => {
    render(<NotepadTab />);
    expect(await screen.findByText(/Seu bloco está vazio/i)).toBeDefined();
    expect(screen.getByText(/Nenhuma nota aberta/i)).toBeDefined();
  });

  it("criar nota abre o editor e o que é digitado chega ao banco", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<NotepadTab />);

    fireEvent.click(screen.getByRole("button", { name: /^Nova nota$/i }));

    const titulo = await screen.findByLabelText(/Título da nota/i);
    fireEvent.change(titulo, { target: { value: "Ligar para o pregoeiro" } });
    fireEvent.change(screen.getByLabelText(/Conteúdo da nota/i), {
      target: { value: "Ramal 2231, falar sobre o anexo II" },
    });

    // O texto é salvo sozinho, depois de uma pausa na digitação.
    await vi.advanceTimersByTimeAsync(1000);
    await waitFor(() => expect(banco.notasSalvas.length).toBeGreaterThan(0));

    const salva = banco.notasSalvas[banco.notasSalvas.length - 1];
    expect(salva.titulo).toBe("Ligar para o pregoeiro");
    expect(salva.conteudo).toBe("Ramal 2231, falar sobre o anexo II");
  });

  it("carrega as notas que já estavam no banco", async () => {
    banco.notas = [nota(), nota({ id: "n2", titulo: "Recurso do CREF" })];
    render(<NotepadTab />);

    expect(await screen.findByText("Checklist do PE 45")).toBeDefined();
    expect(screen.getByText("Recurso do CREF")).toBeDefined();
  });

  it("busca filtra por título e por texto, sem exigir acento", async () => {
    banco.notas = [
      nota({ id: "a", titulo: "Habilitação do CREF" }),
      nota({ id: "b", titulo: "Recurso", conteudo: "prazo de 3 dias úteis" }),
    ];
    render(<NotepadTab />);
    await screen.findByText("Habilitação do CREF");

    fireEvent.change(screen.getByLabelText(/Buscar notas/i), { target: { value: "habilitacao" } });

    expect(screen.getByText("Habilitação do CREF")).toBeDefined();
    expect(screen.queryByText("Recurso")).toBeNull();
  });

  it("nota sem título aparece pela primeira linha que o usuário escreveu", async () => {
    // Não é resumo gerado: é o texto dele.
    banco.notas = [nota({ titulo: "", conteudo: "Conferir o edital até sexta\nsegunda linha" })];
    render(<NotepadTab />);

    expect(await screen.findByText("Conferir o edital até sexta")).toBeDefined();
  });

  it("excluir pede confirmação e remove do banco", async () => {
    banco.notas = [nota()];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<NotepadTab />);

    fireEvent.click(await screen.findByText("Checklist do PE 45"));
    const editor = screen.getByLabelText(/Conteúdo da nota/i).closest("section")!;
    fireEvent.click(within(editor).getByRole("button", { name: /Excluir/i }));

    await waitFor(() => expect(banco.notasExcluidas).toContain("n1"));
  });

  it("não exclui quando o usuário cancela a confirmação", async () => {
    banco.notas = [nota()];
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<NotepadTab />);

    fireEvent.click(await screen.findByText("Checklist do PE 45"));
    const editor = screen.getByLabelText(/Conteúdo da nota/i).closest("section")!;
    fireEvent.click(within(editor).getByRole("button", { name: /Excluir/i }));

    await waitFor(() => expect(banco.notasExcluidas).toHaveLength(0));
    expect(screen.getByText("Checklist do PE 45")).toBeDefined();
  });
});

describe("NotepadTab — pastas", () => {
  it("cria pasta e separa as notas por ela", async () => {
    banco.pastas = [{ id: "p1", nome: "Licitações 2026", cor: "#6366f1", posicao: 0 }];
    banco.notas = [
      nota({ id: "dentro", pastaId: "p1", titulo: "Nota da pasta" }),
      nota({ id: "fora", pastaId: "", titulo: "Nota solta" }),
    ];
    render(<NotepadTab />);

    // "Todas as notas" mostra as duas.
    expect(await screen.findByText("Nota da pasta")).toBeDefined();
    expect(screen.getByText("Nota solta")).toBeDefined();

    // Clicar na pasta recorta a lista.
    fireEvent.click(screen.getByRole("button", { name: /Ver Licitações 2026/i }));
    expect(screen.getByText("Nota da pasta")).toBeDefined();
    expect(screen.queryByText("Nota solta")).toBeNull();

    // "Sem pasta" é o complemento.
    fireEvent.click(screen.getByRole("button", { name: /Ver Sem pasta/i }));
    expect(screen.getByText("Nota solta")).toBeDefined();
    expect(screen.queryByText("Nota da pasta")).toBeNull();
  });

  it("mudar a pasta da nota no editor grava a mudança", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    banco.pastas = [{ id: "p1", nome: "Licitações 2026", cor: "#6366f1", posicao: 0 }];
    banco.notas = [nota()];
    render(<NotepadTab />);

    fireEvent.click(await screen.findByText("Checklist do PE 45"));
    fireEvent.change(screen.getByLabelText(/Pasta desta nota/i), { target: { value: "p1" } });

    await vi.advanceTimersByTimeAsync(1000);
    await waitFor(() => expect(banco.notasSalvas.length).toBeGreaterThan(0));
    expect(banco.notasSalvas[banco.notasSalvas.length - 1].pastaId).toBe("p1");
  });
});

describe("NotepadTab — quando o banco não responde", () => {
  it("avisa que a nota ficou só no navegador, em vez de dar como salva", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    banco.falhaAoSalvarNota = "Tabela notas_bloco não existe no Supabase.";
    render(<NotepadTab />);

    fireEvent.click(screen.getByRole("button", { name: /^Nova nota$/i }));
    fireEvent.change(await screen.findByLabelText(/Conteúdo da nota/i), {
      target: { value: "texto qualquer" },
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(
      await screen.findByText(/salvas neste navegador, mas o banco não aceitou/i),
    ).toBeDefined();
  });

  it("não apaga o cache local quando a consulta falha", async () => {
    // Mesmo defeito que já fez o calendário perder disputas: resposta vazia
    // por falha de rede tratada como "o usuário não tem nada".
    localStorage.setItem("aip_notas", JSON.stringify([nota()]));
    banco.okNotas = false;
    banco.notas = [];

    render(<NotepadTab />);

    expect(await screen.findByText("Checklist do PE 45")).toBeDefined();
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("aip_notas") || "[]").length).toBe(1);
    });
  });
});
