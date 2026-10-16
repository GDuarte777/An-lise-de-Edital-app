import { afterEach, describe, expect, it, vi } from "vitest";
import { descobrirModelos, escolherCadeia } from "../supabase/functions/api/modelosDisponiveis.ts";

// A lista fixa de modelos tirou a IA do ar três vezes: 3.7-flash, depois 3.6,
// depois 3.8 e flash-latest. Sempre com o mesmo disfarce — o Google responde
// 503 "high demand", e não 404, para um modelo que a chave não serve, e um 503
// que volta em 0,5 s parece pico passageiro. Perguntar à própria API encerra
// isso, e estes testes fixam o comportamento.

afterEach(() => vi.unstubAllGlobals());

function respostaComModelos(nomes: string[], metodos = ["generateContent"]) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      models: nomes.map((n) => ({ name: `models/${n}`, supportedGenerationMethods: metodos })),
    }),
  })) as any;
}

describe("escolherCadeia", () => {
  const disponiveis = ["gemini-4.0-flash", "gemini-4.0-flash-lite", "gemini-4.0-pro", "text-embedding-004"];

  it("mantém o modelo escolhido pelo usuário quando a chave o serve", () => {
    expect(escolherCadeia("gemini-4.0-pro", disponiveis, 3)[0]).toBe("gemini-4.0-pro");
  });

  it("descarta o modelo escolhido quando a chave NÃO o serve", () => {
    // É o caso que vinha derrubando tudo: insistir num nome que não existe para
    // aquela chave rende 503 a cada tentativa, até o orçamento acabar.
    const cadeia = escolherCadeia("gemini-3.7-flash", disponiveis, 3);
    expect(cadeia).not.toContain("gemini-3.7-flash");
    expect(cadeia.length).toBeGreaterThan(0);
  });

  it("prefere o Flash Lite, que tem o triplo do limite por minuto", () => {
    expect(escolherCadeia("", disponiveis, 3)[0]).toBe("gemini-4.0-flash-lite");
  });

  it("não oferece modelo que não gera texto", () => {
    expect(escolherCadeia("", disponiveis, 3)).not.toContain("text-embedding-004");
  });

  it("respeita o teto de chamadas por requisição", () => {
    expect(escolherCadeia("", disponiveis, 2).length).toBeLessThanOrEqual(2);
  });

  it("devolve vazio quando não se sabe o que a chave serve", () => {
    // Vazio faz quem chama manter a lista padrão: tentar o que se sabe é melhor
    // do que não tentar nada.
    expect(escolherCadeia("gemini-4.0-flash", null, 3)).toEqual([]);
    expect(escolherCadeia("gemini-4.0-flash", [], 3)).toEqual([]);
  });
});

describe("descobrirModelos", () => {
  it("lista só os modelos que geram texto, sem o prefixo models/", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: "models/gemini-4.0-flash", supportedGenerationMethods: ["generateContent"] },
            { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
          ],
        }),
      })) as any
    );

    const modelos = await descobrirModelos("chave-alfa-1");

    expect(modelos).toEqual(["gemini-4.0-flash"]);
  });

  it("devolve null quando a API recusa, em vez de fingir lista vazia", async () => {
    // null e [] significam coisas diferentes: null é "não sei", e quem chama
    // mantém a lista padrão; [] seria "a chave não serve nada".
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })) as any);

    expect(await descobrirModelos("chave-beta-2")).toBeNull();
  });

  it("devolve null quando a chamada estoura ou falha", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("rede indisponível"); }) as any);

    expect(await descobrirModelos("chave-gama-3")).toBeNull();
  });

  it("guarda em cache, para não consultar a cada mensagem do chat", async () => {
    const fetchFalso = respostaComModelos(["gemini-4.0-flash"]);
    vi.stubGlobal("fetch", fetchFalso);

    await descobrirModelos("chave-delta-4");
    await descobrirModelos("chave-delta-4");

    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("não envia a chave de uma na consulta da outra", async () => {
    const fetchFalso = respostaComModelos(["gemini-4.0-flash"]);
    vi.stubGlobal("fetch", fetchFalso);

    await descobrirModelos("chave-epsilon-5");
    await descobrirModelos("chave-zeta-6");

    expect(fetchFalso).toHaveBeenCalledTimes(2);
    expect(String(fetchFalso.mock.calls[0][0])).toContain("chave-epsilon-5");
    expect(String(fetchFalso.mock.calls[1][0])).toContain("chave-zeta-6");
  });
});
