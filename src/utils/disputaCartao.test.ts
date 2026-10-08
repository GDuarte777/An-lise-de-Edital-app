import { describe, it, expect } from "vitest";
import { DisputaRow } from "../types";
import { valorDoCartao, SEM_VALOR } from "./disputaCartao";

function disputa(parcial: Partial<DisputaRow> = {}): DisputaRow {
  return {
    id: "d1",
    orgao: "CREF20/SE",
    uasgUndCompradora: "",
    numeroLicitacao: "Termo de Referência 27/2026",
    portal: "",
    produtoItem: "Microsoft 365 Business Standard",
    quantidade: 17,
    unidadeMedida: "Unidade",
    valorEstimadoItem: 17590.09,
    nossoValorAlvo: 15831.08,
    valorMinimoPiso: 14423.87,
    dataHoraDisputa: "2026-10-09 08:00",
    status: "Agendada",
    observacoes: "",
    linkPNCP: "",
    ...parcial,
  };
}

describe("valorDoCartao", () => {
  it("mostra o valor estimado, não o nosso lance alvo", () => {
    // O cartão exibia 15.831,08 — que é 90% do estimado, calculado por nós
    // quando a análise não sugere alvo. Quem lia o cartão achava que aquele
    // era o valor do certame.
    const { texto } = valorDoCartao(disputa());
    expect(texto).toMatch(/17\.590,09/);
    expect(texto).not.toMatch(/15\.831,08/);
  });

  it("diz no tooltip qual valor é, já que no cartão não cabe rótulo", () => {
    expect(valorDoCartao(disputa()).titulo).toMatch(/Valor estimado/i);
  });

  it("não cai para o alvo quando o estimado não veio", () => {
    // Trocar o valor ausente por outro, calculado, é preencher lacuna por
    // suposição — o certame simplesmente não trouxe esse número.
    const { texto, titulo } = valorDoCartao(disputa({ valorEstimadoItem: 0 }));
    expect(texto).toBe(SEM_VALOR);
    expect(titulo).toMatch(/não informado/i);
  });

  it("trata linha sem o campo como sem valor", () => {
    expect(valorDoCartao({ valorEstimadoItem: undefined as unknown as number }).texto).toBe(SEM_VALOR);
    expect(valorDoCartao({ valorEstimadoItem: NaN }).texto).toBe(SEM_VALOR);
  });

  it("formata em reais", () => {
    expect(valorDoCartao(disputa({ valorEstimadoItem: 1000 })).texto).toMatch(/R\$\s?1\.000,00/);
  });
});
