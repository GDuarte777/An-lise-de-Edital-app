import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import {
  cleanExtractedDocumentText,
  compactTextForTokenBudget,
  compactGeminiContentsForBudget,
  isTokenLimitError,
  extractPdfTextFromBuffer,
} from "../server";
import { formatAiError } from "../src/utils/aiClientHelper";

describe("limpeza e compactação inteligente de PDFs para o limite de tokens", () => {
  it("remove cabeçalhos repetitivos, números de página e pontilhados preservando linhas de itens", () => {
    const repeatedHeader = "PREFEITURA MUNICIPAL DE EXEMPLO - SECRETARIA DE ADMINISTRAÇÃO";
    const raw = [
      repeatedHeader,
      "Página 1 de 50",
      "PREGÃO ELETRÔNICO Nº 045/2026..............",
      repeatedHeader,
      "Página 2 de 50",
      "Item 01 - Notebook Core i7    Quantidade: 10   Valor Unitário: R$ 4.500,00",
      repeatedHeader,
      "Pág. 3 / 50",
      "Item 02 - Monitor 24 pol      Quantidade: 20   Valor Unitário: R$ 850,00",
      repeatedHeader,
      "Fls. 4",
      repeatedHeader,
      "Página 5 de 50",
      repeatedHeader,
      "Cláusula 10 - Prazo de entrega: 15 dias úteis.",
    ].join("\n");

    const cleaned = cleanExtractedDocumentText(raw);

    // O cabeçalho repetido 6 vezes fica apenas na 1ª ocorrência
    const headerMatches = cleaned.match(new RegExp(repeatedHeader, "g")) || [];
    expect(headerMatches.length).toBe(1);
    expect(cleaned).not.toMatch(/Página \d+ de 50/);
    expect(cleaned).not.toMatch(/Pág\. 3/);
    expect(cleaned).not.toMatch(/\.{5,}/);
    expect(cleaned).toContain("Item 01 - Notebook Core i7");
    expect(cleaned).toContain("Item 02 - Monitor 24 pol");
    expect(cleaned).toContain("Cláusula 10 - Prazo de entrega: 15 dias úteis.");
  });

  it("compacta edital extenso preservando início, planilha de itens no miolo e anexos finais", () => {
    const inicio = "PREGÃO ELETRÔNICO 099/2026 - UASG 987654 - OBJETO: AQUISIÇÃO DE EQUIPAMENTOS.\n" + "A".repeat(4000);
    const mioloIrrelevante1 = "\n" + "Texto jurídico padrão de minuta sem tabela específica. ".repeat(400);
    const mioloPlanilha =
      "\nTERMO DE REFERÊNCIA - ANEXO I - PLANILHA DE ITENS\n" +
      "Item 1 - Quantidade: 50 - Unidade de medida: UN - Valor unitário: R$ 1.250,00 - Especificações técnicas detalhadas.\n" +
      "Item 2 - Lote 1 - Quantidade: 30 - Valor estimado: R$ 2.300,00 - Habilitação e qualificação técnica com atestado.\n" +
      "Prazo de entrega: 10 dias. Prazo de pagamento: 30 dias. Garantia: 12 meses. Amostra: não exigida.\n";
    const mioloIrrelevante2 = "\n" + "Disposições gerais repetitivas sobre fiscalização contratual. ".repeat(400);
    const fim = "\nANEXO IV - MINUTA FINAL DO CONTRATO E ASSINATURA DO ORDENADOR DE DESPESAS.\n" + "Z".repeat(2000);

    const fullDoc = inicio + mioloIrrelevante1 + mioloPlanilha + mioloIrrelevante2 + fim;
    const result = compactTextForTokenBudget(fullDoc, 18_000, "Edital-Grande.pdf");

    expect(result.compacted).toBe(true);
    expect(result.finalChars).toBeLessThanOrEqual(19_000);
    expect(result.text).toContain("UASG 987654");
    expect(result.text).toContain("PLANILHA DE ITENS");
    expect(result.text).toContain("Item 1 - Quantidade: 50");
    expect(result.text).toContain("ANEXO IV - MINUTA FINAL");
  });

  it("compacta conteúdos Gemini progressivamente sem truncar o prompt curto de instruções", () => {
    const bigAttachment =
      "EDITAL COMPLETO\n" +
      "Item 1 - Quantidade: 10 - Valor unitário: R$ 500,00\n" +
      "Cláusula padrão de contrato administrativo. ".repeat(3000);
    const shortPrompt = "Analise o edital acima e retorne JSON estruturado com todos os campos.";

    const contents = [
      {
        role: "user",
        parts: [{ text: bigAttachment }, { text: shortPrompt }],
      },
    ];

    const step1 = compactGeminiContentsForBudget(contents, 45_000);
    expect(step1.didCompact).toBe(true);
    expect(step1.contents[0].parts[1].text).toBe(shortPrompt);
    expect(step1.contents[0].parts[0].text.length).toBeLessThan(bigAttachment.length);

    const step2 = compactGeminiContentsForBudget(step1.contents, 20_000);
    expect(step2.didCompact).toBe(true);
    expect(step2.contents[0].parts[0].text.length).toBeLessThan(step1.contents[0].parts[0].text.length);
    expect(step2.contents[0].parts[1].text).toBe(shortPrompt);
  });

  it("extrai texto real de um PDF digital usando unpdf no servidor Node", async () => {
    const doc = new jsPDF();
    doc.text("PREGAO ELETRONICO 123/2026 - UASG 153001", 10, 20);
    doc.text("Item 01 - Projetor Multimidia 4000 Lumens - Qtd 8", 10, 35);
    const pdfArrayBuffer = doc.output("arraybuffer");
    const pdfBuffer = Buffer.from(pdfArrayBuffer);

    const extracted = await extractPdfTextFromBuffer(pdfBuffer);
    expect(extracted).not.toBeNull();
    expect(extracted!.numpages).toBe(1);
    expect(extracted!.text).toContain("PREGAO ELETRONICO 123/2026");
    expect(extracted!.text).toContain("Projetor Multimidia");
  });
});

describe("classificação de erros de limite de tokens vs cota esgotada", () => {
  it("detecta erros de excesso de tokens/TPM/tamanho e não confunde com limit: 0 ou chave inválida", () => {
    expect(
      isTokenLimitError(new Error("The input token count (1200000) exceeds the maximum number of tokens allowed"))
    ).toBe(true);
    expect(
      isTokenLimitError(
        new Error(
          "429 RESOURCE_EXHAUSTED: Quota exceeded for metric GenerateContentInputTokensPerModelPerMinute-FreeTier"
        )
      )
    ).toBe(true);
    expect(isTokenLimitError(new Error("Request payload size exceeds the limit: 20971520 bytes"))).toBe(true);
    expect(isTokenLimitError(new Error("maximum context length exceeded (context_length_exceeded)"))).toBe(true);

    // Não deve classificar cota gratuita zero nem chave inválida como excesso de tokens
    expect(isTokenLimitError(new Error("Quota exceeded for metric ... limit: 0"))).toBe(false);
    expect(isTokenLimitError(new Error("403 API_KEY_INVALID"))).toBe(false);
    expect(isTokenLimitError(new Error("429 RESOURCE_EXHAUSTED: RequestsPerMinute"))).toBe(false);
  });

  it("formatAiError orienta corretamente para limite de tokens, limit: 0 e 429 genérico", () => {
    const tokenErr = formatAiError(
      new Error("429 RESOURCE_EXHAUSTED: GenerateContentInputTokensPerModelPerMinute-FreeTier")
    );
    expect(tokenErr.toLowerCase()).toContain("limite de tokens");
    expect(tokenErr.toLowerCase()).not.toContain("cota excedida");

    const zeroQuotaErr = formatAiError(new Error("429 RESOURCE_EXHAUSTED: limit: 0"));
    expect(zeroQuotaErr).toContain("limit: 0");

    const rpmErr = formatAiError(new Error("429 RESOURCE_EXHAUSTED: RequestsPerMinute"));
    expect(rpmErr.toLowerCase()).toContain("cota excedida");
  });
});
