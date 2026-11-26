// Campo "Data / Hora da disputa" é texto livre (aceita formatos vindos de import,
// extração por IA, PNCP e digitação manual). Este módulo centraliza o parser
// tolerante para formatos brasileiros/ISO e a seleção da data oficial do PNCP.

const MESES_PT: Record<string, number> = {
  janeiro: 1,
  jan: 1,
  fevereiro: 2,
  fev: 2,
  marco: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  maio: 5,
  mai: 5,
  junho: 6,
  jun: 6,
  julho: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  setembro: 9,
  set: 9,
  outubro: 10,
  out: 10,
  novembro: 11,
  nov: 11,
  dezembro: 12,
  dez: 12,
};

function criarDataValidada(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0
): Date | null {
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    year < 1990 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function extrairHoraNoTrecho(trecho: string): { hour: number; minute: number; found: boolean } {
  if (!trecho) return { hour: 0, minute: 0, found: false };
  // Aceita: "09:30", "9:30", "09h30", "09h", "às 09:30", "as 14h00min", ", 09:00:00"
  const m = trecho.match(
    /(?:^|[\s,\-–—]|(?:[àa]s?\s+)|(?:em\s+))(\d{1,2})\s*(?:[:hH]\s*(\d{2})|[hH](?:\b|\s|$))/
  );
  if (!m) return { hour: 0, minute: 0, found: false };
  const hour = Number(m[1]);
  const minute = m[2] !== undefined ? Number(m[2]) : 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { hour: 0, minute: 0, found: false };
  }
  return { hour, minute, found: true };
}

function parseComInfoHora(value: string): { date: Date; hasTime: boolean } | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  // 1. ISO com fuso explícito (ex: "2026-11-25T12:00:00Z" ou "2026-11-25T09:00:00-03:00")
  const isoTz = trimmed.match(
    /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})/i
  );
  if (isoTz) {
    const dt = new Date(isoTz[0]);
    if (!isNaN(dt.getTime())) {
      return { date: dt, hasTime: true };
    }
  }

  // 2. ISO local (ex: "2026-03-15 09:30", "2026-03-15T09:30:00", "2026-03-15")
  const isoLocal = trimmed.match(
    /(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?/
  );
  if (isoLocal) {
    const [, y, mo, d, h, mi] = isoLocal;
    const rest = h === undefined ? trimmed.slice((isoLocal.index ?? 0) + isoLocal[0].length, (isoLocal.index ?? 0) + isoLocal[0].length + 28) : "";
    const extraHora = h === undefined ? extrairHoraNoTrecho(rest) : { hour: Number(h), minute: Number(mi), found: true };
    const dt = criarDataValidada(Number(y), Number(mo), Number(d), extraHora.hour, extraHora.minute);
    if (dt) return { date: dt, hasTime: extraHora.found };
  }

  // 3. Formato brasileiro numérico em qualquer posição da frase
  // Ex: "15/03/2026 09:30", "15/03/2026, 09:30:00", "Dia 15/03/2026 às 09h30 (Horário de Brasília)"
  const brNum = trimmed.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (brNum) {
    const [, d, mo, y] = brNum;
    const afterStart = (brNum.index ?? 0) + brNum[0].length;
    const afterSlice = trimmed.slice(afterStart, afterStart + 32);
    const beforeSlice = trimmed.slice(Math.max(0, (brNum.index ?? 0) - 24), brNum.index ?? 0);
    let hora = extrairHoraNoTrecho(afterSlice);
    if (!hora.found) {
      hora = extrairHoraNoTrecho(beforeSlice);
    }
    const dt = criarDataValidada(Number(y), Number(mo), Number(d), hora.hour, hora.minute);
    if (dt) return { date: dt, hasTime: hora.found };
  }

  // 4. Formato brasileiro por extenso (ex: "25 de novembro de 2026 às 09:00")
  const semAcento = trimmed
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const brExtenso = semAcento.match(
    /(\d{1,2})\s+de\s+([a-z]{3,12})\s+de\s+(\d{4})/
  );
  if (brExtenso) {
    const [, d, mesTxt, y] = brExtenso;
    const mo = MESES_PT[mesTxt];
    if (mo) {
      const afterStart = (brExtenso.index ?? 0) + brExtenso[0].length;
      const afterSlice = semAcento.slice(afterStart, afterStart + 32);
      const hora = extrairHoraNoTrecho(afterSlice);
      const dt = criarDataValidada(Number(y), mo, Number(d), hora.hour, hora.minute);
      if (dt) return { date: dt, hasTime: hora.found };
    }
  }

  return null;
}

export function parseDisputaDate(value: string): Date | null {
  const parsed = parseComInfoHora(value);
  return parsed ? parsed.date : null;
}

/** Formata uma Date válida no padrão canônico brasileiro aceito por toda a plataforma. */
export function formatarDataDisputaBR(date: Date, incluirHora = true): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  if (!incluirHora) return `${dd}/${mm}/${yyyy}`;
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

/**
 * Normaliza qualquer string de data/hora para "DD/MM/AAAA HH:MM" (ou "DD/MM/AAAA").
 * Devolve "" quando o texto não contém nenhuma data reconhecível.
 */
export function normalizarDataHoraDisputa(value?: string | null): string {
  if (!value) return "";
  const parsed = parseComInfoHora(value);
  if (!parsed) return "";
  return formatarDataDisputaBR(parsed.date, parsed.hasTime);
}

/**
 * Formata uma data vinda das APIs do PNCP para "DD/MM/AAAA HH:MM" em horário
 * de Brasília (America/Sao_Paulo). Quando a string ISO não traz fuso explícito
 * (padrão mais comum do PNCP, ex: "2026-12-05T09:00:00"), preserva o horário
 * local exatamente como publicado pelo órgão, evitando deslocamentos de UTC.
 */
export function formatarDataPncpBrasilia(value?: string | null): string {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";

  // ISO com fuso explícito (Z ou ±HH:MM) -> converte para America/Sao_Paulo
  const isoTz = trimmed.match(
    /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})/i
  );
  if (isoTz) {
    const dt = new Date(isoTz[0]);
    if (!isNaN(dt.getTime())) {
      try {
        const parts = new Intl.DateTimeFormat("pt-BR", {
          timeZone: "America/Sao_Paulo",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).formatToParts(dt);
        const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
        const dd = get("day");
        const mo = get("month");
        const yyyy = get("year");
        const hh = get("hour") === "24" ? "00" : get("hour");
        const mi = get("minute");
        if (dd && mo && yyyy && hh && mi) {
          return `${dd}/${mo}/${yyyy} ${hh}:${mi}`;
        }
      } catch {
        // fallback abaixo
      }
      return formatarDataDisputaBR(dt, true);
    }
  }

  return normalizarDataHoraDisputa(trimmed);
}

/**
 * Seleciona a data oficial do PNCP para o Calendário:
 * prioridade absoluta para a Data limite de recebimento / encerramento das
 * propostas (início da disputa), caindo para abertura de propostas apenas se
 * o encerramento não estiver publicado.
 */
export function extrairDataPncpPreferencial(
  detalhe?: {
    dataEncerramentoProposta?: string | null;
    data_encerramento_proposta?: string | null;
    dataFimRecebimentoProposta?: string | null;
    data_fim_recebimento_propostas?: string | null;
    dataLimiteRecebimentoProposta?: string | null;
    data_limite_recebimento_propostas?: string | null;
    dataFimVigencia?: string | null;
    data_fim_vigencia?: string | null;
    dataAberturaProposta?: string | null;
    data_abertura_proposta?: string | null;
    dataInicioRecebimentoProposta?: string | null;
    data_inicio_recebimento_propostas?: string | null;
    dataInicioVigencia?: string | null;
    data_inicio_vigencia?: string | null;
  } | null
): { dataFormatada: string; raw: string; origem: "encerramento" | "abertura" } | null {
  if (!detalhe || typeof detalhe !== "object") return null;

  const candidatosEncerramento = [
    detalhe.dataEncerramentoProposta,
    detalhe.data_encerramento_proposta,
    detalhe.dataFimRecebimentoProposta,
    detalhe.data_fim_recebimento_propostas,
    detalhe.dataLimiteRecebimentoProposta,
    detalhe.data_limite_recebimento_propostas,
    detalhe.dataFimVigencia,
    detalhe.data_fim_vigencia,
  ];

  for (const bruto of candidatosEncerramento) {
    if (!bruto) continue;
    const normalizada = formatarDataPncpBrasilia(String(bruto));
    if (normalizada) {
      return { dataFormatada: normalizada, raw: String(bruto), origem: "encerramento" };
    }
  }

  const candidatosAbertura = [
    detalhe.dataAberturaProposta,
    detalhe.data_abertura_proposta,
    detalhe.dataInicioRecebimentoProposta,
    detalhe.data_inicio_recebimento_propostas,
    detalhe.dataInicioVigencia,
    detalhe.data_inicio_vigencia,
  ];

  for (const bruto of candidatosAbertura) {
    if (!bruto) continue;
    const normalizada = formatarDataPncpBrasilia(String(bruto));
    if (normalizada) {
      return { dataFormatada: normalizada, raw: String(bruto), origem: "abertura" };
    }
  }

  return null;
}

// "Hoje" (mesmo dia) ou "Amanhã" (dia seguinte) — comparação por dia de calendário,
// não por 24h corridas, para não trocar de "Hoje" para "Amanhã" no meio da noite.
export function getDisputaDateTag(value: string): { label: string; tone: "today" | "tomorrow" } | null {
  const date = parseDisputaDate(value);
  if (!date) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfTarget.getTime() - startOfToday.getTime()) / 86400000);
  if (dayDiff === 0) return { label: "Hoje", tone: "today" };
  if (dayDiff === 1) return { label: "Amanhã", tone: "tomorrow" };
  return null;
}

// Escolhe texto claro ou escuro conforme a luminância da cor de fundo, para manter contraste legível.
export function getContrastTextColor(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "#ffffff";
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#0f172a" : "#ffffff";
}
