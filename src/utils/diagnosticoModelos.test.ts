import { describe, expect, it } from "vitest";
import {
  MODELOS_PADRAO,
  opcoesDeModelo,
  resumoDoDiagnostico,
} from "./diagnosticoModelos";

describe("opcoesDeModelo", () => {
  it("usa a lista real da chave quando ela existe", () => {
    const opcoes = opcoesDeModelo(["gemini-4-flash", "gemini-4-pro"], "gemini-4-flash");
    expect(opcoes.map((o) => o.valor)).toEqual(["gemini-4-flash", "gemini-4-pro"]);
  });

  it("cai na lista padrão quando o diagnóstico não respondeu", () => {
    const opcoes = opcoesDeModelo(null, "gemini-3.8-flash");
    expect(opcoes.map((o) => o.valor)).toEqual(MODELOS_PADRAO);
  });

  it("trata lista vazia como ausência de informação, não como 'nenhum modelo'", () => {
    expect(opcoesDeModelo([], "gemini-3.8-flash").map((o) => o.valor)).toEqual(MODELOS_PADRAO);
  });

  it("mantém o modelo gravado mesmo fora da lista, avisando que a chave não o serve", () => {
    const opcoes = opcoesDeModelo(["gemini-4-flash"], "gemini-3.6-flash");
    expect(opcoes[0].valor).toBe("gemini-3.6-flash");
    expect(opcoes[0].rotulo).toContain("NÃO serve");
    // e não duplica o que já está na lista
    expect(opcoes.filter((o) => o.valor === "gemini-4-flash")).toHaveLength(1);
  });

  it("não repete o modelo escolhido quando ele já está na lista", () => {
    const opcoes = opcoesDeModelo(["a-flash", "b-flash"], "b-flash");
    expect(opcoes).toHaveLength(2);
  });

  it("anota o limite do plano gratuito, que é o que decide a escolha", () => {
    const opcoes = opcoesDeModelo(["gemini-3.1-flash-lite", "gemini-3.8-flash"], "gemini-3.8-flash");
    expect(opcoes[0].rotulo).toContain("15 req/min");
    expect(opcoes[1].rotulo).toContain("5 req/min");
  });
});

describe("resumoDoDiagnostico", () => {
  it("sem chave configurada, é erro e repete a mensagem do servidor", () => {
    const r = resumoDoDiagnostico({ configured: false, message: "Nenhuma chave de API configurada." });
    expect(r.nivel).toBe("erro");
    expect(r.texto).toContain("Nenhuma chave");
  });

  it("chave que serve o modelo escolhido é 'ok'", () => {
    const r = resumoDoDiagnostico({
      configured: true,
      provider: "gemini",
      model: "gemini-4-flash",
      modeloServidoPelaChave: true,
      modelosDisponiveis: ["gemini-4-flash"],
      cadeiaQueSeraUsada: ["gemini-4-flash"],
    });
    expect(r.nivel).toBe("ok");
    expect(r.texto).toContain("gemini-4-flash");
  });

  it("modelo que a chave não serve é aviso, e diz qual será usado no lugar", () => {
    const r = resumoDoDiagnostico({
      configured: true,
      provider: "gemini",
      model: "gemini-3.8-flash",
      modeloServidoPelaChave: false,
      modelosDisponiveis: ["gemini-4-flash-lite", "gemini-4-flash"],
      cadeiaQueSeraUsada: ["gemini-4-flash-lite", "gemini-4-flash"],
    });
    expect(r.nivel).toBe("aviso");
    expect(r.texto).toContain("NÃO serve");
    expect(r.texto).toContain("gemini-4-flash-lite");
    expect(r.detalhes.join(" ")).toContain("gemini-4-flash-lite → gemini-4-flash");
  });

  it("lista desconhecida (null) não vira 'nenhum modelo disponível'", () => {
    const r = resumoDoDiagnostico({
      configured: true,
      provider: "gemini",
      model: "gemini-3.8-flash",
      modeloServidoPelaChave: null,
      modelosDisponiveis: null,
      cadeiaQueSeraUsada: [],
    });
    expect(r.nivel).toBe("aviso");
    expect(r.texto).toContain("não deu para perguntar");
    expect(r.texto).not.toContain("nenhum modelo");
  });

  it("resposta de erro do servidor é erro", () => {
    expect(resumoDoDiagnostico({ error: "HTTP 500" }).nivel).toBe("erro");
    expect(resumoDoDiagnostico(null).nivel).toBe("erro");
  });
});
