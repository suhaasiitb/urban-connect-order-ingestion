-- ==============================================================================
-- Migration: 20261106000001_add_referral_columns_to_store_rider_shifts.sql
-- Purpose:   Add referred_by and referred_phone (and ensure onboarded_by & joining_date)
--            columns on public.store_rider_shifts so referral tracking persists
--            across devices (mobile & laptop) and page refreshes.
-- ==============================================================================

BEGIN;

ALTER TABLE public.store_rider_shifts
  ADD COLUMN IF NOT EXISTS joining_date DATE,
  ADD COLUMN IF NOT EXISTS onboarded_by TEXT,
  ADD COLUMN IF NOT EXISTS referred_by TEXT,
  ADD COLUMN IF NOT EXISTS referred_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_store_rider_shifts_onboarded_by
  ON public.store_rider_shifts (store_id, onboarded_by);

CREATE INDEX IF NOT EXISTS idx_store_rider_shifts_referred_by
  ON public.store_rider_shifts (store_id, referred_by);

-- Enable Realtime replication on store_rider_shifts for live cross-device sync
ALTER TABLE public.store_rider_shifts REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'store_rider_shifts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.store_rider_shifts;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Reload PostgREST schema cache so new columns are immediately queryable
NOTIFY pgrst, 'reload schema';

COMMIT;
