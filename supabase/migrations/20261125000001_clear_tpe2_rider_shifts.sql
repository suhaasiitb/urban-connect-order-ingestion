-- ==============================================================================
-- Migration: 20261125000001_clear_tpe2_rider_shifts.sql
-- Purpose:   Remove all assigned shift timings & attendance shift snapshots
--            for TPE2 (Amazon Ambegaon) so rider shifts can be captured fresh,
--            while preserving existing referral/onboarding metadata.
-- ==============================================================================

BEGIN;

-- 1. Preserve referral / onboarding metadata if present on a TPE2 row, clearing only
--    its assigned shift (shift_type = 'UNASSIGNED', default slots, total_planned_hours = 0).
UPDATE public.store_rider_shifts
SET
  shift_type = 'UNASSIGNED',
  slot1_start_hour = 6,
  slot1_end_hour = 14,
  slot2_start_hour = NULL,
  slot2_end_hour = NULL,
  total_planned_hours = 0,
  updated_at = now()
WHERE store_id IN (
  SELECT id FROM public.stores WHERE UPPER(TRIM(store_code)) = 'TPE2'
)
AND (
  COALESCE(TRIM(referred_by), '') <> ''
  OR COALESCE(TRIM(referred_phone), '') <> ''
  OR COALESCE(TRIM(onboarded_by), '') <> ''
  OR joining_date IS NOT NULL
);

-- 2. Delete all remaining TPE2 shift rows in store_rider_shifts.
DELETE FROM public.store_rider_shifts
WHERE store_id IN (
  SELECT id FROM public.stores WHERE UPPER(TRIM(store_code)) = 'TPE2'
)
AND COALESCE(TRIM(referred_by), '') = ''
AND COALESCE(TRIM(referred_phone), '') = ''
AND COALESCE(TRIM(onboarded_by), '') = ''
AND joining_date IS NULL;

-- 3. Clear TPE2 attendance shift snapshots so old shift timings do not carry forward.
DELETE FROM public.store_rider_attendance
WHERE UPPER(TRIM(warehouse_id)) = 'TPE2'
   OR store_id IN (
     SELECT id FROM public.stores WHERE UPPER(TRIM(store_code)) = 'TPE2'
   );

COMMIT;
