// ==============================================================================
// CSV & Excel Workbook Parser (SheetJS)
// Supports .csv (default download format) as well as .xlsx / .xls workbooks.
// Automatically detects either 'Raw Data' or any system-generated worksheet
// name (e.g., UUID-named sheets), maps all 29 columns dynamically by header
// name, computes the SHA-256 file checksum, and runs validation + transformation.
// ==============================================================================

import * as XLSX from 'xlsx';
import { sha256Bytes } from './hash';
import { isBlankOrNullLiteral } from './normalizer';
import type {
  RawCellValue,
  RawHeaderName,
  RawOrderRow,
  StoreMaster,
  WorkbookValidationResult,
} from './types';
import { EXPECTED_RAW_HEADERS } from './types';
import { processAndValidateOrderRows, validateHeaders } from './validator';

export const RAW_DATA_SHEET_NAME = 'Raw Data';
export const TRANSFORM_SHEET_NAME = 'Transform';

/**
 * Selects the target source worksheet from a parsed workbook:
 *   1. Prefers 'Raw Data' (case-insensitive) if present.
 *   2. Otherwise selects the first worksheet that is not 'Transform' (supporting
 *      system-generated random/UUID sheet names and single-sheet .csv files).
 */
export function resolveSourceWorksheetName(sheetNames: string[]): string | null {
  if (!sheetNames || sheetNames.length === 0) return null;

  const exactRawData = sheetNames.find(
    (n) => n.trim().toLowerCase() === RAW_DATA_SHEET_NAME.toLowerCase()
  );
  if (exactRawData) return exactRawData;

  const firstNonTransform = sheetNames.find(
    (n) => n.trim().toLowerCase() !== TRANSFORM_SHEET_NAME.toLowerCase()
  );
  return firstNonTransform ?? null;
}

/**
 * Parses and validates an uploaded CSV or Excel file buffer against the selected
 * StoreMaster.
 */
export function parseAndValidateOrderWorkbook(params: {
  fileBytes: Uint8Array | ArrayBuffer;
  filename: string;
  store: StoreMaster;
}): WorkbookValidationResult {
  const { filename, store } = params;
  const bytes =
    params.fileBytes instanceof Uint8Array
      ? params.fileBytes
      : new Uint8Array(params.fileBytes);

  const fileChecksumSha256 = sha256Bytes(bytes);
  const fileSizeBytes = bytes.byteLength;
  const isCsvFile = filename.trim().toLowerCase().endsWith('.csv');

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: 'array',
      cellDates: false,
      raw: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      filename,
      file_size_bytes: fileSizeBytes,
      file_checksum_sha256: fileChecksumSha256,
      worksheet_found: false,
      detected_sheet_name: null,
      missing_headers: [...EXPECTED_RAW_HEADERS],
      unexpected_headers: [],
      file_errors: [`Failed to parse uploaded file: ${message}`],
      file_warnings: [],
      total_rows_detected: 0,
      valid_rows_count: 0,
      invalid_rows_count: 0,
      duplicate_order_ids: [],
      status_distribution: {},
      min_order_date: null,
      max_order_date: null,
      is_valid: false,
      rows: [],
    };
  }

  const targetSheetName = resolveSourceWorksheetName(workbook.SheetNames);
  const sheet = targetSheetName ? workbook.Sheets[targetSheetName] : undefined;
  const displaySheetName = isCsvFile ? 'CSV' : targetSheetName;

  if (!sheet || !targetSheetName) {
    return processAndValidateOrderRows({
      filename,
      fileSizeBytes,
      fileChecksumSha256,
      worksheetFound: false,
      detectedSheetName: null,
      missingHeaders: [...EXPECTED_RAW_HEADERS],
      unexpectedHeaders: [],
      rawRows: [],
      store,
    });
  }

  // Extract 2D array of rows (preserving 1-based row numbers)
  const matrix = XLSX.utils.sheet_to_json<RawCellValue[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });

  if (matrix.length === 0) {
    return processAndValidateOrderRows({
      filename,
      fileSizeBytes,
      fileChecksumSha256,
      worksheetFound: true,
      detectedSheetName: displaySheetName,
      missingHeaders: [...EXPECTED_RAW_HEADERS],
      unexpectedHeaders: [],
      rawRows: [],
      store,
    });
  }

  // Row 1 (index 0) is the header row (strip UTF-8 BOM if present)
  const headerRowCells = matrix[0] ?? [];
  const rawHeaders: string[] = headerRowCells.map((cell) =>
    cell === null || cell === undefined
      ? ''
      : String(cell).replace(/^\uFEFF/, '')
  );

  const { missingHeaders, unexpectedHeaders, duplicateHeaders } =
    validateHeaders(rawHeaders);

  // Build header-name -> column-index lookup (case-insensitive, trimmed)
  const headerToIndex = new Map<RawHeaderName, number>();
  const lowerToExpected = new Map<string, RawHeaderName>();
  for (const expected of EXPECTED_RAW_HEADERS) {
    lowerToExpected.set(expected.toLowerCase(), expected);
  }

  rawHeaders.forEach((h, colIdx) => {
    const trimmedLower = h.replace(/^\uFEFF/, '').trim().toLowerCase();
    const canonical = lowerToExpected.get(trimmedLower);
    if (canonical && !headerToIndex.has(canonical)) {
      headerToIndex.set(canonical, colIdx);
    }
  });

  // Extract data rows starting from index 1 (Row 2)
  const rawRows: Array<{ sourceRowNumber: number; rawRow: RawOrderRow }> = [];

  if (missingHeaders.length === 0 && duplicateHeaders.length === 0) {
    for (let rowIdx = 1; rowIdx < matrix.length; rowIdx++) {
      const rowCells = matrix[rowIdx];
      if (!rowCells || rowCells.length === 0) continue;

      const rawRow = {} as RawOrderRow;
      let hasAnyNonEmptyValue = false;

      for (const expectedHeader of EXPECTED_RAW_HEADERS) {
        const colIdx = headerToIndex.get(expectedHeader);
        const cellVal = colIdx !== undefined ? (rowCells[colIdx] ?? null) : null;
        rawRow[expectedHeader] = cellVal;
        if (!isBlankOrNullLiteral(cellVal)) {
          hasAnyNonEmptyValue = true;
        }
      }

      // Skip completely blank trailing rows
      if (!hasAnyNonEmptyValue) {
        continue;
      }

      rawRows.push({
        sourceRowNumber: rowIdx + 1, // 1-based row number
        rawRow,
      });
    }
  }

  return processAndValidateOrderRows({
    filename,
    fileSizeBytes,
    fileChecksumSha256,
    worksheetFound: true,
    detectedSheetName: displaySheetName,
    missingHeaders,
    unexpectedHeaders,
    duplicateHeaders,
    rawRows,
    store,
  });
}

export interface TransformSheetReferenceRow {
  sourceRowNumber: number;
  orderId: string;
  status: string;
  orderType: string;
  storeCode: string;
  slotHour: number;
  dayOfMonth: number;
  stagingToPickupMinutes: number;
  s2pMinutes: number;
  distanceMeters: number;
  actualArrivalMinutes: number;
  arrivalEtaMinutes: number;
  otpPerformance: string;
  otpPlus3Performance: string;
}

/**
 * Test-only helper: reads the 'Transform' worksheet from the reference workbook
 * to compare calculated values in automated regression tests.
 * Never used for production ingestion.
 */
export function readTransformSheetForRegressionTest(
  fileBytes: Uint8Array | ArrayBuffer
): TransformSheetReferenceRow[] {
  const bytes =
    fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);
  const workbook = XLSX.read(bytes, {
    type: 'array',
    cellDates: false,
    raw: true,
  });

  const sheet = workbook.Sheets[TRANSFORM_SHEET_NAME];
  if (!sheet) {
    throw new Error(`Worksheet "${TRANSFORM_SHEET_NAME}" not found in reference workbook.`);
  }

  const matrix = XLSX.utils.sheet_to_json<RawCellValue[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });

  const headerRow = (matrix[0] ?? []).map((c) =>
    c === null || c === undefined ? '' : String(c).trim()
  );
  const colIdx = (name: string): number => {
    const idx = headerRow.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    if (idx === -1) {
      throw new Error(`Header "${name}" not found in Transform sheet`);
    }
    return idx;
  };

  const idxOrderId = colIdx('Order ID');
  const idxStatus = colIdx('Status');
  const idxOrderType = colIdx('Order Type');
  const idxStoreCode = colIdx('Store Code');
  const idxSlot = colIdx('Slot');
  const idxDate = colIdx('Date');
  const idxTime = colIdx('Time');
  const idxS2p = colIdx('S2P');
  const idxDistance = colIdx('Distance');
  const idxActualArrival = colIdx('Actual Arrival Time');
  const idxArrivalEta = colIdx('Arrival Time ETA');
  const idxOtp = colIdx('OTP Performance');
  const idxOtpPlus3 = colIdx('OTP+3 Performance');

  const results: TransformSheetReferenceRow[] = [];

  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row) continue;
    const rawOrderId = row[idxOrderId];
    if (isBlankOrNullLiteral(rawOrderId)) {
      continue;
    }

    results.push({
      sourceRowNumber: i + 1,
      orderId: String(rawOrderId).trim(),
      status: String(row[idxStatus] ?? '').trim(),
      orderType: String(row[idxOrderType] ?? '').trim(),
      storeCode: String(row[idxStoreCode] ?? '').trim(),
      slotHour: Number(row[idxSlot] ?? 0),
      dayOfMonth: Number(row[idxDate] ?? 0),
      stagingToPickupMinutes: Number(row[idxTime] ?? 0),
      s2pMinutes: Number(row[idxS2p] ?? 0),
      distanceMeters: Number(row[idxDistance] ?? 0),
      actualArrivalMinutes: Number(row[idxActualArrival] ?? 0),
      arrivalEtaMinutes: Number(row[idxArrivalEta] ?? 0),
      otpPerformance: String(row[idxOtp] ?? '').trim(),
      otpPlus3Performance: String(row[idxOtpPlus3] ?? '').trim(),
    });
  }

  return results;
}
