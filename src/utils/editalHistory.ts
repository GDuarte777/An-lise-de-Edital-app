import { useSyncExternalStore, useEffect } from "react";
import { EditalAnalysis } from "../types";
import {
  fetchEditaisFromSupabase,
  saveEditalToSupabase,
  deleteEditalFromSupabase,
  clearAllEditaisFromSupabase,
  subscribeToSupabaseTable,
  generateUUID
} from "./supabaseClient";

// ═══════════════════════════════════════════════════════════════════════
// FONTE ÚNICA DA VERDADE do histórico de editais analisados.
//
// Antes cada aba carregava o histórico por conta própria — umas liam só o
// localStorage, outras o Supabase primeiro, outras liam uma única vez no
// mount e nunca mais. O resultado era o que o usuário via: uma ferramenta
// com editais já apagados, outra atualizada, e a aba de análise com uma
// contagem diferente das duas. Agora todas leem deste módulo, que mantém
// uma lista só, sincroniza com o Supabase e avisa todo mundo a cada mudança.
// ═══════════════════════════════════════════════════════════════════════

export interface EditalHistoryItem {
  id: string;
  title: string;
  date: string;
  analysis: EditalAnalysis;
}

const STORAGE_KEY = "aip_edital_history";
// Ids apagados pelo usuário. Se o DELETE no banco falhar (RLS, id de outro
// usuário, offline), a linha continua lá e voltaria na próxima sincronização.
// A lápide garante que o que o usuário apagou fica apagado.
const TOMBSTONE_KEY = "aip_edital_history_removidos";
const MAX_TOMBSTONES = 500;
const UPDATED_EVENT = "aip_edital_history_updated";

// Conjunto em memória de IDs atualmente sendo apagados para evitar que
// eventos Realtime ou focus restaurem linhas enquanto o DELETE está em voo.
const deletingIdsInFlight = new Set<string>();
let clearAllInFlight = false;

// ─────────────────────────── normalização ───────────────────────────

// Aceita as três formas que já circulam pelo app (item local, linha crua do
// banco, e o formato antigo com `analysis_data`) e devolve sempre a mesma.
export function normalizeEditalHistoryItem(raw: any): EditalHistoryItem | null {
  if (!raw || typeof raw !== "object") return null;

  const analysis = raw.analysis || raw.analysis_data || (raw.descricaoProduto || raw.identificacaoCertame ? raw : null);
  if (!analysis) return null;

  const id = String(raw.id || generateUUID());
  const title =
    raw.title ||
    (analysis.descricaoProduto ? `Análise - ${String(analysis.descricaoProduto).slice(0, 50)}...` : "") ||
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

// ─────────────────────────── persistência local ───────────────────────────

function readTombstones(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOMBSTONE_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeTombstones(ids: Set<string>) {
  try {
    const arr = [...ids];
    const trimmed = arr.length > MAX_TOMBSTONES ? arr.slice(arr.length - MAX_TOMBSTONES) : arr;
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn("Não foi possível gravar os editais removidos:", e);
  }
}

function readCache(): EditalHistoryItem[] {
  try {
    const tombstones = readTombstones();
    return normalizeList(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")).filter(
      item => !tombstones.has(item.id) && !deletingIdsInFlight.has(item.id)
    );
  } catch {
    return [];
  }
}

function writeCache(items: EditalHistoryItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    console.warn("Não foi possível gravar o histórico de editais:", e);
  }
}

// ─────────────────────────── store ───────────────────────────

let snapshot: EditalHistoryItem[] = readCache();
const listeners = new Set<() => void>();

function sameList(a: EditalHistoryItem[], b: EditalHistoryItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, i) => item.id === b[i].id && item.title === b[i].title && item.date === b[i].date);
}

// Só troca a referência quando o conteúdo muda de verdade — useSyncExternalStore
// entra em laço infinito se getSnapshot devolver um array novo a cada chamada.
function commit(items: EditalHistoryItem[], { persist = true, force = false } = {}) {
  if (!force && sameList(snapshot, items)) return;
  snapshot = items;
  if (persist) writeCache(items);
  listeners.forEach(l => l());
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
    const tombstones = readTombstones();
    const remote = normalizeList(rows).filter(
      item => !tombstones.has(item.id) && !deletingIdsInFlight.has(item.id)
    );
    const remoteIds = new Set(remote.map(i => i.id));

    // Se existem linhas no banco que já foram apagadas pelo usuário (presentes
    // em tombstones), tenta removê-las silenciosamente em background.
    const zombieIds = normalizeList(rows)
      .map(i => i.id)
      .filter(id => tombstones.has(id) && !deletingIdsInFlight.has(id));
    if (zombieIds.length > 0) {
      zombieIds.forEach(id => { deleteEditalFromSupabase(id).catch(() => {}); });
    }

    // Itens que existem só localmente (o save no banco falhou, ou foram criados
    // offline) são preservados e reenviados, desde que não tenham sido apagados.
    const pendingLocal = snapshot.filter(
      item => !remoteIds.has(item.id) && !tombstones.has(item.id) && !deletingIdsInFlight.has(item.id)
    );
    pendingLocal.forEach(item => { saveEditalToSupabase(item).catch(() => {}); });

    commit([...pendingLocal, ...remote]);
  })().finally(() => { inFlight = null; });

  return inFlight;
}

export async function addEditalToHistory(analysis: EditalAnalysis, title?: string): Promise<EditalHistoryItem> {
  const item: EditalHistoryItem = {
    // UUID em vez de Date.now(): duas análises no mesmo milissegundo geravam o
    // mesmo id e uma sobrescrevia a outra no upsert.
    id: generateUUID(),
    title: title || (analysis.descricaoProduto ? `Análise - ${analysis.descricaoProduto.slice(0, 50)}...` : "Análise de Edital"),
    date: new Date().toLocaleString("pt-BR"),
    analysis
  };

  commit([item, ...snapshot.filter(h => h.id !== item.id)], { force: true });
  saveEditalToSupabase(item).catch(() => {});
  window.dispatchEvent(new CustomEvent("aip_edital_analyzed", { detail: item }));
  return item;
}

export async function updateEditalInHistory(id: string, analysis: EditalAnalysis, title?: string): Promise<EditalHistoryItem | null> {
  const existing = snapshot.find(h => h.id === id);
  if (!existing) {
    return addEditalToHistory(analysis, title);
  }
  const updated: EditalHistoryItem = {
    ...existing,
    title: title || existing.title,
    analysis,
  };
  commit(snapshot.map(h => (h.id === id ? updated : h)), { force: true });
  saveEditalToSupabase(updated).catch(() => {});
  return updated;
}

export async function removeEditalFromHistory(id: string): Promise<void> {
  const strId = String(id);
  deletingIdsInFlight.add(strId);

  // Grava a lápide IMEDIATAMENTE antes da chamada de rede para que nenhum
  // evento Realtime ou focus traga o item de volta durante o DELETE.
  const tombstones = readTombstones();
  tombstones.add(strId);
  writeTombstones(tombstones);

  commit(snapshot.filter(item => item.id !== strId), { force: true });

  try {
    await deleteEditalFromSupabase(strId);
  } catch {
    // A lápide já garante que o item não voltará.
  } finally {
    deletingIdsInFlight.delete(strId);
  }
}

export async function clearEditalHistory(): Promise<void> {
  const previous = snapshot;
  const idsToClear = previous.map(item => String(item.id));

  clearAllInFlight = true;
  idsToClear.forEach(id => deletingIdsInFlight.add(id));

  // Registra todas as lápides IMEDIATAMENTE antes de chamar o Supabase.
  const tombstones = readTombstones();
  idsToClear.forEach(id => tombstones.add(id));
  writeTombstones(tombstones);

  commit([], { force: true });

  try {
    await clearAllEditaisFromSupabase(idsToClear);
    await Promise.all(
      idsToClear.map(id => deleteEditalFromSupabase(id).catch(() => false))
    );
  } catch {
    // Lápides já gravadas localmente impedem que voltem.
  } finally {
    idsToClear.forEach(id => deletingIdsInFlight.delete(id));
    clearAllInFlight = false;
  }
}

// Logout: zera memória, cache e lápides. Sem isso o histórico do usuário
// anterior continuaria em memória para quem entrasse em seguida.
export function resetEditalHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOMBSTONE_KEY);
  } catch { /* storage indisponível */ }
  commit([], { persist: false });
}

// ─────────────────────────── ligação com a janela ───────────────────────────

let wired = false;

// Uma assinatura de realtime e um jogo de listeners para o app inteiro, em vez
// de cada aba abrir os seus.
function wireOnce() {
  if (wired) return;
  wired = true;

  const resync = () => { refreshEditalHistory(); };

  subscribeToSupabaseTable("editais_analisados", resync);
  window.addEventListener("focus", resync);

  // Outra aba do navegador mexeu no histórico.
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY || e.key === TOMBSTONE_KEY) commit(readCache(), { persist: false });
  });
}

export function useEditalHistory(): EditalHistoryItem[] {
  const history = useSyncExternalStore(subscribeEditalHistory, getEditalHistory, getEditalHistory);

  useEffect(() => {
    wireOnce();
    refreshEditalHistory();
  }, []);

  return history;
}
