-- ==============================================================================
-- Test Script: supabase/tests/verify_schema.sql
-- Purpose:     Non-destructive verification of Phase 1 Database Foundation.
--              Runs inside a transaction (BEGIN ... ROLLBACK) so it can be
--              executed safely in the Supabase SQL Editor or local PostgreSQL
--              without leaving any test data behind.
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  v_table_count INTEGER;
  v_rls_count INTEGER;
  v_order_col_count INTEGER;
  v_anon_grants INTEGER;
  v_auth_write_grants INTEGER;
  v_store_id UUID;
  v_test_user_id UUID := '00000000-0000-4000-8000-000000000099';
  v_payload_1 JSONB;
  v_payload_2 JSONB;
  v_res_1 JSONB;
  v_res_dup JSONB;
  v_res_2 JSONB;
  v_unchanged_ts_before TIMESTAMPTZ;
  v_unchanged_ts_after TIMESTAMPTZ;
  v_revision_count INTEGER;
  v_changed_fields JSONB;
BEGIN
  -- 1. Verify all 6 core tables exist
  SELECT count(*) INTO v_table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'admin_users',
      'stores',
      'ingestion_batches',
      'orders',
      'ingestion_batch_rows',
      'order_revision_history'
    );

  IF v_table_count <> 6 THEN
    RAISE EXCEPTION 'Expected 6 core tables in public schema, found %', v_table_count;
  END IF;

  -- 2. Verify RLS is enabled on all 6 tables
  SELECT count(*) INTO v_rls_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'admin_users',
      'stores',
      'ingestion_batches',
      'orders',
      'ingestion_batch_rows',
      'order_revision_history'
    )
    AND c.relrowsecurity = true;

  IF v_rls_count <> 6 THEN
    RAISE EXCEPTION 'Expected RLS enabled on all 6 tables, found %', v_rls_count;
  END IF;

  -- 3. Verify public.orders has all 47 columns (29 source + 11 derived + 7 audit/PK/FK)
  SELECT count(*) INTO v_order_col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'orders';

  IF v_order_col_count <> 47 THEN
    RAISE EXCEPTION 'Expected 47 columns in public.orders (29 source + 11 derived + 7 metadata), found %', v_order_col_count;
  END IF;

  -- 4. Verify anonymous role (anon) has zero table privileges on portal tables
  SELECT count(*) INTO v_anon_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN (
      'admin_users',
      'stores',
      'ingestion_batches',
      'orders',
      'ingestion_batch_rows',
      'order_revision_history'
    )
    AND grantee = 'anon';

  IF v_anon_grants <> 0 THEN
    RAISE EXCEPTION 'Security violation: anon role has % table grants on public tables', v_anon_grants;
  END IF;

  -- 5. Verify authenticated role has zero write privileges (INSERT/UPDATE/DELETE)
  SELECT count(*) INTO v_auth_write_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN (
      'admin_users',
      'stores',
      'ingestion_batches',
      'orders',
      'ingestion_batch_rows',
      'order_revision_history'
    )
    AND grantee = 'authenticated'
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

  IF v_auth_write_grants <> 0 THEN
    RAISE EXCEPTION 'Security violation: authenticated role has % direct write grants', v_auth_write_grants;
  END IF;

  -- 6. Verify store TMK7 seed exists
  SELECT id INTO v_store_id
  FROM public.stores
  WHERE store_code = 'TMK7'
    AND external_store_id = '4247'
    AND is_active = true;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Seed store TMK7 (external_store_id=4247) not found in public.stores';
  END IF;

  -- 7. Seed a temporary auth user + admin_users row for RPC verification
  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at)
  VALUES (
    v_test_user_id,
    'verify-admin@urbanconnect.test',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    'authenticated',
    'authenticated',
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.admin_users (user_id, email, full_name, is_active)
  VALUES (v_test_user_id, 'verify-admin@urbanconnect.test', 'Schema Verifier', true)
  ON CONFLICT (user_id) DO NOTHING;

  -- 8. Test Batch 1: Initial Insert of 2 orders (1 COMPLETED, 1 CANCELLED)
  v_payload_1 := jsonb_build_array(
    jsonb_build_object(
      'source_row_number', 2,
      'source_row_hash', repeat('a', 64),
      'raw_source_snapshot', jsonb_build_object('Order ID', 'TEST_ORD_001', 'Status', 'COMPLETED'),
      'normalized_source', jsonb_build_object(
        'rider_number', 'XXXXXX5447',
        'arrived_pickup_at', '2026-10-18T23:57:30+05:30',
        'lm_distance', 989,
        'resting_point_name', NULL,
        'total_eta', 4,
        'completed_at', NULL,
        'resting_point_id', NULL,
        'source_store_name', 'TMK7 | 11:57 PM | 1.0 KM',
        'pickup_at', '2026-10-18T23:58:42+05:30',
        'order_eta_status', NULL,
        'staged_at', '2026-10-18T23:58:17+05:30',
        'pickup_eta', 24,
        'arrive_at_pickup_eta', NULL,
        'status_text', NULL,
        'order_created_at', '2026-10-18T23:57:25+05:30',
        'status', 'COMPLETED',
        'rider_name', 'Savidhan kisan Wahule',
        'order_id', 'TEST_ORD_001',
        'external_store_id', '4247',
        'total_time', NULL,
        'arrive_at_delivery_eta', '2026-10-19T00:02:31+05:30',
        'arrived_delivery_at', '2026-10-19T00:01:58+05:30',
        'tracking_url', 'https://track.loadshare.net/order/wkj3qww',
        'customer_id', '22411',
        'rto_at', NULL,
        'fm_distance', 0,
        'assigned_at', '23:57:00',
        'delivery_eta', 3,
        'source_batch_id', NULL
      ),
      'derived_fields', jsonb_build_object(
        'order_type', 'Actual',
        'store_code', 'TMK7',
        'slot_hour', 23,
        'order_date', '2026-10-18',
        'staging_to_pickup_minutes', 0.4167,
        's2p_minutes', 0.4167,
        'distance_meters', 989,
        'actual_arrival_minutes', 3.6833,
        'arrival_eta_minutes', 4.2333,
        'otp_performance', 'OTP Achieved',
        'otp_plus_3_performance', 'OTP Achieved'
      )
    ),
    jsonb_build_object(
      'source_row_number', 3,
      'source_row_hash', repeat('b', 64),
      'raw_source_snapshot', jsonb_build_object('Order ID', 'TEST_ORD_002', 'Status', 'CANCELLED'),
      'normalized_source', jsonb_build_object(
        'rider_number', NULL,
        'arrived_pickup_at', '2026-10-18T13:28:54+05:30',
        'lm_distance', 413,
        'resting_point_name', NULL,
        'total_eta', NULL,
        'completed_at', NULL,
        'resting_point_id', NULL,
        'source_store_name', 'TMK7 | 1:26 PM | 0.4 KM',
        'pickup_at', NULL,
        'order_eta_status', NULL,
        'staged_at', NULL,
        'pickup_eta', NULL,
        'arrive_at_pickup_eta', NULL,
        'status_text', NULL,
        'order_created_at', '2026-10-18T13:26:34+05:30',
        'status', 'CANCELLED',
        'rider_name', NULL,
        'order_id', 'TEST_ORD_002',
        'external_store_id', '4247',
        'total_time', NULL,
        'arrive_at_delivery_eta', '2026-10-18T13:33:57+05:30',
        'arrived_delivery_at', NULL,
        'tracking_url', 'https://track.loadshare.net/order/jxdWMV1',
        'customer_id', '22411',
        'rto_at', NULL,
        'fm_distance', 0,
        'assigned_at', '13:28:00',
        'delivery_eta', NULL,
        'source_batch_id', NULL
      ),
      'derived_fields', jsonb_build_object(
        'order_type', 'Actual',
        'store_code', 'TMK7',
        'slot_hour', 13,
        'order_date', '2026-10-18',
        'staging_to_pickup_minutes', 0,
        's2p_minutes', 0,
        'distance_meters', 413,
        'actual_arrival_minutes', 0,
        'arrival_eta_minutes', 0,
        'otp_performance', 'Not Applicable',
        'otp_plus_3_performance', 'Not Applicable'
      )
    )
  );

  v_res_1 := public.ingest_order_batch(
    v_store_id,
    v_test_user_id,
    'test_upload_1.xlsx',
    repeat('1', 64),
    v_payload_1,
    false,
    '{"test": true}'::jsonb
  );

  IF (v_res_1->>'status') <> 'Succeeded'
     OR (v_res_1->>'inserted_count')::INTEGER <> 2
     OR (v_res_1->>'updated_count')::INTEGER <> 0
     OR (v_res_1->>'unchanged_count')::INTEGER <> 0 THEN
    RAISE EXCEPTION 'Batch 1 unexpected result: %', v_res_1;
  END IF;

  SELECT updated_at INTO v_unchanged_ts_before
  FROM public.orders
  WHERE store_id = v_store_id AND order_id = 'TEST_ORD_002';

  -- 9. Test File-Level Idempotency (same checksum -> Duplicate Skipped)
  v_res_dup := public.ingest_order_batch(
    v_store_id,
    v_test_user_id,
    'test_upload_1_retry.xlsx',
    repeat('1', 64),
    v_payload_1,
    false,
    '{"test": true}'::jsonb
  );

  IF (v_res_dup->>'already_processed')::BOOLEAN <> true
     OR (v_res_dup->>'status') <> 'Duplicate Skipped'
     OR (v_res_dup->>'prior_batch_id') <> (v_res_1->>'batch_id') THEN
    RAISE EXCEPTION 'Duplicate file detection failed: %', v_res_dup;
  END IF;

  -- 10. Test Order-Level Update + Unchanged + Revision History (new file checksum)
  v_payload_2 := jsonb_set(
    jsonb_set(
      jsonb_set(
        v_payload_1,
        '{0,source_row_hash}',
        to_jsonb(repeat('c', 64))
      ),
      '{0,normalized_source,lm_distance}',
      to_jsonb(1050)
    ),
    '{0,derived_fields,distance_meters}',
    to_jsonb(1050)
  );

  v_res_2 := public.ingest_order_batch(
    v_store_id,
    v_test_user_id,
    'test_upload_2.xlsx',
    repeat('2', 64),
    v_payload_2,
    false,
    '{"test": true}'::jsonb
  );

  IF (v_res_2->>'status') <> 'Succeeded'
     OR (v_res_2->>'inserted_count')::INTEGER <> 0
     OR (v_res_2->>'updated_count')::INTEGER <> 1
     OR (v_res_2->>'unchanged_count')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'Batch 2 update/unchanged counts failed: %', v_res_2;
  END IF;

  -- Verify unchanged order's updated_at did NOT change
  SELECT updated_at INTO v_unchanged_ts_after
  FROM public.orders
  WHERE store_id = v_store_id AND order_id = 'TEST_ORD_002';

  IF v_unchanged_ts_before IS DISTINCT FROM v_unchanged_ts_after THEN
    RAISE EXCEPTION 'Unchanged order updated_at was modified!';
  END IF;

  -- Verify revision history entry was created for TEST_ORD_001 with lm_distance diff
  SELECT count(*), max(changed_fields::text)::jsonb
  INTO v_revision_count, v_changed_fields
  FROM public.order_revision_history
  WHERE store_id = v_store_id
    AND order_id = 'TEST_ORD_001'
    AND batch_id = (v_res_2->>'batch_id')::UUID;

  IF v_revision_count <> 1 OR (v_changed_fields->'lm_distance'->>'before')::INTEGER <> 989
     OR (v_changed_fields->'lm_distance'->>'after')::INTEGER <> 1050 THEN
    RAISE EXCEPTION 'Order revision history mismatch: count=%, diff=%', v_revision_count, v_changed_fields;
  END IF;

  RAISE NOTICE 'ALL PHASE 1 SCHEMA, RLS, GRANT, AND ATOMIC RPC CHECKS PASSED!';
END;
$$;

ROLLBACK;
