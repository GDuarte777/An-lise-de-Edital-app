import { describe, expect, it } from "vitest";
import {
  ehCodigoUasgPlausivel,
  normalizarCodigoUasg,
  extrairCodigoUasg,
  extrairNumeroEdital,
} from "./identificacaoEdital";

// O defeito relatado: na Planilha de Disputas, "UASG / Código Unidade" e
// "Nº Licitação / Processo" mostravam o MESMO valor, "163/2026". A UASG caía
// por fallback em identificacaoNumerica, que é o número do processo, e quando
// nem isso existia o código escrevia "UASG 090012" — um número inventado.

describe("ehCodigoUasgPlausivel", () => {
  it("reprova número de processo, que foi o valor que vazou para o campo", () => {
    expect(ehCodigoUasgPlausivel("163/2026")).toBe(false);
    expect(ehCodigoUasgPlausivel("44/2026")).toBe(false);
    expect(ehCodigoUasgPlausivel("90012/2026")).toBe(false);
  });

  it("aceita o código da unidade, com ou sem rótulo", () => {
    expect(ehCodigoUasgPlausivel("927374")).toBe(true);
    expect(ehCodigoUasgPlausivel("UASG 927374")).toBe(true);
    expect(ehCodigoUasgPlausivel("uasg: 160001")).toBe(true);
    expect(ehCodigoUasgPlausivel("9273")).toBe(true);
  });

  it("reprova vazio, texto e tamanho fora da faixa", () => {
    expect(ehCodigoUasgPlausivel("")).toBe(false);
    expect(ehCodigoUasgPlausivel(null)).toBe(false);
    expect(ehCodigoUasgPlausivel(undefined)).toBe(false);
    expect(ehCodigoUasgPlausivel("Pregão Eletrônico")).toBe(false);
    expect(ehCodigoUasgPlausivel("123")).toBe(false);
    expect(ehCodigoUasgPlausivel("1234567")).toBe(false);
  });
});

describe("normalizarCodigoUasg", () => {
  it("devolve só os dígitos", () => {
    expect(normalizarCodigoUasg("UASG 927374")).toBe("927374");
    expect(normalizarCodigoUasg("Unidade Gestora: 160.001")).toBe("160001");
    expect(normalizarCodigoUasg(" 925001 ")).toBe("925001");
  });

  it("devolve vazio em vez de inventar, quando o valor não é UASG", () => {
    // Campo em branco vira "—" na tela e diz a verdade; um palpite parece
    // dado conferido e leva o usuário a confiar nele.
    expect(normalizarCodigoUasg("163/2026")).toBe("");
    expect(normalizarCodigoUasg("PE Edital/2026")).toBe("");
    expect(normalizarCodigoUasg("")).toBe("");
  });
});

describe("extrairCodigoUasg", () => {
  it("encontra o código quando o rótulo está por perto", () => {
    expect(extrairCodigoUasg("Órgão: SAP — UASG 927374")).toBe("927374");
    expect(extrairCodigoUasg("Código da Unidade: 160001")).toBe("160001");
    expect(extrairCodigoUasg("Unidade Compradora - 925001")).toBe("925001");
  });

  it("não chuta um número solto do edital como UASG", () => {
    // Sem a amarra do rótulo, CEP, quantidade e número de lote virariam
    // candidatos: o edital está cheio de sequências de cinco e seis dígitos.
    expect(extrairCodigoUasg("Quantidade: 150000 unidades")).toBe("");
    expect(extrairCodigoUasg("CEP 01310-100, São Paulo")).toBe("");
    expect(extrairCodigoUasg("Pregão Eletrônico nº 163/2026")).toBe("");
    expect(extrairCodigoUasg("")).toBe("");
  });

  it("não confunde o processo colado ao rótulo com o código", () => {
    expect(extrairCodigoUasg("UASG 163/2026")).toBe("");
  });
});

describe("extrairNumeroEdital", () => {
  it("lê o número do edital com o ano", () => {
    expect(extrairNumeroEdital("Pregão Eletrônico nº 44/2026")).toBe("44/2026");
    expect(extrairNumeroEdital("EDITAL Nº 163/2026")).toBe("163/2026");
    expect(extrairNumeroEdital("Processo: 1234/2025")).toBe("1234/2025");
  });

  it("devolve vazio quando não há número identificável", () => {
    expect(extrairNumeroEdital("Secretaria da Administração Penitenciária")).toBe("");
    expect(extrairNumeroEdital("")).toBe("");
  });
});
