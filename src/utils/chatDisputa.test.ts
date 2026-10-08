import { describe, it, expect } from "vitest";
import { DisputaRow } from "../types";
import {
  EVENTO_CHAT_DISPUTA,
  idSessaoDaDisputa,
  ehSessaoDeDisputa,
  tituloSessaoDaDisputa,
  resumoDisputaParaChat,
  criarSessaoDaDisputa,
} from "./chatDisputa";

const AGORA = new Date(2026, 9, 8, 14, 30);

function disputa(parcial: Partial<DisputaRow> = {}): DisputaRow {
  return {
    id: "d1",
    orgao: "Prefeitura de Exemplo",
    uasgUndCompradora: "986531",
    numeroLicitacao: "PE 45/2026",
    portal: "Compras.gov.br",
    produtoItem: "Notebooks 16GB",
    quantidade: 10,
    unidadeMedida: "Unidade",
    valorEstimadoItem: 50000,
    nossoValorAlvo: 45000,
    valorMinimoPiso: 40000,
    dataHoraDisputa: "2026-11-20 09:30",
    status: "Agendada",
    observacoes: "Cliente avisou por telefone",
    linkPNCP: "https://pncp.gov.br/app/editais/1/2026/1",
    ...parcial,
  };
}

describe("idSessaoDaDisputa", () => {
  it("deriva o id da conversa do id da disputa", () => {
    // É isto que faz o segundo clique reabrir a mesma conversa em vez de criar
    // outra — o componente já acumulou canais vazios por id com Date.now().
    expect(idSessaoDaDisputa("abc")).toBe("chat-disputa-abc");
    expect(idSessaoDaDisputa("abc")).toBe(idSessaoDaDisputa("abc"));
  });

  it("reconhece a conversa de disputa pelo id", () => {
    expect(ehSessaoDeDisputa(idSessaoDaDisputa("abc"))).toBe(true);
    expect(ehSessaoDeDisputa("chat-default")).toBe(false);
    expect(ehSessaoDeDisputa("")).toBe(false);
  });
});

describe("tituloSessaoDaDisputa", () => {
  it("usa número do pregão e órgão", () => {
    expect(tituloSessaoDaDisputa(disputa())).toBe("Disputa: PE 45/2026 — Prefeitura de Exemplo");
  });

  it("cai para o objeto quando não há número nem órgão", () => {
    const t = tituloSessaoDaDisputa(disputa({ numeroLicitacao: "", orgao: "", produtoItem: "Notebooks" }));
    expect(t).toBe("Disputa: Notebooks");
  });

  it("tem saída utilizável mesmo com a linha vazia", () => {
    expect(tituloSessaoDaDisputa(disputa({ numeroLicitacao: "", orgao: "", produtoItem: "" }))).toBe(
      "Disputa sem identificação",
    );
  });

  it("corta título muito longo, para não estourar a lista de canais", () => {
    const t = tituloSessaoDaDisputa(disputa({ orgao: "Ó".repeat(200) }));
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t.endsWith("…")).toBe(true);
  });
});

describe("resumoDisputaParaChat", () => {
  it("leva os dados reais da linha", () => {
    const texto = resumoDisputaParaChat(disputa());
    expect(texto).toContain("Prefeitura de Exemplo");
    expect(texto).toContain("PE 45/2026");
    expect(texto).toContain("986531");
    expect(texto).toContain("Notebooks 16GB");
    expect(texto).toContain("2026-11-20 09:30");
    expect(texto).toContain("Cliente avisou por telefone");
    expect(texto).toContain("https://pncp.gov.br/app/editais/1/2026/1");
  });

  it("formata os valores em reais", () => {
    const texto = resumoDisputaParaChat(disputa());
    expect(texto).toMatch(/R\$\s?50\.000,00/);
    expect(texto).toMatch(/R\$\s?45\.000,00/);
    expect(texto).toMatch(/R\$\s?40\.000,00/);
  });

  it("omite campo vazio em vez de escrever 'não informado'", () => {
    // Listar lacunas gasta contexto e convida a IA a preenchê-las sozinha.
    const texto = resumoDisputaParaChat(
      disputa({ observacoes: "", linkPNCP: "", uasgUndCompradora: "", portal: "" }),
    );
    expect(texto).not.toContain("Anotações");
    expect(texto).not.toContain("Link do edital");
    expect(texto).not.toContain("UASG");
    expect(texto).not.toContain("Portal");
    expect(texto).not.toMatch(/não informado/i);
  });

  it("omite valor zerado", () => {
    const texto = resumoDisputaParaChat(
      disputa({ valorEstimadoItem: 0, nossoValorAlvo: 0, valorMinimoPiso: 0, quantidade: 0 }),
    );
    // Mira o rótulo do campo: a palavra "piso" também aparece na frase final
    // que oferece ajuda com estratégia de lance.
    expect(texto).not.toContain("**Valor estimado:**");
    expect(texto).not.toContain("**Nosso lance alvo:**");
    expect(texto).not.toContain("**Nosso piso");
    expect(texto).not.toContain("**Quantidade:**");
  });

  it("avisa que o edital NÃO foi lido", () => {
    // Sem este aviso a IA concluiria exigências de habilitação a partir de uma
    // linha de planilha — o mesmo erro que já existiu no encaminhamento do Radar.
    const texto = resumoDisputaParaChat(disputa());
    expect(texto).toContain("não li o edital desta disputa");
    expect(texto).toMatch(/anexe o edital|Análise de Edital/);
  });

  it("não quebra com a linha toda vazia", () => {
    const vazia = disputa({
      orgao: "", numeroLicitacao: "", uasgUndCompradora: "", portal: "", produtoItem: "",
      quantidade: 0, valorEstimadoItem: 0, nossoValorAlvo: 0, valorMinimoPiso: 0,
      dataHoraDisputa: "", status: "", observacoes: "", linkPNCP: "",
    });
    const texto = resumoDisputaParaChat(vazia);
    expect(texto).toContain("sem dados preenchidos");
    expect(texto).toContain("não li o edital desta disputa");
  });
});

describe("criarSessaoDaDisputa", () => {
  it("monta a sessão com id estável, título e mensagem de contexto", () => {
    const sessao = criarSessaoDaDisputa(disputa(), AGORA);

    expect(sessao.id).toBe("chat-disputa-d1");
    expect(sessao.title).toBe("Disputa: PE 45/2026 — Prefeitura de Exemplo");
    expect(sessao.messages).toHaveLength(1);
    expect(sessao.messages[0].role).toBe("assistant");
    expect(sessao.messages[0].content).toContain("PE 45/2026");
    // Não aponta para edital nenhum: a conversa nasce dos dados da planilha.
    expect(sessao.selectedEditalId).toBe("");
  });

  it("duas chamadas para a mesma disputa produzem o mesmo id", () => {
    expect(criarSessaoDaDisputa(disputa(), AGORA).id).toBe(criarSessaoDaDisputa(disputa(), AGORA).id);
  });
});

describe("EVENTO_CHAT_DISPUTA", () => {
  it("segue a convenção aip_ do resto da plataforma", () => {
    expect(EVENTO_CHAT_DISPUTA).toBe("aip_abrir_chat_disputa");
  });
});
