-- ==============================================================================
-- Migration: 20261024000001_new_rider_onboarding.sql
-- Purpose:   Add joining_date override to store_rider_shifts and support
--            New Rider First 7 Days Onboarding Analytics.
-- ==============================================================================

BEGIN;

-- Add joining_date to store_rider_shifts for manual override
ALTER TABLE public.store_rider_shifts
  ADD COLUMN IF NOT EXISTS joining_date DATE;

CREATE INDEX IF NOT EXISTS idx_store_rider_shifts_joining_date
  ON public.store_rider_shifts (store_id, joining_date);

-- Helper RPC to aggregate earliest & latest order dates per rider for a store
CREATE OR REPLACE FUNCTION public.get_store_riders_first_dates(p_store_id UUID)
RETURNS TABLE (
  rider_name TEXT,
  first_active_date DATE,
  last_active_date DATE,
  total_active_days BIGINT,
  total_orders BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.rider_name,
    MIN(r.order_date)::DATE AS first_active_date,
    MAX(r.order_date)::DATE AS last_active_date,
    COUNT(DISTINCT r.order_date) AS total_active_days,
    COUNT(r.order_id) AS total_orders
  FROM public.orders r
  WHERE r.store_id = p_store_id
    AND r.rider_name IS NOT NULL
    AND TRIM(r.rider_name) <> ''
  GROUP BY r.rider_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_store_riders_first_dates(UUID) TO authenticated, service_role;

COMMIT;
