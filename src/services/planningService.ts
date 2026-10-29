// ==============================================================================
// Store Planning Service
// Handles SNOP Forecast ingestion, rewrite-storage, Target DPH persistence,
// Required Riders calculation [CEIL(orders / DPH)], and Last 1-Week Turn-Up integration.
// ==============================================================================

import * as XLSX from 'xlsx';
import { supabase } from '../config/supabaseClient';
import { getDateRangeForDays } from './analyticsService';
import { fetchS2POtpAnalytics } from './s2pOtpService';
import { INITIAL_TMK7_SNOP_RECORDS } from './planningDataSeed';

export interface SnopForecastRecord {
  city: string;
  warehouseId: string; // e.g. "TMK7"
  dateStr: string;     // "YYYY-MM-DD"
  hour: number;        // 0 to 23
  projectedOrders: number;
}

export interface SnopUploadMeta {
  warehouseId: string;
  filename: string;
  totalRows: number;
  startDate: string;
  endDate: string;
  totalProjectedOrders: number;
  uploadedAt: string;
  uploadedBy?: string;
}

export interface SnopParseResult {
  is_valid: boolean;
  filename: string;
  detected_warehouse_id?: string;
  records: SnopForecastRecord[];
  total_rows: number;
  start_date: string;
  end_date: string;
  total_projected_orders: number;
  errors: string[];
  warnings: string[];
}

export interface SlotPlanningRow {
  hour: number;
  slotLabel: string;
  projectedOrders: number;
  targetDph: number;
  requiredRiders: number;
  avgTurnUpLastWeek: number;
  deltaTurnUpVsRequired: number; // avgTurnUpLastWeek - requiredRiders
  turnUpCoveragePct: number;
  status: 'surplus' | 'balanced' | 'deficit';
}

export interface ShiftPeakMetrics {
  hour: number;
  slotLabel: string;
  projectedOrders: number;
  requiredRiders: number;
}

export interface DayPlanningSummary {
  dateStr: string;
  warehouseId: string;
  targetDph: number;
  totalProjectedOrders: number;
  peakRequiredRiders: number;
  peakHour: number;
  peakMorning: ShiftPeakMetrics;
  peakSecond: ShiftPeakMetrics;
  avgRequiredRiders: number;
  peakTurnUp: number;
  avgTurnUp: number;
  netTurnUpDelta: number;
  slots: SlotPlanningRow[];
  hasSnopData: boolean;
}

// Master LocalStorage Keys for instant zero-latency caching
export const LOCAL_STORAGE_SNOP_PREFIX = 'urban_connect_snop_records_';
export const LOCAL_STORAGE_SNOP_META_PREFIX = 'urban_connect_snop_meta_';
export const LOCAL_STORAGE_DPH_PREFIX = 'urban_connect_planning_dph_';

export const DEFAULT_STORE_DPH: Record<string, number> = {
  TMK7: 2.1,
  TPH1: 2.1,
  TPE2: 2.1,
};

/**
 * Calculates Required Riders for a given slot.
 * Formula: CEIL(Orders / DPH).
 * E.g. in 6 AM slot: 50 orders / 2.1 DPH = 23.8 -> 24 riders.
 */
export function calculateRequiredRiders(orders: number, dph: number): number {
  if (!orders || orders <= 0 || !dph || dph <= 0) {
    return 0;
  }
  return Math.ceil(orders / dph);
}

/**
 * Formats a slot hour (0-23) to a concise 12-hour format string (e.g. "6 AM", "12 PM").
 */
export function formatPlanningSlotLabel(hour: number): string {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const display12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${display12} ${ampm}`;
}

/**
 * Synchronous read of store target DPH from localStorage with fallback.
 */
export function getStoreTargetDphSync(siteCode: string): number {
  const norm = (siteCode || 'TMK7').toUpperCase().trim();
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const cached = window.localStorage.getItem(LOCAL_STORAGE_DPH_PREFIX + norm);
      if (cached) {
        const val = parseFloat(cached);
        if (!isNaN(val) && val > 0) return val;
      }
    }
  } catch {
    // Ignore storage errors in test or SSR
  }
  return DEFAULT_STORE_DPH[norm] ?? 2.1;
}

/**
 * Asynchronously loads store target DPH from Supabase table `store_planning_config`.
 */
export async function fetchStoreTargetDph(siteCode: string): Promise<number> {
  const norm = (siteCode || 'TMK7').toUpperCase().trim();
  const fallback = getStoreTargetDphSync(norm);

  try {
    const { data, error } = await supabase
      .from('store_planning_config')
      .select('target_dph')
      .eq('site_code', norm)
      .maybeSingle();

    if (!error && data && data.target_dph) {
      const val = Number(data.target_dph);
      if (!isNaN(val) && val > 0) {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(LOCAL_STORAGE_DPH_PREFIX + norm, String(val));
        }
        return val;
      }
    }
  } catch (err) {
    console.warn(`Supabase fetchStoreTargetDph fallback:`, err);
  }

  return fallback;
}

/**
 * Persists store target DPH to both Supabase and localStorage.
 */
export async function saveStoreTargetDph(
  siteCode: string,
  targetDph: number,
  updatedBy: string = 'User'
): Promise<{ ok: boolean; error?: string }> {
  const norm = (siteCode || 'TMK7').toUpperCase().trim();
  if (isNaN(targetDph) || targetDph <= 0) {
    return { ok: false, error: 'DPH must be a positive number greater than 0.' };
  }

  // 1. Instant local cache update
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(LOCAL_STORAGE_DPH_PREFIX + norm, String(targetDph));
    }
  } catch {
    // Ignore
  }

  // 2. Persist to Supabase table
  try {
    const { error } = await supabase.from('store_planning_config').upsert(
      {
        site_code: norm,
        target_dph: targetDph,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy,
      },
      { onConflict: 'site_code' }
    );

    if (error) {
      console.warn('Supabase store_planning_config upsert warning:', error.message);
      // Return ok true because local cache succeeded and user won't be blocked
      return { ok: true };
    }
    return { ok: true };
  } catch (err) {
    console.warn('Supabase store_planning_config save error:', err);
    return { ok: true };
  }
}

/**
 * Parses raw Date field from Excel or CSV.
 */
export function parseSnopDateField(raw: unknown): string {
  if (raw === null || raw === undefined) return '';

  if (typeof raw === 'number') {
    // Excel date code (e.g. 46320)
    try {
      const d = XLSX.SSF.parse_date_code(raw);
      if (d && d.y && d.m && d.d) {
        return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
      }
    } catch {
      // Fallback
    }
  }

  const str = String(raw).trim();
  if (!str) return '';

  // Direct match YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  // ISO string 2026-10-24T18:30:00...
  if (str.includes('T')) {
    const dateObj = new Date(str);
    if (!isNaN(dateObj.getTime())) {
      // Format in IST (Asia/Kolkata) as Indian operations run on IST
      const dtf = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return dtf.format(dateObj);
    }
  }

  // DD-MM-YYYY or DD/MM/YYYY
  const parts = str.split(/[-/]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
    if (parts[2].length === 4) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }

  return str;
}

/**
 * Normalizes column keys to standard naming.
 */
function normalizeColumnKey(raw: string): string {
  return raw.toLowerCase().replace(/[\s_\-]/g, '');
}

/**
 * Parses SNOP Forecast file (.xlsx or .csv) containing:
 * City, Warehouse Id, Date, Hour, Order
 */
export async function parseSnopFile(params: {
  fileBytes: ArrayBuffer;
  filename: string;
  targetSiteCode?: string;
}): Promise<SnopParseResult> {
  const { fileBytes, filename, targetSiteCode } = params;
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const workbook = XLSX.read(fileBytes, {
      type: 'array',
      cellDates: false,
      raw: true,
    });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return {
        is_valid: false,
        filename,
        records: [],
        total_rows: 0,
        start_date: '',
        end_date: '',
        total_projected_orders: 0,
        errors: ['Workbook does not contain any readable sheets.'],
        warnings: [],
      };
    }

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
      defval: null,
      raw: true,
    });

    if (!rawRows || rawRows.length === 0) {
      return {
        is_valid: false,
        filename,
        records: [],
        total_rows: 0,
        start_date: '',
        end_date: '',
        total_projected_orders: 0,
        errors: ['Uploaded sheet contains no data rows.'],
        warnings: [],
      };
    }

    // Inspect first row headers
    const sample = rawRows[0];
    const headerMap: Record<string, string> = {};
    for (const rawCol of Object.keys(sample)) {
      headerMap[normalizeColumnKey(rawCol)] = rawCol;
    }

    const cityCol = headerMap['city'];
    const whCol =
      headerMap['warehouseid'] ||
      headerMap['warehouse'] ||
      headerMap['sitecode'] ||
      headerMap['storecode'] ||
      headerMap['site'];
    const dateCol = headerMap['date'] || headerMap['forecastdate'] || headerMap['orderdate'];
    const hourCol = headerMap['hour'] || headerMap['slot'] || headerMap['slothour'];
    const orderCol =
      headerMap['order'] ||
      headerMap['orders'] ||
      headerMap['projectedorders'] ||
      headerMap['volume'];

    if (!whCol || !dateCol || !hourCol || !orderCol) {
      const missing: string[] = [];
      if (!whCol) missing.push('Warehouse Id (or Site Code)');
      if (!dateCol) missing.push('Date');
      if (!hourCol) missing.push('Hour');
      if (!orderCol) missing.push('Order');
      return {
        is_valid: false,
        filename,
        records: [],
        total_rows: 0,
        start_date: '',
        end_date: '',
        total_projected_orders: 0,
        errors: [
          `Missing required columns: ${missing.join(', ')}. Expected header format: City, Warehouse Id, Date, Hour, Order.`,
        ],
        warnings: [],
      };
    }

    const validRecords: SnopForecastRecord[] = [];
    const warehouseCodes = new Set<string>();
    let totalProjected = 0;

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const city = cityCol && row[cityCol] ? String(row[cityCol]).trim() : 'Pune';
      const whRaw = row[whCol] ? String(row[whCol]).trim().toUpperCase() : '';
      const dateStr = parseSnopDateField(row[dateCol]);
      const hourRaw = row[hourCol];
      const orderRaw = row[orderCol];

      if (!whRaw || !dateStr) {
        continue;
      }

      const hour = Number(hourRaw);
      if (isNaN(hour) || hour < 0 || hour > 23) {
        continue;
      }

      const orders = Number(orderRaw);
      if (isNaN(orders) || orders < 0) {
        continue;
      }

      warehouseCodes.add(whRaw);
      totalProjected += orders;

      validRecords.push({
        city,
        warehouseId: whRaw,
        dateStr,
        hour,
        projectedOrders: Math.round(orders * 10) / 10,
      });
    }

    if (validRecords.length === 0) {
      return {
        is_valid: false,
        filename,
        records: [],
        total_rows: 0,
        start_date: '',
        end_date: '',
        total_projected_orders: 0,
        errors: ['No valid forecast rows could be extracted. Please check date and hour formatting.'],
        warnings: [],
      };
    }

    const uniqueDates = Array.from(new Set(validRecords.map((r) => r.dateStr))).sort();
    const startDate = uniqueDates[0];
    const endDate = uniqueDates[uniqueDates.length - 1];
    const detectedWarehouse = Array.from(warehouseCodes)[0];

    if (targetSiteCode && warehouseCodes.size > 0 && !warehouseCodes.has(targetSiteCode.toUpperCase())) {
      warnings.push(
        `File warehouse ID "${detectedWarehouse}" does not match active store selection "${targetSiteCode}". Records will be mapped to ${detectedWarehouse}.`
      );
    }

    return {
      is_valid: true,
      filename,
      detected_warehouse_id: detectedWarehouse,
      records: validRecords,
      total_rows: validRecords.length,
      start_date: startDate,
      end_date: endDate,
      total_projected_orders: Math.round(totalProjected),
      errors,
      warnings,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      is_valid: false,
      filename,
      records: [],
      total_rows: 0,
      start_date: '',
      end_date: '',
      total_projected_orders: 0,
      errors: [`Failed to parse workbook: ${msg}`],
      warnings: [],
    };
  }
}

/**
 * Retrieves stored SNOP records for a warehouse from localStorage,
 * falling back to pre-seeded TMK7 baseline.
 */
export function getStoredSnopRecords(warehouseId: string): SnopForecastRecord[] {
  const norm = (warehouseId || 'TMK7').toUpperCase().trim();
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_SNOP_PREFIX + norm);
      if (raw) {
        const parsed = JSON.parse(raw) as SnopForecastRecord[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    }
  } catch {
    // Fallback
  }

  // Pre-seed default for TMK7 if nothing stored yet
  if (norm === 'TMK7') {
    return INITIAL_TMK7_SNOP_RECORDS.map((r) => ({ ...r }));
  }

  return [];
}

/**
 * Retrieves SNOP upload metadata for a warehouse.
 */
export function getSnopUploadMeta(warehouseId: string): SnopUploadMeta | null {
  const norm = (warehouseId || 'TMK7').toUpperCase().trim();
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_SNOP_META_PREFIX + norm);
      if (raw) {
        return JSON.parse(raw) as SnopUploadMeta;
      }
    }
  } catch {
    // Fallback
  }

  // Pre-seeded TMK7 baseline metadata
  if (norm === 'TMK7') {
    const records = INITIAL_TMK7_SNOP_RECORDS;
    const totalOrders = Math.round(records.reduce((acc, r) => acc + r.projectedOrders, 0));
    return {
      warehouseId: 'TMK7',
      filename: 'TMK7_SNOP_Forecast_20261025_20261121.xlsx',
      totalRows: records.length,
      startDate: '2026-10-25',
      endDate: '2026-11-21',
      totalProjectedOrders: totalOrders,
      uploadedAt: '2026-10-25T06:00:00.000Z',
      uploadedBy: 'System Baseline',
    };
  }

  return null;
}

/**
 * Saves SNOP records with strict rewrite/overwrite semantics:
 * "new upload should rewrite any old existing data"
 */
export async function saveSnopRecords(params: {
  warehouseId: string;
  records: SnopForecastRecord[];
  filename: string;
  uploadedBy?: string;
}): Promise<{ ok: boolean; count: number; error?: string }> {
  const { warehouseId, records, filename, uploadedBy = 'User' } = params;
  const norm = (warehouseId || 'TMK7').toUpperCase().trim();

  if (!records || records.length === 0) {
    return { ok: false, count: 0, error: 'Cannot save empty forecast.' };
  }

  const sortedDates = Array.from(new Set(records.map((r) => r.dateStr))).sort();
  const startDate = sortedDates[0];
  const endDate = sortedDates[sortedDates.length - 1];
  const totalProjected = Math.round(records.reduce((sum, r) => sum + r.projectedOrders, 0));

  const meta: SnopUploadMeta = {
    warehouseId: norm,
    filename,
    totalRows: records.length,
    startDate,
    endDate,
    totalProjectedOrders: totalProjected,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
  };

  // 1. Instant local overwrite in localStorage
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(LOCAL_STORAGE_SNOP_PREFIX + norm, JSON.stringify(records));
      window.localStorage.setItem(LOCAL_STORAGE_SNOP_META_PREFIX + norm, JSON.stringify(meta));
    }
  } catch (err) {
    console.warn('LocalStorage saveSnopRecords error:', err);
  }

  // 2. Persist to Supabase database (rewrite existing rows for that warehouse)
  try {
    // Delete old existing forecast for this warehouse
    const delRes = await supabase
      .from('store_snop_forecast')
      .delete()
      .eq('warehouse_id', norm);

    if (delRes.error) {
      console.warn('Supabase delete old forecast warning:', delRes.error.message);
    }

    // Insert new records in batches of 200
    const chunkSize = 200;
    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize).map((r) => ({
        city: r.city,
        warehouse_id: norm,
        forecast_date: r.dateStr,
        slot_hour: r.hour,
        projected_orders: r.projectedOrders,
      }));

      const { error: insErr } = await supabase.from('store_snop_forecast').insert(chunk);
      if (insErr) {
        console.warn('Supabase store_snop_forecast insert warning:', insErr.message);
      }
    }

    // Record upload history
    await supabase.from('store_snop_uploads').insert({
      warehouse_id: norm,
      filename,
      total_rows: records.length,
      start_date: startDate,
      end_date: endDate,
      uploaded_by: uploadedBy,
    });
  } catch (err) {
    console.warn('Supabase saveSnopRecords database sync note:', err);
  }

  return { ok: true, count: records.length };
}

/**
 * Returns all available forecast dates for a given store/warehouse.
 */
export function getAvailableForecastDates(warehouseId: string): string[] {
  const records = getStoredSnopRecords(warehouseId);
  const set = new Set(records.map((r) => r.dateStr));
  return Array.from(set).sort();
}

/**
 * Resolves the default planning date for a store.
 * By default, planning displays the next date (tomorrow or the closest upcoming future date)
 * from the current date.
 */
export function getDefaultPlanningDate(
  availableDates: string[],
  timeZone: string = 'Asia/Kolkata',
  baseDate: Date = new Date()
): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  if (availableDates.length === 0) {
    const tmrw = new Date(baseDate.getTime() + 24 * 60 * 60 * 1000);
    return formatter.format(tmrw);
  }

  const todayStr = formatter.format(baseDate);
  const tomorrow = new Date(baseDate.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = formatter.format(tomorrow);

  // 1. If tomorrow exists in available dates, default to tomorrow
  if (availableDates.includes(tomorrowStr)) {
    return tomorrowStr;
  }

  // 2. Otherwise pick the next upcoming future date strictly after today
  const futureDates = availableDates.filter((d) => d > todayStr).sort();
  if (futureDates.length > 0) {
    return futureDates[0];
  }

  // 3. If all forecast dates are in the past, fallback to the most recent available date
  return availableDates[availableDates.length - 1];
}

/**
 * Wraps an async promise with a fast timeout so network hangs never block UI or tests.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Calculates the last 1 week's average rider turn-up for each slot hour (0 to 23).
 * Sourced directly from S2P and OTP analytics (`COUNTUNIQUE rider_number` as `ridersCount`).
 */
export async function fetchAvgTurnUpBySlot(params: {
  storeId: string;
  timeZone?: string;
}): Promise<Record<number, number>> {
  const { storeId, timeZone = 'Asia/Kolkata' } = params;
  const slotSum: Record<number, number> = {};
  const slotCount: Record<number, number> = {};

  try {
    // Query last 7 completed days with 1200ms timeout guard
    const range = getDateRangeForDays(7, timeZone);
    let res = await withTimeout(
      fetchS2POtpAnalytics({
        storeId,
        startDate: range.startDate,
        endDate: range.endDate,
      }),
      1200,
      { data: null, source: 'cache' as const }
    );

    // If last 7 completed days has no data yet, query broader 30-day window to capture historical turn-up
    if (!res.data || !res.data.days || res.data.days.length === 0) {
      const range30 = getDateRangeForDays(30, timeZone);
      res = await withTimeout(
        fetchS2POtpAnalytics({
          storeId,
          startDate: range30.startDate,
          endDate: range30.endDate,
        }),
        1200,
        { data: null, source: 'cache' as const }
      );
    }

    if (res.data && res.data.days && res.data.days.length > 0) {
      // Use the most recent up to 7 available days
      const availableDays = res.data.days.slice(-7);
      for (const day of availableDays) {
        for (const slot of day.slots) {
          const h = slot.slotHour;
          slotSum[h] = (slotSum[h] || 0) + (slot.ridersCount || 0);
          slotCount[h] = (slotCount[h] || 0) + 1;
        }
      }
    }
  } catch (err) {
    console.warn('Failed to fetch S2P & OTP turn-up for planning:', err);
  }

  const result: Record<number, number> = {};
  for (let h = 0; h < 24; h++) {
    const total = slotSum[h] || 0;
    const cnt = slotCount[h] || 0;
    // Average rounded down to nearest integer (whole riders)
    result[h] = cnt > 0 ? Math.floor(total / cnt) : 0;
  }

  return result;
}

/**
 * Assembles the full Day Planning Summary for a given store, date, and DPH.
 */
export async function fetchPlanningForDate(params: {
  storeId: string;
  warehouseId: string;
  dateStr: string;
  targetDph?: number;
  timeZone?: string;
  avgTurnUpMap?: Record<number, number>;
}): Promise<DayPlanningSummary> {
  const { storeId, warehouseId, dateStr, timeZone = 'Asia/Kolkata', avgTurnUpMap: overrideTurnUp } = params;
  const normWh = (warehouseId || 'TMK7').toUpperCase().trim();

  // 1. Resolve Target DPH
  const dph =
    params.targetDph !== undefined && params.targetDph > 0
      ? params.targetDph
      : await fetchStoreTargetDph(normWh);

  // 2. Fetch last 1 week's average turn-up by slot (or use override if provided)
  const avgTurnUpMap = overrideTurnUp ?? (await fetchAvgTurnUpBySlot({ storeId, timeZone }));

  // 3. Load SNOP forecast records for this warehouse
  const allRecords = getStoredSnopRecords(normWh);
  const dayRecords = allRecords.filter((r) => r.dateStr === dateStr);
  const hasSnopData = dayRecords.length > 0;

  // Build a map of projected orders by hour
  const orderMap = new Map<number, number>();
  for (const r of dayRecords) {
    orderMap.set(r.hour, (orderMap.get(r.hour) || 0) + r.projectedOrders);
  }

  // Operating slot hours: 6 AM to 11 PM (hours 6 to 23)
  const slotRows: SlotPlanningRow[] = [];
  let totalOrders = 0;
  let peakRequired = 0;
  let peakHour = 6;
  let sumRequired = 0;
  let sumTurnUp = 0;
  let peakTurnUp = 0;
  let activeSlotCount = 0;

  for (let h = 6; h <= 23; h++) {
    const projectedOrders = orderMap.get(h) ?? 0;
    const requiredRiders = calculateRequiredRiders(projectedOrders, dph);
    const rawTurnUp = avgTurnUpMap[h] ?? 0;
    // Round down to nearest whole number (integer riders)
    const avgTurnUpLastWeek = Math.floor(rawTurnUp);
    const delta = avgTurnUpLastWeek - requiredRiders;
    const turnUpCoveragePct =
      requiredRiders > 0 ? Math.round((avgTurnUpLastWeek / requiredRiders) * 100) : 100;

    let status: 'surplus' | 'balanced' | 'deficit' = 'balanced';
    if (avgTurnUpLastWeek < requiredRiders) {
      status = 'deficit';
    } else if (avgTurnUpLastWeek > requiredRiders) {
      status = 'surplus';
    }

    slotRows.push({
      hour: h,
      slotLabel: formatPlanningSlotLabel(h),
      projectedOrders,
      targetDph: dph,
      requiredRiders,
      avgTurnUpLastWeek,
      deltaTurnUpVsRequired: delta,
      turnUpCoveragePct,
      status,
    });

    totalOrders += projectedOrders;
    sumRequired += requiredRiders;
    sumTurnUp += avgTurnUpLastWeek;
    if (avgTurnUpLastWeek > peakTurnUp) {
      peakTurnUp = avgTurnUpLastWeek;
    }
    if (requiredRiders > peakRequired) {
      peakRequired = requiredRiders;
      peakHour = h;
    }
    if (projectedOrders > 0 || requiredRiders > 0 || avgTurnUpLastWeek > 0) {
      activeSlotCount += 1;
    }
  }

  const denominator = activeSlotCount > 0 ? activeSlotCount : 18;
  const avgRequiredRiders = Math.round((sumRequired / denominator) * 10) / 10;
  // Round down average turn-up to nearest whole number
  const avgTurnUp = Math.floor(sumTurnUp / denominator);
  const netTurnUpDelta = sumTurnUp - sumRequired;

  // Peak for Morning Shift (6 AM to 3 PM: hours 6 to 14)
  const morningSlots = slotRows.filter((s) => s.hour >= 6 && s.hour < 15);
  let peakMorning: ShiftPeakMetrics = morningSlots[0]
    ? {
        hour: morningSlots[0].hour,
        slotLabel: morningSlots[0].slotLabel,
        projectedOrders: morningSlots[0].projectedOrders,
        requiredRiders: morningSlots[0].requiredRiders,
      }
    : {
        hour: 6,
        slotLabel: '6 AM',
        projectedOrders: 0,
        requiredRiders: 0,
      };

  for (const s of morningSlots) {
    if (s.projectedOrders > peakMorning.projectedOrders) {
      peakMorning = {
        hour: s.hour,
        slotLabel: s.slotLabel,
        projectedOrders: s.projectedOrders,
        requiredRiders: s.requiredRiders,
      };
    }
  }

  // Peak for 2nd Shift (3 PM to 12 AM: hours 15 to 23)
  const secondSlots = slotRows.filter((s) => s.hour >= 15 && s.hour < 24);
  let peakSecond: ShiftPeakMetrics = secondSlots[0]
    ? {
        hour: secondSlots[0].hour,
        slotLabel: secondSlots[0].slotLabel,
        projectedOrders: secondSlots[0].projectedOrders,
        requiredRiders: secondSlots[0].requiredRiders,
      }
    : {
        hour: 15,
        slotLabel: '3 PM',
        projectedOrders: 0,
        requiredRiders: 0,
      };

  for (const s of secondSlots) {
    if (s.projectedOrders > peakSecond.projectedOrders) {
      peakSecond = {
        hour: s.hour,
        slotLabel: s.slotLabel,
        projectedOrders: s.projectedOrders,
        requiredRiders: s.requiredRiders,
      };
    }
  }

  return {
    dateStr,
    warehouseId: normWh,
    targetDph: dph,
    totalProjectedOrders: Math.round(totalOrders * 10) / 10,
    peakRequiredRiders: peakRequired,
    peakHour,
    peakMorning,
    peakSecond,
    avgRequiredRiders,
    peakTurnUp: Math.round(peakTurnUp * 10) / 10,
    avgTurnUp,
    netTurnUpDelta,
    slots: slotRows,
    hasSnopData,
  };
}

/**
 * Synchronously recalculates an existing DayPlanningSummary in-memory with a new Target DPH.
 * Updates Required Riders [CEIL(Orders / DPH)], Turn-Up Deltas, Shift Peaks, and Status
 * with zero network latency.
 */
export function recalculatePlanningWithDph(
  summary: DayPlanningSummary,
  newDph: number
): DayPlanningSummary {
  if (!summary || isNaN(newDph) || newDph <= 0) return summary;

  let totalOrders = 0;
  let peakRequired = 0;
  let peakHour = 6;
  let sumRequired = 0;
  let sumTurnUp = 0;
  let peakTurnUp = 0;
  let activeSlotCount = 0;

  const updatedSlots: SlotPlanningRow[] = summary.slots.map((s) => {
    const requiredRiders = calculateRequiredRiders(s.projectedOrders, newDph);
    const avgTurnUpLastWeek = s.avgTurnUpLastWeek;
    const delta = avgTurnUpLastWeek - requiredRiders;
    const turnUpCoveragePct =
      requiredRiders > 0 ? Math.round((avgTurnUpLastWeek / requiredRiders) * 100) : 100;

    let status: 'surplus' | 'balanced' | 'deficit' = 'balanced';
    if (avgTurnUpLastWeek < requiredRiders) {
      status = 'deficit';
    } else if (avgTurnUpLastWeek > requiredRiders) {
      status = 'surplus';
    }

    totalOrders += s.projectedOrders;
    sumRequired += requiredRiders;
    sumTurnUp += avgTurnUpLastWeek;
    if (avgTurnUpLastWeek > peakTurnUp) {
      peakTurnUp = avgTurnUpLastWeek;
    }
    if (requiredRiders > peakRequired) {
      peakRequired = requiredRiders;
      peakHour = s.hour;
    }
    if (s.projectedOrders > 0 || requiredRiders > 0 || avgTurnUpLastWeek > 0) {
      activeSlotCount += 1;
    }

    return {
      ...s,
      targetDph: newDph,
      requiredRiders,
      deltaTurnUpVsRequired: delta,
      turnUpCoveragePct,
      status,
    };
  });

  const denominator = activeSlotCount > 0 ? activeSlotCount : 18;
  const avgRequiredRiders = Math.round((sumRequired / denominator) * 10) / 10;
  const avgTurnUp = Math.floor(sumTurnUp / denominator);
  const netTurnUpDelta = sumTurnUp - sumRequired;

  // Peak for Morning Shift (6 AM to 3 PM: hours 6 to 14)
  const morningSlots = updatedSlots.filter((s) => s.hour >= 6 && s.hour < 15);
  let peakMorning: ShiftPeakMetrics = morningSlots[0]
    ? {
        hour: morningSlots[0].hour,
        slotLabel: morningSlots[0].slotLabel,
        projectedOrders: morningSlots[0].projectedOrders,
        requiredRiders: morningSlots[0].requiredRiders,
      }
    : {
        hour: 6,
        slotLabel: '6 AM',
        projectedOrders: 0,
        requiredRiders: 0,
      };

  for (const s of morningSlots) {
    if (s.projectedOrders > peakMorning.projectedOrders) {
      peakMorning = {
        hour: s.hour,
        slotLabel: s.slotLabel,
        projectedOrders: s.projectedOrders,
        requiredRiders: s.requiredRiders,
      };
    }
  }

  // Peak for 2nd Shift (3 PM to 12 AM: hours 15 to 23)
  const secondSlots = updatedSlots.filter((s) => s.hour >= 15 && s.hour < 24);
  let peakSecond: ShiftPeakMetrics = secondSlots[0]
    ? {
        hour: secondSlots[0].hour,
        slotLabel: secondSlots[0].slotLabel,
        projectedOrders: secondSlots[0].projectedOrders,
        requiredRiders: secondSlots[0].requiredRiders,
      }
    : {
        hour: 15,
        slotLabel: '3 PM',
        projectedOrders: 0,
        requiredRiders: 0,
      };

  for (const s of secondSlots) {
    if (s.projectedOrders > peakSecond.projectedOrders) {
      peakSecond = {
        hour: s.hour,
        slotLabel: s.slotLabel,
        projectedOrders: s.projectedOrders,
        requiredRiders: s.requiredRiders,
      };
    }
  }

  return {
    ...summary,
    targetDph: newDph,
    totalProjectedOrders: Math.round(totalOrders * 10) / 10,
    peakRequiredRiders: peakRequired,
    peakHour,
    peakMorning,
    peakSecond,
    avgRequiredRiders,
    peakTurnUp: Math.round(peakTurnUp * 10) / 10,
    avgTurnUp,
    netTurnUpDelta,
    slots: updatedSlots,
  };
}

/**
 * Exports daily planning sheet to Excel (.xlsx) workbook.
 */
export function exportPlanningToExcel(summary: DayPlanningSummary, storeName: string): void {
  const rows: Array<Array<string | number>> = [
    ['Urban Connect — Operations Slot Planning Sheet'],
    ['Store', `${summary.warehouseId} — ${storeName}`],
    ['Planning Date', summary.dateStr],
    ['Target DPH', summary.targetDph],
    ['Total Projected Orders', summary.totalProjectedOrders],
    ['Peak Required Riders', summary.peakRequiredRiders],
    ['Average Required Riders', summary.avgRequiredRiders],
    ['Average Last Week Turn-Up', summary.avgTurnUp],
    ['Net Status', summary.netTurnUpDelta < 0 ? `${summary.netTurnUpDelta} Short` : summary.netTurnUpDelta > 0 ? `+${summary.netTurnUpDelta} Surplus` : 'Balanced'],
    [''],
    [
      'Slot Hour',
      'Slot Window',
      'Projected Orders',
      'Required Riders [CEIL(Orders/DPH)]',
      'Last 1-Wk Avg Turn-Up',
      'Status',
    ],
  ];

  for (const s of summary.slots) {
    const statusText =
      s.requiredRiders === 0 && s.avgTurnUpLastWeek === 0
        ? '—'
        : s.deltaTurnUpVsRequired < 0
        ? `${s.deltaTurnUpVsRequired} Short`
        : s.deltaTurnUpVsRequired > 0
        ? `+${s.deltaTurnUpVsRequired} Surplus`
        : 'Balanced';

    rows.push([
      s.hour,
      s.slotLabel,
      s.projectedOrders,
      s.requiredRiders,
      s.avgTurnUpLastWeek,
      statusText,
    ]);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Planning Summary');

  const outFilename = `${summary.warehouseId}_Planning_${summary.dateStr}.xlsx`;
  XLSX.writeFile(wb, outFilename);
}
