-- ==============================================================================
-- Migration: Add DSR RCA tracking for RTO_DELIVERED orders on public.orders
-- Stores per-order DSR RCA reasons alongside the rolling 30-day orders retention.
-- Ingest batch upserts preserve these columns across subsequent re-uploads.
-- ==============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS dsr_rca TEXT NULL,
  ADD COLUMN IF NOT EXISTS dsr_rca_updated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS dsr_rca_updated_by UUID NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS chk_orders_dsr_rca_valid;

ALTER TABLE public.orders
  ADD CONSTRAINT chk_orders_dsr_rca_valid
  CHECK (
    dsr_rca IS NULL OR dsr_rca IN (
      'Wrong Location',
      'Customer Unavailable',
      'Customer Rejected',
      'Vehicle Issue',
      'Product Missing',
      'Customer Unreachable/Not Responding'
    )
  );

CREATE INDEX IF NOT EXISTS idx_orders_store_dsr_rto_rca
  ON public.orders (store_id, order_date)
  WHERE UPPER(TRIM(status)) = 'RTO_DELIVERED';

COMMENT ON COLUMN public.orders.dsr_rca IS
  'Root Cause Analysis (RCA) category submitted for RTO_DELIVERED orders affecting DSR (< 100%); retained for 30 days with the order record.';

CREATE OR REPLACE FUNCTION public.save_dsr_rcas(
  p_store_id UUID,
  p_updates JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_order_id TEXT;
  v_rca TEXT;
  v_updated INTEGER := 0;
  v_row_count INTEGER := 0;
BEGIN
  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'p_store_id is required';
  END IF;

  IF NOT public.has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'Access denied for store %', p_store_id;
  END IF;

  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_updates)
  LOOP
    v_order_id := NULLIF(TRIM(v_item->>'order_id'), '');
    v_rca := NULLIF(TRIM(v_item->>'rca'), '');

    IF v_order_id IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.orders
    SET
      dsr_rca = v_rca,
      dsr_rca_updated_at = now(),
      dsr_rca_updated_by = auth.uid()
    WHERE store_id = p_store_id
      AND order_id = v_order_id;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_updated := v_updated + v_row_count;
  END LOOP;

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.save_dsr_rcas(UUID, JSONB) IS
  'Safely updates dsr_rca for one or more RTO_DELIVERED orders in a store after verifying store access.';

REVOKE ALL ON FUNCTION public.save_dsr_rcas(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_dsr_rcas(UUID, JSONB) TO authenticated, service_role;
