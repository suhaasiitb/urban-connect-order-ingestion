-- ==============================================================================
-- Migration: Add LM Distance (converted to kilometers / meters) to get_rider_daily_performance RPC
-- Aggregates distance_meters (from LM Distance) along with hours and orders per rider/date
-- ==============================================================================

DROP FUNCTION IF EXISTS public.get_rider_daily_performance(UUID, DATE, DATE);

CREATE OR REPLACE FUNCTION public.get_rider_daily_performance(
  p_store_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  rider_name TEXT,
  order_date DATE,
  hours BIGINT,
  orders BIGINT,
  distance_meters BIGINT
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
    COUNT(o.order_id) AS orders,
    COALESCE(SUM(COALESCE(o.distance_meters, o.lm_distance, 0)), 0)::BIGINT AS distance_meters
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

COMMENT ON FUNCTION public.get_rider_daily_performance(UUID, DATE, DATE) IS
  'Aggregates rider daily unique slot hours, order counts, and total LM distance in meters (for km conversion) within a date range for a store.';

REVOKE ALL ON FUNCTION public.get_rider_daily_performance(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rider_daily_performance(UUID, DATE, DATE) TO authenticated, service_role;
