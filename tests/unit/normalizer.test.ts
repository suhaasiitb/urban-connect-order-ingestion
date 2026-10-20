import { describe, expect, it } from 'vitest';
import {
  isBlankOrNullLiteral,
  normalizeNumericField,
  normalizeOrderRow,
  normalizeStringField,
  normalizeTimeOfDayField,
  normalizeTimestampField,
  parseCanonicalIstTimestamp,
} from '../../src/domain/normalizer';
import type { RawOrderRow } from '../../src/domain/types';

describe('Normalizer Unit Tests (Section 7)', () => {
  it('identifies blank, null, and literal "null" values accurately', () => {
    expect(isBlankOrNullLiteral(null)).toBe(true);
    expect(isBlankOrNullLiteral(undefined)).toBe(true);
    expect(isBlankOrNullLiteral('')).toBe(true);
    expect(isBlankOrNullLiteral('   ')).toBe(true);
    expect(isBlankOrNullLiteral('null')).toBe(true);
    expect(isBlankOrNullLiteral('NULL')).toBe(true);
    expect(isBlankOrNullLiteral(' Null ')).toBe(true);
    expect(isBlankOrNullLiteral('-')).toBe(false);
    expect(isBlankOrNullLiteral(0)).toBe(false);
  });

  it('normalizes string fields and handles "-" when allowDashAsNull is enabled', () => {
    expect(normalizeStringField('  TMK7  ')).toBe('TMK7');
    expect(normalizeStringField('null')).toBeNull();
    expect(normalizeStringField('-')).toBe('-');
    expect(normalizeStringField('-', { allowDashAsNull: true })).toBeNull();
  });

  it('normalizes Excel datetime serials in Asia/Kolkata (+05:30) including midnight rollover', () => {
    // Row 2 Created At: 46313.998206018521 -> 2026-10-18 23:57:25 IST
    const created = normalizeTimestampField(46313.998206018521);
    expect(created.error).toBeUndefined();
    expect(created.value).toBe('2026-10-18T23:57:25+05:30');

    // Row 2 Arrive at Delivery ETA: 46314.001747685186 -> 2026-10-19 00:02:31 IST (next day after midnight)
    const eta = normalizeTimestampField(46314.001747685186);
    expect(eta.error).toBeUndefined();
    expect(eta.value).toBe('2026-10-19T00:02:31+05:30');

    const parsedCreated = parseCanonicalIstTimestamp(created.value!);
    expect(parsedCreated.orderDate).toBe('2026-10-18');
    expect(parsedCreated.slotHour).toBe(23);

    const parsedEta = parseCanonicalIstTimestamp(eta.value!);
    expect(parsedEta.orderDate).toBe('2026-10-19');
    expect(parsedEta.slotHour).toBe(0);
  });

  it('normalizes formatted timestamp strings and ISO strings with timezone offsets', () => {
    expect(normalizeTimestampField('2026-10-18 23:57:25').value).toBe(
      '2026-10-18T23:57:25+05:30'
    );
    expect(normalizeTimestampField('2026-10-18 06:04').value).toBe(
      '2026-10-18T06:04:00+05:30'
    );
    // UTC 18:27:25Z is 23:57:25+05:30 in Asia/Kolkata
    expect(normalizeTimestampField('2026-10-18T18:27:25Z').value).toBe(
      '2026-10-18T23:57:25+05:30'
    );
  });

  it('rejects malformed timestamps rather than silently converting to zero', () => {
    expect(normalizeTimestampField('not-a-timestamp').error).toBeDefined();
    expect(normalizeTimestampField('2026-02-30 12:00:00').error).toBeDefined();
    expect(normalizeTimestampField(123).error).toBeDefined();
    expect(normalizeTimestampField('-').error).toBeDefined();
  });

  it('normalizes Excel time-of-day serial fractions and HH:MM:SS strings for Assigned At', () => {
    // 23:57:00 = 86220 / 86400 = 0.9979166666666667
    expect(normalizeTimeOfDayField(0.9979166666666667).value).toBe('23:57:00');
    expect(normalizeTimeOfDayField(0).value).toBe('00:00:00');
    expect(normalizeTimeOfDayField('09:05:00').value).toBe('09:05:00');
    expect(normalizeTimeOfDayField('9:05').value).toBe('09:05:00');
    expect(normalizeTimeOfDayField('25:00:00').error).toBeDefined();
  });

  it('normalizes numeric fields and rejects malformed numbers', () => {
    expect(normalizeNumericField(989, { integerOnly: true, min: 0 }).value).toBe(989);
    expect(normalizeNumericField('989', { integerOnly: true, min: 0 }).value).toBe(989);
    expect(normalizeNumericField('-', { allowDashAsNull: true }).value).toBeNull();
    expect(normalizeNumericField('-', { allowDashAsNull: false }).error).toBeDefined();
    expect(normalizeNumericField(12.5, { integerOnly: true }).error).toBeDefined();
    expect(normalizeNumericField(-5, { min: 0 }).error).toBeDefined();
  });

  it('normalizes a full CANCELLED order row with "null" and "-" sentinels cleanly', () => {
    const rawCancelledRow: RawOrderRow = {
      'Rider Number': null,
      'Arrived Pickup At': 46313.56173611111, // 2026-10-18 13:28:54
      'LM Distance': 413,
      'Resting Point Name': 'null',
      'Total ETA': '-',
      'Completed At': 'null',
      'Resting Point ID': 'null',
      'Store Name': 'TMK7 | 1:26 PM | 0.4 KM',
      'Pickup At': null,
      'Order ETA Status': 'null',
      'Staged At': 'null',
      'Pickup ETA': '-',
      'Arrive at Pickup ETA': null,
      'Status Text': null,
      'Created At': 46313.56011574074, // 2026-10-18 13:26:34
      'Status': 'cancelled',
      'Rider Name': '-',
      'Order ID': 'QC_406-1676541-4890749',
      'Store ID': 4247,
      'Total Time': 'null',
      'Arrive at Delivery ETA': 46313.565243055556, // 2026-10-18 13:33:57
      'Arrived Delivery At': null,
      'Tracking URL': 'https://track.loadshare.net/order/jxdWMV1',
      'Customer ID': 22411,
      'RTO At': null,
      'FM Distance': 0,
      'Assigned At': '13:28:00',
      'Delivery ETA': '-',
      'Batch ID': 'null',
    };

    const { normalized, issues } = normalizeOrderRow(rawCancelledRow);
    expect(issues).toHaveLength(0);
    expect(normalized.status).toBe('CANCELLED');
    expect(normalized.rider_number).toBeNull();
    expect(normalized.rider_name).toBeNull();
    expect(normalized.total_eta).toBeNull();
    expect(normalized.pickup_eta).toBeNull();
    expect(normalized.delivery_eta).toBeNull();
    expect(normalized.staged_at).toBeNull();
    expect(normalized.pickup_at).toBeNull();
    expect(normalized.order_created_at).toBe('2026-10-18T13:26:34+05:30');
  });
});
