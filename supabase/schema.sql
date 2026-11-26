-- ============================================================================
-- shraff.tech — Supabase PostgreSQL Schema & Row Level Security (Free Tier)
-- Run this script once in the Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- Enable pgcrypto if not already enabled for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Snippets Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.snippets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(12) NOT NULL UNIQUE,
  language varchar(24) NOT NULL CHECK (
    language IN (
      'javascript',
      'typescript',
      'python',
      'c',
      'cpp',
      'lua',
      'ruby',
      'php',
      'sql'
    )
  ),
  title varchar(120) NOT NULL DEFAULT 'Untitled Snippet',
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 100000),
  stdin text NOT NULL DEFAULT '' CHECK (char_length(stdin) <= 32768),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  views bigint NOT NULL DEFAULT 0
);

-- Fast lookups for recent snippets and optional expiry sweeps
CREATE INDEX IF NOT EXISTS idx_snippets_created_at
  ON public.snippets (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_snippets_expires_at
  ON public.snippets (expires_at)
  WHERE expires_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Email Share Audit Table (Privacy-preserving SHA-256 recipient hash)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snippet_slug varchar(12) REFERENCES public.snippets (slug) ON DELETE SET NULL,
  recipient_hash text NOT NULL,
  language varchar(24) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_shares_created_at
  ON public.email_shares (created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. Row Level Security (RLS)
-- ----------------------------------------------------------------------------
ALTER TABLE public.snippets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_shares ENABLE ROW LEVEL SECURITY;

-- Drop existing policies cleanly so re-running schema.sql is idempotent
DROP POLICY IF EXISTS "Allow public read of active snippets" ON public.snippets;
DROP POLICY IF EXISTS "Service role full access snippets" ON public.snippets;
DROP POLICY IF EXISTS "Service role full access email_shares" ON public.email_shares;

-- Public users (anon / authenticated) can ONLY read non-expired snippets.
-- All writes (INSERT/UPDATE/DELETE) go through the Cloudflare Worker API
-- using SUPABASE_SERVICE_ROLE_KEY so Upstash rate limiting & validation apply.
CREATE POLICY "Allow public read of active snippets"
  ON public.snippets
  FOR SELECT
  TO anon, authenticated
  USING (expires_at IS NULL OR expires_at > now());

-- Explicit service_role policy (service_role bypasses RLS by default in Supabase)
CREATE POLICY "Service role full access snippets"
  ON public.snippets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Email share audit log is restricted strictly to service_role (no anon reads/writes)
CREATE POLICY "Service role full access email_shares"
  ON public.email_shares
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 4. Optional Atomic View Counter RPC (called asynchronously by Worker)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_snippet_views(p_slug varchar)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.snippets
  SET views = views + 1
  WHERE slug = p_slug
    AND (expires_at IS NULL OR expires_at > now());
$$;

REVOKE ALL ON FUNCTION public.increment_snippet_views(varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_snippet_views(varchar) TO service_role;
