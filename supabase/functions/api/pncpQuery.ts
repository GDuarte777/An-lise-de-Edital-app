// ═══════════════════════════════════════════════════════════════════════
// REGRAS DA API DE CONSULTA E BUSCA DO PNCP
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

export type StatusBuscaPncp = "todos" | "recebendo_proposta" | "encerradas";

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

export interface ParametrosBuscaIndexadaPncp {
  q?: string;
  municipio?: string;
  ufs?: string[];
  modalidades?: string[];
  status?: StatusBuscaPncp;
  pagina?: number;
  tamanhoPagina?: number;
}

/**
 * Monta a query string para a API indexada de busca do Portal PNCP (`/api/search/`).
 *
 * Ao contrário do endpoint `/api/consulta/v1/contratacoes`, que exige varrer
 * uma modalidade por vez e não filtra palavras-chave no servidor, o `/api/search/`
 * é o mesmo motor usado pela interface web oficial `pncp.gov.br/app/editais`:
 * pesquisa em todas as modalidades simultaneamente, suporta `status=todos`
 * (abertas e encerradas), `recebendo_proposta` ou `encerradas`, aceita `q`,
 * `uf` e `modalidades` separados por `|` e responde em menos de 1 segundo.
 */
export function montarQueryBuscaIndexadaPncp(p: ParametrosBuscaIndexadaPncp): string {
  const pagina = Math.max(1, p.pagina ?? 1);
  const tamPagina = Math.min(100, Math.max(10, p.tamanhoPagina ?? 20));
  const status: StatusBuscaPncp =
    p.status === "recebendo_proposta" || p.status === "encerradas" ? p.status : "todos";

  const query = new URLSearchParams({
    tipos_documento: "edital",
    ordenacao: "-data",
    pagina: String(pagina),
    tam_pagina: String(tamPagina),
    status,
  });

  const termos = [p.q?.trim(), p.municipio && !/^\d+$/.test(p.municipio.trim()) ? p.municipio.trim() : ""]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (termos) {
    query.set("q", termos);
  }

  if (Array.isArray(p.ufs) && p.ufs.length > 0) {
    query.set("uf", p.ufs.map(u => u.trim().toUpperCase()).filter(Boolean).join("|"));
  }

  if (Array.isArray(p.modalidades) && p.modalidades.length > 0) {
    query.set("modalidades", p.modalidades.map(m => String(m).trim()).filter(Boolean).join("|"));
  }

  return query.toString();
}

/**
 * Converte um registro retornado pelo `/api/search/` do PNCP para o mesmo
 * formato estruturado usado pelo restante da plataforma.
 */
export function normalizarItemBuscaIndexadaPncp(raw: any): any {
  const cnpj = String(raw?.orgao_cnpj || raw?.cnpjOrgao || raw?.orgaoEntidade?.cnpj || "").replace(/\D/g, "");
  const ano = raw?.ano || raw?.anoCompra || new Date().getFullYear();
  const sequencialRaw = raw?.numero_sequencial ?? raw?.sequencialCompra ?? 1;
  const sequencial = Number(sequencialRaw) || 1;
  const numeroControle =
    raw?.numero_controle_pncp ||
    raw?.numeroControlePNCP ||
    (cnpj ? `${cnpj}-1-${String(sequencial).padStart(6, "0")}/${ano}` : "");

  const modalidadeId =
    raw?.modalidade_licitacao_id != null
      ? String(raw.modalidade_licitacao_id)
      : raw?.modalidadeId != null
      ? String(raw.modalidadeId)
      : "";

  const modalidadeNome =
    raw?.modalidade_licitacao_nome ||
    raw?.modalidadeNome ||
    PNCP_MODALIDADES[modalidadeId] ||
    "Licitação Pública";

  const orgaoNome =
    raw?.orgao_nome ||
    raw?.orgaoEntidade?.razaoSocial ||
    "Órgão Público";

  const ufSigla =
    raw?.uf ||
    raw?.unidadeOrgao?.ufSigla ||
    "BR";

  const municipioNome =
    raw?.municipio_nome ||
    raw?.unidadeOrgao?.municipioNome ||
    "";

  const codigoUnidade =
    raw?.unidade_codigo ||
    raw?.unidadeOrgao?.codigoUnidade ||
    "";

  const nomeUnidade =
    raw?.unidade_nome ||
    raw?.unidadeOrgao?.nomeUnidade ||
    "";

  const valorGlobal =
    typeof raw?.valor_global === "number"
      ? raw.valor_global
      : typeof raw?.valorTotalEstimado === "number"
      ? raw.valorTotalEstimado
      : 0;

  return {
    numeroControlePNCP: numeroControle,
    idContratacaoPNCP: numeroControle,
    cnpjOrgao: cnpj,
    anoCompra: Number(ano) || new Date().getFullYear(),
    sequencialCompra: sequencial,
    numeroCompra: raw?.numero_compra || raw?.numeroCompra || String(sequencial),
    processo: raw?.numero_processo || raw?.processo || raw?.title || "",
    objetoCompra: raw?.description || raw?.objetoCompra || raw?.objeto || raw?.title || "",
    modalidadeId: modalidadeId ? Number(modalidadeId) || modalidadeId : undefined,
    modalidadeNome,
    situacaoCompraNome: raw?.situacao_nome || raw?.situacaoCompraNome || (raw?.cancelado ? "Cancelada" : "Divulgada no PNCP"),
    dataPublicacaoPncp: raw?.data_publicacao_pncp || raw?.createdAt || raw?.dataPublicacaoPncp || "",
    dataAberturaProposta: raw?.data_fim_vigencia || raw?.data_inicio_vigencia || raw?.dataAberturaProposta || "",
    valorTotalEstimado: valorGlobal,
    orgaoEntidade: {
      cnpj,
      razaoSocial: orgaoNome,
    },
    unidadeOrgao: {
      ufSigla,
      municipioNome,
      codigoUnidade,
      nomeUnidade,
    },
    uasg: codigoUnidade
      ? `UASG ${codigoUnidade}${nomeUnidade ? ` - ${nomeUnidade}` : ""}`
      : "",
    linkPNCP: cnpj ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${String(sequencial).padStart(6, "0")}` : "",
    fontePNCP: true,
  };
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
 * Decompõe o número de controle PNCP ("79151312000156-1-000501/2026") ou uma
 * URL direta do PNCP ("https://pncp.gov.br/app/editais/79151312000156/2026/000501")
 * nas partes usadas pelas consultas de detalhe, itens e arquivos.
 */
export function parseNumeroControlePNCP(
  numeroOuUrl: string,
): { cnpj: string; ano: string; sequencial: string } | null {
  const texto = String(numeroOuUrl || "").trim();
  if (!texto) return null;

  // 1. Formato Número de Controle PNCP: 79151312000156-1-000501/2026 ou 79151312000156-1-000501-2026
  const mControle = texto.match(/(\d{14})-\d+-(\d+)[/-](\d{4})/);
  if (mControle) {
    return { cnpj: mControle[1], sequencial: String(parseInt(mControle[2], 10)), ano: mControle[3] };
  }

  // 2. URL do Portal PNCP (/app/editais/CNPJ/ANO/SEQ ou /compras/CNPJ/ANO/SEQ ou /orgaos/CNPJ/compras/ANO/SEQ)
  const mUrl =
    texto.match(/pncp\.gov\.br\/(?:app\/)?(?:editais|compras)\/(\d{14})\/(\d{4})\/(\d{1,8})/i) ||
    texto.match(/orgaos\/(\d{14})\/compras\/(\d{4})\/(\d{1,8})/i);
  if (mUrl) {
    return { cnpj: mUrl[1], ano: mUrl[2], sequencial: String(parseInt(mUrl[3], 10)) };
  }

  // 3. Formato direto CNPJ/ANO/SEQ (ex.: 79151312000156/2026/000501)
  const mBarra = texto.match(/\b(\d{14})\/(\d{4})\/(\d{1,8})\b/);
  if (mBarra) {
    return { cnpj: mBarra[1], ano: mBarra[2], sequencial: String(parseInt(mBarra[3], 10)) };
  }

  return null;
}

/**
 * Pontua um arquivo publicado no PNCP para identificar Edital e Termo de Referência.
 */
function pontuarArquivoPncp(arq: { titulo?: string; tipo?: string; uri?: string }): {
  pontos: number;
  categoria: "edital" | "tr" | "anexo" | "descartar";
} {
  const texto = `${arq?.titulo || ""} ${arq?.tipo || ""}`.toLowerCase();
  let pontos = 0;
  let categoria: "edital" | "tr" | "anexo" | "descartar" = "anexo";

  if (/\bedital\b|aviso de (?:contrata|dispensa|licita)/.test(texto)) {
    pontos += 100;
    categoria = "edital";
  } else if (/termo de refer[eê]n|\btr\b|projeto b[aá]sico|estudo t[eé]cnico/.test(texto)) {
    pontos += 70;
    categoria = "tr";
  } else if (/anexo/.test(texto)) {
    pontos += 20;
    categoria = "anexo";
  }

  // Retificação e errata alteram o edital, mas sozinhas não o substituem:
  // analisar só a errata daria uma leitura incompleta do certame.
  if (/retifica|errata|adendo|esclarecimento|impugna/.test(texto)) {
    pontos -= 50;
  }
  // Ata e resultado são posteriores à disputa, não servem para decidir se vale participar.
  if (/ata\b|resultado|homologa|adjudica/.test(texto)) {
    pontos -= 60;
    categoria = "descartar";
  }

  if (/\.pdf\b|pdf/.test(texto)) pontos += 10;
  if (/\.zip\b|\.rar\b/.test(texto)) pontos -= 30;
  if (/\.xls|\.xlsx|planilha/.test(texto)) pontos -= 20;
  if (/\.jpg|\.jpeg|\.png/.test(texto)) pontos -= 40;

  return { pontos, categoria };
}

/**
 * Escolhe, entre os arquivos publicados, qual é o edital principal.
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

  let melhor: T | null = null;
  let melhorPontuacao = -Infinity;
  for (const arq of arquivos) {
    if (!arq?.uri) continue;
    const { pontos } = pontuarArquivoPncp(arq);
    if (pontos > melhorPontuacao) {
      melhorPontuacao = pontos;
      melhor = arq;
    }
  }

  return melhorPontuacao > 0 ? melhor : null;
}

/**
 * Seleciona os documentos principais da contratação no PNCP para leitura conjunta
 * pela IA: o **Edital** principal + o **Termo de Referência / Projeto Básico**
 * (quando publicado em arquivo separado).
 *
 * Em muitas licitações o Edital traz apenas as regras jurídicas e de habilitação,
 * enquanto as especificações técnicas e quantitativos dos itens ficam no Termo
 * de Referência. Ler os dois automaticamente no servidor garante análise completa.
 */
export function escolherArquivosPrincipaisEdital<T extends { titulo?: string; tipo?: string; uri?: string }>(
  arquivos: T[],
  limite = 2,
): T[] {
  if (!Array.isArray(arquivos) || arquivos.length === 0) return [];

  const avaliados = arquivos
    .filter(arq => Boolean(arq?.uri))
    .map(arq => ({ arq, ...pontuarArquivoPncp(arq) }))
    .filter(item => item.pontos > 0 && item.categoria !== "descartar")
    .sort((a, b) => b.pontos - a.pontos);

  if (avaliados.length === 0) return [];

  const selecionados: T[] = [];
  const urisVistas = new Set<string>();

  // 1. Garante o melhor Edital (ou o documento de maior pontuação geral)
  const principal = avaliados[0];
  selecionados.push(principal.arq);
  if (principal.arq.uri) urisVistas.add(principal.arq.uri);

  // 2. Se o principal é um Edital e há um Termo de Referência separado, inclui o TR também
  if (selecionados.length < limite) {
    const melhorTr = avaliados.find(
      item => item.categoria === "tr" && item.arq.uri && !urisVistas.has(item.arq.uri),
    );
    if (melhorTr) {
      selecionados.push(melhorTr.arq);
      if (melhorTr.arq.uri) urisVistas.add(melhorTr.arq.uri);
    }
  }

  // 3. Caso ainda haja espaço e outro documento relevante (ex: Anexo I de especificações), adiciona
  for (const item of avaliados) {
    if (selecionados.length >= limite) break;
    if (item.arq.uri && !urisVistas.has(item.arq.uri) && item.pontos >= 25) {
      selecionados.push(item.arq);
      urisVistas.add(item.arq.uri);
    }
  }

  return selecionados;
}

/**
 * Como tratar o status que o PNCP devolveu, para o teste de contrato.
 *
 * "contrato" significa: o portal recusou uma consulta que consideramos VÁLIDA,
 * e portanto a premissa da plataforma mudou. É o único caso que deve soar
 * alarme.
 */
export function classificarStatusPncp(status: number): "ok" | "portal" | "contrato" {
  if (status === 429 || status === 408 || status === 425) return "portal";
  if (status >= 500) return "portal";
  if (status >= 400) return "contrato";
  return "ok";
}
