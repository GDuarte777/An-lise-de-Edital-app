import { describe, it, expect } from "vitest";
import { DisputaRow } from "../types";
import {
  gerarIcsDeDisputas,
  escaparTextoIcs,
  dobrarLinhaIcs,
  formatarDataIcsLocal,
  formatarDataIcsUtc,
  contarDisputasExportaveis,
} from "./icsExport";

const AGORA = new Date(Date.UTC(2026, 2, 1, 12, 0, 0));

function disputa(parcial: Partial<DisputaRow> = {}): DisputaRow {
  return {
    id: "d1",
    orgao: "Prefeitura de Exemplo",
    uasgUndCompradora: "986531",
    numeroLicitacao: "PE 45/2026",
    portal: "Compras.gov.br",
    produtoItem: "Notebook 16GB",
    quantidade: 10,
    unidadeMedida: "Unidade",
    valorEstimadoItem: 50000,
    nossoValorAlvo: 45000,
    valorMinimoPiso: 40000,
    dataHoraDisputa: "2026-03-15 09:30",
    status: "Agendada",
    ...parcial,
  };
}

describe("escaparTextoIcs", () => {
  it("escapa os caracteres reservados pelo RFC 5545", () => {
    expect(escaparTextoIcs("a,b;c\\d")).toBe("a\\,b\\;c\\\\d");
    expect(escaparTextoIcs("linha1\nlinha2")).toBe("linha1\\nlinha2");
  });
});

describe("dobrarLinhaIcs", () => {
  it("deixa linha curta intacta", () => {
    expect(dobrarLinhaIcs("SUMMARY:curto")).toBe("SUMMARY:curto");
  });

  it("dobra linha longa com espaço de continuação", () => {
    const dobrada = dobrarLinhaIcs("DESCRIPTION:" + "x".repeat(200));
    const partes = dobrada.split("\r\n");
    expect(partes.length).toBeGreaterThan(1);
    // Nenhum segmento pode passar de 75 octetos.
    for (const parte of partes) {
      expect(Buffer.from(parte, "utf-8").length).toBeLessThanOrEqual(75);
    }
    // Toda continuação começa com espaço.
    for (const parte of partes.slice(1)) {
      expect(parte.startsWith(" ")).toBe(true);
    }
    // O conteúdo sobrevive ao desdobramento.
    expect(partes.map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe("DESCRIPTION:" + "x".repeat(200));
  });

  it("não parte um caractere acentuado ao meio", () => {
    const dobrada = dobrarLinhaIcs("DESCRIPTION:" + "ção ".repeat(40));
    for (const parte of dobrada.split("\r\n")) {
      expect(Buffer.from(parte, "utf-8").length).toBeLessThanOrEqual(75);
    }
    expect(dobrada).not.toContain("�");
  });
});

describe("formatação de data", () => {
  it("grava DTSTART como hora flutuante, sem Z", () => {
    expect(formatarDataIcsLocal(new Date(2026, 2, 15, 9, 30, 0))).toBe("20260315T093000");
  });

  it("grava DTSTAMP em UTC com Z", () => {
    expect(formatarDataIcsUtc(new Date(Date.UTC(2026, 2, 15, 9, 30, 0)))).toBe("20260315T093000Z");
  });
});

describe("gerarIcsDeDisputas", () => {
  it("produz um calendário válido com um evento por disputa", () => {
    const ics = gerarIcsDeDisputas([disputa()], { agora: AGORA });

    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:d1@analise-de-edital");
    expect(ics).toContain("DTSTART:20260315T093000");
    expect(ics).toContain("DTSTAMP:20260301T120000Z");
  });

  it("fecha todos os blocos que abre", () => {
    const ics = gerarIcsDeDisputas([disputa(), disputa({ id: "d2" })], { agora: AGORA });
    const contar = (t: string) => ics.split(t).length - 1;

    expect(contar("BEGIN:VEVENT")).toBe(contar("END:VEVENT"));
    expect(contar("BEGIN:VALARM")).toBe(contar("END:VALARM"));
    expect(contar("BEGIN:VEVENT")).toBe(2);
  });

  it("usa a duração padrão de uma hora", () => {
    const ics = gerarIcsDeDisputas([disputa()], { agora: AGORA });
    expect(ics).toContain("DTSTART:20260315T093000");
    expect(ics).toContain("DTEND:20260315T103000");
  });

  it("respeita duração customizada", () => {
    const ics = gerarIcsDeDisputas([disputa()], { agora: AGORA, duracaoMinutos: 30 });
    expect(ics).toContain("DTEND:20260315T100000");
  });

  it("inclui os dois alarmes", () => {
    const ics = gerarIcsDeDisputas([disputa()], { agora: AGORA });
    expect(ics).toContain("TRIGGER:-P1D");
    expect(ics).toContain("TRIGGER:-PT1H");
  });

  it("ignora disputa sem data legível", () => {
    const ics = gerarIcsDeDisputas(
      [disputa({ id: "sem-data", dataHoraDisputa: "a combinar" }), disputa({ id: "com-data" })],
      { agora: AGORA },
    );

    expect(ics).toContain("UID:com-data@analise-de-edital");
    expect(ics).not.toContain("UID:sem-data@analise-de-edital");
  });

  it("aceita a data em formato brasileiro", () => {
    const ics = gerarIcsDeDisputas([disputa({ dataHoraDisputa: "15/03/2026 14:00" })], { agora: AGORA });
    expect(ics).toContain("DTSTART:20260315T140000");
  });

  it("leva os números da estratégia para a descrição", () => {
    const ics = gerarIcsDeDisputas([disputa({ observacoes: "Piso; não descer" })], { agora: AGORA });
    const desdobrado = ics.replace(/\r\n /g, "");

    expect(desdobrado).toContain("Notebook 16GB");
    expect(desdobrado).toContain("UASG: 986531");
    // O ponto e vírgula da anotação precisa chegar escapado.
    expect(desdobrado).toContain("Piso\\; não descer");
  });

  it("gera calendário vazio, porém válido, sem disputas", () => {
    const ics = gerarIcsDeDisputas([], { agora: AGORA });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("usa CRLF entre as linhas, como o RFC exige", () => {
    const ics = gerarIcsDeDisputas([disputa()], { agora: AGORA });
    expect(ics).toContain("\r\n");
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });
});

describe("contarDisputasExportaveis", () => {
  it("conta apenas as que têm data legível", () => {
    expect(
      contarDisputasExportaveis([disputa(), disputa({ id: "x", dataHoraDisputa: "" })]),
    ).toBe(1);
  });
});
