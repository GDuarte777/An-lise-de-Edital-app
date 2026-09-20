// ═══════════════════════════════════════════════════════════════════════
// REGRAS DA API DE CONSULTA DO PNCP
//
// Este módulo concentra o que a API exige e o que ela devolve. Fica separado
// do server.ts por um motivo prático: era exatamente aqui que estava o defeito
// que zerava o Radar, e regra que decide se o usuário vê ou não uma licitação
// precisa ser testável sem subir servidor nem depender do portal estar no ar.
//
// Documentação oficial: Manual das APIs de Consultas do PNCP
// (https://www.gov.br/pncp/pt-br/central-de-conteudo/manuais) e o Swagger em
// https://pncp.gov.br/api/consulta/swagger-ui/index.html
// ═══════════════════════════════════════════════════════════════════════

/**
 * Teto de registros por página nos endpoints de CONTRATAÇÕES.
 *
 * ⚠️ O código anterior usava 500. O manual v1.0 realmente cita 500, mas esse
 * valor vale para atas, contratos e PCA — nas contratações o teto é 50, e a API
 * responde 400 "Tamanho de página inválido" para qualquer valor acima disso.
 *
 * O efeito era total: toda consulta do Radar voltava 400, o cliente traduzia o
 * erro para `null`, a paginação interpretava `null` como "acabaram as páginas"
 * e a rota concluía que o PNCP estava fora do ar. A busca não trazia "poucas"
 * licitações — não trazia nenhuma.
 */
export const PNCP_TAMANHO_PAGINA_CONTRATACOES = 50;

/** O menor tamanho de página aceito pela API, em qualquer endpoint. */
export const PNCP_TAMANHO_PAGINA_MINIMO = 10;

// ───────────────────────── prazos ─────────────────────────
//
// Medição do workflow pncp-contract.yml em 19/09/2026, contra o portal real:
//
//   Pregão Eletrônico (mod. 6)   34,2 s   HTTP 200
//   Inexigibilidade   (mod. 9)   33,3 s   HTTP 200
//   horizonte 365d (o do Radar)  53,0 s   HTTP 500
//   modalidades 8, 7, 1          55,0 s   sem resposta
//
// Nenhuma consulta bem-sucedida respondeu em menos de 33 segundos. Os prazos
// vivem aqui, e não só no server, porque a relação entre eles é o que decide
// se a busca funciona — e isso precisa ser verificável sem subir servidor.

/** A resposta 200 mais lenta que já medimos. Base de calibração do timeout. */
export const PNCP_LATENCIA_OK_MEDIDA_MS = 34_200;

/**
 * Teto por consulta. Precisa ficar ACIMA da latência medida — com 22 s, valor
 * anterior, toda consulta era abortada antes de o portal responder e o Radar
 * não trazia nada — e abaixo dos 55 s em que o portal claramente travou.
 */
export const PNCP_TIMEOUT_PADRAO_MS = 45_000;

/** Orçamento da varredura inteira. Precisa caber na duração da função. */
export const PNCP_ORCAMENTO_PADRAO_MS = 50_000;

/** Teto de duração da função serverless (60 s é o limite do plano Hobby). */
export const PNCP_MAX_DURACAO_PADRAO_S = 60;

/** Tabela de domínio "Modalidade de Contratação" do PNCP. */
export const PNCP_MODALIDADES: Record<string, string> = {
  "1": "Leilão - Eletrônico",
  "2": "Diálogo Competitivo",
  "3": "Concurso",
  "4": "Concorrência - Eletrônica",
  "5": "Concorrência - Presencial",
  "6": "Pregão - Eletrônico",
  "7": "Pregão - Presencial",
  "8": "Dispensa de Licitação",
  "9": "Inexigibilidade",
  "10": "Manifestação de Interesse",
  "11": "Pré-qualificação",
  "12": "Credenciamento",
  "13": "Leilão - Presencial",
};

/**
 * `codigoModalidadeContratacao` é obrigatório nos dois endpoints de
 * contratação — não existe "buscar todas de uma vez". Cobrir o PNCP inteiro
 * significa, necessariamente, uma varredura por modalidade.
 *
 * A ordem não é alfabética nem numérica: é por volume de oportunidade real.
 * Quando o orçamento de tempo acaba no meio da varredura, o que já foi
 * carregado é o que mais interessa ao usuário, e não o que veio primeiro no
 * código de domínio.
 */
export const PNCP_MODALIDADES_POR_RELEVANCIA = ["6", "8", "4", "9", "12", "7", "5", "11", "13", "1", "3", "2", "10"];

export function nomeModalidade(codigo: string | number | null | undefined): string {
  return PNCP_MODALIDADES[String(codigo ?? "")] || "";
}

/** "AAAAMMDD", o formato de data exigido pela API. */
export function formatarDataPncp(date: Date): string {
  const ano = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, "0");
  const dia = String(date.getDate()).padStart(2, "0");
  return `${ano}${mes}${dia}`;
}

export type EndpointContratacao = "publicacao" | "proposta";

export interface ParametrosConsulta {
  endpoint: EndpointContratacao;
  modalidade: string;
  pagina: number;
  dataFinal: string;
  /** Só existe no endpoint de publicação; a API rejeita no de proposta. */
  dataInicial?: string;
  uf?: string;
  municipio?: string;
  tamanhoPagina?: number;
}

/**
 * Monta a query string de uma consulta de contratações.
 *
 * `dataInicial` é deliberadamente descartada no endpoint de proposta: lá o
 * recorte é o prazo de recebimento ainda aberto, e mandar um parâmetro que o
 * endpoint não conhece é uma forma conhecida de tomar 400.
 */
export function montarQueryContratacoes(p: ParametrosConsulta): string {
  const tamanho = Math.min(
    PNCP_TAMANHO_PAGINA_CONTRATACOES,
    Math.max(PNCP_TAMANHO_PAGINA_MINIMO, p.tamanhoPagina ?? PNCP_TAMANHO_PAGINA_CONTRATACOES),
  );

  const query = new URLSearchParams({
    dataFinal: p.dataFinal,
    codigoModalidadeContratacao: p.modalidade,
    pagina: String(p.pagina),
    tamanhoPagina: String(tamanho),
  });

  if (p.endpoint === "publicacao" && p.dataInicial) query.set("dataInicial", p.dataInicial);
  if (p.uf) query.set("uf", p.uf);
  if (p.municipio) query.set("codigoMunicipioIbge", p.municipio);

  return query.toString();
}

/** Envelope padronizado que os endpoints de listagem devolvem. */
export interface RespostaPaginada {
  data?: any[];
  totalRegistros?: number;
  totalPaginas?: number;
  numeroPagina?: number;
  paginasRestantes?: number;
  empty?: boolean;
}

/**
 * Decide se vale pedir a próxima página.
 *
 * `paginasRestantes` é a fonte preferida porque é o que a API afirma; os
 * outros campos entram só quando ela vem ausente. Página vazia encerra em
 * qualquer caso — sem isso, um envelope malformado viraria laço infinito.
 */
export function temProximaPagina(resposta: RespostaPaginada, paginaAtual: number): boolean {
  const itens = Array.isArray(resposta?.data) ? resposta.data.length : 0;
  if (itens === 0) return false;

  const restantes = Number(resposta?.paginasRestantes);
  if (Number.isFinite(restantes)) return restantes > 0;

  const totalPaginas = Number(resposta?.totalPaginas);
  if (Number.isFinite(totalPaginas) && totalPaginas > 0) return paginaAtual < totalPaginas;

  return false;
}

/** Chave estável de uma contratação, para deduplicar entre modalidades e UFs. */
export function chaveContratacao(item: any): string {
  return (
    item?.numeroControlePNCP ||
    `${item?.orgaoEntidade?.cnpj || item?.cnpjOrgao || ""}-${item?.anoCompra || ""}-${item?.sequencialCompra || ""}`
  );
}

/**
 * Decompõe o número de controle PNCP ("79151312000156-1-000501/2026") nas
 * partes usadas pelas consultas de detalhe, itens e arquivos.
 */
export function parseNumeroControlePNCP(
  numero: string,
): { cnpj: string; ano: string; sequencial: string } | null {
  const m = String(numero || "").match(/(\d{14})-\d+-(\d+)\/(\d{4})/);
  if (!m) return null;
  return { cnpj: m[1], sequencial: String(parseInt(m[2], 10)), ano: m[3] };
}

/**
 * Escolhe, entre os arquivos publicados, qual é o edital.
 *
 * O PNCP não marca "este é o edital": devolve uma lista com edital, termo de
 * referência, planilhas, minuta de contrato e anexos, em ordem qualquer. Mandar
 * o arquivo errado para a IA custa uma análise inteira, então a escolha segue o
 * que o título e o tipo dizem, com o edital à frente do termo de referência, e
 * um PDF à frente de planilha ou imagem.
 */
export function escolherArquivoEdital<T extends { titulo?: string; tipo?: string; uri?: string }>(
  arquivos: T[],
): T | null {
  if (!Array.isArray(arquivos) || arquivos.length === 0) return null;

  const pontuar = (arq: T): number => {
    const texto = `${arq?.titulo || ""} ${arq?.tipo || ""}`.toLowerCase();
    let pontos = 0;

    if (/\bedital\b/.test(texto)) pontos += 100;
    else if (/termo de referen|\btr\b|projeto b[aá]sico/.test(texto)) pontos += 60;
    else if (/anexo/.test(texto)) pontos += 20;

    // Retificação e errata alteram o edital, mas sozinhas não o substituem:
    // analisar só a errata daria uma leitura incompleta do certame.
    if (/retifica|errata|adendo|esclarecimento|impugna/.test(texto)) pontos -= 50;
    // Ata e resultado são posteriores à disputa, não servem para decidir se vale participar.
    if (/ata\b|resultado|homologa|adjudica/.test(texto)) pontos -= 60;

    if (/\.pdf\b|pdf/.test(texto)) pontos += 10;
    if (/\.zip\b|\.rar\b/.test(texto)) pontos -= 30;
    if (/\.xls|\.xlsx|planilha/.test(texto)) pontos -= 20;
    if (/\.jpg|\.jpeg|\.png/.test(texto)) pontos -= 40;

    return pontos;
  };

  // Sem nenhum candidato plausível, é melhor não escolher do que mandar a IA
  // analisar uma ata de registro de preço achando que é o edital.
  let melhor: T | null = null;
  let melhorPontuacao = -Infinity;
  for (const arq of arquivos) {
    if (!arq?.uri) continue;
    const pontos = pontuar(arq);
    if (pontos > melhorPontuacao) {
      melhorPontuacao = pontos;
      melhor = arq;
    }
  }

  return melhorPontuacao > 0 ? melhor : null;
}
