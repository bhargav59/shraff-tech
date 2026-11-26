import type { ExecutionContext, ScheduledController } from "@cloudflare/workers-types";
import {
  escapeHtml,
  generateSlug,
  getClientIp,
  isValidSlug,
  jsonResponse,
  sha256Hex,
  validateCreateSnippetInput,
  validateShareEmailInput,
  withSecurityHeaders,
} from "./security";
import { createWorkerServices } from "./services";
import type {
  CreateSnippetPayload,
  Env,
  SnippetRecord,
  WorkerServices,
} from "./types";

const MAX_SLUG_ATTEMPTS = 3;

function buildShareEmailContent(params: {
  title: string;
  language: string;
  shareUrl: string;
  code: string;
  stdin: string;
  output?: string;
}): { subject: string; html: string; text: string } {
  const safeTitle = escapeHtml(params.title);
  const safeLang = escapeHtml(params.language.toUpperCase());
  const safeUrl = escapeHtml(params.shareUrl);
  const codePreview = params.code.length > 4000
    ? `${params.code.slice(0, 4000)}\n// ... (truncated; open link for full snippet)`
    : params.code;
  const safeCode = escapeHtml(codePreview);
  const safeOutput = params.output
    ? escapeHtml(params.output.slice(0, 2000))
    : "";

  const subject = `[shraff.tech] ${params.title} (${params.language})`;

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:24px;background:#0f172a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;background:#1e293b;border:1px solid #334155;border-radius:12px;overflow:hidden;">
    <div style="padding:20px 24px;background:#0b1120;border-bottom:1px solid #334155;">
      <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#0ea5e9;color:#082f49;font-weight:700;font-size:12px;">${safeLang}</span>
      <h1 style="margin:12px 0 4px;font-size:20px;color:#f8fafc;">${safeTitle}</h1>
      <p style="margin:0;font-size:13px;color:#94a3b8;">Saved on shraff.tech — Client-Side WebAssembly IDE</p>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#cbd5e1;">
        Your code snippet is ready to run in any browser with zero setup:
      </p>
      <p style="margin:0 0 20px;">
        <a href="${safeUrl}" style="display:inline-block;padding:11px 18px;border-radius:8px;background:#38bdf8;color:#082f49;font-weight:700;text-decoration:none;font-size:14px;">Open Snippet in shraff.tech</a>
      </p>
      <p style="margin:0 0 8px;font-size:12px;color:#94a3b8;">Direct link: <a href="${safeUrl}" style="color:#38bdf8;">${safeUrl}</a></p>
      <h2 style="margin:20px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;">Source Code</h2>
      <pre style="margin:0;padding:14px;background:#090d16;border:1px solid #334155;border-radius:8px;overflow:auto;color:#e2e8f0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5;"><code>${safeCode}</code></pre>
      ${
        safeOutput
          ? `<h2 style="margin:20px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;">Captured Output</h2>
      <pre style="margin:0;padding:14px;background:#090d16;border:1px solid #334155;border-radius:8px;overflow:auto;color:#a7f3d0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5;"><code>${safeOutput}</code></pre>`
          : ""
      }
    </div>
    <div style="padding:14px 24px;border-top:1px solid #334155;font-size:12px;color:#64748b;">
      Sent via <a href="https://shraff.tech" style="color:#94a3b8;">shraff.tech</a>. Code executes 100% locally in your browser via WebAssembly.
    </div>
  </div>
</body>
</html>`;

  const text = [
    `${params.title} (${params.language}) — shraff.tech`,
    `Open snippet: ${params.shareUrl}`,
    "",
    "--- Source Code ---",
    codePreview,
    params.stdin ? `\n--- Stdin ---\n${params.stdin}` : "",
    params.output ? `\n--- Output ---\n${params.output.slice(0, 2000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

async function createAndCacheSnippet(
  services: WorkerServices,
  payload: CreateSnippetPayload,
  ctx: ExecutionContext
): Promise<SnippetRecord> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = generateSlug(7);
    try {
      const inserted = await services.insertSnippet({ ...payload, slug });
      ctx.waitUntil(
        services.cacheSnippet(inserted).catch((err) => {
          console.error("Failed to cache new snippet in Upstash Redis:", err);
        })
      );
      return inserted;
    } catch (err) {
      lastError = err;
      const pgCode = (err as { code?: string } | null)?.code;
      if (pgCode === "23505") {
        // Unique slug collision — retry with a fresh slug
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to allocate unique snippet slug.");
}

function rateLimitHeaders(limit: number, remaining: number, reset: number): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(reset),
  };
}

/**
 * Core HTTP request handler extracted cleanly for both Cloudflare runtime and Vitest unit tests.
 */
export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  servicesFactory: (env: Env) => WorkerServices = createWorkerServices
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === "/health" || pathname === "/api/health") {
    return jsonResponse({
      ok: true,
      service: "shraff.tech",
      runtime: "cloudflare-workers",
      timestamp: new Date().toISOString(),
    });
  }

  // Handle API routes via fetch-based Supabase, Upstash, and Resend services
  if (pathname.startsWith("/api/")) {
    const siteOrigin = (env.SITE_ORIGIN || url.origin).replace(/\/$/, "");

    const initServicesOrError = (): WorkerServices | Response => {
      try {
        return servicesFactory(env);
      } catch (err) {
        return jsonResponse(
          { error: err instanceof Error ? err.message : "Server configuration error." },
          { status: 503 }
        );
      }
    };

    // POST /api/snippets — rate-limited snippet creation (10 req/min/IP)
    if (pathname === "/api/snippets" && request.method === "POST") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON payload." }, { status: 400 });
      }

      const validated = validateCreateSnippetInput(body);
      if (!validated.ok) {
        return jsonResponse({ error: validated.error }, { status: 400 });
      }

      const servicesOrErr = initServicesOrError();
      if (servicesOrErr instanceof Response) return servicesOrErr;
      const services = servicesOrErr;

      const ip = getClientIp(request);
      const rate = await services.checkCreateRateLimit(ip);
      ctx.waitUntil(rate.pending);

      const rlHeaders = rateLimitHeaders(rate.limit, rate.remaining, rate.reset);
      if (!rate.success) {
        return jsonResponse(
          {
            error: "Rate limit exceeded (10 shared snippets per minute). Please wait a moment.",
          },
          {
            status: 429,
            headers: {
              ...rlHeaders,
              "Retry-After": String(Math.max(1, Math.ceil((rate.reset - Date.now()) / 1000))),
            },
          }
        );
      }

      try {
        const snippet = await createAndCacheSnippet(services, validated.data, ctx);
        return jsonResponse(
          {
            slug: snippet.slug,
            url: `${siteOrigin}/s/${snippet.slug}`,
            language: snippet.language,
            title: snippet.title,
            created_at: snippet.created_at,
          },
          { status: 201, headers: rlHeaders }
        );
      } catch (err) {
        console.error("POST /api/snippets failed:", err);
        return jsonResponse(
          { error: "Unable to save snippet right now." },
          { status: 500, headers: rlHeaders }
        );
      }
    }

    // GET /api/snippets/:slug — Upstash Redis 24h cache-aside read
    if (pathname.startsWith("/api/snippets/") && request.method === "GET") {
      const slug = decodeURIComponent(pathname.slice("/api/snippets/".length)).trim();
      if (!isValidSlug(slug)) {
        return jsonResponse({ error: "Invalid snippet identifier." }, { status: 400 });
      }

      const servicesOrErr = initServicesOrError();
      if (servicesOrErr instanceof Response) return servicesOrErr;
      const services = servicesOrErr;

      try {
        const cached = await services.getSnippetFromCache(slug);
        if (cached) {
          ctx.waitUntil(services.incrementSnippetViews(slug).catch(() => undefined));
          return jsonResponse(
            {
              slug: cached.slug,
              language: cached.language,
              title: cached.title,
              code: cached.code,
              stdin: cached.stdin,
              created_at: cached.created_at,
            },
            {
              headers: {
                "X-Cache": "HIT",
                "Cache-Control": "public, max-age=300",
              },
            }
          );
        }

        const record = await services.fetchSnippetBySlug(slug);
        if (!record) {
          return jsonResponse({ error: "Snippet not found or expired." }, { status: 404 });
        }

        ctx.waitUntil(
          Promise.allSettled([
            services.cacheSnippet(record),
            services.incrementSnippetViews(slug),
          ])
        );

        return jsonResponse(
          {
            slug: record.slug,
            language: record.language,
            title: record.title,
            code: record.code,
            stdin: record.stdin,
            created_at: record.created_at,
          },
          {
            headers: {
              "X-Cache": "MISS",
              "Cache-Control": "public, max-age=300",
            },
          }
        );
      } catch (err) {
        console.error("GET /api/snippets/:slug failed:", err);
        return jsonResponse({ error: "Failed to load snippet." }, { status: 500 });
      }
    }

    // POST /api/share-email — rate-limited transactional email delivery via Resend
    if (pathname === "/api/share-email" && request.method === "POST") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON payload." }, { status: 400 });
      }

      const validated = validateShareEmailInput(body);
      if (!validated.ok) {
        return jsonResponse({ error: validated.error }, { status: 400 });
      }

      const servicesOrErr = initServicesOrError();
      if (servicesOrErr instanceof Response) return servicesOrErr;
      const services = servicesOrErr;

      const ip = getClientIp(request);
      const rate = await services.checkEmailRateLimit(ip);
      ctx.waitUntil(rate.pending);

      const rlHeaders = rateLimitHeaders(rate.limit, rate.remaining, rate.reset);
      if (!rate.success) {
        return jsonResponse(
          { error: "Email rate limit reached (5 per minute). Please try again shortly." },
          {
            status: 429,
            headers: {
              ...rlHeaders,
              "Retry-After": String(Math.max(1, Math.ceil((rate.reset - Date.now()) / 1000))),
            },
          }
        );
      }

      try {
        let slug = validated.data.slug;
        if (!slug) {
          const saved = await createAndCacheSnippet(
            services,
            {
              language: validated.data.language,
              title: validated.data.title,
              code: validated.data.code,
              stdin: validated.data.stdin,
            },
            ctx
          );
          slug = saved.slug;
        }

        const shareUrl = `${siteOrigin}/s/${slug}`;
        const emailContent = buildShareEmailContent({
          title: validated.data.title,
          language: validated.data.language,
          shareUrl,
          code: validated.data.code,
          stdin: validated.data.stdin,
          output: validated.data.output,
        });

        const sent = await services.sendSnippetEmail({
          to: validated.data.email,
          ...emailContent,
        });

        const recipientHash = await sha256Hex(validated.data.email);
        ctx.waitUntil(
          services
            .recordEmailShare({
              slug,
              recipientHash,
              language: validated.data.language,
            })
            .catch(() => undefined)
        );

        return jsonResponse(
          {
            ok: true,
            emailId: sent.id,
            slug,
            url: shareUrl,
          },
          { status: 200, headers: rlHeaders }
        );
      } catch (err) {
        console.error("POST /api/share-email failed:", err);
        return jsonResponse(
          { error: err instanceof Error ? err.message : "Failed to send email." },
          { status: 500, headers: rlHeaders }
        );
      }
    }

    return jsonResponse({ error: "API route not found." }, { status: 404 });
  }

  // Fallback to Cloudflare Static Assets (SPA handles `/` and `/s/:slug`)
  const assetResponse = await env.ASSETS.fetch(request as unknown as Parameters<typeof env.ASSETS.fetch>[0]);
  return withSecurityHeaders(assetResponse as unknown as Response);
}

/**
 * Scheduled Cron handler (`0 0 *\/3 * *`) to prevent Supabase Free Tier 7-day auto-pause
 * and keep Upstash Redis active.
 */
export async function handleScheduled(
  _controller: ScheduledController,
  env: Env,
  _ctx: ExecutionContext,
  servicesFactory: (env: Env) => WorkerServices = createWorkerServices
): Promise<void> {
  const services = servicesFactory(env);
  const status = await services.keepAlivePing();
  console.log("shraff.tech keepalive cron result:", JSON.stringify(status));
  if (!status.supabaseOk) {
    throw new Error("Supabase keepalive query failed.");
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    return handleScheduled(controller, env, ctx);
  },
};
