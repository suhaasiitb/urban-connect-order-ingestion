// ==============================================================================
// Active Riders Service
// Handles parsing, validation, persistence, and lookup of active rider rosters.
// Supports dual-persistence: Supabase tables with instant localStorage fallback.
// ==============================================================================

import * as XLSX from 'xlsx';
import { supabase } from '../config/supabaseClient';

export interface ActiveRiderRecord {
  name: string;
  normalizedName: string;
  phone?: string;
  onlineStatus?: string;
  eligibility?: string;
  attendance?: string;
  storeCode?: string;
}

export interface ActiveRosterParseResult {
  is_valid: boolean;
  filename: string;
  total_rows: number;
  valid_riders: ActiveRiderRecord[];
  errors: string[];
  warnings: string[];
  matchedStoreCount: number;
  otherStoreCount: number;
}

export interface ActiveRosterSummary {
  storeId: string;
  storeCode: string;
  totalRiders: number;
  lastUpdated: string | null; // ISO string
  lastUpdatedFormatted: string | null; // e.g. "21 Oct 2026, 01:45 AM"
  filename: string | null;
  activeNamesSet: Set<string>; // set of normalized names
  phoneByNameMap: Map<string, string>; // normalized name -> phone number
  riders: ActiveRiderRecord[];
}

/**
 * Normalizes a rider's name for canonical matching:
 * - Trims leading & trailing whitespace
 * - Converts to lower case
 * - Collapses multiple spaces into a single space
 */
export function normalizeRiderName(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return '';
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Formats an ISO date string into a user-friendly timestamp in Asia/Kolkata timezone.
 */
export function formatRosterTimestamp(isoStr: string | null | undefined): string | null {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return null;
  }
}

/**
 * Parses and validates an Active Riders file (.csv or .xlsx).
 * Expected headers include: "Name", "Phone", "Online Status", "Eligibility", "Attendance", "Store"
 */
export function parseActiveRidersFile(params: {
  fileBytes: ArrayBuffer;
  filename: string;
  targetStoreCode: string;
}): ActiveRosterParseResult {
  const { fileBytes, filename, targetStoreCode } = params;
  const warnings: string[] = [];

  try {
    const workbook = XLSX.read(fileBytes, {
      type: 'array',
      raw: false,
      cellDates: false,
    });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return {
        is_valid: false,
        filename,
        total_rows: 0,
        valid_riders: [],
        errors: ['File is empty or contains no readable worksheets.'],
        warnings: [],
        matchedStoreCount: 0,
        otherStoreCount: 0,
      };
    }

    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
      raw: false,
    });

    if (!rawRows || rawRows.length === 0) {
      return {
        is_valid: false,
        filename,
        total_rows: 0,
        valid_riders: [],
        errors: ['Worksheet contains no data rows.'],
        warnings: [],
        matchedStoreCount: 0,
        otherStoreCount: 0,
      };
    }

    // Inspect first row headers
    const sampleRow = rawRows[0];
    const headerKeys = Object.keys(sampleRow);

    // Find the Name column (case-insensitive)
    const nameKey = headerKeys.find((k) => {
      const clean = k.trim().toLowerCase();
      return clean === 'name' || clean === 'rider name' || clean === 'rider_name' || clean === 'rider';
    });

    if (!nameKey) {
      return {
        is_valid: false,
        filename,
        total_rows: rawRows.length,
        valid_riders: [],
        errors: [
          `Missing mandatory "Name" column in header. Found columns: ${headerKeys.join(', ')}`,
        ],
        warnings: [],
        matchedStoreCount: 0,
        otherStoreCount: 0,
      };
    }

    // Find other optional columns
    const phoneKey = headerKeys.find((k) => {
      const clean = k.trim().toLowerCase();
      return (
        clean === 'phone' ||
        clean === 'mobile' ||
        clean === 'rider number' ||
        clean === 'rider_number' ||
        clean === 'rider phone' ||
        clean === 'contact'
      );
    });
    const statusKey = headerKeys.find((k) => k.trim().toLowerCase().includes('online') || k.trim().toLowerCase() === 'status');
    const eligKey = headerKeys.find((k) => k.trim().toLowerCase().includes('eligib'));
    const attKey = headerKeys.find((k) => k.trim().toLowerCase().includes('attend'));
    const storeKey = headerKeys.find((k) => k.trim().toLowerCase() === 'store' || k.trim().toLowerCase() === 'store code' || k.trim().toLowerCase() === 'store_code');

    const validRiders: ActiveRiderRecord[] = [];
    const seenNames = new Set<string>();
    let matchedStoreCount = 0;
    let otherStoreCount = 0;

    const normalizedTargetStore = targetStoreCode.trim().toUpperCase();

    for (const row of rawRows) {
      const rawName = String(row[nameKey] ?? '').trim();
      if (!rawName || rawName === '-' || rawName.toLowerCase() === 'null') {
        continue;
      }

      const normalizedName = normalizeRiderName(rawName);
      if (!normalizedName) continue;

      const rowStore = storeKey ? String(row[storeKey] ?? '').trim().toUpperCase() : '';
      if (rowStore) {
        if (rowStore === normalizedTargetStore) {
          matchedStoreCount++;
        } else {
          otherStoreCount++;
        }
      } else {
        matchedStoreCount++;
      }

      // De-duplicate within the same uploaded file
      if (seenNames.has(normalizedName)) {
        continue;
      }
      seenNames.add(normalizedName);

      validRiders.push({
        name: rawName,
        normalizedName,
        phone: phoneKey ? String(row[phoneKey] ?? '').trim() : undefined,
        onlineStatus: statusKey ? String(row[statusKey] ?? '').trim() : undefined,
        eligibility: eligKey ? String(row[eligKey] ?? '').trim() : undefined,
        attendance: attKey ? String(row[attKey] ?? '').trim() : undefined,
        storeCode: rowStore || targetStoreCode,
      });
    }

    if (validRiders.length === 0) {
      return {
        is_valid: false,
        filename,
        total_rows: rawRows.length,
        valid_riders: [],
        errors: ['No valid rider names found in the uploaded file.'],
        warnings: [],
        matchedStoreCount,
        otherStoreCount,
      };
    }

    if (otherStoreCount > 0 && matchedStoreCount === 0) {
      warnings.push(
        `File mentions store "${rawRows[0][storeKey || '']}" but current selected store is "${targetStoreCode}". All ${validRiders.length} riders will be registered for ${targetStoreCode}.`
      );
    }

    return {
      is_valid: true,
      filename,
      total_rows: rawRows.length,
      valid_riders: validRiders,
      errors: [],
      warnings,
      matchedStoreCount,
      otherStoreCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      is_valid: false,
      filename,
      total_rows: 0,
      valid_riders: [],
      errors: [`Failed to parse active riders file: ${msg}`],
      warnings: [],
      matchedStoreCount: 0,
      otherStoreCount: 0,
    };
  }
}

const LOCAL_STORAGE_PREFIX = 'urban_connect_active_riders_';

/**
 * Saves active riders roster for a store to both Supabase and localStorage fallback.
 */
export async function saveActiveRidersRoster(params: {
  storeId: string;
  storeCode: string;
  filename: string;
  riders: ActiveRiderRecord[];
  uploadedBy?: string;
}): Promise<{
  ok: boolean;
  totalSaved: number;
  lastUpdated: string;
  error?: string;
}> {
  const { storeId, storeCode, filename, riders, uploadedBy } = params;
  const nowIso = new Date().toISOString();

  // 1. Save to localStorage immediately as reliable client cache
  try {
    const cachePayload = {
      storeId,
      storeCode,
      filename,
      totalRiders: riders.length,
      lastUpdated: nowIso,
      riders,
    };
    localStorage.setItem(
      `${LOCAL_STORAGE_PREFIX}${storeId}`,
      JSON.stringify(cachePayload)
    );
  } catch (err) {
    console.warn('Could not save active riders to localStorage:', err);
  }

  // 2. Attempt persistence to Supabase tables
  try {
    // Delete existing active riders for this store so the roster is replaced with the new upload
    const { error: delErr } = await supabase
      .from('store_active_riders')
      .delete()
      .eq('store_id', storeId);

    if (delErr) {
      console.warn('store_active_riders table not yet created or inaccessible, relying on localStorage:', delErr.message);
      return {
        ok: true,
        totalSaved: riders.length,
        lastUpdated: nowIso,
      };
    }

    // Insert all riders in chunks of 500
    const CHUNK_SIZE = 500;
    for (let i = 0; i < riders.length; i += CHUNK_SIZE) {
      const chunk = riders.slice(i, i + CHUNK_SIZE).map((r) => ({
        store_id: storeId,
        rider_name: r.name,
        normalized_name: r.normalizedName,
        phone: r.phone || null,
        online_status: r.onlineStatus || null,
        eligibility: r.eligibility || null,
        attendance: r.attendance || null,
        source_store_code: r.storeCode || storeCode,
        uploaded_at: nowIso,
        updated_at: nowIso,
      }));

      const { error: insErr } = await supabase
        .from('store_active_riders')
        .insert(chunk);

      if (insErr) {
        console.warn('Batch insert to store_active_riders failed, using localStorage:', insErr.message);
        break;
      }
    }

    // Log the upload audit record
    await supabase.from('store_rider_roster_uploads').insert({
      store_id: storeId,
      filename,
      total_riders: riders.length,
      uploaded_at: nowIso,
      uploaded_by: uploadedBy || 'Admin',
    });

    return {
      ok: true,
      totalSaved: riders.length,
      lastUpdated: nowIso,
    };
  } catch (err) {
    console.warn('Supabase active rider persistence failed, cached in localStorage:', err);
    return {
      ok: true,
      totalSaved: riders.length,
      lastUpdated: nowIso,
    };
  }
}

/**
 * Fetches the active riders roster and last updated timestamp for a store.
 * Checks Supabase first; if not found or table doesn't exist, checks localStorage.
 */
export async function getActiveRidersRoster(
  storeId: string,
  storeCode: string
): Promise<ActiveRosterSummary> {
  const activeNamesSet = new Set<string>();
  const phoneByNameMap = new Map<string, string>();
  const ridersList: ActiveRiderRecord[] = [];
  let lastUpdated: string | null = null;
  let filename: string | null = null;

  // 1. Try querying Supabase
  try {
    const { data: dbRiders, error: ridersErr } = await supabase
      .from('store_active_riders')
      .select('rider_name, normalized_name, phone, online_status, eligibility, attendance, source_store_code, uploaded_at')
      .eq('store_id', storeId);

    if (!ridersErr && dbRiders && dbRiders.length > 0) {
      for (const r of dbRiders) {
        const norm = r.normalized_name || normalizeRiderName(r.rider_name);
        activeNamesSet.add(norm);
        if (r.phone && String(r.phone).trim()) {
          phoneByNameMap.set(norm, String(r.phone).trim());
        }
        ridersList.push({
          name: r.rider_name,
          normalizedName: norm,
          phone: r.phone || undefined,
          onlineStatus: r.online_status || undefined,
          eligibility: r.eligibility || undefined,
          attendance: r.attendance || undefined,
          storeCode: r.source_store_code || storeCode,
        });
      }
      lastUpdated = dbRiders[0]?.uploaded_at || null;

      // Get filename from uploads table
      const { data: uploadLog } = await supabase
        .from('store_rider_roster_uploads')
        .select('filename, uploaded_at')
        .eq('store_id', storeId)
        .order('uploaded_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (uploadLog) {
        filename = uploadLog.filename;
        lastUpdated = uploadLog.uploaded_at || lastUpdated;
      }

      return {
        storeId,
        storeCode,
        totalRiders: activeNamesSet.size,
        lastUpdated,
        lastUpdatedFormatted: formatRosterTimestamp(lastUpdated),
        filename,
        activeNamesSet,
        phoneByNameMap,
        riders: ridersList,
      };
    }
  } catch (err) {
    console.warn('Could not read store_active_riders from Supabase:', err);
  }

  // 2. Fallback to localStorage
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${storeId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.riders)) {
        for (const r of parsed.riders) {
          const norm = r.normalizedName || normalizeRiderName(r.name);
          activeNamesSet.add(norm);
          if (r.phone && String(r.phone).trim()) {
            phoneByNameMap.set(norm, String(r.phone).trim());
          }
          ridersList.push(r);
        }
        lastUpdated = parsed.lastUpdated || null;
        filename = parsed.filename || null;
      }
    }
  } catch (err) {
    console.warn('Could not read active riders from localStorage:', err);
  }

  return {
    storeId,
    storeCode,
    totalRiders: activeNamesSet.size,
    lastUpdated,
    lastUpdatedFormatted: formatRosterTimestamp(lastUpdated),
    filename,
    activeNamesSet,
    phoneByNameMap,
    riders: ridersList,
  };
}
