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
  it("não oferece como válido nenhum modelo fictício ou aposentado que o projeto não serve", () => {
    for (const morto of ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-1.5-flash", "gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"]) {
      expect(VALID_GEMINI_MODELS).not.toContain(morto);
    }
  });

  it("redireciona o modelo antigo/fictício que vinha gravado no banco do usuário", () => {
    expect(normalizeGeminiModel("gemini-3.7-flash")).toBe("gemini-3.5-flash-lite");
    expect(normalizeGeminiModel("gemini-3.6-flash")).toBe("gemini-3.5-flash-lite");
    expect(normalizeGeminiModel("gemini-2.5-flash-lite")).toBe("gemini-3.5-flash-lite");
    expect(normalizeGeminiModel("gemini-2.5-flash")).toBe("gemini-3.5-flash-lite");
    expect(normalizeGeminiModel("gemini-flash-latest")).toBe("gemini-3.5-flash-lite");
  });

  it("preserva um modelo válido e aceita apelidos", () => {
    expect(normalizeGeminiModel("gemini-3.5-flash-lite")).toBe("gemini-3.5-flash-lite");
    expect(normalizeGeminiModel("gemini-3.5-flash")).toBe("gemini-3.5-flash");
    expect(normalizeGeminiModel("gemini-3.1-flash-lite")).toBe("gemini-3.1-flash-lite");
    expect(normalizeGeminiModel("flash-lite")).toBe("gemini-3.5-flash-lite");
    expect(normalizeGeminiModel("GEMINI-3.5-FLASH-LITE")).toBe("gemini-3.5-flash-lite");
  });

  it("cai num modelo que existe quando o nome é desconhecido ou vazio", () => {
    expect(VALID_GEMINI_MODELS).toContain(normalizeGeminiModel(undefined));
    expect(VALID_GEMINI_MODELS).toContain(normalizeGeminiModel("modelo-que-nao-existe"));
    expect(VALID_GEMINI_MODELS).toContain(normalizeGeminiModel(""));
  });
});

describe("cadeia de reserva", () => {
  it("cabe no teto de chamadas por requisição", () => {
    expect(getFallbackModels("gemini-3.5-flash").length).toBeLessThanOrEqual(MAX_CHAMADAS_PROVEDOR);
  });

  it("começa pelo modelo pedido, já normalizado", () => {
    expect(getFallbackModels("gemini-3.7-flash")[0]).toBe("gemini-3.5-flash-lite");
  });

  it("tem o Flash Lite como primeiro reserva, que é quem tem folga de limite", () => {
    expect(getFallbackModels("gemini-3.5-flash")[1]).toBe("gemini-3.5-flash-lite");
  });

  it("não repete o mesmo modelo dentro da cadeia", () => {
    const chain = getFallbackModels("gemini-3.5-flash-lite");
    expect(new Set(chain).size).toBe(chain.length);
  });

  it("só devolve modelos que estão na lista de válidos", () => {
    for (const m of getFallbackModels("gemini-3.7-flash")) {
      expect(VALID_GEMINI_MODELS).toContain(m);
    }
  });
});
