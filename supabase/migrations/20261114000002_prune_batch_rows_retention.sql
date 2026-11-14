-- Extend daily cleanup_old_orders(30) to also prune bulky ingestion_batch_rows
-- (retaining 7 days of inserted/updated/rejected audit rows and 1 day of unchanged rows)
-- so the database stays comfortably within the Supabase Free Plan 500 MB limit.

CREATE INDEX IF NOT EXISTS idx_ingestion_batch_rows_processed_at
  ON public.ingestion_batch_rows (processed_at);

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
  v_deleted_batch_rows BIGINT := 0;
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

  DELETE FROM public.ingestion_batch_rows
  WHERE processed_at < NOW() - INTERVAL '7 days'
     OR (action = 'unchanged' AND processed_at < NOW() - INTERVAL '1 day');
  GET DIAGNOSTICS v_deleted_batch_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff_date', v_cutoff_date,
    'deleted_orders', v_deleted_orders,
    'deleted_batches', v_deleted_batches,
    'deleted_batch_rows', v_deleted_batch_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_orders(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_orders(INTEGER) TO service_role;

-- Run immediately to prune existing old/unchanged batch rows
SELECT public.cleanup_old_orders(30);
