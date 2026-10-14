import { useSyncExternalStore, useEffect } from "react";
import { EditalAnalysis } from "../types";
import {
  fetchEditaisFromSupabase,
  saveEditalToSupabase,
  deleteEditalFromSupabase,
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
const UPDATED_EVENT = "aip_edital_history_updated";

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

function readCache(): EditalHistoryItem[] {
  try {
    return normalizeList(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
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
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify([...ids]));
  } catch (e) {
    console.warn("Não foi possível gravar os editais removidos:", e);
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
function commit(items: EditalHistoryItem[], { persist = true } = {}) {
  if (sameList(snapshot, items)) return;
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
  // Várias abas montam ao mesmo tempo; uma busca só serve todas elas.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const { ok, rows } = await fetchEditaisFromSupabase();

    // Sem resposta do banco o cache local continua valendo — apagar aqui faria
    // o histórico sumir da tela a cada oscilação de rede.
    if (!ok) return;

    const tombstones = readTombstones();
    const remote = normalizeList(rows).filter(item => !tombstones.has(item.id));
    const remoteIds = new Set(remote.map(i => i.id));

    // Itens que existem só localmente (o save no banco falhou, ou foram criados
    // offline) são preservados e reenviados, em vez de sumirem quando a lista do
    // banco sobrescrevia o cache inteiro.
    const pendingLocal = snapshot.filter(item => !remoteIds.has(item.id) && !tombstones.has(item.id));
    pendingLocal.forEach(item => { saveEditalToSupabase(item).catch(() => {}); });

    // Lápides de itens que já não estão no banco cumpriram seu papel e são
    // descartadas, para a lista não crescer indefinidamente.
    const stillNeeded = new Set([...tombstones].filter(id => rows.some((r: any) => String(r?.id) === id)));
    if (stillNeeded.size !== tombstones.size) writeTombstones(stillNeeded);

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

  commit([item, ...snapshot.filter(h => h.id !== item.id)]);
  saveEditalToSupabase(item).catch(() => {});
  window.dispatchEvent(new CustomEvent("aip_edital_analyzed", { detail: item }));
  return item;
}

export async function removeEditalFromHistory(id: string): Promise<void> {
  commit(snapshot.filter(item => item.id !== id));

  const removed = await deleteEditalFromSupabase(id).catch(() => false);
  // Não saiu do banco: registra a lápide para não voltar na próxima busca.
  if (!removed) {
    const tombstones = readTombstones();
    tombstones.add(String(id));
    writeTombstones(tombstones);
  }
}

export async function clearEditalHistory(): Promise<void> {
  const previous = snapshot;
  commit([]);

  const results = await Promise.all(
    previous.map(item => deleteEditalFromSupabase(item.id).catch(() => false))
  );

  const tombstones = readTombstones();
  previous.forEach((item, i) => { if (!results[i]) tombstones.add(String(item.id)); });
  writeTombstones(tombstones);
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
