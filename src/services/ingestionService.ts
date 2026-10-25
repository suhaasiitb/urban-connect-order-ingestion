// ==============================================================================
// Order Ingestion, Pre-Upload Diff Preview & Batch History Service
// ==============================================================================

import { supabase, supabaseAnonKey, supabaseUrl } from '../config/supabaseClient';
import type {
  FieldValidationIssue,
  WorkbookValidationResult,
} from '../domain/types';
import { EXPECTED_RAW_HEADERS } from '../domain/types';

export interface PreUploadDiffSummary {
  alreadyProcessedBatch: {
    id: string;
    original_filename: string;
    completed_at: string | null;
  } | null;
  expectedInserts: number;
  expectedUpdates: number;
  expectedUnchanged: number;
  expectedRejected: number;
  comparisonAvailable: boolean;
  warningMessage?: string;
}

export interface CommittedBatchResult {
  ok: boolean;
  batch_id: string | null;
  prior_batch_id: string | null;
  already_processed: boolean;
  status: 'Succeeded' | 'Duplicate Skipped' | 'Failed';
  store_id: string;
  store_code: string;
  min_order_date: string | null;
  max_order_date: string | null;
  total_rows: number;
  inserted_count: number;
  updated_count: number;
  unchanged_count: number;
  rejected_count: number;
  failed_count: number;
  file_warnings?: string[];
  error_message?: string;
  is_network_error?: boolean;
}

export interface BatchHistoryRecord {
  id: string;
  store_id: string;
  original_filename: string;
  file_checksum_sha256: string;
  uploaded_by: string;
  status: string;
  min_order_date: string | null;
  max_order_date: string | null;
  total_rows: number;
  inserted_count: number;
  updated_count: number;
  unchanged_count: number;
  rejected_count: number;
  failed_count: number;
  prior_batch_id: string | null;
  error_summary: string | null;
  started_at: string;
  completed_at: string | null;
  stores?: {
    store_code: string;
    store_name: string;
  } | null;
}

export interface BatchRowAuditRecord {
  id: string;
  source_row_number: number;
  order_id: string | null;
  action: 'inserted' | 'updated' | 'unchanged' | 'rejected' | 'failed';
  row_hash: string | null;
  validation_errors: FieldValidationIssue[];
  processed_at: string;
}

export interface OrderRevisionAuditRecord {
  id: string;
  order_id: string;
  action_type: 'INSERT' | 'UPDATE';
  changed_fields: Record<string, { before: unknown; after: unknown }>;
  previous_source_snapshot: Record<string, unknown> | null;
  new_source_snapshot: Record<string, unknown>;
  previous_derived_snapshot: Record<string, unknown> | null;
  new_derived_snapshot: Record<string, unknown>;
  changed_at: string;
}

/**
 * Compares the validated workbook rows against existing orders in PostgreSQL
 * for the selected store so the Review & Confirmation screen can display
 * accurate expected Insert / Update / Unchanged / Rejected counts before writing.
 */
export async function computePreUploadDiffPreview(
  storeId: string,
  validation: WorkbookValidationResult
): Promise<PreUploadDiffSummary> {
  const validRows = validation.rows.filter((r) => r.is_valid);
  const invalidCount = validation.invalid_rows_count;

  // 1. Check if this exact file SHA-256 was already processed for this store
  const { data: priorBatch, error: priorErr } = await supabase
    .from('ingestion_batches')
    .select('id, original_filename, completed_at')
    .eq('store_id', storeId)
    .eq('file_checksum_sha256', validation.file_checksum_sha256)
    .eq('status', 'Succeeded')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (priorErr) {
    return {
      alreadyProcessedBatch: null,
      expectedInserts: validRows.length,
      expectedUpdates: 0,
      expectedUnchanged: 0,
      expectedRejected: invalidCount,
      comparisonAvailable: false,
      warningMessage: `Could not pre-query existing orders (${priorErr.message}). Exact counts will be computed by the backend transaction.`,
    };
  }

  // 2. Query existing (order_id, source_row_hash) for this store in chunks of 200
  const existingHashByOrderId = new Map<string, string>();
  const orderIds = validRows.map((r) => r.normalized_source.order_id);
  const CHUNK_SIZE = 200;

  for (let i = 0; i < orderIds.length; i += CHUNK_SIZE) {
    const chunk = orderIds.slice(i, i + CHUNK_SIZE);
    const { data, error } = await supabase
      .from('orders')
      .select('order_id, source_row_hash')
      .eq('store_id', storeId)
      .in('order_id', chunk);

    if (error) {
      return {
        alreadyProcessedBatch: priorBatch ?? null,
        expectedInserts: validRows.length,
        expectedUpdates: 0,
        expectedUnchanged: 0,
        expectedRejected: invalidCount,
        comparisonAvailable: false,
        warningMessage: `Could not pre-query existing orders (${error.message}). Exact counts will be computed by the backend transaction.`,
      };
    }

    for (const row of data ?? []) {
      existingHashByOrderId.set(
        String(row.order_id),
        String(row.source_row_hash)
      );
    }
  }

  let expectedInserts = 0;
  let expectedUpdates = 0;
  let expectedUnchanged = 0;

  for (const row of validRows) {
    const existingHash = existingHashByOrderId.get(row.normalized_source.order_id);
    if (!existingHash) {
      expectedInserts += 1;
    } else if (existingHash === row.source_row_hash) {
      expectedUnchanged += 1;
    } else {
      expectedUpdates += 1;
    }
  }

  return {
    alreadyProcessedBatch: priorBatch ?? null,
    expectedInserts,
    expectedUpdates,
    expectedUnchanged,
    expectedRejected: invalidCount,
    comparisonAvailable: true,
  };
}

/**
 * Submits the confirmed order batch to the protected ingest-orders Supabase
 * Edge Function. The backend independently re-validates, recalculates all 11
 * derived fields, and executes the atomic PostgreSQL transaction.
 */
export async function submitConfirmedOrderBatch(params: {
  storeId: string;
  storeCode: string;
  validation: WorkbookValidationResult;
  forceReprocess?: boolean;
}): Promise<CommittedBatchResult> {
  const { storeId, storeCode, validation, forceReprocess = false } = params;

  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  const session = sessionData.session;
  const accessToken = session?.access_token;
  const userId = session?.user?.id;

  if (sessionErr || !accessToken || !userId) {
    return {
      ok: false,
      batch_id: null,
      prior_batch_id: null,
      already_processed: false,
      status: 'Failed',
      store_id: storeId,
      store_code: storeCode,
      min_order_date: validation.min_order_date,
      max_order_date: validation.max_order_date,
      total_rows: validation.total_rows_detected,
      inserted_count: 0,
      updated_count: 0,
      unchanged_count: 0,
      rejected_count: validation.invalid_rows_count,
      failed_count: 0,
      error_message:
        'Your session has expired. Please sign in again and retry the upload.',
    };
  }

  // 1. Primary Ingestion Path: Direct Database RPC ingest_order_batch
  // Calls public.ingest_order_batch natively via authenticated Supabase client.
  // This verifies authorization against public.admin_users (Superadmin) or public.store_users (Store operator)
  // directly in PostgreSQL without requiring Edge Function redeployment.
  const rpcRecords = validation.rows.map((r) => ({
    source_row_number: r.source_row_number,
    source_row_hash: r.source_row_hash,
    raw_source_snapshot: r.raw_source_snapshot,
    normalized_source: r.normalized_source,
    derived_fields: r.derived_fields,
  }));

  try {
    const { data: rpcData, error: rpcErr } = await supabase.rpc('ingest_order_batch', {
      p_store_id: storeId,
      p_uploaded_by: userId,
      p_original_filename: validation.filename,
      p_file_checksum_sha256: validation.file_checksum_sha256,
      p_records: rpcRecords,
      p_force_reprocess: forceReprocess,
      p_processing_metadata: {
        client_version: '1.0.0',
        uploaded_by_email: session.user.email,
        timezone: 'Asia/Kolkata',
      },
    });

    if (!rpcErr && rpcData && typeof rpcData === 'object') {
      const res = rpcData as Record<string, unknown>;
      return {
        ok: true,
        batch_id: typeof res.batch_id === 'string' ? res.batch_id : null,
        prior_batch_id: typeof res.prior_batch_id === 'string' ? res.prior_batch_id : null,
        already_processed: Boolean(res.already_processed),
        status: (res.status as 'Succeeded' | 'Duplicate Skipped' | 'Failed') || 'Succeeded',
        store_id: storeId,
        store_code: storeCode,
        min_order_date: typeof res.min_order_date === 'string' ? res.min_order_date : validation.min_order_date,
        max_order_date: typeof res.max_order_date === 'string' ? res.max_order_date : validation.max_order_date,
        total_rows: typeof res.total_rows === 'number' ? res.total_rows : validation.total_rows_detected,
        inserted_count: typeof res.inserted_count === 'number' ? res.inserted_count : 0,
        updated_count: typeof res.updated_count === 'number' ? res.updated_count : 0,
        unchanged_count: typeof res.unchanged_count === 'number' ? res.unchanged_count : 0,
        rejected_count: typeof res.rejected_count === 'number' ? res.rejected_count : 0,
        failed_count: typeof res.failed_count === 'number' ? res.failed_count : 0,
        file_warnings: validation.file_warnings,
      };
    }

    if (rpcErr) {
      return {
        ok: false,
        batch_id: null,
        prior_batch_id: null,
        already_processed: false,
        status: 'Failed',
        store_id: storeId,
        store_code: storeCode,
        min_order_date: validation.min_order_date,
        max_order_date: validation.max_order_date,
        total_rows: validation.total_rows_detected,
        inserted_count: 0,
        updated_count: 0,
        unchanged_count: 0,
        rejected_count: validation.invalid_rows_count,
        failed_count: 0,
        error_message: rpcErr.message,
      };
    }
  } catch (directRpcErr) {
    const msg = directRpcErr instanceof Error ? directRpcErr.message : String(directRpcErr);
    console.warn('Direct RPC execution caught exception, falling back to edge function:', msg);
  }

  // 2. Secondary Path: Edge Function Endpoint (fallback)
  const endpoint = `${supabaseUrl}/functions/v1/ingest-orders`;
  const requestBody = {
    store_id: storeId,
    original_filename: validation.filename,
    file_size_bytes: validation.file_size_bytes,
    file_checksum_sha256: validation.file_checksum_sha256,
    force_reprocess: forceReprocess,
    headers: [...EXPECTED_RAW_HEADERS],
    rows: validation.rows.map((r) => ({
      source_row_number: r.source_row_number,
      raw_row: {
        ...r.raw_source_snapshot,
        'Arrived Pickup At': r.normalized_source.arrived_pickup_at,
        'Completed At': r.normalized_source.completed_at,
        'Pickup At': r.normalized_source.pickup_at,
        'Staged At': r.normalized_source.staged_at,
        'Arrive at Pickup ETA': r.normalized_source.arrive_at_pickup_eta,
        'Created At': r.normalized_source.order_created_at,
        'Arrive at Delivery ETA': r.normalized_source.arrive_at_delivery_eta,
        'Arrived Delivery At': r.normalized_source.arrived_delivery_at,
        'RTO At': r.normalized_source.rto_at,
        'Assigned At': r.normalized_source.assigned_at,
      },
    })),
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    if (!response.ok || !data || data.ok !== true) {
      const errMsg =
        (data && typeof data.message === 'string' && data.message) ||
        `Backend ingestion returned HTTP ${response.status}.`;
      return {
        ok: false,
        batch_id: (data && typeof data.batch_id === 'string' ? data.batch_id : null),
        prior_batch_id: null,
        already_processed: false,
        status: 'Failed',
        store_id: storeId,
        store_code: storeCode,
        min_order_date: validation.min_order_date,
        max_order_date: validation.max_order_date,
        total_rows: validation.total_rows_detected,
        inserted_count: 0,
        updated_count: 0,
        unchanged_count: 0,
        rejected_count:
          typeof data?.rejected_count === 'number'
            ? data.rejected_count
            : validation.invalid_rows_count,
        failed_count:
          typeof data?.failed_count === 'number' ? data.failed_count : 0,
        error_message: errMsg,
      };
    }

    return {
      ok: true,
      batch_id: String(data.batch_id),
      prior_batch_id: data.prior_batch_id ? String(data.prior_batch_id) : null,
      already_processed: Boolean(data.already_processed),
      status: (data.status as 'Succeeded' | 'Duplicate Skipped') ?? 'Succeeded',
      store_id: String(data.store_id ?? storeId),
      store_code: String(data.store_code ?? storeCode),
      min_order_date: data.min_order_date ? String(data.min_order_date) : validation.min_order_date,
      max_order_date: data.max_order_date ? String(data.max_order_date) : validation.max_order_date,
      total_rows: Number(data.total_rows ?? validation.total_rows_detected),
      inserted_count: Number(data.inserted_count ?? 0),
      updated_count: Number(data.updated_count ?? 0),
      unchanged_count: Number(data.unchanged_count ?? 0),
      rejected_count: Number(data.rejected_count ?? 0),
      failed_count: Number(data.failed_count ?? 0),
      file_warnings: Array.isArray(data.file_warnings)
        ? data.file_warnings.map(String)
        : [],
    };
  } catch (err) {
    const netMsg =
      err instanceof Error ? err.message : 'Network request failed';
    return {
      ok: false,
      batch_id: null,
      prior_batch_id: null,
      already_processed: false,
      status: 'Failed',
      store_id: storeId,
      store_code: storeCode,
      min_order_date: validation.min_order_date,
      max_order_date: validation.max_order_date,
      total_rows: validation.total_rows_detected,
      inserted_count: 0,
      updated_count: 0,
      unchanged_count: 0,
      rejected_count: 0,
      failed_count: 0,
      error_message: `Network error while contacting ingestion endpoint (${netMsg}). Because ingestion is idempotent, you can safely retry this upload.`,
      is_network_error: true,
    };
  }
}

/**
 * Fetches prior ingestion batches ordered by most recent first.
 */
export async function fetchBatchHistory(storeId?: string): Promise<{
  batches: BatchHistoryRecord[];
  error?: string;
}> {
  let query = supabase
    .from('ingestion_batches')
    .select(
      `id, store_id, original_filename, file_checksum_sha256, uploaded_by, status,
       min_order_date, max_order_date, total_rows, inserted_count, updated_count,
       unchanged_count, rejected_count, failed_count, prior_batch_id, error_summary,
       started_at, completed_at, stores(store_code, store_name)`
    )
    .order('started_at', { ascending: false })
    .limit(50);

  if (storeId) {
    query = query.eq('store_id', storeId);
  }

  const { data, error } = await query;
  if (error) {
    return {
      batches: [],
      error: `Failed to load batch history: ${error.message}`,
    };
  }

  const normalized: BatchHistoryRecord[] = (data ?? []).map((item: Record<string, unknown>) => {
    const rawStores = item.stores;
    const storeObj = Array.isArray(rawStores) ? rawStores[0] : rawStores;
    return {
      ...(item as unknown as BatchHistoryRecord),
      stores: (storeObj as { store_code: string; store_name: string } | null) ?? null,
    };
  });

  return { batches: normalized };
}

/**
 * Loads row-level outcomes and order revision snapshots for a specific batch.
 */
export async function fetchBatchInspectionDetails(batchId: string): Promise<{
  batchRows: BatchRowAuditRecord[];
  revisions: OrderRevisionAuditRecord[];
  error?: string;
}> {
  const [rowsRes, revRes] = await Promise.all([
    supabase
      .from('ingestion_batch_rows')
      .select(
        'id, source_row_number, order_id, action, row_hash, validation_errors, processed_at'
      )
      .eq('batch_id', batchId)
      .order('source_row_number', { ascending: true })
      .limit(250),
    supabase
      .from('order_revision_history')
      .select(
        'id, order_id, action_type, changed_fields, previous_source_snapshot, new_source_snapshot, previous_derived_snapshot, new_derived_snapshot, changed_at'
      )
      .eq('batch_id', batchId)
      .order('changed_at', { ascending: false })
      .limit(100),
  ]);

  if (rowsRes.error) {
    return {
      batchRows: [],
      revisions: [],
      error: `Failed to load batch rows: ${rowsRes.error.message}`,
    };
  }
  if (revRes.error) {
    return {
      batchRows: (rowsRes.data ?? []) as BatchRowAuditRecord[],
      revisions: [],
      error: `Failed to load order revisions: ${revRes.error.message}`,
    };
  }

  return {
    batchRows: (rowsRes.data ?? []) as BatchRowAuditRecord[],
    revisions: (revRes.data ?? []) as OrderRevisionAuditRecord[],
  };
}
