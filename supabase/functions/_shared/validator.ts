// ==============================================================================
// Schema & Business-Rule Validation Engine
// Enforces header-based mapping, single-store verification, intra-file Order ID
// uniqueness, required field checks, and Strict All-or-Nothing batch validation.
// ==============================================================================

import { computeSourceRowHash } from './hash.ts';
import { normalizeOrderRow } from './normalizer.ts';
import { calculateDerivedFields, extractSourceStorePrefix } from './transformer.ts';
import type {
  DuplicateOrderIdEntry,
  FieldValidationIssue,
  NormalizedOrderSource,
  ProcessedOrderRow,
  RawHeaderName,
  RawOrderRow,
  StoreMaster,
  WorkbookValidationResult,
} from './types.ts';
import { EXPECTED_RAW_HEADERS } from './types.ts';

export interface HeaderValidationResult {
  missingHeaders: string[];
  unexpectedHeaders: string[];
  duplicateHeaders: string[];
  headerMap: Map<RawHeaderName, string>;
}

/**
 * Validates the detected worksheet header row against the 29 expected source
 * columns (order-independent, case-insensitive, whitespace-normalized).
 */
export function validateHeaders(rawHeaders: string[]): HeaderValidationResult {
  const normalizedToActual = new Map<string, string>();
  const seenNormalized = new Set<string>();
  const duplicateHeaders: string[] = [];

  for (const h of rawHeaders) {
    const trimmed = h.replace(/^\uFEFF/, '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seenNormalized.has(key)) {
      duplicateHeaders.push(trimmed);
    } else {
      seenNormalized.add(key);
      normalizedToActual.set(key, trimmed);
    }
  }

  const missingHeaders: string[] = [];
  const headerMap = new Map<RawHeaderName, string>();
  const expectedLowerSet = new Set<string>();

  for (const expected of EXPECTED_RAW_HEADERS) {
    const lower = expected.toLowerCase();
    expectedLowerSet.add(lower);
    const actual = normalizedToActual.get(lower);
    if (!actual) {
      missingHeaders.push(expected);
    } else {
      headerMap.set(expected, actual);
    }
  }

  const unexpectedHeaders: string[] = [];
  for (const h of rawHeaders) {
    const trimmed = h.replace(/^\uFEFF/, '').trim();
    if (!trimmed) continue;
    if (!expectedLowerSet.has(trimmed.toLowerCase())) {
      unexpectedHeaders.push(trimmed);
    }
  }

  return {
    missingHeaders,
    unexpectedHeaders,
    duplicateHeaders,
    headerMap,
  };
}

/**
 * Validates a normalized order source record against required field rules and
 * the selected StoreMaster record.
 */
export function validateNormalizedOrder(
  source: NormalizedOrderSource,
  store: StoreMaster,
  existingIssues: FieldValidationIssue[] = []
): FieldValidationIssue[] {
  const issues: FieldValidationIssue[] = [...existingIssues];

  const hasParseErrorOn = (fieldName: string) =>
    issues.some((i) => i.field === fieldName && i.severity === 'error');

  // 1. Order ID is mandatory
  if (!source.order_id) {
    issues.push({
      field: 'Order ID',
      severity: 'error',
      code: 'REQUIRED_FIELD_MISSING',
      message: 'Order ID is required for every order.',
    });
  }

  // 2. Store Name & Store Code verification against selected store
  if (!source.source_store_name) {
    issues.push({
      field: 'Store Name',
      severity: 'error',
      code: 'REQUIRED_FIELD_MISSING',
      message: 'Store Name is required.',
    });
  } else {
    const extractedCode = extractSourceStorePrefix(source.source_store_name);
    const expectedCode = store.store_code.trim().toUpperCase();
    if (extractedCode !== expectedCode) {
      issues.push({
        field: 'Store Name',
        severity: 'error',
        code: 'STORE_MISMATCH',
        message: `Source Store Name prefix "${extractedCode}" does not match selected store "${expectedCode}".`,
      });
    }
  }

  // 3. External Store ID verification against selected store
  if (!source.external_store_id) {
    issues.push({
      field: 'Store ID',
      severity: 'error',
      code: 'REQUIRED_FIELD_MISSING',
      message: 'Store ID is required.',
    });
  } else if (
    store.external_store_id &&
    source.external_store_id.trim() !== store.external_store_id.trim()
  ) {
    issues.push({
      field: 'Store ID',
      severity: 'error',
      code: 'STORE_ID_MISMATCH',
      message: `Source Store ID "${source.external_store_id}" does not match selected store external ID "${store.external_store_id}".`,
    });
  }

  // 4. Created At is mandatory for slot_hour and order_date
  if (!source.order_created_at && !hasParseErrorOn('Created At')) {
    issues.push({
      field: 'Created At',
      severity: 'error',
      code: 'REQUIRED_FIELD_MISSING',
      message: 'Created At timestamp is required to derive Slot and Order Date.',
    });
  }

  // 5. Status is mandatory
  if (!source.status) {
    issues.push({
      field: 'Status',
      severity: 'error',
      code: 'REQUIRED_FIELD_MISSING',
      message: 'Status is required.',
    });
  }

  // 6. LM Distance is mandatory
  if (source.lm_distance === null && !hasParseErrorOn('LM Distance')) {
    issues.push({
      field: 'LM Distance',
      severity: 'error',
      code: 'REQUIRED_FIELD_MISSING',
      message: 'LM Distance is required.',
    });
  }

  // 7. Arrive at Delivery ETA is mandatory
  if (!source.arrive_at_delivery_eta && !hasParseErrorOn('Arrive at Delivery ETA')) {
    issues.push({
      field: 'Arrive at Delivery ETA',
      severity: 'error',
      code: 'REQUIRED_FIELD_MISSING',
      message: 'Arrive at Delivery ETA is required.',
    });
  }

  // 8. Status-specific required timestamps
  if (source.status === 'COMPLETED') {
    if (!source.staged_at && !hasParseErrorOn('Staged At')) {
      issues.push({
        field: 'Staged At',
        severity: 'error',
        code: 'REQUIRED_FOR_COMPLETED',
        message: 'Staged At timestamp is required for COMPLETED orders.',
      });
    }
    if (!source.pickup_at && !hasParseErrorOn('Pickup At')) {
      issues.push({
        field: 'Pickup At',
        severity: 'error',
        code: 'REQUIRED_FOR_COMPLETED',
        message: 'Pickup At timestamp is required for COMPLETED orders.',
      });
    }
    if (!source.arrived_delivery_at && !hasParseErrorOn('Arrived Delivery At')) {
      issues.push({
        field: 'Arrived Delivery At',
        severity: 'error',
        code: 'REQUIRED_FOR_COMPLETED',
        message: 'Arrived Delivery At timestamp is required for COMPLETED orders.',
      });
    }
    if (!source.rider_number) {
      issues.push({
        field: 'Rider Number',
        severity: 'warning',
        code: 'MISSING_OPTIONAL_FIELD',
        message: 'Rider Number is missing on a COMPLETED order.',
      });
    }
  } else if (source.status === 'RTO_DELIVERED') {
    if (!source.staged_at && !hasParseErrorOn('Staged At')) {
      issues.push({
        field: 'Staged At',
        severity: 'error',
        code: 'REQUIRED_FOR_RTO',
        message: 'Staged At timestamp is required for RTO_DELIVERED orders.',
      });
    }
    if (!source.pickup_at && !hasParseErrorOn('Pickup At')) {
      issues.push({
        field: 'Pickup At',
        severity: 'error',
        code: 'REQUIRED_FOR_RTO',
        message: 'Pickup At timestamp is required for RTO_DELIVERED orders.',
      });
    }
  }

  return issues;
}

/**
 * Processes and validates a list of extracted raw order rows against the selected
 * StoreMaster, enforcing Strict All-or-Nothing validation (Option A).
 */
export function processAndValidateOrderRows(params: {
  filename: string;
  fileSizeBytes: number;
  fileChecksumSha256: string;
  worksheetFound: boolean;
  detectedSheetName?: string | null;
  missingHeaders: string[];
  unexpectedHeaders: string[];
  duplicateHeaders?: string[];
  rawRows: Array<{ sourceRowNumber: number; rawRow: RawOrderRow }>;
  store: StoreMaster;
}): WorkbookValidationResult {
  const {
    filename,
    fileSizeBytes,
    fileChecksumSha256,
    worksheetFound,
    detectedSheetName = null,
    missingHeaders,
    unexpectedHeaders,
    duplicateHeaders = [],
    rawRows,
    store,
  } = params;

  const fileErrors: string[] = [];
  const fileWarnings: string[] = [];

  if (!worksheetFound) {
    fileErrors.push('No valid data worksheet or CSV content was found in the uploaded file.');
  }

  if (missingHeaders.length > 0) {
    fileErrors.push(
      `Missing mandatory column headers (${missingHeaders.length}): ${missingHeaders.join(', ')}`
    );
  }

  if (duplicateHeaders.length > 0) {
    fileErrors.push(
      `Duplicate column headers detected in uploaded file: ${duplicateHeaders.join(', ')}`
    );
  }

  if (unexpectedHeaders.length > 0) {
    fileWarnings.push(
      `Unexpected additional columns ignored (${unexpectedHeaders.length}): ${unexpectedHeaders.join(', ')}`
    );
  }

  if (worksheetFound && missingHeaders.length === 0 && rawRows.length === 0) {
    fileErrors.push('The uploaded file contains no order data rows.');
  }

  // First pass: normalize, validate fields, calculate derived fields, and track Order IDs
  const orderIdToRows = new Map<string, number[]>();
  const processedRows: ProcessedOrderRow[] = [];
  const detectedStoreCodes = new Set<string>();
  const detectedExternalStoreIds = new Set<string>();

  for (const { sourceRowNumber, rawRow } of rawRows) {
    const { normalized, rawSnapshot, issues: parseIssues } = normalizeOrderRow(rawRow);
    const issues = validateNormalizedOrder(normalized, store, parseIssues);
    const derived = calculateDerivedFields(normalized, store);
    const rowHash = computeSourceRowHash(normalized);

    if (normalized.order_id) {
      const key = normalized.order_id.toUpperCase();
      const list = orderIdToRows.get(key) ?? [];
      list.push(sourceRowNumber);
      orderIdToRows.set(key, list);
    }

    if (normalized.source_store_name) {
      detectedStoreCodes.add(extractSourceStorePrefix(normalized.source_store_name));
    }
    if (normalized.external_store_id) {
      detectedExternalStoreIds.add(normalized.external_store_id);
    }

    const hasError = issues.some((i) => i.severity === 'error');
    processedRows.push({
      source_row_number: sourceRowNumber,
      raw_source_snapshot: rawSnapshot,
      normalized_source: normalized,
      derived_fields: derived,
      source_row_hash: rowHash,
      issues,
      is_valid: !hasError,
    });
  }

  // Second pass: flag intra-file duplicate Order IDs
  const duplicateOrderIds: DuplicateOrderIdEntry[] = [];
  for (const [, rows] of orderIdToRows.entries()) {
    if (rows.length > 1) {
      const firstRow = processedRows.find((r) => r.source_row_number === rows[0]);
      const displayOrderId = firstRow?.normalized_source.order_id ?? '';
      duplicateOrderIds.push({ order_id: displayOrderId, rows });
    }
  }

  if (duplicateOrderIds.length > 0) {
    const dupRowMap = new Map<number, number[]>();
    for (const dup of duplicateOrderIds) {
      for (const rNum of dup.rows) {
        dupRowMap.set(rNum, dup.rows);
      }
    }

    for (const row of processedRows) {
      const dupRows = dupRowMap.get(row.source_row_number);
      if (dupRows) {
        row.issues.push({
          field: 'Order ID',
          severity: 'error',
          code: 'DUPLICATE_ORDER_ID',
          message: `Duplicate Order ID "${row.normalized_source.order_id}" appears multiple times in this file (rows: ${dupRows.join(', ')}).`,
        });
        row.is_valid = false;
      }
    }

    fileErrors.push(
      `Found ${duplicateOrderIds.length} duplicate Order ID(s) within the uploaded file.`
    );
  }

  // Check for mixed-store data across the file
  if (detectedStoreCodes.size > 1 || detectedExternalStoreIds.size > 1) {
    fileErrors.push(
      `Mixed-store data detected in file (Store Codes: ${Array.from(detectedStoreCodes).join(', ')}; Store IDs: ${Array.from(detectedExternalStoreIds).join(', ')}). Each upload must contain orders for a single selected store.`
    );
  }

  // Compute summary metrics and determine the dominant (majority) Business Date
  // across the uploaded file so post-midnight spillover orders stay attributed
  // to the file's primary business date.
  let validRowsCount = 0;
  let invalidRowsCount = 0;
  const statusDistribution: Record<string, number> = {};
  const dateFrequency = new Map<string, number>();

  for (const row of processedRows) {
    if (row.is_valid) {
      validRowsCount += 1;
    } else {
      invalidRowsCount += 1;
    }

    const st = row.normalized_source.status || 'UNKNOWN';
    statusDistribution[st] = (statusDistribution[st] ?? 0) + 1;

    if (row.normalized_source.order_created_at && row.derived_fields.order_date !== '1970-01-01') {
      const d = row.derived_fields.order_date;
      dateFrequency.set(d, (dateFrequency.get(d) ?? 0) + 1);
    }
  }

  let dominantOrderDate: string | null = null;
  let dominantDateCount = -1;
  for (const [dateStr, count] of dateFrequency.entries()) {
    if (
      count > dominantDateCount ||
      (count === dominantDateCount && dominantOrderDate !== null && dateStr < dominantOrderDate)
    ) {
      dominantOrderDate = dateStr;
      dominantDateCount = count;
    }
  }

  if (dominantOrderDate) {
    for (const row of processedRows) {
      if (row.normalized_source.order_created_at && row.derived_fields.order_date !== '1970-01-01') {
        row.derived_fields.order_date = dominantOrderDate;
      }
    }
  }

  const minOrderDate: string | null = dominantOrderDate;
  const maxOrderDate: string | null = dominantOrderDate;

  // Strict All-or-Nothing Validation Policy (Option A)
  const isValid =
    worksheetFound &&
    missingHeaders.length === 0 &&
    duplicateHeaders.length === 0 &&
    fileErrors.length === 0 &&
    processedRows.length > 0 &&
    invalidRowsCount === 0;

  return {
    filename,
    file_size_bytes: fileSizeBytes,
    file_checksum_sha256: fileChecksumSha256,
    worksheet_found: worksheetFound,
    detected_sheet_name: detectedSheetName,
    missing_headers: missingHeaders,
    unexpected_headers: unexpectedHeaders,
    file_errors: fileErrors,
    file_warnings: fileWarnings,
    total_rows_detected: processedRows.length,
    valid_rows_count: validRowsCount,
    invalid_rows_count: invalidRowsCount,
    duplicate_order_ids: duplicateOrderIds,
    status_distribution: statusDistribution,
    min_order_date: minOrderDate,
    max_order_date: maxOrderDate,
    is_valid: isValid,
    rows: processedRows,
  };
}
