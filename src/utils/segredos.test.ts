import { describe, it, expect } from "vitest";
import {
  derivarChaveMestra,
  criptografarSegredo,
  descriptografarSegredo,
  estaCriptografado,
  mascararSegredo,
  segredosIguais,
  criptografarConfiguracao,
  descriptografarConfiguracao,
} from "./segredos";

const CHAVE = derivarChaveMestra("uma-frase-secreta-de-teste");
const CHAVE_HEX = derivarChaveMestra("a".repeat(64));
const CHAVE_OUTRA = derivarChaveMestra("outra-frase-completamente-diferente");

describe("derivarChaveMestra", () => {
  it("aceita 64 hexadecimais como chave direta", () => {
    expect(CHAVE_HEX?.length).toBe(32);
    expect(CHAVE_HEX).toEqual(Buffer.from("a".repeat(64), "hex"));
  });

  it("deriva 32 bytes de uma frase qualquer", () => {
    expect(CHAVE?.length).toBe(32);
  });

  it("devolve null sem segredo configurado", () => {
    expect(derivarChaveMestra("")).toBeNull();
    expect(derivarChaveMestra(undefined)).toBeNull();
    expect(derivarChaveMestra("   ")).toBeNull();
  });
});

describe("ciclo de cifra", () => {
  it("cifra e decifra de volta ao original", () => {
    const chave = "AIzaSyD-exemplo-de-chave-do-gemini-123456";
    const cifrado = criptografarSegredo(chave, CHAVE);

    expect(cifrado).not.toBe(chave);
    expect(cifrado).not.toContain(chave);
    expect(estaCriptografado(cifrado)).toBe(true);
    expect(descriptografarSegredo(cifrado, CHAVE)).toBe(chave);
  });

  it("gera saídas diferentes para a mesma entrada", () => {
    // Sem IV aleatório, daria para descobrir que dois usuários usam a mesma
    // chave sem decifrar nenhuma das duas.
    const a = criptografarSegredo("mesma-chave", CHAVE);
    const b = criptografarSegredo("mesma-chave", CHAVE);
    expect(a).not.toBe(b);
    expect(descriptografarSegredo(a, CHAVE)).toBe("mesma-chave");
    expect(descriptografarSegredo(b, CHAVE)).toBe("mesma-chave");
  });

  it("não cifra duas vezes", () => {
    const uma = criptografarSegredo("chave", CHAVE);
    expect(criptografarSegredo(uma, CHAVE)).toBe(uma);
  });

  it("preserva caracteres não-ASCII", () => {
    const valor = "chave-com-acentuação-e-ç";
    expect(descriptografarSegredo(criptografarSegredo(valor, CHAVE), CHAVE)).toBe(valor);
  });
});

describe("compatibilidade com o que já está gravado", () => {
  it("sem chave mestra, é passagem direta — o app não muda de comportamento", () => {
    // É o que garante que definir nada mantém a plataforma funcionando igual.
    const chave = "chave-em-texto-puro";
    expect(criptografarSegredo(chave, null)).toBe(chave);
    expect(descriptografarSegredo(chave, null)).toBe(chave);
  });

  it("decifra valor legado sem prefixo devolvendo ele mesmo", () => {
    // Chaves gravadas antes desta mudança precisam continuar funcionando.
    expect(descriptografarSegredo("chave-antiga-texto-puro", CHAVE)).toBe("chave-antiga-texto-puro");
  });

  it("valor vazio continua vazio", () => {
    expect(criptografarSegredo("", CHAVE)).toBe("");
    expect(descriptografarSegredo("", CHAVE)).toBe("");
  });
});

describe("falhas de decifragem", () => {
  it("devolve vazio — nunca o texto cifrado — com a chave mestra errada", () => {
    // Devolver o cifrado faria a plataforma mandá-lo ao provedor de IA como se
    // fosse a chave, e o usuário veria "chave inválida" em vez da causa real.
    const cifrado = criptografarSegredo("segredo", CHAVE);
    expect(descriptografarSegredo(cifrado, CHAVE_OUTRA)).toBe("");
  });

  it("devolve vazio quando o valor foi adulterado", () => {
    const cifrado = criptografarSegredo("segredo", CHAVE);
    const adulterado = cifrado.slice(0, -6) + "XXXXXX";
    expect(descriptografarSegredo(adulterado, CHAVE)).toBe("");
  });

  it("devolve vazio para cifrado malformado", () => {
    expect(descriptografarSegredo("enc:v1:só-uma-parte", CHAVE)).toBe("");
  });

  it("devolve vazio quando há cifrado no banco mas nenhuma chave configurada", () => {
    const cifrado = criptografarSegredo("segredo", CHAVE);
    expect(descriptografarSegredo(cifrado, null)).toBe("");
  });
});

describe("mascararSegredo", () => {
  it("mostra só os últimos 4 caracteres", () => {
    const mascarado = mascararSegredo("AIzaSyD-chave-longa-1234");
    expect(mascarado.endsWith("1234")).toBe(true);
    expect(mascarado).not.toContain("AIzaSyD");
  });

  it("não vaza nada de chave muito curta", () => {
    expect(mascararSegredo("abc")).toBe("••••");
  });

  it("vazio continua vazio, para a tela distinguir 'sem chave' de 'chave salva'", () => {
    expect(mascararSegredo("")).toBe("");
    expect(mascararSegredo(null)).toBe("");
  });
});

describe("segredosIguais", () => {
  it("compara corretamente", () => {
    expect(segredosIguais("abc", "abc")).toBe(true);
    expect(segredosIguais("abc", "abd")).toBe(false);
    expect(segredosIguais("abc", "abcd")).toBe(false);
  });
});

describe("configuração inteira", () => {
  const config = {
    user_id: "u1",
    active_provider: "gemini",
    gemini_key: "chave-gemini",
    openai_key: "chave-openai",
    anthropic_key: "",
    deepseek_key: "chave-deepseek",
    gemini_model: "gemini-1.5-flash",
  };

  it("cifra só os campos de credencial", () => {
    const cifrada = criptografarConfiguracao(config, CHAVE);

    expect(estaCriptografado(cifrada.gemini_key)).toBe(true);
    expect(estaCriptografado(cifrada.openai_key)).toBe(true);
    expect(estaCriptografado(cifrada.deepseek_key)).toBe(true);
    // Campo não-secreto não pode ser cifrado: o servidor filtra por ele.
    expect(cifrada.active_provider).toBe("gemini");
    expect(cifrada.gemini_model).toBe("gemini-1.5-flash");
    expect(cifrada.user_id).toBe("u1");
    // Campo vazio continua vazio, e não vira um cifrado de string vazia.
    expect(cifrada.anthropic_key).toBe("");
  });

  it("faz o caminho de volta completo", () => {
    const voltou = descriptografarConfiguracao(criptografarConfiguracao(config, CHAVE), CHAVE);
    expect(voltou).toEqual(config);
  });

  it("sem chave mestra devolve a configuração intacta", () => {
    expect(criptografarConfiguracao(config, null)).toEqual(config);
  });

  it("decifra linha mista, com campos antigos em texto puro e novos cifrados", () => {
    // É o estado real do banco durante a transição.
    const mista = {
      ...config,
      gemini_key: criptografarSegredo("chave-gemini", CHAVE),
      openai_key: "chave-openai-ainda-em-texto-puro",
    };

    const voltou = descriptografarConfiguracao(mista, CHAVE);
    expect(voltou.gemini_key).toBe("chave-gemini");
    expect(voltou.openai_key).toBe("chave-openai-ainda-em-texto-puro");
  });
});
