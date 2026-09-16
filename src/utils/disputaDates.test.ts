import { describe, it, expect, vi, afterEach } from "vitest";
import { parseDisputaDate, getDisputaDateTag, getContrastTextColor } from "./disputaDates";

afterEach(() => {
  vi.useRealTimers();
});

describe("parseDisputaDate", () => {
  it("lê o formato ISO gravado pelo app", () => {
    expect(parseDisputaDate("2026-03-15 09:30")?.getTime()).toBe(new Date(2026, 2, 15, 9, 30).getTime());
    expect(parseDisputaDate("2026-03-15T09:30")?.getTime()).toBe(new Date(2026, 2, 15, 9, 30).getTime());
  });

  it("lê o formato brasileiro digitado à mão", () => {
    expect(parseDisputaDate("15/03/2026 09:30")?.getTime()).toBe(new Date(2026, 2, 15, 9, 30).getTime());
    expect(parseDisputaDate("15/03/2026, 09:30")?.getTime()).toBe(new Date(2026, 2, 15, 9, 30).getTime());
  });

  it("assume meia-noite quando só há data", () => {
    expect(parseDisputaDate("2026-03-15")?.getTime()).toBe(new Date(2026, 2, 15, 0, 0).getTime());
  });

  it("devolve null para texto vazio ou ilegível", () => {
    expect(parseDisputaDate("")).toBeNull();
    expect(parseDisputaDate("a combinar")).toBeNull();
  });
});

describe("getDisputaDateTag", () => {
  it("marca Hoje e Amanhã por dia de calendário, não por 24h corridas", () => {
    // 23:00 de 14/03: a disputa das 09:00 de 15/03 está a 10 horas, mas é
    // "Amanhã" — a etiqueta acompanha a virada do dia, não o relógio.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 14, 23, 0));

    expect(getDisputaDateTag("2026-03-14 23:59")).toEqual({ label: "Hoje", tone: "today" });
    expect(getDisputaDateTag("2026-03-15 09:00")).toEqual({ label: "Amanhã", tone: "tomorrow" });
    expect(getDisputaDateTag("2026-03-16 09:00")).toBeNull();
    expect(getDisputaDateTag("2026-03-13 09:00")).toBeNull();
  });
});

describe("getContrastTextColor", () => {
  it("escolhe texto escuro sobre fundo claro e claro sobre escuro", () => {
    expect(getContrastTextColor("#ffffff")).toBe("#0f172a");
    expect(getContrastTextColor("#0f172a")).toBe("#ffffff");
  });

  it("cai no texto claro quando a cor é inválida", () => {
    expect(getContrastTextColor("azul")).toBe("#ffffff");
  });
});
