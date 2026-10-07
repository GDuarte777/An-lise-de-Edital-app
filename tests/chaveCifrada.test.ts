import { describe, expect, it } from "vitest";
import { chaveEstaCifrada, validateApiKeyFormat } from "../src/utils/aiClientHelper";

// Ligar a criptografia das chaves em repouso quebrou a IA inteira: o banco
// passou a guardar "enc:v1:...", o navegador hidrata o localStorage lendo o
// banco direto e não tem como decifrar, e passou a mandar o texto cifrado ao
// Google — que respondia "API key not valid" em toda mensagem. O caminho
// cifrado agora é explícito dos dois lados, e fixado aqui.
describe("chave cifrada em repouso", () => {
  it("reconhece o prefixo do formato cifrado", () => {
    expect(chaveEstaCifrada("enc:v1:abc123")).toBe(true);
    expect(chaveEstaCifrada("AIzaSyAlgumaCoisa")).toBe(false);
    expect(chaveEstaCifrada("AQ.Ab8RN6Jalgo")).toBe(false);
    expect(chaveEstaCifrada("")).toBe(false);
    expect(chaveEstaCifrada(null)).toBe(false);
    expect(chaveEstaCifrada(undefined)).toBe(false);
  });

  it("aceita uma chave cifrada como configurada, em vez de barrar a análise", () => {
    // O servidor é quem decifra. Reprovar aqui bloquearia a análise de edital
    // antes de sair do navegador, dizendo que a chave "parece inválida".
    expect(validateApiKeyFormat("enc:v1:" + "x".repeat(100), "gemini")).toBeNull();
    expect(validateApiKeyFormat("enc:v1:" + "x".repeat(100), "openai")).toBeNull();
  });

  it("continua reprovando chave ausente", () => {
    expect(validateApiKeyFormat("", "gemini")).toContain("não configurada");
    expect(validateApiKeyFormat("abc", "gemini")).toContain("não configurada");
  });

  it("continua reprovando chave com formato errado para o provedor", () => {
    expect(validateApiKeyFormat("chave-qualquer-longa-o-bastante", "gemini")).toContain("AIza");
    expect(validateApiKeyFormat("AIzaSyChaveDoGoogle123", "openai")).toContain("sk-");
  });

  it("aceita os dois formatos de chave do Gemini", () => {
    expect(validateApiKeyFormat("AIzaSyChaveClassica12345", "gemini")).toBeNull();
    expect(validateApiKeyFormat("AQ.Ab8RN6ChaveNovaDoAiStudio", "gemini")).toBeNull();
  });
});
