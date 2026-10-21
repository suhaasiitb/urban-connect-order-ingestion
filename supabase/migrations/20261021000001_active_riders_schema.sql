-- ==============================================================================
-- Migration: 20261021000001_active_riders_schema.sql
-- Purpose:   Store active riders roster uploaded periodically per store.
--            Configures Row Level Security (RLS) and authenticated policies.
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.store_active_riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  rider_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  phone TEXT,
  online_status TEXT,
  eligibility TEXT,
  attendance TEXT,
  source_store_code TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_store_active_rider UNIQUE (store_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS public.store_rider_roster_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  total_riders INTEGER NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_store_active_riders_store
  ON public.store_active_riders (store_id);

CREATE INDEX IF NOT EXISTS idx_store_active_riders_normalized
  ON public.store_active_riders (store_id, normalized_name);

CREATE INDEX IF NOT EXISTS idx_store_rider_roster_uploads_store
  ON public.store_rider_roster_uploads (store_id, uploaded_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.store_active_riders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_rider_roster_uploads ENABLE ROW LEVEL SECURITY;

-- Deliberate grants to authenticated and service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_active_riders TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_rider_roster_uploads TO authenticated, service_role;

-- RLS Policies for authenticated users
DROP POLICY IF EXISTS "Allow authenticated select store_active_riders" ON public.store_active_riders;
CREATE POLICY "Allow authenticated select store_active_riders"
  ON public.store_active_riders FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow authenticated modify store_active_riders" ON public.store_active_riders;
CREATE POLICY "Allow authenticated modify store_active_riders"
  ON public.store_active_riders FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated select store_rider_roster_uploads" ON public.store_rider_roster_uploads;
CREATE POLICY "Allow authenticated select store_rider_roster_uploads"
  ON public.store_rider_roster_uploads FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow authenticated modify store_rider_roster_uploads" ON public.store_rider_roster_uploads;
CREATE POLICY "Allow authenticated modify store_rider_roster_uploads"
  ON public.store_rider_roster_uploads FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMIT;
