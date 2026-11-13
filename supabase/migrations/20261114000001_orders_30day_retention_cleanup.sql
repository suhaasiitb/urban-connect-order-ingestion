-- ==============================================================================
-- Migration: 20261114000001_orders_30day_retention_cleanup.sql
-- Purpose:   Enforce a rolling 30-day retention policy on public.orders (and
--            stale ingestion_batches) to keep database usage within the
--            Supabase Free Plan limits.
-- ==============================================================================

BEGIN;

-- 1. Index on order_date to make 30-day retention deletes fast
CREATE INDEX IF NOT EXISTS idx_orders_order_date
  ON public.orders (order_date);

-- 2. Reusable cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_old_orders(
  p_retention_days INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff_date DATE;
  v_deleted_orders BIGINT := 0;
  v_deleted_batches BIGINT := 0;
BEGIN
  IF p_retention_days IS NULL OR p_retention_days < 1 THEN
    RAISE EXCEPTION 'p_retention_days must be >= 1';
  END IF;

  v_cutoff_date := (CURRENT_DATE - p_retention_days);

  DELETE FROM public.orders
  WHERE order_date < v_cutoff_date;
  GET DIAGNOSTICS v_deleted_orders = ROW_COUNT;

  DELETE FROM public.ingestion_batches
  WHERE max_order_date IS NOT NULL
    AND max_order_date < v_cutoff_date;
  GET DIAGNOSTICS v_deleted_batches = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff_date', v_cutoff_date,
    'deleted_orders', v_deleted_orders,
    'deleted_batches', v_deleted_batches
  );
END;
$$;

COMMENT ON FUNCTION public.cleanup_old_orders(INTEGER) IS
  'Deletes orders and completed ingestion_batches older than p_retention_days (default 30 days) to stay within free-plan storage.';

REVOKE ALL ON FUNCTION public.cleanup_old_orders(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_orders(INTEGER) TO authenticated, service_role;

-- 3. Immediately prune existing data older than 30 days
SELECT public.cleanup_old_orders(30);

-- 4. Schedule daily automatic cleanup at 03:00 UTC if pg_cron is available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('cleanup_old_orders_30d')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'cleanup_old_orders_30d'
    );

    PERFORM cron.schedule(
      'cleanup_old_orders_30d',
      '0 3 * * *',
      $cron$SELECT public.cleanup_old_orders(30);$cron$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Ignore if pg_cron is not enabled on the current Supabase plan
    NULL;
END $$;

COMMIT;
