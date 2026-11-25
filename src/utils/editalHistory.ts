import { useSyncExternalStore, useEffect } from "react";
import { EditalAnalysis } from "../types";
import {
  fetchEditaisFromSupabase,
  saveEditalToSupabase,
  deleteEditalFromSupabase,
  clearAllEditaisFromSupabase,
  subscribeToSupabaseTable,
  generateUUID,
} from "./supabaseClient";

// ═══════════════════════════════════════════════════════════════════════
// FONTE ÚNICA DA VERDADE do histórico de editais analisados.
//
// Regras fundamentais de integridade:
// 1. O Supabase é a fonte autoritativa: itens que deixaram de existir no
//    banco NUNCA são regravados automaticamente a partir do cache local,
//    exceto se estiverem explicitamente na fila `pendingSyncIds` (criação
//    ou edição cuja gravação no banco realmente falhou).
// 2. Exclusões (individual ou "Apagar Tudo") são registradas em memória
//    (`memoryTombstones` + `deletingIdsInFlight`) e no `localStorage`,
//    com cache local compacto (sem `rawText` gigante) para nunca estourar
//    a cota de 5 MB do navegador e nunca deixar registros obsoletos presos.
// ═══════════════════════════════════════════════════════════════════════

export interface EditalHistoryItem {
  id: string;
  title: string;
  date: string;
  analysis: EditalAnalysis;
}

export interface EditalHistoryActionResult {
  ok: boolean;
  error?: string;
}

const STORAGE_KEY = "aip_edital_history";
const TOMBSTONE_KEY = "aip_edital_history_removidos";
const PENDING_SYNC_KEY = "aip_edital_history_pendentes";
const MAX_TOMBSTONES = 500;
const UPDATED_EVENT = "aip_edital_history_updated";

// Proteção em RAM (funciona mesmo se localStorage estiver cheio ou indisponível)
const memoryTombstones = new Set<string>();
const deletingIdsInFlight = new Set<string>();
const pendingSyncIds = new Set<string>();
let clearAllInFlight = false;

// ─────────────────────────── normalização ───────────────────────────

export function normalizeEditalHistoryItem(raw: any): EditalHistoryItem | null {
  if (!raw || typeof raw !== "object") return null;

  const analysis =
    raw.analysis ||
    raw.analysis_data ||
    (raw.descricaoProduto || raw.identificacaoCertame ? raw : null);
  if (!analysis) return null;

  const id = String(raw.id || generateUUID());
  const title =
    raw.title ||
    (analysis.descricaoProduto
      ? `Análise - ${String(analysis.descricaoProduto).slice(0, 50)}...`
      : "") ||
    analysis.identificacaoCertame?.orgaoComprador ||
    "Análise de Edital";
  const date = raw.date || raw.updated_at || "";

  return { id, title, date, analysis };
}

function normalizeList(list: any): EditalHistoryItem[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: EditalHistoryItem[] = [];
  for (const raw of list) {
    const item = normalizeEditalHistoryItem(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

// ─────────────────────────── persistência local segura ───────────────────────────

function readStoredIdSet(key: string): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function writeStoredIdSet(key: string, ids: Set<string>, maxItems = MAX_TOMBSTONES) {
  try {
    const arr = [...ids];
    const trimmed = arr.length > maxItems ? arr.slice(arr.length - maxItems) : arr;
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // Se a cota estiver lotada pelo cache de editais, remove o cache obsoleto primeiro
    // e tenta gravar o conjunto pequeno de IDs novamente.
    try {
      localStorage.removeItem(STORAGE_KEY);
      const arr = [...ids];
      const trimmed = arr.length > maxItems ? arr.slice(arr.length - maxItems) : arr;
      localStorage.setItem(key, JSON.stringify(trimmed));
    } catch (e) {
      console.warn(`Não foi possível gravar ${key}:`, e);
    }
  }
}

function getAllTombstones(): Set<string> {
  const combined = new Set<string>(memoryTombstones);
  for (const id of readStoredIdSet(TOMBSTONE_KEY)) {
    combined.add(id);
  }
  return combined;
}

function persistTombstoneIds(ids: Iterable<string>) {
  const combined = getAllTombstones();
  for (const id of ids) {
    const clean = String(id || "").trim();
    if (!clean) continue;
    memoryTombstones.add(clean);
    combined.add(clean);
  }
  writeStoredIdSet(TOMBSTONE_KEY, combined);
}

function hydratePendingSyncIds(): Set<string> {
  const stored = readStoredIdSet(PENDING_SYNC_KEY);
  for (const id of stored) {
    pendingSyncIds.add(id);
  }
  return pendingSyncIds;
}

function markPendingSync(id: string) {
  const clean = String(id || "").trim();
  if (!clean) return;
  pendingSyncIds.add(clean);
  writeStoredIdSet(PENDING_SYNC_KEY, pendingSyncIds);
}

function clearPendingSync(id: string) {
  const clean = String(id || "").trim();
  if (!clean) return;
  pendingSyncIds.delete(clean);
  writeStoredIdSet(PENDING_SYNC_KEY, pendingSyncIds);
}

// Remove campos gigantes (como rawText integral do PDF) antes de gravar no localStorage
// para evitar QuotaExceededError silencioso que travava exclusões e tombstones.
function compactItemForCache(item: EditalHistoryItem, minimal = false): EditalHistoryItem {
  const analysis: any = item.analysis && typeof item.analysis === "object" ? { ...item.analysis } : {};
  if (typeof analysis.rawText === "string" && analysis.rawText.length > 400) {
    delete analysis.rawText;
  }
  if (minimal) {
    return {
      id: item.id,
      title: item.title,
      date: item.date,
      analysis: {
        descricaoProduto: analysis.descricaoProduto || "",
        identificacaoCertame: analysis.identificacaoCertame || {},
        viabilidadeFinanceira: analysis.viabilidadeFinanceira || {},
        parecerFinal: analysis.parecerFinal || {},
        itensEdital: Array.isArray(analysis.itensEdital) ? analysis.itensEdital.slice(0, 20) : [],
        pontosPositivos: [],
        pontosAlerta: [],
        documentosExigidos: [],
        prazoEntrega: analysis.prazoEntrega || "",
        prazoPagamento: analysis.prazoPagamento || "",
        reportMarkdown: "",
      } as EditalAnalysis,
    };
  }
  return {
    id: item.id,
    title: item.title,
    date: item.date,
    analysis: analysis as EditalAnalysis,
  };
}

function readCache(): EditalHistoryItem[] {
  try {
    const tombstones = getAllTombstones();
    return normalizeList(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")).filter(
      (item) => !tombstones.has(item.id) && !deletingIdsInFlight.has(item.id)
    );
  } catch {
    return [];
  }
}

function writeCache(items: EditalHistoryItem[]) {
  if (items.length === 0) {
    try {
      localStorage.setItem(STORAGE_KEY, "[]");
    } catch {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // storage indisponível
      }
    }
    return;
  }

  try {
    const compacted = items.map((item) => compactItemForCache(item, false));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(compacted));
  } catch {
    // Se exceder a cota mesmo compactado, limpa o cache antigo PRIMEIRO para
    // garantir que itens já apagados NUNCA permaneçam no localStorage.
    try {
      localStorage.removeItem(STORAGE_KEY);
      const minimal = items.slice(0, 30).map((item) => compactItemForCache(item, true));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal));
    } catch (e) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // storage indisponível
      }
      console.warn("Não foi possível gravar o cache local de editais (mantendo apenas memória/Supabase):", e);
    }
  }
}

// ─────────────────────────── store ───────────────────────────

hydratePendingSyncIds();
let snapshot: EditalHistoryItem[] = readCache();
const listeners = new Set<() => void>();

function sameList(a: EditalHistoryItem[], b: EditalHistoryItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (item, i) => item.id === b[i].id && item.title === b[i].title && item.date === b[i].date
  );
}

// Só troca a referência quando o conteúdo muda de verdade — useSyncExternalStore
// entra em laço infinito se getSnapshot devolver um array novo a cada chamada.
function commit(items: EditalHistoryItem[], { persist = true, force = false } = {}) {
  if (!force && sameList(snapshot, items)) return;
  snapshot = items;
  if (persist) writeCache(items);
  listeners.forEach((l) => l());
  window.dispatchEvent(new Event(UPDATED_EVENT));
}

export function getEditalHistory(): EditalHistoryItem[] {
  return snapshot;
}

export function subscribeEditalHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ─────────────────────────── sincronização ───────────────────────────

let inFlight: Promise<void> | null = null;

export function refreshEditalHistory(): Promise<void> {
  // Se uma limpeza total está em andamento, não ressuscita dados antigos do banco.
  if (clearAllInFlight) return Promise.resolve();
  // Várias abas montam ao mesmo tempo; uma busca só serve todas elas.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const { ok, rows } = await fetchEditaisFromSupabase();

    // Sem resposta do banco o cache local continua valendo — apagar aqui faria
    // o histórico sumir da tela a cada oscilação de rede.
    if (!ok || clearAllInFlight) return;

    // Relê as lápides após o await para incluir qualquer exclusão feita pelo
    // usuário enquanto o SELECT estava em andamento.
    const tombstones = getAllTombstones();
    const allNormalizedRemote = normalizeList(rows);
    const remote = allNormalizedRemote.filter(
      (item) => !tombstones.has(item.id) && !deletingIdsInFlight.has(item.id)
    );
    const remoteIds = new Set(remote.map((i) => i.id));

    // Qualquer item que já existe no Supabase não precisa mais ficar na fila pendente
    for (const id of remoteIds) {
      if (pendingSyncIds.has(id)) {
        clearPendingSync(id);
      }
    }

    // Se existem linhas no banco que já foram apagadas pelo usuário (presentes
    // em tombstones), tenta removê-las silenciosamente em background.
    const zombieIds = allNormalizedRemote
      .map((i) => i.id)
      .filter((id) => tombstones.has(id) && !deletingIdsInFlight.has(id));
    if (zombieIds.length > 0) {
      zombieIds.forEach((id) => {
        deleteEditalFromSupabase(id).catch(() => {});
      });
    }

    // REGRA CRÍTICA (Fim da ressurreição automática):
    // Somente preserva e reenvia itens que estão EXPLICITAMENTE em `pendingSyncIds`
    // (criados/editados offline cuja gravação inicial ainda não confirmou).
    // Se um item existia no cache mas sumiu do banco, ele foi APAGADO e NÃO deve
    // ser regravado de volta no Supabase.
    const pendingLocal = snapshot.filter(
      (item) =>
        pendingSyncIds.has(item.id) &&
        !remoteIds.has(item.id) &&
        !tombstones.has(item.id) &&
        !deletingIdsInFlight.has(item.id)
    );
    pendingLocal.forEach((item) => {
      saveEditalToSupabase(item)
        .then((res) => {
          if (res?.success) clearPendingSync(item.id);
        })
        .catch(() => {});
    });

    commit([...pendingLocal, ...remote]);
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export async function addEditalToHistory(
  analysis: EditalAnalysis,
  title?: string
): Promise<EditalHistoryItem> {
  const item: EditalHistoryItem = {
    id: generateUUID(),
    title:
      title ||
      (analysis.descricaoProduto
        ? `Análise - ${analysis.descricaoProduto.slice(0, 50)}...`
        : "Análise de Edital"),
    date: new Date().toLocaleString("pt-BR"),
    analysis,
  };

  // Marca como pendente até o Supabase confirmar a gravação
  markPendingSync(item.id);
  commit([item, ...snapshot.filter((h) => h.id !== item.id)], { force: true });

  saveEditalToSupabase(item)
    .then((res) => {
      if (res?.success) clearPendingSync(item.id);
    })
    .catch(() => {});

  window.dispatchEvent(new CustomEvent("aip_edital_analyzed", { detail: item }));
  return item;
}

export async function updateEditalInHistory(
  id: string,
  analysis: EditalAnalysis,
  title?: string
): Promise<EditalHistoryItem | null> {
  const strId = String(id);
  // Nunca ressuscita um edital que o usuário já apagou
  if (getAllTombstones().has(strId) || deletingIdsInFlight.has(strId)) {
    return null;
  }

  const existing = snapshot.find((h) => h.id === strId);
  if (!existing) {
    return addEditalToHistory(analysis, title);
  }
  const updated: EditalHistoryItem = {
    ...existing,
    title: title || existing.title,
    analysis,
  };
  markPendingSync(updated.id);
  commit(
    snapshot.map((h) => (h.id === strId ? updated : h)),
    { force: true }
  );
  saveEditalToSupabase(updated)
    .then((res) => {
      if (res?.success) clearPendingSync(updated.id);
    })
    .catch(() => {});
  return updated;
}

export async function removeEditalFromHistory(id: string): Promise<EditalHistoryActionResult> {
  const strId = String(id || "").trim();
  if (!strId) return { ok: true };

  deletingIdsInFlight.add(strId);
  clearPendingSync(strId);

  // 1. Atualiza o cache primeiro (liberando espaço no localStorage) e grava a
  //    lápide em memória + localStorage ANTES da chamada de rede.
  memoryTombstones.add(strId);
  commit(
    snapshot.filter((item) => item.id !== strId),
    { force: true }
  );
  persistTombstoneIds([strId]);

  try {
    const result = await deleteEditalFromSupabase(strId);
    return {
      ok: result.ok,
      error: result.ok ? undefined : result.error,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Erro ao excluir a análise no banco de dados.",
    };
  } finally {
    deletingIdsInFlight.delete(strId);
  }
}

export async function clearEditalHistory(): Promise<EditalHistoryActionResult> {
  const previous = snapshot;
  const idsToClear = previous.map((item) => String(item.id)).filter(Boolean);

  clearAllInFlight = true;
  idsToClear.forEach((id) => {
    deletingIdsInFlight.add(id);
    memoryTombstones.add(id);
    pendingSyncIds.delete(id);
  });

  // 1. Zera lista e cache local primeiro (liberando todo espaço do localStorage)
  commit([], { force: true });
  writeStoredIdSet(PENDING_SYNC_KEY, pendingSyncIds);
  persistTombstoneIds(idsToClear);

  try {
    const result = await clearAllEditaisFromSupabase(idsToClear);
    return {
      ok: result.ok,
      error: result.ok ? undefined : result.error,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Erro ao limpar análises no banco de dados.",
    };
  } finally {
    idsToClear.forEach((id) => deletingIdsInFlight.delete(id));
    clearAllInFlight = false;
  }
}

// Logout: zera memória, cache, fila pendente e lápides.
export function resetEditalHistory() {
  memoryTombstones.clear();
  deletingIdsInFlight.clear();
  pendingSyncIds.clear();
  clearAllInFlight = false;
  inFlight = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOMBSTONE_KEY);
    localStorage.removeItem(PENDING_SYNC_KEY);
  } catch {
    /* storage indisponível */
  }
  commit([], { persist: false, force: true });
}

// ─────────────────────────── ligação com a janela ───────────────────────────

let wired = false;

function wireOnce() {
  if (wired) return;
  wired = true;

  const resync = () => {
    refreshEditalHistory();
  };

  subscribeToSupabaseTable("editais_analisados", resync);
  window.addEventListener("focus", resync);

  // Outra aba do navegador mexeu no histórico.
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY || e.key === TOMBSTONE_KEY) {
      commit(readCache(), { persist: false });
    }
  });
}

export function useEditalHistory(): EditalHistoryItem[] {
  const history = useSyncExternalStore(
    subscribeEditalHistory,
    getEditalHistory,
    getEditalHistory
  );

  useEffect(() => {
    wireOnce();
    refreshEditalHistory();
  }, []);

  return history;
}
