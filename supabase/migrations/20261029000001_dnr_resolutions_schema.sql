// ==============================================================================
// Migration: 20261029000001_dnr_resolutions_schema.sql
// Purpose:   Store Rider-level DNR (Delivery Not Received) Resolutions & Audit History.
//            Allows managers to log actions taken on riders flagged with DNRs:
//            - Given Warning to Rider
//            - Rider ID deactivated
//            - RCA resolved No mistake from Rider
// ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.store_dnr_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_code TEXT NOT NULL,
  rider_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  dp_id TEXT,
  resolution TEXT NOT NULL,
  notes TEXT,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_dnr_resolutions_site
  ON public.store_dnr_resolutions (site_code);

CREATE INDEX IF NOT EXISTS idx_store_dnr_resolutions_norm
  ON public.store_dnr_resolutions (normalized_name);

CREATE INDEX IF NOT EXISTS idx_store_dnr_resolutions_resolved_at
  ON public.store_dnr_resolutions (resolved_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.store_dnr_resolutions ENABLE ROW LEVEL SECURITY;

-- Grants to authenticated, anon, and service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_dnr_resolutions TO authenticated, anon, service_role;

-- RLS Policies
DROP POLICY IF EXISTS "Allow authenticated select store_dnr_resolutions" ON public.store_dnr_resolutions;
CREATE POLICY "Allow authenticated select store_dnr_resolutions"
  ON public.store_dnr_resolutions FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "Allow authenticated modify store_dnr_resolutions" ON public.store_dnr_resolutions;
CREATE POLICY "Allow authenticated modify store_dnr_resolutions"
  ON public.store_dnr_resolutions FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

COMMIT;
