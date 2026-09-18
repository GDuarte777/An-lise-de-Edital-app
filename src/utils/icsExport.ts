import { DisputaRow } from "../types";
import { parseDisputaDate } from "./disputaDates";

// ═══════════════════════════════════════════════════════════════════════
// AGENDA DE DISPUTAS EM .ICS
//
// O calendário da plataforma só serve enquanto a pessoa está com a
// plataforma aberta — e ninguém perde um pregão por não saber que ele
// existe, perde por não ser lembrado na hora certa. Exportar em .ics põe a
// sessão no calendário que a pessoa realmente usa (Google, Outlook, o
// celular), com alarme na véspera e uma hora antes.
//
// As datas são gravadas como "hora flutuante" (sem Z e sem TZID) de
// propósito: o campo da planilha é preenchido à mão, sem fuso, e significa
// a hora local de quem vai disputar. Converter para UTC exigiria adivinhar
// um fuso e erraria o horário de quem viajasse.
// ═══════════════════════════════════════════════════════════════════════

/** Escapa os caracteres que o RFC 5545 reserva dentro de um valor de texto. */
export function escaparTextoIcs(texto: string): string {
  return (texto || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * O RFC limita a linha a 75 octetos; o que passa disso continua na linha
 * seguinte começando por um espaço. Importadores rigorosos (Outlook) recusam
 * o arquivo inteiro quando a regra é ignorada, e uma descrição de disputa
 * estoura esse limite com facilidade.
 */
export function dobrarLinhaIcs(linha: string): string {
  const bytes = Buffer.from(linha, "utf-8");
  if (bytes.length <= 75) return linha;

  const partes: string[] = [];
  let atual = "";
  let tamanhoAtual = 0;
  // Percorre por caractere (não por byte) para nunca partir um acento ao meio.
  for (const char of linha) {
    const tamanhoChar = Buffer.from(char, "utf-8").length;
    // A partir da segunda linha, o espaço inicial já ocupa um octeto.
    const limite = partes.length === 0 ? 75 : 74;
    if (tamanhoAtual + tamanhoChar > limite) {
      partes.push(atual);
      atual = char;
      tamanhoAtual = tamanhoChar;
    } else {
      atual += char;
      tamanhoAtual += tamanhoChar;
    }
  }
  partes.push(atual);

  return partes.map((p, i) => (i === 0 ? p : ` ${p}`)).join("\r\n");
}

function doisDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

/** "AAAAMMDDTHHMMSS" na hora local, sem sufixo de fuso (hora flutuante). */
export function formatarDataIcsLocal(d: Date): string {
  return (
    `${d.getFullYear()}${doisDigitos(d.getMonth() + 1)}${doisDigitos(d.getDate())}` +
    `T${doisDigitos(d.getHours())}${doisDigitos(d.getMinutes())}${doisDigitos(d.getSeconds())}`
  );
}

/** "AAAAMMDDTHHMMSSZ" em UTC — exigido para o DTSTAMP. */
export function formatarDataIcsUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${doisDigitos(d.getUTCMonth() + 1)}${doisDigitos(d.getUTCDate())}` +
    `T${doisDigitos(d.getUTCHours())}${doisDigitos(d.getUTCMinutes())}${doisDigitos(d.getUTCSeconds())}Z`
  );
}

const formatarBRL = (valor: number) =>
  (valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function montarDescricao(d: DisputaRow): string {
  const linhas: string[] = [];
  if (d.produtoItem) linhas.push(`Objeto: ${d.produtoItem}`);
  if (d.quantidade) linhas.push(`Quantidade: ${d.quantidade} ${d.unidadeMedida || ""}`.trim());
  if (d.valorEstimadoItem) linhas.push(`Valor estimado: ${formatarBRL(d.valorEstimadoItem)}`);
  if (d.nossoValorAlvo) linhas.push(`Nosso lance alvo: ${formatarBRL(d.nossoValorAlvo)}`);
  if (d.valorMinimoPiso) linhas.push(`Piso (não descer daqui): ${formatarBRL(d.valorMinimoPiso)}`);
  if (d.uasgUndCompradora) linhas.push(`UASG: ${d.uasgUndCompradora}`);
  if (d.status) linhas.push(`Status: ${d.status}`);
  if (d.observacoes) linhas.push(`Anotações: ${d.observacoes}`);
  if (d.linkPNCP) linhas.push(`Edital: ${d.linkPNCP}`);
  return linhas.join("\n");
}

export interface OpcoesExportacaoIcs {
  /** Duração do bloco reservado na agenda. */
  duracaoMinutos?: number;
  /** Injetável para manter o DTSTAMP estável nos testes. */
  agora?: Date;
}

/**
 * Gera o conteúdo .ics das disputas que têm data legível.
 * Disputas sem data são ignoradas — um evento sem início não é importável.
 */
export function gerarIcsDeDisputas(disputas: DisputaRow[], opcoes: OpcoesExportacaoIcs = {}): string {
  const duracao = opcoes.duracaoMinutos ?? 60;
  const dtstamp = formatarDataIcsUtc(opcoes.agora ?? new Date());

  const linhas: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Analise de Edital//Agenda de Disputas//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Disputas de Licitação",
  ];

  for (const disputa of disputas) {
    const inicio = parseDisputaDate(disputa.dataHoraDisputa);
    if (!inicio) continue;

    const fim = new Date(inicio.getTime() + duracao * 60000);
    const titulo = [disputa.numeroLicitacao, disputa.orgao].filter(Boolean).join(" — ") || "Disputa";

    linhas.push("BEGIN:VEVENT");
    linhas.push(`UID:${disputa.id}@analise-de-edital`);
    linhas.push(`DTSTAMP:${dtstamp}`);
    linhas.push(`DTSTART:${formatarDataIcsLocal(inicio)}`);
    linhas.push(`DTEND:${formatarDataIcsLocal(fim)}`);
    linhas.push(`SUMMARY:${escaparTextoIcs(`Disputa: ${titulo}`)}`);

    const descricao = montarDescricao(disputa);
    if (descricao) linhas.push(`DESCRIPTION:${escaparTextoIcs(descricao)}`);
    if (disputa.portal) linhas.push(`LOCATION:${escaparTextoIcs(disputa.portal)}`);
    if (disputa.linkPNCP) linhas.push(`URL:${escaparTextoIcs(disputa.linkPNCP)}`);

    // Dois alarmes: o da véspera é o que dá tempo de resolver documentação;
    // o de uma hora antes é o que põe a pessoa na sala.
    linhas.push("BEGIN:VALARM");
    linhas.push("TRIGGER:-P1D");
    linhas.push("ACTION:DISPLAY");
    linhas.push(`DESCRIPTION:${escaparTextoIcs(`Amanhã: disputa ${titulo}`)}`);
    linhas.push("END:VALARM");

    linhas.push("BEGIN:VALARM");
    linhas.push("TRIGGER:-PT1H");
    linhas.push("ACTION:DISPLAY");
    linhas.push(`DESCRIPTION:${escaparTextoIcs(`Em 1 hora: disputa ${titulo}`)}`);
    linhas.push("END:VALARM");

    linhas.push("END:VEVENT");
  }

  linhas.push("END:VCALENDAR");

  // CRLF entre linhas é exigência do RFC, não preferência de plataforma.
  return linhas.map(dobrarLinhaIcs).join("\r\n") + "\r\n";
}

/** Quantas disputas da lista realmente virariam evento. */
export function contarDisputasExportaveis(disputas: DisputaRow[]): number {
  return disputas.filter((d) => parseDisputaDate(d.dataHoraDisputa) !== null).length;
}

/** Dispara o download do .ics no navegador. */
export function baixarIcsDeDisputas(disputas: DisputaRow[], nomeArquivo?: string): void {
  const conteudo = gerarIcsDeDisputas(disputas);
  const blob = new Blob([conteudo], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo || `disputas-${new Date().toISOString().slice(0, 10)}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}
