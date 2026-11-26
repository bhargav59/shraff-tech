# shraff.tech — Client-Side Multi-Language WebAssembly IDE

A zero-cost, full-stack online compiler and code-sharing IDE built for **`shraff.tech`**. Every line of user code runs **100% locally in the browser** inside an isolated Web Worker using WebAssembly, keeping hosting, database, caching, and transactional emails strictly on permanent free tiers.

## Architecture Overview

- **Hosting & Edge API:** Cloudflare Workers with Static Assets (single `wrangler.toml` deployment; zero CORS overhead).
- **Primary Database:** Supabase Free Tier (PostgreSQL via `@supabase/supabase-js` HTTPS REST client).
- **Rate Limiting & 24h Caching:** Upstash Redis Free Tier (`@upstash/redis/cloudflare` + `@upstash/ratelimit` sliding window: 10 snippet creates/min/IP, 5 emails/min/IP).
- **Transactional Emails:** Resend Free Tier (`resend` SDK over `fetch`, sending from `noreply@shraff.tech`).
- **Keepalive Cron:** Cloudflare Cron Trigger (`0 0 */3 * *`) queries `SELECT id FROM snippets LIMIT 1` every 3 days to prevent Supabase's 7-day inactivity auto-pause.
- **Cross-Origin Isolation Headers:** `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` (configured in both `public/_headers` and Worker responses) so Wasm runtimes work while CDN assets (Monaco Editor, jsDelivr Wasm) load unrestricted.

## Supported Languages (Lazy-Loaded via CDN)

1. **JavaScript (ES2024)** — Native isolated Web Worker sandbox with `console.*` + `readline()`.
2. **TypeScript** — In-browser `esbuild-wasm` transpilation + sandboxed execution.
3. **Python 3** — Pyodide (`v0.29.5`) CPython 3.13 Wasm loaded on demand.
4. **C** — `JSCPP` interpreter in Web Worker (`<stdio.h>`, `scanf`, `printf`).
5. **C++** — `JSCPP` interpreter in Web Worker (`<iostream>`, `cin`, `cout`).
6. **Lua 5.4** — `wasmoon` Lua 5.4 WebAssembly VM.
7. **Ruby 3.4** — `@ruby/wasm-wasi` + `@ruby/3.4-wasm-wasi` (`ruby+stdlib.wasm`) with WASI stdin/stdout/stderr shim.
8. **PHP 8.4** — `php-cgi-wasm` (`php8.4-cgi-worker.mjs`) with `STDIN`/`readline()` support.
9. **SQL (SQLite)** — `sql.js` Wasm pre-seeded with `users` and `orders` tables + tabular output view.

---

## Step-by-Step Setup & Deployment Guide

### 1. Local Development Setup

```bash
npm install
cp .dev.vars.example .dev.vars
# Fill in your Supabase, Upstash, and Resend credentials inside .dev.vars
```

Run tests, typechecks, and production build locally:

```bash
npm run typecheck
npm test
npm run build
```

Run Vite frontend + Cloudflare Worker together locally:

```bash
# Terminal 1 (Edge API on http://127.0.0.1:8787)
npm run dev:worker

# Terminal 2 (Frontend IDE on http://localhost:5173 with /api proxy)
npm run dev
```

---

### 2. Provision Supabase Free Tier Database

1. Sign in to [Supabase](https://supabase.com) and create a new **Free** project.
2. Open **SQL Editor -> New query**, paste the contents of `supabase/schema.sql`, and click **Run**.
3. Go to **Project Settings -> API** and copy:
   - **Project URL** -> `SUPABASE_URL`
   - **service_role key** (secret) -> `SUPABASE_SERVICE_ROLE_KEY`

---

### 3. Provision Upstash Redis Free Tier

1. Sign in to [Upstash](https://upstash.com) and create a **Free** Redis database in a region close to your primary users (or global read-replica if needed).
2. In the database details page under **REST API**, copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

---

### 4. Provision Resend Free Tier & Cloudflare DNS Records

1. Sign in to [Resend](https://resend.com) -> **Domains -> Add Domain** -> enter `shraff.tech`.
2. Copy the DNS records Resend provides (typically 1 DKIM `TXT`, 1 SPF `MX`/`TXT` on `send` subdomain) into your **Cloudflare Dashboard -> `shraff.tech` -> DNS -> Records**:
   - **DKIM (`TXT`):** Name `resend._domainkey` (or exact host shown in Resend), Content = Resend DKIM public key, Proxy status = **DNS only**.
   - **SPF (`TXT` on `send`):** Name `send`, Content = `v=spf1 include:amazonses.com ~all` (or exact value from Resend), Proxy status = **DNS only**.
   - **Bounce `MX` on `send`:** Name `send`, Mail server = `feedback-smtp.<region>.amazonses.com` (Priority `10`, exact value from Resend), Proxy status = **DNS only**.
   - **DMARC (`TXT`):** Name `_dmarc`, Content = `v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc@shraff.tech` (or `p=none` initially while verifying), Proxy status = **DNS only**.
3. Click **Verify DNS Records** in Resend, then create an API key under **API Keys -> Create API Key** -> `RESEND_API_KEY`.

---

### 5. Set Cloudflare Worker Secrets & Deploy

Authenticate Wrangler and upload all secrets cleanly (never commit secrets into `wrangler.toml`):

```bash
npx wrangler login

npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put UPSTASH_REDIS_REST_URL
npx wrangler secret put UPSTASH_REDIS_REST_TOKEN
npx wrangler secret put RESEND_API_KEY
```

Build the frontend and deploy the unified Worker + Static Assets bundle:

```bash
npm run deploy
```

---

### 6. Connect Custom Domain `shraff.tech` in Cloudflare Dashboard

1. Open **Cloudflare Dashboard -> Workers & Pages -> `shraff-tech`**.
2. Go to **Settings -> Domains & Routes -> + Add -> Custom domain**.
3. Enter `shraff.tech` (and optionally `www.shraff.tech`) and click **Add domain**. Cloudflare automatically provisions the SSL certificate and DNS AAAA/CNAME record.
4. Verify in your browser:
   - `https://shraff.tech` loads the IDE and `curl -I https://shraff.tech` shows `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`.
   - `https://shraff.tech/api/health` returns `{"ok":true,"service":"shraff.tech",...}`.
   - Sharing a snippet generates `https://shraff.tech/s/<7-char-slug>` and loads back seamlessly on refresh.
