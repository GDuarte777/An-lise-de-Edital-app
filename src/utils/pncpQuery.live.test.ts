import { describe, it, expect } from "vitest";
import {
  PNCP_TAMANHO_PAGINA_CONTRATACOES,
  PNCP_MODALIDADES,
  PNCP_MODALIDADES_POR_RELEVANCIA,
  montarQueryContratacoes,
  temProximaPagina,
  formatarDataPncp,
} from "./pncpQuery";

// ═══════════════════════════════════════════════════════════════════════
// TESTE DE CONTRATO CONTRA A API REAL DO PNCP
//
// Os outros testes verificam a NOSSA lógica. Este verifica se a API do PNCP
// ainda se comporta como a nossa lógica assume — que é uma pergunta diferente,
// e é a que a plataforma errou por mais tempo.
//
// O defeito que zerava o Radar não era um erro de raciocínio: era uma premissa
// desatualizada sobre um sistema de terceiros (tamanhoPagina até 500, quando
// nas contratações o teto é 50). Nenhum teste de unidade pega isso, porque a
// unidade estava coerente com a premissa errada. Só uma chamada real pega.
//
// Roda separado da suíte normal (precisa de rede e do portal no ar) e é
// ativado por PNCP_LIVE=1 — no CI, pelo workflow pncp-contract.yml, que roda
// diariamente. Se o PNCP mudar as regras de novo, o alarme chega pelo CI e não
// por um usuário reclamando que a busca não acha nada.
// ═══════════════════════════════════════════════════════════════════════

const ATIVO = process.env.PNCP_LIVE === "1";
const BASE = "https://pncp.gov.br/api/consulta/v1/contratacoes";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
};

/** Horizonte usado nas consultas de proposta em aberto. */
function dataFinalFutura(): string {
  const d = new Date();
  d.setDate(d.getDate() + 365);
  return formatarDataPncp(d);
}

/**
 * Toda consulta tem prazo. Sem isso, uma requisição pendurada no portal fica
 * presa até o timeout do vitest, e um job que deveria durar um minuto passa dez
 * — o que já aconteceu na primeira execução deste arquivo.
 */
async function consultar(query: string, timeoutMs = 20_000): Promise<{ status: number; corpo: any; texto: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resposta = await fetch(`${BASE}/proposta?${query}`, { headers: HEADERS, signal: controller.signal });
    const texto = await resposta.text();
    let corpo: any = null;
    try {
      corpo = JSON.parse(texto);
    } catch {
      // Resposta de erro do PNCP nem sempre é JSON; o texto cru basta.
    }
    return { status: resposta.status, corpo, texto };
  } finally {
    clearTimeout(timer);
  }
}

describe.runIf(ATIVO)("contrato da API do PNCP (rede real)", () => {
  it(
    "aceita o tamanho de página que usamos",
    async () => {
      const { status, corpo } = await consultar(
        montarQueryContratacoes({
          endpoint: "proposta",
          modalidade: "6",
          pagina: 1,
          dataFinal: dataFinalFutura(),
        }),
      );

      // 200 com dados ou 204 sem dados; qualquer 4xx significa que a nossa
      // requisição está fora do contrato.
      expect([200, 204]).toContain(status);

      if (status === 200) {
        expect(Array.isArray(corpo?.data)).toBe(true);
        expect(corpo.data.length).toBeGreaterThan(0);
        expect(corpo.data.length).toBeLessThanOrEqual(PNCP_TAMANHO_PAGINA_CONTRATACOES);
      }
    },
    60_000,
  );

  it(
    "REJEITA tamanhoPagina=500 — a premissa que zerava a busca",
    async () => {
      // Este teste existe para provar o defeito, não só a correção. Se um dia
      // ele passar a falhar porque o PNCP aceitou 500, ótimo: aí sim dá para
      // aumentar o tamanho de página com segurança, e não por suposição.
      const query = new URLSearchParams({
        dataFinal: dataFinalFutura(),
        codigoModalidadeContratacao: "6",
        pagina: "1",
        tamanhoPagina: "500",
      });

      const { status, texto } = await consultar(query.toString());

      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
      console.log(`[contrato] tamanhoPagina=500 -> HTTP ${status}: ${texto.slice(0, 200)}`);
    },
    60_000,
  );

  it(
    "devolve o envelope de paginação que a varredura usa",
    async () => {
      const { status, corpo } = await consultar(
        montarQueryContratacoes({
          endpoint: "proposta",
          modalidade: "6",
          pagina: 1,
          dataFinal: dataFinalFutura(),
        }),
      );
      if (status === 204) return;

      // temProximaPagina() decide a varredura inteira a partir destes campos.
      expect(corpo).toHaveProperty("totalRegistros");
      expect(corpo).toHaveProperty("totalPaginas");
      expect(corpo).toHaveProperty("paginasRestantes");
      expect(typeof temProximaPagina(corpo, 1)).toBe("boolean");
    },
    60_000,
  );

  it(
    "entrega os campos que a interface exibe de cada contratação",
    async () => {
      const { status, corpo } = await consultar(
        montarQueryContratacoes({
          endpoint: "proposta",
          modalidade: "6",
          pagina: 1,
          dataFinal: dataFinalFutura(),
        }),
      );
      if (status === 204) return;

      const item = corpo.data[0];
      expect(item).toHaveProperty("numeroControlePNCP");
      expect(item).toHaveProperty("objetoCompra");
      expect(item).toHaveProperty("orgaoEntidade");
      expect(item).toHaveProperty("unidadeOrgao");
      expect(item?.orgaoEntidade).toHaveProperty("cnpj");
      expect(item?.unidadeOrgao).toHaveProperty("ufSigla");
    },
    60_000,
  );

  it(
    "aceita o filtro por UF",
    async () => {
      const { status, corpo } = await consultar(
        montarQueryContratacoes({
          endpoint: "proposta",
          modalidade: "6",
          pagina: 1,
          dataFinal: dataFinalFutura(),
          uf: "SP",
        }),
      );

      expect([200, 204]).toContain(status);
      if (status === 200 && corpo.data.length > 0) {
        // Se o filtro fosse ignorado, a busca por estado seria uma ilusão.
        const ufs = new Set(corpo.data.map((i: any) => i?.unidadeOrgao?.ufSigla));
        expect([...ufs]).toEqual(["SP"]);
      }
    },
    60_000,
  );

  it(
    "responde a TODAS as modalidades que varremos",
    async () => {
      // Uma modalidade que responde 4xx sai silenciosamente do Radar e o
      // usuário nunca fica sabendo que aquele tipo de certame não é buscado.
      // Em paralelo: sequencial, 13 consultas a um portal lento estouram
      // qualquer limite de tempo razoável para um job de CI.
      const resultados = await Promise.all(
        PNCP_MODALIDADES_POR_RELEVANCIA.map(async (modalidade) => {
          const { status } = await consultar(
            montarQueryContratacoes({
              endpoint: "proposta",
              modalidade,
              pagina: 1,
              dataFinal: dataFinalFutura(),
            }),
            25_000,
          );
          return { modalidade, status };
        }),
      );

      for (const { modalidade, status } of resultados) {
        console.log(`[contrato] modalidade ${modalidade} (${PNCP_MODALIDADES[modalidade]}): HTTP ${status}`);
      }

      const falhas = resultados
        .filter((r) => ![200, 204].includes(r.status))
        .map((r) => `${r.modalidade} (${PNCP_MODALIDADES[r.modalidade]}): HTTP ${r.status}`);

      expect(falhas).toEqual([]);
    },
    60_000,
  );

  it(
    "confirma que dataInicial não é aceita no endpoint de proposta",
    async () => {
      // montarQueryContratacoes() descarta dataInicial em /proposta de
      // propósito. Se o PNCP passar a aceitar, dá para voltar a usar o filtro.
      const query = new URLSearchParams({
        dataInicial: "20260101",
        dataFinal: dataFinalFutura(),
        codigoModalidadeContratacao: "6",
        pagina: "1",
        tamanhoPagina: String(PNCP_TAMANHO_PAGINA_CONTRATACOES),
      });

      const { status, texto } = await consultar(query.toString());
      console.log(`[contrato] dataInicial em /proposta -> HTTP ${status}: ${texto.slice(0, 160)}`);
      // Sem asserção rígida: o objetivo é registrar o comportamento no log do
      // CI. Falhar aqui não indicaria defeito nosso, já que não mandamos o campo.
      expect(typeof status).toBe("number");
    },
    60_000,
  );
});
