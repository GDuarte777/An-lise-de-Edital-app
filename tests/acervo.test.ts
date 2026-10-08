import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { montarAcervo } from "../supabase/functions/api/acervo.ts";

// O chat só enxergava o edital selecionado no Foco da conversa, então
// "já analisamos algum edital com UASG 927374?" não tinha resposta possível —
// o dado existia no banco e nunca chegava ao modelo. Estes testes fixam o que
// o índice precisa conter, e o que ele NÃO pode fazer quando a leitura falha.

const AUTH = "Bearer jwt-de-teste";

function responderCom(porCaminho: (caminho: string) => { ok: boolean; corpo: unknown }) {
  return vi.fn(async (url: any, _init?: any) => {
    const caminho = String(url);
    const { ok, corpo } = porCaminho(caminho);
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => corpo,
    } as any;
  });
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://projeto.supabase.co";
  process.env.SUPABASE_ANON_KEY = "chave-publicavel";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("montarAcervo", () => {
  it("não tenta ler nada sem usuário autenticado", async () => {
    const fetchFalso = responderCom(() => ({ ok: true, corpo: [] }));
    vi.stubGlobal("fetch", fetchFalso);

    const acervo = await montarAcervo(undefined);

    expect(acervo.leu).toBe(false);
    expect(acervo.texto).toBe("");
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("consulta com o JWT do usuário, para o RLS continuar valendo", async () => {
    const fetchFalso = responderCom(() => ({ ok: true, corpo: [] }));
    vi.stubGlobal("fetch", fetchFalso);

    await montarAcervo(AUTH);

    for (const chamada of fetchFalso.mock.calls) {
      const init = chamada[1] as { headers: Record<string, string> };
      expect(init.headers.Authorization).toBe(AUTH);
    }
  });

  it("lista editais com UASG e número, que é o que a pergunta do usuário usa", async () => {
    vi.stubGlobal(
      "fetch",
      responderCom((caminho) => ({
        ok: true,
        corpo: caminho.includes("editais_analisados")
          ? [
              {
                id: "e1",
                title: "Pregão SAP",
                date: "01/10/2026",
                ident: {
                  orgaoComprador: "Secretaria da Administração Penitenciária",
                  codigoUASG: "927374",
                  numeroEdital: "44/2026",
                  modalidade: "Pregão Eletrônico",
                  dataHoraSessao: "10/10/2026 09:00",
                },
              },
            ]
          : [],
      }))
    );

    const acervo = await montarAcervo(AUTH);

    expect(acervo.editais).toBe(1);
    expect(acervo.texto).toContain("927374");
    expect(acervo.texto).toContain("44/2026");
    expect(acervo.texto).toContain("Secretaria da Administração Penitenciária");
  });

  it("deduz a UASG de análises antigas, que não tinham o campo", async () => {
    vi.stubGlobal(
      "fetch",
      responderCom((caminho) => ({
        ok: true,
        corpo: caminho.includes("editais_analisados")
          ? [{ id: "e1", title: "Antigo", date: "01/09/2026", ident: { orgaoComprador: "Prefeitura X — UASG 160001" } }]
          : [],
      }))
    );

    const acervo = await montarAcervo(AUTH);

    expect(acervo.texto).toContain("UASG: 160001");
  });

  it("não deixa o número do processo passar por UASG na planilha", async () => {
    // É o defeito relatado: "163/2026" aparecia no campo da unidade. Se vazasse
    // para o índice, o chat passaria a afirmar que existe a UASG 163/2026.
    vi.stubGlobal(
      "fetch",
      responderCom((caminho) => ({
        ok: true,
        corpo: caminho.includes("planilhas_disputas")
          ? [{ orgao: "SAP", uasg_und_compradora: "163/2026", numero_licitacao: "163/2026", status: "Aguardando" }]
          : [],
      }))
    );

    const acervo = await montarAcervo(AUTH);

    expect(acervo.texto).toContain("UASG: —");
    expect(acervo.texto).toContain("nº: 163/2026");
  });

  it("admite que não conseguiu ler, em vez de parecer um acervo vazio", async () => {
    // Um acervo vazio e um acervo ilegível levam a respostas opostas: no
    // primeiro o chat afirma que não existe, no segundo ele precisa dizer que
    // não conseguiu consultar.
    vi.stubGlobal("fetch", responderCom(() => ({ ok: false, corpo: null })));

    const acervo = await montarAcervo(AUTH);

    expect(acervo.leu).toBe(false);
    expect(acervo.texto).toBe("");
  });

  it("trunca índices grandes para não comer o orçamento do chat", async () => {
    const muitos = Array.from({ length: 400 }, (_, i) => ({
      orgao: `Órgão número ${i} com nome razoavelmente longo para ocupar espaço`,
      uasg_und_compradora: "160001",
      numero_licitacao: `${i}/2026`,
      portal: "Compras.gov.br",
      produto_item: "Item de teste com descrição comprida o bastante para pesar",
      data_hora_disputa: "10/10/2026 09:00",
      status: "Aguardando",
    }));
    vi.stubGlobal(
      "fetch",
      responderCom((caminho) => ({ ok: true, corpo: caminho.includes("planilhas_disputas") ? muitos : [] }))
    );

    const acervo = await montarAcervo(AUTH);

    expect(acervo.texto.length).toBeLessThan(13_000);
    expect(acervo.texto).toContain("índice truncado");
  });
});
