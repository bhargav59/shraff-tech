import { createClient } from "@supabase/supabase-js";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis/cloudflare";
import { Resend } from "resend";
import type {
  CreateSnippetPayload,
  Env,
  SnippetRecord,
  SupportedLanguage,
  WorkerServices,
} from "./types";

const SNIPPET_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const SNIPPET_CACHE_PREFIX = "snippet:";

/**
 * Instantiates fetch-compatible Supabase, Upstash Redis, Upstash Ratelimit, and Resend clients.
 * Every SDK communicates strictly over HTTPS/REST—no raw TCP sockets or Node net APIs.
 */
export function createWorkerServices(env: Env): WorkerServices {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase environment secrets (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  }
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error("Missing Upstash Redis environment secrets (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).");
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });

  const createLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "1 m"),
    analytics: true,
    prefix: "shraff:rl:create",
  });

  const emailLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "1 m"),
    analytics: true,
    prefix: "shraff:rl:email",
  });

  return {
    async getSnippetFromCache(slug: string): Promise<SnippetRecord | null> {
      const cached = await redis.get<SnippetRecord>(`${SNIPPET_CACHE_PREFIX}${slug}`);
      if (!cached) return null;
      if (cached.expires_at && new Date(cached.expires_at).getTime() <= Date.now()) {
        await redis.del(`${SNIPPET_CACHE_PREFIX}${slug}`);
        return null;
      }
      return cached;
    },

    async cacheSnippet(snippet: SnippetRecord): Promise<void> {
      await redis.set(`${SNIPPET_CACHE_PREFIX}${snippet.slug}`, snippet, {
        ex: SNIPPET_CACHE_TTL_SECONDS,
      });
    },

    async insertSnippet(input: CreateSnippetPayload & { slug: string }): Promise<SnippetRecord> {
      const { data, error } = await supabase
        .from("snippets")
        .insert({
          slug: input.slug,
          language: input.language,
          title: input.title,
          code: input.code,
          stdin: input.stdin,
        })
        .select("id, slug, language, title, code, stdin, created_at, expires_at")
        .single();

      if (error || !data) {
        const err = new Error(error?.message ?? "Failed to store snippet in Supabase.") as Error & {
          code?: string;
        };
        err.code = error?.code;
        throw err;
      }

      return data as SnippetRecord;
    },

    async fetchSnippetBySlug(slug: string): Promise<SnippetRecord | null> {
      const { data, error } = await supabase
        .from("snippets")
        .select("id, slug, language, title, code, stdin, created_at, expires_at")
        .eq("slug", slug)
        .maybeSingle();

      if (error) {
        throw new Error(`Supabase read failed: ${error.message}`);
      }
      if (!data) return null;

      const record = data as SnippetRecord;
      if (record.expires_at && new Date(record.expires_at).getTime() <= Date.now()) {
        return null;
      }
      return record;
    },

    async incrementSnippetViews(slug: string): Promise<void> {
      await supabase.rpc("increment_snippet_views", { p_slug: slug });
    },

    async checkCreateRateLimit(ip: string) {
      return createLimiter.limit(ip);
    },

    async checkEmailRateLimit(ip: string) {
      return emailLimiter.limit(ip);
    },

    async sendSnippetEmail({ to, subject, html, text }) {
      if (!env.RESEND_API_KEY) {
        throw new Error("Missing RESEND_API_KEY secret.");
      }

      const resend = new Resend(env.RESEND_API_KEY);
      const from = env.RESEND_FROM_EMAIL || "shraff.tech <noreply@shraff.tech>";

      const { data, error } = await resend.emails.send({
        from,
        to: [to],
        subject,
        html,
        text,
      });

      if (error || !data) {
        throw new Error(error?.message ?? "Resend email delivery failed.");
      }

      return { id: data.id };
    },

    async recordEmailShare({
      slug,
      recipientHash,
      language,
    }: {
      slug: string | null;
      recipientHash: string;
      language: SupportedLanguage;
    }): Promise<void> {
      await supabase.from("email_shares").insert({
        snippet_slug: slug,
        recipient_hash: recipientHash,
        language,
      });
    },

    async keepAlivePing() {
      const { error: sbError } = await supabase.from("snippets").select("id").limit(1);
      const pong = await redis.ping();
      return {
        supabaseOk: !sbError,
        redisOk: pong === "PONG",
      };
    },
  };
}
