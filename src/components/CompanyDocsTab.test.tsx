// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { CompanyData } from "../types";

// A aba conversa com Supabase, IA e confetti. Nada disso existe em teste, e
// nada disso é o que está sob verificação: o alvo aqui é a tela — o botão de
// baixar aparecer para TODA certidão enviada, e a criação/edição abrir em
// popup.
// A aba trata o Supabase como fonte da verdade e sobrescreve o cache local
// com o que vier do banco. Por isso as duas fontes precisam contar a mesma
// história no teste, senão o efeito de sincronização apaga o que semeamos.
const estadoBanco = vi.hoisted(() => ({ linhas: [] as any[] }));

vi.mock("../utils/supabaseClient", () => ({
  fetchCertificatesFromSupabase: vi.fn(async () => estadoBanco.linhas),
  saveCertificateToSupabase: vi.fn(async () => ({ success: true, message: "ok" })),
  deleteCertificateFromSupabase: vi.fn(async () => true),
  subscribeToSupabaseTable: vi.fn(() => () => {}),
}));

vi.mock("../utils/aiClientHelper", () => ({
  getActiveAiConfig: vi.fn(() => ({})),
  apiFetch: vi.fn(async () => ({ ok: false, json: async () => ({}) })),
  prepareAttachmentForServer: vi.fn(async (a: any) => a),
  formatAiError: vi.fn((e: any) => String(e)),
  readJsonResponse: vi.fn(async () => ({})),
}));

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

import CompanyDocsTab from "./CompanyDocsTab";

const EMPRESA: CompanyData = {
  razonSocial: "Empresa Teste",
  cnpj: "12.345.678/0001-90",
  address: "",
  phone: "",
  email: "",
  representativeName: "",
  representativeCpf: "",
  bankDetails: "",
};

function renderizar() {
  return render(<CompanyDocsTab companyData={EMPRESA} setCompanyData={vi.fn()} activeEdital={null} />);
}

beforeEach(() => {
  localStorage.clear();
  estadoBanco.linhas = [];
  // Radix usa estas APIs, que o jsdom não implementa.
  (window as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (!window.matchMedia) {
    (window as any).matchMedia = () => ({
      matches: false,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    });
  }
  (Element.prototype as any).scrollIntoView = () => {};
  (window as any).HTMLElement.prototype.hasPointerCapture = () => false;
});

afterEach(() => {
  cleanup();
});

/** Semeia as duas fontes que a aba consulta: cache local e banco. */
function semearCertidoes(certs: any[]) {
  localStorage.setItem("aip_certificates", JSON.stringify(certs));
  estadoBanco.linhas = certs;
}

describe("CompanyDocsTab — arquivo das certidões", () => {
  it("oferece baixar quando o conteúdo do arquivo está guardado", async () => {
    semearCertidoes([
      {
        id: "cnd-receita-federal",
        name: "CND Receita Federal e INSS",
        emissionDate: "",
        expirationDate: "2099-01-01",
        status: "valid",
        fileUploaded: true,
        fileName: "cnd.pdf",
        fileBase64: "QUJD",
        fileMimeType: "application/pdf",
      },
    ]);

    renderizar();

    // A aba desenha a mesma certidão em duas visões (cartões e tabela). Ambas
    // precisam oferecer a ação — a regra agora vive num componente só, e este
    // teste é o que garante que elas não voltem a divergir.
    const acoes = await screen.findAllByTitle(/Baixar cnd\.pdf/i);
    expect(acoes.length).toBe(2);
  });

  it("oferece reenviar — e não some — quando o conteúdo não está guardado", async () => {
    // Este é o defeito relatado: a certidão constava enviada, mas a tela não
    // mostrava ação nenhuma e o usuário não tinha como saber por quê.
    semearCertidoes([
      {
        id: "nd-estadual",
        name: "CND Estadual",
        emissionDate: "",
        expirationDate: "2099-01-01",
        status: "valid",
        fileUploaded: true,
        fileName: "estadual.pdf",
        // sem fileBase64 — anexada antes de a plataforma guardar o arquivo
      },
    ]);

    renderizar();

    const acoes = await screen.findAllByTitle(/conteúdo não está guardado/i);
    expect(acoes.length).toBe(2);
    expect(acoes[0].getAttribute("title")).toContain("estadual.pdf");
    expect(acoes[0].getAttribute("title")).toContain("Reenvie");
  });

  it("não oferece ação de arquivo para certidão sem nada enviado", async () => {
    semearCertidoes([
      { id: "cnd-municipal", name: "CND Municipal", emissionDate: "", expirationDate: "", status: "expired", fileUploaded: false },
    ]);

    renderizar();

    await screen.findAllByText(/CND Municipal/i);
    expect(screen.queryByTitle(/Baixar/i)).toBeNull();
    expect(screen.queryByTitle(/conteúdo não está guardado/i)).toBeNull();
  });
});

describe("CompanyDocsTab — popup de criação e edição", () => {
  it("abre um popup ao criar, em vez do formulário embutido", async () => {
    semearCertidoes([]);
    renderizar();

    // Sem clique, nenhum diálogo aberto.
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: /Nova Certidão/i }));

    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText("Nova certidão")).toBeDefined();
    // A criação já permite anexar o arquivo, sem precisar salvar e voltar.
    expect(within(dialogo).getByText(/Anexar arquivo/i)).toBeDefined();
  });

  it("abre o popup em modo de edição com os dados preenchidos", async () => {
    semearCertidoes([
      {
        id: "cnd-trabalhista",
        name: "CND Trabalhista",
        emissionDate: "2026-01-10",
        expirationDate: "2099-01-01",
        status: "valid",
        fileUploaded: true,
        fileBase64: "QUJD",
        fileName: "cndt.pdf",
      },
    ]);

    renderizar();
    fireEvent.click((await screen.findAllByTitle(/Editar/i))[0]);

    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText("Editar certidão")).toBeDefined();
    expect(within(dialogo).getByDisplayValue("CND Trabalhista")).toBeDefined();
    // O arquivo é gerenciado de dentro do próprio popup.
    expect(within(dialogo).getByTitle(/Baixar cndt\.pdf/i)).toBeDefined();
  });

  it("acusa vencimento anterior à emissão em vez de salvar", async () => {
    semearCertidoes([]);
    renderizar();

    fireEvent.click(await screen.findByRole("button", { name: /Nova Certidão/i }));
    const dialogo = await screen.findByRole("dialog");

    fireEvent.change(within(dialogo).getByPlaceholderText(/Certidão Negativa de Tributos/i), {
      target: { value: "CND Teste" },
    });

    const datas = within(dialogo).getAllByDisplayValue("");
    // Os dois campos de data são os únicos inputs type=date do popup.
    const campos = datas.filter((el) => el.getAttribute("type") === "date");
    fireEvent.change(campos[0], { target: { value: "2026-09-10" } });
    fireEvent.change(campos[1], { target: { value: "2026-09-01" } });

    fireEvent.click(within(dialogo).getByRole("button", { name: /Adicionar certidão/i }));

    expect(await within(dialogo).findByText(/anterior à emissão/i)).toBeDefined();
    // O popup continua aberto: nada foi salvo.
    expect(screen.getByRole("dialog")).toBeDefined();
  });
});
