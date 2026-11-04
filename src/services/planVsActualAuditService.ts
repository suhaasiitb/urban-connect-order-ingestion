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
  fetchStoreRiderAttendance,
  isRiderWorkingInSlot,
} from './riderAttendanceService';
import { getRiderShiftsForStore, type RiderShiftConfig } from './riderShiftService';

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
  totalRosterCount: number;
  plannedPresentCount: number;
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
 * Fetches all distinct calendar dates available in orders for a store,
 * sorted descending (newest previous date first).
 */
export async function fetchAvailableAuditDates(
  storeId: string,
  timeZone: string = 'Asia/Kolkata'
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('order_date')
      .eq('store_id', storeId)
      .order('order_date', { ascending: false })
      .limit(1000);

    if (error || !data || data.length === 0) {
      return getFallbackAuditDates(timeZone);
    }

    const uniqueDates = Array.from(
      new Set(
        data
          .map((r) => String(r.order_date).slice(0, 10))
          .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d))
      )
    );

    uniqueDates.sort((a, b) => b.localeCompare(a));
    return uniqueDates.length > 0 ? uniqueDates : getFallbackAuditDates(timeZone);
  } catch {
    return getFallbackAuditDates(timeZone);
  }
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

  const dates: string[] = [];
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

/**
 * Core Reconciliation Engine:
 * Evaluates marked attendance & shifts vs actual order records for a single date.
 */
export async function fetchPlanVsActualAudit(params: {
  storeId: string;
  warehouseId: string;
  dateStr: string;
}): Promise<{
  data: PlanVsActualAuditSummary | null;
  error?: string;
}> {
  const { storeId, warehouseId, dateStr } = params;
  const normWh = (warehouseId || 'TMK7').toUpperCase().trim();

  try {
    // 1. Fetch attendance records and rider shifts for the store
    const [attendanceSummary, shiftsMap] = await Promise.all([
      fetchStoreRiderAttendance({
        storeId,
        warehouseId: normWh,
        attendanceDate: dateStr,
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
      const { data: pageRows, error: ordersError } = await supabase
        .from('orders')
        .select('rider_name, slot_hour, order_id')
        .eq('store_id', storeId)
        .eq('order_date', dateStr)
        .range(from, from + PAGE_SIZE - 1);

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

    // 3. Aggregate orders by normalized rider name
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

    // 4. Build unified map of riders across Attendance + Actual Orders
    const attendanceRecordsMap = new Map<string, RiderAttendanceRecord>();
    for (const rec of attendanceSummary.records) {
      const norm = rec.normalizedName || normalizeRiderName(rec.riderName);
      attendanceRecordsMap.set(norm, rec);
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
      const shiftType = attRecord?.shiftType || shiftConfig?.shiftType || 'Morning Shift';

      // Scheduled start and end hours
      const s1Start = Number(attRecord?.slot1StartHour ?? shiftConfig?.slot1StartHour ?? 6);
      const s1End = Number(attRecord?.slot1EndHour ?? shiftConfig?.slot1EndHour ?? 15);
      const s2Start = attRecord?.slot2StartHour ?? shiftConfig?.slot2StartHour ?? null;
      const s2End = attRecord?.slot2EndHour ?? shiftConfig?.slot2EndHour ?? null;

      // Determine all scheduled slot hours
      const scheduledSlots: number[] = [];
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

      const scheduledStartHour = scheduledSlots.length > 0 ? scheduledSlots[0] : s1Start;
      const scheduledEndHour =
        scheduledSlots.length > 0 ? scheduledSlots[scheduledSlots.length - 1] + 1 : s1End;

      const attendanceStatus: AttendanceStatus = attRecord
        ? attRecord.status
        : 'unmarked';
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

      // Calculate Missed Slots and Delays
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
          // Case 1: No-Show (False Present)
          adherenceCategory = 'NO_SHOW';
          adherenceBadgeText = '🔴 No-Show';
          adherenceSeverity = 'danger';
          noShowCount++;
          allMissedSlots.push(...scheduledSlots);
          totalMissedSlotHoursSum += scheduledSlots.length;
        } else {
          // Has orders: evaluate arrival and departure
          if (firstOrderHour !== null && firstOrderHour > scheduledStartHour) {
            // Late arrival
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
            // Early departure
            earlyDepartureHours = scheduledLastSlot - lastOrderHour;
            earlyDepartureCount++;
            for (const h of scheduledSlots) {
              if (h > lastOrderHour && !allMissedSlots.includes(h)) {
                missedEndingSlots.push(h);
                allMissedSlots.push(h);
              }
            }
          }

          // Check any intermediate scheduled slot missed
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
      } else {
        // Not marked present
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

    // Sort riders: No-shows first, then Late Arrivals, then Early Departures, then Unplanned, then Compliant, then Inactive
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

    // 5. Hourly Slot Reconciliation (Slots 6 AM to 11 PM)
    const hourlySlots: HourlySlotReconciliation[] = [];
    for (let h = 6; h <= 23; h++) {
      const plannedRiders: string[] = [];
      const actualRiders: string[] = [];

      for (const r of riders) {
        // Was rider planned for this slot?
        if (
          r.isPresentMarked &&
          isRiderWorkingInSlot(
            {
              slot1StartHour: r.scheduledStartHour,
              slot1EndHour: r.scheduledEndHour,
            },
            h
          )
        ) {
          plannedRiders.push(r.riderName);
        }

        // Did rider actually work in this slot?
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
        ? Math.round((actualWorkedCount / plannedPresentCount) * 100)
        : 0;

    const avgLateArrivalHours =
      lateArrivalCount > 0
        ? Math.round((totalLateHoursSum / lateArrivalCount) * 10) / 10
        : 0;

    return {
      data: {
        storeId,
        warehouseId: normWh,
        auditDate: dateStr,
        formattedDate,
        totalRosterCount: riders.length,
        plannedPresentCount,
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
      },
    };
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
      formatAuditSlotLabel(r.scheduledStartHour),
      formatAuditSlotLabel(r.scheduledEndHour),
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
