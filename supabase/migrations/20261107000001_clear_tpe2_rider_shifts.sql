-- ==============================================================================
-- Migration: 20261107000001_clear_tpe2_rider_shifts.sql
-- Purpose:   Clear all Assigned Shift & Timings data for TPE2 (Amazon Ambegaon)
--            so shift assignments can be logged freshly from scratch.
-- ==============================================================================

BEGIN;

-- 1. If any TPE2 rider row has referral data logged, clear only its shift assignment
--    by setting shift_type = 'UNASSIGNED' and total_planned_hours = 0.
UPDATE public.store_rider_shifts
SET
  shift_type = 'UNASSIGNED',
  total_planned_hours = 0,
  updated_at = now()
WHERE store_id IN (
  SELECT id FROM public.stores WHERE store_code = 'TPE2'
)
AND (
  COALESCE(TRIM(referred_by), '') <> ''
  OR COALESCE(TRIM(referred_phone), '') <> ''
);

-- 2. Delete all other TPE2 shift rows in store_rider_shifts
DELETE FROM public.store_rider_shifts
WHERE store_id IN (
  SELECT id FROM public.stores WHERE store_code = 'TPE2'
)
AND COALESCE(TRIM(referred_by), '') = ''
AND COALESCE(TRIM(referred_phone), '') = '';

-- 3. Clear any TPE2 attendance shift snapshots so fresh shifts take effect cleanly
DELETE FROM public.store_rider_attendance
WHERE warehouse_id = 'TPE2'
   OR store_id IN (
     SELECT id FROM public.stores WHERE store_code = 'TPE2'
   );

COMMIT;
