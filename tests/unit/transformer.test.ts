import { describe, expect, it } from 'vitest';
import {
  calculateDerivedFields,
  deriveActualArrivalMinutes,
  deriveArrivalEtaMinutes,
  deriveDistanceMeters,
  deriveOrderType,
  deriveOtpPerformance,
  deriveOtpPlus3Performance,
  deriveS2pMinutes,
  deriveSlotAndDate,
  deriveStagingToPickupMinutes,
  deriveStoreCode,
  extractSourceStorePrefix,
} from '../../src/domain/transformer';
import type { NormalizedOrderSource, StoreMaster } from '../../src/domain/types';

const TEST_STORE: StoreMaster = {
  id: '00000000-0000-4000-8000-000000000001',
  store_code: 'TMK7',
  store_name: 'Amazon Narhe (TMK7)',
  external_store_id: '4247',
  timezone: 'Asia/Kolkata',
  is_active: true,
};

function makeBaseSource(overrides: Partial<NormalizedOrderSource> = {}): NormalizedOrderSource {
  return {
    rider_number: 'XXXXXX5447',
    arrived_pickup_at: '2026-10-18T23:57:30+05:30',
    lm_distance: 989,
    resting_point_name: null,
    total_eta: 4,
    completed_at: null,
    resting_point_id: null,
    source_store_name: 'TMK7 | 11:57 PM | 1.0 KM',
    pickup_at: '2026-10-18T23:58:42+05:30',
    order_eta_status: null,
    staged_at: '2026-10-18T23:58:17+05:30',
    pickup_eta: 24,
    arrive_at_pickup_eta: null,
    status_text: null,
    order_created_at: '2026-10-18T23:57:25+05:30',
    status: 'COMPLETED',
    rider_name: 'Savidhan kisan Wahule',
    order_id: 'QC_405-2853124-8797901',
    external_store_id: '4247',
    total_time: null,
    arrive_at_delivery_eta: '2026-10-19T00:02:31+05:30',
    arrived_delivery_at: '2026-10-19T00:01:58+05:30',
    tracking_url: 'https://track.loadshare.net/order/wkj3qww',
    customer_id: '22411',
    rto_at: null,
    fm_distance: 0,
    assigned_at: '23:57:00',
    delivery_eta: 3,
    source_batch_id: null,
    ...overrides,
  };
}

describe('Transformer Unit Tests (Section 6: AD through AN)', () => {
  it('AD — derives Order Type ("Dummy" for AM prefix, case-insensitive; "Actual" otherwise)', () => {
    expect(deriveOrderType('AM_123456')).toBe('Dummy');
    expect(deriveOrderType('am-987654')).toBe('Dummy');
    expect(deriveOrderType('  Am999 ')).toBe('Dummy');
    expect(deriveOrderType('QC_405-2853124-8797901')).toBe('Actual');
  });

  it('AE — derives Store Code and extracts prefix before "|"', () => {
    expect(deriveStoreCode(TEST_STORE)).toBe('TMK7');
    expect(extractSourceStorePrefix('TMK7 | 11:57 PM | 1.0 KM')).toBe('TMK7');
    expect(extractSourceStorePrefix('ABCD | 08:00 AM | 2.1 KM')).toBe('ABCD');
  });

  it('AF & AG — derives Slot (0-23) and full YYYY-MM-DD Date without midnight shift', () => {
    expect(deriveSlotAndDate('2026-10-18T00:00:00+05:30')).toEqual({
      slot_hour: 0,
      order_date: '2026-10-18',
    });
    expect(deriveSlotAndDate('2026-10-18T23:59:59+05:30')).toEqual({
      slot_hour: 23,
      order_date: '2026-10-18',
    });
    expect(deriveSlotAndDate('2026-10-19T00:00:01+05:30')).toEqual({
      slot_hour: 0,
      order_date: '2026-10-19',
    });
  });

  it('AH & AI — computes staging_to_pickup_minutes and s2p_minutes with exact second precision', () => {
    // 25 seconds difference = 0.4167 minutes
    const ah = deriveStagingToPickupMinutes(
      '2026-10-18T23:58:42+05:30',
      '2026-10-18T23:58:17+05:30'
    );
    expect(ah).toBe(0.4167);
    expect(deriveS2pMinutes(ah)).toBe(0.4167);

    // Negative interval -> AH is negative, AI (S2P) clamps to 0
    const negAh = deriveStagingToPickupMinutes(
      '2026-10-18T23:57:00+05:30',
      '2026-10-18T23:58:00+05:30'
    );
    expect(negAh).toBe(-1);
    expect(deriveS2pMinutes(negAh)).toBe(0);

    // Missing timestamps (e.g. CANCELLED orders) -> 0
    expect(deriveStagingToPickupMinutes(null, null)).toBe(0);
    expect(deriveStagingToPickupMinutes('2026-10-18T23:58:00+05:30', null)).toBe(0);
  });

  it('AJ — maps LM Distance to distance_meters', () => {
    expect(deriveDistanceMeters(989)).toBe(989);
    expect(deriveDistanceMeters(0)).toBe(0);
  });

  it('AK & AL — computes arrival metrics across midnight for COMPLETED orders and 0 for non-completed', () => {
    // Staged At: 2026-10-18 23:58:17, Arrived Delivery: 2026-10-19 00:01:58 (221s = 3.6833 min)
    // Arrive Delivery ETA: 2026-10-19 00:02:31 (254s = 4.2333 min)
    const ak = deriveActualArrivalMinutes(
      'COMPLETED',
      '2026-10-19T00:01:58+05:30',
      '2026-10-18T23:58:17+05:30'
    );
    const al = deriveArrivalEtaMinutes(
      'COMPLETED',
      '2026-10-19T00:02:31+05:30',
      '2026-10-18T23:58:17+05:30'
    );
    expect(ak).toBe(3.6833);
    expect(al).toBe(4.2333);

    // Non-completed orders must return 0 for AK and AL even if timestamps exist
    expect(
      deriveActualArrivalMinutes(
        'RTO_DELIVERED',
        '2026-10-18T21:50:19+05:30',
        '2026-10-18T21:37:48+05:30'
      )
    ).toBe(0);
    expect(
      deriveArrivalEtaMinutes(
        'RTO_DELIVERED',
        '2026-10-18T21:51:02+05:30',
        '2026-10-18T21:37:48+05:30'
      )
    ).toBe(0);
  });

  it('AM & AN — evaluates OTP and OTP+3 accurately at exact thresholds and sets Not Applicable for non-completed', () => {
    // 1. Strictly before ETA (AK < AL)
    expect(deriveOtpPerformance('COMPLETED', 7.9999, 8.0)).toBe('OTP Achieved');
    expect(deriveOtpPlus3Performance('COMPLETED', 7.9999, 8.0)).toBe('OTP Achieved');

    // 2. Exactly at ETA (AK == AL) -> OTP Breached, OTP+3 Achieved
    expect(deriveOtpPerformance('COMPLETED', 8.0, 8.0)).toBe('OTP Breached');
    expect(deriveOtpPlus3Performance('COMPLETED', 8.0, 8.0)).toBe('OTP Achieved');

    // 3. Between ETA and ETA + 3 (AL < AK < AL + 3) -> OTP Breached, OTP+3 Achieved
    expect(deriveOtpPerformance('COMPLETED', 10.9833, 8.0)).toBe('OTP Breached');
    expect(deriveOtpPlus3Performance('COMPLETED', 10.9833, 8.0)).toBe('OTP Achieved');

    // 4. Exactly at ETA + 3 (AK == AL + 3, e.g., 11 == 8 + 3) -> Both OTP Breached (no float drift!)
    expect(deriveOtpPerformance('COMPLETED', 11.0, 8.0)).toBe('OTP Breached');
    expect(deriveOtpPlus3Performance('COMPLETED', 11.0, 8.0)).toBe('OTP Breached');

    // 5. Non-completed orders -> Both "Not Applicable"
    expect(deriveOtpPerformance('RTO_DELIVERED', 0, 0)).toBe('Not Applicable');
    expect(deriveOtpPlus3Performance('RTO_DELIVERED', 0, 0)).toBe('Not Applicable');
    expect(deriveOtpPerformance('CANCELLED', 0, 0)).toBe('Not Applicable');
    expect(deriveOtpPlus3Performance('CANCELLED', 0, 0)).toBe('Not Applicable');
  });

  it('calculates all 11 derived fields end-to-end for a sample COMPLETED order', () => {
    const source = makeBaseSource();
    const derived = calculateDerivedFields(source, TEST_STORE);

    expect(derived).toEqual({
      order_type: 'Actual',
      store_code: 'TMK7',
      slot_hour: 23,
      order_date: '2026-10-18',
      staging_to_pickup_minutes: 0.4167,
      s2p_minutes: 0.4167,
      distance_meters: 989,
      actual_arrival_minutes: 3.6833,
      arrival_eta_minutes: 4.2333,
      otp_performance: 'OTP Achieved',
      otp_plus_3_performance: 'OTP Achieved',
    });
  });
});
