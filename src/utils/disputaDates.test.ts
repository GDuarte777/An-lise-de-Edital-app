import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseDisputaDate,
  normalizarDataHoraDisputa,
  formatarDataPncpBrasilia,
  extrairDataPncpPreferencial,
  getDisputaDateTag,
  getContrastTextColor,
} from "./disputaDates";

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

  it("lê datas em português natural retornadas pela IA", () => {
    expect(parseDisputaDate("Dia 15/03/2026 às 09h30 (Horário de Brasília)")?.getTime()).toBe(
      new Date(2026, 2, 15, 9, 30).getTime()
    );
    expect(parseDisputaDate("Abertura: 15/03/2026 às 14:00")?.getTime()).toBe(
      new Date(2026, 2, 15, 14, 0).getTime()
    );
    expect(parseDisputaDate("25 de novembro de 2026 às 09:00")?.getTime()).toBe(
      new Date(2026, 10, 25, 9, 0).getTime()
    );
    expect(parseDisputaDate("9/3/2026 9h")?.getTime()).toBe(
      new Date(2026, 2, 9, 9, 0).getTime()
    );
  });

  it("assume meia-noite quando só há data", () => {
    expect(parseDisputaDate("2026-03-15")?.getTime()).toBe(new Date(2026, 2, 15, 0, 0).getTime());
  });

  it("devolve null para texto vazio, ilegível ou data inexistente", () => {
    expect(parseDisputaDate("")).toBeNull();
    expect(parseDisputaDate("a combinar")).toBeNull();
    expect(parseDisputaDate("Não identificado no edital")).toBeNull();
    expect(parseDisputaDate("31/02/2026 09:00")).toBeNull();
  });
});

describe("normalizarDataHoraDisputa, formatarDataPncpBrasilia e extrairDataPncpPreferencial", () => {
  it("normaliza datas da IA para padrão brasileiro canônico", () => {
    expect(normalizarDataHoraDisputa("Dia 15/03/2026 às 09h30 (Horário de Brasília)")).toBe("15/03/2026 09:30");
    expect(normalizarDataHoraDisputa("25 de novembro de 2026")).toBe("25/11/2026");
    expect(normalizarDataHoraDisputa("Não identificado no edital")).toBe("");
  });

  it("preserva hora local em ISO sem fuso e converte ISO UTC para horário de Brasília", () => {
    expect(formatarDataPncpBrasilia("2026-12-05T09:00:00")).toBe("05/12/2026 09:00");
    expect(formatarDataPncpBrasilia("2026-12-05T12:30:00Z")).toBe("05/12/2026 09:30");
    expect(formatarDataPncpBrasilia("2026-12-05T09:00:00-03:00")).toBe("05/12/2026 09:00");
  });

  it("prioriza dataEncerramentoProposta e aliases do PNCP sobre dataAberturaProposta", () => {
    const comAmbas = extrairDataPncpPreferencial({
      dataAberturaProposta: "2026-11-10T08:00:00",
      dataEncerramentoProposta: "2026-11-25T09:30:00",
    });
    expect(comAmbas).toEqual({
      dataFormatada: "25/11/2026 09:30",
      raw: "2026-11-25T09:30:00",
      origem: "encerramento",
    });

    const viaIndice = extrairDataPncpPreferencial({
      data_inicio_vigencia: "2026-11-10T08:00:00",
      data_fim_recebimento_propostas: "2026-11-28T14:00:00Z",
    });
    expect(viaIndice).toEqual({
      dataFormatada: "28/11/2026 11:00",
      raw: "2026-11-28T14:00:00Z",
      origem: "encerramento",
    });

    const viaVigencia = extrairDataPncpPreferencial({
      data_fim_vigencia: "2026-12-02T10:15:00",
    });
    expect(viaVigencia).toEqual({
      dataFormatada: "02/12/2026 10:15",
      raw: "2026-12-02T10:15:00",
      origem: "encerramento",
    });

    const soAbertura = extrairDataPncpPreferencial({
      dataAberturaProposta: "2026-11-10T08:00:00",
      dataEncerramentoProposta: null,
    });
    expect(soAbertura).toEqual({
      dataFormatada: "10/11/2026 08:00",
      raw: "2026-11-10T08:00:00",
      origem: "abertura",
    });

    expect(extrairDataPncpPreferencial({})).toBeNull();
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
