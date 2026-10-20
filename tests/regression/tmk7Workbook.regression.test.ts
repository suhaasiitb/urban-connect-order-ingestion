import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseAndValidateOrderWorkbook,
  readTransformSheetForRegressionTest,
} from '../../src/domain/excelParser';
import { calculateDerivedFieldsMinuteTruncated } from '../../src/domain/transformer';
import type { StoreMaster } from '../../src/domain/types';

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../fixtures/Amazon Narhe - Reports-2.xlsx'
);

const TMK7_STORE: StoreMaster = {
  id: '00000000-0000-4000-8000-000000000001',
  store_code: 'TMK7',
  store_name: 'Amazon Narhe (TMK7)',
  external_store_id: '4247',
  timezone: 'Asia/Kolkata',
  is_active: true,
};

describe('Reference Workbook Regression Suite — Amazon Narhe - Reports-2.xlsx (963 orders)', () => {
  const fileBuffer = fs.readFileSync(FIXTURE_PATH);
  const fileBytes = new Uint8Array(fileBuffer);

  it('verifies reference file SHA-256 checksum, schema headers, row counts, and status distribution', () => {
    const result = parseAndValidateOrderWorkbook({
      fileBytes,
      filename: 'Amazon Narhe - Reports-2.xlsx',
      store: TMK7_STORE,
    });

    expect(result.file_checksum_sha256).toBe(
      '7b4644152fca521a58f06dd671199054087f8569b66451221511cf4e6aa7a23c'
    );
    expect(result.worksheet_found).toBe(true);
    expect(result.missing_headers).toHaveLength(0);
    expect(result.unexpected_headers).toHaveLength(0);
    expect(result.file_errors).toHaveLength(0);

    // 963 valid orders, 0 invalid, 0 duplicates
    expect(result.total_rows_detected).toBe(963);
    expect(result.valid_rows_count).toBe(963);
    expect(result.invalid_rows_count).toBe(0);
    expect(result.duplicate_order_ids).toHaveLength(0);
    expect(result.is_valid).toBe(true);

    // Status distribution: 955 COMPLETED, 6 RTO_DELIVERED, 2 CANCELLED
    expect(result.status_distribution).toEqual({
      COMPLETED: 955,
      RTO_DELIVERED: 6,
      CANCELLED: 2,
    });

    // Business date range: all 963 orders created on 2026-10-18
    expect(result.min_order_date).toBe('2026-10-18');
    expect(result.max_order_date).toBe('2026-10-18');
  });

  it('verifies all 963 records against Transform sheet rules and documents intentional Option B / Not Applicable differences', () => {
    const result = parseAndValidateOrderWorkbook({
      fileBytes,
      filename: 'Amazon Narhe - Reports-2.xlsx',
      store: TMK7_STORE,
    });
    const transformRows = readTransformSheetForRegressionTest(fileBytes);

    expect(transformRows).toHaveLength(963);

    let nonCompletedCount = 0;
    let exactSecondOtpDiffs = 0;
    let exactSecondOtpPlus3Diffs = 0;
    const floatBoundaryRowsInTransform: number[] = [];

    for (let i = 0; i < 963; i++) {
      const parsed = result.rows[i];
      const ref = transformRows[i];

      expect(parsed.source_row_number).toBe(ref.sourceRowNumber);
      expect(parsed.normalized_source.order_id).toBe(ref.orderId);

      // 1. AD (order_type), AE (store_code), AF (slot_hour), AG (order_date), AJ (distance_meters)
      //    must match 100% across all 963 rows
      expect(parsed.derived_fields.order_type).toBe(ref.orderType);
      expect(parsed.derived_fields.store_code).toBe(ref.storeCode);
      expect(parsed.derived_fields.slot_hour).toBe(ref.slotHour);
      expect(parsed.derived_fields.order_date).toBe('2026-10-18');
      expect(Number(parsed.derived_fields.order_date.slice(-2))).toBe(ref.dayOfMonth);
      expect(parsed.derived_fields.distance_meters).toBe(ref.distanceMeters);

      // 2. Verify minute-truncated parity with 'Transform' sheet
      const minTrunc = calculateDerivedFieldsMinuteTruncated(
        parsed.normalized_source,
        TMK7_STORE
      );
      expect(minTrunc.staging_to_pickup_minutes).toBeCloseTo(
        ref.stagingToPickupMinutes,
        5
      );
      expect(minTrunc.s2p_minutes).toBeCloseTo(ref.s2pMinutes, 5);
      expect(minTrunc.actual_arrival_minutes).toBeCloseTo(ref.actualArrivalMinutes, 5);
      expect(minTrunc.arrival_eta_minutes).toBeCloseTo(ref.arrivalEtaMinutes, 5);

      if (parsed.normalized_source.status !== 'COMPLETED') {
        nonCompletedCount += 1;
        // Fixed business decision: Non-completed orders must have both OTP fields set to 'Not Applicable'
        expect(parsed.derived_fields.actual_arrival_minutes).toBe(0);
        expect(parsed.derived_fields.arrival_eta_minutes).toBe(0);
        expect(parsed.derived_fields.otp_performance).toBe('Not Applicable');
        expect(parsed.derived_fields.otp_plus_3_performance).toBe('Not Applicable');
      } else {
        // For COMPLETED orders:
        // Under minute-truncation, AM (OTP Performance) matches Transform 100% (955/955)
        expect(minTrunc.otp_performance).toBe(ref.otpPerformance);

        // Under minute-truncation, AN (OTP+3 Performance) matches Transform on 946/955 rows,
        // differing only on the 9 rows where AK == AL + 3 and Excel had IEEE-754 float drift
        if (minTrunc.otp_plus_3_performance !== ref.otpPlus3Performance) {
          expect(minTrunc.actual_arrival_minutes).toBe(
            minTrunc.arrival_eta_minutes + 3
          );
          floatBoundaryRowsInTransform.push(parsed.source_row_number);
        }

        // Track Option B (Exact Second Precision) differences vs minute-truncated Transform
        if (parsed.derived_fields.otp_performance !== ref.otpPerformance) {
          exactSecondOtpDiffs += 1;
        }
        if (parsed.derived_fields.otp_plus_3_performance !== ref.otpPlus3Performance) {
          exactSecondOtpPlus3Diffs += 1;
        }
      }
    }

    expect(nonCompletedCount).toBe(8); // 6 RTO_DELIVERED + 2 CANCELLED
    expect(floatBoundaryRowsInTransform).toEqual([
      53, 71, 89, 203, 279, 428, 469, 483, 883,
    ]);
    expect(exactSecondOtpDiffs).toBe(75);
    expect(exactSecondOtpPlus3Diffs).toBe(5);
  });
});
