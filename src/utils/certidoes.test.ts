import { describe, it, expect } from "vitest";
import {
  estadoArquivoCertidao,
  explicacaoArquivoIndisponivel,
  validarFormularioCertidao,
  formularioCertidaoValido,
  previaVencimento,
} from "./certidoes";

const HOJE = new Date(2026, 8, 20); // 20/09/2026

describe("estadoArquivoCertidao", () => {
  it("é baixável quando o conteúdo está guardado", () => {
    expect(estadoArquivoCertidao({ fileUploaded: true, fileBase64: "QUJD" })).toBe("baixavel");
  });

  it("acusa 'sem conteúdo' quando foi marcada como enviada mas não há arquivo", () => {
    // É o caso que ficava invisível: nem botão de baixar, nem explicação. São
    // os anexos enviados antes de a plataforma passar a armazenar o documento.
    expect(estadoArquivoCertidao({ fileUploaded: true, fileBase64: undefined })).toBe("sem_conteudo");
    expect(estadoArquivoCertidao({ fileUploaded: true, fileBase64: "" })).toBe("sem_conteudo");
  });

  it("é 'sem arquivo' quando nada foi enviado", () => {
    expect(estadoArquivoCertidao({ fileUploaded: false, fileBase64: undefined })).toBe("sem_arquivo");
    expect(estadoArquivoCertidao({} as any)).toBe("sem_arquivo");
  });

  it("prioriza o conteúdo guardado sobre a marca de enviado", () => {
    // Registro dessincronizado não pode esconder um arquivo que existe.
    expect(estadoArquivoCertidao({ fileUploaded: false, fileBase64: "QUJD" })).toBe("baixavel");
  });
});

describe("explicacaoArquivoIndisponivel", () => {
  it("cita o nome do arquivo quando existe e orienta o reenvio", () => {
    const texto = explicacaoArquivoIndisponivel({ fileName: "cnd-federal.pdf" });
    expect(texto).toContain("cnd-federal.pdf");
    expect(texto).toContain("Reenvie");
  });

  it("funciona sem nome de arquivo", () => {
    expect(explicacaoArquivoIndisponivel({ fileName: undefined })).toContain("Reenvie");
  });
});

describe("validarFormularioCertidao", () => {
  it("aceita um cadastro completo", () => {
    expect(
      validarFormularioCertidao({ name: "CND Federal", emissionDate: "2026-09-01", expirationDate: "2026-12-01" }),
    ).toEqual({});
  });

  it("exige o nome", () => {
    const erros = validarFormularioCertidao({ name: "   ", emissionDate: "", expirationDate: "" });
    expect(erros.name).toBeDefined();
    expect(formularioCertidaoValido({ name: "", emissionDate: "", expirationDate: "" })).toBe(false);
  });

  it("aceita cadastro só com o nome — as datas são opcionais", () => {
    expect(validarFormularioCertidao({ name: "SICAF", emissionDate: "", expirationDate: "" })).toEqual({});
  });

  it("recusa vencimento anterior à emissão", () => {
    const erros = validarFormularioCertidao({
      name: "CND Federal",
      emissionDate: "2026-09-10",
      expirationDate: "2026-09-01",
    });
    expect(erros.expirationDate).toContain("anterior à emissão");
  });

  it("aceita emissão e vencimento no mesmo dia", () => {
    expect(
      validarFormularioCertidao({ name: "X", emissionDate: "2026-09-10", expirationDate: "2026-09-10" }),
    ).toEqual({});
  });

  it("NÃO trata vencimento no passado como erro", () => {
    // Cadastrar uma certidão já vencida para depois renovar é justamente o que
    // o usuário precisa fazer; bloquear isso o obrigaria a mentir a data.
    expect(
      validarFormularioCertidao({ name: "CND Antiga", emissionDate: "2020-01-01", expirationDate: "2020-03-01" }),
    ).toEqual({});
  });

  it("acusa data em formato inválido", () => {
    const erros = validarFormularioCertidao({ name: "X", emissionDate: "01/09/2026", expirationDate: "" });
    expect(erros.emissionDate).toBeDefined();
  });
});

describe("previaVencimento", () => {
  it("descreve certidão com prazo folgado", () => {
    const p = previaVencimento("2026-12-01", HOJE);
    expect(p.tom).toBe("valido");
    expect(p.dias).toBe(72);
    expect(p.texto).toContain("01/12/2026");
  });

  it("marca atenção quando faltam 15 dias ou menos", () => {
    expect(previaVencimento("2026-10-05", HOJE).tom).toBe("atencao");
    expect(previaVencimento("2026-10-05", HOJE).dias).toBe(15);
    // 16 dias já é prazo confortável.
    expect(previaVencimento("2026-10-06", HOJE).tom).toBe("valido");
  });

  it("trata o vencimento de hoje como atenção, não como vencida", () => {
    const p = previaVencimento("2026-09-20", HOJE);
    expect(p.tom).toBe("atencao");
    expect(p.dias).toBe(0);
    expect(p.texto).toContain("hoje");
  });

  it("marca como vencida e diz há quantos dias", () => {
    const p = previaVencimento("2026-09-10", HOJE);
    expect(p.tom).toBe("vencido");
    expect(p.dias).toBe(-10);
    expect(p.texto).toContain("10 dia(s)");
  });

  it("explica o efeito de não informar data", () => {
    const p = previaVencimento("", HOJE);
    expect(p.tom).toBe("neutro");
    expect(p.dias).toBeNull();
    expect(p.texto).toContain("controle de prazos");
  });
});
