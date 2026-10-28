// ==============================================================================
// Rider Shift Service
// Manages recurring shift assignments, timings, split shifts, and 8-hour compliance.
// Supports dual-persistence: Supabase store_rider_shifts table + localStorage.
// ==============================================================================

import { supabase } from '../config/supabaseClient';
import { normalizeRiderName } from './activeRiderService';

export type ShiftType = 'Morning Shift' | '2nd Shift' | 'Split Shift' | 'Custom';

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
    label: 'Split Shift (6 AM – 3 PM & 3 PM – 12 AM)',
    slot1Start: 6,
    slot1End: 15,
    slot2Start: 15,
    slot2End: 24,
    hours: 18,
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

const LOCAL_STORAGE_PREFIX = 'urban_connect_rider_shifts_';

/**
 * Loads rider shifts for a store from Supabase, falling back to localStorage.
 */
export async function getRiderShiftsForStore(
  storeId: string
): Promise<Map<string, RiderShiftConfig>> {
  const shiftMap = new Map<string, RiderShiftConfig>();

  // 1. Try Supabase
  try {
    const { data, error } = await supabase
      .from('store_rider_shifts')
      .select('rider_name, normalized_name, shift_type, slot1_start_hour, slot1_end_hour, slot2_start_hour, slot2_end_hour, total_planned_hours, joining_date')
      .eq('store_id', storeId);

    if (!error && Array.isArray(data) && data.length > 0) {
      for (const row of data) {
        const norm = row.normalized_name || normalizeRiderName(row.rider_name);
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
          riderName: row.rider_name,
          normalizedName: norm,
          shiftType: effectiveShift,
          slot1StartHour: s1Start,
          slot1EndHour: s1End,
          slot2StartHour: s2Start,
          slot2EndHour: s2End,
          totalPlannedHours: totalPlanned,
          joiningDate: row.joining_date ? String(row.joining_date).slice(0, 10) : null,
        });
      }
      return shiftMap;
    }
  } catch (err) {
    console.warn('Could not load store_rider_shifts from Supabase:', err);
  }

  // 2. Fallback to localStorage
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${storeId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as RiderShiftConfig[];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const norm = item.normalizedName || normalizeRiderName(item.riderName);
          const calcHours = calculatePlannedHours(item);
          const totalPlanned = item.totalPlannedHours != null && Number(item.totalPlannedHours) > 0
            ? Math.max(Number(item.totalPlannedHours), calcHours)
            : calcHours;
          const effectiveShift = classifyShiftType(item);
          shiftMap.set(norm, {
            ...item,
            shiftType: effectiveShift,
            totalPlannedHours: totalPlanned,
          });
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

  // Normalize all shifts with classifyShiftType
  const normalizedShifts = shifts.map((s) => ({
    ...s,
    shiftType: classifyShiftType(s),
  }));

  // 1. Immediately cache in localStorage
  try {
    localStorage.setItem(
      `${LOCAL_STORAGE_PREFIX}${storeId}`,
      JSON.stringify(normalizedShifts)
    );
  } catch (err) {
    console.warn('Could not cache rider shifts to localStorage:', err);
  }

  // 2. Persist to Supabase
  try {
    const rows = normalizedShifts.map((s) => ({
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
      updated_at: nowIso,
    }));

    const { error: upsertErr } = await supabase
      .from('store_rider_shifts')
      .upsert(rows, { onConflict: 'store_id,normalized_name' });

    if (upsertErr) {
      console.warn('Supabase upsert to store_rider_shifts failed, using localStorage:', upsertErr.message);
      return { ok: false, savedCount: 0, error: upsertErr.message };
    }

    return { ok: true, savedCount: shifts.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('Supabase store_rider_shifts save error:', msg);
    return { ok: false, savedCount: 0, error: msg };
  }
}
