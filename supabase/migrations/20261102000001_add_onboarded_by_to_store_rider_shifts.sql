-- ==============================================================================
-- Migration: 20261102000001_add_onboarded_by_to_store_rider_shifts.sql
-- Purpose:   Add onboarded_by column to store_rider_shifts table to log
--            who onboarded the rider (Sunil, Atharva, Krushna, FM1, FM2).
-- ==============================================================================

BEGIN;

ALTER TABLE public.store_rider_shifts
  ADD COLUMN IF NOT EXISTS onboarded_by TEXT;

CREATE INDEX IF NOT EXISTS idx_store_rider_shifts_onboarded_by
  ON public.store_rider_shifts (store_id, onboarded_by);

COMMIT;
