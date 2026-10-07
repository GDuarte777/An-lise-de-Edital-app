import { DisputaRow } from "../types";

// ═══════════════════════════════════════════════════════════════════════
// DISPUTA MARCADA À MÃO NO CALENDÁRIO
//
// Até aqui uma disputa só existia como subproduto: ou a IA extraía a data da
// análise de um edital, ou a linha era digitada na Planilha de Disputas. Quem
// já sabia da sessão — porque viu no portal, porque o cliente avisou, porque
// acompanha o órgão — não tinha como anotar isso no calendário sem antes
// arrastar um PDF para a análise.
//
// A decisão de projeto é que a marcação manual produz uma DisputaRow de
// verdade, na mesma tabela das outras. Assim ela aparece no calendário, na
// Planilha e na exportação .ics, sem inventar um segundo conceito de "evento"
// que depois teria de ser mantido, filtrado e exportado em paralelo.
// ═══════════════════════════════════════════════════════════════════════

export interface DadosDisputaManual {
  /** Órgão ou título livre — é o texto que aparece na grade do calendário. */
  orgao: string;
  /** "AAAA-MM-DD", como vem de um <input type="date">. */
  data: string;
  /** "HH:MM", como vem de um <input type="time">. Opcional. */
  hora?: string;
  numeroLicitacao?: string;
  portal?: string;
  /** O que será disputado. */
  produtoItem?: string;
  observacoes?: string;
  linkPNCP?: string;
  status?: string;
  valorEstimadoItem?: number;
  nossoValorAlvo?: number;
}

export type ErrosDisputaManual = Partial<
  Record<"orgao" | "data" | "hora" | "linkPNCP", string>
>;

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_HORA = /^(\d{2}):(\d{2})$/;

/**
 * Junta data e hora no formato que `parseDisputaDate` lê.
 *
 * O campo `dataHoraDisputa` é texto livre no modelo, e o calendário só enxerga
 * o que aquele parser entende. Escrever aqui num formato que ele não lê faria a
 * disputa ser salva e nunca aparecer — exatamente o problema que o aviso de
 * "disputas sem data reconhecível" denuncia hoje.
 */
export function combinarDataHora(data: string, hora?: string): string {
  const d = String(data || "").trim();
  if (!RE_DATA.test(d)) return "";
  const h = String(hora || "").trim();
  return RE_HORA.test(h) ? `${d} ${h}` : d;
}

/** Desmembra `dataHoraDisputa` de volta em data e hora, para abrir em edição. */
export function separarDataHora(dataHoraDisputa: string): { data: string; hora: string } {
  const texto = String(dataHoraDisputa || "").trim();

  let m = texto.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) {
    return { data: `${m[1]}-${m[2]}-${m[3]}`, hora: m[4] ? `${m[4]}:${m[5]}` : "" };
  }

  // Formato brasileiro, que também circula no campo por digitação manual.
  m = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[, ]+(\d{2}):(\d{2}))?/);
  if (m) {
    return { data: `${m[3]}-${m[2]}-${m[1]}`, hora: m[4] ? `${m[4]}:${m[5]}` : "" };
  }

  return { data: "", hora: "" };
}

/**
 * Completa o link com https:// quando o usuário cola só o domínio.
 *
 * Colar "pncp.gov.br/app/editais/..." sem esquema é o comportamento normal de
 * quem copia da barra do navegador, e um href sem esquema é tratado como
 * caminho relativo — o clique levaria para dentro da própria plataforma.
 */
export function normalizarLinkPncp(url: string): string {
  const bruto = String(url || "").trim();
  if (!bruto) return "";
  if (/^https?:\/\//i.test(bruto)) return bruto;
  return `https://${bruto}`;
}

/** O link aponta para o PNCP oficial? Serve de dica, não de impedimento. */
export function ehLinkPncpOficial(url: string): boolean {
  const normalizado = normalizarLinkPncp(url);
  if (!normalizado) return false;
  try {
    const host = new URL(normalizado).hostname.toLowerCase();
    return host === "pncp.gov.br" || host.endsWith(".pncp.gov.br");
  } catch {
    return false;
  }
}

function linkUtilizavel(url: string): boolean {
  const normalizado = normalizarLinkPncp(url);
  if (!normalizado) return true; // vazio é permitido
  try {
    const u = new URL(normalizado);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/**
 * Valida o formulário de marcação manual.
 *
 * Exige só o que o calendário precisa para funcionar: um rótulo e uma data
 * legível. Data no passado NÃO é erro — marcar uma sessão que já ocorreu, para
 * registrar resultado, é uso legítimo, e recusar obrigaria a inventar a data.
 */
export function validarDisputaManual(dados: DadosDisputaManual): ErrosDisputaManual {
  const erros: ErrosDisputaManual = {};

  if (!dados.orgao || !dados.orgao.trim()) {
    erros.orgao = "Informe o órgão ou um título para identificar a disputa.";
  }

  const data = String(dados.data || "").trim();
  if (!data) {
    erros.data = "Informe a data da disputa.";
  } else if (!RE_DATA.test(data)) {
    erros.data = "Data inválida.";
  } else {
    const [, ano, mes, dia] = data.match(RE_DATA)!;
    const d = new Date(Number(ano), Number(mes) - 1, Number(dia));
    // Rejeita 31/02 e afins, que casam com o padrão mas não existem.
    if (d.getMonth() !== Number(mes) - 1 || d.getDate() !== Number(dia)) {
      erros.data = "Data inválida.";
    }
  }

  const hora = String(dados.hora || "").trim();
  if (hora && !RE_HORA.test(hora)) {
    erros.hora = "Hora inválida (use HH:MM).";
  } else if (hora) {
    const [, hh, mm] = hora.match(RE_HORA)!;
    if (Number(hh) > 23 || Number(mm) > 59) erros.hora = "Hora inválida (use HH:MM).";
  }

  if (dados.linkPNCP && !linkUtilizavel(dados.linkPNCP)) {
    erros.linkPNCP = "Link inválido. Cole o endereço completo do edital.";
  }

  return erros;
}

export function disputaManualValida(dados: DadosDisputaManual): boolean {
  return Object.keys(validarDisputaManual(dados)).length === 0;
}

/**
 * Monta a DisputaRow completa a partir do que foi preenchido.
 *
 * Os campos que a marcação manual não pede (quantidade, unidade, piso) recebem
 * o mesmo padrão que a Planilha usaria, para que a linha criada aqui seja
 * indistinguível de uma digitada lá — é a mesma entidade, e quem abrir a
 * Planilha depois precisa poder completar os números sem achar que a linha
 * veio quebrada.
 */
export function criarDisputaManual(
  dados: DadosDisputaManual,
  opcoes: { id: string; statusPadrao?: string },
): DisputaRow {
  return {
    id: opcoes.id,
    orgao: dados.orgao.trim(),
    uasgUndCompradora: "",
    numeroLicitacao: (dados.numeroLicitacao || "").trim(),
    portal: (dados.portal || "").trim(),
    produtoItem: (dados.produtoItem || "").trim(),
    quantidade: 1,
    unidadeMedida: "Unidade",
    valorEstimadoItem: Number(dados.valorEstimadoItem) || 0,
    nossoValorAlvo: Number(dados.nossoValorAlvo) || 0,
    valorMinimoPiso: 0,
    dataHoraDisputa: combinarDataHora(dados.data, dados.hora),
    status: (dados.status || opcoes.statusPadrao || "Agendada").trim(),
    observacoes: (dados.observacoes || "").trim(),
    linkPNCP: normalizarLinkPncp(dados.linkPNCP || ""),
  };
}

/** Aplica a edição sobre uma disputa existente, preservando o que não é do formulário. */
export function aplicarEdicaoManual(original: DisputaRow, dados: DadosDisputaManual): DisputaRow {
  return {
    ...original,
    orgao: dados.orgao.trim(),
    numeroLicitacao: (dados.numeroLicitacao || "").trim(),
    portal: (dados.portal || "").trim(),
    produtoItem: (dados.produtoItem || "").trim(),
    dataHoraDisputa: combinarDataHora(dados.data, dados.hora),
    status: (dados.status || original.status).trim(),
    observacoes: (dados.observacoes || "").trim(),
    linkPNCP: normalizarLinkPncp(dados.linkPNCP || ""),
  };
}

/** Preenche o formulário a partir de uma disputa já existente. */
export function dadosDeDisputa(row: DisputaRow): DadosDisputaManual {
  const { data, hora } = separarDataHora(row.dataHoraDisputa);
  return {
    orgao: row.orgao || "",
    data,
    hora,
    numeroLicitacao: row.numeroLicitacao || "",
    portal: row.portal || "",
    produtoItem: row.produtoItem || "",
    observacoes: row.observacoes || "",
    linkPNCP: row.linkPNCP || "",
    status: row.status || "",
  };
}
