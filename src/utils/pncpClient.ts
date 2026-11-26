import { urlDaApi, cabecalhosDaApi } from "./apiBase";
import { formatarDataPncpBrasilia } from "./disputaDates";
import {
  PNCP_MODALIDADES,
  chaveContratacao,
  classificarFormatoDocumentoPncp,
  escolherArquivosPrincipaisEdital,
  formatarDataPncp,
  montarQueryBuscaIndexadaPncp,
  montarQueryContratacoes,
  normalizarItemBuscaIndexadaPncp,
  normalizarTextoBuscaPncp,
  parseNumeroControlePNCP,
  type StatusBuscaPncp,
} from "./pncpQuery";

export interface ParametrosBuscaPncpCliente {
  pagina: number;
  tamanhoPagina: number;
  status: StatusBuscaPncp;
  q?: string;
  pncpLinkOrId?: string;
  municipio?: string;
  ufs?: string[];
  modalidades?: string[];
  fontes?: string[];
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
const PNCP_CONSULTA_ORGAOS_URL = "https://pncp.gov.br/api/consulta/v1/orgaos";
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

  const modalidadeNome = item?.modalidadeNome || PNCP_MODALIDADES[modalidadeId] || "Pregão Eletrônico";
  const tipoInstrumento = item?.tipoInstrumentoConvocatorioNome || "Edital";
  const numCompra = item?.numeroCompra || sequencial;
  const tituloDocumento =
    item?.tituloDocumento || `${tipoInstrumento} nº ${numCompra}/${ano}`;

  return {
    ...item,
    numeroControlePNCP: numeroControle,
    idContratacaoPNCP: numeroControle,
    cnpjOrgao: cnpj,
    anoCompra: ano,
    sequencialCompra: sequencial,
    tituloDocumento,
    modalidadeNome,
    fonteId: item?.usuarioId != null ? String(item.usuarioId) : item?.fonteId || "",
    fonteNome: item?.usuarioNome || item?.fonteNome || "",
    dataAtualizacaoPncp: item?.dataAtualizacao || item?.dataPublicacaoPncp || "",
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
        dataEncerramentoProposta:
          item.dataEncerramentoProposta || cached.dataEncerramentoProposta || "",
        dataAberturaProposta:
          item.dataAberturaProposta || cached.dataEncerramentoProposta || cached.dataAberturaProposta || "",
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
 * Busca diretamente uma contratação específica a partir do link oficial do PNCP
 * (ex: `https://pncp.gov.br/app/editais/00394460000141/2026/000123`) ou do
 * Número de Controle PNCP (ex: `00394460000141-1-000123/2026`).
 */
export async function buscarContratacaoPorLinkOuIdPncp(
  linkOuIdBruto: string
): Promise<RespostaBuscaPncpCliente | null> {
  const texto = String(linkOuIdBruto || "").trim();
  if (!texto) return null;

  const alvo = parseNumeroControlePNCP(texto);

  // 1. Se conseguimos extrair CNPJ + Ano + Sequencial do link ou ID, busca o registro exato na API oficial
  if (alvo && alvo.cnpj.length === 14) {
    const seqNum = Number(alvo.sequencial);
    const seqPadded = String(seqNum).padStart(6, "0");
    const numeroControle = `${alvo.cnpj}-1-${seqPadded}/${alvo.ano}`;

    try {
      const urlCompra = `${PNCP_INTEGRACAO_URL}/${alvo.cnpj}/compras/${alvo.ano}/${seqNum}`;
      const resp = await fetchComTimeout(urlCompra, { headers: { Accept: "application/json" } }, 10_000);
      if (resp.ok) {
        const det = await resp.json().catch(() => null);
        if (det) {
          let normalizado = normalizarItemConsultaDireta({
            ...det,
            numeroControlePNCP: det.numeroControlePNCP || numeroControle,
            cnpjOrgao: alvo.cnpj,
            anoCompra: Number(alvo.ano),
            sequencialCompra: seqNum,
          });

          const vEst =
            typeof normalizado.valorTotalEstimado === "number"
              ? normalizado.valorTotalEstimado
              : Number(normalizado.valorTotalEstimado) || 0;
          const vHom =
            typeof normalizado.valorTotalHomologado === "number"
              ? normalizado.valorTotalHomologado
              : Number(normalizado.valorTotalHomologado) || 0;

          if (vEst <= 0 && vHom <= 0 && !normalizado.orcamentoSigiloso) {
            const itens = await listarItensCompraPncp(numeroControle);
            if (itens.length > 0) {
              const soma = itens.reduce((acc, it) => acc + (it.valorTotal > 0 ? it.valorTotal : 0), 0);
              if (soma > 0) {
                normalizado = {
                  ...normalizado,
                  valorTotalEstimado: soma,
                  precoPendente: false,
                };
              }
            }
          }

          const enriquecidos = aplicarCachePrecosContratacoesPncp([normalizado]);
          return {
            data: enriquecidos,
            totalRegistros: 1,
            totalPaginas: 1,
            numeroPagina: 1,
            resultadoParcial: false,
            avisosPNCP: [],
            source: "pncp_api_real",
          };
        }
      }
    } catch (err) {
      console.warn("[pncpClient] Falha ao consultar endpoint direto da compra por link/ID:", err);
    }

    // 1b. Fallback via proxy do servidor (/api/pncp/contratacao) caso o navegador sofra CORS/instabilidade
    try {
      const respProxy = await fetchComTimeout(
        urlDaApi(`/api/pncp/contratacao?numeroControle=${encodeURIComponent(numeroControle)}`),
        { headers: cabecalhosDaApi() },
        15_000
      );
      if (respProxy.ok) {
        const payload = await respProxy.json().catch(() => null);
        const det = payload?.contratacao || payload;
        if (det && typeof det === "object" && (det.numeroControlePNCP || det.objetoCompra || det.orgaoEntidade)) {
          let normalizado = normalizarItemConsultaDireta({
            ...det,
            numeroControlePNCP: det.numeroControlePNCP || numeroControle,
            cnpjOrgao: alvo.cnpj,
            anoCompra: Number(alvo.ano),
            sequencialCompra: seqNum,
          });
          const itensProxy = Array.isArray(payload?.itens) ? payload.itens : [];
          if (
            (!normalizado.valorTotalEstimado || Number(normalizado.valorTotalEstimado) <= 0) &&
            !normalizado.orcamentoSigiloso &&
            itensProxy.length > 0
          ) {
            const soma = itensProxy.reduce((acc: number, it: any) => {
              const qtd = Number(it?.quantidade) || 1;
              const vUnit = Number(it?.valorUnitarioEstimado) || 0;
              const vTot = Number(it?.valorTotal) > 0 ? Number(it.valorTotal) : vUnit * qtd;
              return acc + (vTot > 0 ? vTot : 0);
            }, 0);
            if (soma > 0) {
              normalizado = { ...normalizado, valorTotalEstimado: soma, precoPendente: false };
            }
          }
          const enriquecidos = aplicarCachePrecosContratacoesPncp([normalizado]);
          return {
            data: enriquecidos,
            totalRegistros: 1,
            totalPaginas: 1,
            numeroPagina: 1,
            resultadoParcial: false,
            avisosPNCP: [],
            source: "pncp_api_real",
          };
        }
      }
    } catch {
      // prossegue para fallback no índice /api/search/
    }

    // Fallback no índice /api/search/ procurando pelo número de controle exato
    try {
      const qSearch = montarQueryBuscaIndexadaPncp({
        pagina: 1,
        tamanhoPagina: 10,
        status: "todos",
        q: numeroControle,
      });
      const respSearch = await fetchComTimeout(
        `${PNCP_SEARCH_URL}?${qSearch}`,
        { headers: { Accept: "application/json" } },
        10_000
      );
      if (respSearch.ok) {
        const json = await respSearch.json().catch(() => null);
        if (json && Array.isArray(json.items) && json.items.length > 0) {
          const normalizados = json.items.map((it: any) => normalizarItemBuscaIndexadaPncp(it));
          const enriquecidos = aplicarCachePrecosContratacoesPncp(normalizados);
          return {
            data: enriquecidos,
            totalRegistros: enriquecidos.length,
            totalPaginas: 1,
            numeroPagina: 1,
            resultadoParcial: false,
            avisosPNCP: [],
            source: "pncp_api_real",
          };
        }
      }
    } catch {
      // prossegue para fallback final
    }
  }

  // 2. Se o usuário colou uma URL de busca do PNCP (ex: https://pncp.gov.br/app/editais?q=...) ou termo de ID
  const urlMatchQ = texto.match(/[?&]q=([^&#]+)/i);
  const termoExtraido = urlMatchQ ? decodeURIComponent(urlMatchQ[1]).trim() : texto;

  try {
    const qSearch = montarQueryBuscaIndexadaPncp({
      pagina: 1,
      tamanhoPagina: 15,
      status: "todos",
      q: termoExtraido,
    });
    const respSearch = await fetchComTimeout(
      `${PNCP_SEARCH_URL}?${qSearch}`,
      { headers: { Accept: "application/json" } },
      10_000
    );
    if (respSearch.ok) {
      const json = await respSearch.json().catch(() => null);
      if (json && Array.isArray(json.items) && json.items.length > 0) {
        const normalizados = json.items.map((it: any) => normalizarItemBuscaIndexadaPncp(it));
        const enriquecidos = aplicarCachePrecosContratacoesPncp(normalizados);
        return {
          data: enriquecidos,
          totalRegistros: Number(json.total) || enriquecidos.length,
          totalPaginas: 1,
          numeroPagina: 1,
          resultadoParcial: false,
          avisosPNCP: [],
          source: "pncp_api_real",
        };
      }
    }
  } catch {
    // sem resultado
  }

  return {
    data: [],
    totalRegistros: 0,
    totalPaginas: 1,
    numeroPagina: 1,
    resultadoParcial: false,
    avisosPNCP: [],
    source: "pncp_api_real",
    aviso: "Nenhuma disputa encontrada no PNCP para o link ou ID informado. Verifique se o endereço está completo (ex: https://pncp.gov.br/app/editais/CNPJ/ANO/SEQUENCIAL).",
  };
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
  const selectedFontes = params.fontes || [];
  const q = String(params.q || "").trim();
  const pncpLinkOrId = String(params.pncpLinkOrId || "").trim();
  const municipio = String(params.municipio || "").trim();

  // 0ª Camada: Se o usuário preencheu o filtro de Link ou ID direto do PNCP (ou colou um link PNCP na busca)
  const linkCandidato = pncpLinkOrId || (parseNumeroControlePNCP(q) ? q : "");
  if (linkCandidato) {
    const direto = await buscarContratacaoPorLinkOuIdPncp(linkCandidato);
    if (direto) return direto;
  }

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
      fontes: selectedFontes,
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

        if (selectedUfs.length > 0) {
          const ufsPermitidas = new Set(selectedUfs.map((u) => u.trim().toUpperCase()).filter(Boolean));
          normalizados = normalizados.filter((i: any) => {
            const ufItem = String(i.unidadeOrgao?.ufSigla || i.uf || "").trim().toUpperCase();
            return !ufItem || ufItem === "BR" || ufsPermitidas.has(ufItem);
          });
        }

        if (selectedFontes.length > 0) {
          const fontesPermitidas = new Set(selectedFontes.map((f) => String(f).trim()).filter(Boolean));
          normalizados = normalizados.filter((i: any) => {
            const fId = String(i.fonteId || "").trim();
            return !fId || fontesPermitidas.has(fId);
          });
        }

        if (municipio && !/^\d+$/.test(municipio)) {
          const munNorm = normalizarTextoBuscaPncp(municipio);
          normalizados = normalizados.filter((i: any) =>
            normalizarTextoBuscaPncp(
              `${i.unidadeOrgao?.municipioNome || ""} ${i.orgaoEntidade?.razaoSocial || ""} ${i.objetoCompra || ""}`
            ).includes(munNorm)
          );
        }

        if (params.periodDays && params.periodDays > 0) {
          const corteMs = Date.now() - params.periodDays * 86_400_000;
          normalizados = normalizados.filter((i: any) => {
            const rawDate = i.dataPublicacaoPncp || i.dataAtualizacaoPncp;
            if (!rawDate) return true;
            const parsed = Date.parse(String(rawDate));
            if (!Number.isFinite(parsed)) return true;
            return parsed >= corteMs;
          });
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
        const ufsPermitidas = new Set(selectedUfs.map((u) => u.trim().toUpperCase()).filter(Boolean));
        agregados = agregados.filter((i) =>
          ufsPermitidas.has(String(i.unidadeOrgao?.ufSigla || i.uf || "").toUpperCase())
        );
      }
      if (selectedFontes.length > 0) {
        const fontesPermitidas = new Set(selectedFontes.map((f) => String(f).trim()).filter(Boolean));
        agregados = agregados.filter((i) => !i.fonteId || fontesPermitidas.has(String(i.fonteId).trim()));
      }
      if (q) {
        const termo = normalizarTextoBuscaPncp(q);
        agregados = agregados.filter((i) =>
          normalizarTextoBuscaPncp(
            `${i.objetoCompra || ""} ${i.orgaoEntidade?.razaoSocial || ""} ${i.unidadeOrgao?.nomeUnidade || ""} ${i.unidadeOrgao?.municipioNome || ""}`
          ).includes(termo)
        );
      }
      if (municipio && !/^\d+$/.test(municipio)) {
        const munNorm = normalizarTextoBuscaPncp(municipio);
        agregados = agregados.filter((i) =>
          normalizarTextoBuscaPncp(
            `${i.unidadeOrgao?.municipioNome || ""} ${i.orgaoEntidade?.razaoSocial || ""}`
          ).includes(munNorm)
        );
      }

      agregados.sort((a, b) =>
        String(b.dataPublicacaoPncp || "").localeCompare(String(a.dataPublicacaoPncp || ""))
      );

      const totalFinal =
        q || municipio || selectedUfs.length > 1 || selectedFontes.length > 0
          ? agregados.length
          : Math.max(agregados.length, totalEstimado);
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
  if (selectedFontes.length > 0) queryParams.set("fontes", selectedFontes.join(","));
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

function normalizarListaArquivosPncp(
  lista: any[],
  alvo: { cnpj: string; ano: string; sequencial: string }
): Array<{ sequencialDocumento: number; titulo: string; tipo: string; uri: string; dataPublicacao?: string }> {
  const sequenciaisUsados = new Set<number>();
  return lista.map((doc: any, idx: number) => {
    const seqBruto = Number(doc?.sequencialDocumento);
    let sequencialDocumento = Number.isFinite(seqBruto) && seqBruto > 0 ? seqBruto : idx + 1;
    while (sequenciaisUsados.has(sequencialDocumento)) {
      sequencialDocumento += 1;
    }
    sequenciaisUsados.add(sequencialDocumento);

    return {
      sequencialDocumento,
      titulo: String(doc?.titulo || doc?.nomeArquivo || `Documento ${sequencialDocumento}`).trim(),
      tipo: String(doc?.tipo || doc?.tipoDocumentoNome || doc?.tipoDocumentoDescricao || "Documento").trim(),
      dataPublicacao: doc?.dataPublicacaoPncp || doc?.dataPublicacao || "",
      uri:
        doc?.uri ||
        doc?.url ||
        `${PNCP_INTEGRACAO_URL}/${alvo.cnpj}/compras/${alvo.ano}/${Number(alvo.sequencial)}/arquivos/${seqBruto || idx + 1}`,
    };
  });
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
        return normalizarListaArquivosPncp(lista, alvo);
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
  return Array.isArray(json?.arquivos) ? normalizarListaArquivosPncp(json.arquivos, alvo) : [];
}

export interface ResultadoDownloadArquivoPncp {
  arquivo: ArquivoAnexoPronto | null;
  erro?: string;
  naoSuportado?: boolean;
  formatoDetectado?: string;
}

function extrairNomeDeContentDisposition(headerVal: string | null): string {
  if (!headerVal) return "";
  const utf8Match = headerVal.match(/filename\*\s*=\s*UTF-8''([^;\r\n]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return utf8Match[1].trim().replace(/^"|"$/g, "");
    }
  }
  const plainMatch = headerVal.match(/filename\s*=\s*"?([^";\r\n]+)"?/i);
  return plainMatch?.[1] ? plainMatch[1].trim() : "";
}

async function lerBytesIniciaisBlob(blob: Blob, tamanho = 512): Promise<Uint8Array | null> {
  try {
    const slice = blob.slice(0, tamanho);
    if (typeof slice.arrayBuffer === "function") {
      return new Uint8Array(await slice.arrayBuffer());
    }
  } catch {
    // fallback abaixo
  }
  return null;
}

function inspecionarFormatoArquivoBaixado(params: {
  bytes: Uint8Array | null;
  contentType: string;
  nomeArquivo: string;
}): { valido: boolean; mimeType: "application/pdf" | "text/plain"; formatoDetectado?: string; motivoErro?: string } {
  const ct = String(params.contentType || "").toLowerCase().split(";")[0].trim();
  const nomeLower = String(params.nomeArquivo || "").toLowerCase();
  const bytes = params.bytes;

  // 1. Inspeção de assinatura binária (magic bytes) — mais confiável que headers do PNCP
  if (bytes && bytes.length >= 4) {
    const asciiHead = Array.from(bytes.slice(0, Math.min(bytes.length, 256)))
      .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : " "))
      .join("");
    const trimmedHead = asciiHead.trimStart().toLowerCase();

    // PDF válido: "%PDF-" nos primeiros bytes
    if (asciiHead.includes("%PDF-")) {
      return { valido: true, mimeType: "application/pdf", formatoDetectado: "PDF" };
    }

    // ZIP / DOCX / XLSX / ODT / ODS (assinatura PK\x03\x04 ou PK\x05\x06)
    if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) {
      const extReal = nomeLower.endsWith(".xlsx") || nomeLower.endsWith(".xlsm")
        ? "planilha Excel (XLSX)"
        : nomeLower.endsWith(".docx")
          ? "documento Word (DOCX)"
          : nomeLower.endsWith(".odt") || nomeLower.endsWith(".ods")
            ? "documento OpenDocument (ODT/ODS)"
            : "arquivo compactado ZIP ou Office (DOCX/XLSX)";
      return {
        valido: false,
        mimeType: "application/pdf",
        formatoDetectado: extReal,
        motivoErro: `Não é um PDF — o arquivo baixado é um ${extReal}.`,
      };
    }

    // RAR ("Rar!")
    if (bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21) {
      return {
        valido: false,
        mimeType: "application/pdf",
        formatoDetectado: "RAR",
        motivoErro: "Não é um PDF — o arquivo baixado é um pacote compactado RAR.",
      };
    }

    // 7z
    if (bytes[0] === 0x37 && bytes[1] === 0x7a && bytes[2] === 0xbc && bytes[3] === 0xaf) {
      return {
        valido: false,
        mimeType: "application/pdf",
        formatoDetectado: "7Z",
        motivoErro: "Não é um PDF — o arquivo baixado é um pacote compactado 7Z.",
      };
    }

    // Legado Office OLE2 (.doc / .xls / .ppt)
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
      return {
        valido: false,
        mimeType: "application/pdf",
        formatoDetectado: "DOC/XLS",
        motivoErro: "Não é um PDF — o arquivo baixado é um documento Office antigo (DOC/XLS).",
      };
    }

    // Imagens (PNG / JPEG / GIF / BMP)
    if (
      (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) ||
      (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
      (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
    ) {
      return {
        valido: false,
        mimeType: "application/pdf",
        formatoDetectado: "Imagem",
        motivoErro: "Não é um PDF — o arquivo baixado é uma imagem (PNG/JPG/GIF).",
      };
    }

    // Página HTML de erro/redirecionamento retornada pelo portal
    if (trimmedHead.startsWith("<!doctype html") || trimmedHead.startsWith("<html")) {
      return {
        valido: false,
        mimeType: "application/pdf",
        formatoDetectado: "HTML",
        motivoErro: "O portal PNCP retornou uma página HTML de erro em vez do documento PDF.",
      };
    }
  }

  // 2. Checagem por Content-Type explícito quando não-PDF
  if (ct === "text/html") {
    return {
      valido: false,
      mimeType: "application/pdf",
      formatoDetectado: "HTML",
      motivoErro: "O portal PNCP retornou uma página HTML em vez do documento PDF.",
    };
  }
  if (
    ct.includes("zip") ||
    ct.includes("rar") ||
    ct.includes("spreadsheet") ||
    ct.includes("excel") ||
    ct.includes("wordprocessing") ||
    ct.includes("msword") ||
    ct.startsWith("image/")
  ) {
    return {
      valido: false,
      mimeType: "application/pdf",
      formatoDetectado: ct,
      motivoErro: `Não é um PDF (tipo retornado pelo PNCP: ${ct}).`,
    };
  }

  // 3. Checagem por extensão revelada no nome final
  const classificacaoNome = classificarFormatoDocumentoPncp({ titulo: params.nomeArquivo });
  if (!classificacaoNome.suportado) {
    return {
      valido: false,
      mimeType: "application/pdf",
      formatoDetectado: classificacaoNome.extensao?.replace(".", "").toUpperCase(),
      motivoErro: classificacaoNome.motivoNaoSuportado || "Formato de arquivo não é PDF.",
    };
  }

  if (ct === "text/plain" || ct === "text/csv" || ct === "text/markdown" || nomeLower.endsWith(".txt") || nomeLower.endsWith(".csv") || nomeLower.endsWith(".md")) {
    return { valido: true, mimeType: "text/plain", formatoDetectado: "TXT" };
  }

  return { valido: true, mimeType: "application/pdf", formatoDetectado: "PDF" };
}

/**
 * Baixa um arquivo do PNCP validando cabeçalho e assinatura binária para impedir
 * que arquivos ZIP, planilhas, Word ou páginas HTML sejam enviados como PDF para a IA.
 */
export async function baixarArquivoPncpDetalhado(arq: { uri: string; titulo?: string }): Promise<ResultadoDownloadArquivoPncp> {
  if (!arq?.uri) {
    return { arquivo: null, erro: "Endereço do documento ausente no PNCP." };
  }
  const rawTitle = String(arq.titulo || "Documento_PNCP").trim() || "Documento_PNCP";
  const nomeInicial = /\.\w{2,5}$/.test(rawTitle) ? rawTitle : `${rawTitle}.pdf`;

  let blob: Blob | null = null;
  let contentType = "";
  let nomeHeader = "";

  try {
    const respDireta = await fetchComTimeout(arq.uri, {}, 20_000);
    if (respDireta.ok) {
      contentType = respDireta.headers.get("content-type") || "";
      nomeHeader = extrairNomeDeContentDisposition(respDireta.headers.get("content-disposition"));
      blob = await respDireta.blob();
    }
  } catch {
    // CORS ou bloqueio de redirecionamento — tenta pelo proxy
  }

  if (!blob) {
    try {
      const respProxy = await fetchComTimeout(
        urlDaApi(`/api/pncp/arquivo?uri=${encodeURIComponent(arq.uri)}&nome=${encodeURIComponent(nomeInicial)}`),
        { headers: cabecalhosDaApi() },
        25_000
      );
      if (respProxy.ok) {
        contentType = respProxy.headers.get("content-type") || "";
        nomeHeader = extrairNomeDeContentDisposition(respProxy.headers.get("content-disposition"));
        blob = await respProxy.blob();
      }
    } catch {
      return {
        arquivo: null,
        erro: `Não foi possível baixar "${rawTitle}" do PNCP (falha de conexão).`,
      };
    }
  }

  if (!blob || blob.size === 0) {
    return { arquivo: null, erro: `"${rawTitle}" veio vazio ou indisponível no PNCP.` };
  }

  if (blob.size > 25 * 1024 * 1024) {
    const mb = (blob.size / (1024 * 1024)).toFixed(1);
    return {
      arquivo: null,
      erro: `"${rawTitle}" excede o limite de 25 MB (${mb} MB). Baixe-o e envie apenas as páginas principais.`,
    };
  }

  const nomeFinal = nomeHeader && /\.\w{2,5}$/.test(nomeHeader) ? nomeHeader : nomeInicial;
  const bytesIniciais = await lerBytesIniciaisBlob(blob);
  const inspecao = inspecionarFormatoArquivoBaixado({
    bytes: bytesIniciais,
    contentType: contentType || blob.type || "",
    nomeArquivo: nomeFinal,
  });

  if (!inspecao.valido) {
    return {
      arquivo: null,
      naoSuportado: true,
      formatoDetectado: inspecao.formatoDetectado,
      erro: `"${rawTitle}": ${inspecao.motivoErro}`,
    };
  }

  const base64: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split("base64,")[1] || "");
    reader.onerror = () => reject(new Error("Falha ao ler arquivo do PNCP."));
    reader.readAsDataURL(blob!);
  });

  if (!base64) {
    return { arquivo: null, erro: `Não foi possível ler o conteúdo de "${rawTitle}".` };
  }

  return {
    arquivo: {
      id: `pncp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: nomeFinal,
      size: `${(blob.size / 1024).toFixed(1)} KB`,
      type: inspecao.mimeType,
      base64,
    },
    formatoDetectado: inspecao.formatoDetectado,
  };
}

/**
 * Baixa um arquivo do PNCP convertendo para base64, tentando primeiro direto
 * e usando o proxy `/api/pncp/arquivo` com cabeçalhos como fallback.
 */
export async function baixarArquivoPncpComoBase64(arq: { uri: string; titulo?: string }): Promise<ArquivoAnexoPronto | null> {
  const resultado = await baixarArquivoPncpDetalhado(arq);
  return resultado.arquivo;
}

/**
 * Busca o pacote completo de uma contratação no PNCP (Ficha Oficial + Todos os Itens
 * + Download automático do Edital e do Termo de Referência).
 */
export async function buscarPacoteOficialPncp(
  numeroControleOuUrl: string,
  options?: { baixarArquivos?: boolean }
): Promise<PacoteOficialPncp | null> {
  const alvo = parseNumeroControlePNCP(numeroControleOuUrl);
  if (!alvo) return null;

  const baixarArquivos = options?.baixarArquivos !== false;
  const seqNum = Number(alvo.sequencial);
  const seqPadded = String(seqNum).padStart(6, "0");
  const numeroControleFormatado = `${alvo.cnpj}-1-${seqPadded}/${alvo.ano}`;
  const linkPNCP = `https://pncp.gov.br/app/editais/${alvo.cnpj}/${alvo.ano}/${seqPadded}`;
  const baseCompraUrl = `${PNCP_INTEGRACAO_URL}/${alvo.cnpj}/compras/${alvo.ano}/${seqNum}`;

  const [detalheDireto, itensRawDireto, arquivos] = await Promise.all([
    fetchComTimeout(baseCompraUrl, { headers: { Accept: "application/json" } }, 10_000)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    fetchComTimeout(`${baseCompraUrl}/itens?pagina=1&tamanhoPagina=500`, { headers: { Accept: "application/json" } }, 12_000)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    baixarArquivos ? listarArquivosPncp(numeroControleFormatado).catch(() => []) : Promise.resolve([]),
  ]);

  const baseConsultaUrl = `${PNCP_CONSULTA_ORGAOS_URL}/${alvo.cnpj}/compras/${alvo.ano}/${seqNum}`;
  let detalhe = detalheDireto;
  let itens = Array.isArray(itensRawDireto)
    ? itensRawDireto
    : Array.isArray(itensRawDireto?.data)
      ? itensRawDireto.data
      : [];

  // Se o endpoint de integração falhou ou não trouxe dataEncerramentoProposta, tenta o endpoint de consulta
  if (!detalhe || !detalhe.dataEncerramentoProposta) {
    try {
      const respConsulta = await fetchComTimeout(baseConsultaUrl, { headers: { Accept: "application/json" } }, 9_000);
      if (respConsulta.ok) {
        const detConsulta = await respConsulta.json().catch(() => null);
        if (detConsulta && typeof detConsulta === "object") {
          detalhe = detalhe ? { ...detConsulta, ...detalhe, dataEncerramentoProposta: detalhe.dataEncerramentoProposta || detConsulta.dataEncerramentoProposta, dataAberturaProposta: detalhe.dataAberturaProposta || detConsulta.dataAberturaProposta } : detConsulta;
        }
      }
    } catch {
      // prossegue para fallback via servidor
    }
  }

  // Fallback via servidor se o navegador não conseguiu consultar o cabeçalho/itens ou a data limite do PNCP
  if (!detalhe || (!detalhe.dataEncerramentoProposta && !detalhe.dataAberturaProposta) || itens.length === 0) {
    try {
      const respProxy = await fetchComTimeout(
        urlDaApi(`/api/pncp/contratacao?numeroControle=${encodeURIComponent(numeroControleFormatado)}`),
        { headers: cabecalhosDaApi() },
        15_000
      );
      if (respProxy.ok) {
        const payload = await respProxy.json().catch(() => null);
        if (payload?.contratacao) {
          detalhe = detalhe
            ? {
                ...payload.contratacao,
                ...detalhe,
                dataEncerramentoProposta:
                  detalhe.dataEncerramentoProposta ||
                  payload.contratacao.dataEncerramentoProposta ||
                  payload?.datasOficiais?.dataEncerramentoProposta,
                dataAberturaProposta:
                  detalhe.dataAberturaProposta ||
                  payload.contratacao.dataAberturaProposta ||
                  payload?.datasOficiais?.dataAberturaProposta,
              }
            : payload.contratacao;
        } else if (payload?.datasOficiais) {
          detalhe = {
            ...(detalhe || {}),
            dataEncerramentoProposta:
              detalhe?.dataEncerramentoProposta || payload.datasOficiais.dataEncerramentoProposta,
            dataAberturaProposta:
              detalhe?.dataAberturaProposta || payload.datasOficiais.dataAberturaProposta,
          };
        }
        if (itens.length === 0 && Array.isArray(payload?.itens)) itens = payload.itens;
      }
    } catch {
      // mantém dados disponíveis
    }
  }

  let anexosBaixados: ArquivoAnexoPronto[] = [];
  if (baixarArquivos) {
    const compativeis = arquivos.filter((arq) => classificarFormatoDocumentoPncp(arq).suportado);
    const principais = escolherArquivosPrincipaisEdital(compativeis.length > 0 ? compativeis : arquivos, 2);
    const baixados = await Promise.all(
      principais.map((arq) =>
        baixarArquivoPncpComoBase64({ uri: arq.uri || "", titulo: arq.titulo }).catch(() => null)
      )
    );
    anexosBaixados = baixados.filter((a): a is ArquivoAnexoPronto => Boolean(a));
  }
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
    if (detalhe.dataEncerramentoProposta) {
      linhasTexto.push(
        `Data de Encerramento das Propostas / Data Limite de Recebimento (PNCP): ${formatarDataPncpBrasilia(detalhe.dataEncerramentoProposta) || detalhe.dataEncerramentoProposta}`
      );
    }
    if (detalhe.dataAberturaProposta) {
      linhasTexto.push(
        `Data de Abertura do Recebimento de Propostas (PNCP): ${formatarDataPncpBrasilia(detalhe.dataAberturaProposta) || detalhe.dataAberturaProposta}`
      );
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

export interface DatasOficiaisPncp {
  dataEncerramentoProposta?: string;
  dataAberturaProposta?: string;
  linkPNCP?: string;
  numeroControlePNCP?: string;
}

export function extrairCamposDatasOficiaisPncp(
  raw: any,
  defaults?: { linkPNCP?: string; numeroControlePNCP?: string }
): DatasOficiaisPncp | null {
  if (!raw || typeof raw !== "object") return null;

  const dataEncerramentoProposta =
    raw.dataEncerramentoProposta ||
    raw.data_encerramento_proposta ||
    raw.dataFimRecebimentoProposta ||
    raw.data_fim_recebimento_propostas ||
    raw.dataLimiteRecebimentoProposta ||
    raw.data_limite_recebimento_propostas ||
    raw.dataFimVigencia ||
    raw.data_fim_vigencia ||
    undefined;

  const dataAberturaProposta =
    raw.dataAberturaProposta ||
    raw.data_abertura_proposta ||
    raw.dataInicioRecebimentoProposta ||
    raw.data_inicio_recebimento_propostas ||
    raw.dataInicioVigencia ||
    raw.data_inicio_vigencia ||
    undefined;

  if (!dataEncerramentoProposta && !dataAberturaProposta) return null;

  return {
    dataEncerramentoProposta: dataEncerramentoProposta ? String(dataEncerramentoProposta) : undefined,
    dataAberturaProposta: dataAberturaProposta ? String(dataAberturaProposta) : undefined,
    linkPNCP: raw.linkPNCP || defaults?.linkPNCP,
    numeroControlePNCP: raw.numeroControlePNCP || raw.idContratacaoPNCP || defaults?.numeroControlePNCP,
  };
}

/**
 * Consulta sob demanda os dados oficiais de uma contratação no PNCP para obter
 * a Data limite de recebimento (encerramento) e abertura das propostas.
 * Tenta em cascata: integração direta, consulta direta, proxy do servidor
 * (sem CORS) e busca indexada pelo número de controle.
 */
export async function buscarDataOficialPncp(linkOuNumeroControle: string): Promise<DatasOficiaisPncp | null> {
  const alvo = parseNumeroControlePNCP(linkOuNumeroControle);
  if (!alvo) return null;

  const seqNum = Number(alvo.sequencial) || 0;
  const seqPadded = String(seqNum).padStart(6, "0");
  const baseIntegracaoUrl = `${PNCP_INTEGRACAO_URL}/${alvo.cnpj}/compras/${alvo.ano}/${seqNum}`;
  const baseConsultaUrl = `${PNCP_CONSULTA_ORGAOS_URL}/${alvo.cnpj}/compras/${alvo.ano}/${seqNum}`;
  const numeroControlePNCP = `${alvo.cnpj}-1-${seqPadded}/${alvo.ano}`;
  const linkPNCP = `https://pncp.gov.br/app/editais/${alvo.cnpj}/${alvo.ano}/${seqPadded}`;
  const defaults = { linkPNCP, numeroControlePNCP };

  let melhorParcial: DatasOficiaisPncp | null = null;
  const registrar = (dados: DatasOficiaisPncp | null): DatasOficiaisPncp | null => {
    if (!dados) return null;
    if (dados.dataEncerramentoProposta) return dados;
    if (!melhorParcial) melhorParcial = dados;
    return null;
  };

  // 1. Endpoint oficial de integração PNCP
  try {
    const resp = await fetchComTimeout(baseIntegracaoUrl, { headers: { Accept: "application/json" } }, 9_000);
    if (resp.ok) {
      const pronto = registrar(extrairCamposDatasOficiaisPncp(await resp.json().catch(() => null), defaults));
      if (pronto) return pronto;
    }
  } catch {
    // prossegue para endpoint de consulta
  }

  // 2. Endpoint oficial de consulta PNCP
  try {
    const respConsulta = await fetchComTimeout(baseConsultaUrl, { headers: { Accept: "application/json" } }, 9_000);
    if (respConsulta.ok) {
      const pronto = registrar(extrairCamposDatasOficiaisPncp(await respConsulta.json().catch(() => null), defaults));
      if (pronto) return pronto;
    }
  } catch {
    // prossegue para proxy do servidor
  }

  // 3. Proxy do próprio servidor (sem CORS) — envia `numeroControle` corretamente
  try {
    const respProxy = await fetchComTimeout(
      urlDaApi(`/api/pncp/contratacao?numeroControle=${encodeURIComponent(numeroControlePNCP)}`),
      { headers: cabecalhosDaApi() },
      14_000
    );
    if (respProxy.ok) {
      const payload = await respProxy.json().catch(() => null);
      const pronto =
        registrar(extrairCamposDatasOficiaisPncp(payload?.datasOficiais, defaults)) ||
        registrar(extrairCamposDatasOficiaisPncp(payload?.contratacao, defaults)) ||
        registrar(extrairCamposDatasOficiaisPncp(payload, defaults));
      if (pronto) return pronto;
    }
  } catch {
    // prossegue para fallback na busca indexada
  }

  // 4. Fallback via busca por link/ID (lendo o 1º item de `res.data`)
  try {
    const res = await buscarContratacaoPorLinkOuIdPncp(linkOuNumeroControle).catch(() => null);
    const primeiro = Array.isArray(res?.data) ? res.data[0] : null;
    const pronto = registrar(extrairCamposDatasOficiaisPncp(primeiro, defaults));
    if (pronto) return pronto;
  } catch {
    // retorna melhor parcial abaixo
  }

  return melhorParcial;
}

export interface MetadadosBuscaDataPncp {
  orgao?: string;
  cnpj?: string;
  numeroLicitacao?: string;
  uasg?: string;
  objeto?: string;
}

function extrairNumeroEAnoMetadados(numeroLicitacao?: string): { numero: string; ano: string } | null {
  const bruto = String(numeroLicitacao || "").trim();
  if (!bruto) return null;
  const m = bruto.match(/(\d{1,6})\s*\/\s*(20\d{2})/);
  if (!m) return null;
  return { numero: String(parseInt(m[1], 10)), ano: m[2] };
}

function tokensOrgao(valor?: string): Set<string> {
  const stop = new Set([
    "de", "da", "do", "das", "dos", "para", "com", "em", "no", "na", "e",
    "prefeitura", "municipal", "secretaria", "estado", "governo", "ministerio",
    "municipio", "fundo", "instituto", "camara", "autarquia",
  ]);
  return new Set(
    normalizarTextoBuscaPncp(String(valor || ""))
      .split(" ")
      .filter((t) => t.length >= 3 && !stop.has(t))
  );
}

/**
 * Busca automaticamente no PNCP a contratação correspondente a um PDF enviado
 * do computador (sem link/ID PNCP explícito), cruzando CNPJ, número/ano do
 * certame, órgão e UASG, e retorna a Data limite de recebimento oficial.
 */
export async function buscarDataOficialPncpPorMetadados(
  meta: MetadadosBuscaDataPncp
): Promise<DatasOficiaisPncp | null> {
  const cnpjLimpo = String(meta.cnpj || "").replace(/\D/g, "");
  const numAno = extrairNumeroEAnoMetadados(meta.numeroLicitacao);
  const orgaoLimpo = String(meta.orgao || "").trim();
  const uasgLimpa = String(meta.uasg || "").replace(/\D/g, "");

  if (!numAno && cnpjLimpo.length !== 14 && !orgaoLimpo) {
    return null;
  }

  // 1. Tenta primeiro o endpoint do servidor (evita CORS e já faz lookup completo da compra)
  try {
    const qs = new URLSearchParams();
    if (orgaoLimpo) qs.set("orgao", orgaoLimpo);
    if (cnpjLimpo.length === 14) qs.set("cnpj", cnpjLimpo);
    if (numAno) {
      qs.set("numero", numAno.numero);
      qs.set("ano", numAno.ano);
    }
    if (uasgLimpa) qs.set("uasg", uasgLimpa);
    if (meta.objeto) qs.set("objeto", String(meta.objeto).slice(0, 140));

    const resp = await fetchComTimeout(
      urlDaApi(`/api/pncp/buscar-data?${qs.toString()}`),
      { headers: cabecalhosDaApi() },
      15_000
    );
    if (resp.ok) {
      const payload = await resp.json().catch(() => null);
      const dados = extrairCamposDatasOficiaisPncp(payload?.datasOficiais || payload, {
        linkPNCP: payload?.linkPNCP,
        numeroControlePNCP: payload?.numeroControlePNCP,
      });
      if (dados) return dados;
    }
  } catch {
    // fallback direto no navegador via /api/search/
  }

  // 2. Fallback direto no índice /api/search/ do PNCP
  const consultas: string[] = [];
  if (cnpjLimpo.length === 14 && numAno) {
    consultas.push(`${cnpjLimpo} ${numAno.numero}/${numAno.ano}`);
  }
  if (orgaoLimpo && numAno) {
    const partesOrgao = orgaoLimpo.split(/\s+/).slice(0, 5).join(" ");
    consultas.push(`${partesOrgao} ${numAno.numero}/${numAno.ano}`);
  }
  if (consultas.length === 0 && orgaoLimpo) {
    consultas.push(orgaoLimpo.split(/\s+/).slice(0, 6).join(" "));
  }

  const orgaoTokens = tokensOrgao(orgaoLimpo);

  for (const termo of consultas) {
    try {
      const qSearch = montarQueryBuscaIndexadaPncp({
        pagina: 1,
        tamanhoPagina: 15,
        status: "todos",
        q: termo,
      });
      const respSearch = await fetchComTimeout(
        `${PNCP_SEARCH_URL}?${qSearch}`,
        { headers: { Accept: "application/json" } },
        10_000
      );
      if (!respSearch.ok) continue;
      const json = await respSearch.json().catch(() => null);
      const itensRaw = Array.isArray(json?.items) ? json.items : [];
      if (itensRaw.length === 0) continue;

      let melhorItem: any = null;
      let melhorScore = 0;

      for (const rawItem of itensRaw) {
        const norm = normalizarItemBuscaIndexadaPncp(rawItem);
        const itemCnpj = String(norm.cnpjOrgao || "").replace(/\D/g, "");
        const itemNumAno =
          extrairNumeroEAnoMetadados(`${norm.numeroCompra || ""}/${norm.anoCompra || ""}`) ||
          extrairNumeroEAnoMetadados(norm.tituloDocumento) ||
          extrairNumeroEAnoMetadados(norm.processo);
        const itemUasg = String(norm.unidadeOrgao?.codigoUnidade || "").replace(/\D/g, "");
        const itemOrgaoTokens = tokensOrgao(norm.orgaoEntidade?.razaoSocial);

        let score = 0;
        const mesmoCnpj = cnpjLimpo.length === 14 && itemCnpj === cnpjLimpo;
        const mesmoNumAno = Boolean(
          numAno && itemNumAno && itemNumAno.numero === numAno.numero && itemNumAno.ano === numAno.ano
        );
        const mesmaUasg = Boolean(uasgLimpa && itemUasg && uasgLimpa === itemUasg);

        let comunsOrgao = 0;
        for (const t of orgaoTokens) {
          if (itemOrgaoTokens.has(t)) comunsOrgao++;
        }
        const orgaoCompativel =
          comunsOrgao >= 2 || (orgaoTokens.size === 1 && comunsOrgao === 1);

        if (mesmoCnpj && mesmoNumAno) score = 100;
        else if (mesmaUasg && mesmoNumAno) score = 95;
        else if (orgaoCompativel && mesmoNumAno) score = 85;

        if (score > melhorScore) {
          melhorScore = score;
          melhorItem = norm;
        }
      }

      if (melhorItem && melhorScore >= 85 && melhorItem.numeroControlePNCP) {
        const detalheOficial = await buscarDataOficialPncp(melhorItem.numeroControlePNCP).catch(() => null);
        if (detalheOficial) return detalheOficial;
        const doIndice = extrairCamposDatasOficiaisPncp(melhorItem, {
          linkPNCP: melhorItem.linkPNCP,
          numeroControlePNCP: melhorItem.numeroControlePNCP,
        });
        if (doIndice) return doIndice;
      }
    } catch {
      // tenta próxima consulta
    }
  }

  return null;
}
