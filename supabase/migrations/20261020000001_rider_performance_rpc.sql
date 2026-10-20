-- ==============================================================================
-- Migration: 20261020000001_rider_performance_rpc.sql
-- Purpose:   Server-side aggregated RPC for Rider Daily Hours & Orders pivot.
--            Summarizes slot_hour via COUNT(DISTINCT slot_hour) and order_id via COUNT(*).
-- ==============================================================================

BEGIN;

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
    TRIM(o.rider_name) AS rider_name,
    o.order_date,
    COUNT(DISTINCT o.slot_hour) AS hours,
    COUNT(o.order_id) AS orders
  FROM public.orders o
  WHERE o.store_id = p_store_id
    AND o.order_date >= p_start_date
    AND o.order_date <= p_end_date
    AND o.rider_name IS NOT NULL
    AND TRIM(o.rider_name) <> ''
    AND TRIM(o.rider_name) <> '-'
  GROUP BY TRIM(o.rider_name), o.order_date
  ORDER BY TRIM(o.rider_name) ASC, o.order_date ASC;
$$;

COMMENT ON FUNCTION public.get_rider_daily_performance(UUID, DATE, DATE) IS
  'Returns aggregated daily hours (COUNTUNIQUE slot_hour) and orders (COUNTA order_id) grouped by rider and date for a store.';

REVOKE ALL ON FUNCTION public.get_rider_daily_performance(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rider_daily_performance(UUID, DATE, DATE) TO authenticated, service_role;

COMMIT;
