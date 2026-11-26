import { DisputaRow, EditalAnalysis } from "../types";
import { EditalHistoryItem } from "./editalHistory";
import { extrairNumeroEdital, normalizarCodigoUasg } from "./identificacaoEdital";

export type DossieNavigationIntent =
  | {
      type: "found";
      nonce: number;
    }
  | {
      type: "missing";
      orgao?: string;
      numeroLicitacao?: string;
      produtoItem?: string;
      linkPNCP?: string;
      nonce: number;
    };

export interface DisputaEditalMatch {
  edital: EditalAnalysis;
  historyId?: string;
}

function normalizarTexto(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "de", "da", "do", "das", "dos", "para", "com", "sem", "por", "em", "no", "na",
  "nos", "nas", "ao", "aos", "as", "os", "um", "uma", "e", "ou", "a", "o",
  "prefeitura", "municipal", "secretaria", "estado", "governo", "ministerio",
  "fundo", "instituto", "autarquia", "camara", "municipio", "orgao",
  "aquisicao", "contratacao", "fornecimento", "registro", "precos", "prestacao",
  "servicos", "materiais", "material", "item", "itens", "lote", "lotes",
]);

function extrairTokensSignificativos(valor: unknown): Set<string> {
  const norm = normalizarTexto(valor);
  if (!norm) return new Set();
  const tokens = norm
    .split(" ")
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return new Set(tokens);
}

/**
 * Extrai a chave canônica PNCP `cnpj/ano/seq` (sem zeros à esquerda na sequência)
 * de URLs oficiais ou códigos de controle (`CNPJ-1-SEQ/ANO`).
 */
export function extrairChavePncpNormalizada(texto: unknown): string {
  const bruto = String(texto ?? "").trim();
  if (!bruto) return "";

  const urlMatch = bruto.match(/pncp\.gov\.br\/app\/editais\/(\d{14})\/(\d{4})\/(\d{1,6})/i);
  if (urlMatch) {
    return `${urlMatch[1]}/${urlMatch[2]}/${String(parseInt(urlMatch[3], 10))}`;
  }

  const controlMatch = bruto.match(/(\d{14})[-_\s/]+1[-_\s/]+(\d{1,6})[/-_](\d{4})/);
  if (controlMatch) {
    return `${controlMatch[1]}/${controlMatch[3]}/${String(parseInt(controlMatch[2], 10))}`;
  }

  const slashMatch = bruto.match(/(\d{14})[/-_](\d{4})[/-_](\d{1,6})/);
  if (slashMatch) {
    return `${slashMatch[1]}/${slashMatch[2]}/${String(parseInt(slashMatch[3], 10))}`;
  }

  return "";
}

/**
 * Extrai o núcleo numérico do certame (ex.: "0045/2026" -> "45/2026", "PE 90012/2026" -> "90012/2026").
 */
export function extrairNucleoNumeroLicitacao(texto: unknown): string {
  const bruto = String(texto ?? "").trim();
  if (!bruto) return "";

  const viaHelper = extrairNumeroEdital(bruto);
  const candidato = viaHelper || bruto;

  const barraMatch = candidato.match(/(\d{1,6})\s*\/\s*(\d{4})/);
  if (barraMatch) {
    return `${String(parseInt(barraMatch[1], 10))}/${barraMatch[2]}`;
  }

  const processoMatch = bruto.match(/\b(\d{4,6}\/\d{4})\b/);
  if (processoMatch) {
    const [num, ano] = processoMatch[1].split("/");
    return `${String(parseInt(num, 10))}/${ano}`;
  }

  return "";
}

function extrairChavesPncpDoEdital(edital: EditalAnalysis): Set<string> {
  const chaves = new Set<string>();
  const iden: any = edital.identificacaoCertame || {};
  const candidatos = [
    iden.linkPNCP,
    edital.linkPNCP,
    iden.idContratacaoPNCP,
    edital.idContratacaoPNCP,
    (edital as any).dadosOficiaisPNCP?.numeroControlePNCP,
    edital.dossieExecutivo?.subtituloOrgao,
    edital.rawText ? String(edital.rawText).slice(0, 4000) : "",
    edital.reportMarkdown ? String(edital.reportMarkdown).slice(0, 4000) : "",
  ];
  for (const c of candidatos) {
    const chave = extrairChavePncpNormalizada(c);
    if (chave) chaves.add(chave);
  }
  return chaves;
}

function orgaosCompat(orgaoDisputa: string, orgaoEdital: string): boolean {
  const a = normalizarTexto(orgaoDisputa);
  const b = normalizarTexto(orgaoEdital);
  if (!a || !b) return false;
  if (a === b) return true;
  if ((a.length >= 6 && b.includes(a)) || (b.length >= 6 && a.includes(b))) return true;

  const tokA = extrairTokensSignificativos(a);
  const tokB = extrairTokensSignificativos(b);
  if (tokA.size === 0 || tokB.size === 0) return false;
  let comuns = 0;
  for (const t of tokA) {
    if (tokB.has(t)) comuns++;
  }
  const minSize = Math.min(tokA.size, tokB.size);
  return comuns >= 2 || (minSize === 1 && comuns === 1);
}

function calcularSobreposicaoObjeto(objDisputa: string, objEdital: string): { comuns: number; ratio: number } {
  const tokA = extrairTokensSignificativos(objDisputa);
  const tokB = extrairTokensSignificativos(objEdital);
  if (tokA.size === 0 || tokB.size === 0) return { comuns: 0, ratio: 0 };
  let comuns = 0;
  for (const t of tokA) {
    if (tokB.has(t)) comuns++;
  }
  const denom = Math.min(tokA.size, tokB.size);
  return { comuns, ratio: denom > 0 ? comuns / denom : 0 };
}

function pontuarCompatibilidade(row: DisputaRow, edital: EditalAnalysis): number {
  const iden = edital.identificacaoCertame;

  // 1. Chave PNCP oficial (máxima precisão)
  const pncpRow = extrairChavePncpNormalizada(row.linkPNCP);
  if (pncpRow) {
    const pncpEdital = extrairChavesPncpDoEdital(edital);
    if (pncpEdital.has(pncpRow)) return 100;
  }

  const numRowRaw = normalizarTexto(row.numeroLicitacao);
  const numEditalRaw = normalizarTexto(iden?.identificacaoNumerica);
  const nucleoRow = extrairNucleoNumeroLicitacao(row.numeroLicitacao);
  const nucleoEdital =
    extrairNucleoNumeroLicitacao(iden?.identificacaoNumerica) ||
    extrairNucleoNumeroLicitacao(edital.dossieExecutivo?.titulo);

  const orgaoEdital = iden?.orgaoComprador || "";
  const mesmoOrgao = orgaosCompat(row.orgao, orgaoEdital);

  const uasgRow = normalizarCodigoUasg(row.uasgUndCompradora);
  const uasgEdital = normalizarCodigoUasg(iden?.uasg);
  const mesmaUasg = Boolean(uasgRow && uasgEdital && uasgRow === uasgEdital);

  const mesmoNucleo = Boolean(nucleoRow && nucleoEdital && nucleoRow === nucleoEdital);
  const mesmoNumeroExato = Boolean(
    numRowRaw &&
    numEditalRaw &&
    numRowRaw.length >= 4 &&
    /\d/.test(numRowRaw) &&
    (numRowRaw === numEditalRaw || numEditalRaw.includes(numRowRaw) || numRowRaw.includes(numEditalRaw))
  );

  // Conflito explícito de número de certame: impede confundir duas disputas diferentes do mesmo órgão
  const conflitoNumero = Boolean(nucleoRow && nucleoEdital && nucleoRow !== nucleoEdital);

  // 2. Número do certame + Órgão ou UASG
  if ((mesmoNucleo || mesmoNumeroExato) && (mesmoOrgao || mesmaUasg)) {
    return 90;
  }

  // 3. Mesmo número específico + sobreposição no objeto (caso o nome do órgão tenha sido abreviado diferente)
  const objetoEdital = [
    edital.descricaoProduto || "",
    edital.dossieExecutivo?.titulo || "",
    edital.dossieExecutivo?.sinteseTexto || "",
  ].join(" ");
  const overlapObj = calcularSobreposicaoObjeto(row.produtoItem, objetoEdital);

  if ((mesmoNucleo || mesmoNumeroExato) && overlapObj.comuns >= 2 && overlapObj.ratio >= 0.4) {
    return 75;
  }

  // 4. Mesmo órgão + forte similaridade de objeto (sem conflito de número de certame)
  if (!conflitoNumero && mesmoOrgao && overlapObj.comuns >= 2 && overlapObj.ratio >= 0.5) {
    return 65;
  }

  return 0;
}

/**
 * Localiza o EditalAnalysis correspondente a uma disputa no histórico ou na análise ativa.
 * Retorna `null` quando a disputa ainda não possui Dossiê analisado.
 */
export function encontrarEditalDaDisputa(
  row: DisputaRow,
  editalHistory: EditalHistoryItem[],
  activeEdital?: EditalAnalysis | null
): DisputaEditalMatch | null {
  let melhor: { score: number; match: DisputaEditalMatch } | null = null;

  // Avalia primeiro o histórico (mais recente vem primeiro no array)
  for (const item of editalHistory) {
    if (!item?.analysis) continue;
    const score = pontuarCompatibilidade(row, item.analysis);
    if (score > 0 && (!melhor || score > melhor.score)) {
      melhor = { score, match: { edital: item.analysis, historyId: item.id } };
    }
  }

  // Também avalia o edital ativo da sessão (caso ainda não esteja sincronizado ou tenha sido editado agora)
  if (activeEdital) {
    const score = pontuarCompatibilidade(row, activeEdital);
    if (score > 0 && (!melhor || score >= melhor.score)) {
      melhor = { score, match: { edital: activeEdital } };
    }
  }

  return melhor ? melhor.match : null;
}

export function rotuloDisputaResumido(info: {
  orgao?: string;
  numeroLicitacao?: string;
  produtoItem?: string;
}): string {
  const orgao = String(info.orgao || "").trim();
  const num = String(info.numeroLicitacao || "").trim();
  const obj = String(info.produtoItem || "").trim();

  if (orgao && num) return `${orgao} (${num})`;
  if (orgao) return orgao;
  if (num) return num;
  if (obj) return obj.length > 60 ? `${obj.slice(0, 57)}...` : obj;
  return "esta disputa";
}
