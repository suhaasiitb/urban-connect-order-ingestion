// ==============================================================================
// Rider Attendance & Turn-Up Planning Service
// Handles daily rider attendance marking (unmarked, present, absent),
// dual-persistence (Supabase store_rider_attendance + localStorage cache),
// real-time cross-client replication, and hourly slot turn-up derivation
// from marked Present riders and their shift timings.
// ==============================================================================

import { supabase } from '../config/supabaseClient';
import { normalizeRiderName, getActiveRidersRoster } from './activeRiderService';
import {
  type RiderShiftConfig,
  SHIFT_PRESETS,
  formatShiftTimings,
  getRiderShiftsForStore,
} from './riderShiftService';

export type AttendanceStatus = 'unmarked' | 'present' | 'absent';

export interface RiderAttendanceRecord {
  id?: string;
  storeId?: string;
  warehouseId: string;
  attendanceDate: string; // "YYYY-MM-DD"
  riderName: string;
  normalizedName: string;
  phone?: string | null;
  shiftType: string;
  slot1StartHour: number; // 0 to 23
  slot1EndHour: number;   // 1 to 24
  slot2StartHour?: number | null;
  slot2EndHour?: number | null;
  status: AttendanceStatus;
  isPresent: boolean;
  notes?: string | null;
  onboardedBy?: string | null;
  updatedAt?: string;
  updatedBy?: string;
}

export interface StoreAttendanceSummary {
  storeId?: string;
  warehouseId: string;
  attendanceDate: string;
  totalRiders: number;
  presentCount: number;
  absentCount: number;
  unmarkedCount: number;
  records: RiderAttendanceRecord[];
  isFullyMarked: boolean;
  lastUpdated?: string;
  updatedBy?: string;
}

export const LOCAL_STORAGE_ATTENDANCE_PREFIX = 'urban_connect_rider_attendance_';
export const STORE_ATTENDANCE_CHANGE_EVENT = 'store_rider_attendance_changed';

/**
 * Returns today's ISO calendar date ("YYYY-MM-DD") in the given store timezone.
 */
export function getStoreTodayIsoDate(timeZone: string = 'Asia/Kolkata'): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Returns true when attendanceDate is strictly earlier than today (or referenceDate),
 * meaning saved records represent a historical snapshot that must not be mutated by
 * today's active roster or later shift changes.
 */
export function isHistoricalAttendanceDate(
  attendanceDate: string,
  timeZone: string = 'Asia/Kolkata',
  referenceDate?: string
): boolean {
  if (!attendanceDate || !/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) {
    return false;
  }
  const ref =
    referenceDate && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate)
      ? referenceDate
      : getStoreTodayIsoDate(timeZone);
  return attendanceDate < ref;
}

/**
 * Non-destructively enriches historical records with missing phone / onboardedBy metadata
 * without removing inactive former riders, adding new riders, or altering saved shift timings.
 */
function enrichHistoricalAttendanceRecords(
  records: RiderAttendanceRecord[],
  activeRiders?: Array<{ name: string; phone?: string }>,
  shiftsMap?: Map<string, RiderShiftConfig> | null
): RiderAttendanceRecord[] {
  const phoneByNorm = new Map<string, string>();
  if (activeRiders && activeRiders.length > 0) {
    for (const r of activeRiders) {
      const norm = normalizeRiderName(r.name);
      if (norm && r.phone && !phoneByNorm.has(norm)) {
        phoneByNorm.set(norm, r.phone);
      }
    }
  }

  return records
    .map((rec) => {
      const norm = rec.normalizedName || normalizeRiderName(rec.riderName);
      const phone = rec.phone || phoneByNorm.get(norm) || null;
      const shift = shiftsMap?.get(norm);
      const onboardedBy = rec.onboardedBy || shift?.onboardedBy || null;
      return {
        ...rec,
        normalizedName: norm,
        phone,
        onboardedBy,
      };
    })
    .sort((a, b) => a.riderName.localeCompare(b.riderName));
}

/**
 * Fetches all distinct saved attendance dates ("YYYY-MM-DD", sorted ascending) for a warehouse
 * using the `get_store_attendance_dates` RPC (with paginated fallback and localStorage merge).
 */
export async function fetchStoreAttendanceDates(warehouseId: string): Promise<string[]> {
  const normWh = (warehouseId || 'TMK7').toUpperCase().trim();
  const dateSet = new Set<string>();

  // 1. Merge any cached localStorage attendance dates for this warehouse
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const prefix = `${LOCAL_STORAGE_ATTENDANCE_PREFIX}${normWh}_`;
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          const datePart = key.slice(prefix.length);
          if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
            dateSet.add(datePart);
          }
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  // 2. Query Supabase via distinct RPC (avoids PostgREST 1,000-row cap)
  try {
    const rpcRes = await withTimeout(
      supabase.rpc('get_store_attendance_dates', { p_warehouse_id: normWh }),
      8000,
      { data: null, error: { message: 'RPC timeout' } }
    );

    if (!rpcRes.error && Array.isArray(rpcRes.data)) {
      for (const row of rpcRes.data as Array<{ attendance_date?: string }>) {
        const d = row?.attendance_date ? String(row.attendance_date).slice(0, 10) : '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          dateSet.add(d);
        }
      }
      return Array.from(dateSet).sort();
    }

    // Fallback if RPC is not deployed yet: paginate attendance_date column
    const PAGE_SIZE = 1000;
    let from = 0;
    let hasMore = true;
    while (hasMore && from < 20000) {
      const pageRes = await withTimeout(
        supabase
          .from('store_rider_attendance')
          .select('attendance_date')
          .eq('warehouse_id', normWh)
          .order('attendance_date', { ascending: false })
          .range(from, from + PAGE_SIZE - 1),
        8000,
        { data: null, error: { message: 'Timeout' } }
      );
      if (pageRes.error || !Array.isArray(pageRes.data) || pageRes.data.length === 0) {
        break;
      }
      for (const row of pageRes.data) {
        const d = row.attendance_date ? String(row.attendance_date).slice(0, 10) : '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          dateSet.add(d);
        }
      }
      if (pageRes.data.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        from += PAGE_SIZE;
      }
    }
  } catch (err) {
    console.warn(`fetchStoreAttendanceDates warning for ${normWh}:`, err);
  }

  return Array.from(dateSet).sort();
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
 * Generates local storage key for store date attendance
 */
export function getStoreAttendanceStorageKey(warehouseId: string, attendanceDate: string): string {
  const normWh = (warehouseId || 'TMK7').toUpperCase().trim();
  return `${LOCAL_STORAGE_ATTENDANCE_PREFIX}${normWh}_${attendanceDate}`;
}

function isAssignedAttendanceShift(shiftType?: string | null): boolean {
  return Boolean(shiftType && shiftType.trim().toUpperCase() !== 'UNASSIGNED');
}

/**
 * Filters attendance records to riders present in the active roster (when non-empty),
 * enriching missing phone numbers and canonical names from activeRiders.
 */
export function filterRecordsByActiveRoster(
  records: RiderAttendanceRecord[],
  activeRiders?: Array<{ name: string; phone?: string }>
): RiderAttendanceRecord[] {
  if (!activeRiders || activeRiders.length === 0) {
    return records;
  }

  const activeByNorm = new Map<string, { name: string; phone?: string }>();
  for (const r of activeRiders) {
    const norm = normalizeRiderName(r.name);
    if (norm && !activeByNorm.has(norm)) {
      activeByNorm.set(norm, { name: r.name, phone: r.phone });
    }
  }

  return records
    .filter((rec) => {
      const norm = rec.normalizedName || normalizeRiderName(rec.riderName);
      return Boolean(norm && activeByNorm.has(norm));
    })
    .map((rec) => {
      const norm = rec.normalizedName || normalizeRiderName(rec.riderName);
      const activeEntry = activeByNorm.get(norm);
      if (!rec.phone && activeEntry?.phone) {
        return { ...rec, normalizedName: norm, phone: activeEntry.phone };
      }
      return { ...rec, normalizedName: norm };
    });
}

/**
 * Checks if a rider's shift timings cover a specific slot hour (0-23).
 * Slot 1: [slot1StartHour, slot1EndHour)
 * Slot 2: [slot2StartHour, slot2EndHour) if split shift.
 */
export function isRiderWorkingInSlot(
  shift: {
    slot1StartHour: number;
    slot1EndHour: number;
    slot2StartHour?: number | null;
    slot2EndHour?: number | null;
  },
  hour: number
): boolean {
  const s1Start = Number(shift.slot1StartHour ?? 6);
  const s1End = Number(shift.slot1EndHour ?? 15);

  let inSlot1 = false;
  if (s1Start < s1End) {
    inSlot1 = hour >= s1Start && hour < s1End;
  } else if (s1Start > s1End) {
    inSlot1 = hour >= s1Start || hour < s1End;
  }

  if (inSlot1) return true;

  if (
    shift.slot2StartHour !== undefined &&
    shift.slot2StartHour !== null &&
    shift.slot2EndHour !== undefined &&
    shift.slot2EndHour !== null
  ) {
    const s2Start = Number(shift.slot2StartHour);
    const s2End = Number(shift.slot2EndHour);
    if (s2Start < s2End) {
      return hour >= s2Start && hour < s2End;
    } else if (s2Start > s2End) {
      return hour >= s2Start || hour < s2End;
    }
  }

  return false;
}

/**
 * Synchronizes attendance records with the latest shift configurations from store_rider_shifts.
 * Updates shiftType, slot timings, and onboardedBy for any rider whose shift was edited.
 * For already-saved attendance records (where rec.updatedAt is present), only overwrites
 * shift timings if the shift configuration was updated at or after the attendance record,
 * preventing stale shift rows from clobbering confirmed attendance shift timings.
 */
export function syncAttendanceWithLatestShifts(
  records: RiderAttendanceRecord[],
  shiftsMap?: Map<string, RiderShiftConfig> | null
): RiderAttendanceRecord[] {
  if (!records || records.length === 0 || !shiftsMap || shiftsMap.size === 0) {
    return records;
  }

  return records.map((rec) => {
    const norm = rec.normalizedName || normalizeRiderName(rec.riderName);
    const shift = shiftsMap.get(norm);
    if (!shift) return rec;

    if (rec.updatedAt) {
      const recTime = new Date(rec.updatedAt).getTime();
      const shiftTime = shift.updatedAt ? new Date(shift.updatedAt).getTime() : 0;
      if (!shiftTime || shiftTime < recTime) {
        return {
          ...rec,
          onboardedBy: rec.onboardedBy || shift.onboardedBy || null,
        };
      }
    }

    return {
      ...rec,
      shiftType: shift.shiftType || rec.shiftType,
      slot1StartHour: shift.slot1StartHour ?? rec.slot1StartHour,
      slot1EndHour: shift.slot1EndHour ?? rec.slot1EndHour,
      slot2StartHour:
        shift.slot2StartHour !== undefined ? shift.slot2StartHour : rec.slot2StartHour,
      slot2EndHour:
        shift.slot2EndHour !== undefined ? shift.slot2EndHour : rec.slot2EndHour,
      onboardedBy:
        shift.onboardedBy !== undefined ? shift.onboardedBy : rec.onboardedBy,
    };
  });
}

/**
 * Calculates hourly expected turn-up (riders count) for slots 6 to 23.
 * - When riders are marked 'present', counts marked Present riders.
 * - When attendance is unmarked (default state before attendance is marked) and fallbackToRosterIfUnmarked is true,
 *   counts scheduled roster riders whose shift covers that slot (excluding explicitly absent riders).
 */
export function calculateSlotTurnUpFromAttendance(
  records: RiderAttendanceRecord[],
  options?: { fallbackToRosterIfUnmarked?: boolean }
): Record<number, number> {
  const slotMap: Record<number, number> = {};
  for (let h = 0; h < 24; h++) {
    slotMap[h] = 0;
  }

  if (!records || records.length === 0) {
    return slotMap;
  }

  const presentRiders = records.filter(
    (r) => r.status === 'present' || r.isPresent === true
  );

  let targetRiders: RiderAttendanceRecord[];
  if (presentRiders.length > 0) {
    targetRiders = presentRiders;
  } else if (options?.fallbackToRosterIfUnmarked) {
    // When attendance is unmarked, planned turn-up is derived from scheduled roster shifts
    targetRiders = records.filter((r) => r.status !== 'absent');
  } else {
    targetRiders = [];
  }

  for (const rider of targetRiders) {
    if (!isAssignedAttendanceShift(rider.shiftType)) continue;
    for (let h = 6; h <= 23; h++) {
      if (isRiderWorkingInSlot(rider, h)) {
        slotMap[h] = (slotMap[h] || 0) + 1;
      }
    }
  }

  return slotMap;
}

export interface SlotRiderInfo {
  riderName: string;
  normalizedName: string;
  phone?: string | null;
  shiftType: string;
  slot1StartHour: number;
  slot1EndHour: number;
  slot2StartHour?: number | null;
  slot2EndHour?: number | null;
  status: AttendanceStatus;
  isPresent: boolean;
  onboardedBy?: string | null;
  isCountedInTurnUp: boolean;
  timingsFormatted: string;
}

/**
 * Returns the list of riders active in a specific slot hour, indicating whether
 * each rider is counted in the turn-up count, along with their shift timings, status, and onboardedBy.
 */
export function getRidersForSlot(
  records: RiderAttendanceRecord[],
  slotHour: number,
  options?: { fallbackToRosterIfUnmarked?: boolean }
): SlotRiderInfo[] {
  if (!records || records.length === 0) return [];

  const hasPresentRiders = records.some((r) => r.status === 'present' || r.isPresent === true);
  const fallback = Boolean(options?.fallbackToRosterIfUnmarked && !hasPresentRiders);

  const list: SlotRiderInfo[] = [];

  for (const r of records) {
    if (!isAssignedAttendanceShift(r.shiftType)) continue;
    if (isRiderWorkingInSlot(r, slotHour)) {
      let isCounted = false;
      if (hasPresentRiders) {
        isCounted = r.status === 'present' || r.isPresent === true;
      } else if (fallback) {
        isCounted = r.status !== 'absent';
      }

      list.push({
        riderName: r.riderName,
        normalizedName: r.normalizedName || normalizeRiderName(r.riderName),
        phone: r.phone || null,
        shiftType: r.shiftType,
        slot1StartHour: r.slot1StartHour,
        slot1EndHour: r.slot1EndHour,
        slot2StartHour: r.slot2StartHour,
        slot2EndHour: r.slot2EndHour,
        status: r.status,
        isPresent: Boolean(r.isPresent),
        onboardedBy: r.onboardedBy || null,
        isCountedInTurnUp: isCounted,
        timingsFormatted: formatShiftTimings({
          slot1StartHour: r.slot1StartHour,
          slot1EndHour: r.slot1EndHour,
          slot2StartHour: r.slot2StartHour ?? undefined,
          slot2EndHour: r.slot2EndHour ?? undefined,
        }),
      });
    }
  }

  // Sort: counted in turn-up first, then alphabetically by rider name
  list.sort((a, b) => {
    if (a.isCountedInTurnUp !== b.isCountedInTurnUp) {
      return a.isCountedInTurnUp ? -1 : 1;
    }
    return a.riderName.localeCompare(b.riderName);
  });

  return list;
}

/**
 * Creates a StoreAttendanceSummary from a list of records.
 */
export function buildAttendanceSummary(
  warehouseId: string,
  attendanceDate: string,
  records: RiderAttendanceRecord[],
  storeId?: string
): StoreAttendanceSummary {
  let presentCount = 0;
  let absentCount = 0;
  let unmarkedCount = 0;

  for (const r of records) {
    if (r.status === 'present' || r.isPresent) {
      presentCount++;
    } else if (r.status === 'absent') {
      absentCount++;
    } else {
      unmarkedCount++;
    }
  }

  const firstWithUpdate = records.find((r) => r.updatedAt);
  const lastUpdated = firstWithUpdate?.updatedAt;
  const updatedBy = firstWithUpdate?.updatedBy;

  return {
    storeId,
    warehouseId: warehouseId.toUpperCase().trim(),
    attendanceDate,
    totalRiders: records.length,
    presentCount,
    absentCount,
    unmarkedCount,
    records,
    isFullyMarked: records.length > 0 && unmarkedCount === 0,
    lastUpdated,
    updatedBy,
  };
}

/**
 * Synchronously retrieves cached attendance records from localStorage.
 */
export function getStoredAttendanceSync(
  warehouseId: string,
  attendanceDate: string
): RiderAttendanceRecord[] | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const key = getStoreAttendanceStorageKey(warehouseId, attendanceDate);
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed as RiderAttendanceRecord[];
        }
      }
    }
  } catch {
    // Ignore storage errors in test or SSR
  }
  return null;
}

/**
 * Fetches rider attendance records for a store and date.
 * Dual-persistence: checks localStorage cache, then Supabase table `store_rider_attendance`.
 * If no attendance has been submitted yet, initializes an unmarked roster
 * with default status "unmarked" for each rider.
 */
export async function fetchStoreRiderAttendance(params: {
  storeId?: string;
  warehouseId: string;
  attendanceDate: string;
  activeRiders?: Array<{ name: string; phone?: string }>;
  shiftsMap?: Map<string, RiderShiftConfig>;
  timeZone?: string;
  referenceDate?: string;
}): Promise<StoreAttendanceSummary> {
  const { storeId, warehouseId, attendanceDate, timeZone = 'Asia/Kolkata', referenceDate } = params;
  const normWh = (warehouseId || 'TMK7').toUpperCase().trim();
  const isHistorical = isHistoricalAttendanceDate(attendanceDate, timeZone, referenceDate);

  // 1. Read localStorage cache
  const cached = getStoredAttendanceSync(normWh, attendanceDate);

  // Short-circuit in test environments or dummy store IDs
  if (storeId && storeId.startsWith('test-')) {
    if (cached && cached.length > 0) {
      if (isHistorical) {
        const preserved = enrichHistoricalAttendanceRecords(
          cached,
          params.activeRiders,
          params.shiftsMap
        );
        return buildAttendanceSummary(normWh, attendanceDate, preserved, storeId);
      }
      const synced = params.shiftsMap ? syncAttendanceWithLatestShifts(cached, params.shiftsMap) : cached;
      const activeFiltered = filterRecordsByActiveRoster(synced, params.activeRiders);
      return buildAttendanceSummary(normWh, attendanceDate, activeFiltered, storeId);
    }
    if (!params.activeRiders) {
      return buildAttendanceSummary(normWh, attendanceDate, [], storeId);
    }
  }

  // 2. Fetch shifts, active roster, and Supabase store_rider_attendance in parallel
  let shifts = params.shiftsMap;
  const shiftsPromise =
    !shifts && storeId
      ? getRiderShiftsForStore(storeId).catch(() => undefined)
      : Promise.resolve(shifts);

  const activeRidersPromise =
    params.activeRiders !== undefined
      ? Promise.resolve(params.activeRiders)
      : storeId
      ? getActiveRidersRoster(storeId, normWh)
          .then((roster) => roster.riders)
          .catch(() => undefined)
      : Promise.resolve(undefined);

  let mergedBaseRecords: RiderAttendanceRecord[] | null = null;
  let resolvedActiveRiders: Array<{ name: string; phone?: string }> | undefined = params.activeRiders;

  try {
      const remoteQueryPromise =
        storeId && storeId.startsWith('test-')
          ? Promise.resolve({ data: null, error: null })
          : withTimeout(
              supabase
                .from('store_rider_attendance')
                .select('*')
                .eq('warehouse_id', normWh)
                .eq('attendance_date', attendanceDate)
                .order('rider_name', { ascending: true }),
              12000,
              { data: null, error: null }
            );

      const [resolvedShifts, fetchedActiveRiders, res] = await Promise.all([
        shiftsPromise,
        activeRidersPromise,
        remoteQueryPromise,
      ]);
    shifts = resolvedShifts;
    resolvedActiveRiders = fetchedActiveRiders;
    const data = res?.data;
    const error = res?.error;

    if (!error && Array.isArray(data) && data.length > 0) {
      const records: RiderAttendanceRecord[] = data.map((row) => ({
        id: row.id,
        storeId: row.store_id || storeId,
        warehouseId: row.warehouse_id,
        attendanceDate: row.attendance_date,
        riderName: row.rider_name,
        normalizedName: row.normalized_name,
        phone: row.phone,
        shiftType: row.shift_type || 'Morning Shift',
        slot1StartHour: Number(row.slot1_start_hour ?? 6),
        slot1EndHour: Number(row.slot1_end_hour ?? 15),
        slot2StartHour: row.slot2_start_hour != null ? Number(row.slot2_start_hour) : null,
        slot2EndHour: row.slot2_end_hour != null ? Number(row.slot2_end_hour) : null,
        status: (row.attendance_status as AttendanceStatus) || (row.is_present ? 'present' : 'unmarked'),
        isPresent: Boolean(row.is_present),
        notes: row.notes,
        onboardedBy: row.onboarded_by || null,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
      }));

      // If local cache has a strictly newer attendance save than remote, prefer local
      const cachedFirstUpdate = cached?.find((r) => r.updatedAt)?.updatedAt;
      const remoteFirstUpdate = records.find((r) => r.updatedAt)?.updatedAt;
      const cachedTime = cachedFirstUpdate ? new Date(cachedFirstUpdate).getTime() : 0;
      const remoteTime = remoteFirstUpdate ? new Date(remoteFirstUpdate).getTime() : 0;
      mergedBaseRecords =
        cached && cached.length > 0 && cachedTime > remoteTime ? cached : records;
    }
  } catch (err) {
    console.warn(`Supabase fetchStoreRiderAttendance error for ${normWh}:`, err);
  }

  // Fallback to localStorage cache if Supabase returned no rows or was unreachable
  if (!mergedBaseRecords && cached && cached.length > 0) {
    mergedBaseRecords = cached;
  }

  // If we have saved/cached records:
  // - For historical past dates, preserve the saved snapshot verbatim (never prune former riders,
  //   never inject newly hired active riders, and never overwrite saved shift timings with later edits).
  // - For today/future dates, keep forward planning synced with the live active roster and latest shifts.
  if (mergedBaseRecords && mergedBaseRecords.length > 0) {
    if (isHistorical) {
      const historicalList = enrichHistoricalAttendanceRecords(
        mergedBaseRecords,
        resolvedActiveRiders,
        shifts
      );

      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const key = getStoreAttendanceStorageKey(normWh, attendanceDate);
          window.localStorage.setItem(key, JSON.stringify(historicalList));
        }
      } catch {
        // Storage fail
      }

      return buildAttendanceSummary(normWh, attendanceDate, historicalList, storeId);
    }

    const syncedBase = shifts
      ? syncAttendanceWithLatestShifts(mergedBaseRecords, shifts)
      : mergedBaseRecords;
    const activeFilteredBase = filterRecordsByActiveRoster(syncedBase, resolvedActiveRiders);

    const byNorm = new Map<string, RiderAttendanceRecord>();
    for (const rec of activeFilteredBase) {
      const norm = rec.normalizedName || normalizeRiderName(rec.riderName);
      if (norm && !byNorm.has(norm)) {
        byNorm.set(norm, { ...rec, normalizedName: norm });
      }
    }

    if (resolvedActiveRiders && resolvedActiveRiders.length > 0) {
      const defaultMorning = SHIFT_PRESETS['Morning Shift'];
      for (const r of resolvedActiveRiders) {
        const norm = normalizeRiderName(r.name);
        if (!norm) continue;
        const existing = byNorm.get(norm);
        if (existing) {
          if (!existing.phone && r.phone) {
            existing.phone = r.phone;
          }
        } else {
          const shift = shifts?.get(norm);
          byNorm.set(norm, {
            storeId,
            warehouseId: normWh,
            attendanceDate,
            riderName: r.name,
            normalizedName: norm,
            phone: r.phone || null,
            shiftType: shift ? shift.shiftType : 'Morning Shift',
            slot1StartHour: shift ? shift.slot1StartHour : defaultMorning.slot1Start,
            slot1EndHour: shift ? shift.slot1EndHour : defaultMorning.slot1End,
            slot2StartHour: shift?.slot2StartHour ?? null,
            slot2EndHour: shift?.slot2EndHour ?? null,
            onboardedBy: shift?.onboardedBy || null,
            status: 'unmarked',
            isPresent: false,
          });
        }
      }
    }

    const mergedList = Array.from(byNorm.values()).sort((a, b) =>
      a.riderName.localeCompare(b.riderName)
    );

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const key = getStoreAttendanceStorageKey(normWh, attendanceDate);
        window.localStorage.setItem(key, JSON.stringify(mergedList));
      }
    } catch {
      // Storage fail
    }

    return buildAttendanceSummary(normWh, attendanceDate, mergedList, storeId);
  }

  // 3. Fallback: Initialize an unmarked roster for this date
  let ridersList = resolvedActiveRiders;

  // If active riders not passed, load them
  if (!ridersList && storeId) {
    try {
      const roster = await getActiveRidersRoster(storeId, normWh);
      if (roster.riders.length > 0) {
        ridersList = roster.riders;
      }
    } catch {
      // Ignore
    }
  }

  if (!shifts && storeId) {
    try {
      shifts = await getRiderShiftsForStore(storeId);
    } catch {
      // Ignore
    }
  }

  // Build roster strictly from active riders when an active roster exists; fall back to shifts map only if no active roster is uploaded
  const ridersMap = new Map<string, { name: string; phone?: string }>();
  if (ridersList && ridersList.length > 0) {
    for (const r of ridersList) {
      const norm = normalizeRiderName(r.name);
      if (norm && !ridersMap.has(norm)) {
        ridersMap.set(norm, { name: r.name, phone: r.phone });
      }
    }
  } else if (shifts && shifts.size > 0) {
    for (const [norm, s] of shifts.entries()) {
      if (!ridersMap.has(norm)) {
        ridersMap.set(norm, { name: s.riderName });
      }
    }
  }

  const defaultMorning = SHIFT_PRESETS['Morning Shift'];
  const unmarkedRecords: RiderAttendanceRecord[] = [];

  for (const [norm, r] of ridersMap.entries()) {
    const shift = shifts?.get(norm);
    const shiftType = shift ? shift.shiftType : 'Morning Shift';
    const slot1StartHour = shift ? shift.slot1StartHour : defaultMorning.slot1Start;
    const slot1EndHour = shift ? shift.slot1EndHour : defaultMorning.slot1End;
    const slot2StartHour = shift?.slot2StartHour ?? null;
    const slot2EndHour = shift?.slot2EndHour ?? null;

    unmarkedRecords.push({
      storeId,
      warehouseId: normWh,
      attendanceDate,
      riderName: r.name,
      normalizedName: norm,
      phone: r.phone || null,
      shiftType,
      slot1StartHour,
      slot1EndHour,
      slot2StartHour,
      slot2EndHour,
      onboardedBy: shift?.onboardedBy || null,
      status: 'unmarked', // Default to unmarked as requested by user
      isPresent: false,
    });
  }

  // Sort alphabetically by rider name
  unmarkedRecords.sort((a, b) => a.riderName.localeCompare(b.riderName));

  return buildAttendanceSummary(normWh, attendanceDate, unmarkedRecords, storeId);
}

/**
 * Persists updated rider attendance records for a store and date.
 * Writes to Supabase and localStorage, and dispatches in-tab real-time event.
 */
export async function saveStoreRiderAttendance(params: {
  storeId?: string;
  warehouseId: string;
  attendanceDate: string;
  records: RiderAttendanceRecord[];
  updatedBy?: string;
}): Promise<{ ok: boolean; count: number; presentCount: number; error?: string }> {
  const { storeId, warehouseId, attendanceDate, records, updatedBy = 'Store Operator' } = params;
  const normWh = (warehouseId || 'TMK7').toUpperCase().trim();
  const nowIso = new Date().toISOString();

  if (!records || records.length === 0) {
    return { ok: false, count: 0, presentCount: 0, error: 'Cannot save empty attendance roster.' };
  }

  // Normalize & deduplicate records by normalizedName so upsert never conflicts
  const dedupedMap = new Map<string, RiderAttendanceRecord>();
  for (const r of records) {
    const norm = r.normalizedName || normalizeRiderName(r.riderName);
    if (!norm) continue;
    const isPresent = r.status === 'present';
    dedupedMap.set(norm, {
      ...r,
      storeId: r.storeId || storeId,
      warehouseId: normWh,
      attendanceDate,
      normalizedName: norm,
      status: r.status,
      isPresent,
      updatedAt: nowIso,
      updatedBy,
    });
  }
  const normalizedRecords = Array.from(dedupedMap.values());

  const presentCount = normalizedRecords.filter((r) => r.isPresent).length;

  // 1. Instant local overwrite in localStorage
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const key = getStoreAttendanceStorageKey(normWh, attendanceDate);
      window.localStorage.setItem(key, JSON.stringify(normalizedRecords));
    }
  } catch (err) {
    console.warn(`LocalStorage saveStoreRiderAttendance error:`, err);
  }

  // 2. Dispatch in-tab custom event
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      const summary = buildAttendanceSummary(normWh, attendanceDate, normalizedRecords, storeId);
      window.dispatchEvent(
        new CustomEvent(STORE_ATTENDANCE_CHANGE_EVENT, {
          detail: { warehouseId: normWh, attendanceDate, summary },
        })
      );
    } catch {
      // Ignore in non-browser env
    }
  }

  // 3. Persist to Supabase database in parallel upsert chunks (skip in mock/test store env)
  if (!storeId || !storeId.startsWith('test-')) {
    try {
      const isValidUuid = (id?: string | null): boolean =>
        Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));

      const targetStoreId = isValidUuid(storeId) ? storeId : null;

      // Single-step parallel upsert in chunks of 500 (no blocking DELETE round-trip)
      const chunkSize = 500;
      const upsertPromises: Array<Promise<{ error: { message: string } | null }>> = [];
      for (let i = 0; i < normalizedRecords.length; i += chunkSize) {
        const chunk = normalizedRecords.slice(i, i + chunkSize).map((r) => ({
          store_id: isValidUuid(r.storeId) ? r.storeId : targetStoreId,
          warehouse_id: normWh,
          attendance_date: attendanceDate,
          rider_name: r.riderName,
          normalized_name: r.normalizedName,
          phone: r.phone || null,
          shift_type: r.shiftType,
          slot1_start_hour: r.slot1StartHour,
          slot1_end_hour: r.slot1EndHour,
          slot2_start_hour: r.slot2StartHour ?? null,
          slot2_end_hour: r.slot2EndHour ?? null,
          attendance_status: r.status,
          is_present: r.isPresent,
          notes: r.notes || null,
          updated_at: nowIso,
          updated_by: updatedBy,
        }));

        upsertPromises.push(
          withTimeout(
            supabase
              .from('store_rider_attendance')
              .upsert(chunk, { onConflict: 'warehouse_id,attendance_date,normalized_name' }),
            12000,
            { error: { message: 'Request timed out while syncing attendance to database.' } }
          )
        );
      }
      const results = await Promise.all(upsertPromises);
      const firstError = results.find((res) => res?.error)?.error;
      if (firstError) {
        console.error(`Supabase saveStoreRiderAttendance error for ${normWh}:`, firstError.message);
        return {
          ok: false,
          count: normalizedRecords.length,
          presentCount,
          error: `Saved locally, but failed to sync attendance to database: ${firstError.message}. Please retry.`,
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Supabase saveStoreRiderAttendance exception for ${normWh}:`, err);
      return {
        ok: false,
        count: normalizedRecords.length,
        presentCount,
        error: `Saved locally, but failed to sync attendance to database: ${msg}. Please retry.`,
      };
    }
  }

  return { ok: true, count: normalizedRecords.length, presentCount };
}

/**
 * Subscribes to real-time attendance changes across tabs, sessions, and devices.
 * Returns an unsubscribe cleanup function.
 */
export function subscribeStoreRiderAttendance(
  warehouseId: string,
  attendanceDate: string,
  onUpdate: (summary: StoreAttendanceSummary) => void,
  storeId?: string
): () => void {
  const normWh = (warehouseId || 'TMK7').toUpperCase().trim();
  const storageKey = getStoreAttendanceStorageKey(normWh, attendanceDate);

  // 1. In-tab custom event listener
  const handleInTabEvent = (e: Event) => {
    const custom = e as CustomEvent<{
      warehouseId: string;
      attendanceDate: string;
      summary: StoreAttendanceSummary;
    }>;
    if (
      custom.detail &&
      custom.detail.warehouseId.toUpperCase().trim() === normWh &&
      custom.detail.attendanceDate === attendanceDate
    ) {
      onUpdate(custom.detail.summary);
    }
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener(STORE_ATTENDANCE_CHANGE_EVENT, handleInTabEvent);
  }

  // 2. Storage event listener (other tabs in same browser)
  const handleStorageEvent = (e: StorageEvent) => {
    if (e.key === storageKey && e.newValue) {
      try {
        const records = JSON.parse(e.newValue) as RiderAttendanceRecord[];
        if (Array.isArray(records)) {
          const summary = buildAttendanceSummary(normWh, attendanceDate, records);
          onUpdate(summary);
        }
      } catch {
        // Ignore parse error
      }
    }
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', handleStorageEvent);
  }

  // 3. Supabase Realtime Postgres Changes
  let channel: ReturnType<typeof supabase.channel> | null = null;
  try {
    const channelName = `realtime:store_rider_attendance:${normWh}_${attendanceDate}`;
    channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'store_rider_attendance',
          filter: `warehouse_id=eq.${normWh}`,
        },
        () => {
          // Re-fetch fresh attendance for this date from database
          void fetchStoreRiderAttendance({
            storeId,
            warehouseId: normWh,
            attendanceDate,
          }).then((fresh) => {
            onUpdate(fresh);
          });
        }
      )
      .subscribe();
  } catch (err) {
    console.warn('Realtime subscription error for store_rider_attendance:', err);
  }

  return () => {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener(STORE_ATTENDANCE_CHANGE_EVENT, handleInTabEvent);
      window.removeEventListener('storage', handleStorageEvent);
    }
    if (channel) {
      void supabase.removeChannel(channel);
    }
  };
}
