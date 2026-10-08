// ═══════════════════════════════════════════════════════════════════════
// ACERVO DA PLATAFORMA PARA O CHAT
//
// O chat só enxergava o edital que o usuário tivesse selecionado no Foco da
// conversa. Perguntar "já analisamos algum edital com UASG 927374?" não tinha
// resposta possível: a informação existe no banco, mas nunca chegava ao modelo.
//
// Este módulo monta um ÍNDICE compacto do que o usuário tem na plataforma —
// editais analisados e disputas da planilha — para ir junto no contexto.
//
// Duas decisões importantes:
//
// 1. Só o índice, nunca o conteúdo inteiro. Cada análise guarda o texto bruto
//    do edital e o relatório completo; cem delas estouram qualquer orçamento de
//    tokens e de tempo. A consulta pede só os campos de identificação, por
//    caminho JSON, para o texto pesado nem sair do banco.
//
// 2. A consulta usa o JWT DO USUÁRIO. O RLS continua valendo, então cada um vê
//    apenas o que é seu, e o servidor não ganha poder de ler o acervo alheio.
//    Linha apagada some da tabela (a exclusão aqui é definitiva), então o
//    índice naturalmente só contém o que ainda existe.
// ═══════════════════════════════════════════════════════════════════════
import process from "node:process";
import { extrairCodigoUasg, normalizarCodigoUasg } from "./identificacaoEdital.ts";

const MAX_EDITAIS = Number(process.env.ACERVO_MAX_EDITAIS || 150);
const MAX_DISPUTAS = Number(process.env.ACERVO_MAX_DISPUTAS || 200);
/** Teto de caracteres do índice inteiro, para não comer o orçamento do chat. */
const MAX_CARACTERES = Number(process.env.ACERVO_MAX_CARACTERES || 12_000);

export interface Acervo {
  texto: string;
  editais: number;
  disputas: number;
  leu: boolean;
}

function base(): { url: string; chave: string } {
  return {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
    chave: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "",
  };
}

async function buscar(caminho: string, token: string): Promise<any[] | null> {
  const { url, chave } = base();
  if (!url || !chave) return null;
  try {
    const controle = new AbortController();
    const prazo = setTimeout(() => controle.abort(), 8_000);
    const resp = await fetch(`${url}/rest/v1/${caminho}`, {
      headers: { apikey: chave, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: controle.signal,
    });
    clearTimeout(prazo);
    if (!resp.ok) {
      console.warn(`[acervo] ${caminho} respondeu ${resp.status}`);
      return null;
    }
    const linhas = await resp.json();
    return Array.isArray(linhas) ? linhas : [];
  } catch (erro: any) {
    console.warn(`[acervo] falha ao ler ${caminho}:`, erro?.message || erro);
    return null;
  }
}

function limpo(valor: unknown): string {
  return String(valor ?? "").replace(/\s+/g, " ").trim();
}

/** Monta o índice do que este usuário tem na plataforma. */
export async function montarAcervo(authHeader: string | undefined): Promise<Acervo> {
  const vazio: Acervo = { texto: "", editais: 0, disputas: 0, leu: false };
  if (!authHeader || !authHeader.startsWith("Bearer ")) return vazio;
  const token = authHeader.slice(7);

  const [editais, disputas] = await Promise.all([
    buscar(
      `editais_analisados?select=id,title,date,ident:analysis->identificacaoCertame&order=updated_at.desc&limit=${MAX_EDITAIS}`,
      token
    ),
    buscar(
      `planilhas_disputas?select=orgao,uasg_und_compradora,numero_licitacao,portal,produto_item,data_hora_disputa,status,link_pncp&order=updated_at.desc&limit=${MAX_DISPUTAS}`,
      token
    ),
  ]);

  if (editais === null && disputas === null) return vazio;

  const linhas: string[] = [];

  linhas.push(`EDITAIS ANALISADOS NA PLATAFORMA (${(editais || []).length}):`);
  if (!editais || editais.length === 0) {
    linhas.push("  (nenhum)");
  } else {
    for (const e of editais) {
      const ident: any = e.ident || {};
      const uasg =
        normalizarCodigoUasg(ident.codigoUASG) ||
        normalizarCodigoUasg(ident.uasg) ||
        extrairCodigoUasg(limpo(ident.orgaoComprador));
      const campos = [
        `título: ${limpo(e.title) || "—"}`,
        `órgão: ${limpo(ident.orgaoComprador) || "—"}`,
        `UASG: ${uasg || "—"}`,
        `nº: ${limpo(ident.numeroEdital) || limpo(ident.identificacaoNumerica) || "—"}`,
        `modalidade: ${limpo(ident.modalidade) || "—"}`,
        `sessão: ${limpo(ident.dataHoraSessao) || "—"}`,
        `analisado em: ${limpo(e.date) || "—"}`,
      ];
      if (limpo(ident.linkPNCP)) campos.push(`PNCP: ${limpo(ident.linkPNCP)}`);
      linhas.push(`  - ${campos.join(" | ")}`);
    }
  }

  linhas.push("");
  linhas.push(`DISPUTAS NA PLANILHA (${(disputas || []).length}):`);
  if (!disputas || disputas.length === 0) {
    linhas.push("  (nenhuma)");
  } else {
    for (const d of disputas) {
      const campos = [
        `órgão: ${limpo(d.orgao) || "—"}`,
        `UASG: ${normalizarCodigoUasg(d.uasg_und_compradora) || "—"}`,
        `nº: ${limpo(d.numero_licitacao) || "—"}`,
        `portal: ${limpo(d.portal) || "—"}`,
        `item: ${limpo(d.produto_item).slice(0, 80) || "—"}`,
        `disputa: ${limpo(d.data_hora_disputa) || "—"}`,
        `status: ${limpo(d.status) || "—"}`,
      ];
      linhas.push(`  - ${campos.join(" | ")}`);
    }
  }

  let texto = linhas.join("\n");
  if (texto.length > MAX_CARACTERES) {
    texto =
      texto.slice(0, MAX_CARACTERES) +
      "\n  [...] índice truncado por tamanho — há mais registros do que os listados acima.";
  }

  return {
    texto,
    editais: (editais || []).length,
    disputas: (disputas || []).length,
    leu: editais !== null || disputas !== null,
  };
}
