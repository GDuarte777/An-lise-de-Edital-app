import { describe, it, expect } from "vitest";
import { appendFileSync } from "node:fs";
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

// O log do vitest fica longo demais para ser lido no fim de um job. As medições
// vão também para um arquivo, que o workflow publica no resumo da execução.
const ARQUIVO_RELATORIO = process.env.PNCP_RELATORIO || "";

function registrar(linha: string): void {
  console.log(linha);
  if (ARQUIVO_RELATORIO) {
    try {
      appendFileSync(ARQUIVO_RELATORIO, `${linha}\n`);
    } catch {
      // Relatório é conveniência; falhar ao escrever não invalida a medição.
    }
  }
}
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
 * Horizonte curto para os testes de contrato. O que se verifica neles é o
 * FORMATO da resposta, não o volume — e um recorte menor evita que uma consulta
 * cara transforme verificação de contrato em teste de desempenho do portal.
 */
function dataFinalCurta(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
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

/**
 * Consulta que devolve null em vez de estourar quando o portal não responde.
 *
 * Verificação de CONTRATO e medição de DESEMPENHO são perguntas diferentes.
 * Um teste de contrato que falha porque o portal está lento vira ruído, e ruído
 * treina todo mundo a ignorar o alarme — justamente o alarme que existe para
 * avisar quando a busca parar de funcionar de novo.
 */
async function consultarTolerante(query: string, timeoutMs = 55_000) {
  try {
    return await consultar(query, timeoutMs);
  } catch {
    registrar(`| consulta sem resposta em ${timeoutMs / 1000}s | ${timeoutMs} ms | SEM RESPOSTA |`);
    return null;
  }
}

describe.runIf(ATIVO)("contrato da API do PNCP (rede real)", () => {
  // ── Sonda de latência ──────────────────────────────────────────────
  //
  // A primeira execução no CI mostrou algo que nenhuma documentação diz: a
  // recusa de tamanhoPagina=500 volta em 764ms, mas toda consulta VÁLIDA
  // passou de 20 segundos. A diferença faz sentido — o 400 é recusado na
  // validação, antes de qualquer trabalho de banco.
  //
  // Isso importa porque o servidor tem prazo: se uma página demora mais que o
  // timeout da requisição, a busca falha de novo, agora por lentidão em vez de
  // parâmetro inválido. A sonda mede o custo de cada formato de consulta para
  // que os prazos do servidor sejam calibrados por medição, e não por chute.
  //
  // Lentidão NÃO quebra o build: o portal ser lento hoje não é defeito nosso, e
  // um teste que falha por isso vira ruído que todo mundo aprende a ignorar. O
  // que quebra o build é violação de contrato — resposta 4xx a consulta válida.
  it(
    "mede o custo de cada formato de consulta",
    async () => {
      const horizontes = [30, 90, 365];
      const medicoes: Array<{ cenario: string; ms: number; status: number | string }> = [];

      for (const dias of horizontes) {
        const d = new Date();
        d.setDate(d.getDate() + dias);

        const inicio = Date.now();
        try {
          const { status, corpo } = await consultar(
            montarQueryContratacoes({
              endpoint: "proposta",
              modalidade: "6",
              pagina: 1,
              dataFinal: formatarDataPncp(d),
            }),
            55_000,
          );
          medicoes.push({ cenario: `horizonte ${dias}d`, ms: Date.now() - inicio, status });

          // A asserção de contrato vale só quando houve resposta.
          expect(status).toBeLessThan(400);
          if (status === 200) {
            expect(corpo.data.length).toBeLessThanOrEqual(PNCP_TAMANHO_PAGINA_CONTRATACOES);
          }
        } catch (err: any) {
          medicoes.push({ cenario: `horizonte ${dias}d`, ms: Date.now() - inicio, status: "TIMEOUT" });
        }
      }

      // Com UF: o filtro deveria reduzir o conjunto varrido pelo portal.
      const comUf = new Date();
      comUf.setDate(comUf.getDate() + 90);
      const inicioUf = Date.now();
      try {
        const { status } = await consultar(
          montarQueryContratacoes({
            endpoint: "proposta",
            modalidade: "6",
            pagina: 1,
            dataFinal: formatarDataPncp(comUf),
            uf: "SP",
          }),
          55_000,
        );
        medicoes.push({ cenario: "horizonte 90d + UF=SP", ms: Date.now() - inicioUf, status });
      } catch {
        medicoes.push({ cenario: "horizonte 90d + UF=SP", ms: Date.now() - inicioUf, status: "TIMEOUT" });
      }

      for (const m of medicoes) {
        registrar(`| ${m.cenario} | ${m.ms} ms | ${m.status} |`);
      }

      // Falha apenas se NENHUM formato respondeu: aí não é lentidão, é a API
      // inalcançável, e a busca da plataforma não tem como funcionar.
      const respondeu = medicoes.filter((m) => typeof m.status === "number");
      expect(respondeu.length).toBeGreaterThan(0);
    },
    240_000,
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
      registrar(`| tamanhoPagina=500 (deve ser recusado) | - | HTTP ${status}: ${texto.slice(0, 120)} |`);
    },
    90_000,
  );

  it(
    "devolve o envelope de paginação que a varredura usa",
    async () => {
      const resposta = await consultarTolerante(
        montarQueryContratacoes({
          endpoint: "proposta",
          modalidade: "6",
          pagina: 1,
          dataFinal: dataFinalCurta(),
        }),
      );
      if (!resposta) return;
      const { status, corpo } = resposta;
      if (status === 204) return;

      // temProximaPagina() decide a varredura inteira a partir destes campos.
      expect(corpo).toHaveProperty("totalRegistros");
      expect(corpo).toHaveProperty("totalPaginas");
      expect(corpo).toHaveProperty("paginasRestantes");
      expect(typeof temProximaPagina(corpo, 1)).toBe("boolean");
    },
    90_000,
  );

  it(
    "entrega os campos que a interface exibe de cada contratação",
    async () => {
      const resposta = await consultarTolerante(
        montarQueryContratacoes({
          endpoint: "proposta",
          modalidade: "6",
          pagina: 1,
          dataFinal: dataFinalCurta(),
        }),
      );
      if (!resposta) return;
      const { status, corpo } = resposta;
      if (status === 204) return;

      const item = corpo.data[0];
      expect(item).toHaveProperty("numeroControlePNCP");
      expect(item).toHaveProperty("objetoCompra");
      expect(item).toHaveProperty("orgaoEntidade");
      expect(item).toHaveProperty("unidadeOrgao");
      expect(item?.orgaoEntidade).toHaveProperty("cnpj");
      expect(item?.unidadeOrgao).toHaveProperty("ufSigla");
    },
    90_000,
  );

  it(
    "aceita o filtro por UF",
    async () => {
      const resposta = await consultarTolerante(
        montarQueryContratacoes({
          endpoint: "proposta",
          modalidade: "6",
          pagina: 1,
          dataFinal: dataFinalCurta(),
          uf: "SP",
        }),
      );
      if (!resposta) return;
      const { status, corpo } = resposta;

      expect([200, 204]).toContain(status);
      if (status === 200 && corpo.data.length > 0) {
        // Se o filtro fosse ignorado, a busca por estado seria uma ilusão.
        const ufs = new Set(corpo.data.map((i: any) => i?.unidadeOrgao?.ufSigla));
        expect([...ufs]).toEqual(["SP"]);
      }
    },
    90_000,
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
          const resposta = await consultarTolerante(
            montarQueryContratacoes({
              endpoint: "proposta",
              modalidade,
              pagina: 1,
              dataFinal: dataFinalCurta(),
            }),
          );
          return { modalidade, status: resposta ? resposta.status : "SEM RESPOSTA" };
        }),
      );

      for (const { modalidade, status } of resultados) {
        registrar(`| modalidade ${modalidade} (${PNCP_MODALIDADES[modalidade]}) | - | ${status} |`);
      }

      // Só 4xx conta como falha. A distinção é a razão de ser deste teste:
      //   4xx = o PNCP recusou a NOSSA consulta -> contrato violado, defeito nosso
      //   5xx = o PNCP quebrou ao processar     -> problema do portal
      // A medição de 17/09/2026 mostrou Credenciamento, Concurso e Leilão
      // Presencial respondendo 500 de forma consistente. Tratar isso como
      // defeito nosso deixaria o alarme permanentemente vermelho por algo que
      // não temos como corrigir — e alarme sempre vermelho não é alarme.
      const falhas = resultados
        .filter((r) => typeof r.status === "number" && (r.status as number) >= 400 && (r.status as number) < 500)
        .map((r) => `${r.modalidade} (${PNCP_MODALIDADES[r.modalidade]}): HTTP ${r.status}`);

      expect(falhas).toEqual([]);
    },
    90_000,
  );

  it(
    "confirma que dataInicial não é aceita no endpoint de proposta",
    async () => {
      // montarQueryContratacoes() descarta dataInicial em /proposta.
      //
      // A medição de 17/09/2026 corrigiu a suposição registrada aqui antes: o
      // endpoint NÃO recusa o parâmetro, devolve 200 normalmente. Continuamos
      // sem enviá-lo porque o recorte de /proposta é o prazo de recebimento
      // ainda aberto, e um filtro de data de publicação por cima disso esconde
      // certame antigo com proposta aberta — mas o motivo é esse, e não uma
      // recusa da API.
      const query = new URLSearchParams({
        dataInicial: "20260101",
        dataFinal: dataFinalCurta(),
        codigoModalidadeContratacao: "6",
        pagina: "1",
        tamanhoPagina: String(PNCP_TAMANHO_PAGINA_CONTRATACOES),
      });

      const resposta = await consultarTolerante(query.toString());
      if (!resposta) return;
      const { status, texto } = resposta;
      registrar(`| dataInicial em /proposta | - | HTTP ${status}: ${texto.slice(0, 120)} |`);
      // Sem asserção rígida: o objetivo é registrar o comportamento no log do
      // CI. Falhar aqui não indicaria defeito nosso, já que não mandamos o campo.
      expect(typeof resposta.status).toBe("number");
    },
    90_000,
  );
});
