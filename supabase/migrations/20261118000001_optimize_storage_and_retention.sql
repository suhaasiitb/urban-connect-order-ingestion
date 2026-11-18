-- ==============================================================================
-- Migration: 20261118000001_optimize_storage_and_retention.sql
-- Purpose:   1. Eliminate redundant JSONB snapshot bloat on orders,
--               ingestion_batch_rows, and order_revision_history.
--            2. Stop inserting per-row 'unchanged' records into
--               ingestion_batch_rows during re-uploads (batch-level summary
--               unchanged_count remains accurately recorded on ingestion_batches).
--            3. Tighten audit table retention in cleanup_old_orders(30):
--                 - orders: 30 days
--                 - order_revision_history: 7 days
--                 - ingestion_batch_rows: 2 days (zero unchanged rows)
--                 - Failed / Duplicate Skipped ingestion_batches: 7 days
--            4. Drop unused index idx_batch_rows_store_order (0 scans).
--            5. Immediately prune & slim existing audit payloads on live tables.
-- ==============================================================================

BEGIN;

SET LOCAL statement_timeout = '300s';

-- 1. Drop unused index on ingestion_batch_rows (0 scans observed; batch_id/processed_at indexes handle all queries)
DROP INDEX IF EXISTS public.idx_batch_rows_store_order;

-- 2. Add index on order_revision_history(changed_at) for fast 7-day retention pruning
CREATE INDEX IF NOT EXISTS idx_order_revision_history_changed_at
  ON public.order_revision_history (changed_at);

-- 3. Update ingest_order_batch RPC to avoid redundant JSONB & unchanged-row bloat
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
SET statement_timeout = '120s'
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
  v_row_num INTEGER;
  v_row_hash TEXT;
  v_order_id TEXT;
  v_order_date DATE;
  v_existing public.orders%ROWTYPE;
  v_previous_source JSONB;
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

    -- Read existing order row without acquiring an exclusive lock first
    SELECT * INTO v_existing
    FROM public.orders
    WHERE store_id = p_store_id
      AND order_id = v_order_id;

    IF NOT FOUND THEN
      -- CASE A: New Order -> INSERT (raw_source_snapshot kept empty since all 29 columns are typed)
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
        '{}'::jsonb,
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
        '{}'::jsonb
      );

      v_inserted_count := v_inserted_count + 1;

    ELSIF v_existing.source_row_hash = v_row_hash THEN
      -- CASE B: Existing Order with Identical Normalized Source -> UNCHANGED
      -- Skip inserting bloated unchanged rows into ingestion_batch_rows; only track count.
      v_unchanged_count := v_unchanged_count + 1;

    ELSE
      -- CASE C: Existing Order with Changed Normalized Source -> UPDATE + COMPACT REVISION DIFF
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
        raw_source_snapshot = '{}'::jsonb,
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
        NULL,
        '{}'::jsonb,
        jsonb_build_object(
          'otp_performance', v_existing.otp_performance,
          'otp_plus_3_performance', v_existing.otp_plus_3_performance
        ),
        jsonb_build_object(
          'otp_performance', v_derived->>'otp_performance',
          'otp_plus_3_performance', v_derived->>'otp_plus_3_performance'
        ),
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
        '{}'::jsonb
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

-- 4. Tighten cleanup_old_orders(30):
--    - 30d orders
--    - 7d order_revision_history
--    - 2d ingestion_batch_rows (no unchanged rows)
--    - stale ingestion_batches (beyond order retention OR Duplicate Skipped / Failed > 7d)
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
  v_deleted_revisions BIGINT := 0;
  v_deleted_orders BIGINT := 0;
  v_deleted_batch_rows BIGINT := 0;
  v_deleted_batches BIGINT := 0;
BEGIN
  IF p_retention_days IS NULL OR p_retention_days < 1 THEN
    RAISE EXCEPTION 'p_retention_days must be >= 1';
  END IF;

  v_cutoff_date := (CURRENT_DATE - p_retention_days);

  -- Delete revision history > 7 days first so batch_id FK (ON DELETE RESTRICT) clears
  DELETE FROM public.order_revision_history
  WHERE changed_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS v_deleted_revisions = ROW_COUNT;

  DELETE FROM public.orders
  WHERE order_date < v_cutoff_date;
  GET DIAGNOSTICS v_deleted_orders = ROW_COUNT;

  DELETE FROM public.ingestion_batch_rows
  WHERE processed_at < NOW() - INTERVAL '2 days'
     OR action = 'unchanged';
  GET DIAGNOSTICS v_deleted_batch_rows = ROW_COUNT;

  DELETE FROM public.ingestion_batches b
  WHERE (
      (b.max_order_date IS NOT NULL AND b.max_order_date < v_cutoff_date)
      OR (b.status IN ('Failed', 'Duplicate Skipped') AND b.started_at < NOW() - INTERVAL '7 days')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.order_revision_history r WHERE r.batch_id = b.id
    );
  GET DIAGNOSTICS v_deleted_batches = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff_date', v_cutoff_date,
    'deleted_revisions', v_deleted_revisions,
    'deleted_orders', v_deleted_orders,
    'deleted_batch_rows', v_deleted_batch_rows,
    'deleted_batches', v_deleted_batches
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_orders(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_orders(INTEGER) TO service_role;

-- 5. Ensure daily automatic pg_cron job stays scheduled at 03:00 UTC
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
    NULL;
END $$;

-- 6. Immediately reclaim ingestion_batch_rows (145 MB) & slim live revision/order snapshots
TRUNCATE TABLE public.ingestion_batch_rows;

DELETE FROM public.order_revision_history
WHERE changed_at < NOW() - INTERVAL '7 days';

UPDATE public.order_revision_history
SET
  previous_source_snapshot = NULL,
  new_source_snapshot = '{}'::jsonb,
  previous_derived_snapshot = CASE
    WHEN previous_derived_snapshot IS NULL THEN NULL
    ELSE jsonb_build_object(
      'otp_performance', previous_derived_snapshot->>'otp_performance',
      'otp_plus_3_performance', previous_derived_snapshot->>'otp_plus_3_performance'
    )
  END,
  new_derived_snapshot = jsonb_build_object(
    'otp_performance', new_derived_snapshot->>'otp_performance',
    'otp_plus_3_performance', new_derived_snapshot->>'otp_plus_3_performance'
  )
WHERE previous_source_snapshot IS NOT NULL
   OR new_source_snapshot <> '{}'::jsonb;

SELECT public.cleanup_old_orders(30);

UPDATE public.orders
SET raw_source_snapshot = '{}'::jsonb
WHERE raw_source_snapshot <> '{}'::jsonb;

COMMIT;
