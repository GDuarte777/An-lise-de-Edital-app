// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchEditaisFromSupabase: vi.fn(),
  saveEditalToSupabase: vi.fn(),
  deleteEditalFromSupabase: vi.fn(),
  clearAllEditaisFromSupabase: vi.fn(),
  subscribeToSupabaseTable: vi.fn(() => () => {}),
  generateUUID: vi.fn(() => "uuid-generated-1"),
}));

vi.mock("./supabaseClient", () => mocks);

import {
  getEditalHistory,
  refreshEditalHistory,
  addEditalToHistory,
  removeEditalFromHistory,
  clearEditalHistory,
  resetEditalHistory,
} from "./editalHistory";

const makeRow = (id: string, title = `Análise ${id}`) => ({
  id,
  title,
  date: "25/11/2026 10:00",
  analysis: {
    descricaoProduto: title,
    pontosPositivos: [],
    pontosAlerta: [],
    prazoEntrega: "15 dias",
    prazoPagamento: "30 dias",
    documentosExigidos: [],
    reportMarkdown: "Relatório",
    rawText: "A".repeat(2000),
  },
});

describe("editalHistory — exclusão e sincronização sem ressurreição", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetEditalHistory();
    mocks.fetchEditaisFromSupabase.mockResolvedValue({ ok: true, rows: [] });
    mocks.saveEditalToSupabase.mockResolvedValue({ success: true, message: "ok" });
    mocks.deleteEditalFromSupabase.mockResolvedValue({ ok: true, deletedCount: 1 });
    mocks.clearAllEditaisFromSupabase.mockResolvedValue({ ok: true, deletedCount: 2 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("remove uma análise específica e não a ressuscita após refreshEditalHistory (troca de aba / reload)", async () => {
    const row1 = makeRow("edital-1");
    const row2 = makeRow("edital-2");

    mocks.fetchEditaisFromSupabase.mockResolvedValueOnce({ ok: true, rows: [row1, row2] });
    await refreshEditalHistory();
    expect(getEditalHistory().map((i) => i.id)).toEqual(["edital-1", "edital-2"]);

    const res = await removeEditalFromHistory("edital-1");
    expect(res.ok).toBe(true);
    expect(mocks.deleteEditalFromSupabase).toHaveBeenCalledWith("edital-1");
    expect(getEditalHistory().map((i) => i.id)).toEqual(["edital-2"]);

    // Mesmo que o banco ainda devolva row1 numa corrida ou cache antigo, não volta
    mocks.fetchEditaisFromSupabase.mockResolvedValueOnce({ ok: true, rows: [row1, row2] });
    await refreshEditalHistory();
    expect(getEditalHistory().map((i) => i.id)).toEqual(["edital-2"]);
    expect(mocks.saveEditalToSupabase).not.toHaveBeenCalled();
  });

  it("NUNCA reenvia para o Supabase uma análise que sumiu do banco (excluída em outra aba/dispositivo)", async () => {
    const row1 = makeRow("edital-a");
    const row2 = makeRow("edital-b");

    // Carga inicial: ambos existem no banco
    mocks.fetchEditaisFromSupabase.mockResolvedValueOnce({ ok: true, rows: [row1, row2] });
    await refreshEditalHistory();
    expect(getEditalHistory().map((i) => i.id)).toEqual(["edital-a", "edital-b"]);

    // Outro navegador/aba apagou "edital-a" no Supabase
    mocks.fetchEditaisFromSupabase.mockResolvedValueOnce({ ok: true, rows: [row2] });
    await refreshEditalHistory();

    // Deve desaparecer localmente e JAMAIS chamar saveEditalToSupabase para ressuscitá-lo
    expect(getEditalHistory().map((i) => i.id)).toEqual(["edital-b"]);
    expect(mocks.saveEditalToSupabase).not.toHaveBeenCalled();
  });

  it("Apagar Tudo remove todos os itens e permanece vazio após refreshEditalHistory", async () => {
    const row1 = makeRow("edital-10");
    const row2 = makeRow("edital-20");

    mocks.fetchEditaisFromSupabase.mockResolvedValueOnce({ ok: true, rows: [row1, row2] });
    await refreshEditalHistory();
    expect(getEditalHistory()).toHaveLength(2);

    const res = await clearEditalHistory();
    expect(res.ok).toBe(true);
    expect(mocks.clearAllEditaisFromSupabase).toHaveBeenCalledWith(["edital-10", "edital-20"]);
    expect(getEditalHistory()).toEqual([]);

    // Simula troca de aba imediatamente após limpar tudo
    mocks.fetchEditaisFromSupabase.mockResolvedValueOnce({ ok: true, rows: [] });
    await refreshEditalHistory();
    expect(getEditalHistory()).toEqual([]);
    expect(mocks.saveEditalToSupabase).not.toHaveBeenCalled();
  });

  it("resiste a QuotaExceededError no localStorage sem perder a exclusão em memória", async () => {
    const row1 = makeRow("edital-quota");
    mocks.fetchEditaisFromSupabase.mockResolvedValueOnce({ ok: true, rows: [row1] });
    await refreshEditalHistory();
    expect(getEditalHistory().map((i) => i.id)).toEqual(["edital-quota"]);

    // Simula localStorage cheio lançando QuotaExceededError em qualquer setItem
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });

    const res = await removeEditalFromHistory("edital-quota");
    expect(res.ok).toBe(true);
    expect(getEditalHistory()).toEqual([]);

    // Troca de aba: mesmo com tombstones fora do localStorage, memoryTombstones impede retorno
    mocks.fetchEditaisFromSupabase.mockResolvedValueOnce({ ok: true, rows: [row1] });
    await refreshEditalHistory();
    expect(getEditalHistory()).toEqual([]);
    expect(mocks.saveEditalToSupabase).not.toHaveBeenCalled();

    setItemSpy.mockRestore();
  });

  it("reenvia apenas análises criadas offline cuja gravação inicial realmente falhou", async () => {
    mocks.generateUUID.mockReturnValueOnce("edital-offline-1");
    mocks.saveEditalToSupabase.mockResolvedValueOnce({ success: false, message: "offline" });

    await addEditalToHistory(makeRow("edital-offline-1").analysis as any, "Edital Offline");
    expect(getEditalHistory().map((i) => i.id)).toEqual(["edital-offline-1"]);

    // Ao sincronizar novamente com o banco ainda vazio, o item explicitamente pendente é preservado e reenviado
    mocks.saveEditalToSupabase.mockResolvedValueOnce({ success: true, message: "ok" });
    mocks.fetchEditaisFromSupabase.mockResolvedValueOnce({ ok: true, rows: [] });
    await refreshEditalHistory();

    expect(getEditalHistory().map((i) => i.id)).toEqual(["edital-offline-1"]);
    expect(mocks.saveEditalToSupabase).toHaveBeenCalledTimes(2);
  });

  it("compacta rawText pesado ao gravar no cache local para evitar estouro de cota", async () => {
    const bigRow = makeRow("edital-pesado");
    mocks.fetchEditaisFromSupabase.mockResolvedValueOnce({ ok: true, rows: [bigRow] });
    await refreshEditalHistory();

    const stored = JSON.parse(localStorage.getItem("aip_edital_history") || "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].analysis.rawText).toBeUndefined();
  });
});
