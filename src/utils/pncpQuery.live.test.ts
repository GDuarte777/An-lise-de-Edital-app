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
// ainda se comporta como a nossa lógica assume — pergunta diferente, e a que a
// plataforma errou por mais tempo.
//
// O defeito que zerava o Radar não foi erro de raciocínio: foi uma premissa
// desatualizada sobre um sistema de terceiros (tamanhoPagina até 500, quando
// nas contratações o teto é 50). Nenhum teste de unidade pega isso — a unidade
// estava coerente com a premissa errada. Só a chamada real pega.
//
// ── A REGRA QUE GOVERNA ESTE ARQUIVO ───────────────────────────────────
//
//   4xx          → o PNCP recusou a NOSSA consulta. Contrato violado. QUEBRA.
//   5xx          → o PNCP quebrou ao processar. Problema do portal. Registra.
//   sem resposta → lentidão do portal. Registra e segue.
//
// A distinção é a razão de ser deste arquivo. Duas execuções com dez minutos de
// diferença mostraram o mesmo endpoint passando de dez modalidades em 200 para
// quase todas em 500 ("Erro na comunicação com o banco de dados"): o portal
// oscila, e um alarme que toca a cada oscilação é um alarme que todo mundo
// aprende a ignorar — justamente o alarme que existe para avisar quando a busca
// parar de funcionar de novo.
//
// Ativado por PNCP_LIVE=1; no CI, pelo workflow pncp-contract.yml (diário).
// ═══════════════════════════════════════════════════════════════════════

const ATIVO = process.env.PNCP_LIVE === "1";
const BASE = "https://pncp.gov.br/api/consulta/v1/contratacoes";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
};

// O log do vitest é longo demais para ser lido no fim de um job. As medições
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

/** Horizonte longo, como o que a plataforma usa em produção. */
function dataFinalFutura(): string {
  const d = new Date();
  d.setDate(d.getDate() + 365);
  return formatarDataPncp(d);
}

/**
 * Horizonte curto para as verificações de formato: o que se checa nelas é o
 * FORMATO da resposta, não o volume, e um recorte menor evita transformar
 * verificação de contrato em teste de desempenho do portal.
 */
function dataFinalCurta(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return formatarDataPncp(d);
}

interface RespostaCrua {
  status: number;
  corpo: any;
  texto: string;
}

/**
 * Consulta com prazo. Sem AbortController, uma requisição pendurada sobrevive
 * ao timeout do vitest e segura o processo — foi o que fez a primeira execução
 * deste arquivo durar treze minutos em vez de um.
 */
async function consultar(query: string, timeoutMs = 25_000): Promise<RespostaCrua> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resposta = await fetch(`${BASE}/proposta?${query}`, { headers: HEADERS, signal: controller.signal });
    const texto = await resposta.text();
    let corpo: any = null;
    try {
      corpo = JSON.parse(texto);
    } catch {
      // Erro do PNCP nem sempre é JSON; o texto cru basta para o relatório.
    }
    return { status: resposta.status, corpo, texto };
  } finally {
    clearTimeout(timer);
  }
}

/** Como a consulta terminou, na classificação que este arquivo usa. */
type Desfecho =
  | { tipo: "ok"; resposta: RespostaCrua }
  | { tipo: "portal"; status: number | "sem resposta" }
  | { tipo: "contrato"; rotulo: string; mensagem: string };

/**
 * Aplica a regra 4xx/5xx/sem-resposta em um único lugar.
 *
 * Centralizar importa: quando cada teste decidia sozinho o que fazer com o
 * status, bastou o portal oscilar para 500 e a suíte inteira quebrou por algo
 * que não é defeito nosso.
 */
async function consultarClassificando(rotulo: string, query: string, timeoutMs = 25_000): Promise<Desfecho> {
  const inicio = Date.now();
  let resposta: RespostaCrua;

  try {
    resposta = await consultar(query, timeoutMs);
  } catch {
    registrar(`| ${rotulo} | ${Date.now() - inicio} ms | SEM RESPOSTA |`);
    return { tipo: "portal", status: "sem resposta" };
  }

  const ms = Date.now() - inicio;

  if (resposta.status >= 400 && resposta.status < 500) {
    registrar(`| ${rotulo} | ${ms} ms | HTTP ${resposta.status} — CONTRATO VIOLADO |`);
    return {
      tipo: "contrato",
      rotulo,
      mensagem: `HTTP ${resposta.status} — ${resposta.texto.slice(0, 160)}`,
    };
  }

  if (resposta.status >= 500) {
    registrar(`| ${rotulo} | ${ms} ms | HTTP ${resposta.status} (portal) — ${resposta.texto.slice(0, 70)} |`);
    return { tipo: "portal", status: resposta.status };
  }

  registrar(`| ${rotulo} | ${ms} ms | HTTP ${resposta.status} |`);
  return { tipo: "ok", resposta };
}

/** Descrição das violações de contrato encontradas, para a asserção final. */
function violacoes(desfechos: Desfecho[]): string[] {
  return desfechos
    .filter((d): d is Extract<Desfecho, { tipo: "contrato" }> => d.tipo === "contrato")
    .map((d) => `${d.rotulo}: ${d.mensagem}`);
}

function consultaPadrao(extra: { uf?: string; dataFinal?: string; modalidade?: string } = {}): string {
  return montarQueryContratacoes({
    endpoint: "proposta",
    modalidade: extra.modalidade ?? "6",
    pagina: 1,
    dataFinal: extra.dataFinal ?? dataFinalCurta(),
    uf: extra.uf,
  });
}

describe.runIf(ATIVO)("contrato da API do PNCP (rede real)", () => {
  it(
    "REJEITA tamanhoPagina=500 — a premissa que zerava a busca",
    async () => {
      // Prova o DEFEITO, não só a correção. Se um dia passar a falhar porque o
      // PNCP aceitou 500, ótimo: aí dá para aumentar o tamanho de página com
      // base em medição, e não por suposição.
      const query = new URLSearchParams({
        dataFinal: dataFinalCurta(),
        codigoModalidadeContratacao: "6",
        pagina: "1",
        tamanhoPagina: "500",
      });

      const { status, texto } = await consultar(query.toString());
      registrar(`| tamanhoPagina=500 (deve ser recusado) | - | HTTP ${status}: ${texto.slice(0, 110)} |`);

      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    },
    60_000,
  );

  it(
    "mede o custo de cada formato de consulta",
    async () => {
      // A recusa de tamanhoPagina=500 volta em menos de 1s, mas consultas
      // válidas já levaram de 30 a 55 segundos — o 400 é rejeitado na
      // validação, antes de qualquer trabalho de banco. Os prazos do servidor
      // (PNCP_TIMEOUT_MS, PNCP_ORCAMENTO_MS) saem daqui, e não de chute.
      const desfechos: Desfecho[] = [];

      for (const dias of [30, 90, 365]) {
        const d = new Date();
        d.setDate(d.getDate() + dias);
        desfechos.push(
          await consultarClassificando(`horizonte ${dias}d`, consultaPadrao({ dataFinal: formatarDataPncp(d) }), 55_000),
        );
      }

      desfechos.push(await consultarClassificando("horizonte 30d + UF=SP", consultaPadrao({ uf: "SP" }), 55_000));

      // Nenhuma asserção de velocidade: lentidão do portal não é defeito nosso.
      expect(violacoes(desfechos)).toEqual([]);
    },
    240_000,
  );

  it(
    "devolve o envelope de paginação que a varredura usa",
    async () => {
      const desfecho = await consultarClassificando("envelope de paginação", consultaPadrao(), 55_000);
      expect(violacoes([desfecho])).toEqual([]);
      if (desfecho.tipo !== "ok" || desfecho.resposta.status === 204) return;

      // temProximaPagina() decide a varredura inteira a partir destes campos.
      const corpo = desfecho.resposta.corpo;
      expect(corpo).toHaveProperty("totalRegistros");
      expect(corpo).toHaveProperty("totalPaginas");
      expect(corpo).toHaveProperty("paginasRestantes");
      expect(typeof temProximaPagina(corpo, 1)).toBe("boolean");
    },
    90_000,
  );

  it(
    "respeita o tamanho de página e entrega os campos que a interface exibe",
    async () => {
      const desfecho = await consultarClassificando("campos da contratação", consultaPadrao(), 55_000);
      expect(violacoes([desfecho])).toEqual([]);
      if (desfecho.tipo !== "ok" || desfecho.resposta.status === 204) return;

      const corpo = desfecho.resposta.corpo;
      expect(Array.isArray(corpo?.data)).toBe(true);
      expect(corpo.data.length).toBeLessThanOrEqual(PNCP_TAMANHO_PAGINA_CONTRATACOES);
      if (corpo.data.length === 0) return;

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
    "aplica de fato o filtro por UF",
    async () => {
      const desfecho = await consultarClassificando("filtro UF=SP", consultaPadrao({ uf: "SP" }), 55_000);
      expect(violacoes([desfecho])).toEqual([]);
      if (desfecho.tipo !== "ok" || desfecho.resposta.status === 204) return;

      const corpo = desfecho.resposta.corpo;
      if (!corpo?.data?.length) return;

      // Se o filtro fosse ignorado, a busca por estado seria uma ilusão.
      const ufs = new Set(corpo.data.map((i: any) => i?.unidadeOrgao?.ufSigla));
      expect([...ufs]).toEqual(["SP"]);
    },
    90_000,
  );

  it(
    "não é recusado em nenhuma das modalidades que varremos",
    async () => {
      // Uma modalidade recusada sai silenciosamente do Radar, e o usuário nunca
      // fica sabendo que aquele tipo de certame não é buscado.
      const desfechos = await Promise.all(
        PNCP_MODALIDADES_POR_RELEVANCIA.map((modalidade) =>
          consultarClassificando(
            `modalidade ${modalidade} (${PNCP_MODALIDADES[modalidade]})`,
            consultaPadrao({ modalidade }),
            55_000,
          ),
        ),
      );

      expect(violacoes(desfechos)).toEqual([]);
    },
    240_000,
  );

  it(
    "registra como o endpoint de proposta trata dataInicial",
    async () => {
      // montarQueryContratacoes() não envia dataInicial em /proposta.
      //
      // A medição corrigiu a suposição que estava registrada aqui antes: o
      // endpoint NÃO recusa o parâmetro, responde 200 normalmente. Seguimos sem
      // enviá-lo, mas pelo motivo certo — o recorte de /proposta é o prazo de
      // recebimento ainda aberto, e filtrar por data de publicação por cima
      // disso esconderia certame antigo com proposta ainda aberta.
      const query = new URLSearchParams({
        dataInicial: "20260101",
        dataFinal: dataFinalCurta(),
        codigoModalidadeContratacao: "6",
        pagina: "1",
        tamanhoPagina: String(PNCP_TAMANHO_PAGINA_CONTRATACOES),
      });

      const desfecho = await consultarClassificando("dataInicial em /proposta", query.toString(), 55_000);
      // Só registra: não enviamos o parâmetro, então recusa dele não seria
      // defeito nosso. O valor está no histórico do log.
      expect(desfecho).toBeDefined();
    },
    90_000,
  );

  it(
    "aceita o horizonte longo que a plataforma usa em produção",
    async () => {
      const desfecho = await consultarClassificando(
        "horizonte de produção (365d)",
        consultaPadrao({ dataFinal: dataFinalFutura() }),
        55_000,
      );
      expect(violacoes([desfecho])).toEqual([]);
    },
    90_000,
  );
});
