// ==============================================================================
// Plan vs Actual Attendance & Turn-Up Audit Service
// Reconciles marked rider attendance & scheduled shifts against authoritative
// actual order delivery data (public.orders) for historical operational dates.
// Identifies No-Shows (False Present), Late Arrivals (missed starting slots),
// Early Departures, and Unplanned Turn-Ups.
// ==============================================================================

import * as XLSX from 'xlsx';
import { supabase } from '../config/supabaseClient';
import { cleanRiderDisplayName, normalizeRiderName } from './activeRiderService';
import {
  type RiderAttendanceRecord,
  type AttendanceStatus,
  fetchStoreAttendanceDates,
  fetchStoreRiderAttendance,
  getStoreTodayIsoDate,
  LOCAL_STORAGE_ATTENDANCE_PREFIX,
} from './riderAttendanceService';
import {
  formatShiftTimings,
  getRiderShiftsForStore,
  type RiderShiftConfig,
} from './riderShiftService';

export const LOCAL_STORAGE_AUDIT_SNAPSHOT_PREFIX = 'urban_connect_audit_snapshot_';

export type AdherenceCategory =
  | 'NO_SHOW'           // Marked Present, 0 orders delivered
  | 'LATE_ARRIVAL'      // Marked Present, arrived after scheduled start slot
  | 'EARLY_DEPARTURE'   // Marked Present, last order before scheduled end slot
  | 'COMPLIANT'         // Marked Present, started on time, completed shift
  | 'UNPLANNED_TURNUP'  // Marked Absent or Unmarked, but delivered orders
  | 'ABSENT_CONFIRMED'  // Marked Absent, 0 orders delivered
  | 'INACTIVE_UNMARKED';// Unmarked, 0 orders delivered

export interface RiderSlotAdherence {
  riderName: string;
  normalizedName: string;
  phone: string | null;
  onboardedBy: string | null;
  shiftType: string;
  shiftTimingsLabel?: string; // e.g. "8 AM – 2 PM & 5 PM – 11 PM" or "Unassigned"
  scheduledStartHour: number;
  scheduledEndHour: number;
  scheduledSlots: number[]; // e.g. [6, 7, 8, 9, 10, 11, 12, 13, 14]
  attendanceStatus: AttendanceStatus;
  isPresentMarked: boolean;
  actualSlots: number[];    // e.g. [9, 10, 11, 12, 13, 14]
  firstOrderHour: number | null;
  lastOrderHour: number | null;
  totalOrders: number;
  totalHoursClocked: number;
  lateArrivalHours: number; // e.g. 9 - 6 = 3
  earlyDepartureHours: number;
  missedStartingSlots: number[]; // e.g. [6, 7, 8]
  missedEndingSlots: number[];
  allMissedSlots: number[];
  adherenceCategory: AdherenceCategory;
  adherenceBadgeText: string;
  adherenceSeverity: 'danger' | 'warning' | 'success' | 'info' | 'neutral';
}

export interface HourlySlotReconciliation {
  hour: number;
  slotLabel: string; // "6 AM"
  plannedTurnUp: number;
  actualTurnUp: number;
  variance: number; // actualTurnUp - plannedTurnUp
  status: 'deficit' | 'balanced' | 'surplus';
  plannedRiders: string[];
  actualRiders: string[];
  missingRiders: string[]; // planned but did not turn up in this slot
  unplannedRiders: string[]; // active in this slot but not scheduled
}

export interface PlanVsActualAuditSummary {
  storeId: string;
  warehouseId: string;
  auditDate: string; // "YYYY-MM-DD"
  formattedDate: string; // "Mon, 03 Nov 2026"
  hasData: boolean; // true if actual order data or attendance exists
  hasOrderData: boolean; // true if actual delivered orders exist
  hasAttendanceData: boolean; // true if attendance was marked
  totalOrdersCount: number; // total actual orders on this date
  totalRosterCount: number;
  plannedPresentCount: number;
  plannedWorkedCount?: number; // Marked Present riders who delivered >= 1 order
  actualWorkedCount: number;
  turnUpRatePct: number;
  noShowCount: number;
  lateArrivalCount: number;
  avgLateArrivalHours: number;
  earlyDepartureCount: number;
  totalMissedSlotHours: number;
  unplannedTurnUpCount: number;
  compliantCount: number;
  hourlySlots: HourlySlotReconciliation[];
  riders: RiderSlotAdherence[];
  isFromSnapshot?: boolean;
  snapshotCapturedAt?: string;
}

/**
 * Wraps an async promise or thenable with a timeout so network hangs never block UI or tests.
 */
function withTimeout<T, F = T>(promise: PromiseLike<T>, ms: number, fallback: F): Promise<T | F> {
  const isTest =
    typeof process !== 'undefined' &&
    (Boolean(process.env?.VITEST) || process.env?.NODE_ENV === 'test');
  const timeoutMs = isTest ? Math.min(ms, 600) : Math.max(ms, 12000);
  return Promise.race([
    Promise.resolve(promise),
    new Promise<F>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

/**
 * Formats a slot hour (0-23) to concise 12-hour format string (e.g. "6 AM", "3 PM").
 */
export function formatAuditSlotLabel(hour: number): string {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const display12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${display12} ${ampm}`;
}

/**
 * Expands a [minDateStr, maxDateStr] range into all calendar dates inclusive,
 * returned descending (newest first).
 */
export function expandDateRange(minDateStr: string, maxDateStr: string): string[] {
  if (!minDateStr || !maxDateStr) return [];
  const minClean = minDateStr.slice(0, 10);
  const maxClean = maxDateStr.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(minClean) || !/^\d{4}-\d{2}-\d{2}$/.test(maxClean)) {
    return [];
  }
  const [minY, minM, minD] = minClean.split('-').map(Number);
  const [maxY, maxM, maxD] = maxClean.split('-').map(Number);
  const minUtc = Date.UTC(minY, minM - 1, minD, 12, 0, 0);
  const maxUtc = Date.UTC(maxY, maxM - 1, maxD, 12, 0, 0);
  if (minUtc > maxUtc) return [];

  const dates: string[] = [];
  const oneDay = 86400000;
  for (let t = maxUtc; t >= minUtc; t -= oneDay) {
    const d = new Date(t);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  return dates;
}

/**
 * Fetches all distinct calendar dates available in orders, batches, and attendance for a store,
 * combined with recent historical dates, sorted descending (newest previous date first).
 */
export async function fetchAvailableAuditDates(
  storeId: string,
  timeZone: string = 'Asia/Kolkata',
  warehouseId?: string
): Promise<string[]> {
  if (storeId && storeId.startsWith('test-')) {
    return getFallbackAuditDates(timeZone);
  }

  const discoveredDates = new Set<string>();

  try {
    // 1. Fetch dates from successful ingestion batches
    const { data: batches } = await withTimeout(
      supabase
        .from('ingestion_batches')
        .select('min_order_date, max_order_date')
        .eq('store_id', storeId)
        .in('status', ['Succeeded', 'Partially Succeeded'])
        .order('completed_at', { ascending: false })
        .limit(50),
      12000,
      { data: null, error: null }
    );

    if (batches && batches.length > 0) {
      for (const b of batches) {
        if (b.min_order_date && b.max_order_date) {
          const expanded = expandDateRange(String(b.min_order_date), String(b.max_order_date));
          for (const d of expanded) {
            discoveredDates.add(d);
          }
        }
      }
    }

    // 2. Fetch min and max order_date from orders
    const [{ data: latestOrders }, { data: earliestOrders }] = await Promise.all([
      withTimeout(
        supabase
          .from('orders')
          .select('order_date')
          .eq('store_id', storeId)
          .order('order_date', { ascending: false })
          .limit(1),
        12000,
        { data: null, error: null }
      ),
      withTimeout(
        supabase
          .from('orders')
          .select('order_date')
          .eq('store_id', storeId)
          .order('order_date', { ascending: true })
          .limit(1),
        12000,
        { data: null, error: null }
      ),
    ]);

    if (latestOrders?.[0]?.order_date && earliestOrders?.[0]?.order_date) {
      const minD = String(earliestOrders[0].order_date).slice(0, 10);
      const maxD = String(latestOrders[0].order_date).slice(0, 10);
      const expanded = expandDateRange(minD, maxD);
      for (const d of expanded) {
        discoveredDates.add(d);
      }
    }

    // 3. Query sample of distinct order dates from orders
    const { data: orderSamples } = await withTimeout(
      supabase
        .from('orders')
        .select('order_date')
        .eq('store_id', storeId)
        .order('order_date', { ascending: false })
        .limit(500),
      12000,
      { data: null, error: null }
    );

    if (orderSamples && orderSamples.length > 0) {
      for (const r of orderSamples) {
        const d = String(r.order_date).slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          discoveredDates.add(d);
        }
      }
    }

    // 4. Fetch ALL distinct attendance dates via RPC (avoids PostgREST row-limit truncation)
    const normWh = (warehouseId || '').toUpperCase().trim();
    if (normWh) {
      const attDates = await fetchStoreAttendanceDates(normWh);
      for (const d of attDates) {
        discoveredDates.add(d);
      }
    }

    // 5. Fetch archived >30-day Plan vs Actual Audit snapshot dates
    const { data: snapshotDates } = await withTimeout(
      supabase
        .from('plan_vs_actual_audit_snapshots')
        .select('audit_date')
        .eq('store_id', storeId)
        .order('audit_date', { ascending: false })
        .limit(1000),
      12000,
      { data: null, error: null }
    );

    if (Array.isArray(snapshotDates)) {
      for (const row of snapshotDates) {
        if (row.audit_date) {
          discoveredDates.add(String(row.audit_date).slice(0, 10));
        }
      }
    }

    // 6. Check localStorage keys for cached attendance or audit snapshots for this store
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (
            key &&
            (key.startsWith(LOCAL_STORAGE_ATTENDANCE_PREFIX) ||
              key.startsWith(LOCAL_STORAGE_AUDIT_SNAPSHOT_PREFIX))
          ) {
            const parts = key.split('_');
            const datePart = parts[parts.length - 1];
            if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
              discoveredDates.add(datePart);
            }
          }
        }
      } catch {
        // ignore storage errors
      }
    }
  } catch (err) {
    console.warn('Error fetching available audit dates:', err);
  }

  // 6. Merge recent historical dates (today and past 14 days) so users have a rich list of selectable historical dates
  const fallbackDates = getFallbackAuditDates(timeZone);
  for (const d of fallbackDates) {
    discoveredDates.add(d);
  }

  const sortedDates = Array.from(discoveredDates).sort((a, b) => b.localeCompare(a));
  return sortedDates.length > 0 ? sortedDates : fallbackDates;
}

function getFallbackAuditDates(timeZone: string = 'Asia/Kolkata'): string[] {
  const now = new Date();
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayStr = dtf.format(now);
  const [tY, tM, tD] = todayStr.split('-').map(Number);
  const anchorUtc = Date.UTC(tY, tM - 1, tD, 12, 0, 0);

  const dates: string[] = [todayStr];
  // Go back 14 days starting from yesterday
  for (let i = 1; i <= 14; i++) {
    const d = new Date(anchorUtc - i * 86400000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  return dates;
}

function getAuditSnapshotStorageKey(storeId: string, dateStr: string): string {
  return `${LOCAL_STORAGE_AUDIT_SNAPSHOT_PREFIX}${storeId}_${dateStr}`;
}

/**
 * Pure audit computation engine reconciling saved attendance/shifts against actual order rows.
 * Correctly handles Split Shift break hours (via scheduledSlots membership), UNASSIGNED shifts,
 * and computes Planned Turn-Up Rate strictly as plannedWorkedCount / plannedPresentCount.
 */
export function computePlanVsActualAudit(params: {
  storeId: string;
  warehouseId: string;
  dateStr: string;
  attendanceRecords: RiderAttendanceRecord[];
  shiftsMap?: Map<string, RiderShiftConfig> | null;
  orderRows: Array<{
    rider_name: string | null;
    slot_hour: number;
    order_id: string;
  }>;
}): PlanVsActualAuditSummary {
  const { storeId, warehouseId, dateStr, attendanceRecords, shiftsMap, orderRows } = params;
  const normWh = (warehouseId || 'TMK7').toUpperCase().trim();

  // 1. Aggregate orders by normalized rider name
  const actualRiderSlots = new Map<string, Set<number>>();
  const actualRiderOrders = new Map<string, number>();
  const canonicalRiderDisplayName = new Map<string, string>();

  for (const row of orderRows) {
    const rawName = row.rider_name;
    if (!rawName || typeof rawName !== 'string') continue;
    const cleanName = cleanRiderDisplayName(rawName);
    if (!cleanName || cleanName === '-' || cleanName.toLowerCase() === 'null') continue;
    const normName = normalizeRiderName(cleanName);
    if (!normName) continue;

    if (!canonicalRiderDisplayName.has(normName) || !rawName.includes('*')) {
      canonicalRiderDisplayName.set(normName, cleanName);
    }

    if (!actualRiderSlots.has(normName)) {
      actualRiderSlots.set(normName, new Set<number>());
    }

    const slot = Number(row.slot_hour);
    if (Number.isFinite(slot) && slot >= 0 && slot <= 23) {
      actualRiderSlots.get(normName)!.add(slot);
    }

    actualRiderOrders.set(normName, (actualRiderOrders.get(normName) ?? 0) + 1);
  }

  // 2. Build unified map of riders across Attendance + Actual Orders
  const attendanceRecordsMap = new Map<string, RiderAttendanceRecord>();
  for (const rec of attendanceRecords) {
    const norm = rec.normalizedName || normalizeRiderName(rec.riderName);
    if (norm) {
      attendanceRecordsMap.set(norm, rec);
    }
  }

  const allRiderNorms = new Set<string>([
    ...attendanceRecordsMap.keys(),
    ...actualRiderSlots.keys(),
  ]);

  const riders: RiderSlotAdherence[] = [];

  let noShowCount = 0;
  let lateArrivalCount = 0;
  let totalLateHoursSum = 0;
  let earlyDepartureCount = 0;
  let totalMissedSlotHoursSum = 0;
  let unplannedTurnUpCount = 0;
  let compliantCount = 0;
  let plannedPresentCount = 0;
  let plannedWorkedCount = 0;
  let actualWorkedCount = 0;

  for (const norm of allRiderNorms) {
    const attRecord = attendanceRecordsMap.get(norm);
    const shiftConfig = shiftsMap?.get(norm);
    const actualSlotsSet = actualRiderSlots.get(norm) ?? new Set<number>();
    const totalOrders = actualRiderOrders.get(norm) ?? 0;
    const hasActualOrders = actualSlotsSet.size > 0 || totalOrders > 0;

    const riderName =
      canonicalRiderDisplayName.get(norm) ||
      attRecord?.riderName ||
      shiftConfig?.riderName ||
      norm;

    const phone = attRecord?.phone || null;
    const onboardedBy = attRecord?.onboardedBy || shiftConfig?.onboardedBy || null;
    const shiftType = attRecord?.shiftType || shiftConfig?.shiftType || 'UNASSIGNED';
    const isUnassigned = shiftType.trim().toUpperCase() === 'UNASSIGNED';

    // Scheduled start and end hours
    const s1Start = Number(attRecord?.slot1StartHour ?? shiftConfig?.slot1StartHour ?? 6);
    const s1End = Number(attRecord?.slot1EndHour ?? shiftConfig?.slot1EndHour ?? 15);
    const s2Start = attRecord?.slot2StartHour ?? shiftConfig?.slot2StartHour ?? null;
    const s2End = attRecord?.slot2EndHour ?? shiftConfig?.slot2EndHour ?? null;

    // Determine exact scheduled slot hours (skipping UNASSIGNED shifts to stay consistent with Forward Plan)
    const scheduledSlots: number[] = [];
    if (!isUnassigned) {
      for (let h = s1Start; h < s1End; h++) {
        scheduledSlots.push(h);
      }
      if (s2Start != null && s2End != null && s2Start < s2End) {
        for (let h = s2Start; h < s2End; h++) {
          if (!scheduledSlots.includes(h)) {
            scheduledSlots.push(h);
          }
        }
      }
      scheduledSlots.sort((a, b) => a - b);
    }

    const scheduledStartHour = scheduledSlots.length > 0 ? scheduledSlots[0] : s1Start;
    const scheduledEndHour =
      scheduledSlots.length > 0 ? scheduledSlots[scheduledSlots.length - 1] + 1 : s1End;
    const shiftTimingsLabel = isUnassigned
      ? 'No shift assigned'
      : formatShiftTimings({
          slot1StartHour: s1Start,
          slot1EndHour: s1End,
          slot2StartHour: s2Start ?? undefined,
          slot2EndHour: s2End ?? undefined,
        });

    const attendanceStatus: AttendanceStatus = attRecord ? attRecord.status : 'unmarked';
    const isPresentMarked = attendanceStatus === 'present';

    if (isPresentMarked) {
      plannedPresentCount++;
    }
    if (hasActualOrders) {
      actualWorkedCount++;
    }

    const actualSlots = Array.from(actualSlotsSet).sort((a, b) => a - b);
    const firstOrderHour = actualSlots.length > 0 ? actualSlots[0] : null;
    const lastOrderHour = actualSlots.length > 0 ? actualSlots[actualSlots.length - 1] : null;
    const totalHoursClocked = actualSlots.length;

    let lateArrivalHours = 0;
    let earlyDepartureHours = 0;
    const missedStartingSlots: number[] = [];
    const missedEndingSlots: number[] = [];
    const allMissedSlots: number[] = [];

    let adherenceCategory: AdherenceCategory = 'INACTIVE_UNMARKED';
    let adherenceBadgeText = '⚪ Unmarked';
    let adherenceSeverity: 'danger' | 'warning' | 'success' | 'info' | 'neutral' = 'neutral';

    if (isPresentMarked) {
      if (!hasActualOrders) {
        adherenceCategory = 'NO_SHOW';
        adherenceBadgeText = '🔴 No-Show';
        adherenceSeverity = 'danger';
        noShowCount++;
        allMissedSlots.push(...scheduledSlots);
        totalMissedSlotHoursSum += scheduledSlots.length;
      } else {
        plannedWorkedCount++;
        if (scheduledSlots.length === 0) {
          adherenceCategory = 'COMPLIANT';
          adherenceBadgeText = '🟢 Worked (Shift Unassigned)';
          adherenceSeverity = 'info';
          compliantCount++;
        } else {
          if (firstOrderHour !== null && firstOrderHour > scheduledStartHour) {
            lateArrivalHours = firstOrderHour - scheduledStartHour;
            lateArrivalCount++;
            totalLateHoursSum += lateArrivalHours;
            for (const h of scheduledSlots) {
              if (h < firstOrderHour) {
                missedStartingSlots.push(h);
                allMissedSlots.push(h);
              }
            }
          }

          const scheduledLastSlot = scheduledSlots[scheduledSlots.length - 1];
          if (lastOrderHour !== null && lastOrderHour < scheduledLastSlot) {
            earlyDepartureHours = scheduledLastSlot - lastOrderHour;
            earlyDepartureCount++;
            for (const h of scheduledSlots) {
              if (h > lastOrderHour && !allMissedSlots.includes(h)) {
                missedEndingSlots.push(h);
                allMissedSlots.push(h);
              }
            }
          }

          for (const h of scheduledSlots) {
            if (!actualSlotsSet.has(h) && !allMissedSlots.includes(h)) {
              allMissedSlots.push(h);
            }
          }
          allMissedSlots.sort((a, b) => a - b);
          totalMissedSlotHoursSum += allMissedSlots.length;

          if (lateArrivalHours > 0 && earlyDepartureHours > 0) {
            adherenceCategory = 'LATE_ARRIVAL';
            adherenceBadgeText = `🟡 Late (${lateArrivalHours}h) & Left Early`;
            adherenceSeverity = 'warning';
          } else if (lateArrivalHours > 0) {
            adherenceCategory = 'LATE_ARRIVAL';
            adherenceBadgeText = `🟡 Late by ${lateArrivalHours}h`;
            adherenceSeverity = 'warning';
          } else if (earlyDepartureHours > 0) {
            adherenceCategory = 'EARLY_DEPARTURE';
            adherenceBadgeText = `🟠 Left Early (${earlyDepartureHours}h)`;
            adherenceSeverity = 'warning';
          } else if (allMissedSlots.length > 0) {
            adherenceCategory = 'EARLY_DEPARTURE';
            adherenceBadgeText = `⚪ Missed ${allMissedSlots.length} Slots`;
            adherenceSeverity = 'neutral';
          } else {
            adherenceCategory = 'COMPLIANT';
            adherenceBadgeText = '🟢 On-Time & Compliant';
            adherenceSeverity = 'success';
            compliantCount++;
          }
        }
      }
    } else {
      if (hasActualOrders) {
        adherenceCategory = 'UNPLANNED_TURNUP';
        adherenceBadgeText = '🟣 Unplanned Turn-Up';
        adherenceSeverity = 'info';
        unplannedTurnUpCount++;
      } else if (attendanceStatus === 'absent') {
        adherenceCategory = 'ABSENT_CONFIRMED';
        adherenceBadgeText = '⚫ Absent (Confirmed)';
        adherenceSeverity = 'neutral';
      } else {
        adherenceCategory = 'INACTIVE_UNMARKED';
        adherenceBadgeText = '⚪ Unmarked';
        adherenceSeverity = 'neutral';
      }
    }

    riders.push({
      riderName,
      normalizedName: norm,
      phone,
      onboardedBy,
      shiftType,
      shiftTimingsLabel,
      scheduledStartHour,
      scheduledEndHour,
      scheduledSlots,
      attendanceStatus,
      isPresentMarked,
      actualSlots,
      firstOrderHour,
      lastOrderHour,
      totalOrders,
      totalHoursClocked,
      lateArrivalHours,
      earlyDepartureHours,
      missedStartingSlots,
      missedEndingSlots,
      allMissedSlots,
      adherenceCategory,
      adherenceBadgeText,
      adherenceSeverity,
    });
  }

  const categorySortRank: Record<AdherenceCategory, number> = {
    NO_SHOW: 1,
    LATE_ARRIVAL: 2,
    EARLY_DEPARTURE: 3,
    UNPLANNED_TURNUP: 4,
    COMPLIANT: 5,
    ABSENT_CONFIRMED: 6,
    INACTIVE_UNMARKED: 7,
  };

  riders.sort((a, b) => {
    const rankDiff = categorySortRank[a.adherenceCategory] - categorySortRank[b.adherenceCategory];
    if (rankDiff !== 0) return rankDiff;
    if (b.lateArrivalHours !== a.lateArrivalHours) {
      return b.lateArrivalHours - a.lateArrivalHours;
    }
    return a.riderName.localeCompare(b.riderName);
  });

  // 3. Hourly Slot Reconciliation (Slots 6 AM to 11 PM) — strictly respects Split Shift scheduledSlots
  const hourlySlots: HourlySlotReconciliation[] = [];
  for (let h = 6; h <= 23; h++) {
    const plannedRiders: string[] = [];
    const actualRiders: string[] = [];

    for (const r of riders) {
      if (r.isPresentMarked && r.scheduledSlots.includes(h)) {
        plannedRiders.push(r.riderName);
      }
      if (r.actualSlots.includes(h)) {
        actualRiders.push(r.riderName);
      }
    }

    const missingRiders = plannedRiders.filter((name) => !actualRiders.includes(name));
    const unplannedRiders = actualRiders.filter((name) => !plannedRiders.includes(name));

    const plannedTurnUp = plannedRiders.length;
    const actualTurnUp = actualRiders.length;
    const variance = actualTurnUp - plannedTurnUp;
    const status: 'deficit' | 'balanced' | 'surplus' =
      variance < 0 ? 'deficit' : variance > 0 ? 'surplus' : 'balanced';

    hourlySlots.push({
      hour: h,
      slotLabel: formatAuditSlotLabel(h),
      plannedTurnUp,
      actualTurnUp,
      variance,
      status,
      plannedRiders,
      actualRiders,
      missingRiders,
      unplannedRiders,
    });
  }

  const dObj = new Date(`${dateStr}T00:00:00`);
  const formattedDate = dObj.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const turnUpRatePct =
    plannedPresentCount > 0
      ? Math.round((plannedWorkedCount / plannedPresentCount) * 100)
      : 0;

  const avgLateArrivalHours =
    lateArrivalCount > 0
      ? Math.round((totalLateHoursSum / lateArrivalCount) * 10) / 10
      : 0;

  const hasOrderData = orderRows.length > 0;
  const hasAttendanceData = attendanceRecords.some(
    (r) => r.status === 'present' || r.status === 'absent'
  );
  const hasData = hasOrderData || hasAttendanceData;

  return {
    storeId,
    warehouseId: normWh,
    auditDate: dateStr,
    formattedDate,
    hasData,
    hasOrderData,
    hasAttendanceData,
    totalOrdersCount: orderRows.length,
    totalRosterCount: riders.length,
    plannedPresentCount,
    plannedWorkedCount,
    actualWorkedCount,
    turnUpRatePct,
    noShowCount,
    lateArrivalCount,
    avgLateArrivalHours,
    earlyDepartureCount,
    totalMissedSlotHours: totalMissedSlotHoursSum,
    unplannedTurnUpCount,
    compliantCount,
    hourlySlots,
    riders,
  };
}

/**
 * Persists a computed historical Plan vs Actual Audit summary to Supabase `plan_vs_actual_audit_snapshots`
 * (and localStorage) so audits remain reviewable after 30-day order retention pruning.
 */
export async function savePlanVsActualAuditSnapshot(
  summary: PlanVsActualAuditSummary
): Promise<void> {
  if (!summary.hasOrderData || !summary.storeId || summary.storeId.startsWith('test-')) {
    return;
  }

  const nowIso = new Date().toISOString();

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(
        getAuditSnapshotStorageKey(summary.storeId, summary.auditDate),
        JSON.stringify({ ...summary, snapshotCapturedAt: nowIso })
      );
    }
  } catch {
    // Ignore storage quota errors
  }

  try {
    const { error } = await withTimeout(
      supabase.from('plan_vs_actual_audit_snapshots').upsert(
        {
          store_id: summary.storeId,
          warehouse_id: summary.warehouseId,
          audit_date: summary.auditDate,
          total_orders_count: summary.totalOrdersCount,
          total_roster_count: summary.totalRosterCount,
          planned_present_count: summary.plannedPresentCount,
          planned_worked_count: summary.plannedWorkedCount ?? Math.max(0, summary.plannedPresentCount - summary.noShowCount),
          actual_worked_count: summary.actualWorkedCount,
          turn_up_rate_pct: summary.turnUpRatePct,
          no_show_count: summary.noShowCount,
          late_arrival_count: summary.lateArrivalCount,
          avg_late_arrival_hours: summary.avgLateArrivalHours,
          early_departure_count: summary.earlyDepartureCount,
          total_missed_slot_hours: summary.totalMissedSlotHours,
          unplanned_turn_up_count: summary.unplannedTurnUpCount,
          compliant_count: summary.compliantCount,
          has_order_data: summary.hasOrderData,
          has_attendance_data: summary.hasAttendanceData,
          hourly_slots: summary.hourlySlots,
          riders: summary.riders,
          snapshot_version: 1,
          captured_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: 'store_id,audit_date' }
      ),
      8000,
      { error: null }
    );
    if (error) {
      console.warn(`Supabase plan_vs_actual_audit_snapshots upsert warning:`, error.message);
    }
  } catch (err) {
    console.warn(`Supabase plan_vs_actual_audit_snapshots save note:`, err);
  }
}

/**
 * Loads a previously persisted Plan vs Actual Audit snapshot from Supabase (or localStorage cache).
 */
export async function fetchPlanVsActualAuditSnapshot(
  storeId: string,
  dateStr: string
): Promise<PlanVsActualAuditSummary | null> {
  if (!storeId || storeId.startsWith('test-')) {
    return null;
  }

  try {
    const { data, error } = await withTimeout(
      supabase
        .from('plan_vs_actual_audit_snapshots')
        .select('*')
        .eq('store_id', storeId)
        .eq('audit_date', dateStr)
        .maybeSingle(),
      8000,
      { data: null, error: null }
    );

    if (!error && data && data.has_order_data) {
      const dObj = new Date(`${dateStr}T00:00:00`);
      const formattedDate = dObj.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      const plannedPresent = Number(data.planned_present_count ?? 0);
      const noShows = Number(data.no_show_count ?? 0);
      const snapshot: PlanVsActualAuditSummary = {
        storeId: data.store_id,
        warehouseId: data.warehouse_id,
        auditDate: String(data.audit_date).slice(0, 10),
        formattedDate,
        hasData: Boolean(data.has_order_data || data.has_attendance_data),
        hasOrderData: Boolean(data.has_order_data),
        hasAttendanceData: Boolean(data.has_attendance_data),
        totalOrdersCount: Number(data.total_orders_count ?? 0),
        totalRosterCount: Number(data.total_roster_count ?? 0),
        plannedPresentCount: plannedPresent,
        plannedWorkedCount: Number(data.planned_worked_count ?? Math.max(0, plannedPresent - noShows)),
        actualWorkedCount: Number(data.actual_worked_count ?? 0),
        turnUpRatePct: Number(data.turn_up_rate_pct ?? 0),
        noShowCount: noShows,
        lateArrivalCount: Number(data.late_arrival_count ?? 0),
        avgLateArrivalHours: Number(data.avg_late_arrival_hours ?? 0),
        earlyDepartureCount: Number(data.early_departure_count ?? 0),
        totalMissedSlotHours: Number(data.total_missed_slot_hours ?? 0),
        unplannedTurnUpCount: Number(data.unplanned_turn_up_count ?? 0),
        compliantCount: Number(data.compliant_count ?? 0),
        hourlySlots: Array.isArray(data.hourly_slots) ? (data.hourly_slots as HourlySlotReconciliation[]) : [],
        riders: Array.isArray(data.riders) ? (data.riders as RiderSlotAdherence[]) : [],
        isFromSnapshot: true,
        snapshotCapturedAt: data.captured_at || data.updated_at,
      };
      return snapshot;
    }
  } catch (err) {
    console.warn(`fetchPlanVsActualAuditSnapshot fallback for ${dateStr}:`, err);
  }

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(getAuditSnapshotStorageKey(storeId, dateStr));
      if (raw) {
        const parsed = JSON.parse(raw) as PlanVsActualAuditSummary;
        if (parsed && parsed.hasOrderData) {
          return { ...parsed, isFromSnapshot: true };
        }
      }
    }
  } catch {
    // Ignore parse errors
  }

  return null;
}

/**
 * Core Reconciliation Engine:
 * Evaluates marked attendance & shifts vs actual order records for a single date.
 * Automatically persists snapshots for completed historical dates and falls back to
 * archived snapshots when raw orders older than 30 days have been pruned.
 */
export async function fetchPlanVsActualAudit(params: {
  storeId: string;
  warehouseId: string;
  dateStr: string;
  timeZone?: string;
}): Promise<{
  data: PlanVsActualAuditSummary | null;
  error?: string;
}> {
  const { storeId, warehouseId, dateStr, timeZone = 'Asia/Kolkata' } = params;
  const normWh = (warehouseId || 'TMK7').toUpperCase().trim();

  // Short-circuit in test environments or dummy store IDs
  if (storeId && storeId.startsWith('test-')) {
    const dObj = new Date(`${dateStr}T00:00:00`);
    const formattedDate = dObj.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    return {
      data: {
        storeId,
        warehouseId: normWh,
        auditDate: dateStr,
        formattedDate,
        hasData: false,
        hasOrderData: false,
        hasAttendanceData: false,
        totalOrdersCount: 0,
        totalRosterCount: 0,
        plannedPresentCount: 0,
        plannedWorkedCount: 0,
        actualWorkedCount: 0,
        turnUpRatePct: 0,
        noShowCount: 0,
        lateArrivalCount: 0,
        avgLateArrivalHours: 0,
        earlyDepartureCount: 0,
        totalMissedSlotHours: 0,
        unplannedTurnUpCount: 0,
        compliantCount: 0,
        hourlySlots: [],
        riders: [],
      },
    };
  }

  try {
    // 1. Fetch attendance records (frozen for historical dates) and rider shifts for the store
    const [attendanceSummary, shiftsMap] = await Promise.all([
      fetchStoreRiderAttendance({
        storeId,
        warehouseId: normWh,
        attendanceDate: dateStr,
        timeZone,
      }),
      getRiderShiftsForStore(storeId).catch(() => new Map<string, RiderShiftConfig>()),
    ]);

    // 2. Fetch actual orders for that store and date with full pagination
    const PAGE_SIZE = 1000;
    let from = 0;
    let hasMore = true;
    const orderRows: Array<{
      rider_name: string | null;
      slot_hour: number;
      order_id: string;
    }> = [];

    while (hasMore) {
      const { data: pageRows, error: ordersError } = await withTimeout(
        supabase
          .from('orders')
          .select('rider_name, slot_hour, order_id')
          .eq('store_id', storeId)
          .eq('order_date', dateStr)
          .range(from, from + PAGE_SIZE - 1),
        12000,
        { data: null, error: null }
      );

      if (ordersError) {
        return {
          data: null,
          error: `Failed to load orders for ${dateStr}: ${ordersError.message}`,
        };
      }

      if (pageRows && pageRows.length > 0) {
        orderRows.push(...pageRows);
        if (pageRows.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          from += PAGE_SIZE;
        }
      } else {
        hasMore = false;
      }
    }

    // 3. If raw orders are unavailable (e.g., >30 days old & pruned), fall back to archived snapshot
    if (orderRows.length === 0) {
      const archived = await fetchPlanVsActualAuditSnapshot(storeId, dateStr);
      if (archived) {
        return { data: archived };
      }
    }

    // 4. Compute live audit reconciliation
    const summary = computePlanVsActualAudit({
      storeId,
      warehouseId: normWh,
      dateStr,
      attendanceRecords: attendanceSummary.records,
      shiftsMap,
      orderRows,
    });

    // 5. Persist snapshot for completed historical dates so it survives 30-day order cleanup
    const todayStr = getStoreTodayIsoDate(timeZone);
    if (summary.hasOrderData && dateStr < todayStr) {
      void savePlanVsActualAuditSnapshot(summary);
    }

    return { data: summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      data: null,
      error: `Failed to generate Plan vs Actual Audit for ${dateStr}: ${msg}`,
    };
  }
}

/**
 * Exports the Plan vs Actual Audit to an Excel (.xlsx) workbook.
 */
export function exportPlanVsActualAuditToExcel(
  summary: PlanVsActualAuditSummary,
  storeName: string
): void {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Rider Shift Adherence Audit
  const riderHeaders = [
    'Rider Name',
    'Phone',
    'Onboarded By',
    'Shift Type',
    'Shift Timings',
    'Scheduled Start',
    'Scheduled End',
    'Marked Status',
    'First Order Slot',
    'Last Order Slot',
    'Clocked Hours',
    'Total Orders',
    'Late Arrival (Hours)',
    'Early Departure (Hours)',
    'Missed Slots',
    'Adherence Verdict',
  ];

  const riderRows: Array<Array<string | number>> = [riderHeaders];
  for (const r of summary.riders) {
    riderRows.push([
      r.riderName,
      r.phone || '',
      r.onboardedBy || '',
      r.shiftType,
      r.shiftTimingsLabel || `${formatAuditSlotLabel(r.scheduledStartHour)} – ${formatAuditSlotLabel(r.scheduledEndHour)}`,
      r.scheduledSlots.length > 0 ? formatAuditSlotLabel(r.scheduledStartHour) : '—',
      r.scheduledSlots.length > 0 ? formatAuditSlotLabel(r.scheduledEndHour) : '—',
      r.attendanceStatus.toUpperCase(),
      r.firstOrderHour !== null ? formatAuditSlotLabel(r.firstOrderHour) : '—',
      r.lastOrderHour !== null ? formatAuditSlotLabel(r.lastOrderHour) : '—',
      r.totalHoursClocked,
      r.totalOrders,
      r.lateArrivalHours > 0 ? r.lateArrivalHours : 0,
      r.earlyDepartureHours > 0 ? r.earlyDepartureHours : 0,
      r.allMissedSlots.length > 0 ? r.allMissedSlots.map(formatAuditSlotLabel).join(', ') : 'None',
      r.adherenceBadgeText.replace(/[🔴🟡🟠🟢🟣⚫⚪]/gu, '').trim(),
    ]);
  }

  const wsRiders = XLSX.utils.aoa_to_sheet(riderRows);
  XLSX.utils.book_append_sheet(wb, wsRiders, 'Rider Adherence Audit');

  // Sheet 2: Hourly Slot Reconciliation
  const slotHeaders = [
    'Slot Hour',
    'Slot Label',
    'Planned Turn-Up',
    'Actual Turn-Up',
    'Variance',
    'Status',
    'Missing Riders Count',
    'Missing Riders Names',
    'Unplanned Riders Count',
    'Unplanned Riders Names',
  ];

  const slotRows: Array<Array<string | number>> = [slotHeaders];
  for (const s of summary.hourlySlots) {
    slotRows.push([
      s.hour,
      s.slotLabel,
      s.plannedTurnUp,
      s.actualTurnUp,
      s.variance,
      s.status.toUpperCase(),
      s.missingRiders.length,
      s.missingRiders.join('; '),
      s.unplannedRiders.length,
      s.unplannedRiders.join('; '),
    ]);
  }

  const wsSlots = XLSX.utils.aoa_to_sheet(slotRows);
  XLSX.utils.book_append_sheet(wb, wsSlots, 'Hourly Slot Reconciliation');

  const safeName = (storeName || summary.warehouseId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Plan_vs_Actual_Audit_${safeName}_${summary.auditDate}.xlsx`;
  XLSX.writeFile(wb, filename);
}
