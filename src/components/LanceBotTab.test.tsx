// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Nenhum robô se cadastra aqui: ele nasce quando a extensão abre a sala de
// disputa. A aba mostra o que cada disputa produziu e deixa ajustar o piso de
// margem, que é a única coisa entre o robô e um prejuízo real. O que está sob
// verificação é que a tela monta, que o aviso de item sem piso aparece e que o
// token gerado chega à tela — não a camada de rede, que fica dublada.

const robo = {
  id: "pregao-90012-2026",
  title: "Pregão 90012/2026",
  mode: "Automático",
  dispute_type: "por_item",
  item_selection_enabled: true,
  status: "ativo",
  purchase_id: null,
  uasg: "153031",
  numero_compra: "900122026",
  numero_interno: null,
  portal_name: "Comprasnet",
  orgao: null,
  unidade_compradora: null,
  municipio: null,
  uf: null,
  modalidade: null,
  situacao: null,
  data_abertura: null,
  data_encerramento: null,
  link_sistema_origem: null,
  fornecedor_cnpj: null,
  initial_value: 184500,
  minimum_value: null,
  min_reduction: 1,
  max_reduction: 5,
  response_time: 3,
  termos_alerta: [],
};

const itens = [
  {
    robo_id: robo.id,
    numero_item: 1,
    descricao: "Seringa descartável 5ml",
    quantidade: null,
    unidade_medida: null,
    valor_unitario_estimado: null,
    valor_total: null,
    participar: true,
    valor_minimo: 11800,
    lance_manual: null,
    desconto: 50,
    variacao: null,
  },
  {
    // Marcado para participar e sem piso — nem no item, nem no robô.
    robo_id: robo.id,
    numero_item: 2,
    descricao: "Luva de procedimento M",
    quantidade: null,
    unidade_medida: null,
    valor_unitario_estimado: null,
    valor_total: null,
    participar: true,
    valor_minimo: null,
    lance_manual: null,
    desconto: null,
    variacao: null,
  },
];

const gerarToken = vi.fn(async () => "hzr_tokenDeTeste123");

vi.mock("../utils/roboLances", async () => {
  const real = await vi.importActual<typeof import("../utils/roboLances")>("../utils/roboLances");
  return {
    ...real,
    listarRobos: vi.fn(async () => [robo]),
    listarItens: vi.fn(async () => itens),
    listarTokens: vi.fn(async () => []),
    lerPerfil: vi.fn(async () => ({ ...real.PERFIL_PADRAO, app_id: "a1b2c3d4e5f60718293a4b5c6d7e8f90" })),
    salvarPerfil: vi.fn(async (p: any) => p),
    gerarToken: (...args: any[]) => gerarToken(...(args as [])),
    salvarItens: vi.fn(async () => ({ sucesso: true, mensagem: "2 item(ns) salvo(s)." })),
    revogarToken: vi.fn(async () => {}),
  };
});

import LanceBotTab from "./LanceBotTab";

beforeEach(() => {
  gerarToken.mockClear();
  // O Radix usa estes dois e o jsdom não os traz.
  if (!window.matchMedia) {
    (window as any).matchMedia = () => ({
      matches: false, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    });
  }
  (Element.prototype as any).scrollIntoView = () => {};
});

afterEach(cleanup);

describe("aba do robô de lances", () => {
  it("monta e lista as disputas que a extensão abriu", async () => {
    render(<LanceBotTab />);
    expect(await screen.findByText("Pregão 90012/2026")).toBeTruthy();
  });

  it("mostra o App ID da própria conta, não um valor fixo no código", async () => {
    // App ID igual para todos não identifica ninguém: a conferência contra o
    // dono do Token, no backend, passaria a ser inútil.
    render(<LanceBotTab />);
    expect(await screen.findByDisplayValue("a1b2c3d4e5f60718293a4b5c6d7e8f90")).toBeTruthy();
  });

  it("avisa, em vez de mostrar campo vazio, quando o App ID não veio", async () => {
    const { lerPerfil, PERFIL_PADRAO } = await import("../utils/roboLances");
    (lerPerfil as any).mockResolvedValueOnce({ ...PERFIL_PADRAO, app_id: "" });

    render(<LanceBotTab />);
    expect(await screen.findByText(/App ID ainda não foi gerado/i)).toBeTruthy();
  });

  it("não oferece cadastro nem configuração de robô", async () => {
    // O robô nasce na sala de disputa e é configurado no popup da extensão.
    // Qualquer um dos dois aqui traz de volta o passo que se quis eliminar:
    // tirar o operador do navegador onde ele está durante o pregão.
    render(<LanceBotTab />);
    await screen.findByText("Pregão 90012/2026");
    expect(screen.queryByRole("button", { name: /novo rob/i })).toBeNull();
    expect(screen.queryByText(/perfil padrão/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /salvar config/i })).toBeNull();
  });

  it("oferece a extensão para baixar", async () => {
    render(<LanceBotTab />);
    const link = await screen.findByRole("link", { name: /baixar extensão/i });
    expect(link.getAttribute("href")).toBe("/extensao-horasis.zip");
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("mostra os pisos da disputa sem deixar editá-los", async () => {
    // O piso vale no instante do lance, e esse instante acontece no painel.
    // Um campo editável aqui sugeriria duas fontes da verdade.
    render(<LanceBotTab />);
    fireEvent.click(await screen.findByText("Pregão 90012/2026"));

    await screen.findByText(/R\$\s*11\.800,00/);
    expect(screen.queryByRole("button", { name: /^salvar$/i })).toBeNull();
    expect(screen.getByText(/só leitura/i)).toBeTruthy();
  });

  it("avisa quando um item da disputa não tem piso de margem", async () => {
    render(<LanceBotTab />);
    fireEvent.click(await screen.findByText("Pregão 90012/2026"));

    const aviso = await screen.findByText(/sem piso de margem/i);
    expect(aviso.textContent).toMatch(/1 item/);
    // O item com piso não pode entrar na conta.
    expect(aviso.textContent).not.toMatch(/2 item/);
  });

  it("gera o token e já o deixa na área de transferência", async () => {
    // Uma ação só: o valor em claro existe uma única vez, e "gerei, agora
    // copio" é onde alguém fecha a tela com o token na mão sem ter copiado.
    const escrever = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });

    render(<LanceBotTab />);
    fireEvent.click(await screen.findByRole("button", { name: /gerar e copiar token/i }));

    await waitFor(() => expect(screen.getByDisplayValue("hzr_tokenDeTeste123")).toBeTruthy());
    expect(gerarToken).toHaveBeenCalledTimes(1);
    expect(escrever).toHaveBeenCalledWith("hzr_tokenDeTeste123");
    await screen.findByText(/copiado para a área de transferência/i);
    // O aviso de que o valor não volta precisa estar junto do token.
    expect(screen.getByText(/não aparece de novo/i)).toBeTruthy();
  });

  it("não afirma que copiou quando a área de transferência recusa", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => { throw new Error("bloqueado"); } },
      configurable: true,
    });

    render(<LanceBotTab />);
    fireEvent.click(await screen.findByRole("button", { name: /gerar e copiar token/i }));

    // O token continua na tela, com o botão de copiar ao lado.
    await waitFor(() => expect(screen.getByDisplayValue("hzr_tokenDeTeste123")).toBeTruthy());
    expect(screen.queryByText(/copiado para a área de transferência/i)).toBeNull();
    expect(screen.getByText(/Copie o valor acima/i)).toBeTruthy();
  });
});
