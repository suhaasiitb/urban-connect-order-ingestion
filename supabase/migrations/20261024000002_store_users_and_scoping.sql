-- ==============================================================================
-- Migration: 20261024000002_store_users_and_scoping.sql
-- Purpose:   Store-level authentication, scoping, and authorization:
--            1. Create public.store_users mapping auth.users to specific stores.
--            2. Add helper functions get_user_assigned_store_id() and has_store_access().
--            3. Update RLS policies across stores, orders, ingestion_batches,
--               ingestion_batch_rows, order_revision_history, store_active_riders,
--               store_rider_roster_uploads, and store_rider_shifts.
--            4. Update ingest_order_batch RPC to authorize active store users
--               for their assigned store while preserving full admin access.
--            5. Secure get_rider_daily_performance and get_store_riders_first_dates RPCs.
--            6. Add register_store_user helper RPC for provisioning store logins.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Table: public.store_users
--    Maps individual users from auth.users to a single assigned store in public.stores.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.store_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE CHECK (char_length(trim(email)) > 3),
  full_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.store_users IS
  'Store-specific operators permitted to ingest orders and view analytics exclusively for their assigned store.';

CREATE INDEX IF NOT EXISTS idx_store_users_store_id ON public.store_users(store_id);

DROP TRIGGER IF EXISTS trg_store_users_updated_at ON public.store_users;
CREATE TRIGGER trg_store_users_updated_at
  BEFORE UPDATE ON public.store_users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 2. Security Helper Functions
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_assigned_store_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT store_id
  FROM public.store_users
  WHERE user_id = auth.uid()
    AND is_active = true
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_user_assigned_store_id() IS
  'Returns the store_id assigned to the current authenticated user if they are an active store operator.';

CREATE OR REPLACE FUNCTION public.has_store_access(p_store_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    public.is_active_admin()
    OR EXISTS (
      SELECT 1
      FROM public.store_users
      WHERE user_id = auth.uid()
        AND store_id = p_store_id
        AND is_active = true
    )
  );
$$;

COMMENT ON FUNCTION public.has_store_access(UUID) IS
  'Returns true if the current authenticated user is an active administrator or an active store operator for the specified store.';

REVOKE ALL ON FUNCTION public.get_user_assigned_store_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_assigned_store_id() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.has_store_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_store_access(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. Grants & RLS for public.store_users
-- ------------------------------------------------------------------------------
ALTER TABLE public.store_users ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.store_users FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_users TO authenticated, service_role;

DROP POLICY IF EXISTS store_users_select_policy ON public.store_users;
CREATE POLICY store_users_select_policy
  ON public.store_users
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_active_admin());

DROP POLICY IF EXISTS store_users_modify_policy ON public.store_users;
CREATE POLICY store_users_modify_policy
  ON public.store_users
  FOR ALL
  TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

-- ------------------------------------------------------------------------------
-- 4. Scoped RLS Policies across Store Tables
-- ------------------------------------------------------------------------------

-- A. public.stores
-- Admins see all stores; store users see only their assigned store.
DROP POLICY IF EXISTS stores_select_active_admin ON public.stores;
DROP POLICY IF EXISTS stores_select_admin_or_store_user ON public.stores;
CREATE POLICY stores_select_admin_or_store_user
  ON public.stores
  FOR SELECT
  TO authenticated
  USING (public.is_active_admin() OR id = public.get_user_assigned_store_id());

-- B. public.orders
DROP POLICY IF EXISTS orders_select_active_admin ON public.orders;
DROP POLICY IF EXISTS orders_select_admin_or_store_user ON public.orders;
CREATE POLICY orders_select_admin_or_store_user
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (public.is_active_admin() OR store_id = public.get_user_assigned_store_id());

-- C. public.ingestion_batches
DROP POLICY IF EXISTS ingestion_batches_select_active_admin ON public.ingestion_batches;
DROP POLICY IF EXISTS ingestion_batches_select_admin_or_store_user ON public.ingestion_batches;
CREATE POLICY ingestion_batches_select_admin_or_store_user
  ON public.ingestion_batches
  FOR SELECT
  TO authenticated
  USING (public.is_active_admin() OR store_id = public.get_user_assigned_store_id());

-- D. public.ingestion_batch_rows
DROP POLICY IF EXISTS ingestion_batch_rows_select_active_admin ON public.ingestion_batch_rows;
DROP POLICY IF EXISTS ingestion_batch_rows_select_admin_or_store_user ON public.ingestion_batch_rows;
CREATE POLICY ingestion_batch_rows_select_admin_or_store_user
  ON public.ingestion_batch_rows
  FOR SELECT
  TO authenticated
  USING (public.is_active_admin() OR store_id = public.get_user_assigned_store_id());

-- E. public.order_revision_history
DROP POLICY IF EXISTS order_revision_history_select_active_admin ON public.order_revision_history;
DROP POLICY IF EXISTS order_revision_history_select_admin_or_store_user ON public.order_revision_history;
CREATE POLICY order_revision_history_select_admin_or_store_user
  ON public.order_revision_history
  FOR SELECT
  TO authenticated
  USING (public.is_active_admin() OR store_id = public.get_user_assigned_store_id());

-- F. public.store_active_riders
CREATE TABLE IF NOT EXISTS public.store_active_riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  rider_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  phone TEXT,
  online_status TEXT,
  eligibility TEXT,
  attendance TEXT,
  source_store_code TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_store_active_rider UNIQUE (store_id, normalized_name)
);
ALTER TABLE public.store_active_riders ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_active_riders TO authenticated, service_role;

DROP POLICY IF EXISTS "Allow authenticated select store_active_riders" ON public.store_active_riders;
DROP POLICY IF EXISTS "Allow authenticated modify store_active_riders" ON public.store_active_riders;
DROP POLICY IF EXISTS "store_active_riders_select_policy" ON public.store_active_riders;
DROP POLICY IF EXISTS "store_active_riders_modify_policy" ON public.store_active_riders;
CREATE POLICY "store_active_riders_select_policy"
  ON public.store_active_riders FOR SELECT
  TO authenticated
  USING (public.is_active_admin() OR store_id = public.get_user_assigned_store_id());
CREATE POLICY "store_active_riders_modify_policy"
  ON public.store_active_riders FOR ALL
  TO authenticated
  USING (public.is_active_admin() OR store_id = public.get_user_assigned_store_id())
  WITH CHECK (public.is_active_admin() OR store_id = public.get_user_assigned_store_id());

-- G. public.store_rider_roster_uploads
CREATE TABLE IF NOT EXISTS public.store_rider_roster_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  total_riders INTEGER NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by TEXT
);
ALTER TABLE public.store_rider_roster_uploads ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_rider_roster_uploads TO authenticated, service_role;

DROP POLICY IF EXISTS "Allow authenticated select store_rider_roster_uploads" ON public.store_rider_roster_uploads;
DROP POLICY IF EXISTS "Allow authenticated modify store_rider_roster_uploads" ON public.store_rider_roster_uploads;
DROP POLICY IF EXISTS "store_rider_roster_uploads_select_policy" ON public.store_rider_roster_uploads;
DROP POLICY IF EXISTS "store_rider_roster_uploads_modify_policy" ON public.store_rider_roster_uploads;
CREATE POLICY "store_rider_roster_uploads_select_policy"
  ON public.store_rider_roster_uploads FOR SELECT
  TO authenticated
  USING (public.is_active_admin() OR store_id = public.get_user_assigned_store_id());
CREATE POLICY "store_rider_roster_uploads_modify_policy"
  ON public.store_rider_roster_uploads FOR ALL
  TO authenticated
  USING (public.is_active_admin() OR store_id = public.get_user_assigned_store_id())
  WITH CHECK (public.is_active_admin() OR store_id = public.get_user_assigned_store_id());

-- H. public.store_rider_shifts
CREATE TABLE IF NOT EXISTS public.store_rider_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  rider_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  shift_type TEXT NOT NULL DEFAULT 'Morning Shift',
  slot1_start_hour INTEGER NOT NULL DEFAULT 6 CHECK (slot1_start_hour >= 0 AND slot1_start_hour <= 23),
  slot1_end_hour INTEGER NOT NULL DEFAULT 14 CHECK (slot1_end_hour >= 0 AND slot1_end_hour <= 24),
  slot2_start_hour INTEGER CHECK (slot2_start_hour >= 0 AND slot2_start_hour <= 23),
  slot2_end_hour INTEGER CHECK (slot2_end_hour >= 0 AND slot2_end_hour <= 24),
  total_planned_hours NUMERIC(4, 1) NOT NULL DEFAULT 8.0,
  joining_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_store_rider_shift UNIQUE (store_id, normalized_name)
);
ALTER TABLE public.store_rider_shifts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_rider_shifts TO authenticated, service_role;

DROP POLICY IF EXISTS "authenticated_store_rider_shifts_select" ON public.store_rider_shifts;
DROP POLICY IF EXISTS "authenticated_store_rider_shifts_all" ON public.store_rider_shifts;
DROP POLICY IF EXISTS "store_rider_shifts_select_policy" ON public.store_rider_shifts;
DROP POLICY IF EXISTS "store_rider_shifts_modify_policy" ON public.store_rider_shifts;
CREATE POLICY "store_rider_shifts_select_policy"
  ON public.store_rider_shifts FOR SELECT
  TO authenticated
  USING (public.is_active_admin() OR store_id = public.get_user_assigned_store_id());
CREATE POLICY "store_rider_shifts_modify_policy"
  ON public.store_rider_shifts FOR ALL
  TO authenticated
  USING (public.is_active_admin() OR store_id = public.get_user_assigned_store_id())
  WITH CHECK (public.is_active_admin() OR store_id = public.get_user_assigned_store_id());

-- ------------------------------------------------------------------------------
-- 5. Update RPC ingest_order_batch Authorization
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ingest_order_batch(
  p_store_id UUID,
  p_uploaded_by UUID,
  p_original_filename TEXT,
  p_file_checksum_sha256 TEXT,
  p_records JSONB,
  p_force_reprocess BOOLEAN DEFAULT false,
  p_processing_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_store RECORD;
  v_prior_batch RECORD;
  v_batch_id UUID;
  v_total_rows INTEGER;
  v_inserted_count INTEGER := 0;
  v_updated_count INTEGER := 0;
  v_unchanged_count INTEGER := 0;
  v_min_date DATE := NULL;
  v_max_date DATE := NULL;
  v_rec JSONB;
  v_norm JSONB;
  v_derived JSONB;
  v_raw JSONB;
  v_row_num INTEGER;
  v_row_hash TEXT;
  v_order_id TEXT;
  v_order_date DATE;
  v_existing public.orders%ROWTYPE;
  v_previous_source JSONB;
  v_previous_derived JSONB;
  v_changed_fields JSONB;
  v_key TEXT;
BEGIN
  -- 1. Verify administrator or assigned store user authorization
  SELECT is_active INTO v_is_admin
  FROM public.admin_users
  WHERE user_id = p_uploaded_by AND is_active = true;

  IF NOT COALESCE(v_is_admin, false) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.store_users
      WHERE user_id = p_uploaded_by
        AND store_id = p_store_id
        AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Unauthorized: user % is not authorized to ingest orders for store %.', p_uploaded_by, p_store_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Verify active store exists
  SELECT * INTO v_store
  FROM public.stores
  WHERE id = p_store_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or inactive store_id: %', p_store_id
      USING ERRCODE = '22023';
  END IF;

  -- 3. Validate payload structure
  IF p_records IS NULL OR jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) = 0 THEN
    RAISE EXCEPTION 'p_records must be a non-empty JSONB array.'
      USING ERRCODE = '22023';
  END IF;

  v_total_rows := jsonb_array_length(p_records);

  -- 4. Serialize concurrent uploads for the same store + file checksum
  PERFORM pg_advisory_xact_lock(hashtext(p_store_id::text || ':' || p_file_checksum_sha256));

  -- 5. File-level idempotency check: has this exact file checksum already succeeded for this store?
  SELECT id, started_at, completed_at, min_order_date, max_order_date,
         total_rows, inserted_count, updated_count, unchanged_count
  INTO v_prior_batch
  FROM public.ingestion_batches
  WHERE store_id = p_store_id
    AND file_checksum_sha256 = p_file_checksum_sha256
    AND status = 'Succeeded'
  ORDER BY completed_at DESC NULLS LAST, started_at DESC
  LIMIT 1;

  IF FOUND AND NOT COALESCE(p_force_reprocess, false) THEN
    INSERT INTO public.ingestion_batches (
      store_id,
      original_filename,
      file_checksum_sha256,
      uploaded_by,
      status,
      min_order_date,
      max_order_date,
      total_rows,
      inserted_count,
      updated_count,
      unchanged_count,
      rejected_count,
      failed_count,
      prior_batch_id,
      processing_metadata,
      started_at,
      completed_at
    ) VALUES (
      p_store_id,
      p_original_filename,
      p_file_checksum_sha256,
      p_uploaded_by,
      'Duplicate Skipped',
      v_prior_batch.min_order_date,
      v_prior_batch.max_order_date,
      v_total_rows,
      0,
      0,
      v_total_rows,
      0,
      0,
      v_prior_batch.id,
      p_processing_metadata || jsonb_build_object('duplicate_of_batch_id', v_prior_batch.id),
      now(),
      now()
    )
    RETURNING id INTO v_batch_id;

    RETURN jsonb_build_object(
      'batch_id', v_batch_id,
      'prior_batch_id', v_prior_batch.id,
      'already_processed', true,
      'status', 'Duplicate Skipped',
      'store_id', p_store_id,
      'store_code', v_store.store_code,
      'min_order_date', v_prior_batch.min_order_date,
      'max_order_date', v_prior_batch.max_order_date,
      'total_rows', v_total_rows,
      'inserted_count', 0,
      'updated_count', 0,
      'unchanged_count', v_total_rows,
      'rejected_count', 0,
      'failed_count', 0
    );
  END IF;

  -- 6. Create the active ingestion batch record in 'Processing' state
  INSERT INTO public.ingestion_batches (
    store_id,
    original_filename,
    file_checksum_sha256,
    uploaded_by,
    status,
    total_rows,
    prior_batch_id,
    processing_metadata,
    started_at
  ) VALUES (
    p_store_id,
    p_original_filename,
    p_file_checksum_sha256,
    p_uploaded_by,
    'Processing',
    v_total_rows,
    v_prior_batch.id,
    p_processing_metadata,
    now()
  )
  RETURNING id INTO v_batch_id;

  -- 7. Process each normalized + transformed record atomically
  FOR v_rec IN SELECT * FROM jsonb_array_elements(p_records)
  LOOP
    v_row_num := (v_rec->>'source_row_number')::INTEGER;
    v_row_hash := v_rec->>'source_row_hash';
    v_raw := COALESCE(v_rec->'raw_source_snapshot', '{}'::jsonb);
    v_norm := v_rec->'normalized_source';
    v_derived := v_rec->'derived_fields';

    v_order_id := v_norm->>'order_id';
    v_order_date := (v_derived->>'order_date')::DATE;

    IF v_min_date IS NULL OR v_order_date < v_min_date THEN
      v_min_date := v_order_date;
    END IF;
    IF v_max_date IS NULL OR v_order_date > v_max_date THEN
      v_max_date := v_order_date;
    END IF;

    -- Lock canonical order row if it already exists
    SELECT * INTO v_existing
    FROM public.orders
    WHERE store_id = p_store_id
      AND order_id = v_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      -- CASE A: New Order -> INSERT
      INSERT INTO public.orders (
        store_id,
        rider_number,
        arrived_pickup_at,
        lm_distance,
        resting_point_name,
        total_eta,
        completed_at,
        resting_point_id,
        source_store_name,
        pickup_at,
        order_eta_status,
        staged_at,
        pickup_eta,
        arrive_at_pickup_eta,
        status_text,
        order_created_at,
        status,
        rider_name,
        order_id,
        external_store_id,
        total_time,
        arrive_at_delivery_eta,
        arrived_delivery_at,
        tracking_url,
        customer_id,
        rto_at,
        fm_distance,
        assigned_at,
        delivery_eta,
        source_batch_id,
        order_type,
        store_code,
        slot_hour,
        order_date,
        staging_to_pickup_minutes,
        s2p_minutes,
        distance_meters,
        actual_arrival_minutes,
        arrival_eta_minutes,
        otp_performance,
        otp_plus_3_performance,
        source_row_hash,
        raw_source_snapshot,
        last_ingestion_batch_id,
        created_at,
        updated_at
      ) VALUES (
        p_store_id,
        v_norm->>'rider_number',
        (v_norm->>'arrived_pickup_at')::TIMESTAMPTZ,
        (v_norm->>'lm_distance')::INTEGER,
        v_norm->>'resting_point_name',
        (v_norm->>'total_eta')::NUMERIC(10,2),
        (v_norm->>'completed_at')::TIMESTAMPTZ,
        v_norm->>'resting_point_id',
        v_norm->>'source_store_name',
        (v_norm->>'pickup_at')::TIMESTAMPTZ,
        v_norm->>'order_eta_status',
        (v_norm->>'staged_at')::TIMESTAMPTZ,
        (v_norm->>'pickup_eta')::NUMERIC(10,2),
        (v_norm->>'arrive_at_pickup_eta')::TIMESTAMPTZ,
        v_norm->>'status_text',
        (v_norm->>'order_created_at')::TIMESTAMPTZ,
        v_norm->>'status',
        v_norm->>'rider_name',
        v_order_id,
        v_norm->>'external_store_id',
        (v_norm->>'total_time')::NUMERIC(10,2),
        (v_norm->>'arrive_at_delivery_eta')::TIMESTAMPTZ,
        (v_norm->>'arrived_delivery_at')::TIMESTAMPTZ,
        v_norm->>'tracking_url',
        v_norm->>'customer_id',
        (v_norm->>'rto_at')::TIMESTAMPTZ,
        (v_norm->>'fm_distance')::NUMERIC(10,2),
        (v_norm->>'assigned_at')::TIME,
        (v_norm->>'delivery_eta')::NUMERIC(10,2),
        v_norm->>'source_batch_id',
        v_derived->>'order_type',
        v_derived->>'store_code',
        (v_derived->>'slot_hour')::SMALLINT,
        v_order_date,
        (v_derived->>'staging_to_pickup_minutes')::NUMERIC(10,4),
        (v_derived->>'s2p_minutes')::NUMERIC(10,4),
        (v_derived->>'distance_meters')::INTEGER,
        (v_derived->>'actual_arrival_minutes')::NUMERIC(10,4),
        (v_derived->>'arrival_eta_minutes')::NUMERIC(10,4),
        v_derived->>'otp_performance',
        v_derived->>'otp_plus_3_performance',
        v_row_hash,
        v_raw,
        v_batch_id,
        now(),
        now()
      );

      INSERT INTO public.ingestion_batch_rows (
        batch_id,
        source_row_number,
        store_id,
        order_id,
        action,
        row_hash,
        validation_errors,
        source_snapshot
      ) VALUES (
        v_batch_id,
        v_row_num,
        p_store_id,
        v_order_id,
        'inserted',
        v_row_hash,
        '[]'::jsonb,
        v_raw
      );

      v_inserted_count := v_inserted_count + 1;

    ELSIF v_existing.source_row_hash = v_row_hash THEN
      -- CASE B: Existing Order with Identical Normalized Source -> UNCHANGED
      -- Leave public.orders (and orders.updated_at) completely untouched.
      INSERT INTO public.ingestion_batch_rows (
        batch_id,
        source_row_number,
        store_id,
        order_id,
        action,
        row_hash,
        validation_errors,
        source_snapshot
      ) VALUES (
        v_batch_id,
        v_row_num,
        p_store_id,
        v_order_id,
        'unchanged',
        v_row_hash,
        '[]'::jsonb,
        v_raw
      );

      v_unchanged_count := v_unchanged_count + 1;

    ELSE
      -- CASE C: Existing Order with Changed Normalized Source -> UPDATE + REVISION
      v_previous_source := jsonb_build_object(
        'rider_number', v_existing.rider_number,
        'arrived_pickup_at', v_existing.arrived_pickup_at,
        'lm_distance', v_existing.lm_distance,
        'resting_point_name', v_existing.resting_point_name,
        'total_eta', v_existing.total_eta,
        'completed_at', v_existing.completed_at,
        'resting_point_id', v_existing.resting_point_id,
        'source_store_name', v_existing.source_store_name,
        'pickup_at', v_existing.pickup_at,
        'order_eta_status', v_existing.order_eta_status,
        'staged_at', v_existing.staged_at,
        'pickup_eta', v_existing.pickup_eta,
        'arrive_at_pickup_eta', v_existing.arrive_at_pickup_eta,
        'status_text', v_existing.status_text,
        'order_created_at', v_existing.order_created_at,
        'status', v_existing.status,
        'rider_name', v_existing.rider_name,
        'order_id', v_existing.order_id,
        'external_store_id', v_existing.external_store_id,
        'total_time', v_existing.total_time,
        'arrive_at_delivery_eta', v_existing.arrive_at_delivery_eta,
        'arrived_delivery_at', v_existing.arrived_delivery_at,
        'tracking_url', v_existing.tracking_url,
        'customer_id', v_existing.customer_id,
        'rto_at', v_existing.rto_at,
        'fm_distance', v_existing.fm_distance,
        'assigned_at', v_existing.assigned_at,
        'delivery_eta', v_existing.delivery_eta,
        'source_batch_id', v_existing.source_batch_id
      );

      v_previous_derived := jsonb_build_object(
        'order_type', v_existing.order_type,
        'store_code', v_existing.store_code,
        'slot_hour', v_existing.slot_hour,
        'order_date', v_existing.order_date,
        'staging_to_pickup_minutes', v_existing.staging_to_pickup_minutes,
        's2p_minutes', v_existing.s2p_minutes,
        'distance_meters', v_existing.distance_meters,
        'actual_arrival_minutes', v_existing.actual_arrival_minutes,
        'arrival_eta_minutes', v_existing.arrival_eta_minutes,
        'otp_performance', v_existing.otp_performance,
        'otp_plus_3_performance', v_existing.otp_plus_3_performance
      );

      -- Compute field-by-field diff for changed_fields audit summary
      v_changed_fields := '{}'::jsonb;
      FOR v_key IN SELECT jsonb_object_keys(v_norm)
      LOOP
        IF (v_previous_source->v_key) IS DISTINCT FROM (v_norm->v_key) THEN
          v_changed_fields := v_changed_fields || jsonb_build_object(
            v_key,
            jsonb_build_object(
              'before', v_previous_source->v_key,
              'after', v_norm->v_key
            )
          );
        END IF;
      END LOOP;

      UPDATE public.orders
      SET
        rider_number = v_norm->>'rider_number',
        arrived_pickup_at = (v_norm->>'arrived_pickup_at')::TIMESTAMPTZ,
        lm_distance = (v_norm->>'lm_distance')::INTEGER,
        resting_point_name = v_norm->>'resting_point_name',
        total_eta = (v_norm->>'total_eta')::NUMERIC(10,2),
        completed_at = (v_norm->>'completed_at')::TIMESTAMPTZ,
        resting_point_id = v_norm->>'resting_point_id',
        source_store_name = v_norm->>'source_store_name',
        pickup_at = (v_norm->>'pickup_at')::TIMESTAMPTZ,
        order_eta_status = v_norm->>'order_eta_status',
        staged_at = (v_norm->>'staged_at')::TIMESTAMPTZ,
        pickup_eta = (v_norm->>'pickup_eta')::NUMERIC(10,2),
        arrive_at_pickup_eta = (v_norm->>'arrive_at_pickup_eta')::TIMESTAMPTZ,
        status_text = v_norm->>'status_text',
        order_created_at = (v_norm->>'order_created_at')::TIMESTAMPTZ,
        status = v_norm->>'status',
        rider_name = v_norm->>'rider_name',
        external_store_id = v_norm->>'external_store_id',
        total_time = (v_norm->>'total_time')::NUMERIC(10,2),
        arrive_at_delivery_eta = (v_norm->>'arrive_at_delivery_eta')::TIMESTAMPTZ,
        arrived_delivery_at = (v_norm->>'arrived_delivery_at')::TIMESTAMPTZ,
        tracking_url = v_norm->>'tracking_url',
        customer_id = v_norm->>'customer_id',
        rto_at = (v_norm->>'rto_at')::TIMESTAMPTZ,
        fm_distance = (v_norm->>'fm_distance')::NUMERIC(10,2),
        assigned_at = (v_norm->>'assigned_at')::TIME,
        delivery_eta = (v_norm->>'delivery_eta')::NUMERIC(10,2),
        source_batch_id = v_norm->>'source_batch_id',
        order_type = v_derived->>'order_type',
        store_code = v_derived->>'store_code',
        slot_hour = (v_derived->>'slot_hour')::SMALLINT,
        order_date = v_order_date,
        staging_to_pickup_minutes = (v_derived->>'staging_to_pickup_minutes')::NUMERIC(10,4),
        s2p_minutes = (v_derived->>'s2p_minutes')::NUMERIC(10,4),
        distance_meters = (v_derived->>'distance_meters')::INTEGER,
        actual_arrival_minutes = (v_derived->>'actual_arrival_minutes')::NUMERIC(10,4),
        arrival_eta_minutes = (v_derived->>'arrival_eta_minutes')::NUMERIC(10,4),
        otp_performance = v_derived->>'otp_performance',
        otp_plus_3_performance = v_derived->>'otp_plus_3_performance',
        source_row_hash = v_row_hash,
        raw_source_snapshot = v_raw,
        last_ingestion_batch_id = v_batch_id,
        updated_at = now()
      WHERE id = v_existing.id;

      INSERT INTO public.order_revision_history (
        order_row_id,
        store_id,
        order_id,
        batch_id,
        action_type,
        changed_fields,
        previous_source_snapshot,
        new_source_snapshot,
        previous_derived_snapshot,
        new_derived_snapshot,
        changed_at
      ) VALUES (
        v_existing.id,
        p_store_id,
        v_order_id,
        v_batch_id,
        'UPDATE',
        v_changed_fields,
        v_previous_source,
        v_norm,
        v_previous_derived,
        v_derived,
        now()
      );

      INSERT INTO public.ingestion_batch_rows (
        batch_id,
        source_row_number,
        store_id,
        order_id,
        action,
        row_hash,
        validation_errors,
        source_snapshot
      ) VALUES (
        v_batch_id,
        v_row_num,
        p_store_id,
        v_order_id,
        'updated',
        v_row_hash,
        '[]'::jsonb,
        v_raw
      );

      v_updated_count := v_updated_count + 1;
    END IF;
  END LOOP;

  -- 8. Mark the batch as Succeeded with final counts
  UPDATE public.ingestion_batches
  SET
    status = 'Succeeded',
    min_order_date = v_min_date,
    max_order_date = v_max_date,
    inserted_count = v_inserted_count,
    updated_count = v_updated_count,
    unchanged_count = v_unchanged_count,
    rejected_count = 0,
    failed_count = 0,
    completed_at = now()
  WHERE id = v_batch_id;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'prior_batch_id', v_prior_batch.id,
    'already_processed', false,
    'status', 'Succeeded',
    'store_id', p_store_id,
    'store_code', v_store.store_code,
    'min_order_date', v_min_date,
    'max_order_date', v_max_date,
    'total_rows', v_total_rows,
    'inserted_count', v_inserted_count,
    'updated_count', v_updated_count,
    'unchanged_count', v_unchanged_count,
    'rejected_count', 0,
    'failed_count', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_order_batch(UUID, UUID, TEXT, TEXT, JSONB, BOOLEAN, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_order_batch(UUID, UUID, TEXT, TEXT, JSONB, BOOLEAN, JSONB) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 6. Secure Analytics RPCs with has_store_access
-- ------------------------------------------------------------------------------
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
    AND public.has_store_access(p_store_id)
    AND o.order_date >= p_start_date
    AND o.order_date <= p_end_date
    AND o.rider_name IS NOT NULL
    AND TRIM(o.rider_name) <> ''
    AND TRIM(o.rider_name) <> '-'
  GROUP BY TRIM(o.rider_name), o.order_date
  ORDER BY TRIM(o.rider_name) ASC, o.order_date ASC;
$$;

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
    AND public.has_store_access(p_store_id)
    AND r.rider_name IS NOT NULL
    AND TRIM(r.rider_name) <> ''
  GROUP BY r.rider_name;
$$;

-- ------------------------------------------------------------------------------
-- 7. Administrator Helper: Provision & Link Store User
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_store_user(
  p_email TEXT,
  p_store_code TEXT,
  p_full_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id UUID;
  v_user_id UUID;
BEGIN
  -- Verify caller is active administrator
  IF NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Access denied: Only active administrators can register store users.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_store_id
  FROM public.stores
  WHERE UPPER(store_code) = UPPER(TRIM(p_store_code)) AND is_active = true;

  IF v_store_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'STORE_NOT_FOUND',
      'message', format('Store with code "%s" was not found or is inactive.', p_store_code)
    );
  END IF;

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE LOWER(email) = LOWER(TRIM(p_email));

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'USER_NOT_IN_AUTH',
      'message', format('User "%s" does not exist in Supabase Auth yet. Please invite or sign up the user in Supabase Auth first, then link them to store %s.', p_email, p_store_code)
    );
  END IF;

  INSERT INTO public.store_users (user_id, store_id, email, full_name, is_active)
  VALUES (v_user_id, v_store_id, LOWER(TRIM(p_email)), p_full_name, true)
  ON CONFLICT (user_id) DO UPDATE
  SET store_id = EXCLUDED.store_id,
      email = EXCLUDED.email,
      full_name = COALESCE(EXCLUDED.full_name, store_users.full_name),
      is_active = true,
      updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_user_id,
    'store_id', v_store_id,
    'store_code', UPPER(TRIM(p_store_code)),
    'email', LOWER(TRIM(p_email))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_store_user(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_store_user(TEXT, TEXT, TEXT) TO authenticated, service_role;

COMMIT;
