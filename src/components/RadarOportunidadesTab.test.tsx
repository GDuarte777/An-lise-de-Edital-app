// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const pncpMock = vi.hoisted(() => ({
  contratacoes: [
    {
      idContratacaoPNCP: "00394460000141-1-000123/2026",
      numeroControlePNCP: "00394460000141-1-000123/2026",
      cnpjOrgao: "00394460000141",
      anoCompra: 2026,
      sequencialCompra: 123,
      numeroCompra: "123",
      tituloDocumento: "Edital nº 123/2026",
      orgaoEntidade: { razaoSocial: "Prefeitura Teste", cnpj: "00394460000141" },
      unidadeOrgao: { ufSigla: "SP", municipioNome: "São Paulo", nomeUnidade: "Secretaria de Compras", codigoUnidade: "987654" },
      objetoCompra: "Aquisição de equipamentos de informática",
      valorTotalEstimado: 150000,
      modalidadeNome: "Pregão Eletrônico",
      situacaoCompraNome: "Divulgada no PNCP",
    },
  ],
  arquivos: [
    {
      sequencialDocumento: 1,
      titulo: "Edital_123_2026.pdf",
      tipo: "Edital",
      uri: "https://pncp.gov.br/api/pncp/v1/orgaos/00394460000141/compras/2026/123/arquivos/1",
    },
    {
      sequencialDocumento: 2,
      titulo: "Termo_Referencia.pdf",
      tipo: "Termo de Referência",
      uri: "https://pncp.gov.br/api/pncp/v1/orgaos/00394460000141/compras/2026/123/arquivos/2",
    },
    {
      sequencialDocumento: 3,
      titulo: "Planta_Anexo_III.pdf",
      tipo: "Anexo",
      uri: "https://pncp.gov.br/api/pncp/v1/orgaos/00394460000141/compras/2026/123/arquivos/3",
    },
  ],
  baixados: [] as string[],
  chamadasBusca: [] as any[],
}));

vi.mock("../utils/pncpClient", () => ({
  buscarContratacoesPncp: vi.fn(async (params: any) => {
    pncpMock.chamadasBusca.push(params);
    return {
      data: pncpMock.contratacoes,
      totalRegistros: pncpMock.contratacoes.length,
      totalPaginas: 1,
      numeroPagina: 1,
      resultadoParcial: false,
      avisosPNCP: [],
      source: "pncp_api_real",
    };
  }),
  enriquecerPrecosEmSegundoPlano: vi.fn(async () => {}),
  listarArquivosPncp: vi.fn(async () => pncpMock.arquivos),
  listarItensCompraPncp: vi.fn(async () => []),
  baixarArquivoPncpComoBase64: vi.fn(async (arq: { uri: string; titulo?: string }) => {
    pncpMock.baixados.push(arq.titulo || arq.uri);
    return {
      id: `doc-${arq.titulo}`,
      name: arq.titulo || "Documento.pdf",
      size: "120.0 KB",
      type: "application/pdf",
      base64: "JVBERi0xLjQK",
    };
  }),
}));

import RadarOportunidadesTab from "./RadarOportunidadesTab";

beforeEach(() => {
  pncpMock.baixados = [];
  pncpMock.chamadasBusca = [];
  delete (window as any).__aipPendingEdital;
  (window as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
});

async function abrirModalDetalhes(onSelectForAnalysis = vi.fn()) {
  render(<RadarOportunidadesTab onSelectForAnalysis={onSelectForAnalysis} />);
  const verDetalhesBtn = await screen.findByRole("button", { name: /Ver detalhes/i });
  fireEvent.click(verDetalhesBtn);
  await screen.findByText("Edital_123_2026.pdf");
  return { onSelectForAnalysis };
}

describe("RadarOportunidadesTab — seleção de documentos do edital para análise com IA", () => {
  it("mantém todos os documentos marcados por padrão ao abrir os detalhes", async () => {
    await abrirModalDetalhes();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    for (const cb of checkboxes) {
      expect(cb.getAttribute("data-state")).toBe("checked");
    }

    expect(screen.getByText("3 de 3 selecionados")).toBeTruthy();
    const footerBtn = screen.getByRole("button", {
      name: /Analisar todos os 3 documentos \+ Itens com IA/i,
    });
    expect((footerBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("baixa e envia apenas os documentos selecionados quando o usuário desmarca anexos", async () => {
    const onSelect = vi.fn();
    await abrirModalDetalhes(onSelect);

    const anexoCb = screen.getByRole("checkbox", {
      name: /Selecionar Planta_Anexo_III\.pdf para análise com IA/i,
    });
    fireEvent.click(anexoCb);

    expect(anexoCb.getAttribute("data-state")).toBe("unchecked");
    expect(screen.getByText("2 de 3 selecionados")).toBeTruthy();

    const footerBtn = screen.getByRole("button", {
      name: /Analisar 2 de 3 documentos \+ Itens com IA/i,
    });
    fireEvent.click(footerBtn);

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    expect(pncpMock.baixados).toEqual(["Edital_123_2026.pdf", "Termo_Referencia.pdf"]);
    const pending = (window as any).__aipPendingEdital;
    expect(pending.numeroControlePNCP).toBe("00394460000141-1-000123/2026");
    expect(pending.files.map((f: any) => f.name)).toEqual([
      "Edital_123_2026.pdf",
      "Termo_Referencia.pdf",
    ]);
  });

  it("desabilita o botão do rodapé quando todos os documentos são desmarcados e reabilita ao marcar novamente", async () => {
    await abrirModalDetalhes();

    fireEvent.click(screen.getByRole("button", { name: /Desmarcar todos/i }));

    expect(screen.getByText("0 de 3 selecionados")).toBeTruthy();
    const disabledBtn = screen.getByRole("button", {
      name: /Selecione ao menos 1 documento acima/i,
    });
    expect((disabledBtn as HTMLButtonElement).disabled).toBe(true);

    // Re-seleciona todos pelo atalho
    fireEvent.click(screen.getByRole("button", { name: /Selecionar todos/i }));
    expect(screen.getByText("3 de 3 selecionados")).toBeTruthy();
    const enabledBtn = screen.getByRole("button", {
      name: /Analisar todos os 3 documentos \+ Itens com IA/i,
    });
    expect((enabledBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("preserva o botão individual 'Analisar com IA' de cada card mesmo com outros documentos desmarcados", async () => {
    const onSelect = vi.fn();
    await abrirModalDetalhes(onSelect);

    fireEvent.click(screen.getByRole("button", { name: /Desmarcar todos/i }));

    // Os 3 cards continuam exibindo o botão individual "Analisar com IA"
    const individualButtons = screen.getAllByRole("button", { name: /^Analisar com IA$/i });
    expect(individualButtons.length).toBeGreaterThanOrEqual(3);

    // Clica no último botão individual dentro do modal (Planta_Anexo_III.pdf)
    fireEvent.click(individualButtons[individualButtons.length - 1]);

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    expect(pncpMock.baixados).toEqual(["Planta_Anexo_III.pdf"]);
    expect((window as any).__aipPendingEdital.files.map((f: any) => f.name)).toEqual([
      "Planta_Anexo_III.pdf",
    ]);
  });
});

describe("RadarOportunidadesTab — filtros por estado e demais controles", () => {
  it("aguarda clicar em Concluir para buscar múltiplos estados e aceita busca sem acento", async () => {
    render(<RadarOportunidadesTab onSelectForAnalysis={vi.fn()} />);
    await waitFor(() => expect(pncpMock.chamadasBusca).toHaveLength(1));

    // Abre o seletor de Estados / UFs
    fireEvent.click(screen.getByRole("button", { name: /Brasil Inteiro \(Todos os 27 Estados\)/i }));

    // Busca sem acento ("Sao Paulo" encontra "São Paulo")
    const buscaUf = screen.getByPlaceholderText(/Buscar estado/i);
    fireEvent.change(buscaUf, { target: { value: "Sao Paulo" } });
    const btnSp = screen.getByRole("button", { name: /SP.*São Paulo/i });
    fireEvent.click(btnSp);

    // Seleciona também Minas Gerais sem disparar busca prematura
    fireEvent.change(buscaUf, { target: { value: "Minas" } });
    fireEvent.click(screen.getByRole("button", { name: /MG.*Minas Gerais/i }));
    expect(pncpMock.chamadasBusca).toHaveLength(1);

    // Só dispara ao clicar em Concluir
    fireEvent.click(screen.getByRole("button", { name: /^Concluir$/i }));
    await waitFor(() => expect(pncpMock.chamadasBusca).toHaveLength(2));
    expect(pncpMock.chamadasBusca[1].ufs).toEqual(["SP", "MG"]);
  });

  it("fecha o seletor de Fontes ao abrir Estados e limpa todos os filtros sem dados antigos", async () => {
    render(<RadarOportunidadesTab onSelectForAnalysis={vi.fn()} />);
    await waitFor(() => expect(pncpMock.chamadasBusca).toHaveLength(1));

    // Preenche palavra-chave e cidade
    const kwInput = screen.getByPlaceholderText(/Notebook, Medicamento/i);
    const cityInput = screen.getByPlaceholderText(/Mauá, Salvador/i);
    fireEvent.change(kwInput, { target: { value: "Notebook" } });
    fireEvent.change(cityInput, { target: { value: "Sao Paulo" } });

    // Abre Fontes e depois abre Estados -> Fontes deve fechar automaticamente
    fireEvent.click(screen.getByRole("button", { name: /Todas as Fontes/i }));
    expect(screen.getByPlaceholderText(/Buscar plataforma/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Brasil Inteiro/i }));
    expect(screen.queryByPlaceholderText(/Buscar plataforma/i)).toBeNull();
    expect(screen.getByPlaceholderText(/Buscar estado/i)).toBeTruthy();

    // Seleciona RJ e clica em Limpar Filtros -> deve enviar filtros realmente vazios
    fireEvent.click(screen.getByRole("button", { name: /RJ.*Rio de Janeiro/i }));
    fireEvent.click(screen.getByRole("button", { name: /Limpar Filtros/i }));

    await waitFor(() => expect(pncpMock.chamadasBusca).toHaveLength(2));
    const ultimaBusca = pncpMock.chamadasBusca[1];
    expect(ultimaBusca.q).toBeUndefined();
    expect(ultimaBusca.municipio).toBeUndefined();
    expect(ultimaBusca.ufs).toEqual([]);
    expect(ultimaBusca.modalidades).toEqual([]);
    expect(ultimaBusca.fontes).toEqual([]);
  });
});
