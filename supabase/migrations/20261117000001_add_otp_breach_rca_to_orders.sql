-- ==============================================================================
-- Migration: Add OTP+3 Breach RCA tracking directly on public.orders
-- Stores per-order RCA reasons alongside the rolling 30-day orders retention.
-- Ingest batch upserts preserve these columns across subsequent re-uploads.
-- ==============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS otp_breach_rca TEXT NULL,
  ADD COLUMN IF NOT EXISTS otp_breach_rca_updated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS otp_breach_rca_updated_by UUID NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS chk_orders_otp_breach_rca_valid;

ALTER TABLE public.orders
  ADD CONSTRAINT chk_orders_otp_breach_rca_valid
  CHECK (
    otp_breach_rca IS NULL OR otp_breach_rca IN (
      'New Rider- Under Training',
      'Traffic Issue',
      'Bike Issue',
      'FC Delay',
      'Mobile/App Issue',
      'Behavioural Issue - Warned the Rider'
    )
  );

CREATE INDEX IF NOT EXISTS idx_orders_store_otp_breach_rca
  ON public.orders (store_id, order_date)
  WHERE otp_plus_3_performance = 'OTP Breached';

COMMENT ON COLUMN public.orders.otp_breach_rca IS
  'Root Cause Analysis (RCA) category submitted for OTP+3 breached orders; retained for 30 days with the order record.';

CREATE OR REPLACE FUNCTION public.save_otp_breach_rcas(
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
      otp_breach_rca = v_rca,
      otp_breach_rca_updated_at = now(),
      otp_breach_rca_updated_by = auth.uid()
    WHERE store_id = p_store_id
      AND order_id = v_order_id;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_updated := v_updated + v_row_count;
  END LOOP;

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.save_otp_breach_rcas(UUID, JSONB) IS
  'Safely updates otp_breach_rca for one or more orders in a store after verifying store access.';

REVOKE ALL ON FUNCTION public.save_otp_breach_rcas(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_otp_breach_rcas(UUID, JSONB) TO authenticated, service_role;
