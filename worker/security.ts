import {
  SUPPORTED_LANGUAGES,
  type CreateSnippetPayload,
  type ShareEmailPayload,
  type SupportedLanguage,
} from "./types";

const SLUG_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SLUG_REGEX = /^[A-Za-z0-9_-]{7,12}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const MAX_CODE_CHARS = 100_000;
export const MAX_STDIN_CHARS = 32_768;
export const MAX_TITLE_CHARS = 120;
export const MAX_OUTPUT_CHARS = 8_000;

/**
 * Generates an unambiguous 7-character slug using Web Crypto with rejection sampling
 * to eliminate modulo bias.
 */
export function generateSlug(length = 7): string {
  const alphabetLen = SLUG_ALPHABET.length;
  const maxUnbiased = Math.floor(256 / alphabetLen) * alphabetLen;
  const result: string[] = [];
  const buf = new Uint8Array(16);

  while (result.length < length) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && result.length < length; i++) {
      const byte = buf[i];
      if (byte < maxUnbiased) {
        result.push(SLUG_ALPHABET[byte % alphabetLen]);
      }
    }
  }

  return result.join("");
}

export function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

export function isSupportedLanguage(lang: unknown): lang is SupportedLanguage {
  return (
    typeof lang === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(lang)
  );
}

export function normalizeTitle(rawTitle: unknown, fallback = "Untitled Snippet"): string {
  if (typeof rawTitle !== "string") return fallback;
  const cleaned = rawTitle.replace(/[\r\n\t]+/g, " ").trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, MAX_TITLE_CHARS);
}

export function validateCreateSnippetInput(
  body: unknown
): { ok: true; data: CreateSnippetPayload } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const record = body as Record<string, unknown>;
  if (!isSupportedLanguage(record.language)) {
    return { ok: false, error: "Unsupported language selected." };
  }

  if (typeof record.code !== "string" || record.code.trim().length === 0) {
    return { ok: false, error: "Code cannot be empty." };
  }
  if (record.code.length > MAX_CODE_CHARS) {
    return { ok: false, error: `Code exceeds ${MAX_CODE_CHARS.toLocaleString()} character limit.` };
  }

  const stdin = typeof record.stdin === "string" ? record.stdin : "";
  if (stdin.length > MAX_STDIN_CHARS) {
    return { ok: false, error: `Standard input exceeds ${MAX_STDIN_CHARS.toLocaleString()} character limit.` };
  }

  return {
    ok: true,
    data: {
      language: record.language,
      title: normalizeTitle(record.title),
      code: record.code,
      stdin,
    },
  };
}

export function validateShareEmailInput(
  body: unknown
): { ok: true; data: ShareEmailPayload } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const record = body as Record<string, unknown>;
  if (typeof record.email !== "string") {
    return { ok: false, error: "A valid email address is required." };
  }

  const email = record.email.trim();
  if (
    email.length > 254 ||
    /[\r\n]/.test(email) ||
    !EMAIL_REGEX.test(email)
  ) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  const baseCheck = validateCreateSnippetInput(record);
  if (!baseCheck.ok) {
    return baseCheck;
  }

  let slug: string | undefined;
  if (record.slug !== undefined && record.slug !== null && record.slug !== "") {
    if (typeof record.slug !== "string" || !isValidSlug(record.slug)) {
      return { ok: false, error: "Invalid snippet slug." };
    }
    slug = record.slug;
  }

  const rawOutput = typeof record.output === "string" ? record.output : "";
  const output = rawOutput.slice(0, MAX_OUTPUT_CHARS);

  return {
    ok: true,
    data: {
      email,
      slug,
      language: baseCheck.data.language,
      title: baseCheck.data.title,
      code: baseCheck.data.code,
      stdin: baseCheck.data.stdin,
      output,
    },
  };
}

/**
 * Escapes HTML special characters to prevent markup injection inside transactional emails.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Computes a SHA-256 hex digest for privacy-preserving recipient audit logs.
 */
export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value.toLowerCase().trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Extracts client IP cleanly inside Cloudflare Workers.
 */
export function getClientIp(request: Request): string {
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp.trim();
  const forwarded = request.headers.get("X-Forwarded-For");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "127.0.0.1";
}

/**
 * Applies Wasm-safe Cross-Origin Isolation headers (using COEP credentialless so
 * public CDN scripts and Monaco Editor load cleanly) alongside standard security headers.
 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "credentialless");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function jsonResponse(
  payload: unknown,
  init: ResponseInit = {}
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  return withSecurityHeaders(
    new Response(JSON.stringify(payload), {
      ...init,
      headers,
    })
  );
}
