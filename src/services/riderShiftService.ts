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
    label: 'Morning Shift (6 AM – 2 PM)',
    slot1Start: 6,
    slot1End: 14,
    hours: 8,
  },
  '2nd Shift': {
    label: '2nd Shift (2 PM – 10 PM)',
    slot1Start: 14,
    slot1End: 22,
    hours: 8,
  },
  'Split Shift': {
    label: 'Split Shift (6–10 AM & 6–10 PM)',
    slot1Start: 6,
    slot1End: 10,
    slot2Start: 18,
    slot2End: 22,
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
  let h1 = params.slot1EndHour - params.slot1StartHour;
  if (h1 < 0) h1 += 24;

  let h2 = 0;
  if (
    params.slot2StartHour !== undefined &&
    params.slot2StartHour !== null &&
    params.slot2EndHour !== undefined &&
    params.slot2EndHour !== null
  ) {
    h2 = params.slot2EndHour - params.slot2StartHour;
    if (h2 < 0) h2 += 24;
  }

  return Math.round((h1 + h2) * 10) / 10;
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
        shiftMap.set(norm, {
          riderName: row.rider_name,
          normalizedName: norm,
          shiftType: (row.shift_type as ShiftType) || 'Morning Shift',
          slot1StartHour: Number(row.slot1_start_hour ?? 6),
          slot1EndHour: Number(row.slot1_end_hour ?? 14),
          slot2StartHour: row.slot2_start_hour != null ? Number(row.slot2_start_hour) : null,
          slot2EndHour: row.slot2_end_hour != null ? Number(row.slot2_end_hour) : null,
          totalPlannedHours: Number(row.total_planned_hours ?? 8),
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
          shiftMap.set(norm, item);
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

  // 1. Immediately cache in localStorage
  try {
    localStorage.setItem(
      `${LOCAL_STORAGE_PREFIX}${storeId}`,
      JSON.stringify(shifts)
    );
  } catch (err) {
    console.warn('Could not cache rider shifts to localStorage:', err);
  }

  // 2. Persist to Supabase
  try {
    const rows = shifts.map((s) => ({
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
    }

    return { ok: true, savedCount: shifts.length };
  } catch (err) {
    console.warn('Supabase store_rider_shifts save error:', err);
    return { ok: true, savedCount: shifts.length };
  }
}
