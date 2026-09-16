import { describe, it, expect } from "vitest";
import { Certificate } from "../types";
import {
  classificarDocumento,
  montarChecklistHabilitacao,
  normalizarTexto,
  parseDataSessao,
  checklistParaTexto,
} from "./habilitacao";

// Data fixa em todos os testes: o checklist responde "estarei habilitado no dia
// da sessão?", então o resultado depende de "hoje" e não pode variar com o
// relógio de quem roda a suíte.
const HOJE = new Date(2026, 2, 1, 10, 0, 0); // 01/03/2026

function cert(parcial: Partial<Certificate> & { name: string }): Certificate {
  return {
    id: parcial.name,
    emissionDate: "",
    expirationDate: "",
    status: "valid",
    fileUploaded: true,
    ...parcial,
  } as Certificate;
}

function edital(documentosExigidos: string[], dataHoraSessao?: string) {
  return {
    documentosExigidos,
    identificacaoCertame: dataHoraSessao
      ? {
          orgaoComprador: "",
          modalidade: "",
          identificacaoNumerica: "",
          dataHoraSessao,
        }
      : undefined,
  };
}

describe("normalizarTexto", () => {
  it("remove acento, caixa e pontuação", () => {
    expect(normalizarTexto("Certidão Negativa - FALÊNCIA/Concordata")).toBe(
      "certidao negativa falencia concordata",
    );
  });
});

describe("classificarDocumento", () => {
  it("reconhece o jargão do edital, não só o nome curto da certidão", () => {
    // É exatamente o caso que a comparação por `includes` de nomes errava.
    expect(classificarDocumento("Prova de regularidade para com a Fazenda Nacional")?.chave).toBe("federal");
    expect(classificarDocumento("CND Receita Federal e INSS")?.chave).toBe("federal");
  });

  it("não confunde certidão de falência com certidão de tributos", () => {
    expect(classificarDocumento("Certidão Negativa de Falência e Concordata")?.chave).toBe("falencia");
  });

  it("separa inscrição municipal de CND municipal", () => {
    expect(classificarDocumento("Inscrição Municipal")?.chave).toBe("inscricao-municipal");
    expect(classificarDocumento("Prova de regularidade com a Fazenda Municipal")?.chave).toBe("municipal");
  });

  it("classifica FGTS e CNDT", () => {
    expect(classificarDocumento("Certificado de Regularidade do FGTS")?.chave).toBe("fgts");
    expect(classificarDocumento("Certidão Negativa de Débitos Trabalhistas")?.chave).toBe("trabalhista");
  });

  it("identifica declarações que a própria plataforma emite", () => {
    expect(classificarDocumento("Declaração de que não emprega menor de 18 anos")?.origem).toBe("declaracao");
    expect(classificarDocumento("Declaração de elaboração independente de proposta")?.chave).toBe(
      "decl-proposta-independente",
    );
  });

  it("devolve null para exigência fora do catálogo", () => {
    expect(classificarDocumento("Catálogo técnico do fabricante em português")).toBeNull();
  });
});

describe("parseDataSessao", () => {
  it("lê os formatos que a IA devolve", () => {
    expect(parseDataSessao("15/03/2026 às 09:00")?.getTime()).toBe(new Date(2026, 2, 15, 9, 0).getTime());
    expect(parseDataSessao("2026-03-15T09:00")?.getTime()).toBe(new Date(2026, 2, 15, 9, 0).getTime());
    expect(parseDataSessao("15 de março de 2026")?.getTime()).toBe(new Date(2026, 2, 15).getTime());
  });

  it("devolve null quando não há data legível", () => {
    expect(parseDataSessao("a ser definida")).toBeNull();
    expect(parseDataSessao("")).toBeNull();
  });
});

describe("montarChecklistHabilitacao", () => {
  it("marca como coberta a certidão válida além da data da sessão", () => {
    const r = montarChecklistHabilitacao(
      edital(["Prova de regularidade para com a Fazenda Nacional"], "15/03/2026 09:00"),
      [cert({ name: "CND Receita Federal e INSS", expirationDate: "2026-06-30" })],
      HOJE,
    );

    expect(r.itens[0].situacao).toBe("coberta");
    expect(r.itens[0].bloqueante).toBe(false);
    expect(r.score).toBe(100);
    expect(r.bloqueantes).toBe(0);
  });

  it("acusa a certidão que vence entre hoje e a sessão", () => {
    // O caso que desclassifica empresa preparada: hoje a certidão está válida,
    // e o portfólio a mostra verde, mas ela não chega viva na disputa.
    const r = montarChecklistHabilitacao(
      edital(["Prova de regularidade para com a Fazenda Nacional"], "15/03/2026 09:00"),
      [cert({ name: "CND Receita Federal e INSS", expirationDate: "2026-03-10" })],
      HOJE,
    );

    expect(r.itens[0].situacao).toBe("vence_antes");
    expect(r.itens[0].bloqueante).toBe(true);
    expect(r.itens[0].detalhe).toContain("antes da sessão");
    expect(r.bloqueantes).toBe(1);
  });

  it("não acusa vencimento antecipado quando a sessão não tem data legível", () => {
    const r = montarChecklistHabilitacao(
      edital(["Prova de regularidade para com a Fazenda Nacional"], "a definir"),
      [cert({ name: "CND Receita Federal e INSS", expirationDate: "2026-03-10" })],
      HOJE,
    );

    expect(r.dataSessao).toBeNull();
    expect(r.itens[0].situacao).toBe("coberta");
  });

  it("trata certidão vencida como bloqueio", () => {
    const r = montarChecklistHabilitacao(
      edital(["Certificado de Regularidade do FGTS"], "15/03/2026"),
      [cert({ name: "CND FGTS", expirationDate: "2026-02-01" })],
      HOJE,
    );

    expect(r.itens[0].situacao).toBe("vencida");
    expect(r.itens[0].bloqueante).toBe(true);
  });

  it("cobra o arquivo quando a certidão está cadastrada mas nada foi enviado", () => {
    const r = montarChecklistHabilitacao(
      edital(["Certificado de Regularidade do FGTS"]),
      [cert({ name: "CND FGTS", expirationDate: "2026-12-01", fileUploaded: false })],
      HOJE,
    );

    expect(r.itens[0].situacao).toBe("sem_arquivo");
    expect(r.itens[0].bloqueante).toBe(true);
  });

  it("bloqueia quando o arquivo enviado não confere com a linha", () => {
    const r = montarChecklistHabilitacao(
      edital(["Certificado de Regularidade do FGTS"]),
      [
        cert({
          name: "CND FGTS",
          expirationDate: "2026-12-01",
          documentMatchesRow: false,
          validationFeedback: "o PDF enviado é uma CND estadual",
        }),
      ],
      HOJE,
    );

    expect(r.itens[0].situacao).toBe("sem_arquivo");
    expect(r.itens[0].bloqueante).toBe(true);
    expect(r.itens[0].detalhe).toContain("CND estadual");
  });

  it("não bloqueia por declaração que a plataforma emite por disputa", () => {
    const r = montarChecklistHabilitacao(
      edital(["Declaração de que não emprega menor de 18 anos"]),
      [],
      HOJE,
    );

    expect(r.itens[0].situacao).toBe("a_gerar");
    expect(r.itens[0].bloqueante).toBe(false);
    expect(r.itens[0].detalhe).toContain("Criar Documentos");
  });

  it("aponta exigência sem nada equivalente no portfólio", () => {
    const r = montarChecklistHabilitacao(
      edital(["Certidão Negativa de Falência e Concordata"]),
      [cert({ name: "CND FGTS", expirationDate: "2026-12-01" })],
      HOJE,
    );

    expect(r.itens[0].situacao).toBe("nao_cadastrada");
    expect(r.itens[0].bloqueante).toBe(true);
  });

  it("casa exigência fora do catálogo por semelhança de nome", () => {
    const r = montarChecklistHabilitacao(
      edital(["Apresentar catálogo técnico do fabricante"]),
      [cert({ name: "Catálogo técnico fabricante", expirationDate: "2026-12-01" })],
      HOJE,
    );

    expect(r.itens[0].situacao).toBe("coberta");
    expect(r.itens[0].certificado?.name).toBe("Catálogo técnico fabricante");
  });

  it("escolhe a certidão renovada quando há duas da mesma categoria", () => {
    const r = montarChecklistHabilitacao(
      edital(["Prova de regularidade para com a Fazenda Nacional"], "15/03/2026"),
      [
        cert({ id: "velha", name: "CND Receita Federal e INSS", expirationDate: "2026-02-01" }),
        cert({ id: "nova", name: "CND Receita Federal", expirationDate: "2026-09-01" }),
      ],
      HOJE,
    );

    expect(r.itens[0].certificado?.id).toBe("nova");
    expect(r.itens[0].situacao).toBe("coberta");
  });

  it("prefere a certidão com arquivo enviado à de validade maior sem arquivo", () => {
    const r = montarChecklistHabilitacao(
      edital(["Certificado de Regularidade do FGTS"]),
      [
        cert({ id: "sem-arquivo", name: "CND FGTS", expirationDate: "2027-01-01", fileUploaded: false }),
        cert({ id: "com-arquivo", name: "CRF FGTS", expirationDate: "2026-08-01" }),
      ],
      HOJE,
    );

    expect(r.itens[0].certificado?.id).toBe("com-arquivo");
  });

  it("calcula o placar sobre o total de exigências", () => {
    const r = montarChecklistHabilitacao(
      edital([
        "Prova de regularidade para com a Fazenda Nacional",
        "Certificado de Regularidade do FGTS",
        "Certidão Negativa de Débitos Trabalhistas",
        "Certidão Negativa de Falência",
      ]),
      [
        cert({ name: "CND Receita Federal", expirationDate: "2026-09-01" }),
        cert({ name: "CND FGTS", expirationDate: "2026-09-01" }),
      ],
      HOJE,
    );

    expect(r.totalExigencias).toBe(4);
    expect(r.cobertas).toBe(2);
    expect(r.score).toBe(50);
    expect(r.bloqueantes).toBe(2);
  });

  it("avisa sobre certidão vencida do portfólio que o edital nem pediu", () => {
    const r = montarChecklistHabilitacao(
      edital(["Certificado de Regularidade do FGTS"]),
      [
        cert({ name: "CND FGTS", expirationDate: "2026-09-01" }),
        cert({ name: "CND Trabalhista", expirationDate: "2026-01-15" }),
      ],
      HOJE,
    );

    expect(r.alertasPortfolio).toHaveLength(1);
    expect(r.alertasPortfolio[0]).toContain("CND Trabalhista");
  });

  it("aguenta edital sem análise e sem exigências", () => {
    const r = montarChecklistHabilitacao(null, [], HOJE);
    expect(r.totalExigencias).toBe(0);
    expect(r.score).toBe(0);
    expect(r.itens).toEqual([]);
  });

  it("descarta exigências em branco vindas da IA", () => {
    const r = montarChecklistHabilitacao(edital(["", "   ", "CND FGTS"]), [], HOJE);
    expect(r.totalExigencias).toBe(1);
  });
});

describe("checklistParaTexto", () => {
  it("gera um resumo colável com situação de cada exigência", () => {
    const r = montarChecklistHabilitacao(
      edital(["Certificado de Regularidade do FGTS"], "15/03/2026 09:00"),
      [cert({ name: "CND FGTS", expirationDate: "2026-02-01" })],
      HOJE,
    );

    const texto = checklistParaTexto(r, "PE 45/2026");
    expect(texto).toContain("PE 45/2026");
    expect(texto).toContain("[VENCIDA]");
    expect(texto).toContain("CND FGTS");
  });
});
