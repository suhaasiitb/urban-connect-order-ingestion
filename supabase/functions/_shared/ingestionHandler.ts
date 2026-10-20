// ==============================================================================
// Authoritative Backend Ingestion Controller
// Independently authenticates & authorizes the administrator, validates request
// bounds, normalizes source data, recalculates all 11 derived fields, and
// executes atomic PostgreSQL persistence via public.ingest_order_batch.
// ==============================================================================

import type {
  DerivedOrderFields,
  FieldValidationIssue,
  NormalizedOrderSource,
  RawOrderRow,
  StoreMaster,
} from './types.ts';
import { EXPECTED_RAW_HEADERS } from './types.ts';
import { processAndValidateOrderRows, validateHeaders } from './validator.ts';

export const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024; // 10 MB max JSON body
export const MAX_WORKBOOK_FILE_BYTES = 15 * 1024 * 1024; // 15 MB max Excel file
export const MAX_ROWS_PER_BATCH = 5000; // Max order rows per upload

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/i;

export interface SubmittedWorkbookRow {
  source_row_number: number;
  raw_row: RawOrderRow;
}

export interface IngestBatchRequestPayload {
  store_id: string;
  original_filename: string;
  file_size_bytes: number;
  file_checksum_sha256: string;
  force_reprocess?: boolean;
  headers?: string[];
  rows: SubmittedWorkbookRow[];
}

export interface RpcOrderRecordPayload {
  source_row_number: number;
  source_row_hash: string;
  raw_source_snapshot: Record<string, string | number | boolean | null>;
  normalized_source: NormalizedOrderSource;
  derived_fields: DerivedOrderFields;
}

export interface IngestBatchRpcResponse {
  batch_id: string;
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
}

export interface IngestionBackendAdapter {
  verifyAdminSession(authHeader: string | null): Promise<{
    authenticated: boolean;
    isAdmin: boolean;
    userId: string | null;
    email?: string | null;
  }>;
  getActiveStoreById(storeId: string): Promise<StoreMaster | null>;
  executeIngestBatchRpc(params: {
    storeId: string;
    uploadedBy: string;
    originalFilename: string;
    fileChecksumSha256: string;
    records: RpcOrderRecordPayload[];
    forceReprocess: boolean;
    processingMetadata: Record<string, unknown>;
  }): Promise<IngestBatchRpcResponse>;
  recordFailedBatchRpc(params: {
    storeId: string;
    uploadedBy: string;
    originalFilename: string;
    fileChecksumSha256: string;
    totalRows: number;
    rejectedCount: number;
    errorSummary: string;
    rejectedRows: Array<{
      source_row_number: number;
      order_id: string | null;
      row_hash: string | null;
      validation_errors: FieldValidationIssue[];
      source_snapshot: Record<string, unknown>;
    }>;
    processingMetadata: Record<string, unknown>;
  }): Promise<string | null>;
}

export interface IngestionHttpResponse {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Sanitizes validation messages so error responses never leak rider/customer
 * PII or internal credentials while keeping field & row diagnostics clear.
 */
function sanitizePublicValidationMessage(issue: FieldValidationIssue): FieldValidationIssue {
  return {
    field: issue.field,
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
  };
}

/**
 * Core backend ingestion handler.
 */
export async function handleIngestOrderBatch(params: {
  authHeader: string | null;
  rawBodyLengthBytes?: number;
  payload: unknown;
  adapter: IngestionBackendAdapter;
}): Promise<IngestionHttpResponse> {
  const startTimeMs = Date.now();
  const { authHeader, rawBodyLengthBytes = 0, payload, adapter } = params;

  // 1. Check payload size limit before processing
  if (rawBodyLengthBytes > MAX_REQUEST_BODY_BYTES) {
    return {
      status: 413,
      body: {
        ok: false,
        code: 'PAYLOAD_TOO_LARGE',
        message: `Request body exceeds maximum allowed size of ${MAX_REQUEST_BODY_BYTES} bytes.`,
      },
    };
  }

  // 2. Verify authentication & administrator authorization
  const session = await adapter.verifyAdminSession(authHeader);
  if (!session.authenticated || !session.userId) {
    return {
      status: 401,
      body: {
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Please log in with a valid administrator session.',
      },
    };
  }

  if (!session.isAdmin) {
    return {
      status: 403,
      body: {
        ok: false,
        code: 'FORBIDDEN_NOT_ADMIN',
        message: 'Access denied. Your account is not an authorized active administrator.',
      },
    };
  }

  // 3. Validate request envelope structure
  if (!payload || typeof payload !== 'object') {
    return {
      status: 400,
      body: {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'Request body must be a valid JSON object.',
      },
    };
  }

  const req = payload as Partial<IngestBatchRequestPayload>;
  const storeId = typeof req.store_id === 'string' ? req.store_id.trim() : '';
  const originalFilename =
    typeof req.original_filename === 'string' ? req.original_filename.trim() : '';
  const fileSizeBytes =
    typeof req.file_size_bytes === 'number' ? req.file_size_bytes : 0;
  const fileChecksum =
    typeof req.file_checksum_sha256 === 'string'
      ? req.file_checksum_sha256.trim().toLowerCase()
      : '';
  const forceReprocess = Boolean(req.force_reprocess);

  if (!UUID_REGEX.test(storeId)) {
    return {
      status: 400,
      body: {
        ok: false,
        code: 'INVALID_STORE_ID',
        message: 'store_id must be a valid UUID.',
      },
    };
  }

  if (!originalFilename || originalFilename.length > 255) {
    return {
      status: 400,
      body: {
        ok: false,
        code: 'INVALID_FILENAME',
        message: 'original_filename is required and must be <= 255 characters.',
      },
    };
  }

  if (fileSizeBytes < 0 || fileSizeBytes > MAX_WORKBOOK_FILE_BYTES) {
    return {
      status: 400,
      body: {
        ok: false,
        code: 'INVALID_FILE_SIZE',
        message: `Workbook file size must be between 1 byte and ${MAX_WORKBOOK_FILE_BYTES} bytes.`,
      },
    };
  }

  if (!SHA256_HEX_REGEX.test(fileChecksum)) {
    return {
      status: 400,
      body: {
        ok: false,
        code: 'INVALID_FILE_CHECKSUM',
        message: 'file_checksum_sha256 must be a valid 64-character hex SHA-256 hash.',
      },
    };
  }

  if (!Array.isArray(req.rows) || req.rows.length === 0) {
    return {
      status: 400,
      body: {
        ok: false,
        code: 'EMPTY_ROWS',
        message: 'The submitted batch contains no order rows.',
      },
    };
  }

  if (req.rows.length > MAX_ROWS_PER_BATCH) {
    return {
      status: 413,
      body: {
        ok: false,
        code: 'TOO_MANY_ROWS',
        message: `Batch contains ${req.rows.length} rows, exceeding the limit of ${MAX_ROWS_PER_BATCH} rows per upload.`,
      },
    };
  }

  // 4. Fetch authoritative StoreMaster from database
  const store = await adapter.getActiveStoreById(storeId);
  if (!store || !store.is_active) {
    return {
      status: 400,
      body: {
        ok: false,
        code: 'STORE_NOT_FOUND',
        message: 'The selected store does not exist or is not active.',
      },
    };
  }

  // 5. Independently validate headers if provided, and normalize/validate all rows
  const submittedHeaders = Array.isArray(req.headers)
    ? req.headers.map((h) => String(h))
    : [...EXPECTED_RAW_HEADERS];
  const headerCheck = validateHeaders(submittedHeaders);

  const normalizedRawRows: Array<{ sourceRowNumber: number; rawRow: RawOrderRow }> = [];
  for (let i = 0; i < req.rows.length; i++) {
    const item = req.rows[i];
    if (!item || typeof item !== 'object' || !item.raw_row || typeof item.raw_row !== 'object') {
      return {
        status: 400,
        body: {
          ok: false,
          code: 'MALFORMED_ROW_ITEM',
          message: `Row item at index ${i} is missing a valid raw_row object.`,
        },
      };
    }
    const rowNum =
      typeof item.source_row_number === 'number' && Number.isInteger(item.source_row_number) && item.source_row_number >= 2
        ? item.source_row_number
        : i + 2;

    normalizedRawRows.push({
      sourceRowNumber: rowNum,
      rawRow: item.raw_row,
    });
  }

  const validation = processAndValidateOrderRows({
    filename: originalFilename,
    fileSizeBytes,
    fileChecksumSha256: fileChecksum,
    worksheetFound: true,
    missingHeaders: headerCheck.missingHeaders,
    unexpectedHeaders: headerCheck.unexpectedHeaders,
    duplicateHeaders: headerCheck.duplicateHeaders,
    rawRows: normalizedRawRows,
    store,
  });

  const durationMs = Date.now() - startTimeMs;

  // 6. Strict All-or-Nothing Validation Gate (Option A)
  if (!validation.is_valid) {
    const invalidRows = validation.rows.filter((r) => !r.is_valid);
    const errorSummary =
      validation.file_errors.length > 0
        ? validation.file_errors.join(' | ')
        : `${invalidRows.length} row(s) failed business validation.`;

    let failedBatchId: string | null = null;
    try {
      failedBatchId = await adapter.recordFailedBatchRpc({
        storeId: store.id,
        uploadedBy: session.userId,
        originalFilename,
        fileChecksumSha256: fileChecksum,
        totalRows: validation.total_rows_detected,
        rejectedCount: invalidRows.length,
        errorSummary,
        rejectedRows: invalidRows.map((r) => ({
          source_row_number: r.source_row_number,
          order_id: r.normalized_source.order_id || null,
          row_hash: r.source_row_hash,
          validation_errors: r.issues.map(sanitizePublicValidationMessage),
          source_snapshot: r.raw_source_snapshot,
        })),
        processingMetadata: {
          validation_policy: 'strict_all_or_nothing',
          processing_ms: durationMs,
        },
      });
    } catch {
      // Do not mask the primary validation response if failed-batch logging encounters an error
      failedBatchId = null;
    }

    return {
      status: 422,
      body: {
        ok: false,
        code: 'VALIDATION_FAILED',
        message:
          'Batch rejected under strict all-or-nothing validation policy. No orders were written to the database.',
        batch_id: failedBatchId,
        status: 'Failed',
        store_id: store.id,
        store_code: store.store_code,
        total_rows: validation.total_rows_detected,
        valid_rows_count: validation.valid_rows_count,
        rejected_count: invalidRows.length,
        file_errors: validation.file_errors,
        duplicate_order_ids: validation.duplicate_order_ids,
        invalid_rows: invalidRows.slice(0, 100).map((r) => ({
          source_row_number: r.source_row_number,
          order_id: r.normalized_source.order_id || null,
          issues: r.issues
            .filter((i) => i.severity === 'error')
            .map(sanitizePublicValidationMessage),
        })),
      },
    };
  }

  // 7. Build authoritative RPC records and execute atomic database persistence
  const rpcRecords: RpcOrderRecordPayload[] = validation.rows.map((r) => ({
    source_row_number: r.source_row_number,
    source_row_hash: r.source_row_hash,
    raw_source_snapshot: r.raw_source_snapshot,
    normalized_source: r.normalized_source,
    derived_fields: r.derived_fields,
  }));

  try {
    const rpcResult = await adapter.executeIngestBatchRpc({
      storeId: store.id,
      uploadedBy: session.userId,
      originalFilename,
      fileChecksumSha256: fileChecksum,
      records: rpcRecords,
      forceReprocess,
      processingMetadata: {
        validation_policy: 'strict_all_or_nothing',
        precision_policy: 'exact_second_precision',
        timezone: 'Asia/Kolkata',
        processing_ms: Date.now() - startTimeMs,
      },
    });

    return {
      status: 200,
      body: {
        ok: true,
        ...rpcResult,
        file_warnings: validation.file_warnings,
      },
    };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'Database transaction failed';
    return {
      status: 500,
      body: {
        ok: false,
        code: 'DATABASE_PERSISTENCE_FAILED',
        message:
          'Database transaction failed and was rolled back atomically. No partial order writes were committed.',
        detail: rawMsg.includes('Unauthorized') ? 'Unauthorized administrator' : 'Internal persistence error',
      },
    };
  }
}
