// Campo "Data / Hora da disputa" é texto livre (aceita formatos vindos de import
// e digitação manual), então o calendário inteligente tenta os dois formatos
// usados pelo próprio app: ISO "AAAA-MM-DD HH:MM" e BR "DD/MM/AAAA HH:MM".
export function parseDisputaDate(value: string): Date | null {
  if (!value) return null;
  const trimmed = value.trim();

  let m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) {
    const [, y, mo, d, h, mi] = m;
    const date = new Date(Number(y), Number(mo) - 1, Number(d), h ? Number(h) : 0, mi ? Number(mi) : 0);
    return isNaN(date.getTime()) ? null : date;
  }

  m = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[, ]+(\d{2}):(\d{2}))?/);
  if (m) {
    const [, d, mo, y, h, mi] = m;
    const date = new Date(Number(y), Number(mo) - 1, Number(d), h ? Number(h) : 0, mi ? Number(mi) : 0);
    return isNaN(date.getTime()) ? null : date;
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
