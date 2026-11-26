import type { LanguageId } from "../runners/types";

export interface StatelessSnippetPayload {
  v: 1;
  language: LanguageId;
  title: string;
  code: string;
  stdin: string;
}

export interface LocalHistoryEntry {
  id: string;
  language: LanguageId;
  title: string;
  code: string;
  stdin: string;
  slug?: string;
  savedAt: string;
}

const DRAFT_STORAGE_KEY = "shraff-drafts-v1";
const HISTORY_STORAGE_KEY = "shraff-history-v1";
const MAX_HISTORY_ENTRIES = 20;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const mod = padded.length % 4;
  const normalized = mod ? padded + "=".repeat(4 - mod) : padded;
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function readAllBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Encodes a snippet into a compact URL hash (#z=...) using native gzip CompressionStream.
 * Zero server/database calls required.
 */
export async function encodeStatelessShareHash(
  payload: Omit<StatelessSnippetPayload, "v">
): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify({ v: 1, ...payload }));
  if (typeof CompressionStream !== "undefined") {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    writer.write(raw);
    writer.close();
    const compressed = await readAllBytes(cs.readable);
    return `#z=${bytesToBase64Url(compressed)}`;
  }
  return `#j=${bytesToBase64Url(raw)}`;
}

/**
 * Decodes a stateless share URL hash (#z=... or #j=...) if present.
 */
export async function decodeStatelessShareHash(
  hash: string
): Promise<StatelessSnippetPayload | null> {
  try {
    if (hash.startsWith("#z=")) {
      if (typeof DecompressionStream === "undefined") return null;
      const bytes = base64UrlToBytes(hash.slice(3));
      const ds = new DecompressionStream("gzip");
      const writer = ds.writable.getWriter();
      writer.write(bytes as unknown as BufferSource);
      writer.close();
      const plain = await readAllBytes(ds.readable);
      const parsed = JSON.parse(new TextDecoder().decode(plain)) as StatelessSnippetPayload;
      return parsed?.v === 1 && typeof parsed.code === "string" ? parsed : null;
    }
    if (hash.startsWith("#j=")) {
      const bytes = base64UrlToBytes(hash.slice(3));
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as StatelessSnippetPayload;
      return parsed?.v === 1 && typeof parsed.code === "string" ? parsed : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function loadDraft(
  language: LanguageId
): { title: string; code: string; stdin: string } | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw) as Record<string, { title: string; code: string; stdin: string }>;
    const item = all[language];
    if (item && typeof item.code === "string") {
      return {
        title: typeof item.title === "string" ? item.title : "",
        code: item.code,
        stdin: typeof item.stdin === "string" ? item.stdin : "",
      };
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

export function saveDraft(
  language: LanguageId,
  draft: { title: string; code: string; stdin: string }
): void {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    all[language] = draft;
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Ignore quota / private mode errors
  }
}

export function clearDraft(language: LanguageId): void {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return;
    const all = JSON.parse(raw) as Record<string, unknown>;
    delete all[language];
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Ignore
  }
}

export function loadHistory(): LocalHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocalHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function addHistoryEntry(
  entry: Omit<LocalHistoryEntry, "id" | "savedAt">
): LocalHistoryEntry[] {
  const existing = loadHistory();
  const nextItem: LocalHistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
  };

  // Deduplicate identical consecutive snapshots or matching slugs
  const filtered = existing.filter(
    (item) =>
      !(item.slug && nextItem.slug && item.slug === nextItem.slug) &&
      !(item.language === nextItem.language && item.code === nextItem.code && item.stdin === nextItem.stdin)
  );

  const updated = [nextItem, ...filtered].slice(0, MAX_HISTORY_ENTRIES);
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore
  }
  return updated;
}

export function removeHistoryEntry(id: string): LocalHistoryEntry[] {
  const updated = loadHistory().filter((item) => item.id !== id);
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore
  }
  return updated;
}
