import { Nota, PastaNotas } from "../types";

// ═══════════════════════════════════════════════════════════════════════
// BLOCO DE NOTAS — REGRAS DE PASTA, BUSCA E ORDENAÇÃO
//
// A aba em si é uma tela de três colunas (pastas · lista · editor). O que está
// aqui é só o que decide conteúdo: onde cada nota mora, qual aparece na busca,
// em que ordem a lista sai e o que acontece quando uma pasta é apagada.
//
// Mora fora do componente porque é isso que dá para testar sem renderizar: um
// componente grande de edição é justamente o que a plataforma já não consegue
// cobrir com teste de renderização (ver CLAUDE.md, DisputasSheetTab).
//
// Uma nota é texto do próprio usuário. Nada aqui gera, completa ou sugere
// conteúdo — nem título: quando o campo título está vazio, o que aparece na
// lista é a primeira linha que ELE escreveu, não um resumo inventado.
// ═══════════════════════════════════════════════════════════════════════

/** Filtro da coluna de pastas: todas as notas, sem recorte. */
export const FILTRO_TODAS = "__todas__";

/** Pasta vazia (`pastaId: ""`) é "Sem pasta" — a raiz do bloco. */
export const SEM_PASTA = "";

/** Paleta das pastas. Tons que funcionam no tema claro e no escuro. */
export const CORES_PASTA = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#64748b", // slate
];

export const COR_PASTA_PADRAO = CORES_PASTA[0];

/** Teto de caracteres por nota. O conteúdo vai em coluna `text` do Postgres. */
export const LIMITE_CARACTERES_NOTA = 100_000;

const LIMITE_NOME_PASTA = 60;
const LIMITE_TITULO_NOTA = 140;

/**
 * Texto comparável: sem acento, sem caixa, sem espaço sobrando.
 *
 * Busca com acento obrigatório não serve aqui — quem digita rápido escreve
 * "habilitacao" e esperaria achar a nota chamada "Habilitação".
 */
export function normalizar(texto: string): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// ───────────────────────────── pastas ─────────────────────────────

export interface ValidacaoPasta {
  ok: boolean;
  erros: { nome?: string };
  nome: string;
}

/**
 * Valida o nome de uma pasta.
 *
 * Nome duplicado é recusado porque duas pastas com o mesmo rótulo tornam a
 * coluna da esquerda inútil — não há como saber em qual a nota foi guardada.
 * `idAtual` existe para a renomeação não colidir com a própria pasta.
 */
export function validarPasta(
  nome: string,
  pastas: PastaNotas[] = [],
  idAtual?: string,
): ValidacaoPasta {
  const limpo = String(nome ?? "").trim().slice(0, LIMITE_NOME_PASTA);
  const erros: { nome?: string } = {};

  if (!limpo) {
    erros.nome = "Dê um nome à pasta.";
  } else {
    const jaExiste = pastas.some(
      (p) => p.id !== idAtual && normalizar(p.nome) === normalizar(limpo),
    );
    if (jaExiste) erros.nome = "Já existe uma pasta com esse nome.";
  }

  return { ok: Object.keys(erros).length === 0, erros, nome: limpo };
}

/** Monta uma pasta nova, no fim da lista. */
export function criarPasta(
  dados: { id: string; nome: string; cor?: string },
  pastas: PastaNotas[] = [],
): PastaNotas {
  const posicoes = pastas.map((p) => Number(p.posicao) || 0);
  return {
    id: dados.id,
    nome: String(dados.nome ?? "").trim().slice(0, LIMITE_NOME_PASTA),
    cor: dados.cor || COR_PASTA_PADRAO,
    posicao: posicoes.length > 0 ? Math.max(...posicoes) + 1 : 0,
  };
}

export function ordenarPastas(pastas: PastaNotas[]): PastaNotas[] {
  return [...pastas].sort((a, b) => {
    const pa = Number(a.posicao) || 0;
    const pb = Number(b.posicao) || 0;
    if (pa !== pb) return pa - pb;
    return normalizar(a.nome).localeCompare(normalizar(b.nome));
  });
}

/**
 * Notas da pasta apagada voltam para a raiz.
 *
 * Apagar a pasta junto com as notas dentro dela destruiria texto que o usuário
 * escreveu por um clique num botão de organização. As notas reaparecem em "Sem
 * pasta", onde ele decide o que fazer com elas.
 */
export function desvincularNotasDaPasta(notas: Nota[], pastaId: string): Nota[] {
  return notas.map((n) => (n.pastaId === pastaId ? { ...n, pastaId: SEM_PASTA } : n));
}

/**
 * Pasta que não existe mais (apagada em outro dispositivo) não deve sumir com
 * a nota: ela cai para a raiz em vez de ficar invisível em todos os filtros.
 */
export function reconciliarPastas(notas: Nota[], pastas: PastaNotas[]): Nota[] {
  const ids = new Set(pastas.map((p) => p.id));
  return notas.map((n) => (n.pastaId && !ids.has(n.pastaId) ? { ...n, pastaId: SEM_PASTA } : n));
}

// ───────────────────────────── notas ─────────────────────────────

export function criarNota(
  dados: { id: string; pastaId?: string; titulo?: string; conteudo?: string },
  agora: Date = new Date(),
): Nota {
  const quando = agora.toISOString();
  return {
    id: dados.id,
    pastaId: dados.pastaId && dados.pastaId !== FILTRO_TODAS ? dados.pastaId : SEM_PASTA,
    titulo: String(dados.titulo ?? "").slice(0, LIMITE_TITULO_NOTA),
    conteudo: String(dados.conteudo ?? "").slice(0, LIMITE_CARACTERES_NOTA),
    fixada: false,
    criadaEm: quando,
    atualizadaEm: quando,
  };
}

/** Aplica uma edição e marca a hora. Campos não enviados ficam como estavam. */
export function aplicarEdicaoNota(
  nota: Nota,
  campos: Partial<Pick<Nota, "titulo" | "conteudo" | "pastaId" | "fixada">>,
  agora: Date = new Date(),
): Nota {
  return {
    ...nota,
    ...(campos.titulo !== undefined ? { titulo: campos.titulo.slice(0, LIMITE_TITULO_NOTA) } : {}),
    ...(campos.conteudo !== undefined
      ? { conteudo: campos.conteudo.slice(0, LIMITE_CARACTERES_NOTA) }
      : {}),
    ...(campos.pastaId !== undefined ? { pastaId: campos.pastaId } : {}),
    ...(campos.fixada !== undefined ? { fixada: campos.fixada } : {}),
    atualizadaEm: agora.toISOString(),
  };
}

/**
 * O que a lista mostra como título.
 *
 * Sem título preenchido, usa a primeira linha NÃO VAZIA do conteúdo — texto do
 * próprio usuário, não um resumo gerado. Sem conteúdo nenhum, diz que a nota
 * está sem título em vez de mostrar uma linha em branco e parecer um bug.
 */
export function tituloVisivel(nota: Pick<Nota, "titulo" | "conteudo">): string {
  const titulo = String(nota?.titulo ?? "").trim();
  if (titulo) return titulo;

  const primeiraLinha = String(nota?.conteudo ?? "")
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .find(Boolean);

  if (primeiraLinha) {
    return primeiraLinha.length <= 80 ? primeiraLinha : `${primeiraLinha.slice(0, 79).trimEnd()}…`;
  }
  return "Nota sem título";
}

/** Trecho de uma linha para o cartão da lista. */
export function previaNota(nota: Pick<Nota, "titulo" | "conteudo">, limite = 100): string {
  const titulo = String(nota?.titulo ?? "").trim();
  const linhas = String(nota?.conteudo ?? "")
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .filter(Boolean);

  // Sem título próprio, a primeira linha já virou o título: a prévia começa na
  // seguinte, para o cartão não repetir o mesmo texto duas vezes.
  const corpo = (titulo ? linhas : linhas.slice(1)).join(" · ").replace(/\s+/g, " ").trim();
  if (!corpo) return "";
  return corpo.length <= limite ? corpo : `${corpo.slice(0, limite - 1).trimEnd()}…`;
}

export interface EstatisticasTexto {
  palavras: number;
  caracteres: number;
  linhas: number;
}

export function estatisticasTexto(texto: string): EstatisticasTexto {
  const bruto = String(texto ?? "");
  const limpo = bruto.trim();
  return {
    palavras: limpo ? limpo.split(/\s+/).length : 0,
    caracteres: bruto.length,
    linhas: bruto ? bruto.split("\n").length : 0,
  };
}

/**
 * Ordem da lista: fixadas no topo, depois a mais recentemente editada.
 *
 * Empate vai para o título, para a ordem não dançar entre renderizações quando
 * duas notas têm o mesmo horário (salvamento em lote, importação).
 */
export function ordenarNotas(notas: Nota[]): Nota[] {
  return [...notas].sort((a, b) => {
    if (!!a.fixada !== !!b.fixada) return a.fixada ? -1 : 1;
    const ta = Date.parse(a.atualizadaEm || "") || 0;
    const tb = Date.parse(b.atualizadaEm || "") || 0;
    if (ta !== tb) return tb - ta;
    return normalizar(tituloVisivel(a)).localeCompare(normalizar(tituloVisivel(b)));
  });
}

export interface FiltroNotas {
  /** `FILTRO_TODAS` para não recortar; `SEM_PASTA` para a raiz; ou um id. */
  pastaId?: string;
  busca?: string;
}

/** Aplica pasta e busca (título + conteúdo, sem exigir acento) e ordena. */
export function filtrarNotas(notas: Nota[], filtro: FiltroNotas = {}): Nota[] {
  const pastaId = filtro.pastaId ?? FILTRO_TODAS;
  const termo = normalizar(filtro.busca || "");

  const recortadas = notas.filter((n) => {
    if (pastaId !== FILTRO_TODAS && (n.pastaId || SEM_PASTA) !== pastaId) return false;
    if (!termo) return true;
    return normalizar(`${n.titulo || ""} ${n.conteudo || ""}`).includes(termo);
  });

  return ordenarNotas(recortadas);
}

/** Quantas notas em cada pasta, mais os totais de "todas" e "sem pasta". */
export function contarPorPasta(notas: Nota[]): Record<string, number> {
  const contagem: Record<string, number> = { [FILTRO_TODAS]: notas.length, [SEM_PASTA]: 0 };
  for (const nota of notas) {
    const chave = nota.pastaId || SEM_PASTA;
    contagem[chave] = (contagem[chave] || 0) + 1;
  }
  return contagem;
}

/** Nota pronta para baixar como arquivo `.md`. */
export function notaParaMarkdown(nota: Nota, pasta?: PastaNotas | null): string {
  const partes = [`# ${tituloVisivel(nota)}`, ""];
  if (pasta?.nome) partes.push(`_Pasta: ${pasta.nome}_`, "");
  const conteudo = String(nota.conteudo || "").trim();
  if (conteudo) partes.push(conteudo);
  return `${partes.join("\n").trimEnd()}\n`;
}

/** Nome de arquivo seguro, derivado do título da própria nota. */
export function nomeArquivoDaNota(nota: Nota): string {
  const base = normalizar(tituloVisivel(nota))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "nota"}.md`;
}

/**
 * "agora", "há 5 min", "ontem" — a lista precisa de referência curta, e data
 * completa não cabe no cartão.
 */
export function quandoAtualizada(iso: string, agora: Date = new Date()): string {
  const quando = Date.parse(iso || "");
  if (!Number.isFinite(quando)) return "";

  const segundos = Math.round((agora.getTime() - quando) / 1000);
  if (segundos < 45) return "agora";
  if (segundos < 3600) return `há ${Math.max(1, Math.round(segundos / 60))} min`;
  if (segundos < 86400) return `há ${Math.round(segundos / 3600)} h`;

  const dia = new Date(quando);
  const meioDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((meioDia(agora) - meioDia(dia)) / 86400000);
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias} dias`;

  return dia.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
