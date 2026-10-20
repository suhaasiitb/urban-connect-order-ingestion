import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseAndValidateOrderWorkbook } from '../../src/domain/excelParser';
import { computeSourceRowHash } from '../../src/domain/hash';
import type { RawOrderRow, StoreMaster } from '../../src/domain/types';
import { EXPECTED_RAW_HEADERS } from '../../src/domain/types';
import { processAndValidateOrderRows, validateHeaders } from '../../src/domain/validator';

const TEST_STORE: StoreMaster = {
  id: '00000000-0000-4000-8000-000000000001',
  store_code: 'TMK7',
  store_name: 'Amazon Narhe (TMK7)',
  external_store_id: '4247',
  timezone: 'Asia/Kolkata',
  is_active: true,
};

function makeValidRawRow(overrides: Partial<RawOrderRow> = {}): RawOrderRow {
  return {
    'Rider Number': 'XXXXXX5447',
    'Arrived Pickup At': '2026-10-18 23:57:30',
    'LM Distance': 989,
    'Resting Point Name': 'null',
    'Total ETA': 4,
    'Completed At': 'null',
    'Resting Point ID': 'null',
    'Store Name': 'TMK7 | 11:57 PM | 1.0 KM',
    'Pickup At': '2026-10-18 23:58:42',
    'Order ETA Status': 'null',
    'Staged At': '2026-10-18 23:58:17',
    'Pickup ETA': 24,
    'Arrive at Pickup ETA': null,
    'Status Text': null,
    'Created At': '2026-10-18 23:57:25',
    'Status': 'COMPLETED',
    'Rider Name': 'Savidhan kisan Wahule',
    'Order ID': 'QC_405-2853124-8797901',
    'Store ID': 4247,
    'Total Time': 'null',
    'Arrive at Delivery ETA': '2026-10-19 00:02:31',
    'Arrived Delivery At': '2026-10-19 00:01:58',
    'Tracking URL': 'https://track.loadshare.net/order/wkj3qww',
    'Customer ID': 22411,
    'RTO At': null,
    'FM Distance': 0,
    'Assigned At': '23:57:00',
    'Delivery ETA': 3,
    'Batch ID': 'null',
    ...overrides,
  };
}

describe('Validator & Hash Unit Tests (Section 5 & Section 9)', () => {
  it('validates headers regardless of column order and reports missing or unexpected headers', () => {
    const reversedHeaders = [...EXPECTED_RAW_HEADERS].reverse();
    const res1 = validateHeaders(reversedHeaders);
    expect(res1.missingHeaders).toHaveLength(0);
    expect(res1.unexpectedHeaders).toHaveLength(0);
    expect(res1.duplicateHeaders).toHaveLength(0);

    const missingOrderAndStore = EXPECTED_RAW_HEADERS.filter(
      (h) => h !== 'Order ID' && h !== 'Store ID'
    ).concat(['Extra Column 1' as never]);
    const res2 = validateHeaders(missingOrderAndStore);
    expect(res2.missingHeaders).toEqual(['Order ID', 'Store ID']);
    expect(res2.unexpectedHeaders).toEqual(['Extra Column 1']);
  });

  it('rejects duplicate Order IDs within the same uploaded file', () => {
    const result = processAndValidateOrderRows({
      filename: 'dup.xlsx',
      fileSizeBytes: 1024,
      fileChecksumSha256: 'a'.repeat(64),
      worksheetFound: true,
      missingHeaders: [],
      unexpectedHeaders: [],
      rawRows: [
        { sourceRowNumber: 2, rawRow: makeValidRawRow({ 'Order ID': 'QC_DUP_001' }) },
        { sourceRowNumber: 3, rawRow: makeValidRawRow({ 'Order ID': 'QC_DUP_001' }) },
      ],
      store: TEST_STORE,
    });

    expect(result.is_valid).toBe(false);
    expect(result.duplicate_order_ids).toEqual([
      { order_id: 'QC_DUP_001', rows: [2, 3] },
    ]);
    expect(result.invalid_rows_count).toBe(2);
  });

  it('rejects files containing mixed-store or mismatched-store records', () => {
    const result = processAndValidateOrderRows({
      filename: 'mixed-store.xlsx',
      fileSizeBytes: 1024,
      fileChecksumSha256: 'b'.repeat(64),
      worksheetFound: true,
      missingHeaders: [],
      unexpectedHeaders: [],
      rawRows: [
        { sourceRowNumber: 2, rawRow: makeValidRawRow({ 'Order ID': 'QC_001' }) },
        {
          sourceRowNumber: 3,
          rawRow: makeValidRawRow({
            'Order ID': 'QC_002',
            'Store Name': 'XYZ9 | 11:00 PM | 1.2 KM',
            'Store ID': 9999,
          }),
        },
      ],
      store: TEST_STORE,
    });

    expect(result.is_valid).toBe(false);
    expect(result.invalid_rows_count).toBe(1);
    expect(result.file_errors.some((e) => e.includes('Mixed-store'))).toBe(true);
  });

  it('blocks batch under Strict All-or-Nothing (Option A) when a COMPLETED order lacks Arrived Delivery At', () => {
    const result = processAndValidateOrderRows({
      filename: 'invalid-row.xlsx',
      fileSizeBytes: 1024,
      fileChecksumSha256: 'c'.repeat(64),
      worksheetFound: true,
      missingHeaders: [],
      unexpectedHeaders: [],
      rawRows: [
        { sourceRowNumber: 2, rawRow: makeValidRawRow({ 'Order ID': 'QC_001' }) },
        {
          sourceRowNumber: 3,
          rawRow: makeValidRawRow({
            'Order ID': 'QC_002',
            'Arrived Delivery At': null,
          }),
        },
      ],
      store: TEST_STORE,
    });

    expect(result.is_valid).toBe(false);
    expect(result.valid_rows_count).toBe(1);
    expect(result.invalid_rows_count).toBe(1);
    expect(result.rows[1].issues.some((i) => i.code === 'REQUIRED_FOR_COMPLETED')).toBe(
      true
    );
  });

  it('produces deterministic SHA-256 source row hashes that change when any normalized source field changes', () => {
    const res1 = processAndValidateOrderRows({
      filename: 'hash1.xlsx',
      fileSizeBytes: 100,
      fileChecksumSha256: 'd'.repeat(64),
      worksheetFound: true,
      missingHeaders: [],
      unexpectedHeaders: [],
      rawRows: [{ sourceRowNumber: 2, rawRow: makeValidRawRow() }],
      store: TEST_STORE,
    });

    const row1 = res1.rows[0];
    expect(row1.source_row_hash).toHaveLength(64);
    expect(computeSourceRowHash(row1.normalized_source)).toBe(row1.source_row_hash);

    const modifiedSource = { ...row1.normalized_source, lm_distance: 1000 };
    expect(computeSourceRowHash(modifiedSource)).not.toBe(row1.source_row_hash);
  });

  it('parses .csv files and .xlsx workbooks with random/UUID system-generated sheet names', () => {
    const rawRow = makeValidRawRow({
      'Assigned At': '12:12 AM',
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([rawRow], {
      header: [...EXPECTED_RAW_HEADERS],
    });
    XLSX.utils.book_append_sheet(wb, ws, '0ba95919-d2d5-498f-9371-ff0ad0c');

    const xlsxBytes = new Uint8Array(
      XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    );
    const xlsxResult = parseAndValidateOrderWorkbook({
      fileBytes: xlsxBytes,
      filename: '0ba95919-d2d5-498f-9371-ff0ad0cf0ff0.xlsx',
      store: TEST_STORE,
    });
    expect(xlsxResult.is_valid).toBe(true);
    expect(xlsxResult.detected_sheet_name).toBe('0ba95919-d2d5-498f-9371-ff0ad0c');
    expect(xlsxResult.valid_rows_count).toBe(1);

    const csvText = XLSX.utils.sheet_to_csv(ws);
    const csvBytes = new TextEncoder().encode(csvText);
    const csvResult = parseAndValidateOrderWorkbook({
      fileBytes: csvBytes,
      filename: '0ba95919-d2d5-498f-9371-ff0ad0cf0ff0.csv',
      store: TEST_STORE,
    });
    expect(csvResult.is_valid).toBe(true);
    expect(csvResult.detected_sheet_name).toBe('CSV');
    expect(csvResult.valid_rows_count).toBe(1);

    // If user-uploaded CSV and XLSX artifacts exist on disk, verify both parse cleanly
    const userCsvPath =
      '/Users/suhaasvaddi/.gemini/antigravity/brain/15ed1fa3-415d-490d-a6cc-9636a7705f5e/.user_uploaded/media_1792492450254_4f39f1ca.csv';
    const userXlsxPath =
      '/Users/suhaasvaddi/.gemini/antigravity/brain/15ed1fa3-415d-490d-a6cc-9636a7705f5e/.user_uploaded/media_1792492640137_9090701b.xlsx';
    if (fs.existsSync(userCsvPath) && fs.existsSync(userXlsxPath)) {
      const realCsv = parseAndValidateOrderWorkbook({
        fileBytes: new Uint8Array(fs.readFileSync(userCsvPath)),
        filename: '0ba95919-d2d5-498f-9371-ff0ad0cf0ff0.csv',
        store: TEST_STORE,
      });
      const realXlsx = parseAndValidateOrderWorkbook({
        fileBytes: new Uint8Array(fs.readFileSync(userXlsxPath)),
        filename: '0ba95919-d2d5-498f-9371-ff0ad0cf0ff0.xlsx',
        store: TEST_STORE,
      });
      expect(realCsv.is_valid).toBe(true);
      expect(realXlsx.is_valid).toBe(true);
      expect(realCsv.valid_rows_count).toBe(742);
      expect(realXlsx.valid_rows_count).toBe(742);
      expect(realXlsx.detected_sheet_name).toBe('0ba95919-d2d5-498f-9371-ff0ad0c');
      expect(realCsv.min_order_date).toBe('2026-10-19');
      expect(realCsv.max_order_date).toBe('2026-10-19');
      expect(realCsv.rows.every((r) => r.derived_fields.order_date === '2026-10-19')).toBe(
        true
      );
    }
  });
});
