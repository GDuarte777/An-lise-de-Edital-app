import { describe, expect, it } from "vitest";
import { titularConversa } from "../supabase/functions/api/tituloConversa.ts";

// O título deixou de custar uma chamada ao Gemini. Como ele agora aparece na
// tela sem nenhuma revisão de um modelo, o que ele produz precisa estar fixado:
// um rótulo ruim é visível em toda conversa que o usuário abre.
describe("titularConversa", () => {
  it("usa as primeiras palavras com conteúdo da pergunta", () => {
    expect(titularConversa("Preciso analisar um edital de pregão eletrônico para notebooks"))
      .toBe("Preciso Analisar Edital Pregão");
  });

  it("descarta palavras de ligação depois da primeira", () => {
    expect(titularConversa("Qual o prazo de entrega do contrato?")).toBe("Qual Prazo Entrega Contrato");
  });

  it("reconhece saudação solta em vez de virar título", () => {
    expect(titularConversa("Olá, tudo bem?")).toBe("Conversa Rápida");
    expect(titularConversa("bom dia")).toBe("Conversa Rápida");
  });

  it("não confunde saudação com pergunta que começa por saudação", () => {
    const t = titularConversa("Bom dia, preciso de ajuda para montar a planilha de custos do pregão");
    expect(t).not.toBe("Conversa Rápida");
    expect(t.length).toBeGreaterThan(0);
  });

  it("limita a quatro palavras e a 50 caracteres", () => {
    const t = titularConversa("documentação habilitação jurídica fiscal trabalhista econômica técnica");
    expect(t.split(" ").length).toBeLessThanOrEqual(4);
    expect(t.length).toBeLessThanOrEqual(50);
  });

  it("aguenta entrada vazia, só pontuação ou só espaços", () => {
    expect(titularConversa("")).toBe("Nova Conversa");
    expect(titularConversa("   ")).toBe("Nova Conversa");
    expect(titularConversa("??? !!!")).toBe("Nova Conversa");
  });

  it("preserva acentuação e números do texto original", () => {
    expect(titularConversa("Análise do pregão 90012/2026")).toBe("Análise Pregão 90012/2026");
  });
});
