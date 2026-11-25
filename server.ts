import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL_DEFAULT =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://cghlfhndoqohmrrvppjj.supabase.co";
const SUPABASE_ANON_KEY_DEFAULT =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_FWDd-D9L6tGwasm1-qyT1Q_c7T9m_6o";

// ═══════════════════════════════════════════════════════════════════════
// INLINED HELPERS (Zero relative local imports for Vercel Node ESM compatibility)
// ═══════════════════════════════════════════════════════════════════════

const ROTULOS_UASG =
  "UASG|U\\.?A\\.?S\\.?G\\.?|Unidade\\s+Gestora|Unidade\\s+Compradora|Und\\.?\\s*Compradora|C[óo]digo\\s+(?:da\\s+)?Unidade|C[óo]d\\.?\\s*Unidade";

function ehCodigoUasgPlausivel(valor: string | null | undefined): boolean {
  const bruto = String(valor ?? "").trim();
  if (!bruto || bruto.includes("/")) return false;
  const somenteDigitos = bruto
    .replace(new RegExp(`^\\s*(?:${ROTULOS_UASG})\\s*[:\\-]?\\s*`, "i"), "")
    .replace(/[.\s]/g, "");
  return /^\d{4,6}$/.test(somenteDigitos);
}

function normalizarCodigoUasg(valor: string | null | undefined): string {
  if (!ehCodigoUasgPlausivel(valor)) return "";
  return String(valor)
    .trim()
    .replace(new RegExp(`^\\s*(?:${ROTULOS_UASG})\\s*[:\\-]?\\s*`, "i"), "")
    .replace(/[.\s]/g, "");
}

function extrairCodigoUasg(texto: string | null | undefined): string {
  const conteudo = String(texto ?? "");
  if (!conteudo) return "";
  const comRotulo = conteudo.match(
    new RegExp(`(?:${ROTULOS_UASG})\\s*(?:n[ºo°.]?\\s*)?[:\\-]?\\s*(\\d{4,6})(?!\\s*[/\\d])`, "i")
  );
  return comRotulo ? comRotulo[1] : "";
}

const PREFIXO_CIFRADO = "enc:v1:";
const ALGORITMO_CIFRA = "aes-256-gcm";
const CAMPOS_SECRETOS = ["gemini_key", "openai_key", "anthropic_key", "deepseek_key"] as const;

function derivarChaveMestra(segredo: string | undefined | null): Buffer | null {
  const bruto = String(segredo || "").trim();
  if (!bruto) return null;
  if (/^[0-9a-fA-F]{64}$/.test(bruto)) return Buffer.from(bruto, "hex");
  return createHash("sha256").update(bruto, "utf-8").digest();
}

function estaCriptografado(valor: string | undefined | null): boolean {
  return typeof valor === "string" && valor.startsWith(PREFIXO_CIFRADO);
}

function criptografarSegredo(valor: string, chaveMestra: Buffer | null): string {
  if (!chaveMestra || !valor || estaCriptografado(valor)) return valor;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITMO_CIFRA, chaveMestra, iv);
  const cifrado = Buffer.concat([cipher.update(valor, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIXO_CIFRADO}${iv.toString("base64")}:${tag.toString("base64")}:${cifrado.toString("base64")}`;
}

function descriptografarSegredo(valor: string, chaveMestra: Buffer | null): string {
  if (!valor || !estaCriptografado(valor)) return valor || "";
  if (!chaveMestra) return "";
  try {
    const partes = valor.slice(PREFIXO_CIFRADO.length).split(":");
    if (partes.length !== 3) return "";
    const [ivB64, tagB64, cifradoB64] = partes;
    const decipher = createDecipheriv(ALGORITMO_CIFRA, chaveMestra, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(cifradoB64, "base64")), decipher.final()]).toString("utf-8");
  } catch {
    return "";
  }
}

function mascararSegredo(valor: string | undefined | null): string {
  const bruto = String(valor || "");
  if (!bruto) return "";
  if (bruto.length <= 4) return "••••";
  return `${"•".repeat(Math.min(12, bruto.length - 4))}${bruto.slice(-4)}`;
}

function criptografarConfiguracao<T extends Record<string, any>>(config: T, chaveMestra: Buffer | null): T {
  if (!chaveMestra) return config;
  const saida: Record<string, any> = { ...config };
  for (const campo of CAMPOS_SECRETOS) {
    if (typeof saida[campo] === "string" && saida[campo]) {
      saida[campo] = criptografarSegredo(saida[campo], chaveMestra);
    }
  }
  return saida as T;
}

function descriptografarConfiguracao<T extends Record<string, any>>(config: T, chaveMestra: Buffer | null): T {
  const saida: Record<string, any> = { ...config };
  for (const campo of CAMPOS_SECRETOS) {
    if (typeof saida[campo] === "string" && saida[campo]) {
      saida[campo] = descriptografarSegredo(saida[campo], chaveMestra);
    }
  }
  return saida as T;
}

// ═══════════════════════════════════════════════════════════════════════
// SERVER AI ROUTER & MULTI-ACCOUNT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════

export interface ServerAiConfig {
  provider: string;
  apiKey: string;
  candidateKeys?: string[];
  model: string;
}

interface CachedModels {
  models: string[];
  timestamp: number;
}

const modelDiscoveryCache = new Map<string, CachedModels>();
const MODEL_CACHE_TTL_MS = 10 * 60_000;

const userConfigCache = new Map<string, Record<string, string>>();
const lastVerifiedProviderKey = new Map<string, string>();

interface UploadSession {
  name: string;
  type: string;
  chunks: Map<number, string>;
  totalChunks: number;
  createdAt: number;
}
const chunkUploads = new Map<string, UploadSession>();
const CHUNK_UPLOAD_TTL_MS = 30 * 60_000;

function pruneExpiredChunkUploads(): void {
  const now = Date.now();
  for (const [id, session] of chunkUploads.entries()) {
    if (now - session.createdAt > CHUNK_UPLOAD_TTL_MS) {
      chunkUploads.delete(id);
    }
  }
}

export const DEFAULT_DOCUMENT_CHAR_BUDGET = Number(process.env.MAX_DOCUMENT_CHARS || 160_000);
export const PROGRESSIVE_COMPACTION_TIERS = [85_000, 45_000, 24_000] as const;
const MAX_INLINE_BINARY_BYTES = 15 * 1024 * 1024;
const FILES_API_THRESHOLD_BYTES = 4 * 1024 * 1024;

type NodePdfExtractor = (buffer: Buffer) => Promise<{ text: string; numpages: number }>;
let nodePdfExtractorPromise: Promise<NodePdfExtractor | null> | null = null;

async function loadNodePdfExtractor(): Promise<NodePdfExtractor | null> {
  if (!nodePdfExtractorPromise) {
    nodePdfExtractorPromise = import("unpdf")
      .then((mod: any) => {
        const { extractText, getDocumentProxy } = mod;
        if (typeof extractText !== "function" || typeof getDocumentProxy !== "function") {
          throw new Error("unpdf não expõe extractText/getDocumentProxy");
        }
        const extractor: NodePdfExtractor = async (buffer: Buffer) => {
          const doc = await getDocumentProxy(new Uint8Array(buffer));
          try {
            const { text, totalPages } = await extractText(doc, { mergePages: true });
            return {
              text: String(text || "").trim(),
              numpages: Number(totalPages) || 0,
            };
          } finally {
            try {
              if (typeof doc?.destroy === "function") await doc.destroy();
            } catch {
              // ignore cleanup failure
            }
          }
        };
        return extractor;
      })
      .catch((err: any) => {
        console.warn("[unpdf] Falha ao carregar extrator de PDF no servidor:", err?.message || err);
        return null;
      });
  }
  return nodePdfExtractorPromise;
}

export async function extractPdfTextFromBuffer(buffer: Buffer): Promise<{ text: string; numpages: number } | null> {
  const extractor = await loadNodePdfExtractor();
  if (!extractor) return null;
  try {
    return await extractor(buffer);
  } catch (err: any) {
    console.warn("[unpdf] Falha ao extrair texto de PDF:", err?.message || err);
    return null;
  }
}

const SINAIS_RELEVANCIA_EDITAL = [
  /\bitem\s*n?[ºo°]?\s*\d+/gi,
  /\blote\s*n?[ºo°]?\s*\d+/gi,
  /\bquantidade\b/gi,
  /\bunidade(?:\s+de\s+medida)?\b/gi,
  /\bvalor\s+(?:unit[áa]rio|total|estimado|m[áa]ximo)\b/gi,
  /\bplanilha\b/gi,
  /r\$\s*\d/gi,
  /termo\s+de\s+refer[êe]ncia/gi,
  /\banexo\s+[ivx\d]+\b/gi,
  /\bespecifica[çc][õo]es?\s+t[ée]cnicas?\b/gi,
  /\bdescri[çc][ãa]o\s+do\s+objeto\b/gi,
  /\bhabilita[çc][ãa]o\b/gi,
  /\bqualifica[çc][ãa]o\s+t[ée]cnica\b/gi,
  /\batestado\b/gi,
  /\bprazo\s+de\s+(?:entrega|execu[çc][ãa]o|pagamento)\b/gi,
  /\bamostra\b/gi,
  /\bgarantia\b/gi,
  /\bcarta\s+de\s+solidariedade\b/gi,
  /\buasg\b/gi,
];

export function cleanExtractedDocumentText(rawText: string): string {
  const normalized = String(rawText || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\f/g, "\n");

  const rawLines = normalized.split("\n").map((line) =>
    line
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\.{5,}/g, " ... ")
      .replace(/_{6,}/g, " ___ ")
      .replace(/-{8,}/g, " --- ")
      .trim()
  );

  // Count repeated short lines (typical page headers/footers repeated on every page)
  const lineFreq = new Map<string, number>();
  for (const line of rawLines) {
    if (line.length >= 10 && line.length <= 140) {
      lineFreq.set(line, (lineFreq.get(line) || 0) + 1);
    }
  }

  const seenRepeated = new Set<string>();
  const keptLines: string[] = [];

  for (const line of rawLines) {
    if (!line) {
      if (keptLines.length > 0 && keptLines[keptLines.length - 1] !== "") {
        keptLines.push("");
      }
      continue;
    }

    if (/^(?:p[áa]gina|p[áa]g\.?|fls?\.?)\s*\d+(?:\s*(?:de|\/)\s*\d+)?$/i.test(line)) {
      continue;
    }

    const freq = lineFreq.get(line) || 0;
    const looksLikeItemRow = /^(?:item|lote|\d{1,4}[\s.)\-–])/i.test(line);
    if (freq >= 5 && !looksLikeItemRow) {
      if (seenRepeated.has(line)) continue;
      seenRepeated.add(line);
    }

    keptLines.push(line);
  }

  return keptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function scoreEditalChunk(chunk: string): number {
  let score = 0;
  for (const pattern of SINAIS_RELEVANCIA_EDITAL) {
    const matches = chunk.match(pattern);
    if (matches) score += matches.length;
  }
  return score;
}

export function compactTextForTokenBudget(
  text: string,
  maxChars: number,
  label = "Documento"
): { text: string; compacted: boolean; originalChars: number; finalChars: number } {
  const originalChars = String(text || "").length;
  const cleaned = cleanExtractedDocumentText(text);
  const safeMax = Math.max(4_000, Math.floor(maxChars));

  if (cleaned.length <= safeMax) {
    return {
      text: cleaned,
      compacted: cleaned.length < originalChars,
      originalChars,
      finalChars: cleaned.length,
    };
  }

  const chunkSize = Math.min(6_000, Math.max(1_500, Math.floor(safeMax / 12)));
  const chunks: string[] = [];
  for (let i = 0; i < cleaned.length; i += chunkSize) {
    chunks.push(cleaned.slice(i, i + chunkSize));
  }

  const budgetChunks = Math.max(3, Math.floor(safeMax / chunkSize));
  const headCount = Math.min(chunks.length, Math.max(1, Math.floor(budgetChunks * 0.35)));
  const tailCount = Math.min(chunks.length - headCount, Math.max(1, Math.floor(budgetChunks * 0.15)));

  const selected = new Set<number>();
  for (let i = 0; i < headCount; i++) selected.add(i);
  for (let i = chunks.length - tailCount; i < chunks.length; i++) selected.add(i);

  const candidates = chunks
    .map((chunk, idx) => ({ idx, score: scoreEditalChunk(chunk) }))
    .filter((c) => !selected.has(c.idx))
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  for (const cand of candidates) {
    if (selected.size >= budgetChunks) break;
    if (cand.score > 0) selected.add(cand.idx);
  }

  // If budget still has room, evenly sample remaining chunks
  if (selected.size < budgetChunks) {
    const remaining = candidates.filter((c) => !selected.has(c.idx)).sort((a, b) => a.idx - b.idx);
    const needed = budgetChunks - selected.size;
    if (remaining.length > 0 && needed > 0) {
      const step = Math.max(1, Math.floor(remaining.length / needed));
      for (let i = 0; i < remaining.length && selected.size < budgetChunks; i += step) {
        selected.add(remaining[i].idx);
      }
    }
  }

  const ordered = Array.from(selected).sort((a, b) => a - b);
  let output = "";
  let prev = -1;
  for (const idx of ordered) {
    if (prev >= 0 && idx > prev + 1) {
      output += "\n\n[... trecho intermediário omitido para respeitar o limite de tokens ...]\n\n";
    }
    output += chunks[idx];
    prev = idx;
  }

  if (output.length > safeMax + 600) {
    output =
      output.slice(0, Math.floor(safeMax * 0.8)) +
      "\n\n[... conteúdo resumido para respeitar o limite de tokens ...]\n\n" +
      output.slice(-Math.floor(safeMax * 0.18));
  }

  console.log(
    `[Token Budget] ${label}: ${originalChars} -> ${output.length} chars (teto ${safeMax}, ${ordered.length}/${chunks.length} blocos).`
  );

  return {
    text: output,
    compacted: true,
    originalChars,
    finalChars: output.length,
  };
}

export function isTokenLimitError(err: any): boolean {
  const msg = String(err?.message || err || "").toLowerCase();
  if (!msg) return false;
  if (msg.includes("limit: 0") || msg.includes("limit '0'") || msg.includes('limit: "0"')) {
    return false;
  }
  return (
    msg.includes("input token") ||
    msg.includes("token count") ||
    msg.includes("tokens per minute") ||
    msg.includes("inputtokenspermodelperminute") ||
    msg.includes("inputtokensperminute") ||
    msg.includes("tokensperminute") ||
    msg.includes("generatecontentinputtokens") ||
    msg.includes("exceeds the maximum number of tokens") ||
    msg.includes("maximum context length") ||
    msg.includes("context_length_exceeded") ||
    msg.includes("request payload size exceeds") ||
    msg.includes("payload size exceeds") ||
    msg.includes("prompt is too long") ||
    msg.includes("too many tokens") ||
    msg.includes("token limit") ||
    msg.includes("max_tokens")
  );
}

export function compactGeminiContentsForBudget(
  formattedContents: Array<{ role: string; parts: any[] }>,
  targetTotalChars: number
): { contents: Array<{ role: string; parts: any[] }>; didCompact: boolean; totalCharsAfter: number } {
  const textEntries: Array<{ msgIdx: number; partIdx: number; len: number; isPromptTail: boolean }> = [];
  let totalChars = 0;

  formattedContents.forEach((msg, msgIdx) => {
    const parts = Array.isArray(msg.parts) ? msg.parts : [];
    parts.forEach((p, partIdx) => {
      if (typeof p?.text === "string" && p.text.length > 0) {
        totalChars += p.text.length;
        const isLastShortPrompt =
          msgIdx === formattedContents.length - 1 && partIdx === parts.length - 1 && p.text.length < 12_000;
        textEntries.push({ msgIdx, partIdx, len: p.text.length, isPromptTail: isLastShortPrompt });
      }
    });
  });

  if (totalChars <= targetTotalChars) {
    return { contents: formattedContents, didCompact: false, totalCharsAfter: totalChars };
  }

  const fixedChars = textEntries.filter((e) => e.isPromptTail).reduce((acc, e) => acc + e.len, 0);
  const compactable = textEntries.filter((e) => !e.isPromptTail);
  const compactableTotal = compactable.reduce((acc, e) => acc + e.len, 0);

  if (compactable.length === 0 || compactableTotal <= 6_000) {
    // Fallback: compact every long text part if no separate attachment parts exist
    const fallbackBudget = Math.max(8_000, Math.floor(targetTotalChars / Math.max(1, textEntries.length)));
    let didCompact = false;
    let totalAfter = 0;
    const cloned = formattedContents.map((msg) => ({
      ...msg,
      parts: (msg.parts || []).map((p) => {
        if (typeof p?.text === "string" && p.text.length > fallbackBudget) {
          const res = compactTextForTokenBudget(p.text, fallbackBudget, "Prompt/Conteúdo");
          didCompact = didCompact || res.finalChars < p.text.length;
          totalAfter += res.text.length;
          return { ...p, text: res.text };
        }
        if (typeof p?.text === "string") totalAfter += p.text.length;
        return p;
      }),
    }));
    return { contents: cloned, didCompact, totalCharsAfter: totalAfter };
  }

  const availableForCompactable = Math.max(8_000, targetTotalChars - fixedChars);
  let didCompact = false;
  let totalAfter = 0;

  const cloned = formattedContents.map((msg, msgIdx) => ({
    ...msg,
    parts: (msg.parts || []).map((p, partIdx) => {
      if (typeof p?.text !== "string") return p;
      const entry = textEntries.find((e) => e.msgIdx === msgIdx && e.partIdx === partIdx);
      if (!entry || entry.isPromptTail) {
        totalAfter += p.text.length;
        return p;
      }
      const share = Math.max(
        4_000,
        Math.floor((entry.len / Math.max(1, compactableTotal)) * availableForCompactable)
      );
      if (p.text.length <= share) {
        totalAfter += p.text.length;
        return p;
      }
      const res = compactTextForTokenBudget(p.text, share, `Parte ${partIdx + 1}`);
      if (res.text.length < p.text.length) didCompact = true;
      totalAfter += res.text.length;
      return { ...p, text: res.text };
    }),
  }));

  return { contents: cloned, didCompact, totalCharsAfter: totalAfter };
}

function getUserIdFromJwt(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    const sub = JSON.parse(json)?.sub;
    return typeof sub === "string" && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}

export function normalizeServerGeminiModel(model?: string | null): string {
  const clean = (model || "").trim().toLowerCase();
  if (
    !clean ||
    clean.startsWith("gemini-1.") ||
    clean.startsWith("gemini-2.0") ||
    clean.startsWith("gemini-2.5") ||
    clean === "gemini-flash-latest" ||
    clean === "gemini-flash-lite-latest" ||
    clean === "gemini-pro" ||
    clean === "gemini-pro-latest"
  ) {
    return "gemini-3.5-flash-lite";
  }
  return clean;
}

export function normalizeModelForRemoteEdge(provider: string, model?: string | null): string {
  if (provider !== "gemini") return model || "";
  const clean = (model || "").trim().toLowerCase();
  if (clean.includes("pro")) return "gemini-3.1-pro-preview";
  return "gemini-3.1-flash-lite";
}

function scoreGeminiModel(name: string): number {
  const n = name.toLowerCase();
  if (
    n.includes("embedding") ||
    n.includes("aqa") ||
    n.includes("imagen") ||
    n.includes("veo") ||
    n.includes("tts") ||
    n.includes("image") ||
    n.includes("audio") ||
    n.includes("robotics") ||
    n.includes("computer-use") ||
    n.includes("gemma") ||
    n.startsWith("gemini-1.") ||
    n === "gemini-2.5-flash-lite" ||
    n.startsWith("gemini-2.5-flash-lite-") ||
    n === "gemini-flash-latest" ||
    n === "gemini-flash-lite-latest" ||
    n === "gemini-pro-latest" ||
    n.includes("-001") ||
    n.includes("exp") ||
    n.includes("thinking")
  ) {
    return -1;
  }
  if (n === "gemini-3.5-flash-lite") return 200;
  if (n === "gemini-3.5-flash") return 195;
  if (n === "gemini-3.1-flash-lite") return 192;
  if (n === "gemini-3.1-flash-lite-preview") return 190;
  if (n === "gemini-3-flash-preview" || n === "gemini-3-flash") return 188;
  if (n === "gemini-3.8-flash-lite") return 186;
  if (n === "gemini-3.8-flash") return 185;
  if (n === "gemini-4-hydrogen") return 182;
  if (n.startsWith("gemini-3") && n.includes("flash-lite")) return 178;
  if (n.startsWith("gemini-3") && n.includes("flash")) return 175;
  if (n === "gemini-2.5-flash") return 140;
  if (n === "gemini-2.0-flash") return 130;
  if (n === "gemini-2.0-flash-lite") return 125;
  if (n.includes("flash-lite")) return 120;
  if (n.includes("flash")) return 115;
  if (n === "gemini-3.5-pro" || n === "gemini-3.1-pro-preview" || n === "gemini-4-neon") return 105;
  if (n.includes("pro")) return 95;
  return 10;
}

async function discoverServerGeminiModels(apiKey: string): Promise<string[] | null> {
  const cleanKey = (apiKey || "").trim();
  if (!cleanKey || estaCriptografado(cleanKey)) return null;

  const cached = modelDiscoveryCache.get(cleanKey);
  if (cached && Date.now() - cached.timestamp < MODEL_CACHE_TTL_MS) {
    return cached.models;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7_000);
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}&pageSize=200`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!resp.ok) return null;

    const data = await resp.json();
    const rawModels: string[] = (data?.models || [])
      .filter(
        (m: any) =>
          Array.isArray(m?.supportedGenerationMethods) &&
          m.supportedGenerationMethods.includes("generateContent")
      )
      .map((m: any) => String(m?.name || "").replace(/^models\//, ""))
      .filter((m: string) => Boolean(m) && scoreGeminiModel(m) > 0)
      .sort((a: string, b: string) => scoreGeminiModel(b) - scoreGeminiModel(a) || b.localeCompare(a));

    if (rawModels.length === 0) return null;
    modelDiscoveryCache.set(cleanKey, { models: rawModels, timestamp: Date.now() });
    return rawModels;
  } catch {
    return null;
  }
}

function chooseServerGeminiChain(preferredModel: string, discovered: string[] | null): string[] {
  const normPreferred = normalizeServerGeminiModel(preferredModel);
  const defaults = [
    normPreferred,
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite-preview",
    "gemini-3-flash-preview",
    "gemini-3.8-flash",
    "gemini-4-hydrogen",
  ];

  if (!discovered || discovered.length === 0) {
    return Array.from(new Set(defaults)).slice(0, 8);
  }

  const chain: string[] = [];
  if (normPreferred && discovered.includes(normPreferred)) {
    chain.push(normPreferred);
  }
  for (const m of discovered) {
    if (chain.length >= 8) break;
    if (!chain.includes(m)) chain.push(m);
  }
  if (!chain.includes("gemini-3.5-flash-lite")) {
    chain.unshift("gemini-3.5-flash-lite");
  }
  for (const d of defaults) {
    if (chain.length >= 8) break;
    if (!chain.includes(d)) chain.push(d);
  }
  return chain.slice(0, 8);
}

export function cleanAndParseJsonServer(text: string): any {
  if (!text) return {};
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();

  const firstBrace = cleaned.search(/[\{\[]/);
  const lastBrace = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      const fixedJson = cleaned
        .replace(/,\s*([\}\]])/g, "$1")
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, (match) => {
          if (match === "\n") return "\\n";
          if (match === "\r") return "\\r";
          if (match === "\t") return "\\t";
          return "";
        });
      return JSON.parse(fixedJson);
    } catch {
      return {};
    }
  }
}

function sanitizeServerAiText(text: string): string {
  if (!text) return "";
  return text
    .replace(/\$\$(.*?)\$\$/gs, (_, f) => f)
    .replace(/\$(.*?)\$/g, (_, f) => f)
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\\times/g, "x")
    .replace(/\\cdot/g, "x")
    .replace(/\\rightarrow/g, "→")
    .replace(/\\leftarrow/g, "←")
    .replace(/\\Rightarrow/g, "=>")
    .replace(/\\approx/g, "≈")
    .replace(/\\le/g, "≤")
    .replace(/\\ge/g, "≥")
    .replace(/\\neq/g, "≠");
}

function resolveUploadAttachment(file: any): any {
  pruneExpiredChunkUploads();
  if (!file || typeof file !== "object") return file;
  if (file.uploadId && chunkUploads.has(file.uploadId)) {
    const session = chunkUploads.get(file.uploadId)!;
    const ordered: string[] = [];
    for (let i = 0; i < session.totalChunks; i++) {
      ordered.push(session.chunks.get(i) || "");
    }
    return {
      ...file,
      name: file.name || session.name,
      type: file.type || session.type,
      base64: ordered.join(""),
    };
  }
  return file;
}

interface PreparedAttachmentPart {
  part: any;
  binaryBuffer?: Buffer;
  mimeType?: string;
  fileName?: string;
  isScannedBinary?: boolean;
}

const UNSUPPORTED_BINARY_EXTS = [
  ".zip", ".rar", ".7z", ".tar", ".gz", ".dwg", ".dxf", ".exe", ".bin",
  ".xls", ".xlsx", ".xlsm", ".ods", ".doc", ".docx", ".odt", ".ppt", ".pptx", ".p7s",
];

function detectarFormatoBinarioBuffer(
  buffer: Buffer
): "pdf" | "zip_office" | "rar" | "7z" | "ole_office" | "html" | "image_png" | "image_jpeg" | "image_webp" | "unknown" {
  if (!buffer || buffer.length < 4) return "unknown";
  const head = buffer.subarray(0, Math.min(buffer.length, 512));
  const ascii = head.toString("latin1");
  const trimmedLower = ascii.trimStart().toLowerCase();

  if (ascii.includes("%PDF-")) return "pdf";
  if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)) {
    return "zip_office";
  }
  if (head[0] === 0x52 && head[1] === 0x61 && head[2] === 0x72 && head[3] === 0x21) return "rar";
  if (head[0] === 0x37 && head[1] === 0x7a && head[2] === 0xbc && head[3] === 0xaf) return "7z";
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return "ole_office";
  if (trimmedLower.startsWith("<!doctype html") || trimmedLower.startsWith("<html")) return "html";
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image_png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image_jpeg";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image_webp";
  return "unknown";
}

function parseNumeroControlePncpServer(
  numeroOuUrl: string
): { cnpj: string; ano: string; sequencial: string } | null {
  const bruto = String(numeroOuUrl || "").trim();
  if (!bruto) return null;
  let texto = bruto;
  try {
    texto = decodeURIComponent(texto);
  } catch {
    // mantém original
  }
  texto = texto.replace(/(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})-(\d{2})/g, "$1$2$3$4$5");
  const mControle = texto.match(/(\d{14})-\d+-(\d+)[/-](\d{4})/);
  if (mControle) {
    return { cnpj: mControle[1], sequencial: String(parseInt(mControle[2], 10)), ano: mControle[3] };
  }
  const mUrl =
    texto.match(/pncp\.gov\.br\/(?:app\/)?(?:editais|compras)\/(\d{14})\/(\d{4})\/(\d{1,8})/i) ||
    texto.match(/orgaos\/(\d{14})\/compras\/(\d{4})\/(\d{1,8})/i);
  if (mUrl) {
    return { cnpj: mUrl[1], ano: mUrl[2], sequencial: String(parseInt(mUrl[3], 10)) };
  }
  const mBarra = texto.match(/\b(\d{14})\/(\d{4})\/(\d{1,8})\b/);
  if (mBarra) {
    return { cnpj: mBarra[1], ano: mBarra[2], sequencial: String(parseInt(mBarra[3], 10)) };
  }
  return null;
}

async function fetchPncpJsonServer(url: string, timeoutMs = 12_000): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Horasis-PNCP-Server/1.0" },
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    return await resp.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function buscarPacotePncpNoServidor(
  alvo: { cnpj: string; ano: string; sequencial: string },
  options: { baixarArquivos: boolean }
): Promise<{
  numeroControle: string;
  linkPNCP: string;
  detalhe: any | null;
  itens: any[];
  textoOficial: string;
  arquivosBaixados: Array<{ name: string; type: string; base64: string }>;
}> {
  const seqNum = Number(alvo.sequencial);
  const seqPadded = String(seqNum).padStart(6, "0");
  const numeroControle = `${alvo.cnpj}-1-${seqPadded}/${alvo.ano}`;
  const linkPNCP = `https://pncp.gov.br/app/editais/${alvo.cnpj}/${alvo.ano}/${seqPadded}`;
  const baseUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${alvo.cnpj}/compras/${alvo.ano}/${seqNum}`;

  const [detalhe, itensRaw, arquivosRaw] = await Promise.all([
    fetchPncpJsonServer(baseUrl, 12_000),
    fetchPncpJsonServer(`${baseUrl}/itens?pagina=1&tamanhoPagina=500`, 14_000),
    options.baixarArquivos ? fetchPncpJsonServer(`${baseUrl}/arquivos`, 12_000) : Promise.resolve(null),
  ]);

  const itens = Array.isArray(itensRaw) ? itensRaw : Array.isArray(itensRaw?.data) ? itensRaw.data : [];
  const linhas: string[] = [
    `DADOS OFICIAIS DA CONTRATAÇÃO NO PNCP (${numeroControle}):`,
    `Link Oficial PNCP: ${linkPNCP}`,
  ];

  if (detalhe) {
    const orgao = detalhe.orgaoEntidade?.razaoSocial || detalhe.orgaoEntidade?.nomeRazaoSocial;
    if (orgao) linhas.push(`Órgão Comprador: ${orgao} (CNPJ: ${alvo.cnpj})`);
    if (detalhe.unidadeOrgao?.codigoUnidade) {
      linhas.push(`Unidade Compradora / UASG: ${detalhe.unidadeOrgao.codigoUnidade} - ${detalhe.unidadeOrgao.nomeUnidade || ""}`);
    }
    if (detalhe.modalidadeNome) linhas.push(`Modalidade: ${detalhe.modalidadeNome}`);
    if (detalhe.numeroCompra || detalhe.processo) {
      linhas.push(`Número / Processo: ${detalhe.numeroCompra || detalhe.processo}/${detalhe.anoCompra || alvo.ano}`);
    }
    if (detalhe.objetoCompra) linhas.push(`Objeto Oficial: ${detalhe.objetoCompra}`);
    if (typeof detalhe.valorTotalEstimado === "number" && detalhe.valorTotalEstimado > 0) {
      linhas.push(
        `Valor Total Estimado Oficial: R$ ${detalhe.valorTotalEstimado.toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      );
    }
    if (detalhe.dataEncerramentoProposta) {
      linhas.push(
        `Data de Encerramento das Propostas / Início da Disputa (PNCP): ${new Date(detalhe.dataEncerramentoProposta).toLocaleString("pt-BR")}`
      );
    }
    if (detalhe.dataAberturaProposta) {
      linhas.push(
        `Data de Abertura do Recebimento de Propostas (PNCP): ${new Date(detalhe.dataAberturaProposta).toLocaleString("pt-BR")}`
      );
    }
  }

  if (itens.length > 0) {
    linhas.push("");
    linhas.push(`RELAÇÃO OFICIAL DE ITENS PUBLICADOS NO PNCP (${itens.length} itens):`);
    for (let i = 0; i < Math.min(itens.length, 250); i++) {
      const it = itens[i];
      const num = it.numeroItem ?? i + 1;
      const desc = it.descricao || it.materialOuServicoNome || "Item da contratação";
      const qtd = it.quantidade ?? 1;
      const und = it.unidadeMedida || "Unidade";
      const vUnit =
        typeof it.valorUnitarioEstimado === "number"
          ? `R$ ${it.valorUnitarioEstimado.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : "Não informado no PNCP";
      linhas.push(`- Item ${num}: ${desc} | Quantidade: ${qtd} ${und} | Valor Unitário Estimado: ${vUnit}`);
    }
  }

  const arquivosBaixados: Array<{ name: string; type: string; base64: string }> = [];
  if (options.baixarArquivos) {
    const lista = Array.isArray(arquivosRaw) ? arquivosRaw : Array.isArray(arquivosRaw?.data) ? arquivosRaw.data : [];
    const candidatos = lista
      .map((doc: any, idx: number) => {
        const seqDoc = Number(doc?.sequencialDocumento) || idx + 1;
        const titulo = String(doc?.titulo || doc?.nomeArquivo || `Documento_${seqDoc}`).trim();
        const tipo = String(doc?.tipoDocumentoNome || doc?.tipoDocumentoDescricao || "").trim();
        const uri = doc?.uri || doc?.url || `${baseUrl}/arquivos/${seqDoc}`;
        const lower = `${titulo} ${tipo}`.toLowerCase();
        let score = 0;
        if (/\bedital\b|aviso de (?:contrata|dispensa|licita)/.test(lower)) score += 100;
        else if (/termo de refer[eê]n|\btr\b|projeto b[aá]sico|estudo t[eé]cnico/.test(lower)) score += 70;
        else if (/anexo/.test(lower)) score += 20;
        if (/\.pdf\b/.test(lower)) score += 10;
        if (/\.(zip|rar|7z|xls|xlsx|doc|docx|odt|ods|png|jpg|jpeg)\b/.test(lower)) score -= 200;
        if (/ata\b|resultado|homologa|adjudica/.test(lower)) score -= 100;
        return { titulo, uri, score };
      })
      .filter((c: any) => c.score > 0 && /^https:\/\/pncp\.gov\.br\//.test(c.uri))
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 2);

    await Promise.all(
      candidatos.map(async (arq: any) => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 20_000);
          const upstream = await fetch(arq.uri, {
            headers: { "User-Agent": "Horasis-PNCP-Server/1.0" },
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!upstream.ok) return;
          const buf = Buffer.from(await upstream.arrayBuffer());
          if (buf.length === 0 || buf.length > 25 * 1024 * 1024) return;
          const formato = detectarFormatoBinarioBuffer(buf);
          if (formato === "zip_office" || formato === "rar" || formato === "7z" || formato === "ole_office" || formato === "html") {
            console.warn(`[PNCP Server] Ignorando anexo não-PDF (${formato}): ${arq.titulo}`);
            return;
          }
          const ct = (upstream.headers.get("content-type") || "").toLowerCase();
          const nome = /\.\w{2,5}$/.test(arq.titulo) ? arq.titulo : `${arq.titulo}.pdf`;
          arquivosBaixados.push({
            name: nome,
            type: formato === "pdf" ? "application/pdf" : ct.includes("text") ? "text/plain" : "application/pdf",
            base64: buf.toString("base64"),
          });
        } catch {
          // ignora falha individual de download
        }
      })
    );
  }

  return {
    numeroControle,
    linkPNCP,
    detalhe,
    itens,
    textoOficial: detalhe || itens.length > 0 ? linhas.join("\n") : "",
    arquivosBaixados,
  };
}

async function fileAttachmentToPartAsync(
  rawFile: any,
  maxCharsPerDoc = DEFAULT_DOCUMENT_CHAR_BUDGET
): Promise<PreparedAttachmentPart | null> {
  const file = resolveUploadAttachment(rawFile);
  if (!file) return null;
  const rawB64 = file.base64 || file.fileBase64 || file.data || "";
  if (!rawB64 || typeof rawB64 !== "string") return null;

  const cleanB64 = rawB64.replace(/^data:[^;]+;base64,/, "").trim();
  if (!cleanB64) return null;

  const originalName = String(file.name || file.fileName || "Documento");
  const fname = originalName.toLowerCase();

  if (UNSUPPORTED_BINARY_EXTS.some((ext) => fname.endsWith(ext))) {
    return {
      part: {
        text: `\n[Anexo "${originalName}" ignorado automaticamente por ser arquivo compactado/binário não legível diretamente.]\n`,
      },
      fileName: originalName,
    };
  }

  let mtype = String(file.type || file.fileType || file.mimeType || "").trim();
  if (!mtype || mtype === "application/octet-stream" || mtype === "binary/octet-stream") {
    if (fname.endsWith(".pdf")) mtype = "application/pdf";
    else if (fname.endsWith(".txt") || fname.endsWith(".md") || fname.endsWith(".csv")) mtype = "text/plain";
    else if (fname.endsWith(".json")) mtype = "application/json";
    else if (fname.endsWith(".xml")) mtype = "application/xml";
    else if (fname.endsWith(".png")) mtype = "image/png";
    else if (fname.endsWith(".jpg") || fname.endsWith(".jpeg")) mtype = "image/jpeg";
    else if (fname.endsWith(".webp")) mtype = "image/webp";
    else mtype = "application/pdf";
  }

  if (
    mtype.startsWith("text/") ||
    mtype === "application/json" ||
    mtype === "application/xml" ||
    fname.endsWith(".txt") ||
    fname.endsWith(".md") ||
    fname.endsWith(".csv")
  ) {
    try {
      const decoded = Buffer.from(cleanB64, "base64").toString("utf-8");
      if (decoded.trim()) {
        const compacted = compactTextForTokenBudget(decoded, maxCharsPerDoc, originalName);
        return {
          part: {
            text: `\n\n--- INÍCIO DO ANEXO (${originalName}) ---\n${compacted.text}\n--- FIM DO ANEXO (${originalName}) ---\n\n`,
          },
          fileName: originalName,
        };
      }
    } catch {
      // fall through to inlineData
    }
  }

  // PDF files: extract textual content first so large PDFs stay well inside Gemini's TPM / token budget
  if (mtype === "application/pdf" || fname.endsWith(".pdf")) {
    try {
      const buffer = Buffer.from(cleanB64, "base64");
      const formatoBinario = detectarFormatoBinarioBuffer(buffer);
      if (
        formatoBinario === "zip_office" ||
        formatoBinario === "rar" ||
        formatoBinario === "7z" ||
        formatoBinario === "ole_office" ||
        formatoBinario === "html"
      ) {
        console.warn(
          `[Attachment Guard] Ignorando "${originalName}" pois o conteúdo real é "${formatoBinario}" (não é um PDF válido).`
        );
        return null;
      }
      if (formatoBinario === "image_png" || formatoBinario === "image_jpeg" || formatoBinario === "image_webp") {
        const realMime =
          formatoBinario === "image_png"
            ? "image/png"
            : formatoBinario === "image_jpeg"
              ? "image/jpeg"
              : "image/webp";
        return {
          part: {
            inlineData: {
              mimeType: realMime,
              data: cleanB64,
            },
          },
          binaryBuffer: buffer,
          mimeType: realMime,
          fileName: originalName,
          isScannedBinary: true,
        };
      }

      const extracted = await extractPdfTextFromBuffer(buffer);
      const cleanedText = extracted ? cleanExtractedDocumentText(extracted.text) : "";
      const minReadableChars = extracted && extracted.numpages <= 1 ? 25 : 80;

      if (extracted && cleanedText.length >= minReadableChars) {
        const compacted = compactTextForTokenBudget(cleanedText, maxCharsPerDoc, originalName);
        console.log(
          `[PDF Extractor] ${originalName} (${extracted.numpages || "?"} págs): extraídos ${extracted.text.length} chars -> enviados ${compacted.finalChars} chars como texto.`
        );
        return {
          part: {
            text: `\n\n--- INÍCIO DO DOCUMENTO: ${originalName} (${extracted.numpages || "?"} páginas) ---\n${compacted.text}\n--- FIM DO DOCUMENTO: ${originalName} ---\n\n`,
          },
          fileName: originalName,
        };
      }

      // Só envia como PDF visual se o buffer realmente começar com assinatura %PDF-
      if (formatoBinario !== "pdf") {
        console.warn(
          `[Attachment Guard] "${originalName}" não possui assinatura %PDF- nem texto legível; ignorando para evitar falha na IA.`
        );
        return null;
      }

      // Scanned / image-only PDF fallback (no selectable text layer)
      console.log(
        `[PDF Extractor] ${originalName} sem camada de texto legível (${cleanedText.length} chars); enviando como PDF visual (${(buffer.length / (1024 * 1024)).toFixed(1)} MB).`
      );
      return {
        part: {
          inlineData: {
            mimeType: "application/pdf",
            data: cleanB64,
          },
        },
        binaryBuffer: buffer,
        mimeType: "application/pdf",
        fileName: originalName,
        isScannedBinary: true,
      };
    } catch (pdfErr: any) {
      console.warn(`[PDF Extractor] Falha ao processar ${originalName}, usando fallback visual:`, pdfErr?.message || pdfErr);
    }
  }

  return {
    part: {
      inlineData: {
        mimeType: mtype,
        data: cleanB64,
      },
    },
    mimeType: mtype,
    fileName: originalName,
    isScannedBinary: mtype === "application/pdf" || mtype.startsWith("image/"),
  };
}

async function prepareAttachmentParts(
  rawFiles: any[],
  totalBudgetChars = DEFAULT_DOCUMENT_CHAR_BUDGET
): Promise<PreparedAttachmentPart[]> {
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) return [];
  const validFiles = rawFiles.filter(Boolean);
  const perDocBudget = Math.max(
    6_000,
    Math.floor(totalBudgetChars / Math.max(1, validFiles.length))
  );

  const prepared: PreparedAttachmentPart[] = [];
  for (const f of validFiles) {
    const item = await fileAttachmentToPartAsync(f, perDocBudget);
    if (item) prepared.push(item);
  }
  return prepared;
}

function createServerGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

async function resolveServerAiConfig(rawAiConfig?: any, authHeader?: string): Promise<ServerAiConfig | null> {
  const provider = rawAiConfig?.provider || "gemini";
  let rawKey = String(rawAiConfig?.apiKey || "").trim();
  const masterSecret = derivarChaveMestra(process.env.AI_KEYS_ENCRYPTION_KEY || "");

  if (estaCriptografado(rawKey)) {
    rawKey = masterSecret ? descriptografarSegredo(rawKey, masterSecret).trim() : "";
  }

  const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const userId = token ? getUserIdFromJwt(token) : null;

  const candidateKeys: string[] = [];
  const addCandidateKey = (k?: string | null) => {
    const clean = String(k || "").trim();
    if (clean && clean.length > 10 && !estaCriptografado(clean) && !candidateKeys.includes(clean)) {
      candidateKeys.push(clean);
    }
  };

  // 1. Client plaintext key
  if (rawKey && rawKey.length > 10 && !estaCriptografado(rawKey)) {
    addCandidateKey(rawKey);
    if (userId) {
      const existing = userConfigCache.get(userId) || {};
      existing[provider] = rawKey;
      userConfigCache.set(userId, existing);
    }
  }

  // 2. Server in-memory cache for this authenticated user
  if (userId && userConfigCache.has(userId)) {
    const cachedUserKeys = userConfigCache.get(userId)!;
    addCandidateKey(cachedUserKeys[provider]);
  }

  // 3. Query Supabase configuracoes_usuario for this authenticated user
  let dbModel = "";
  if (token && userId) {
    try {
      const resp = await fetch(
        `${SUPABASE_URL_DEFAULT.replace(/\/+$/, "")}/rest/v1/configuracoes_usuario?select=*&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY_DEFAULT,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      if (resp.ok) {
        const rows: any[] = await resp.json();
        if (rows && rows.length > 0) {
          const row = descriptografarConfiguracao(rows[0], masterSecret);
          const keyMap: Record<string, string> = {
            gemini: String(row.gemini_key || "").trim(),
            openai: String(row.openai_key || "").trim(),
            anthropic: String(row.anthropic_key || "").trim(),
            deepseek: String(row.deepseek_key || "").trim(),
          };
          addCandidateKey(keyMap[provider]);
          dbModel = String(row[`${provider}_model`] || "");
        }
      }
    } catch {
      // ignore DB lookup failure
    }
  }

  // 4. Environment variables on the server
  if (provider === "gemini") {
    addCandidateKey(process.env.GEMINI_API_KEY);
    addCandidateKey(process.env.VITE_GEMINI_API_KEY);
  } else if (provider === "openai") {
    addCandidateKey(process.env.OPENAI_API_KEY);
  } else if (provider === "deepseek") {
    addCandidateKey(process.env.DEEPSEEK_API_KEY);
  }

  // 5. Last verified working key for this provider on this server instance
  addCandidateKey(lastVerifiedProviderKey.get(provider));

  if (candidateKeys.length === 0) {
    return null;
  }

  const chosenModel =
    provider === "gemini"
      ? normalizeServerGeminiModel(rawAiConfig?.model || dbModel)
      : String(rawAiConfig?.model || dbModel || "");

  return {
    provider,
    apiKey: candidateKeys[0],
    candidateKeys,
    model: chosenModel,
  };
}

async function runServerLLMCall(params: {
  aiConfig: ServerAiConfig;
  contents: any[];
  systemInstruction?: string;
  jsonMode?: boolean;
  responseSchema?: any;
  preparedAttachments?: PreparedAttachmentPart[];
}): Promise<string> {
  const { aiConfig, contents, systemInstruction, jsonMode, responseSchema, preparedAttachments } = params;
  const provider = aiConfig.provider || "gemini";
  const keysToTry =
    Array.isArray(aiConfig.candidateKeys) && aiConfig.candidateKeys.length > 0
      ? aiConfig.candidateKeys
      : [aiConfig.apiKey].filter(Boolean);

  if (provider === "openai" || provider === "deepseek") {
    const apiKey = (keysToTry[0] || "").trim();
    const endpoint =
      provider === "openai"
        ? "https://api.openai.com/v1/chat/completions"
        : "https://api.deepseek.com/v1/chat/completions";
    const defaultModel = provider === "openai" ? "gpt-4o" : "deepseek-chat";

    const rawTextPrompt = contents
      .map((c: any) => {
        if (typeof c === "string") return c;
        if (c?.text) return c.text;
        if (Array.isArray(c?.parts)) {
          return c.parts.map((p: any) => p?.text || "").filter(Boolean).join("\n");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n");

    let currentTextPrompt = rawTextPrompt;
    const budgets = [null, ...PROGRESSIVE_COMPACTION_TIERS];

    for (const budget of budgets) {
      if (budget !== null) {
        const compacted = compactTextForTokenBudget(currentTextPrompt, budget, "Prompt");
        if (compacted.finalChars >= currentTextPrompt.length) break;
        currentTextPrompt = compacted.text;
      }

      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: aiConfig.model || defaultModel,
          messages: [
            ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
            { role: "user", content: currentTextPrompt },
          ],
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        lastVerifiedProviderKey.set(provider, apiKey);
        return sanitizeServerAiText(data?.choices?.[0]?.message?.content || "");
      }

      const errText = await resp.text();
      const errObj = new Error(`${provider.toUpperCase()} API Error (${resp.status}): ${errText.slice(0, 260)}`);
      if (!isTokenLimitError(errObj)) {
        throw errObj;
      }
      console.warn(`[${provider.toUpperCase()}] Limite de tokens detectado; compactando automaticamente...`);
    }

    throw new Error(
      `⚠️ O conteúdo do documento excedeu o limite de tokens do modelo ${provider.toUpperCase()} mesmo após compactação automática.`
    );
  }

  const isRoleBased = contents.every((c) => c && typeof c === "object" && Array.isArray(c.parts));
  const baseFormattedContents = isRoleBased
    ? contents.map((c) => ({
        role: c.role === "assistant" || c.role === "model" ? "model" : "user",
        parts: [...c.parts],
      }))
    : [
        {
          role: "user",
          parts: contents.map((c) => (typeof c === "string" ? { text: c } : c)),
        },
      ];

  const hasScannedBinary =
    Boolean(preparedAttachments?.some((a) => a.isScannedBinary)) ||
    baseFormattedContents.some((m) =>
      (m.parts || []).some((p: any) => Boolean(p?.inlineData?.data) || Boolean(p?.fileData?.fileUri))
    );

  let lastError: any = null;
  let tokenLimitExhausted = false;

  for (const keyToUse of keysToTry) {
    const cleanKey = (keyToUse || "").trim();
    if (!cleanKey || cleanKey.length < 10) continue;

    const ai = createServerGeminiClient(cleanKey);
    const uploadedGeminiFiles: string[] = [];

    // Prepare contents for this API key (using Gemini Files API for large scanned/binary PDFs > 4MB)
    let activeContents = baseFormattedContents.map((m) => ({
      ...m,
      parts: [...m.parts],
    }));

    try {
      if (preparedAttachments && preparedAttachments.length > 0 && typeof ai.files?.upload === "function") {
        for (const att of preparedAttachments) {
          if (att.isScannedBinary && att.binaryBuffer && att.binaryBuffer.length > FILES_API_THRESHOLD_BYTES) {
            try {
              const mime = att.mimeType || "application/pdf";
              const blob = new Blob([new Uint8Array(att.binaryBuffer)], { type: mime });
              const uploaded: any = await ai.files.upload({
                file: blob,
                config: { mimeType: mime, displayName: att.fileName || "edital.pdf" },
              });
              if (uploaded?.uri) {
                if (uploaded.name) uploadedGeminiFiles.push(uploaded.name);
                const replacementPart = {
                  fileData: {
                    fileUri: uploaded.uri,
                    mimeType: uploaded.mimeType || mime,
                  },
                };
                activeContents = activeContents.map((m) => ({
                  ...m,
                  parts: m.parts.map((p: any) => (p === att.part ? replacementPart : p)),
                }));
                console.log(`[Gemini Files API] PDF escaneado "${att.fileName}" enviado via Files API (${uploaded.name}).`);
              }
            } catch (uploadErr: any) {
              console.warn("[Gemini Files API] Falha no upload, seguindo com inlineData:", uploadErr?.message || uploadErr);
              if (att.binaryBuffer.length > MAX_INLINE_BINARY_BYTES) {
                throw new Error(
                  `⚠️ O PDF escaneado "${att.fileName || "documento"}" (${(att.binaryBuffer.length / (1024 * 1024)).toFixed(1)} MB) não possui texto selecionável e excede o limite de envio direto. Comprima o PDF ou envie as páginas principais.`
                );
              }
            }
          }
        }
      }

      const discovered = await discoverServerGeminiModels(cleanKey);
      const modelsToTry = chooseServerGeminiChain(aiConfig.model, discovered);

      const tried = new Set<string>();
      const queue = [...modelsToTry];
      let compactionTierIndex = 0;
      let nonTokenQuotaFailures = 0;
      const MAX_QUOTA_ROTATIONS = 3;

      while (queue.length > 0) {
        const modelName = queue.shift()!;
        if (!modelName || tried.has(modelName)) continue;
        tried.add(modelName);

        try {
          const config: any = {};
          if (systemInstruction) config.systemInstruction = systemInstruction;
          if (jsonMode) config.responseMimeType = "application/json";
          if (responseSchema) config.responseSchema = responseSchema;

          const response = await ai.models.generateContent({
            model: modelName,
            contents: activeContents,
            ...(Object.keys(config).length > 0 ? { config } : {}),
          });

          if (response?.text) {
            lastVerifiedProviderKey.set("gemini", cleanKey);
            return sanitizeServerAiText(response.text);
          }
        } catch (err: any) {
          lastError = err;
          const errMsg = String(err?.message || "");
          const errLower = errMsg.toLowerCase();

          // If the API key itself is invalid (401/403 API_KEY_INVALID), move immediately to the next candidate key
          if (
            err?.status === 401 ||
            err?.status === 403 ||
            errMsg.includes("API_KEY_INVALID") ||
            errMsg.includes("API key not valid")
          ) {
            break;
          }

          // Token / TPM / Payload size overflow: automatically compact text and retry the SAME model & key
          if (isTokenLimitError(err)) {
            let compactedAndQueued = false;
            while (compactionTierIndex < PROGRESSIVE_COMPACTION_TIERS.length) {
              const nextBudget = PROGRESSIVE_COMPACTION_TIERS[compactionTierIndex++];
              const res = compactGeminiContentsForBudget(activeContents, nextBudget);
              if (res.didCompact) {
                console.warn(
                  `[Gemini Token Guard] Modelo ${modelName} atingiu limite de tokens; compactando automaticamente para ~${res.totalCharsAfter} chars (teto ${nextBudget}) e reenviando...`
                );
                activeContents = res.contents;
                tried.delete(modelName);
                queue.unshift(modelName);
                compactedAndQueued = true;
                break;
              }
            }
            if (compactedAndQueued) {
              continue;
            }
            // No more text left to compact — stop immediately instead of rotating models/keys with the same oversized payload
            tokenLimitExhausted = true;
            break;
          }

          // Zero-quota project key (limit: 0) — move to next candidate key if any
          if (errLower.includes("limit: 0") || errLower.includes("limit '0'") || errLower.includes('limit: "0"')) {
            break;
          }

          // General rate-limit / RPM 429: rotate up to 3 distinct models, never spam all 8
          if (
            err?.status === 429 ||
            errMsg.includes("429") ||
            errLower.includes("resource_exhausted") ||
            errLower.includes("quota")
          ) {
            nonTokenQuotaFailures++;
            if (nonTokenQuotaFailures >= MAX_QUOTA_ROTATIONS) {
              break;
            }
            continue;
          }

          // Self-heal if Google's 404 error recommends a replacement model ("Please update your code to use models/<name>")
          const suggestedMatch = errMsg.match(/use\s+models\/([a-zA-Z0-9._-]+)/i);
          if (suggestedMatch && suggestedMatch[1]) {
            const suggestedModel = suggestedMatch[1].trim();
            if (!tried.has(suggestedModel)) {
              queue.unshift(suggestedModel);
            }
          }

          if (responseSchema && (err?.status === 400 || errMsg.includes("400"))) {
            try {
              const fallbackConfig: any = {};
              if (systemInstruction) fallbackConfig.systemInstruction = systemInstruction;
              if (jsonMode) fallbackConfig.responseMimeType = "application/json";
              const responseNoSchema = await ai.models.generateContent({
                model: modelName,
                contents: activeContents,
                config: fallbackConfig,
              });
              if (responseNoSchema?.text) {
                lastVerifiedProviderKey.set("gemini", cleanKey);
                return sanitizeServerAiText(responseNoSchema.text);
              }
            } catch (retryErr: any) {
              lastError = retryErr;
            }
          }
        }
      }
    } finally {
      if (uploadedGeminiFiles.length > 0 && typeof ai.files?.delete === "function") {
        for (const fileName of uploadedGeminiFiles) {
          ai.files.delete({ name: fileName }).catch(() => {});
        }
      }
    }

    // Do NOT jump to stale fallback keys when the user's own key is valid and hit a token limit
    if (tokenLimitExhausted) {
      break;
    }
  }

  if (tokenLimitExhausted) {
    if (hasScannedBinary) {
      throw new Error(
        "⚠️ Este PDF parece ser escaneado (imagem sem texto selecionável) e ultrapassou o limite de tokens por requisição da sua conta Gemini. Comprima o arquivo, reduza a resolução ou envie apenas as páginas principais (Edital e Termo de Referência)."
      );
    }
    throw new Error(
      "⚠️ O conteúdo do edital excedeu o limite de tokens por minuto/requisição do modelo Gemini mesmo após compactação automática. Aguarde ~1 minuto e tente novamente, ou selecione outro modelo em 'IA & Modelos'."
    );
  }

  const finalMsg = String(lastError?.message || "");
  if (finalMsg.includes("limit: 0") || finalMsg.includes("limit '0'") || finalMsg.includes('limit: "0"')) {
    throw new Error(
      "O projeto do Google AI Studio onde esta chave foi criada está com cota gratuita zero (limit: 0). Use a mesma chave de API que funcionou na sua conta principal ou crie a chave em um projeto com nível gratuito/faturamento ativo no Google AI Studio."
    );
  }

  throw lastError || new Error("Falha ao comunicar com a API do Gemini no servidor.");
}

export function normalizeEditalAnalysisObject(parsedData: any, rawTextInput = ""): any {
  const NAO_IDENTIFICADO = "Não identificado no edital";
  const textoOuNulo = (valor: any): string => {
    const t = String(valor ?? "").trim();
    if (!t) return "";
    const baixo = t.toLowerCase();
    if (baixo === "null" || baixo === "undefined" || baixo === "n/a" || baixo === "na") return "";
    return t;
  };
  const ehPlaceholder = (valor: string): boolean =>
    /^n[ãa]o\s+(especificad|identificad|informad|localizad|consta|h[áa]\b)/i.test(valor.trim());
  const listaDeTextos = (valor: any): string[] =>
    Array.isArray(valor) ? valor.map(textoOuNulo).filter((t) => Boolean(t) && !ehPlaceholder(t)) : [];

  const result: any = { ...(parsedData || {}) };
  result.pontosPositivos = listaDeTextos(result.pontosPositivos);
  result.pontosAlerta = listaDeTextos(result.pontosAlerta);
  result.documentosExigidos = listaDeTextos(result.documentosExigidos);

  if (!Array.isArray(result.itensEdital)) {
    result.itensEdital = [];
  } else {
    const vistos = new Set<string>();
    result.itensEdital = result.itensEdital
      .filter((it: any) => it && typeof it === "object")
      .map((it: any, idx: number) => {
        const descricao = textoOuNulo(it.descricao ?? it.descrição) || NAO_IDENTIFICADO;
        const quantidadeBruta = Number(it.quantidade);
        return {
          numero: Number.isFinite(Number(it.numero)) ? Number(it.numero) : idx + 1,
          descricao,
          quantidade: Number.isFinite(quantidadeBruta) && quantidadeBruta >= 0 ? quantidadeBruta : 0,
          unidade: textoOuNulo(it.unidade) || "Unidade",
          valorEstimado: textoOuNulo(it.valorEstimado) || "Não especificado no edital",
        };
      })
      .filter((it: any) => {
        const chave = `${it.numero}|${it.descricao}|${it.quantidade}|${it.unidade}`;
        if (vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
      });
  }

  const objetoOuNulo = (valor: any) => (valor && typeof valor === "object" ? valor : {});
  const ic = objetoOuNulo(result.identificacaoCertame);
  result.identificacaoCertame = {
    ...ic,
    orgaoComprador: textoOuNulo(ic.orgaoComprador) || NAO_IDENTIFICADO,
    modalidade: textoOuNulo(ic.modalidade) || NAO_IDENTIFICADO,
    identificacaoNumerica: textoOuNulo(ic.identificacaoNumerica) || NAO_IDENTIFICADO,
    codigoUASG: normalizarCodigoUasg(textoOuNulo(ic.codigoUASG)),
    numeroEdital: textoOuNulo(ic.numeroEdital) || "",
    dataHoraSessao: textoOuNulo(ic.dataHoraSessao) || NAO_IDENTIFICADO,
  };

  if (!result.identificacaoCertame.codigoUASG) {
    result.identificacaoCertame.codigoUASG = extrairCodigoUasg(
      [result.identificacaoCertame.orgaoComprador, rawTextInput, result.reportMarkdown].filter(Boolean).join(" ")
    );
  }

  const et = objetoOuNulo(result.especificacoesTecnicas);
  result.especificacoesTecnicas = {
    exigenciasFisicas: listaDeTextos(et.exigenciasFisicas),
    pegadinhasOcultas: listaDeTextos(et.pegadinhasOcultas),
  };

  const bb = objetoOuNulo(result.burocraciaBarreiras);
  result.burocraciaBarreiras = {
    exigeAmostra: textoOuNulo(bb.exigeAmostra) || NAO_IDENTIFICADO,
    exigeCartaSolidariedade: textoOuNulo(bb.exigeCartaSolidariedade) || NAO_IDENTIFICADO,
    exigenciaGarantia: textoOuNulo(bb.exigenciaGarantia) || NAO_IDENTIFICADO,
    consorcioSubcontratacao: textoOuNulo(bb.consorcioSubcontratacao) || NAO_IDENTIFICADO,
  };

  const lc = objetoOuNulo(result.logisticaCronograma);
  result.logisticaCronograma = {
    prazoEntregaReal: textoOuNulo(lc.prazoEntregaReal) || textoOuNulo(result.prazoEntrega) || NAO_IDENTIFICADO,
    classificacaoPrazo: textoOuNulo(lc.classificacaoPrazo) || NAO_IDENTIFICADO,
    enderecoEntrega: textoOuNulo(lc.enderecoEntrega) || NAO_IDENTIFICADO,
    prazoGarantia: textoOuNulo(lc.prazoGarantia) || NAO_IDENTIFICADO,
  };

  const vf = objetoOuNulo(result.viabilidadeFinanceira);
  result.viabilidadeFinanceira = {
    valorEstimado: textoOuNulo(vf.valorEstimado) || NAO_IDENTIFICADO,
    distorcoesPreco: textoOuNulo(vf.distorcoesPreco) || NAO_IDENTIFICADO,
    prazoPagamento: textoOuNulo(vf.prazoPagamento) || textoOuNulo(result.prazoPagamento) || NAO_IDENTIFICADO,
  };

  const pf = objetoOuNulo(result.parecerFinal);
  result.parecerFinal = {
    veredito: textoOuNulo(pf.veredito) || "Analisar viabilidade técnica e comercial",
    grauRisco: textoOuNulo(pf.grauRisco) || "Médio",
    estrategiaLances: textoOuNulo(pf.estrategiaLances) || NAO_IDENTIFICADO,
  };

  result.prazoEntrega = textoOuNulo(result.prazoEntrega) || result.logisticaCronograma.prazoEntregaReal;
  result.prazoPagamento = textoOuNulo(result.prazoPagamento) || result.viabilidadeFinanceira.prazoPagamento;
  result.descricaoProduto = textoOuNulo(result.descricaoProduto) || NAO_IDENTIFICADO;

  const naoLocalizado = (valor: string) => !valor || valor === NAO_IDENTIFICADO || ehPlaceholder(valor);
  result.camposNaoIdentificados = [
    ...(result.itensEdital.length === 0 ? ["itens do edital"] : []),
    ...(result.documentosExigidos.length === 0 ? ["documentos exigidos"] : []),
    ...(naoLocalizado(result.viabilidadeFinanceira.valorEstimado) ? ["valor estimado"] : []),
    ...(naoLocalizado(result.identificacaoCertame.orgaoComprador) ? ["órgão comprador"] : []),
    ...(naoLocalizado(result.identificacaoCertame.modalidade) ? ["modalidade"] : []),
    ...(naoLocalizado(result.identificacaoCertame.dataHoraSessao) ? ["data da sessão"] : []),
  ];

  return result;
}

export function buildEditalAnalysisPrompt(textInput: string, selectedItems?: any[]): string {
  const focusStr =
    Array.isArray(selectedItems) && selectedItems.length > 0
      ? `\nFOCO NOS ITENS SELECIONADOS:\n${selectedItems
          .map((it) => `- Item ${it.numero}: ${it.descricao} (Qtd: ${it.quantidade} ${it.unidade || ""})`)
          .join("\n")}\n`
      : "";

  return `Você é um Analista Sênior de Licitações Públicas (Lei Federal nº 14.133/2021).
Analise o Edital / Termo de Referência anexado e retorne EXCLUSIVAMENTE um objeto JSON válido com a estrutura completa abaixo (sem markdown \`\`\` fora do JSON).

REGRAS CRÍTICAS:
1. FIDELIDADE ABSOLUTA AO EDITAL: Extraia apenas fatos reais do documento. Onde uma informação não constar no edital, escreva "Não especificado no edital".
2. ITENS E LOTES ("itensEdital"): Liste TODOS os itens/lotes do edital com numero, descricao, quantidade (número), unidade e valorEstimado (valor unitário).
3. VALORES: Em "viabilidadeFinanceira.valorEstimado", informe o valor global total estimado da licitação.
4. DOCUMENTOS EXIGIDOS ("documentosExigidos"): Liste apenas os documentos e certidões exigidos para habilitação no edital.
${focusStr}
ESTRUTURA JSON OBRIGATÓRIA:
{
  "pontosPositivos": ["..."],
  "pontosAlerta": ["..."],
  "prazoEntrega": "...",
  "prazoPagamento": "...",
  "descricaoProduto": "...",
  "documentosExigidos": ["..."],
  "itensEdital": [
    { "numero": 1, "descricao": "...", "quantidade": 1, "unidade": "Unid", "valorEstimado": "R$ 0,00" }
  ],
  "identificacaoCertame": {
    "orgaoComprador": "...",
    "modalidade": "...",
    "identificacaoNumerica": "...",
    "codigoUASG": "",
    "numeroEdital": "",
    "dataHoraSessao": "...",
    "idContratacaoPNCP": "",
    "linkPNCP": ""
  },
  "especificacoesTecnicas": {
    "exigenciasFisicas": ["..."],
    "pegadinhasOcultas": ["..."]
  },
  "burocraciaBarreiras": {
    "exigeAmostra": "...",
    "exigeCartaSolidariedade": "...",
    "exigenciaGarantia": "...",
    "consorcioSubcontratacao": "..."
  },
  "logisticaCronograma": {
    "prazoEntregaReal": "...",
    "classificacaoPrazo": "Confortável | Aceitável | Crítico",
    "enderecoEntrega": "...",
    "prazoGarantia": "..."
  },
  "viabilidadeFinanceira": {
    "valorEstimado": "...",
    "distorcoesPreco": "...",
    "prazoPagamento": "..."
  },
  "parecerFinal": {
    "veredito": "...",
    "grauRisco": "Baixo | Médio | Alto",
    "estrategiaLances": "..."
  },
  "dossieExecutivo": {
    "kicker": "INTELIGÊNCIA LICITATÓRIA • LEI Nº 14.133/2021",
    "titulo": "Dossiê Executivo: ...",
    "subtituloOrgao": "Órgão: ... • Processo: ... • Objeto: ...",
    "sinteseTitulo": "SÍNTESE ESTRATÉGICA DA OPORTUNIDADE",
    "sinteseTexto": "...",
    "secao1Titulo": "1. Dados Oficiais, Valores, Prazo e Local de Entrega",
    "colunaRegraTitulo": "Regra Oficial do Edital e Termo de Referência",
    "dadosOficiais": [
      { "parametro": "Órgão e Plataforma", "regra": "..." },
      { "parametro": "Sessão e Disputa", "regra": "..." },
      { "parametro": "Valor Global Estimado", "regra": "..." },
      { "parametro": "Prazo e Local de Entrega", "regra": "..." },
      { "parametro": "Condições de Pagamento", "regra": "..." }
    ],
    "secao2Titulo": "2. Planilha de Itens, Quantitativos e Valores Máximos",
    "especificacaoComum": "...",
    "secao3Titulo": "3. Pontos de Atenção e Riscos Críticos do Edital",
    "pontosAtencao": [
      { "prefixo": "PONTO DE ATENÇÃO 1", "titulo": "...", "descricao": "..." }
    ],
    "secao4Titulo": "4. Checklist Rápido de Habilitação e Proposta",
    "checklistCategorizado": [
      { "categoria": "Proposta Comercial", "descricao": "..." },
      { "categoria": "Habilitação Jurídica, Fiscal e Trabalhista", "descricao": "..." },
      { "categoria": "Qualificação Econômico-Financeira e Técnica", "descricao": "..." }
    ],
    "rodapeTexto": "Dossiê Executivo • Análise Oficial"
  },
  "reportMarkdown": "### 🎯 Veredito da Análise\\n..."
}
${textInput ? `\nCONTEÚDO / TEXTO DO EDITAL:\n${textInput}` : ""}`;
}

async function forwardToSupabaseEdge(req: express.Request, res: express.Response) {
  try {
    const targetUrl = `${SUPABASE_URL_DEFAULT.replace(/\/+$/, "")}/functions/v1${req.originalUrl}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: req.headers["apikey"] ? String(req.headers["apikey"]) : SUPABASE_ANON_KEY_DEFAULT,
    };
    if (req.headers.authorization) {
      headers["Authorization"] = String(req.headers.authorization);
    }

    const bodyObj = req.body && typeof req.body === "object" ? { ...req.body } : {};
    if (bodyObj.aiConfig) {
      bodyObj.aiConfig = {
        ...bodyObj.aiConfig,
        model: normalizeModelForRemoteEdge(bodyObj.aiConfig.provider || "gemini", bodyObj.aiConfig.model),
      };
    }

    const fetchOpts: RequestInit = {
      method: req.method,
      headers,
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      fetchOpts.body = JSON.stringify(bodyObj);
    }

    const edgeResp = await fetch(targetUrl, fetchOpts);
    const contentType = edgeResp.headers.get("content-type") || "application/json";
    res.status(edgeResp.status).setHeader("Content-Type", contentType);
    const buffer = Buffer.from(await edgeResp.arrayBuffer());
    return res.send(buffer);
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || "Erro ao encaminhar requisição para a Edge Function." });
  }
}

export const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// 0. Health & Chunked Upload endpoints
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    runtime: process.env.VERCEL ? "vercel-serverless-node" : "node-express",
    chavesIaCriptografadas: Boolean(process.env.AI_KEYS_ENCRYPTION_KEY),
  });
});

// 0b. /api/user-config — Saves user AI configuration and caches plaintext keys in server memory
app.post("/api/user-config", async (req, res) => {
  try {
    const authHeader = String(req.headers.authorization || "");
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Faça login para salvar suas configurações de IA." });
    }

    const token = authHeader.slice(7);
    const userId = getUserIdFromJwt(token);
    if (!userId) {
      return res.status(401).json({ error: "Sessão inválida. Entre novamente." });
    }

    const corpo = req.body || {};
    const permitidos = [
      "active_provider",
      "gemini_key",
      "gemini_model",
      "openai_key",
      "openai_model",
      "anthropic_key",
      "anthropic_model",
      "deepseek_key",
      "deepseek_model",
    ];

    const linha: Record<string, any> = { user_id: userId, updated_at: new Date().toISOString() };
    for (const campo of permitidos) {
      if (corpo[campo] !== undefined) linha[campo] = corpo[campo];
    }

    const userCached = userConfigCache.get(userId) || {};
    const providerKeyMap: Array<[string, string]> = [
      ["gemini", String(linha.gemini_key || "").trim()],
      ["openai", String(linha.openai_key || "").trim()],
      ["anthropic", String(linha.anthropic_key || "").trim()],
      ["deepseek", String(linha.deepseek_key || "").trim()],
    ];
    for (const [prov, k] of providerKeyMap) {
      if (k && k.length > 10 && !estaCriptografado(k)) {
        userCached[prov] = k;
        lastVerifiedProviderKey.set(prov, k);
      }
    }
    userConfigCache.set(userId, userCached);

    const chaveMestra = derivarChaveMestra(process.env.AI_KEYS_ENCRYPTION_KEY || "");
    const cifrada = criptografarConfiguracao(linha, chaveMestra);

    const resp = await fetch(`${SUPABASE_URL_DEFAULT.replace(/\/+$/, "")}/rest/v1/configuracoes_usuario`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY_DEFAULT,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(cifrada),
    });

    if (!resp.ok) {
      const detalhe = await resp.text().catch(() => "");
      console.error("[server/user-config] Supabase recusou a gravação:", resp.status, detalhe.slice(0, 300));
      return res.status(502).json({ error: `Não foi possível salvar no banco (HTTP ${resp.status}).` });
    }

    const mascaradas: Record<string, string> = {};
    for (const campo of CAMPOS_SECRETOS) {
      if (typeof linha[campo] === "string") mascaradas[campo] = mascararSegredo(linha[campo]);
    }

    return res.json({ success: true, criptografado: Boolean(chaveMestra), chaves: mascaradas });
  } catch (error: any) {
    return res.status(500).json({ error: `Erro ao salvar configuração: ${error?.message || "desconhecido"}` });
  }
});

app.post("/api/upload-chunk/init", (req, res) => {
  pruneExpiredChunkUploads();
  const uploadId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  chunkUploads.set(uploadId, {
    name: String(req.body?.name || "arquivo.pdf"),
    type: String(req.body?.type || "application/pdf"),
    chunks: new Map(),
    totalChunks: 0,
    createdAt: Date.now(),
  });
  res.json({ uploadId });
});

app.post("/api/upload-chunk", (req, res) => {
  const { uploadId, chunkIndex, totalChunks, chunkBase64 } = req.body || {};
  const session = chunkUploads.get(String(uploadId || ""));
  if (!session) {
    return res.status(404).json({ error: "Sessão de upload não encontrada." });
  }
  session.chunks.set(Number(chunkIndex), String(chunkBase64 || ""));
  session.totalChunks = Math.max(session.totalChunks, Number(totalChunks) || 0);
  return res.json({ received: true, chunkIndex });
});

// 1. /api/ai-status
const handleAiStatus = async (req: express.Request, res: express.Response) => {
  const serverAi = await resolveServerAiConfig(req.body?.aiConfig, req.headers.authorization);
  if (!serverAi) {
    return res.json({
      configured: false,
      message: "Nenhuma chave de API configurada. Acesse 'IA & Modelos' e salve sua chave.",
    });
  }

  if (serverAi.provider === "gemini") {
    const disponiveis = await discoverServerGeminiModels(serverAi.apiKey);
    const normModel = normalizeServerGeminiModel(serverAi.model);
    const cadeia = chooseServerGeminiChain(normModel, disponiveis);
    const servido = disponiveis ? disponiveis.includes(normModel) : null;
    return res.json({
      configured: true,
      provider: "gemini",
      model: normModel,
      modeloServidoPelaChave: servido,
      modelosDisponiveis: disponiveis,
      cadeiaQueSeraUsada: cadeia,
    });
  }

  return res.json({
    configured: true,
    provider: serverAi.provider,
    model: serverAi.model,
    modeloServidoPelaChave: true,
    modelosDisponiveis: [serverAi.model],
    cadeiaQueSeraUsada: [serverAi.model],
  });
};
app.get("/api/ai-status", handleAiStatus);
app.post("/api/ai-status", handleAiStatus);

// 2. /api/chat/title
app.post("/api/chat/title", (req, res) => {
  const msg = String(req.body?.message || "").trim();
  const clean = msg.replace(/\s+/g, " ").slice(0, 38);
  res.json({ title: clean || "Nova Conversa" });
});

// 3. /api/chat
app.post("/api/chat", async (req, res) => {
  const serverAi = await resolveServerAiConfig(req.body?.aiConfig, req.headers.authorization);
  if (!serverAi) {
    return res.status(400).json({
      error: "Chave de API não configurada. Insira sua chave em 'IA & Modelos' e clique em 'Salvar Configurações'.",
    });
  }

  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const companyData = req.body?.companyData;
    const activeEdital = req.body?.activeEditalAnalysis;

    const preparedChatAttachments: PreparedAttachmentPart[] = [];
    const formattedHistory = [];
    for (const m of messages) {
      const parts: any[] = [];
      if (m.attachment && (m.attachment.data || m.attachment.uploadId)) {
        const prepared = await fileAttachmentToPartAsync(
          {
            name: m.attachment.name,
            type: m.attachment.type,
            base64: m.attachment.data,
            uploadId: m.attachment.uploadId,
          },
          100_000
        );
        if (prepared) {
          preparedChatAttachments.push(prepared);
          parts.push(prepared.part);
        }
      }
      parts.push({ text: m.content || "Analise o documento anexado." });
      formattedHistory.push({
        role: m.role === "assistant" ? "model" : "user",
        parts,
      });
    }

    const editalCompacto = activeEdital
      ? (() => {
          const { rawText, ...resto } = activeEdital;
          return resto;
        })()
      : null;

    const systemInstruction = `Você é a HORASIS AI, Assessora e Consultora Inteligente de Licitações e Pregões Eletrônicos (Lei Federal nº 14.133/2021).
Responda de forma clara, direta, prática e bem estruturada em português do Brasil. Não use fórmulas em LaTeX ($$ ou \\text).
${
  companyData
    ? `\nDados da Empresa do Usuário:\n- Razão Social: ${companyData.razonSocial || ""}\n- CNPJ: ${companyData.cnpj || ""}\n- Representante: ${companyData.representativeName || ""}`
    : ""
}
${editalCompacto ? `\nEdital Selecionado nesta Conversa:\n${JSON.stringify(editalCompacto, null, 2)}` : ""}`;

    const reply = await runServerLLMCall({
      aiConfig: serverAi,
      contents: formattedHistory,
      systemInstruction,
      preparedAttachments: preparedChatAttachments,
    });

    return res.json({ reply });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao processar o chat na IA." });
  }
});

// 4. /api/analyze-cert
app.post("/api/analyze-cert", async (req, res) => {
  const serverAi = await resolveServerAiConfig(req.body?.aiConfig, req.headers.authorization);
  if (!serverAi) {
    return res.status(400).json({
      error: "Chave de API não configurada. Insira sua chave em 'IA & Modelos' e clique em 'Salvar Configurações'.",
    });
  }

  try {
    const bodyObj = req.body || {};
    const fileBase64 = bodyObj.fileBase64 || bodyObj.base64 || bodyObj.data;
    const fileName = bodyObj.fileName || bodyObj.name || "documento.pdf";
    const fileType = bodyObj.fileType || bodyObj.type || "application/pdf";
    const docName = bodyObj.docName || bodyObj.name || fileName;

    const parts: any[] = [];
    const preparedFile = await fileAttachmentToPartAsync(
      {
        base64: fileBase64,
        name: fileName,
        type: fileType,
        uploadId: bodyObj.uploadId,
      },
      80_000
    );
    if (preparedFile) parts.push(preparedFile.part);

    parts.push({
      text: `Analise esta certidão/documento empresarial ("${docName}", arquivo "${fileName}") e retorne EXCLUSIVAMENTE um JSON válido com os campos:
{
  "documentName": "Nome oficial padronizado da certidão/documento identificado no conteúdo",
  "emissionDate": "YYYY-MM-DD ou vazio se não constar",
  "expirationDate": "YYYY-MM-DD (se constar prazo como 'válida por 90 dias' ou '180 dias', some os dias à data de emissão e retorne YYYY-MM-DD; se for permanente como CNPJ ou Contrato Social, retorne \"\")",
  "suggestedNotes": "Resumo curto de 1 a 2 frases do que comprova em licitações",
  "documentMatchesRow": true,
  "validationFeedback": "Frase confirmando a validade e compatibilidade do documento",
  "extractedCompanyData": {
    "razonSocial": "",
    "cnpj": "",
    "address": "",
    "phone": "",
    "email": "",
    "representativeName": "",
    "representativeCpf": ""
  }
}`,
    });

    const rawText = await runServerLLMCall({
      aiConfig: serverAi,
      contents: parts,
      jsonMode: true,
      preparedAttachments: preparedFile ? [preparedFile] : [],
    });

    const parsed = cleanAndParseJsonServer(rawText);
    return res.json({ result: parsed });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao analisar certidão na IA." });
  }
});

// 5. /api/generate-cert-description
app.post("/api/generate-cert-description", async (req, res) => {
  const serverAi = await resolveServerAiConfig(req.body?.aiConfig, req.headers.authorization);
  if (!serverAi) {
    return res.status(400).json({
      error: "Chave de API não configurada. Insira sua chave em 'IA & Modelos' e clique em 'Salvar Configurações'.",
    });
  }

  try {
    const name = String(req.body?.name || "Certidão").trim();
    const reply = await runServerLLMCall({
      aiConfig: serverAi,
      contents: [
        {
          text: `Explique em 1 frase curta (máximo 140 caracteres), direta e técnica para que serve o documento/certidão "${name}" em licitações públicas no Brasil.`,
        },
      ],
    });
    return res.json({ description: reply.trim() });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao gerar descrição da certidão." });
  }
});

// 6. /api/generate-document
app.post("/api/generate-document", async (req, res) => {
  const serverAi = await resolveServerAiConfig(req.body?.aiConfig, req.headers.authorization);
  if (!serverAi) {
    return res.status(400).json({
      error: "Chave de API não configurada. Insira sua chave em 'IA & Modelos' e clique em 'Salvar Configurações'.",
    });
  }

  try {
    const { docType, analysisData, companyData, extraInstructions, uploadedTemplateText, proposalDetails } =
      req.body || {};
    let prompt = "";
    if (docType === "proposal") {
      const details = proposalDetails || {};
      const items = details.proposalItems || [];
      const itemsListText = items
        .map(
          (it: any, idx: number) =>
            `| ${idx + 1} | ${it.description} | ${it.quantity} | ${it.brandModel} | R$ ${it.unitValue} | R$ ${it.totalValue} |`
        )
        .join("\n");
      prompt = `Gere uma PROPOSTA COMERCIAL formal para licitação pública em Markdown profissional, cabendo em 1 folha A4:
- Empresa: ${companyData?.razonSocial || "[RAZÃO SOCIAL DA EMPRESA]"} | CNPJ: ${companyData?.cnpj || "[CNPJ DA EMPRESA]"}
- Endereço: ${companyData?.address || "[ENDEREÇO]"} | Tel: ${companyData?.phone || "[TELEFONE]"} | E-mail: ${companyData?.email || "[E-MAIL]"}
- Representante Legal: ${companyData?.representativeName || "[REPRESENTANTE LEGAL]"} | CPF: ${companyData?.representativeCpf || "[CPF]"}
- Dados Bancários: ${companyData?.bankDetails || "[DADOS BANCÁRIOS]"}
- Certame: ${details.proposalDispensa || ""} | Processo: ${details.proposalProcesso || ""} | Órgão: ${details.proposalOrgao || ""}
- Objeto: ${details.proposalObject || analysisData?.descricaoProduto || ""}
- Itens:\n${itemsListText}
- Valor Total Global: R$ ${details.totalValueGlobal || "0,00"} (${details.totalValueExtenso || ""})
- Validade: ${details.valPrazo || "60 dias"} | Pagamento: ${details.valPgto || "30 dias"} | Entrega: ${details.valEntrega || "Conforme edital"} | Local: ${details.valLocal || "Conforme edital"}
- Instruções adicionais: ${extraInstructions || "Nenhuma"}
Finalize com o bloco de assinatura centralizado de 3 linhas (Linha, Nome em negrito, Representante Legal / Titular, CPF | CNPJ). Retorne apenas o Markdown do documento.`;
    } else {
      prompt = `Redija o documento licitatório "${
        docType === "joint_declaration"
          ? "DECLARAÇÃO CONJUNTA DE HABILITAÇÃO (LEI 14.133/2021)"
          : uploadedTemplateText || "DECLARAÇÃO DE REGULARIDADE"
      }" em Markdown formal para 1 página A4.
Empresa: ${companyData?.razonSocial || "[RAZÃO SOCIAL DA EMPRESA]"}, CNPJ ${companyData?.cnpj || "[CNPJ DA EMPRESA]"}, Representante ${companyData?.representativeName || "[REPRESENTANTE LEGAL]"}, CPF ${companyData?.representativeCpf || "[CPF]"}.
Instruções extras: ${extraInstructions || "Nenhuma"}.
Finalize com assinatura formal de 3 linhas. Retorne apenas o documento em Markdown.`;
    }

    const markdown = await runServerLLMCall({
      aiConfig: serverAi,
      contents: [{ text: prompt }],
    });

    return res.json({
      markdown: markdown.replace(/^```markdown\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim(),
      title: docType === "proposal" ? proposalDetails?.proposalFileTitle || "Proposta Comercial.md" : undefined,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao gerar documento na IA." });
  }
});

// 7. /api/compare-products
app.post("/api/compare-products", async (req, res) => {
  const serverAi = await resolveServerAiConfig(req.body?.aiConfig, req.headers.authorization);
  if (!serverAi) {
    return res.status(400).json({
      error: "Chave de API não configurada. Insira sua chave em 'IA & Modelos' e clique em 'Salvar Configurações'.",
    });
  }

  try {
    const { requiredSpecs, candidateProducts } = req.body || {};
    const list = Array.isArray(candidateProducts) ? candidateProducts : [];
    const results = await Promise.all(
      list.map(async (productModel: string) => {
        const prompt = `Compare rigorosamente o produto candidato "${productModel}" com as especificações exigidas no edital:
"${requiredSpecs}"
Retorne EXCLUSIVAMENTE um JSON válido no formato:
{
  "productName": "${productModel}",
  "matchStatus": "ATENDE" | "ATENDE_PARCIALMENTE" | "NAO_ATENDE",
  "suitabilityScore": 85,
  "specsAnalysis": [
    { "requirement": "...", "foundSpecText": "...", "status": "ATENDE" | "DIVERGENTE" | "NAO_ENCONTRADO", "comment": "..." }
  ],
  "pros": ["..."],
  "cons": ["..."],
  "conclusion": "..."
}`;
        const raw = await runServerLLMCall({
          aiConfig: serverAi,
          contents: [{ text: prompt }],
          jsonMode: true,
        });
        return {
          originalName: productModel,
          success: true,
          data: cleanAndParseJsonServer(raw),
          sources: [],
        };
      })
    );
    return res.json({ results });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao comparar produtos na IA." });
  }
});

// 8. /api/analyze-competitor
app.post("/api/analyze-competitor", async (req, res) => {
  const serverAi = await resolveServerAiConfig(req.body?.aiConfig, req.headers.authorization);
  if (!serverAi) {
    return res.status(400).json({
      error: "Chave de API não configurada. Insira sua chave em 'IA & Modelos' e clique em 'Salvar Configurações'.",
    });
  }

  try {
    const { competitorName, competitorDocumentText, fileBase64, fileType, files, editalText, focusItems } =
      req.body || {};
    const rawFiles = [
      ...(Array.isArray(files) ? files : []),
      ...(fileBase64 ? [{ base64: fileBase64, type: fileType }] : []),
    ];
    const preparedFiles = await prepareAttachmentParts(rawFiles, DEFAULT_DOCUMENT_CHAR_BUDGET);
    const parts: any[] = preparedFiles.map((p) => p.part);
    const safeCompetitorText = competitorDocumentText
      ? compactTextForTokenBudget(String(competitorDocumentText), 60_000, "Proposta do Concorrente").text
      : "";
    parts.push({
      text: `Você é um Advogado Especialista em Licitações Públicas (Lei 14.133/2021). Audite a proposta/documentação do concorrente "${competitorName || "Concorrente"}" contra o Edital (${editalText || "regras gerais da Lei 14.133/2021"}). Foco: ${focusItems || "Análise Completa"}.
${safeCompetitorText ? `\nTexto do Concorrente:\n${safeCompetitorText}` : ""}
Retorne EXCLUSIVAMENTE um JSON válido com:
{
  "competitorName": "...",
  "isCompliant": false,
  "irregularidadesEncontradas": [
    { "campoExigido": "...", "propostaConcorrente": "...", "gravidade": "ALTA | MÉDIA | BAIXA", "baseLegal": "...", "impacto": "..." }
  ],
  "pontosFortesConcorrente": ["..."],
  "modeloRecurso": "Peça completa de Recurso Administrativo em Markdown...",
  "analiseEstiloMarkdown": "Relatório completo da auditoria em Markdown..."
}`,
    });

    const raw = await runServerLLMCall({
      aiConfig: serverAi,
      contents: parts,
      jsonMode: true,
      preparedAttachments: preparedFiles,
    });
    return res.json({ analysis: cleanAndParseJsonServer(raw) });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao analisar concorrente na IA." });
  }
});

// 8b. /api/pncp/contratacao (Fallback no servidor para busca por link direto/ID do PNCP)
app.get("/api/pncp/contratacao", async (req, res) => {
  try {
    const numeroControle = String(req.query.numeroControle || "");
    const cnpj = String(req.query.cnpj || "").replace(/\D/g, "");
    const ano = String(req.query.ano || "");
    const sequencial = String(req.query.sequencial || "");
    const alvo =
      parseNumeroControlePncpServer(numeroControle) ||
      (cnpj.length === 14 && ano && sequencial ? { cnpj, ano, sequencial } : null);

    if (!alvo) {
      return res.status(400).json({ error: "Informe um link ou número de controle PNCP válido." });
    }

    const pacote = await buscarPacotePncpNoServidor(alvo, { baixarArquivos: false });
    if (!pacote.detalhe && pacote.itens.length === 0) {
      return res.status(404).json({ error: "Contratação não encontrada no PNCP." });
    }
    return res.json({ contratacao: pacote.detalhe, itens: pacote.itens, alvo });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || "Erro ao consultar contratação no PNCP." });
  }
});

// 9. /api/analyze-edital
app.post("/api/analyze-edital", async (req, res) => {
  const serverAi = await resolveServerAiConfig(req.body?.aiConfig, req.headers.authorization);
  if (!serverAi) {
    return res.status(400).json({
      error: "Chave de API não configurada. Insira sua chave em 'IA & Modelos' e clique em 'Salvar Configurações'.",
    });
  }

  try {
    const {
      textInput,
      fileBase64,
      fileName,
      fileType,
      attachments,
      attachedFiles,
      files,
      selectedItems,
      numeroControlePNCP,
      explicitSelection,
    } = req.body || {};

    const allFiles: any[] = [
      ...(Array.isArray(attachments) ? attachments : []),
      ...(Array.isArray(attachedFiles) ? attachedFiles : []),
      ...(Array.isArray(files) ? files : []),
      ...(fileBase64 ? [{ base64: fileBase64, name: fileName, type: fileType }] : []),
    ];

    let rawTextInput = String(textInput || "");
    const pncpAlvo = parseNumeroControlePncpServer(`${numeroControlePNCP || ""}\n${rawTextInput}`);
    const selecaoExplicita = Boolean(explicitSelection);

    let pacoteServidorPncp: Awaited<ReturnType<typeof buscarPacotePncpNoServidor>> | null = null;
    if (pncpAlvo) {
      const precisaBaixarArquivos = allFiles.length === 0 && !selecaoExplicita;
      const precisaDadosOficiais = !rawTextInput.includes("DADOS OFICIAIS DA CONTRATAÇÃO NO PNCP");
      if (precisaBaixarArquivos || precisaDadosOficiais) {
        const pacote = await buscarPacotePncpNoServidor(pncpAlvo, {
          baixarArquivos: precisaBaixarArquivos,
        }).catch(() => null);
        if (pacote) {
          pacoteServidorPncp = pacote;
          if (precisaBaixarArquivos && pacote.arquivosBaixados.length > 0) {
            allFiles.push(...pacote.arquivosBaixados);
          }
          if (precisaDadosOficiais && pacote.textoOficial) {
            rawTextInput = [rawTextInput.trim(), pacote.textoOficial].filter(Boolean).join("\n\n");
          }
        }
      }
    }

    const textInputBudget =
      allFiles.length > 0
        ? Math.min(40_000, Math.floor(DEFAULT_DOCUMENT_CHAR_BUDGET * 0.25))
        : DEFAULT_DOCUMENT_CHAR_BUDGET;
    const safeTextInput = rawTextInput.trim()
      ? compactTextForTokenBudget(rawTextInput, textInputBudget, "Texto do Edital").text
      : "";
    const attachmentsBudget = Math.max(40_000, DEFAULT_DOCUMENT_CHAR_BUDGET - safeTextInput.length);

    const preparedFiles = await prepareAttachmentParts(allFiles, attachmentsBudget);
    if (preparedFiles.length === 0 && !safeTextInput.trim()) {
      return res.status(400).json({
        error:
          "Nenhum documento PDF ou texto legível foi encontrado para análise. Verifique se os arquivos marcados estão em formato PDF ou TXT.",
      });
    }

    const parts: any[] = preparedFiles.map((p) => p.part);

    parts.push({
      text: buildEditalAnalysisPrompt(safeTextInput, selectedItems),
    });

    const rawJson = await runServerLLMCall({
      aiConfig: serverAi,
      contents: parts,
      jsonMode: true,
      preparedAttachments: preparedFiles,
    });

    const parsed = cleanAndParseJsonServer(rawJson);
    const normalized = normalizeEditalAnalysisObject(parsed, rawTextInput);
    if (pacoteServidorPncp?.detalhe) {
      const ident = normalized.identificacaoCertame || (normalized.identificacaoCertame = {});
      const atual = String(ident.dataHoraSessao || "");
      const temDataReconhecivel = /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/.test(atual);
      if (!temDataReconhecivel) {
        const rawPncpDate =
          pacoteServidorPncp.detalhe.dataEncerramentoProposta ||
          pacoteServidorPncp.detalhe.dataAberturaProposta;
        if (rawPncpDate) {
          const dt = new Date(rawPncpDate);
          if (!isNaN(dt.getTime())) {
            const dd = String(dt.getDate()).padStart(2, "0");
            const mo = String(dt.getMonth() + 1).padStart(2, "0");
            const yyyy = dt.getFullYear();
            const hh = String(dt.getHours()).padStart(2, "0");
            const mi = String(dt.getMinutes()).padStart(2, "0");
            ident.dataHoraSessao = `${dd}/${mo}/${yyyy} ${hh}:${mi}`;
          }
        }
      }
      if (pacoteServidorPncp.numeroControle) {
        ident.idContratacaoPNCP = ident.idContratacaoPNCP || pacoteServidorPncp.numeroControle;
        normalized.idContratacaoPNCP = normalized.idContratacaoPNCP || pacoteServidorPncp.numeroControle;
      }
      if (pacoteServidorPncp.linkPNCP) {
        ident.linkPNCP = ident.linkPNCP || pacoteServidorPncp.linkPNCP;
        normalized.linkPNCP = normalized.linkPNCP || pacoteServidorPncp.linkPNCP;
      }
    }
    return res.json({ analysis: normalized });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao analisar o edital na IA." });
  }
});

// 10. Forward any remaining /api/* routes (e.g., /api/pncp/*, /api/robos/*) to Supabase Edge Function
app.all("/api/*splat", (req, res) => {
  return forwardToSupabaseEdge(req, res);
});

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL && !process.env.VITEST) {
  startServer();
}

export default app;
