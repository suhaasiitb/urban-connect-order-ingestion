-- ==============================================================================
-- Migration: 20261103000001_clean_rider_name_asterisks.sql
-- Purpose:   Strip trailing/embedded asterisks (*) from rider names so riders
--            like 'ABHAY GORE' and 'ABHAY GORE*' are merged into a single
--            canonical rider row in performance pivot and onboarding RPCs.
-- ==============================================================================

BEGIN;

-- 1. Clean existing order records containing asterisks in rider_name
UPDATE public.orders
SET rider_name = TRIM(REGEXP_REPLACE(rider_name, '\*+', '', 'g'))
WHERE rider_name LIKE '%*%';

-- 2. Update get_rider_daily_performance RPC to strip asterisks and group by normalized rider name
CREATE OR REPLACE FUNCTION public.get_rider_daily_performance(
  p_store_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  rider_name TEXT,
  order_date DATE,
  hours BIGINT,
  orders BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    MIN(TRIM(REGEXP_REPLACE(o.rider_name, '\*+', '', 'g'))) AS rider_name,
    o.order_date,
    COUNT(DISTINCT o.slot_hour) AS hours,
    COUNT(o.order_id) AS orders
  FROM public.orders o
  WHERE o.store_id = p_store_id
    AND public.has_store_access(p_store_id)
    AND o.order_date >= p_start_date
    AND o.order_date <= p_end_date
    AND o.rider_name IS NOT NULL
    AND TRIM(REGEXP_REPLACE(o.rider_name, '\*+', '', 'g')) <> ''
    AND TRIM(REGEXP_REPLACE(o.rider_name, '\*+', '', 'g')) <> '-'
  GROUP BY LOWER(TRIM(REGEXP_REPLACE(o.rider_name, '\*+', '', 'g'))), o.order_date
  ORDER BY MIN(TRIM(REGEXP_REPLACE(o.rider_name, '\*+', '', 'g'))) ASC, o.order_date ASC;
$$;

-- 3. Update get_store_riders_first_dates RPC to strip asterisks and group by normalized rider name
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
    MIN(TRIM(REGEXP_REPLACE(r.rider_name, '\*+', '', 'g'))) AS rider_name,
    MIN(r.order_date)::DATE AS first_active_date,
    MAX(r.order_date)::DATE AS last_active_date,
    COUNT(DISTINCT r.order_date) AS total_active_days,
    COUNT(r.order_id) AS total_orders
  FROM public.orders r
  WHERE r.store_id = p_store_id
    AND public.has_store_access(p_store_id)
    AND r.rider_name IS NOT NULL
    AND TRIM(REGEXP_REPLACE(r.rider_name, '\*+', '', 'g')) <> ''
  GROUP BY LOWER(TRIM(REGEXP_REPLACE(r.rider_name, '\*+', '', 'g')));
$$;

REVOKE ALL ON FUNCTION public.get_rider_daily_performance(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rider_daily_performance(UUID, DATE, DATE) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_store_riders_first_dates(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_riders_first_dates(UUID) TO authenticated, service_role;

COMMIT;
