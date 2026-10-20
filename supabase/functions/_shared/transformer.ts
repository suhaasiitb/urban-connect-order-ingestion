// ==============================================================================
// Business Transformation Engine (The 11 Derived Fields: AD through AN)
// Centralizes all business rules so Frontend Preview and Backend Persistence
// produce identical outputs.
// ==============================================================================

import { parseCanonicalIstTimestamp } from './normalizer.ts';
import type {
  DerivedOrderFields,
  NormalizedOrderSource,
  OrderType,
  OtpStatus,
  StoreMaster,
} from './types.ts';

function round4(val: number): number {
  return Math.round(val * 10000) / 10000;
}

/**
 * AD — Order Type
 * Excel rule: =IF(LEFT(R2,2)="AM","Dummy","Actual")
 * Case-insensitive prefix check on Order ID.
 */
export function deriveOrderType(orderId: string): OrderType {
  return orderId.trim().toUpperCase().startsWith('AM') ? 'Dummy' : 'Actual';
}

/**
 * AE — Store Code
 * Uses the explicitly selected and validated store's authoritative store_code.
 */
export function deriveStoreCode(store: Pick<StoreMaster, 'store_code'>): string {
  return store.store_code.trim().toUpperCase();
}

/**
 * Extracts Store Code prefix before "|" from source "Store Name" (Column H)
 * as a validation aid (e.g. "TMK7 | 11:57 PM | 1.0 KM" -> "TMK7").
 */
export function extractSourceStorePrefix(sourceStoreName: string): string {
  const pipeIdx = sourceStoreName.indexOf('|');
  if (pipeIdx !== -1) {
    return sourceStoreName.slice(0, pipeIdx).trim().toUpperCase();
  }
  return sourceStoreName.trim().slice(0, 4).trim().toUpperCase();
}

/**
 * AF — Slot (0-23) & AG — Full Business Date (YYYY-MM-DD)
 * Derived from Created At (Column O) in the canonical Asia/Kolkata (+05:30) timezone.
 */
export function deriveSlotAndDate(orderCreatedAtIso: string): {
  slot_hour: number;
  order_date: string;
} {
  if (!orderCreatedAtIso) {
    return { slot_hour: 0, order_date: '1970-01-01' };
  }
  const { orderDate, slotHour } = parseCanonicalIstTimestamp(orderCreatedAtIso);
  return {
    slot_hour: slotHour,
    order_date: orderDate,
  };
}

/**
 * AH — Time (staging_to_pickup_minutes)
 * Excel rule: =IFERROR((I2-K2)*24*60,0)
 * Computes exact minutes between Staged At (K) and Pickup At (I).
 * Returns 0 when either timestamp is null (matching Excel IFERROR behavior on CANCELLED rows).
 */
export function deriveStagingToPickupMinutes(
  pickupAtIso: string | null,
  stagedAtIso: string | null
): number {
  if (!pickupAtIso || !stagedAtIso) {
    return 0;
  }
  const pickupSec = parseCanonicalIstTimestamp(pickupAtIso).epochSeconds;
  const stagedSec = parseCanonicalIstTimestamp(stagedAtIso).epochSeconds;
  const diffMinutes = (pickupSec - stagedSec) / 60;
  return round4(diffMinutes);
}

/**
 * AI — S2P (s2p_minutes)
 * Excel rule: =IF(AH2>0,AH2,0)
 */
export function deriveS2pMinutes(stagingToPickupMinutes: number): number {
  return stagingToPickupMinutes > 0 ? stagingToPickupMinutes : 0;
}

/**
 * AJ — Distance (distance_meters)
 * Excel rule: =C2
 */
export function deriveDistanceMeters(lmDistance: number | null): number {
  if (lmDistance === null || !Number.isFinite(lmDistance) || lmDistance < 0) {
    return 0;
  }
  return Math.round(lmDistance);
}

/**
 * AK — Actual Arrival Time (actual_arrival_minutes)
 * Excel rule: =IF(P2="completed",((V2-K2)*24*60),0)
 * For COMPLETED orders: (Arrived Delivery At - Staged At) in minutes.
 * For non-completed orders: 0.
 */
export function deriveActualArrivalMinutes(
  status: string,
  arrivedDeliveryAtIso: string | null,
  stagedAtIso: string | null
): number {
  if (status.trim().toUpperCase() !== 'COMPLETED') {
    return 0;
  }
  if (!arrivedDeliveryAtIso || !stagedAtIso) {
    return 0;
  }
  const arrivedSec = parseCanonicalIstTimestamp(arrivedDeliveryAtIso).epochSeconds;
  const stagedSec = parseCanonicalIstTimestamp(stagedAtIso).epochSeconds;
  return round4((arrivedSec - stagedSec) / 60);
}

/**
 * AL — Arrival Time ETA (arrival_eta_minutes)
 * Excel rule: =IF(P2="completed",((U2-K2)*24*60),0)
 * For COMPLETED orders: (Arrive at Delivery ETA - Staged At) in minutes.
 * For non-completed orders: 0.
 */
export function deriveArrivalEtaMinutes(
  status: string,
  arriveAtDeliveryEtaIso: string | null,
  stagedAtIso: string | null
): number {
  if (status.trim().toUpperCase() !== 'COMPLETED') {
    return 0;
  }
  if (!arriveAtDeliveryEtaIso || !stagedAtIso) {
    return 0;
  }
  const etaSec = parseCanonicalIstTimestamp(arriveAtDeliveryEtaIso).epochSeconds;
  const stagedSec = parseCanonicalIstTimestamp(stagedAtIso).epochSeconds;
  return round4((etaSec - stagedSec) / 60);
}

/**
 * AM — OTP Performance
 * Original Excel rule: =IF(AK2<AL2,"OTP Achieved","OTP Breached")
 * Business requirement:
 *   - Non-completed orders -> "Not Applicable"
 *   - Completed orders -> AK < AL ? "OTP Achieved" : "OTP Breached"
 */
export function deriveOtpPerformance(
  status: string,
  actualArrivalMinutes: number,
  arrivalEtaMinutes: number
): OtpStatus {
  if (status.trim().toUpperCase() !== 'COMPLETED') {
    return 'Not Applicable';
  }
  return round4(actualArrivalMinutes) < round4(arrivalEtaMinutes)
    ? 'OTP Achieved'
    : 'OTP Breached';
}

/**
 * AN — OTP+3 Performance
 * Original Excel rule: =IF(AK2<(AL2+3),"OTP Achieved","OTP Breached")
 * Business requirement:
 *   - Non-completed orders -> "Not Applicable"
 *   - Completed orders -> AK < (AL + 3) ? "OTP Achieved" : "OTP Breached"
 */
export function deriveOtpPlus3Performance(
  status: string,
  actualArrivalMinutes: number,
  arrivalEtaMinutes: number
): OtpStatus {
  if (status.trim().toUpperCase() !== 'COMPLETED') {
    return 'Not Applicable';
  }
  return round4(actualArrivalMinutes) < round4(arrivalEtaMinutes + 3)
    ? 'OTP Achieved'
    : 'OTP Breached';
}

/**
 * Computes all 11 derived business fields (AD through AN) using the approved
 * Option B (Exact Second Precision) rules.
 */
export function calculateDerivedFields(
  source: NormalizedOrderSource,
  store: Pick<StoreMaster, 'store_code'>
): DerivedOrderFields {
  const order_type = deriveOrderType(source.order_id);
  const store_code = deriveStoreCode(store);
  const { slot_hour, order_date } = deriveSlotAndDate(source.order_created_at);
  const staging_to_pickup_minutes = deriveStagingToPickupMinutes(
    source.pickup_at,
    source.staged_at
  );
  const s2p_minutes = deriveS2pMinutes(staging_to_pickup_minutes);
  const distance_meters = deriveDistanceMeters(source.lm_distance);
  const actual_arrival_minutes = deriveActualArrivalMinutes(
    source.status,
    source.arrived_delivery_at,
    source.staged_at
  );
  const arrival_eta_minutes = deriveArrivalEtaMinutes(
    source.status,
    source.arrive_at_delivery_eta,
    source.staged_at
  );
  const otp_performance = deriveOtpPerformance(
    source.status,
    actual_arrival_minutes,
    arrival_eta_minutes
  );
  const otp_plus_3_performance = deriveOtpPlus3Performance(
    source.status,
    actual_arrival_minutes,
    arrival_eta_minutes
  );

  return {
    order_type,
    store_code,
    slot_hour,
    order_date,
    staging_to_pickup_minutes,
    s2p_minutes,
    distance_meters,
    actual_arrival_minutes,
    arrival_eta_minutes,
    otp_performance,
    otp_plus_3_performance,
  };
}

/**
 * Helper used in regression tests to verify 100% formula parity with the
 * 'Transform' worksheet when timestamps are floored to minute precision (:00 seconds),
 * isolating the exact differences caused by:
 *   1. 'Transform' sheet truncating seconds to :00 vs 'Raw Data' exact seconds
 *   2. 'Not Applicable' OTP status on non-completed orders
 *   3. Excel IEEE-754 floating-point drift at exact AK == AL + 3 boundaries
 */
export function calculateDerivedFieldsMinuteTruncated(
  source: NormalizedOrderSource,
  store: Pick<StoreMaster, 'store_code'>
): DerivedOrderFields {
  const floorToMinuteIso = (iso: string | null): string | null =>
    iso ? iso.replace(/:\d{2}(\+05:30)$/, ':00$1') : null;

  return calculateDerivedFields(
    {
      ...source,
      arrived_pickup_at: floorToMinuteIso(source.arrived_pickup_at),
      pickup_at: floorToMinuteIso(source.pickup_at),
      staged_at: floorToMinuteIso(source.staged_at),
      order_created_at: floorToMinuteIso(source.order_created_at) ?? source.order_created_at,
      arrive_at_delivery_eta: floorToMinuteIso(source.arrive_at_delivery_eta),
      arrived_delivery_at: floorToMinuteIso(source.arrived_delivery_at),
      rto_at: floorToMinuteIso(source.rto_at),
    },
    store
  );
}
