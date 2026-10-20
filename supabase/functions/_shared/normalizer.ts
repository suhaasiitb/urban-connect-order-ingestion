// ==============================================================================
// Dedicated Source Normalization Layer
// Handles Excel serial dates, string timestamps, Asia/Kolkata (+05:30) timezone
// rules, time-of-day serials, numeric parsing, and "null" / "-" sentinels.
// ==============================================================================

import type {
  FieldValidationIssue,
  NormalizedOrderSource,
  RawCellValue,
  RawOrderRow,
} from './types.ts';
import { EXPECTED_RAW_HEADERS } from './types.ts';

export const CANONICAL_TIMEZONE_OFFSET = '+05:30';
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // +05:30 in milliseconds
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30, 0, 0, 0); // 1899-12-30T00:00:00Z

export interface ParsedFieldResult<T> {
  value: T | null;
  error?: string;
}

/**
 * Checks if a raw cell value represents a blank or literal "null" value.
 */
export function isBlankOrNullLiteral(raw: RawCellValue): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'number' && Number.isNaN(raw)) return true;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed === '' || trimmed.toLowerCase() === 'null';
  }
  return false;
}

/**
 * Normalizes a string field, converting blank and literal "null" (and optionally "-")
 * to database NULL. Trims leading/trailing whitespace.
 */
export function normalizeStringField(
  raw: RawCellValue,
  options: { allowDashAsNull?: boolean } = {}
): string | null {
  if (isBlankOrNullLiteral(raw)) return null;
  const trimmed = String(raw).trim();
  if (options.allowDashAsNull && trimmed === '-') {
    return null;
  }
  return trimmed === '' ? null : trimmed;
}

/**
 * Normalizes a numeric field, supporting numbers and numeric strings.
 * Converts blank, "null", and (when allowDashAsNull is true) "-" to NULL.
 * Returns an error message if the cell contains a malformed number.
 */
export function normalizeNumericField(
  raw: RawCellValue,
  options: {
    allowDashAsNull?: boolean;
    integerOnly?: boolean;
    min?: number;
  } = {}
): ParsedFieldResult<number> {
  if (isBlankOrNullLiteral(raw)) {
    return { value: null };
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (options.allowDashAsNull && trimmed === '-') {
      return { value: null };
    }
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return { value: null, error: `Invalid numeric value "${trimmed}"` };
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return { value: null, error: `Non-finite numeric value "${trimmed}"` };
    }
    return validateParsedNumber(parsed, options);
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return { value: null, error: 'Non-finite number' };
    }
    return validateParsedNumber(raw, options);
  }
  return { value: null, error: `Unexpected type "${typeof raw}" for numeric field` };
}

function validateParsedNumber(
  num: number,
  options: { integerOnly?: boolean; min?: number }
): ParsedFieldResult<number> {
  // Clean IEEE-754 noise such as 14.000000000000002
  const cleaned = Math.round(num * 1e6) / 1e6;
  if (options.integerOnly && !Number.isInteger(cleaned)) {
    return { value: null, error: `Expected integer value but got ${cleaned}` };
  }
  if (options.min !== undefined && cleaned < options.min) {
    return { value: null, error: `Value ${cleaned} is less than minimum ${options.min}` };
  }
  return { value: options.integerOnly ? Math.round(cleaned) : cleaned };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatWallClockIsoIst(wallClockUtcMs: number): string {
  const d = new Date(wallClockUtcMs);
  const year = d.getUTCFullYear();
  const month = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  const hour = pad2(d.getUTCHours());
  const minute = pad2(d.getUTCMinutes());
  const second = pad2(d.getUTCSeconds());
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${CANONICAL_TIMEZONE_OFFSET}`;
}

/**
 * Normalizes an Excel datetime serial or timestamp string into a canonical
 * ISO-8601 timestamp in Asia/Kolkata (+05:30), e.g. "2026-10-18T23:57:25+05:30".
 *
 * Avoids JavaScript local-timezone conversion surprises by using UTC calendar
 * math anchored to the Excel epoch (1899-12-30) and explicit +05:30 offsets.
 */
export function normalizeTimestampField(
  raw: RawCellValue,
  options: { allowDashAsNull?: boolean } = {}
): ParsedFieldResult<string> {
  if (isBlankOrNullLiteral(raw)) {
    return { value: null };
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 30000 || raw > 80000) {
      return {
        value: null,
        error: `Invalid Excel datetime serial "${raw}" (must be a valid date serial between 30000 and 80000)`,
      };
    }
    const totalSeconds = Math.round(raw * 86400);
    const wallClockUtcMs = EXCEL_EPOCH_UTC_MS + totalSeconds * 1000;
    return { value: formatWallClockIsoIst(wallClockUtcMs) };
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (options.allowDashAsNull && trimmed === '-') {
      return { value: null };
    }

    // Check if the string is a pure numeric Excel serial representation
    if (/^\d{5}(\.\d+)?$/.test(trimmed)) {
      return normalizeTimestampField(Number(trimmed), options);
    }

    // Case 1: Local timestamp string without timezone offset: "YYYY-MM-DD HH:mm(:ss)" or "YYYY-MM-DDTHH:mm(:ss)"
    const localMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i.exec(trimmed);
    if (localMatch) {
      const year = Number(localMatch[1]);
      const month = Number(localMatch[2]);
      const day = Number(localMatch[3]);
      let hour = Number(localMatch[4]);
      const minute = Number(localMatch[5]);
      const second = localMatch[6] !== undefined ? Number(localMatch[6]) : 0;
      const ampm = localMatch[7]?.toUpperCase();
      if (ampm === 'PM' && hour < 12) hour += 12;
      if (ampm === 'AM' && hour === 12) hour = 0;

      if (!isValidCalendarDateTime(year, month, day, hour, minute, second)) {
        return { value: null, error: `Invalid calendar timestamp "${trimmed}"` };
      }

      const wallClockUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
      return { value: formatWallClockIsoIst(wallClockUtcMs) };
    }

    // Case 1b: Slash-formatted date "MM/DD/YY(YY) HH:mm(:ss)" or "DD/MM/YY(YY) HH:mm(:ss)"
    const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i.exec(trimmed);
    if (slashMatch) {
      const p1 = Number(slashMatch[1]);
      const p2 = Number(slashMatch[2]);
      let year = Number(slashMatch[3]);
      if (year < 100) year += 2000;
      // Disambiguate MM/DD vs DD/MM: if p1 > 12, it is DD/MM; otherwise default to MM/DD (or DD/MM if p2 <= 12)
      const month = p1 > 12 ? p2 : p1;
      const day = p1 > 12 ? p1 : p2;
      let hour = Number(slashMatch[4]);
      const minute = Number(slashMatch[5]);
      const second = slashMatch[6] !== undefined ? Number(slashMatch[6]) : 0;
      const ampm = slashMatch[7]?.toUpperCase();
      if (ampm === 'PM' && hour < 12) hour += 12;
      if (ampm === 'AM' && hour === 12) hour = 0;

      if (!isValidCalendarDateTime(year, month, day, hour, minute, second)) {
        return { value: null, error: `Invalid calendar timestamp "${trimmed}"` };
      }

      const wallClockUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
      return { value: formatWallClockIsoIst(wallClockUtcMs) };
    }

    // Case 2: ISO-8601 timestamp string with explicit timezone offset ("Z" or "+HH:MM" / "-HH:MM")
    const tzMatch =
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/i.exec(
        trimmed
      );
    if (tzMatch) {
      const year = Number(tzMatch[1]);
      const month = Number(tzMatch[2]);
      const day = Number(tzMatch[3]);
      const hour = Number(tzMatch[4]);
      const minute = Number(tzMatch[5]);
      const second = tzMatch[6] !== undefined ? Number(tzMatch[6]) : 0;

      if (!isValidCalendarDateTime(year, month, day, hour, minute, second)) {
        return { value: null, error: `Invalid calendar timestamp "${trimmed}"` };
      }

      const epochMs = Date.parse(trimmed);
      if (Number.isNaN(epochMs)) {
        return { value: null, error: `Unparseable timestamp "${trimmed}"` };
      }
      // Round to nearest second and shift to Asia/Kolkata (+05:30) wall clock
      const roundedMs = Math.round(epochMs / 1000) * 1000;
      const istWallClockMs = roundedMs + IST_OFFSET_MS;
      return { value: formatWallClockIsoIst(istWallClockMs) };
    }

    return { value: null, error: `Unrecognized timestamp format "${trimmed}"` };
  }

  return { value: null, error: `Unexpected type "${typeof raw}" for timestamp field` };
}

function isValidCalendarDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): boolean {
  if (year < 2000 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 59) return false;

  const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/**
 * Normalizes a time-of-day field (such as Assigned At in Column AA),
 * supporting Excel time serial fractions (0 <= x < 1) and "HH:MM(:SS)" strings.
 */
export function normalizeTimeOfDayField(
  raw: RawCellValue,
  options: { allowDashAsNull?: boolean } = {}
): ParsedFieldResult<string> {
  if (isBlankOrNullLiteral(raw)) {
    return { value: null };
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) {
      return { value: null, error: `Invalid Excel time serial "${raw}"` };
    }
    // Extract fractional day (in case a full serial date+time is ever supplied)
    const fraction = raw >= 1 ? raw % 1 : raw;
    const totalSeconds = Math.round(fraction * 86400) % 86400;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { value: `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}` };
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (options.allowDashAsNull && trimmed === '-') {
      return { value: null };
    }
    if (/^0?\.\d+$/.test(trimmed)) {
      return normalizeTimeOfDayField(Number(trimmed), options);
    }
    const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i.exec(trimmed);
    if (timeMatch) {
      let h = Number(timeMatch[1]);
      const m = Number(timeMatch[2]);
      const s = timeMatch[3] !== undefined ? Number(timeMatch[3]) : 0;
      const ampm = timeMatch[4]?.toUpperCase();
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59 && s >= 0 && s <= 59) {
        return { value: `${pad2(h)}:${pad2(m)}:${pad2(s)}` };
      }
      return { value: null, error: `Out-of-range time of day "${trimmed}"` };
    }
    return { value: null, error: `Invalid time-of-day format "${trimmed}"` };
  }

  return { value: null, error: `Unexpected type "${typeof raw}" for time-of-day field` };
}

/**
 * Extracts the wall-clock Date (YYYY-MM-DD), Hour (0-23), and Epoch Seconds
 * from a canonical Asia/Kolkata ISO-8601 timestamp ("YYYY-MM-DDTHH:mm:ss+05:30").
 */
export function parseCanonicalIstTimestamp(isoIst: string): {
  orderDate: string;
  slotHour: number;
  epochSeconds: number;
} {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})\+05:30$/.exec(isoIst);
  if (!match) {
    const ms = Date.parse(isoIst);
    if (Number.isNaN(ms)) {
      throw new Error(`Invalid canonical timestamp: ${isoIst}`);
    }
    const istWallMs = ms + IST_OFFSET_MS;
    const d = new Date(istWallMs);
    const yyyy = d.getUTCFullYear();
    const mm = pad2(d.getUTCMonth() + 1);
    const dd = pad2(d.getUTCDate());
    return {
      orderDate: `${yyyy}-${mm}-${dd}`,
      slotHour: d.getUTCHours(),
      epochSeconds: Math.round(ms / 1000),
    };
  }
  const orderDate = match[1];
  const slotHour = Number(match[2]);
  const epochMs = Date.parse(isoIst);
  return {
    orderDate,
    slotHour,
    epochSeconds: Math.round(epochMs / 1000),
  };
}

/**
 * Normalizes a complete 29-column RawOrderRow into a typed NormalizedOrderSource
 * plus a clean raw_source_snapshot and any parse/format issues discovered.
 */
export function normalizeOrderRow(rawRow: RawOrderRow): {
  normalized: NormalizedOrderSource;
  rawSnapshot: Record<string, string | number | boolean | null>;
  issues: FieldValidationIssue[];
} {
  const issues: FieldValidationIssue[] = [];
  const rawSnapshot: Record<string, string | number | boolean | null> = {};

  for (const header of EXPECTED_RAW_HEADERS) {
    const val = rawRow[header];
    rawSnapshot[header] =
      val === undefined || (typeof val === 'number' && Number.isNaN(val))
        ? null
        : val;
  }

  const recordParseError = (field: string, error?: string) => {
    if (error) {
      issues.push({
        field,
        severity: 'error',
        code: 'MALFORMED_VALUE',
        message: `${field}: ${error}`,
      });
    }
  };

  const arrivedPickup = normalizeTimestampField(rawRow['Arrived Pickup At']);
  recordParseError('Arrived Pickup At', arrivedPickup.error);

  const lmDistance = normalizeNumericField(rawRow['LM Distance'], {
    integerOnly: true,
    min: 0,
  });
  recordParseError('LM Distance', lmDistance.error);

  const totalEta = normalizeNumericField(rawRow['Total ETA'], {
    allowDashAsNull: true,
  });
  recordParseError('Total ETA', totalEta.error);

  const completedAt = normalizeTimestampField(rawRow['Completed At'], {
    allowDashAsNull: true,
  });
  recordParseError('Completed At', completedAt.error);

  const pickupAt = normalizeTimestampField(rawRow['Pickup At']);
  recordParseError('Pickup At', pickupAt.error);

  const stagedAt = normalizeTimestampField(rawRow['Staged At']);
  recordParseError('Staged At', stagedAt.error);

  const pickupEta = normalizeNumericField(rawRow['Pickup ETA'], {
    allowDashAsNull: true,
  });
  recordParseError('Pickup ETA', pickupEta.error);

  const arriveAtPickupEta = normalizeTimestampField(rawRow['Arrive at Pickup ETA'], {
    allowDashAsNull: true,
  });
  recordParseError('Arrive at Pickup ETA', arriveAtPickupEta.error);

  const createdAt = normalizeTimestampField(rawRow['Created At']);
  recordParseError('Created At', createdAt.error);

  const totalTime = normalizeNumericField(rawRow['Total Time'], {
    allowDashAsNull: true,
  });
  recordParseError('Total Time', totalTime.error);

  const arriveAtDeliveryEta = normalizeTimestampField(rawRow['Arrive at Delivery ETA']);
  recordParseError('Arrive at Delivery ETA', arriveAtDeliveryEta.error);

  const arrivedDeliveryAt = normalizeTimestampField(rawRow['Arrived Delivery At']);
  recordParseError('Arrived Delivery At', arrivedDeliveryAt.error);

  const rtoAt = normalizeTimestampField(rawRow['RTO At']);
  recordParseError('RTO At', rtoAt.error);

  const fmDistance = normalizeNumericField(rawRow['FM Distance'], {
    allowDashAsNull: true,
    min: 0,
  });
  recordParseError('FM Distance', fmDistance.error);

  const assignedAt = normalizeTimeOfDayField(rawRow['Assigned At'], {
    allowDashAsNull: true,
  });
  recordParseError('Assigned At', assignedAt.error);

  const deliveryEta = normalizeNumericField(rawRow['Delivery ETA'], {
    allowDashAsNull: true,
  });
  recordParseError('Delivery ETA', deliveryEta.error);

  const rawStatus = normalizeStringField(rawRow['Status']);
  const normalizedStatus = rawStatus ? rawStatus.toUpperCase() : '';

  const normalized: NormalizedOrderSource = {
    rider_number: normalizeStringField(rawRow['Rider Number'], { allowDashAsNull: true }),
    arrived_pickup_at: arrivedPickup.value,
    lm_distance: lmDistance.value,
    resting_point_name: normalizeStringField(rawRow['Resting Point Name']),
    total_eta: totalEta.value,
    completed_at: completedAt.value,
    resting_point_id: normalizeStringField(rawRow['Resting Point ID']),
    source_store_name: normalizeStringField(rawRow['Store Name']) ?? '',
    pickup_at: pickupAt.value,
    order_eta_status: normalizeStringField(rawRow['Order ETA Status']),
    staged_at: stagedAt.value,
    pickup_eta: pickupEta.value,
    arrive_at_pickup_eta: arriveAtPickupEta.value,
    status_text: normalizeStringField(rawRow['Status Text']),
    order_created_at: createdAt.value ?? '',
    status: normalizedStatus,
    rider_name: normalizeStringField(rawRow['Rider Name'], { allowDashAsNull: true }),
    order_id: normalizeStringField(rawRow['Order ID']) ?? '',
    external_store_id: normalizeStringField(rawRow['Store ID']) ?? '',
    total_time: totalTime.value,
    arrive_at_delivery_eta: arriveAtDeliveryEta.value,
    arrived_delivery_at: arrivedDeliveryAt.value,
    tracking_url: normalizeStringField(rawRow['Tracking URL']),
    customer_id: normalizeStringField(rawRow['Customer ID']),
    rto_at: rtoAt.value,
    fm_distance: fmDistance.value,
    assigned_at: assignedAt.value,
    delivery_eta: deliveryEta.value,
    source_batch_id: normalizeStringField(rawRow['Batch ID']),
  };

  return { normalized, rawSnapshot, issues };
}
