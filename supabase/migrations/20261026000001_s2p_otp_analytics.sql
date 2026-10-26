-- ==============================================================================
-- Migration: 20261026000001_s2p_otp_analytics.sql
-- Purpose:   Server-side aggregation for S2P, OTP+3 & DPH metrics grouped
--            by (order_date, slot_hour) for high-speed drill-down analytics.
-- ==============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_s2p_otp_slot_metrics(UUID, DATE, DATE);

CREATE OR REPLACE FUNCTION public.get_s2p_otp_slot_metrics(
  p_store_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  order_date DATE,
  slot_hour SMALLINT,
  orders_count BIGINT,
  riders_count BIGINT,
  s2p_sum NUMERIC,
  s2p_count BIGINT,
  otp_achieved_count BIGINT,
  otp_breached_count BIGINT,
  day_distinct_riders BIGINT,
  period_distinct_riders BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH slot_agg AS (
    SELECT
      o.order_date,
      o.slot_hour,
      COUNT(o.order_id)::BIGINT AS orders_count,
      COUNT(DISTINCT o.rider_number)::BIGINT AS riders_count,
      COALESCE(SUM(o.s2p_minutes), 0)::NUMERIC AS s2p_sum,
      COUNT(o.s2p_minutes)::BIGINT AS s2p_count,
      COUNT(*) FILTER (WHERE o.otp_plus_3_performance = 'OTP Achieved')::BIGINT AS otp_achieved_count,
      COUNT(*) FILTER (WHERE o.otp_plus_3_performance = 'OTP Breached')::BIGINT AS otp_breached_count
    FROM public.orders o
    WHERE o.store_id = p_store_id
      AND public.has_store_access(p_store_id)
      AND o.order_date >= p_start_date
      AND o.order_date <= p_end_date
    GROUP BY o.order_date, o.slot_hour
  ),
  day_riders AS (
    SELECT
      o.order_date,
      COUNT(DISTINCT o.rider_number)::BIGINT AS day_distinct_riders
    FROM public.orders o
    WHERE o.store_id = p_store_id
      AND public.has_store_access(p_store_id)
      AND o.order_date >= p_start_date
      AND o.order_date <= p_end_date
    GROUP BY o.order_date
  ),
  period_riders AS (
    SELECT
      COUNT(DISTINCT o.rider_number)::BIGINT AS period_distinct_riders
    FROM public.orders o
    WHERE o.store_id = p_store_id
      AND public.has_store_access(p_store_id)
      AND o.order_date >= p_start_date
      AND o.order_date <= p_end_date
  )
  SELECT
    s.order_date,
    s.slot_hour,
    s.orders_count,
    s.riders_count,
    s.s2p_sum,
    s.s2p_count,
    s.otp_achieved_count,
    s.otp_breached_count,
    COALESCE(d.day_distinct_riders, 0)::BIGINT AS day_distinct_riders,
    COALESCE(p.period_distinct_riders, 0)::BIGINT AS period_distinct_riders
  FROM slot_agg s
  JOIN day_riders d ON d.order_date = s.order_date
  CROSS JOIN period_riders p
  ORDER BY s.order_date DESC, s.slot_hour ASC;
$$;

COMMENT ON FUNCTION public.get_s2p_otp_slot_metrics(UUID, DATE, DATE) IS
  'Aggregates orders, distinct riders, S2P duration, and OTP+3 compliance per slot for a store and date range with day and period distinct rider totals.';

REVOKE ALL ON FUNCTION public.get_s2p_otp_slot_metrics(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_s2p_otp_slot_metrics(UUID, DATE, DATE) TO authenticated, service_role;

COMMIT;
