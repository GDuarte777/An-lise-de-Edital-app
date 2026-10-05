// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// A aba só existe para configurar o piso de margem, e o piso de margem é a
// única coisa entre o robô e um prejuízo real. O que está sob verificação aqui
// é que a tela monta, que o aviso de item sem piso aparece e que o token
// gerado chega à tela — não a camada de rede, que fica dublada.

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
    gerarToken: (...args: any[]) => gerarToken(...(args as [])),
    salvarRobo: vi.fn(async () => ({ sucesso: true, mensagem: "Robô salvo." })),
    salvarItens: vi.fn(async () => ({ sucesso: true, mensagem: "2 item(ns) salvo(s)." })),
    excluirRobo: vi.fn(async () => true),
    excluirItem: vi.fn(async () => true),
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
  it("monta e lista os robôs da conta", async () => {
    render(<LanceBotTab />);
    expect(await screen.findByText("Pregão 90012/2026")).toBeTruthy();
    expect(screen.getByDisplayValue("6a28b2eedb287c0541e5e303")).toBeTruthy();
  });

  it("avisa quando um item marcado para participar não tem piso de margem", async () => {
    render(<LanceBotTab />);
    fireEvent.click(await screen.findByText("Pregão 90012/2026"));

    const aviso = await screen.findByText(/sem piso de margem/i);
    expect(aviso.textContent).toMatch(/1 item/);
    // O item com piso não pode entrar na conta.
    expect(aviso.textContent).not.toMatch(/2 item/);
  });

  it("mostra o token gerado para ser copiado", async () => {
    render(<LanceBotTab />);
    fireEvent.click(await screen.findByRole("button", { name: /gerar token/i }));

    await waitFor(() => expect(screen.getByDisplayValue("hzr_tokenDeTeste123")).toBeTruthy());
    expect(gerarToken).toHaveBeenCalledTimes(1);
    // O aviso de que o valor não volta precisa estar junto do token.
    expect(screen.getByText(/não aparece de novo/i)).toBeTruthy();
  });
});
