import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext, Fetcher, ScheduledController } from "@cloudflare/workers-types";
import { handleRequest, handleScheduled } from "../worker/index";
import { escapeHtml, generateSlug, isValidSlug } from "../worker/security";
import type { Env, SnippetRecord, WorkerServices } from "../worker/types";

function createMockCtx(): { ctx: ExecutionContext; flush: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
  return {
    ctx,
    async flush() {
      await Promise.allSettled(pending);
    },
  };
}

function createMockEnv(): Env {
  const assets: Fetcher = {
    fetch: vi.fn(async () => new Response("<html>spa</html>", { status: 200 })),
    connect: vi.fn(),
  } as unknown as Fetcher;

  return {
    ASSETS: assets,
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "redis-token",
    RESEND_API_KEY: "re_test_key",
    RESEND_FROM_EMAIL: "shraff.tech <noreply@shraff.tech>",
    SITE_ORIGIN: "https://shraff.tech",
  };
}

function createMockServices(overrides: Partial<WorkerServices> = {}): WorkerServices {
  const cache = new Map<string, SnippetRecord>();
  const db = new Map<string, SnippetRecord>();

  return {
    async getSnippetFromCache(slug) {
      return cache.get(slug) ?? null;
    },
    async cacheSnippet(snippet) {
      cache.set(snippet.slug, snippet);
    },
    async insertSnippet(input) {
      const record: SnippetRecord = {
        id: "uuid-1",
        slug: input.slug,
        language: input.language,
        title: input.title,
        code: input.code,
        stdin: input.stdin,
        created_at: "2026-11-26T00:00:00.000Z",
        expires_at: null,
      };
      db.set(record.slug, record);
      return record;
    },
    async fetchSnippetBySlug(slug) {
      return db.get(slug) ?? null;
    },
    async incrementSnippetViews() {},
    async checkCreateRateLimit() {
      return {
        success: true,
        limit: 10,
        remaining: 9,
        reset: Date.now() + 60_000,
        pending: Promise.resolve(),
      };
    },
    async checkEmailRateLimit() {
      return {
        success: true,
        limit: 5,
        remaining: 4,
        reset: Date.now() + 60_000,
        pending: Promise.resolve(),
      };
    },
    async sendSnippetEmail() {
      return { id: "email_123" };
    },
    async recordEmailShare() {},
    async keepAlivePing() {
      return { supabaseOk: true, redisOk: true };
    },
    ...overrides,
  };
}

describe("Cloudflare Worker security helpers", () => {
  it("generates unambiguous 7-character slugs", () => {
    for (let i = 0; i < 20; i++) {
      const slug = generateSlug(7);
      expect(slug).toHaveLength(7);
      expect(isValidSlug(slug)).toBe(true);
    }
  });

  it("escapes HTML special characters safely", () => {
    expect(escapeHtml(`<script>alert("xss'&")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;xss&#39;&amp;&quot;)&lt;/script&gt;"
    );
  });
});

describe("Cloudflare Worker API routes", () => {
  it("returns health check with Wasm COOP/COEP credentialless headers", async () => {
    const env = createMockEnv();
    const { ctx } = createMockCtx();
    const res = await handleRequest(new Request("https://shraff.tech/api/health"), env, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("Cross-Origin-Embedder-Policy")).toBe("credentialless");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("shraff.tech");
  });

  it("creates, caches, and retrieves snippets via cache-aside pattern", async () => {
    const env = createMockEnv();
    const services = createMockServices();
    const { ctx, flush } = createMockCtx();

    const createReq = new Request("https://shraff.tech/api/snippets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "203.0.113.10",
      },
      body: JSON.stringify({
        language: "python",
        title: "Prime Check",
        code: "print(42)",
        stdin: "",
      }),
    });

    const createRes = await handleRequest(createReq, env, ctx, () => services);
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { slug: string; url: string };
    expect(created.slug).toHaveLength(7);
    expect(created.url).toBe(`https://shraff.tech/s/${created.slug}`);

    await flush();

    // Cached read should hit Redis
    const hitRes = await handleRequest(
      new Request(`https://shraff.tech/api/snippets/${created.slug}`),
      env,
      ctx,
      () => services
    );
    expect(hitRes.status).toBe(200);
    expect(hitRes.headers.get("X-Cache")).toBe("HIT");
    const fetched = (await hitRes.json()) as SnippetRecord;
    expect(fetched.code).toBe("print(42)");
  });

  it("falls back to Supabase on Redis miss and backfills cache", async () => {
    const env = createMockEnv();
    const cacheSpy = vi.fn(async () => {});
    const services = createMockServices({
      getSnippetFromCache: async () => null,
      fetchSnippetBySlug: async (slug) => ({
        slug,
        language: "sql",
        title: "Orders",
        code: "SELECT * FROM users;",
        stdin: "",
        created_at: "2026-11-26T00:00:00.000Z",
        expires_at: null,
      }),
      cacheSnippet: cacheSpy,
    });
    const { ctx, flush } = createMockCtx();

    const res = await handleRequest(
      new Request("https://shraff.tech/api/snippets/AbCd123"),
      env,
      ctx,
      () => services
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBe("MISS");
    await flush();
    expect(cacheSpy).toHaveBeenCalledTimes(1);
  });

  it("enforces 429 rate limiting on snippet creation", async () => {
    const env = createMockEnv();
    const services = createMockServices({
      checkCreateRateLimit: async () => ({
        success: false,
        limit: 10,
        remaining: 0,
        reset: Date.now() + 30_000,
        pending: Promise.resolve(),
      }),
    });
    const { ctx } = createMockCtx();

    const res = await handleRequest(
      new Request("https://shraff.tech/api/snippets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: "javascript",
          title: "Test",
          code: "console.log(1)",
          stdin: "",
        }),
      }),
      env,
      ctx,
      () => services
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("retries on PostgreSQL 23505 slug collision", async () => {
    const env = createMockEnv();
    let attempts = 0;
    const services = createMockServices({
      insertSnippet: async (input) => {
        attempts += 1;
        if (attempts === 1) {
          const err = new Error("duplicate key") as Error & { code?: string };
          err.code = "23505";
          throw err;
        }
        return {
          slug: input.slug,
          language: input.language,
          title: input.title,
          code: input.code,
          stdin: input.stdin,
          created_at: "2026-11-26T00:00:00.000Z",
          expires_at: null,
        };
      },
    });
    const { ctx } = createMockCtx();

    const res = await handleRequest(
      new Request("https://shraff.tech/api/snippets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: "lua",
          title: "Retry Test",
          code: "print('ok')",
          stdin: "",
        }),
      }),
      env,
      ctx,
      () => services
    );

    expect(res.status).toBe(201);
    expect(attempts).toBe(2);
  });

  it("validates email and escapes HTML content when emailing via Resend", async () => {
    const env = createMockEnv();
    const sendSpy = vi.fn<WorkerServices["sendSnippetEmail"]>(async () => ({ id: "email_999" }));
    const services = createMockServices({ sendSnippetEmail: sendSpy });
    const { ctx, flush } = createMockCtx();

    const badRes = await handleRequest(
      new Request("https://shraff.tech/api/share-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "not-an-email",
          language: "javascript",
          title: "Bad",
          code: "console.log(1)",
          stdin: "",
        }),
      }),
      env,
      ctx,
      () => services
    );
    expect(badRes.status).toBe(400);

    const okRes = await handleRequest(
      new Request("https://shraff.tech/api/share-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "dev@example.com",
          language: "javascript",
          title: `<img src=x onerror=alert(1)>`,
          code: `console.log("<script>")`,
          stdin: "",
          output: `<b>hi</b>`,
        }),
      }),
      env,
      ctx,
      () => services
    );
    expect(okRes.status).toBe(200);
    await flush();

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sentArg = sendSpy.mock.calls[0][0];
    expect(sentArg.html).not.toContain("<script>");
    expect(sentArg.html).not.toContain("<img src=x");
    expect(sentArg.html).toContain("&lt;script&gt;");
  });

  it("executes Supabase & Redis keepalive ping on cron schedule", async () => {
    const env = createMockEnv();
    const pingSpy = vi.fn(async () => ({ supabaseOk: true, redisOk: true }));
    const services = createMockServices({ keepAlivePing: pingSpy });
    const { ctx } = createMockCtx();
    const controller = { scheduledTime: Date.now(), cron: "0 0 */3 * *", noRetry() {} } as ScheduledController;

    await handleScheduled(controller, env, ctx, () => services);
    expect(pingSpy).toHaveBeenCalledTimes(1);

    const failingServices = createMockServices({
      keepAlivePing: async () => ({ supabaseOk: false, redisOk: true }),
    });
    await expect(
      handleScheduled(controller, env, ctx, () => failingServices)
    ).rejects.toThrow("Supabase keepalive query failed");
  });
});
