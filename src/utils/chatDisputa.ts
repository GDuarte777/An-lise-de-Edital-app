import { ChatSession, DisputaRow } from "../types";

// ═══════════════════════════════════════════════════════════════════════
// ABRIR O CHAT DA IA JÁ FALANDO DE UMA DISPUTA ESPECÍFICA
//
// Antes, para discutir uma disputa com a IA era preciso abrir o chat e
// redigitar tudo: qual órgão, qual pregão, quando é a sessão, qual o alvo de
// lance. Os dados já estavam na linha — só não chegavam ao chat.
//
// O caminho é um evento de janela (a convenção `aip_*` que o resto da
// plataforma já usa) carregando a disputa. O chat escuta, abre um canal novo
// semeado com os dados reais daquela linha e passa a conversar sobre ela.
//
// Duas regras de projeto aqui:
//
//  1. O id da sessão é derivado do id da disputa. Clicar duas vezes reabre a
//     MESMA conversa em vez de criar outra — este componente já teve histórico
//     de acumular dezenas de canais vazios por id gerado com Date.now().
//  2. O resumo só contém campo preenchido da planilha, e diz explicitamente
//     que o edital não está ali. A IA recebendo uma linha de planilha não pode
//     concluir exigências de habilitação a partir dela; sem esse aviso, é
//     exatamente o que ela faria.
// ═══════════════════════════════════════════════════════════════════════

/** Evento de janela que pede ao chat para abrir uma disputa. */
export const EVENTO_CHAT_DISPUTA = "aip_abrir_chat_disputa";

const PREFIXO_SESSAO_DISPUTA = "chat-disputa-";

/**
 * Id estável da conversa de uma disputa.
 *
 * Derivar do id da disputa é o que faz o segundo clique reabrir a conversa
 * existente em vez de criar uma nova.
 */
export function idSessaoDaDisputa(disputaId: string): string {
  return `${PREFIXO_SESSAO_DISPUTA}${disputaId}`;
}

export function ehSessaoDeDisputa(sessionId: string): boolean {
  return String(sessionId || "").startsWith(PREFIXO_SESSAO_DISPUTA);
}

function cortar(texto: string, limite: number): string {
  const t = String(texto || "").trim();
  return t.length <= limite ? t : `${t.slice(0, limite - 1).trimEnd()}…`;
}

/** Título que identifica a conversa na lista de canais. */
export function tituloSessaoDaDisputa(row: DisputaRow): string {
  const partes = [row.numeroLicitacao, row.orgao].map(p => String(p || "").trim()).filter(Boolean);
  if (partes.length === 0) {
    const objeto = String(row.produtoItem || "").trim();
    return cortar(objeto ? `Disputa: ${objeto}` : "Disputa sem identificação", 60);
  }
  return cortar(`Disputa: ${partes.join(" — ")}`, 60);
}

const formatarBRL = (valor: number) =>
  (valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Resumo da disputa para abrir a conversa.
 *
 * Só entra campo que está preenchido: listar "Portal: não informado" gasta
 * contexto e convida a IA a preencher a lacuna por conta própria. O aviso
 * final existe pelo mesmo motivo — uma linha de planilha não é o edital, e sem
 * dizer isso a IA responderia sobre exigências de habilitação que ninguém leu.
 */
export function resumoDisputaParaChat(row: DisputaRow): string {
  const linhas: string[] = [];

  const campo = (rotulo: string, valor?: string | null) => {
    const texto = String(valor ?? "").trim();
    if (texto) linhas.push(`- **${rotulo}:** ${texto}`);
  };

  campo("Órgão", row.orgao);
  campo("Nº do pregão/processo", row.numeroLicitacao);
  campo("UASG / unidade compradora", row.uasgUndCompradora);
  campo("Portal", row.portal);
  campo("Objeto", row.produtoItem);

  if (row.quantidade > 0) {
    campo("Quantidade", `${row.quantidade} ${row.unidadeMedida || ""}`.trim());
  }
  if (row.valorEstimadoItem > 0) campo("Valor estimado", formatarBRL(row.valorEstimadoItem));
  if (row.nossoValorAlvo > 0) campo("Nosso lance alvo", formatarBRL(row.nossoValorAlvo));
  if (row.valorMinimoPiso > 0) campo("Nosso piso (não descer daqui)", formatarBRL(row.valorMinimoPiso));

  campo("Data e hora da sessão", row.dataHoraDisputa);
  campo("Status", row.status);
  campo("Anotações", row.observacoes);
  campo("Link do edital", row.linkPNCP);

  const corpo = linhas.length > 0
    ? linhas.join("\n")
    : "- (a linha desta disputa está sem dados preenchidos)";

  return [
    "Vamos falar desta disputa. Estes são os dados que estão na sua planilha:",
    "",
    corpo,
    "",
    "Importante: eu tenho só estes campos — **não li o edital desta disputa**. " +
      "Para eu analisar exigências de habilitação, prazos ou pegadinhas, anexe o edital aqui " +
      "ou use a aba de Análise de Edital.",
    "",
    "Posso ajudar com estratégia de lance a partir do seu piso e do valor estimado, " +
      "com o que conferir antes da sessão, ou com o que você quiser perguntar sobre ela.",
  ].join("\n");
}

/** Monta a sessão de chat dedicada a uma disputa. */
export function criarSessaoDaDisputa(row: DisputaRow, agora: Date = new Date()): ChatSession {
  return {
    id: idSessaoDaDisputa(row.id),
    title: tituloSessaoDaDisputa(row),
    selectedEditalId: "",
    messages: [
      {
        id: `msg-disputa-${row.id}`,
        role: "assistant",
        content: resumoDisputaParaChat(row),
        timestamp: agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      },
    ],
    createdAt: agora.toLocaleString("pt-BR"),
  };
}

/** Pede ao chat flutuante que abra a conversa desta disputa. */
export function abrirChatDaDisputa(row: DisputaRow): void {
  window.dispatchEvent(new CustomEvent(EVENTO_CHAT_DISPUTA, { detail: { disputa: row } }));
}
