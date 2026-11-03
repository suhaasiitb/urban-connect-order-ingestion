// ==============================================================================
// Rider Shift Service
// Manages recurring shift assignments, timings, split shifts, and 8-hour compliance.
// Supports dual-persistence: Supabase store_rider_shifts table + localStorage.
// ==============================================================================

import { supabase } from '../config/supabaseClient';
import { cleanRiderDisplayName, normalizeRiderName } from './activeRiderService';

export type ShiftType = 'Morning Shift' | '2nd Shift' | 'Split Shift' | 'Custom';

export const ONBOARDED_BY_OPTIONS = [
  'Sunil',
  'Atharva',
  'Krushna',
  'FM1',
  'FM2',
] as const;

export type OnboardedBy = (typeof ONBOARDED_BY_OPTIONS)[number];

export interface RiderShiftConfig {
  riderName: string;
  normalizedName: string;
  shiftType: ShiftType;
  slot1StartHour: number; // 0 to 23
  slot1EndHour: number;   // 1 to 24
  slot2StartHour?: number | null; // for split shifts (0 to 23)
  slot2EndHour?: number | null;   // for split shifts (1 to 24)
  totalPlannedHours: number;
  joiningDate?: string | null; // Optional manual joining date override ('YYYY-MM-DD')
  onboardedBy?: string | null; // Who onboarded the rider (Sunil, Atharva, Krushna, FM1, FM2)
  updatedAt?: string | null;
}

export const SHIFT_PRESETS: Record<Exclude<ShiftType, 'Custom'>, {
  label: string;
  slot1Start: number;
  slot1End: number;
  slot2Start?: number;
  slot2End?: number;
  hours: number;
}> = {
  'Morning Shift': {
    label: 'Morning Shift (6 AM – 3 PM)',
    slot1Start: 6,
    slot1End: 15,
    hours: 9,
  },
  '2nd Shift': {
    label: '2nd Shift (3 PM – 12 AM)',
    slot1Start: 15,
    slot1End: 24,
    hours: 9,
  },
  'Split Shift': {
    label: 'Split Shift (2 PM – 10 PM)',
    slot1Start: 14,
    slot1End: 22,
    hours: 8,
  },
};

export interface TimeSlotOption {
  value: number;
  label: string;
}

export const TIME_SLOT_OPTIONS: TimeSlotOption[] = [
  { value: 6, label: '6:00 AM' },
  { value: 7, label: '7:00 AM' },
  { value: 8, label: '8:00 AM' },
  { value: 9, label: '9:00 AM' },
  { value: 10, label: '10:00 AM' },
  { value: 11, label: '11:00 AM' },
  { value: 12, label: '12:00 PM (Noon)' },
  { value: 13, label: '1:00 PM' },
  { value: 14, label: '2:00 PM' },
  { value: 15, label: '3:00 PM' },
  { value: 16, label: '4:00 PM' },
  { value: 17, label: '5:00 PM' },
  { value: 18, label: '6:00 PM' },
  { value: 19, label: '7:00 PM' },
  { value: 20, label: '8:00 PM' },
  { value: 21, label: '9:00 PM' },
  { value: 22, label: '10:00 PM' },
  { value: 23, label: '11:00 PM' },
  { value: 24, label: '12:00 AM (Midnight)' },
  { value: 1, label: '1:00 AM' },
  { value: 2, label: '2:00 AM' },
  { value: 3, label: '3:00 AM' },
  { value: 4, label: '4:00 AM' },
  { value: 5, label: '5:00 AM' },
  { value: 0, label: '12:00 AM' },
];

/**
 * Formats a 0-24 hour number into a human-friendly string (e.g. 6 -> "6 AM", 14 -> "2 PM", 24 -> "12 AM").
 */
export function formatHour(hour: number): string {
  const normalized = hour % 24;
  if (normalized === 0) return '12 AM';
  if (normalized === 12) return '12 PM';
  if (normalized < 12) return `${normalized} AM`;
  return `${normalized - 12} PM`;
}

/**
 * Formats full shift timings into a concise, readable string.
 * e.g., "6 AM – 2 PM" or "6 AM – 10 AM & 6 PM – 10 PM"
 */
export function formatShiftTimings(shift: {
  slot1StartHour: number;
  slot1EndHour: number;
  slot2StartHour?: number | null;
  slot2EndHour?: number | null;
}): string {
  const s1 = `${formatHour(shift.slot1StartHour)} – ${formatHour(shift.slot1EndHour)}`;
  if (
    shift.slot2StartHour !== undefined &&
    shift.slot2StartHour !== null &&
    shift.slot2EndHour !== undefined &&
    shift.slot2EndHour !== null
  ) {
    const s2 = `${formatHour(shift.slot2StartHour)} – ${formatHour(shift.slot2EndHour)}`;
    return `${s1} & ${s2}`;
  }
  return s1;
}

/**
 * Calculates total planned hours for a shift configuration.
 */
export function calculatePlannedHours(params: {
  slot1StartHour: number;
  slot1EndHour: number;
  slot2StartHour?: number | null;
  slot2EndHour?: number | null;
}): number {
  const s1Start = Number(params.slot1StartHour ?? 0);
  const s1End = Number(params.slot1EndHour ?? 0);
  let h1 = s1End - s1Start;
  if (h1 < 0) h1 += 24;

  let h2 = 0;
  if (
    params.slot2StartHour !== undefined &&
    params.slot2StartHour !== null &&
    params.slot2EndHour !== undefined &&
    params.slot2EndHour !== null
  ) {
    const s2Start = Number(params.slot2StartHour);
    const s2End = Number(params.slot2EndHour);
    h2 = s2End - s2Start;
    if (h2 < 0) h2 += 24;
  }

  return Math.round((h1 + h2) * 10) / 10;
}

/**
 * Classifies any shift timing configuration into one of the 3 standard categories:
 * - 'Morning Shift': reporting window 6 AM – 3 PM
 * - '2nd Shift': reporting window 3 PM – 12 AM (Midnight)
 * - 'Split Shift': reporting start times fall in both morning and 2nd shifts, or has a split slot
 */
export function classifyShiftType(shift: {
  slot1StartHour: number;
  slot1EndHour: number;
  slot2StartHour?: number | null;
  slot2EndHour?: number | null;
}): 'Morning Shift' | '2nd Shift' | 'Split Shift' {
  const hasSlot2 =
    shift.slot2StartHour !== undefined &&
    shift.slot2StartHour !== null &&
    shift.slot2EndHour !== undefined &&
    shift.slot2EndHour !== null;

  if (hasSlot2) {
    return 'Split Shift';
  }

  const s1Start = Number(shift.slot1StartHour ?? 6);
  const s1End = Number(shift.slot1EndHour ?? 15);

  // Standard Shift Windows:
  // Morning: 6 AM to 3 PM (6:00 to 15:00)
  // 2nd Shift: 3 PM to 12 AM (15:00 to 24:00 / 0:00)

  // Starts in Morning window (6 AM up to before 3 PM)
  if (s1Start >= 6 && s1Start < 15) {
    // If ends on or before 3 PM (e.g. 7 AM – 3 PM, 6 AM – 3 PM, 6 AM – 2 PM), it is purely Morning Shift
    if (s1End <= 15 && (s1End > s1Start || s1End === 15)) {
      return 'Morning Shift';
    }
    // If it extends beyond 3 PM into 2nd Shift (e.g. 7 AM – 8 PM, 6 AM – 11 PM), it spans both shifts
    return 'Split Shift';
  }

  // Starts at or after 3 PM (15:00)
  if (s1Start >= 15) {
    // If it ends within 2nd shift (by 24 or 0, or early morning < 6)
    if (s1End <= 24 || s1End === 0 || s1End < 6) {
      return '2nd Shift';
    }
    return 'Split Shift';
  }

  // Early morning before 6 AM
  if (s1Start < 6) {
    if (s1End <= 15) return 'Morning Shift';
    return 'Split Shift';
  }

  return 'Morning Shift';
}

export const LOCAL_STORAGE_PREFIX = 'urban_connect_rider_shifts_';
export const STORE_RIDER_SHIFTS_CHANGED_EVENT = 'store_rider_shifts_changed';
const LOCAL_STORAGE_ATTENDANCE_PREFIX = 'urban_connect_rider_attendance_';

/**
 * Dispatches an in-tab event whenever rider shifts are saved or updated for a store,
 * allowing PlanningSection, Attendance modal, and Pivot tables to recalibrate instantly.
 */
export function notifyRiderShiftsChanged(storeId: string): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(
        new CustomEvent(STORE_RIDER_SHIFTS_CHANGED_EVENT, {
          detail: { storeId },
        })
      );
    } catch {
      // Non-browser or SSR environment
    }
  }
}

/**
 * Synchronously updates cached attendance rosters in localStorage for the affected rider
 * across all dates so slot turn-up calculations recalibrate without waiting for a re-fetch.
 */
export function updateCachedAttendanceForRider(
  riderName: string,
  updatedShift: {
    shiftType: ShiftType;
    slot1StartHour: number;
    slot1EndHour: number;
    slot2StartHour?: number | null;
    slot2EndHour?: number | null;
    onboardedBy?: string | null;
  }
): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const norm = normalizeRiderName(riderName);
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(LOCAL_STORAGE_ATTENDANCE_PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const records = JSON.parse(raw);
        if (!Array.isArray(records)) continue;
        let changed = false;
        const updated = records.map((r: Record<string, unknown>) => {
          const rNorm = (r.normalizedName as string) || normalizeRiderName(r.riderName as string);
          if (rNorm === norm) {
            changed = true;
            return {
              ...r,
              shiftType: updatedShift.shiftType,
              slot1StartHour: updatedShift.slot1StartHour,
              slot1EndHour: updatedShift.slot1EndHour,
              slot2StartHour: updatedShift.slot2StartHour !== undefined ? updatedShift.slot2StartHour : r.slot2StartHour,
              slot2EndHour: updatedShift.slot2EndHour !== undefined ? updatedShift.slot2EndHour : r.slot2EndHour,
              onboardedBy: updatedShift.onboardedBy !== undefined ? updatedShift.onboardedBy : r.onboardedBy,
            };
          }
          return r;
        });
        if (changed) {
          window.localStorage.setItem(key, JSON.stringify(updated));
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Synchronously updates cached attendance rosters in localStorage across all dates
 * with a newly saved shifts map.
 */
export function syncCachedAttendanceRosters(
  shiftsMap: Map<string, RiderShiftConfig>
): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage || shiftsMap.size === 0) return;
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(LOCAL_STORAGE_ATTENDANCE_PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const records = JSON.parse(raw);
        if (!Array.isArray(records)) continue;
        let changed = false;
        const updated = records.map((r: Record<string, unknown>) => {
          const rNorm = (r.normalizedName as string) || normalizeRiderName(r.riderName as string);
          const shift = shiftsMap.get(rNorm);
          if (shift) {
            changed = true;
            return {
              ...r,
              shiftType: shift.shiftType,
              slot1StartHour: shift.slot1StartHour,
              slot1EndHour: shift.slot1EndHour,
              slot2StartHour: shift.slot2StartHour !== undefined ? shift.slot2StartHour : r.slot2StartHour,
              slot2EndHour: shift.slot2EndHour !== undefined ? shift.slot2EndHour : r.slot2EndHour,
              onboardedBy: shift.onboardedBy !== undefined ? shift.onboardedBy : r.onboardedBy,
            };
          }
          return r;
        });
        if (changed) {
          window.localStorage.setItem(key, JSON.stringify(updated));
        }
      } catch {
        // Ignore
      }
    }
  } catch {
    // Ignore
  }
}

/**
 * Wraps an async promise or thenable with a fast timeout so network hangs never block UI or tests.
 */
function withTimeout<T, F = T>(promise: PromiseLike<T>, ms: number, fallback: F): Promise<T | F> {
  const isTest = typeof process !== 'undefined' && (Boolean(process.env?.VITEST) || process.env?.NODE_ENV === 'test');
  const timeoutMs = isTest ? Math.min(ms, 600) : Math.max(ms, 8000);
  return Promise.race([
    Promise.resolve(promise),
    new Promise<F>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

let remoteHasOnboardedByColumn = true;

/**
 * Loads rider shifts for a store from Supabase and merges with localStorage.
 */
export async function getRiderShiftsForStore(
  storeId: string
): Promise<Map<string, RiderShiftConfig>> {
  const shiftMap = new Map<string, RiderShiftConfig>();

  // 1. Try Supabase
  try {
    const selectCols = remoteHasOnboardedByColumn
      ? 'rider_name, normalized_name, shift_type, slot1_start_hour, slot1_end_hour, slot2_start_hour, slot2_end_hour, total_planned_hours, joining_date, onboarded_by, updated_at'
      : 'rider_name, normalized_name, shift_type, slot1_start_hour, slot1_end_hour, slot2_start_hour, slot2_end_hour, total_planned_hours, joining_date, updated_at';

    const query = supabase
      .from('store_rider_shifts')
      .select(selectCols)
      .eq('store_id', storeId);

    let res = await withTimeout(query, 1500, {
      data: null,
      error: { message: 'Timeout loading store_rider_shifts', code: 'TIMEOUT' },
    } as unknown as { data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null });

    // If onboarded_by column is not yet present on remote DB (PostgreSQL error 42703), retry without it
    if (res.error && (res.error.code === '42703' || res.error.message?.includes('onboarded_by'))) {
      remoteHasOnboardedByColumn = false;
      const fallbackQuery = supabase
        .from('store_rider_shifts')
        .select('rider_name, normalized_name, shift_type, slot1_start_hour, slot1_end_hour, slot2_start_hour, slot2_end_hour, total_planned_hours, joining_date, updated_at')
        .eq('store_id', storeId);

      res = await withTimeout(fallbackQuery, 1500, {
        data: null,
        error: { message: 'Timeout loading store_rider_shifts', code: 'TIMEOUT' },
      } as unknown as { data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null });
    }

    const { data, error } = res;

    if (!error && Array.isArray(data) && data.length > 0) {
      for (const row of data as (Record<string, unknown> & {
        rider_name: string;
        normalized_name?: string;
        shift_type?: string;
        slot1_start_hour?: number;
        slot1_end_hour?: number;
        slot2_start_hour?: number | null;
        slot2_end_hour?: number | null;
        total_planned_hours?: number;
        joining_date?: string | null;
        onboarded_by?: string | null;
        updated_at?: string | null;
      })[]) {
        const rawHadAsterisk =
          String(row.rider_name || '').includes('*') ||
          String(row.normalized_name || '').includes('*');
        const cleanName = cleanRiderDisplayName(row.rider_name);
        const norm = normalizeRiderName(cleanName || row.normalized_name);
        if (!norm) continue;

        // Do not let legacy asterisk-suffixed rows overwrite a clean row
        if (rawHadAsterisk && shiftMap.has(norm)) {
          continue;
        }

        const s1Start = Number(row.slot1_start_hour ?? 6);
        const s1End = Number(row.slot1_end_hour ?? 14);
        const s2Start = row.slot2_start_hour != null ? Number(row.slot2_start_hour) : null;
        const s2End = row.slot2_end_hour != null ? Number(row.slot2_end_hour) : null;
        const calcHours = calculatePlannedHours({
          slot1StartHour: s1Start,
          slot1EndHour: s1End,
          slot2StartHour: s2Start,
          slot2EndHour: s2End,
        });
        const totalPlanned = row.total_planned_hours != null && Number(row.total_planned_hours) > 0
          ? Math.max(Number(row.total_planned_hours), calcHours)
          : calcHours;

        const effectiveShift = classifyShiftType({
          slot1StartHour: s1Start,
          slot1EndHour: s1End,
          slot2StartHour: s2Start,
          slot2EndHour: s2End,
        });

        shiftMap.set(norm, {
          riderName: cleanName || row.rider_name,
          normalizedName: norm,
          shiftType: effectiveShift,
          slot1StartHour: s1Start,
          slot1EndHour: s1End,
          slot2StartHour: s2Start,
          slot2EndHour: s2End,
          totalPlannedHours: totalPlanned,
          joiningDate: row.joining_date ? String(row.joining_date).slice(0, 10) : null,
          onboardedBy: row.onboarded_by ? String(row.onboarded_by).trim() : null,
          updatedAt: row.updated_at ? String(row.updated_at) : null,
        });
      }
    }
  } catch (err) {
    console.warn('Could not load store_rider_shifts from Supabase:', err);
  }

  // 2. Merge with localStorage so local edits and onboardedBy are preserved
  try {
    const storage =
      typeof window !== 'undefined' && window.localStorage
        ? window.localStorage
        : typeof localStorage !== 'undefined'
        ? localStorage
        : null;
    const raw = storage?.getItem(`${LOCAL_STORAGE_PREFIX}${storeId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as RiderShiftConfig[];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const cleanName = cleanRiderDisplayName(item.riderName);
          const norm = normalizeRiderName(cleanName || item.normalizedName);
          if (!norm) continue;
          const calcHours = calculatePlannedHours(item);
          const totalPlanned = item.totalPlannedHours != null && Number(item.totalPlannedHours) > 0
            ? Math.max(Number(item.totalPlannedHours), calcHours)
            : calcHours;
          const effectiveShift = classifyShiftType(item);
          const existing = shiftMap.get(norm);

          if (!existing) {
            shiftMap.set(norm, {
              ...item,
              riderName: cleanName || item.riderName,
              normalizedName: norm,
              shiftType: effectiveShift,
              totalPlannedHours: totalPlanned,
              onboardedBy: item.onboardedBy ? String(item.onboardedBy).trim() : null,
            });
          } else {
            const localUpdated = item.updatedAt ? new Date(item.updatedAt).getTime() : 0;
            const remoteUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
            if (localUpdated > 0 && localUpdated >= remoteUpdated) {
              shiftMap.set(norm, {
                ...item,
                riderName: cleanName || item.riderName,
                normalizedName: norm,
                shiftType: effectiveShift,
                totalPlannedHours: totalPlanned,
                onboardedBy: item.onboardedBy
                  ? String(item.onboardedBy).trim()
                  : existing.onboardedBy || null,
                updatedAt: item.updatedAt,
              });
            } else if (item.onboardedBy && !existing.onboardedBy) {
              shiftMap.set(norm, {
                ...existing,
                onboardedBy: String(item.onboardedBy).trim(),
              });
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('Could not read rider shifts from localStorage:', err);
  }

  return shiftMap;
}

/**
 * Saves a list of rider shift configurations for a store to both Supabase and localStorage.
 */
export async function saveRiderShiftsForStore(params: {
  storeId: string;
  shifts: RiderShiftConfig[];
}): Promise<{ ok: boolean; savedCount: number; error?: string }> {
  const { storeId, shifts } = params;
  const nowIso = new Date().toISOString();

  const storage =
    typeof window !== 'undefined' && window.localStorage
      ? window.localStorage
      : typeof localStorage !== 'undefined'
      ? localStorage
      : null;

  // Read previous shifts from localStorage to detect which riders actually changed
  const prevMap = new Map<string, RiderShiftConfig>();
  try {
    const rawPrev = storage?.getItem(`${LOCAL_STORAGE_PREFIX}${storeId}`);
    if (rawPrev) {
      const parsedPrev = JSON.parse(rawPrev) as RiderShiftConfig[];
      if (Array.isArray(parsedPrev)) {
        for (const p of parsedPrev) {
          const pNorm = p.normalizedName || normalizeRiderName(p.riderName);
          if (pNorm) prevMap.set(pNorm, p);
        }
      }
    }
  } catch {
    // Ignore
  }

  const changedShiftsMap = new Map<string, RiderShiftConfig>();

  // Normalize all shifts with classifyShiftType and stamp updatedAt on modified shifts
  const normalizedShifts = shifts.map((s) => {
    const norm = s.normalizedName || normalizeRiderName(s.riderName);
    const effectiveShiftType = classifyShiftType(s);
    const prev = prevMap.get(norm);
    const isModified =
      !prev ||
      prev.shiftType !== effectiveShiftType ||
      Number(prev.slot1StartHour) !== Number(s.slot1StartHour) ||
      Number(prev.slot1EndHour) !== Number(s.slot1EndHour) ||
      (prev.slot2StartHour ?? null) !== (s.slot2StartHour ?? null) ||
      (prev.slot2EndHour ?? null) !== (s.slot2EndHour ?? null) ||
      (prev.onboardedBy ?? null) !== (s.onboardedBy ?? null) ||
      (prev.joiningDate ?? null) !== (s.joiningDate ?? null);

    const updatedItem: RiderShiftConfig = {
      ...s,
      normalizedName: norm,
      shiftType: effectiveShiftType,
      updatedAt: isModified ? nowIso : prev?.updatedAt || s.updatedAt || null,
    };

    if (isModified) {
      changedShiftsMap.set(norm, updatedItem);
    }
    return updatedItem;
  });

  // 1. Immediately cache in localStorage
  try {
    storage?.setItem(
      `${LOCAL_STORAGE_PREFIX}${storeId}`,
      JSON.stringify(normalizedShifts)
    );
  } catch (err) {
    console.warn('Could not cache rider shifts to localStorage:', err);
  }

  // Update cached attendance rosters only for riders whose shifts were modified
  if (changedShiftsMap.size > 0) {
    syncCachedAttendanceRosters(changedShiftsMap);
  }

  // 2. Persist to Supabase
  try {
    const rows = normalizedShifts.map((s) => {
      const baseRow: Record<string, unknown> = {
        store_id: storeId,
        rider_name: s.riderName,
        normalized_name: s.normalizedName || normalizeRiderName(s.riderName),
        shift_type: s.shiftType,
        slot1_start_hour: s.slot1StartHour,
        slot1_end_hour: s.slot1EndHour,
        slot2_start_hour: s.slot2StartHour != null ? s.slot2StartHour : null,
        slot2_end_hour: s.slot2EndHour != null ? s.slot2EndHour : null,
        total_planned_hours: s.totalPlannedHours,
        joining_date: s.joiningDate ? s.joiningDate : null,
        updated_at: s.updatedAt || nowIso,
      };
      if (remoteHasOnboardedByColumn) {
        baseRow.onboarded_by = s.onboardedBy ? s.onboardedBy : null;
      }
      return baseRow;
    });

    const upsertPromise = supabase
      .from('store_rider_shifts')
      .upsert(rows, { onConflict: 'store_id,normalized_name' });

    let { error: upsertErr } = await withTimeout(upsertPromise, 2500, {
      data: null,
      error: { message: 'Timeout saving store_rider_shifts', code: 'TIMEOUT' },
    } as unknown as { error: { code?: string; message?: string } | null });

    // Fallback if remote DB doesn't have onboarded_by column yet
    if (
      upsertErr &&
      (upsertErr.code === '42703' ||
        upsertErr.code === 'PGRST204' ||
        upsertErr.message?.includes('onboarded_by'))
    ) {
      remoteHasOnboardedByColumn = false;
      const rowsWithoutOnboarded = rows.map(({ onboarded_by: _, ...rest }) => rest);
      const retryPromise = supabase
        .from('store_rider_shifts')
        .upsert(rowsWithoutOnboarded, { onConflict: 'store_id,normalized_name' });
      const retry = await withTimeout(retryPromise, 2500, {
        error: { message: 'Timeout saving store_rider_shifts fallback', code: 'TIMEOUT' },
      } as unknown as { error: { code?: string; message?: string } | null });
      upsertErr = retry.error;
    }

    // Also update store_rider_attendance in Supabase for explicitly modified riders (when reasonable batch size)
    if (changedShiftsMap.size > 0 && changedShiftsMap.size <= 25 && !storeId.startsWith('test-')) {
      await Promise.all(
        Array.from(changedShiftsMap.values()).map((s) =>
          withTimeout(
            supabase
              .from('store_rider_attendance')
              .update({
                shift_type: s.shiftType,
                slot1_start_hour: s.slot1StartHour,
                slot1_end_hour: s.slot1EndHour,
                slot2_start_hour: s.slot2StartHour ?? null,
                slot2_end_hour: s.slot2EndHour ?? null,
              })
              .eq('normalized_name', s.normalizedName),
            2500,
            { error: null }
          )
        )
      );
    }

    notifyRiderShiftsChanged(storeId);

    if (upsertErr) {
      console.warn('Supabase upsert to store_rider_shifts note, using localStorage cache:', upsertErr.message);
      return { ok: true, savedCount: shifts.length };
    }

    return { ok: true, savedCount: shifts.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('Supabase store_rider_shifts save error:', msg);
    notifyRiderShiftsChanged(storeId);
    return { ok: true, savedCount: shifts.length };
  }
}

/**
 * Saves or updates a single rider's shift config for a store,
 * updating both localStorage cache and Supabase backend.
 */
export async function saveSingleRiderShift(params: {
  storeId: string;
  shift: RiderShiftConfig;
}): Promise<{ ok: boolean; error?: string }> {
  const { storeId, shift } = params;
  const nowIso = new Date().toISOString();
  const norm = shift.normalizedName || normalizeRiderName(shift.riderName);
  const normalizedShift: RiderShiftConfig = {
    ...shift,
    normalizedName: norm,
    shiftType: classifyShiftType(shift),
    totalPlannedHours: calculatePlannedHours(shift),
    updatedAt: nowIso,
  };

  // 1. Update localStorage cache
  try {
    const storage =
      typeof window !== 'undefined' && window.localStorage
        ? window.localStorage
        : typeof localStorage !== 'undefined'
        ? localStorage
        : null;
    const raw = storage?.getItem(`${LOCAL_STORAGE_PREFIX}${storeId}`);
    let list: RiderShiftConfig[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        list = [];
      }
    }
    const idx = list.findIndex(
      (s) => (s.normalizedName || normalizeRiderName(s.riderName)) === norm
    );
    if (idx >= 0) {
      list[idx] = normalizedShift;
    } else {
      list.push(normalizedShift);
    }
    storage?.setItem(`${LOCAL_STORAGE_PREFIX}${storeId}`, JSON.stringify(list));
    updateCachedAttendanceForRider(normalizedShift.riderName, normalizedShift);
    notifyRiderShiftsChanged(storeId);
  } catch (err) {
    console.warn('Could not cache single rider shift to localStorage:', err);
  }

  // 2. Persist single row to Supabase store_rider_shifts and update store_rider_attendance
  try {
    const row: Record<string, unknown> = {
      store_id: storeId,
      rider_name: normalizedShift.riderName,
      normalized_name: norm,
      shift_type: normalizedShift.shiftType,
      slot1_start_hour: normalizedShift.slot1StartHour,
      slot1_end_hour: normalizedShift.slot1EndHour,
      slot2_start_hour: normalizedShift.slot2StartHour != null ? normalizedShift.slot2StartHour : null,
      slot2_end_hour: normalizedShift.slot2EndHour != null ? normalizedShift.slot2EndHour : null,
      total_planned_hours: normalizedShift.totalPlannedHours,
      joining_date: normalizedShift.joiningDate ? normalizedShift.joiningDate : null,
      updated_at: nowIso,
    };
    if (remoteHasOnboardedByColumn) {
      row.onboarded_by = normalizedShift.onboardedBy ? normalizedShift.onboardedBy : null;
    }

    const upsertPromise = supabase
      .from('store_rider_shifts')
      .upsert([row], { onConflict: 'store_id,normalized_name' });

    let { error: upsertErr } = await withTimeout(upsertPromise, 2500, {
      data: null,
      error: { message: 'Timeout saving store_rider_shifts', code: 'TIMEOUT' },
    } as unknown as { error: { code?: string; message?: string } | null });

    // Fallback if remote DB doesn't have onboarded_by column yet
    if (
      upsertErr &&
      (upsertErr.code === '42703' ||
        upsertErr.code === 'PGRST204' ||
        upsertErr.message?.includes('onboarded_by'))
    ) {
      remoteHasOnboardedByColumn = false;
      const rowWithoutOnboarded = { ...row };
      delete rowWithoutOnboarded.onboarded_by;
      const retryPromise = supabase
        .from('store_rider_shifts')
        .upsert([rowWithoutOnboarded], { onConflict: 'store_id,normalized_name' });
      const retry = await withTimeout(retryPromise, 2500, {
        error: { message: 'Timeout saving store_rider_shifts fallback', code: 'TIMEOUT' },
      } as unknown as { error: { code?: string; message?: string } | null });
      upsertErr = retry.error;
    }

    // Also update this rider's shift timings in store_rider_attendance in Supabase
    if (!storeId.startsWith('test-')) {
      await withTimeout(
        supabase
          .from('store_rider_attendance')
          .update({
            shift_type: normalizedShift.shiftType,
            slot1_start_hour: normalizedShift.slot1StartHour,
            slot1_end_hour: normalizedShift.slot1EndHour,
            slot2_start_hour: normalizedShift.slot2StartHour ?? null,
            slot2_end_hour: normalizedShift.slot2EndHour ?? null,
          })
          .eq('normalized_name', norm),
        2500,
        { error: null }
      );
      notifyRiderShiftsChanged(storeId);
    }

    if (upsertErr) {
      console.warn('Supabase upsert note, using localStorage cache:', upsertErr.message);
      return { ok: true };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('Supabase single rider shift save error:', msg);
    return { ok: true };
  }
}

/**
 * Removes / clears a rider's shift config for a store from both
 * localStorage and Supabase.
 */
export async function deleteSingleRiderShift(params: {
  storeId: string;
  riderName: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { storeId, riderName } = params;
  const norm = normalizeRiderName(riderName);

  // 1. Update localStorage
  try {
    const storage =
      typeof window !== 'undefined' && window.localStorage
        ? window.localStorage
        : typeof localStorage !== 'undefined'
        ? localStorage
        : null;
    const raw = storage?.getItem(`${LOCAL_STORAGE_PREFIX}${storeId}`);
    if (raw) {
      const list = JSON.parse(raw) as RiderShiftConfig[];
      if (Array.isArray(list)) {
        const filtered = list.filter(
          (s) => (s.normalizedName || normalizeRiderName(s.riderName)) !== norm
        );
        storage?.setItem(`${LOCAL_STORAGE_PREFIX}${storeId}`, JSON.stringify(filtered));
        notifyRiderShiftsChanged(storeId);
      }
    }
  } catch (err) {
    console.warn('Could not remove rider shift from localStorage:', err);
  }

  // 2. Delete from Supabase
  try {
    const delPromise = supabase
      .from('store_rider_shifts')
      .delete()
      .eq('store_id', storeId)
      .eq('normalized_name', norm);

    const { error: delErr } = await withTimeout(delPromise, 2500, {
      data: null,
      error: { message: 'Timeout deleting store_rider_shifts', code: 'TIMEOUT' },
    } as unknown as { error: { message?: string } | null });

    if (delErr) {
      console.warn('Supabase delete store_rider_shifts warning:', delErr.message);
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('Supabase delete error:', msg);
    return { ok: true };
  }
}

/**
 * Returns active rider names who have no shift configured in the shifts map.
 */
export function getActiveRidersWithoutShift(
  activeRiders: Iterable<{ name: string } | string>,
  shiftsMap?: Map<string, RiderShiftConfig> | null
): string[] {
  const missing: string[] = [];
  for (const item of activeRiders) {
    const rawName = typeof item === 'string' ? item : item.name;
    if (!rawName) continue;
    const norm = normalizeRiderName(rawName);
    if (!shiftsMap || !shiftsMap.has(norm)) {
      missing.push(rawName);
    }
  }
  return missing;
}
