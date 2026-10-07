import { describe, expect, it } from "vitest";
import {
  VALID_GEMINI_MODELS,
  normalizeGeminiModel,
  getFallbackModels,
  MAX_CHAMADAS_PROVEDOR,
} from "../supabase/functions/api/modelosGemini.ts";

// A escolha de modelo derrubou o chat em produção duas vezes: uma por pedir um
// modelo que a chave não serve (503 "high demand" em toda tentativa, por dias),
// outra por tentar seis modelos contra um limite de cinco requisições por
// minuto. As duas regressões cabem em teste, então cabem aqui.

describe("modelos aposentados", () => {
  it("não oferece como válido nenhum modelo que o projeto não serve", () => {
    for (const morto of ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"]) {
      expect(VALID_GEMINI_MODELS).not.toContain(morto);
    }
  });

  it("redireciona o modelo que vinha gravado no banco do usuário", () => {
    // gemini-3.7-flash é o que estava em configuracoes_usuario e o que o cliente
    // continuava enviando a cada mensagem.
    expect(normalizeGeminiModel("gemini-3.7-flash")).toBe("gemini-3.8-flash");
    expect(normalizeGeminiModel("gemini-3.6-flash")).toBe("gemini-3.8-flash");
    expect(normalizeGeminiModel("gemini-2.5-flash")).toBe("gemini-3.8-flash");
    expect(normalizeGeminiModel("gemini-3.5-flash-lite")).toBe("gemini-3.1-flash-lite");
  });

  it("preserva um modelo válido e aceita apelidos", () => {
    expect(normalizeGeminiModel("gemini-3.8-flash")).toBe("gemini-3.8-flash");
    expect(normalizeGeminiModel("gemini-3.1-flash-lite")).toBe("gemini-3.1-flash-lite");
    expect(normalizeGeminiModel("flash-lite")).toBe("gemini-3.1-flash-lite");
    expect(normalizeGeminiModel("GEMINI-3.8-FLASH")).toBe("gemini-3.8-flash");
  });

  it("cai num modelo que existe quando o nome é desconhecido ou vazio", () => {
    expect(VALID_GEMINI_MODELS).toContain(normalizeGeminiModel(undefined));
    expect(VALID_GEMINI_MODELS).toContain(normalizeGeminiModel("modelo-que-nao-existe"));
    expect(VALID_GEMINI_MODELS).toContain(normalizeGeminiModel(""));
  });
});

describe("cadeia de reserva", () => {
  it("cabe no teto de chamadas por requisição", () => {
    // Cada modelo da cadeia é pelo menos uma chamada contra o limite por minuto.
    // Uma cadeia maior que o teto é cadeia que nunca será percorrida inteira.
    expect(getFallbackModels("gemini-3.8-flash").length).toBeLessThanOrEqual(MAX_CHAMADAS_PROVEDOR);
  });

  it("começa pelo modelo pedido, já normalizado", () => {
    expect(getFallbackModels("gemini-3.7-flash")[0]).toBe("gemini-3.8-flash");
  });

  it("tem o Flash Lite como primeiro reserva, que é quem tem folga de limite", () => {
    // Flash: 5 req/min e 20/dia. Flash Lite: 15/min e 500/dia. Quando o Flash
    // recusa por taxa, outro Flash encontra o mesmo teto.
    expect(getFallbackModels("gemini-3.8-flash")[1]).toBe("gemini-3.1-flash-lite");
  });

  it("não repete o mesmo modelo dentro da cadeia", () => {
    const chain = getFallbackModels("gemini-3.1-flash-lite");
    expect(new Set(chain).size).toBe(chain.length);
  });

  it("só devolve modelos que estão na lista de válidos", () => {
    for (const m of getFallbackModels("gemini-3.7-flash")) {
      expect(VALID_GEMINI_MODELS).toContain(m);
    }
  });
});
