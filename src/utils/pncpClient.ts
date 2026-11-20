import { urlDaApi, cabecalhosDaApi } from "./apiBase";
import {
  PNCP_MODALIDADES,
  chaveContratacao,
  escolherArquivosPrincipaisEdital,
  formatarDataPncp,
  montarQueryBuscaIndexadaPncp,
  montarQueryContratacoes,
  normalizarItemBuscaIndexadaPncp,
  parseNumeroControlePNCP,
  type StatusBuscaPncp,
} from "./pncpQuery";

export interface ParametrosBuscaPncpCliente {
  pagina: number;
  tamanhoPagina: number;
  status: StatusBuscaPncp;
  q?: string;
  municipio?: string;
  ufs?: string[];
  modalidades?: string[];
  periodDays?: number;
}

export interface RespostaBuscaPncpCliente {
  data: any[];
  totalRegistros: number;
  totalPaginas: number;
  numeroPagina: number;
  resultadoParcial: boolean;
  avisosPNCP: string[];
  source: string;
  aviso?: string;
}

export interface ArquivoAnexoPronto {
  id: string;
  name: string;
  size: string;
  type: string;
  base64: string;
}

export interface ItemPrecoPncp {
  numeroItem: number;
  descricao: string;
  quantidade: number;
  unidadeMedida: string;
  valorUnitarioEstimado: number;
  valorTotal: number;
  situacaoCompraItemNome?: string;
}

export interface PacoteOficialPncp {
  numeroControlePNCP: string;
  cnpj: string;
  ano: string;
  sequencial: string;
  linkPNCP: string;
  detalhe: any | null;
  itens: any[];
  arquivos: Array<{ sequencialDocumento?: number; titulo?: string; tipo?: string; uri?: string; dataPublicacao?: string }>;
  anexosBaixados: ArquivoAnexoPronto[];
  nomesArquivosLidos: string[];
  textoOficialEstruturado: string;
}

const PNCP_SEARCH_URL = "https://pncp.gov.br/api/search/";
const PNCP_CONSULTA_URL = "https://pncp.gov.br/api/consulta/v1/contratacoes";
const PNCP_INTEGRACAO_URL = "https://pncp.gov.br/api/pncp/v1/orgaos";

export interface DetalhePrecoPncp {
  valorTotalEstimado: number;
  valorTotalHomologado: number;
  orcamentoSigiloso: boolean;
  dataAberturaProposta?: string;
  dataEncerramentoProposta?: string;
  processo?: string;
  numeroCompra?: string;
}

// Cache em memória dos preços e itens oficiais de cada contratação para evitar
// requisições repetidas ao paginar ou alternar entre oportunidades no Radar.
const detalhesPrecoCache = new Map<string, DetalhePrecoPncp>();

const itensCompraCache = new Map<string, ItemPrecoPncp[]>();

async function fetchComTimeout(url: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizarItemConsultaDireta(item: any): any {
  const cnpj = item?.orgaoEntidade?.cnpj || item?.cnpjOrgao || "";
  const ano = item?.anoCompra || new Date().getFullYear();
  const sequencial = item?.sequencialCompra || 0;
  const seqPadded = String(sequencial).padStart(6, "0");
  const numeroControle =
    item?.numeroControlePNCP || (cnpj ? `${cnpj}-1-${seqPadded}/${ano}` : "");
  const modalidadeId = item?.modalidadeId != null ? String(item.modalidadeId) : "";

  return {
    ...item,
    numeroControlePNCP: numeroControle,
    idContratacaoPNCP: numeroControle,
    cnpjOrgao: cnpj,
    anoCompra: ano,
    sequencialCompra: sequencial,
    modalidadeNome: item?.modalidadeNome || PNCP_MODALIDADES[modalidadeId] || "Pregão Eletrônico",
    uasg: item?.unidadeOrgao?.codigoUnidade
      ? `UASG ${item.unidadeOrgao.codigoUnidade} - ${item.unidadeOrgao.nomeUnidade || item.unidadeOrgao.municipioNome || "Unidade Compradora"}`
      : "",
    linkPNCP: cnpj ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seqPadded}` : "",
    fontePNCP: true,
  };
}

/**
 * Busca os itens oficiais e seus preços unitários/totais para uma contratação do PNCP.
 */
export async function listarItensCompraPncp(numeroControleOuUrl: string): Promise<ItemPrecoPncp[]> {
  const alvo = parseNumeroControlePNCP(numeroControleOuUrl);
  if (!alvo) return [];

  const seqNum = Number(alvo.sequencial);
  const chave = `${alvo.cnpj}-1-${String(seqNum).padStart(6, "0")}/${alvo.ano}`;
  const emCache = itensCompraCache.get(chave);
  if (emCache) return emCache;

  try {
    const urlItens = `${PNCP_INTEGRACAO_URL}/${alvo.cnpj}/compras/${alvo.ano}/${seqNum}/itens?pagina=1&tamanhoPagina=200`;
    const resp = await fetchComTimeout(urlItens, { headers: { Accept: "application/json" } }, 9_000);
    if (!resp.ok) return [];
    const json = await resp.json().catch(() => null);
    const brutos = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];

    const normalizados: ItemPrecoPncp[] = brutos.map((it: any, idx: number) => {
      const qtd = Number(it?.quantidade) || 1;
      const vUnit =
        typeof it?.valorUnitarioEstimado === "number"
          ? it.valorUnitarioEstimado
          : Number(it?.valorUnitarioEstimado) || 0;
      const vTot =
        typeof it?.valorTotal === "number" && it.valorTotal > 0
          ? it.valorTotal
          : vUnit > 0
            ? vUnit * qtd
            : 0;
      return {
        numeroItem: Number(it?.numeroItem) || idx + 1,
        descricao: String(it?.descricao || it?.materialOuServicoNome || `Item ${idx + 1}`).trim(),
        quantidade: qtd,
        unidadeMedida: String(it?.unidadeMedida || "UN").trim(),
        valorUnitarioEstimado: vUnit,
        valorTotal: vTot,
        situacaoCompraItemNome: it?.situacaoCompraItemNome || "",
      };
    });

    itensCompraCache.set(chave, normalizados);
    return normalizados;
  } catch {
    return [];
  }
}

function extrairAlvoContratacaoItem(item: any): { cnpj: string; ano: string; sequencial: string; chave: string } | null {
  const numControle = item?.numeroControlePNCP || item?.idContratacaoPNCP || "";
  const alvo =
    parseNumeroControlePNCP(numControle) ||
    (item?.cnpjOrgao && item?.anoCompra && item?.sequencialCompra
      ? {
          cnpj: String(item.cnpjOrgao).replace(/\D/g, ""),
          ano: String(item.anoCompra),
          sequencial: String(Number(item.sequencialCompra)),
        }
      : null);

  if (!alvo || alvo.cnpj.length !== 14) return null;
  const chave = `${alvo.cnpj}-1-${String(Number(alvo.sequencial)).padStart(6, "0")}/${alvo.ano}`;
  return { ...alvo, chave };
}

/**
 * Resolve o preço real de uma única contratação consultando `/compras/{ano}/{seq}`
 * e, se o preço vier zerado ou se a chamada do cabeçalho falhar, consulta diretamente
 * `/compras/{ano}/{seq}/itens` para somar o valor total dos itens.
 */
export async function resolverPrecoContratacaoPncp(numeroControleOuUrl: string): Promise<DetalhePrecoPncp | null> {
  const alvo = parseNumeroControlePNCP(numeroControleOuUrl);
  if (!alvo || alvo.cnpj.length !== 14) return null;

  const seqNum = Number(alvo.sequencial);
  const chave = `${alvo.cnpj}-1-${String(seqNum).padStart(6, "0")}/${alvo.ano}`;
  const emCache = detalhesPrecoCache.get(chave);
  if (emCache) return emCache;

  let vEstimado = 0;
  let vHomologado = 0;
  let sigiloso = false;
  let dataAberturaProposta: string | undefined;
  let dataEncerramentoProposta: string | undefined;
  let processo: string | undefined;
  let numeroCompra: string | undefined;
  let respondeuDetalhe = false;

  try {
    const urlCompra = `${PNCP_INTEGRACAO_URL}/${alvo.cnpj}/compras/${alvo.ano}/${seqNum}`;
    const resp = await fetchComTimeout(urlCompra, { headers: { Accept: "application/json" } }, 8_000);
    if (resp.ok) {
      const det = await resp.json().catch(() => null);
      if (det) {
        respondeuDetalhe = true;
        vEstimado =
          typeof det.valorTotalEstimado === "number" && det.valorTotalEstimado > 0
            ? det.valorTotalEstimado
            : Number(det.valorTotalEstimado) || 0;
        vHomologado =
          typeof det.valorTotalHomologado === "number" && det.valorTotalHomologado > 0
            ? det.valorTotalHomologado
            : Number(det.valorTotalHomologado) || 0;
        sigiloso = Boolean(det.orcamentoSigiloso);
        dataAberturaProposta = det.dataAberturaProposta || undefined;
        dataEncerramentoProposta = det.dataEncerramentoProposta || undefined;
        processo = det.processo || undefined;
        numeroCompra = det.numeroCompra || undefined;
      }
    }
  } catch {
    // Mesmo que o endpoint de cabeçalho falhe ou demore, seguimos para o fallback direto em /itens
  }

  // Fallback direto na soma dos itens (/itens) sempre que o valor estimado ainda for <= 0 e não for sigiloso
  if (vEstimado <= 0 && !sigiloso) {
    const itens = await listarItensCompraPncp(chave);
    if (itens.length > 0) {
      respondeuDetalhe = true;
      const somaItens = itens.reduce((acc, it) => acc + (it.valorTotal > 0 ? it.valorTotal : 0), 0);
      if (somaItens > 0) {
        vEstimado = somaItens;
      }
    }
  }

  if (!respondeuDetalhe && vEstimado <= 0 && vHomologado <= 0) {
    return null;
  }

  const resultado: DetalhePrecoPncp = {
    valorTotalEstimado: vEstimado,
    valorTotalHomologado: vHomologado,
    orcamentoSigiloso: sigiloso,
    dataAberturaProposta,
    dataEncerramentoProposta,
    processo,
    numeroCompra,
  };

  detalhesPrecoCache.set(chave, resultado);
  return resultado;
}

/**
 * Aplica imediatamente os preços que já vieram na resposta da busca ou que já
 * estão no cache em memória, e marca `precoPendente: true` nos itens que ainda
 * precisam ser consultados na fila em segundo plano.
 */
export function aplicarCachePrecosContratacoesPncp(items: any[]): any[] {
  if (!Array.isArray(items) || items.length === 0) return items;

  return items.map((item) => {
    const valorAtual =
      typeof item?.valorTotalEstimado === "number"
        ? item.valorTotalEstimado
        : Number(item?.valorTotalEstimado) || 0;
    const homologadoAtual =
      typeof item?.valorTotalHomologado === "number"
        ? item.valorTotalHomologado
        : Number(item?.valorTotalHomologado) || 0;

    const alvo = extrairAlvoContratacaoItem(item);
    if (!alvo) {
      return { ...item, precoPendente: false };
    }

    if (valorAtual > 0 || homologadoAtual > 0) {
      detalhesPrecoCache.set(alvo.chave, {
        valorTotalEstimado: valorAtual,
        valorTotalHomologado: homologadoAtual,
        orcamentoSigiloso: Boolean(item?.orcamentoSigiloso),
      });
      return { ...item, precoPendente: false };
    }

    const cached = detalhesPrecoCache.get(alvo.chave);
    if (cached) {
      return {
        ...item,
        valorTotalEstimado: cached.valorTotalEstimado > 0 ? cached.valorTotalEstimado : valorAtual,
        valorTotalHomologado: cached.valorTotalHomologado,
        orcamentoSigiloso: cached.orcamentoSigiloso,
        dataAberturaProposta:
          item.dataAberturaProposta || cached.dataAberturaProposta || cached.dataEncerramentoProposta || "",
        processo: item.processo || cached.processo || "",
        numeroCompra: item.numeroCompra || cached.numeroCompra || "",
        precoPendente: false,
      };
    }

    return {
      ...item,
      precoPendente: true,
    };
  });
}

/**
 * Processa em fila com concorrência controlada (4 contratações por vez) todos os
 * itens que estão com `precoPendente`, evitando congestionamento de conexões do
 * navegador e revelando o preço de cada card progressivamente na tela sem precisar clicar.
 */
export async function enriquecerPrecosEmSegundoPlano(
  items: Array<{ numeroControlePNCP: string; precoPendente?: boolean }>,
  onItemAtualizado: (numeroControlePNCP: string, detalhe: DetalhePrecoPncp | null) => void,
  opcoes?: { concorrencia?: number; shouldCancel?: () => boolean }
): Promise<void> {
  const pendentes = items.filter((it) => it && it.numeroControlePNCP && it.precoPendente !== false);
  if (pendentes.length === 0) return;

  const concorrencia = Math.max(1, Math.min(6, opcoes?.concorrencia ?? 4));
  let cursor = 0;

  const worker = async () => {
    while (cursor < pendentes.length) {
      if (opcoes?.shouldCancel?.()) return;
      const atual = pendentes[cursor++];
      if (!atual?.numeroControlePNCP) continue;

      const detalhe = await resolverPrecoContratacaoPncp(atual.numeroControlePNCP);
      if (opcoes?.shouldCancel?.()) return;
      onItemAtualizado(atual.numeroControlePNCP, detalhe);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concorrencia, pendentes.length) }, () => worker())
  );
}

/**
 * Busca contratações no PNCP priorizando chamadas diretas do navegador do usuário
 * (que está no Brasil e responde em < 1s no índice `/api/search/`), com enriquecimento
 * automático dos preços reais da disputa e fallback para a API de consulta e Edge Function.
 */
export async function buscarContratacoesPncp(
  params: ParametrosBuscaPncpCliente
): Promise<RespostaBuscaPncpCliente> {
  const pageNum = Math.max(1, params.pagina || 1);
  const pageSize = Math.min(100, Math.max(1, params.tamanhoPagina || 15));
  const selectedUfs = params.ufs || [];
  const selectedModalidades = params.modalidades || [];
  const q = String(params.q || "").trim();
  const municipio = String(params.municipio || "").trim();

  // 1ª Camada: Índice Oficial de Busca do PNCP (/api/search/) direto do navegador
  try {
    const queryCombinada = [q, !/^\d+$/.test(municipio) ? municipio : ""]
      .filter(Boolean)
      .join(" ")
      .trim();

    const searchQuery = montarQueryBuscaIndexadaPncp({
      pagina: pageNum,
      tamanhoPagina: pageSize,
      status: params.status,
      q: queryCombinada || undefined,
      ufs: selectedUfs,
      modalidades: selectedModalidades,
    });

    const respSearch = await fetchComTimeout(
      `${PNCP_SEARCH_URL}?${searchQuery}`,
      { headers: { Accept: "application/json" } },
      12_000
    );

    if (respSearch.ok) {
      const json = await respSearch.json().catch(() => null);
      if (json && Array.isArray(json.items)) {
        const total = Number(json.total) || json.items.length;
        let normalizados = json.items.map((it: any) => normalizarItemBuscaIndexadaPncp(it));

        if (municipio && !/^\d+$/.test(municipio)) {
          const munLower = municipio.toLowerCase();
          normalizados = normalizados.filter((i: any) =>
            `${i.unidadeOrgao?.municipioNome || ""} ${i.orgaoEntidade?.razaoSocial || ""} ${i.objetoCompra || ""}`
              .toLowerCase()
              .includes(munLower)
          );
        }

        // Aplica imediatamente preços já em cache e marca os pendentes para a fila progressiva
        const enriquecidos = aplicarCachePrecosContratacoesPncp(normalizados);

        const totalPaginas = Math.max(1, Math.ceil(total / pageSize));
        return {
          data: enriquecidos,
          totalRegistros: total,
          totalPaginas,
          numeroPagina: pageNum,
          resultadoParcial: false,
          avisosPNCP: [],
          source: "pncp_api_real",
        };
      }
    }
  } catch (err) {
    console.warn("[pncpClient] Busca direta em /api/search/ indisponível, tentando próxima camada:", err);
  }

  // 2ª Camada: API Oficial de Consulta (/api/consulta/v1/contratacoes/...) direto do navegador
  try {
    const endpoint = params.status === "recebendo_proposta" ? "proposta" : "publicacao";
    const hoje = new Date();
    const inicio = new Date();
    inicio.setDate(hoje.getDate() - (params.periodDays || 90));
    const horizonte = new Date();
    horizonte.setDate(hoje.getDate() + 365);

    const dataInicial = formatarDataPncp(inicio);
    const dataFinal = formatarDataPncp(endpoint === "proposta" ? horizonte : hoje);

    const modsAlvo = selectedModalidades.length > 0 ? selectedModalidades.slice(0, 4) : ["6", "8", "4"];
    const ufAlvo = selectedUfs.length === 1 ? selectedUfs[0] : undefined;

    const respostas = await Promise.all(
      modsAlvo.map(async (mod) => {
        const query = montarQueryContratacoes({
          endpoint,
          modalidade: mod,
          pagina: pageNum,
          tamanhoPagina: 50,
          dataInicial,
          dataFinal,
          uf: ufAlvo,
          municipio: /^\d+$/.test(municipio) ? municipio : undefined,
        });
        const r = await fetchComTimeout(
          `${PNCP_CONSULTA_URL}/${endpoint}?${query}`,
          { headers: { Accept: "application/json" } },
          15_000
        ).catch(() => null);
        if (!r || (!r.ok && r.status !== 204)) return null;
        if (r.status === 204) return { data: [], totalRegistros: 0 };
        return await r.json().catch(() => null);
      })
    );

    const vistos = new Set<string>();
    let agregados: any[] = [];
    let totalEstimado = 0;

    for (const body of respostas) {
      if (!body || !Array.isArray(body.data)) continue;
      totalEstimado += Number(body.totalRegistros) || body.data.length;
      for (const raw of body.data) {
        const chave = chaveContratacao(raw);
        if (!chave || vistos.has(chave)) continue;
        vistos.add(chave);
        agregados.push(normalizarItemConsultaDireta(raw));
      }
    }

    if (agregados.length > 0) {
      if (selectedUfs.length > 1) {
        agregados = agregados.filter((i) =>
          selectedUfs.includes(String(i.unidadeOrgao?.ufSigla || i.uf || "").toUpperCase())
        );
      }
      if (q) {
        const termo = q.toLowerCase();
        agregados = agregados.filter((i) =>
          `${i.objetoCompra || ""} ${i.orgaoEntidade?.razaoSocial || ""} ${i.unidadeOrgao?.nomeUnidade || ""} ${i.unidadeOrgao?.municipioNome || ""}`
            .toLowerCase()
            .includes(termo)
        );
      }
      if (municipio && !/^\d+$/.test(municipio)) {
        const munLower = municipio.toLowerCase();
        agregados = agregados.filter((i) =>
          String(i.unidadeOrgao?.municipioNome || "").toLowerCase().includes(munLower)
        );
      }

      agregados.sort((a, b) =>
        String(b.dataPublicacaoPncp || "").localeCompare(String(a.dataPublicacaoPncp || ""))
      );

      const totalFinal = q || municipio || selectedUfs.length > 1 ? agregados.length : Math.max(agregados.length, totalEstimado);
      const fatia = aplicarCachePrecosContratacoesPncp(agregados.slice(0, pageSize));
      return {
        data: fatia,
        totalRegistros: totalFinal,
        totalPaginas: Math.max(1, Math.ceil(totalFinal / pageSize)),
        numeroPagina: pageNum,
        resultadoParcial: false,
        avisosPNCP: [],
        source: "pncp_api_real",
      };
    }
  } catch (err) {
    console.warn("[pncpClient] Consulta direta /api/consulta/ indisponível, recorrendo ao proxy:", err);
  }

  // 3ª Camada: Proxy via Edge Function do Supabase (com cabeçalhos de autenticação)
  const queryParams = new URLSearchParams();
  if (selectedUfs.length > 0) queryParams.set("ufs", selectedUfs.join(","));
  if (selectedModalidades.length > 0) queryParams.set("modalidades", selectedModalidades.join(","));
  if (q) queryParams.set("q", q);
  if (municipio) queryParams.set("municipio", municipio);
  queryParams.set("status", params.status);
  queryParams.set("fonte", params.status === "recebendo_proposta" ? "proposta" : "publicacao");
  queryParams.set("periodDays", String(params.periodDays || 90));
  queryParams.set("pagina", String(pageNum));
  queryParams.set("tamanhoPagina", String(pageSize));

  const res = await fetchComTimeout(
    urlDaApi(`/api/pncp/contratacoes?${queryParams.toString()}`),
    { headers: cabecalhosDaApi() },
    55_000
  );

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (!json) {
      throw new Error(
        res.status === 504 || res.status === 502
          ? `A consulta ao PNCP passou do tempo limite (HTTP ${res.status}). Tente filtrar por um estado (UF) ou modalidade específica.`
          : `O servidor respondeu HTTP ${res.status} ao consultar o PNCP.`
      );
    }
    throw new Error(json?.error || `Falha ao comunicar com o servidor PNCP (HTTP ${res.status}).`);
  }

  const rawData = Array.isArray(json?.data) ? json.data : [];
  const data = aplicarCachePrecosContratacoesPncp(rawData);
  return {
    data,
    totalRegistros: Number(json?.totalRegistros) || data.length,
    totalPaginas: Number(json?.totalPaginas) || Math.max(1, Math.ceil((Number(json?.totalRegistros) || data.length) / pageSize)),
    numeroPagina: pageNum,
    resultadoParcial: Boolean(json?.resultadoParcial) && data.length > 0,
    avisosPNCP: Array.isArray(json?.avisosPNCP) ? json.avisosPNCP : [],
    source: json?.source || "pncp_api_real",
    aviso: json?.aviso,
  };
}

/**
 * Lista os arquivos oficiais publicados para uma contratação no PNCP,
 * tentando primeiro diretamente na API do PNCP e usando o proxy como fallback.
 */
export async function listarArquivosPncp(numeroControleOuUrl: string): Promise<Array<{ sequencialDocumento: number; titulo: string; tipo: string; uri: string; dataPublicacao?: string }>> {
  const alvo = parseNumeroControlePNCP(numeroControleOuUrl);
  if (!alvo) return [];

  try {
    const urlDireta = `${PNCP_INTEGRACAO_URL}/${alvo.cnpj}/compras/${alvo.ano}/${Number(alvo.sequencial)}/arquivos`;
    const resp = await fetchComTimeout(urlDireta, { headers: { Accept: "application/json" } }, 10_000);
    if (resp.ok) {
      const json = await resp.json().catch(() => null);
      const lista = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
      if (lista.length > 0) {
        return lista.map((doc: any, idx: number) => {
          const sequencialDocumento = doc?.sequencialDocumento ?? idx + 1;
          return {
            sequencialDocumento,
            titulo: doc?.titulo || doc?.nomeArquivo || `Documento ${sequencialDocumento}`,
            tipo: doc?.tipoDocumentoNome || doc?.tipoDocumentoDescricao || "Documento",
            dataPublicacao: doc?.dataPublicacaoPncp || doc?.dataPublicacao || "",
            uri:
              doc?.uri ||
              doc?.url ||
              `${PNCP_INTEGRACAO_URL}/${alvo.cnpj}/compras/${alvo.ano}/${Number(alvo.sequencial)}/arquivos/${sequencialDocumento}`,
          };
        });
      }
    }
  } catch {
    // Segue para o fallback via proxy
  }

  const res = await fetchComTimeout(
    urlDaApi(`/api/pncp/arquivos?numeroControle=${encodeURIComponent(`${alvo.cnpj}-1-${String(alvo.sequencial).padStart(6, "0")}/${alvo.ano}`)}`),
    { headers: cabecalhosDaApi() },
    15_000
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || "Não foi possível listar os arquivos deste edital no PNCP.");
  }
  return Array.isArray(json?.arquivos) ? json.arquivos : [];
}

/**
 * Baixa um arquivo do PNCP convertendo para base64, tentando primeiro direto
 * e usando o proxy `/api/pncp/arquivo` com cabeçalhos como fallback.
 */
export async function baixarArquivoPncpComoBase64(arq: { uri: string; titulo?: string }): Promise<ArquivoAnexoPronto | null> {
  if (!arq?.uri) return null;
  const rawTitle = arq.titulo || "Documento_PNCP.pdf";
  const nome = /\.\w{2,5}$/.test(rawTitle) ? rawTitle : `${rawTitle}.pdf`;

  let blob: Blob | null = null;

  try {
    const respDireta = await fetchComTimeout(arq.uri, {}, 20_000);
    if (respDireta.ok) {
      blob = await respDireta.blob();
    }
  } catch {
    // CORS ou bloqueio de redirecionamento — tenta pelo proxy
  }

  if (!blob) {
    try {
      const respProxy = await fetchComTimeout(
        urlDaApi(`/api/pncp/arquivo?uri=${encodeURIComponent(arq.uri)}&nome=${encodeURIComponent(nome)}`),
        { headers: cabecalhosDaApi() },
        25_000
      );
      if (respProxy.ok) {
        blob = await respProxy.blob();
      }
    } catch {
      return null;
    }
  }

  if (!blob || blob.size === 0 || blob.size > 25 * 1024 * 1024) return null;

  const base64: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split("base64,")[1] || "");
    reader.onerror = () => reject(new Error("Falha ao ler arquivo do PNCP."));
    reader.readAsDataURL(blob!);
  });

  if (!base64) return null;

  return {
    id: `pncp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: nome,
    size: `${(blob.size / 1024).toFixed(1)} KB`,
    type: blob.type && blob.type.includes("text") ? "text/plain" : "application/pdf",
    base64,
  };
}

/**
 * Busca o pacote completo de uma contratação no PNCP (Ficha Oficial + Todos os Itens
 * + Download automático do Edital e do Termo de Referência).
 */
export async function buscarPacoteOficialPncp(numeroControleOuUrl: string): Promise<PacoteOficialPncp | null> {
  const alvo = parseNumeroControlePNCP(numeroControleOuUrl);
  if (!alvo) return null;

  const seqNum = Number(alvo.sequencial);
  const seqPadded = String(seqNum).padStart(6, "0");
  const numeroControleFormatado = `${alvo.cnpj}-1-${seqPadded}/${alvo.ano}`;
  const linkPNCP = `https://pncp.gov.br/app/editais/${alvo.cnpj}/${alvo.ano}/${seqPadded}`;
  const baseCompraUrl = `${PNCP_INTEGRACAO_URL}/${alvo.cnpj}/compras/${alvo.ano}/${seqNum}`;

  const [detalhe, itensRaw, arquivos] = await Promise.all([
    fetchComTimeout(baseCompraUrl, { headers: { Accept: "application/json" } }, 10_000)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    fetchComTimeout(`${baseCompraUrl}/itens?pagina=1&tamanhoPagina=500`, { headers: { Accept: "application/json" } }, 12_000)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    listarArquivosPncp(numeroControleFormatado).catch(() => []),
  ]);

  const itens = Array.isArray(itensRaw)
    ? itensRaw
    : Array.isArray(itensRaw?.data)
      ? itensRaw.data
      : [];

  const principais = escolherArquivosPrincipaisEdital(arquivos, 2);
  const baixados = await Promise.all(
    principais.map((arq) =>
      baixarArquivoPncpComoBase64({ uri: arq.uri || "", titulo: arq.titulo }).catch(() => null)
    )
  );

  const anexosBaixados = baixados.filter((a): a is ArquivoAnexoPronto => Boolean(a));
  const nomesArquivosLidos = anexosBaixados.map((a) => a.name);

  const linhasTexto: string[] = [
    `DADOS OFICIAIS DA CONTRATAÇÃO NO PNCP (${numeroControleFormatado}):`,
    `Link Oficial PNCP: ${linkPNCP}`,
  ];

  if (detalhe) {
    const orgao = detalhe.orgaoEntidade?.razaoSocial || detalhe.orgaoEntidade?.nomeRazaoSocial;
    if (orgao) linhasTexto.push(`Órgão Comprador: ${orgao} (CNPJ: ${alvo.cnpj})`);
    if (detalhe.unidadeOrgao?.codigoUnidade) {
      linhasTexto.push(
        `Unidade Compradora / UASG: ${detalhe.unidadeOrgao.codigoUnidade} - ${detalhe.unidadeOrgao.nomeUnidade || ""}`
      );
    }
    const modNome = detalhe.modalidadeNome || PNCP_MODALIDADES[String(detalhe.modalidadeId || "")];
    if (modNome) linhasTexto.push(`Modalidade: ${modNome}`);
    if (detalhe.numeroCompra || detalhe.processo) {
      linhasTexto.push(`Número / Processo: ${detalhe.numeroCompra || detalhe.processo}/${detalhe.anoCompra || alvo.ano}`);
    }
    if (detalhe.objetoCompra) {
      linhasTexto.push(`Objeto Oficial: ${detalhe.objetoCompra}`);
    }
    if (typeof detalhe.valorTotalEstimado === "number" && detalhe.valorTotalEstimado > 0) {
      linhasTexto.push(
        `Valor Total Estimado Oficial: R$ ${detalhe.valorTotalEstimado.toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      );
    }
    if (detalhe.dataAberturaProposta) {
      linhasTexto.push(`Data de Abertura / Sessão: ${new Date(detalhe.dataAberturaProposta).toLocaleString("pt-BR")}`);
    }
  }

  if (itens.length > 0) {
    linhasTexto.push("");
    linhasTexto.push(`RELAÇÃO OFICIAL DE ITENS PUBLICADOS NO PNCP (${itens.length} itens):`);
    for (let i = 0; i < Math.min(itens.length, 250); i++) {
      const it = itens[i];
      const num = it.numeroItem ?? i + 1;
      const desc = it.descricao || it.materialOuServicoNome || "Item da contratação";
      const qtd = it.quantidade ?? 1;
      const und = it.unidadeMedida || "Unidade";
      const vUnit =
        typeof it.valorUnitarioEstimado === "number"
          ? `R$ ${it.valorUnitarioEstimado.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : "Não informado no PNCP";
      linhasTexto.push(`- Item ${num}: ${desc} | Quantidade: ${qtd} ${und} | Valor Unitário Estimado: ${vUnit}`);
    }
  }

  return {
    numeroControlePNCP: numeroControleFormatado,
    cnpj: alvo.cnpj,
    ano: String(alvo.ano),
    sequencial: String(seqNum),
    linkPNCP,
    detalhe,
    itens,
    arquivos,
    anexosBaixados,
    nomesArquivosLidos,
    textoOficialEstruturado: linhasTexto.join("\n"),
  };
}
