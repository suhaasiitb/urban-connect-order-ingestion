-- ==============================================================================
-- Migration: 20261023000001_rider_shifts_schema.sql
-- Purpose:   Store recurring shift assignments and timings per rider per store.
--            Supports single and split shifts (e.g. 6-10 AM & 6-10 PM) and 8-hour tracking.
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.store_rider_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  rider_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  shift_type TEXT NOT NULL DEFAULT 'Morning Shift',
  slot1_start_hour INTEGER NOT NULL DEFAULT 6 CHECK (slot1_start_hour >= 0 AND slot1_start_hour <= 23),
  slot1_end_hour INTEGER NOT NULL DEFAULT 14 CHECK (slot1_end_hour >= 0 AND slot1_end_hour <= 24),
  slot2_start_hour INTEGER CHECK (slot2_start_hour >= 0 AND slot2_start_hour <= 23),
  slot2_end_hour INTEGER CHECK (slot2_end_hour >= 0 AND slot2_end_hour <= 24),
  total_planned_hours NUMERIC(4, 1) NOT NULL DEFAULT 8.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_store_rider_shift UNIQUE (store_id, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_store_rider_shifts_store
  ON public.store_rider_shifts (store_id);

CREATE INDEX IF NOT EXISTS idx_store_rider_shifts_norm
  ON public.store_rider_shifts (store_id, normalized_name);

-- Enable Row Level Security (RLS)
ALTER TABLE public.store_rider_shifts ENABLE ROW LEVEL SECURITY;

-- Grants to authenticated and service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_rider_shifts TO authenticated, service_role;

-- RLS Policies for authenticated users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'store_rider_shifts'
      AND policyname = 'authenticated_store_rider_shifts_select'
  ) THEN
    CREATE POLICY authenticated_store_rider_shifts_select
      ON public.store_rider_shifts
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'store_rider_shifts'
      AND policyname = 'authenticated_store_rider_shifts_all'
  ) THEN
    CREATE POLICY authenticated_store_rider_shifts_all
      ON public.store_rider_shifts
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

COMMIT;
