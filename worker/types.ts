import type { Fetcher } from "@cloudflare/workers-types";

export const SUPPORTED_LANGUAGES = [
  "javascript",
  "typescript",
  "python",
  "c",
  "cpp",
  "lua",
  "ruby",
  "php",
  "sql",
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  RESEND_API_KEY: string;
  RESEND_FROM_EMAIL?: string;
  SITE_ORIGIN?: string;
}

export interface SnippetRecord {
  id?: string;
  slug: string;
  language: SupportedLanguage;
  title: string;
  code: string;
  stdin: string;
  created_at: string;
  expires_at: string | null;
}

export interface CreateSnippetPayload {
  language: SupportedLanguage;
  title: string;
  code: string;
  stdin: string;
}

export interface ShareEmailPayload {
  email: string;
  slug?: string;
  language: SupportedLanguage;
  title: string;
  code: string;
  stdin: string;
  output?: string;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  pending: Promise<unknown>;
}

export interface WorkerServices {
  getSnippetFromCache(slug: string): Promise<SnippetRecord | null>;
  cacheSnippet(snippet: SnippetRecord): Promise<void>;
  insertSnippet(snippet: CreateSnippetPayload & { slug: string }): Promise<SnippetRecord>;
  fetchSnippetBySlug(slug: string): Promise<SnippetRecord | null>;
  incrementSnippetViews(slug: string): Promise<void>;
  checkCreateRateLimit(ip: string): Promise<RateLimitResult>;
  checkEmailRateLimit(ip: string): Promise<RateLimitResult>;
  sendSnippetEmail(params: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<{ id: string }>;
  recordEmailShare(params: {
    slug: string | null;
    recipientHash: string;
    language: SupportedLanguage;
  }): Promise<void>;
  keepAlivePing(): Promise<{ supabaseOk: boolean; redisOk: boolean }>;
}
