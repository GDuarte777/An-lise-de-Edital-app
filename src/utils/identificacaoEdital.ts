// ═══════════════════════════════════════════════════════════════════════
// IDENTIFICAÇÃO DO CERTAME: UASG E NÚMERO DO EDITAL
//
// São dois dados diferentes e a plataforma vinha confundindo os dois:
//
//   UASG / Código Unidade   163/2026   ← errado, isto é o processo
//   Nº Licitação / Processo 163/2026
//
// A UASG é o código NUMÉRICO da unidade gestora no Compras.gov.br — quatro a
// seis dígitos, sem barra e sem ano (ex.: 927374). O número do edital tem a
// forma "44/2026". Nenhum valor com barra é UASG, e essa única regra já teria
// evitado o defeito: o código caía em `identificacaoNumerica` por fallback e
// copiava o número do processo para o campo ao lado.
//
// Módulo sem dependências, de propósito: a regra é verificável em teste e vale
// igual no frontend e no backend.
// ═══════════════════════════════════════════════════════════════════════

/** Rótulos que, num edital, antecedem o código da unidade gestora. */
const ROTULOS_UASG =
  "UASG|U\\.?A\\.?S\\.?G\\.?|Unidade\\s+Gestora|Unidade\\s+Compradora|Und\\.?\\s*Compradora|C[óo]digo\\s+(?:da\\s+)?Unidade|C[óo]d\\.?\\s*Unidade";

/**
 * O valor pode ser um código de UASG?
 *
 * Exige só dígitos, de 4 a 6. Qualquer barra reprova: "163/2026" é número de
 * processo, e foi exatamente esse valor que apareceu no campo da UASG.
 */
export function ehCodigoUasgPlausivel(valor: string | null | undefined): boolean {
  const bruto = String(valor ?? "").trim();
  if (!bruto) return false;
  if (bruto.includes("/")) return false;

  const somenteDigitos = bruto
    .replace(new RegExp(`^\\s*(?:${ROTULOS_UASG})\\s*[:\\-]?\\s*`, "i"), "")
    .replace(/[.\s]/g, "");

  return /^\d{4,6}$/.test(somenteDigitos);
}

/**
 * Devolve só o código, sem o rótulo, ou "" quando o valor não é uma UASG.
 *
 * Devolver vazio é deliberado: o campo em branco aparece como "—" na tela e
 * diz a verdade. Preencher com um palpite — era "UASG 090012" no código antigo
 * — é pior do que não preencher, porque parece dado conferido.
 */
export function normalizarCodigoUasg(valor: string | null | undefined): string {
  if (!ehCodigoUasgPlausivel(valor)) return "";
  return String(valor)
    .trim()
    .replace(new RegExp(`^\\s*(?:${ROTULOS_UASG})\\s*[:\\-]?\\s*`, "i"), "")
    .replace(/[.\s]/g, "");
}

/** Procura o código da unidade no texto do edital, exigindo o rótulo por perto. */
export function extrairCodigoUasg(texto: string | null | undefined): string {
  const conteudo = String(texto ?? "");
  if (!conteudo) return "";

  // Só aceita o número quando ele vem logo depois de um rótulo de unidade.
  // Sem essa amarra, qualquer sequência de cinco dígitos do edital — CEP,
  // quantidade, número de lote — viraria candidata a UASG.
  const comRotulo = conteudo.match(
    new RegExp(`(?:${ROTULOS_UASG})\\s*(?:n[ºo°.]?\\s*)?[:\\-]?\\s*(\\d{4,6})(?!\\s*[/\\d])`, "i")
  );
  if (comRotulo) return comRotulo[1];

  return "";
}

/** Número do edital/licitação no formato "44/2026", quando houver. */
export function extrairNumeroEdital(texto: string | null | undefined): string {
  const conteudo = String(texto ?? "");
  if (!conteudo) return "";

  const comRotulo = conteudo.match(
    /(?:edital|preg[ãa]o(?:\s+eletr[ôo]nico)?|licita[çc][ãa]o|concorr[êe]ncia|dispensa|processo)\s*(?:eletr[ôo]nico\s*)?(?:n[ºo°.]?\s*)?[:\-]?\s*(\d{1,6}\s*\/\s*\d{4})/i
  );
  if (comRotulo) return comRotulo[1].replace(/\s+/g, "");

  return "";
}
