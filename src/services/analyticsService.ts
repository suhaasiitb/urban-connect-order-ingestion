// ==============================================================================
// Rider Performance Analytics Service
// Aggregates rider hours (COUNTUNIQUE slot_hour) and orders (COUNTA order_id)
// over selectable date ranges with working-day cumulative averages and Excel export.
// ==============================================================================

import * as XLSX from 'xlsx';
import { supabase } from '../config/supabaseClient';
import { cleanRiderDisplayName, normalizeRiderName } from './activeRiderService';

export interface RiderDailyMetric {
  hours: number;
  orders: number;
  distanceKm: number; // One-way distance in km (LM Distance in meters / 1000)
  distanceMeters?: number; // Exact sum of distance in meters
  otpBreachedCount?: number; // Count of OTP Breached orders on this day
  btoCount?: number; // Count of BTO (RTO_DELIVERED) orders on this day
}

export interface RiderPivotRow {
  riderName: string;
  dailyMetrics: Record<string, RiderDailyMetric>; // dateStr -> { hours, orders, distanceKm, distanceMeters, otpBreachedCount, btoCount }
  workingDays: number;
  totalHours: number;
  totalOrders: number;
  totalDistanceKm: number; // Total km delivered in period
  otpBreachedCount?: number; // Total OTP Breached orders in selected period
  otpBreachedDays?: number; // Number of distinct days in period with >= 1 OTP breach
  btoCount?: number; // Total BTO (RTO_DELIVERED) orders in selected period
  btoDays?: number; // Number of distinct days in period with >= 1 BTO order
  avgHours: number; // Period average (totalHours / periodDays)
  avgOrders: number; // Period average (totalOrders / periodDays)
  avgDistanceKm: number; // Period average daily distance (totalDistanceKm / periodDays)
  activeAvgHours: number; // Active-working-days average (totalHours / workingDays)
  activeAvgOrders: number; // Active-working-days average (totalOrders / workingDays)
  activeAvgDistanceKm: number; // Active-working-days average (totalDistanceKm / workingDays)
}

/**
 * Returns true when a rider qualifies as a high-BTO rider for the selected period
 * (>= 1 BTO order on a single-day period, >= 2 BTO orders on multi-day periods).
 */
export function isHighBtoRider(
  row: Pick<RiderPivotRow, 'btoCount'>,
  isSingleDayPeriod: boolean
): boolean {
  const threshold = isSingleDayPeriod ? 1 : 2;
  return (row.btoCount ?? 0) >= threshold;
}

export interface RiderPerformancePivotResult {
  storeId: string;
  startDate: string;
  endDate: string;
  periodDays: number;
  dateColumns: Array<{
    dateStr: string; // '2026-10-15'
    formattedHeader: string; // '15-Oct'
  }>;
  rows: RiderPivotRow[];
  totalRiders: number;
  overallAvgHours: number;
  overallAvgOrders: number;
  overallAvgDistanceKm?: number;
  overallTotalDistanceKm?: number;
  ridersUnder6HoursCount?: number;
}

/**
 * Formats YYYY-MM-DD into DD-MMM (e.g. '2026-10-15' -> '15-Oct').
 */
export function formatDateToHeader(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const day = parts[2];
  const monthNum = parseInt(parts[1], 10);
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const m = monthNames[monthNum - 1] || parts[1];
  return `${day}-${m}`;
}

function formatUtcNoonDate(utcMs: number): string {
  const d = new Date(utcMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Shifts a YYYY-MM-DD date string by deltaDays using UTC noon arithmetic (DST-safe).
 */
export function shiftIsoDate(dateStr: string, deltaDays: number): string {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return dateStr;
  }
  const [y, m, d] = parts;
  return formatUtcNoonDate(Date.UTC(y, m - 1, d, 12, 0, 0) + deltaDays * 86400000);
}

/**
 * Computes all calendar date strings (YYYY-MM-DD) between startDate and endDate inclusive.
 * Default order is 'desc' (newest date first, e.g. 19th down to 13th), or 'asc' (chronological).
 */
export function getAllDatesInRange(
  startDate: string,
  endDate: string,
  order: 'asc' | 'desc' = 'desc'
): string[] {
  const [sY, sM, sD] = startDate.split('-').map(Number);
  const [eY, eM, eD] = endDate.split('-').map(Number);

  const startUtc = Date.UTC(sY, sM - 1, sD, 12, 0, 0);
  const endUtc = Date.UTC(eY, eM - 1, eD, 12, 0, 0);

  const result: string[] = [];
  const oneDayMs = 86400000;

  for (let t = startUtc; t <= endUtc + 1000; t += oneDayMs) {
    result.push(formatUtcNoonDate(t));
  }

  if (order === 'desc') {
    result.reverse();
  }

  return result;
}

/**
 * Returns today's ISO date string (YYYY-MM-DD) in the specified timezone (default Asia/Kolkata).
 */
export function getTodayDateString(timeZone: string = 'Asia/Kolkata'): string {
  const now = new Date();
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(now);
}

/**
 * Computes date range strings going back N days (Asia/Kolkata).
 * If includeToday is false (default):
 *   Period ends on YESTERDAY (excluding current ongoing date).
 *   e.g. if today is 2026-10-31 and daysCount is 7:
 *   endDate = 2026-10-30 (yesterday)
 *   startDate = 2026-10-24 (7 days total: 24th to 30th)
 * If includeToday is true:
 *   Period ends on TODAY (including current ongoing / partial date).
 *   e.g. if today is 2026-10-31 and daysCount is 7:
 *   endDate = 2026-10-31 (today)
 *   startDate = 2026-10-25 (7 days total: 25th to 31st)
 * If daysCount is 0:
 *   Returns today's date for both startDate and endDate.
 */
export function getDateRangeForDays(
  daysCount: number,
  timeZone: string = 'Asia/Kolkata',
  includeToday: boolean = false
): { startDate: string; endDate: string } {
  const todayStr = getTodayDateString(timeZone);
  if (daysCount === 0) {
    return {
      startDate: todayStr,
      endDate: todayStr,
    };
  }

  const [tY, tM, tD] = todayStr.split('-').map(Number);
  const anchorUtc = Date.UTC(tY, tM - 1, tD, 12, 0, 0);

  // Exclude current date unless includeToday is requested
  const endUtc = includeToday ? anchorUtc : anchorUtc - 86400000;
  const yD = new Date(endUtc);
  const endY = yD.getUTCFullYear();
  const endM = String(yD.getUTCMonth() + 1).padStart(2, '0');
  const endDay = String(yD.getUTCDate()).padStart(2, '0');
  const endDate = `${endY}-${endM}-${endDay}`;

  const effectiveDays = Math.max(1, daysCount);
  const startUtc = endUtc - (effectiveDays - 1) * 86400000;
  const sD = new Date(startUtc);
  const sY = sD.getUTCFullYear();
  const sM = String(sD.getUTCMonth() + 1).padStart(2, '0');
  const sDay = String(sD.getUTCDate()).padStart(2, '0');
  const startDate = `${sY}-${sM}-${sDay}`;

  return {
    startDate,
    endDate,
  };
}

/**
 * Fetches and builds the Rider Daily Hours & Orders pivot table for a store
 * over a given date range.
 * Fully paginates all queries to prevent PostgREST 1,000-row truncation across multiple dates.
 */
export async function fetchRiderPerformanceAnalytics(params: {
  storeId: string;
  startDate: string;
  endDate: string;
  dateOrder?: 'asc' | 'desc';
}): Promise<{
  data: RiderPerformancePivotResult | null;
  error?: string;
}> {
  const { storeId, startDate, endDate, dateOrder = 'desc' } = params;

  try {
    let rawAggregated: Array<{
      rider_name: string;
      order_date: string;
      hours: number;
      orders: number;
      distance_meters: number;
      otp_breached_count: number;
      bto_count: number;
    }> = [];
    let rpcSucceeded = false;

    // 1. First, attempt to call the server-side RPC get_rider_daily_performance with pagination
    try {
      const RPC_PAGE_SIZE = 1000;
      let rpcFrom = 0;
      let rpcHasMore = true;
      const rpcRows: Array<{
        rider_name: string;
        order_date: string;
        hours: number;
        orders: number;
        distance_meters: number;
        otp_breached_count: number;
        bto_count: number;
      }> = [];

      let rpcRanSuccessfully = false;
      while (rpcHasMore) {
        const { data: rpcData, error: rpcError } = await supabase
          .rpc('get_rider_daily_performance', {
            p_store_id: storeId,
            p_start_date: startDate,
            p_end_date: endDate,
          })
          .range(rpcFrom, rpcFrom + RPC_PAGE_SIZE - 1);

        if (rpcError) {
          // If RPC doesn't exist yet or fails, break to run client-side aggregation fallback
          break;
        }

        if (Array.isArray(rpcData) && rpcData.length > 0) {
          // If the RPC returned data without distance_meters, otp_breached_count, or bto_count (pre-migration),
          // fallback to client-side aggregation from public.orders to guarantee all fields are populated
          const firstRow = rpcData[0] as Record<string, unknown>;
          if (
            firstRow.distance_meters === undefined ||
            firstRow.otp_breached_count === undefined ||
            firstRow.bto_count === undefined
          ) {
            rpcRanSuccessfully = false;
            break;
          }

          rpcRanSuccessfully = true;

          for (const item of rpcData) {
            rpcRows.push({
              rider_name: String(item.rider_name || '').trim(),
              order_date: String(item.order_date),
              hours: Number(item.hours || 0),
              orders: Number(item.orders || 0),
              distance_meters: Number(item.distance_meters || 0),
              otp_breached_count: Number(item.otp_breached_count || 0),
              bto_count: Number(item.bto_count || 0),
            });
          }
          if (rpcData.length < RPC_PAGE_SIZE) {
            rpcHasMore = false;
          } else {
            rpcFrom += RPC_PAGE_SIZE;
          }
        } else {
          rpcRanSuccessfully = true;
          rpcHasMore = false;
        }
      }

      if (rpcRanSuccessfully) {
        rawAggregated = rpcRows;
        rpcSucceeded = true;
      }
    } catch {
      rpcSucceeded = false;
    }

    // 2. Client-side aggregation fallback from public.orders with complete pagination
    if (!rpcSucceeded) {
      const PAGE_SIZE = 1000;
      let from = 0;
      let hasMore = true;
      const orderRows: Array<{
        rider_name: string | null;
        slot_hour: number;
        order_date: string;
        order_id: string;
        distance_meters?: number | null;
        lm_distance?: number | null;
        otp_plus_3_performance?: string | null;
        status?: string | null;
      }> = [];

      while (hasMore) {
        const { data: pageRows, error: ordersError } = await supabase
          .from('orders')
          .select('rider_name, slot_hour, order_date, order_id, distance_meters, lm_distance, otp_plus_3_performance, status')
          .eq('store_id', storeId)
          .gte('order_date', startDate)
          .lte('order_date', endDate)
          .range(from, from + PAGE_SIZE - 1);

        if (ordersError) {
          return {
            data: null,
            error: `Failed to load order records: ${ordersError.message}`,
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

      // Group by (normalized rider_name, order_date) and compute COUNTUNIQUE(slot_hour), COUNT(order_id), SUM(distance_meters), OTP Breached count, and BTO (RTO_DELIVERED) count
      const riderDateSlots = new Map<string, Set<number>>();
      const riderDateOrders = new Map<string, number>();
      const riderDateDistanceMeters = new Map<string, number>();
      const riderDateOtpBreached = new Map<string, number>();
      const riderDateBto = new Map<string, number>();
      const canonicalDisplayByNorm = new Map<string, string>();

      for (const row of orderRows) {
        const rawName = row.rider_name;
        if (!rawName || typeof rawName !== 'string') continue;
        const cleanName = cleanRiderDisplayName(rawName);
        if (!cleanName || cleanName === '-' || cleanName.toLowerCase() === 'null') continue;
        const normName = normalizeRiderName(cleanName);
        if (!normName) continue;

        if (!canonicalDisplayByNorm.has(normName) || !rawName.includes('*')) {
          canonicalDisplayByNorm.set(normName, cleanName);
        }

        const date = String(row.order_date);
        const slot = Number(row.slot_hour);
        const key = `${normName}:::${date}`;

        if (!riderDateSlots.has(key)) {
          riderDateSlots.set(key, new Set<number>());
        }
        if (Number.isFinite(slot) && slot >= 0 && slot <= 23) {
          riderDateSlots.get(key)!.add(slot);
        }

        riderDateOrders.set(key, (riderDateOrders.get(key) ?? 0) + 1);

        const dist = Number(row.distance_meters ?? row.lm_distance ?? 0);
        if (Number.isFinite(dist) && dist > 0) {
          riderDateDistanceMeters.set(key, (riderDateDistanceMeters.get(key) ?? 0) + dist);
        }

        if (row.otp_plus_3_performance === 'OTP Breached') {
          riderDateOtpBreached.set(key, (riderDateOtpBreached.get(key) ?? 0) + 1);
        }

        if (String(row.status ?? '').trim().toUpperCase() === 'RTO_DELIVERED') {
          riderDateBto.set(key, (riderDateBto.get(key) ?? 0) + 1);
        }
      }

      for (const [key, slots] of riderDateSlots.entries()) {
        const [normName, order_date] = key.split(':::');
        const rider_name = canonicalDisplayByNorm.get(normName) || normName;
        const orders = riderDateOrders.get(key) ?? 0;
        const distance_meters = riderDateDistanceMeters.get(key) ?? 0;
        const otp_breached_count = riderDateOtpBreached.get(key) ?? 0;
        const bto_count = riderDateBto.get(key) ?? 0;
        rawAggregated.push({
          rider_name,
          order_date,
          hours: slots.size,
          orders,
          distance_meters,
          otp_breached_count,
          bto_count,
        });
      }
    }

    // 3. Generate ALL calendar dates between startDate and endDate in requested order
    const allDatesInRange = getAllDatesInRange(startDate, endDate, dateOrder);
    const dateColumns = allDatesInRange.map((dateStr) => ({
      dateStr,
      formattedHeader: formatDateToHeader(dateStr),
    }));
    const totalPeriodDays = Math.max(dateColumns.length, 1);

    // 4. Build rider row map keyed by canonical normalized name (deduplicating e.g. 'ABHAY GORE' & 'ABHAY GORE*')
    const riderMap = new Map<
      string,
      {
        displayName: string;
        dailyMetrics: Record<string, RiderDailyMetric>;
      }
    >();

    for (const item of rawAggregated) {
      if (!item.rider_name) continue;
      const cleanName = cleanRiderDisplayName(item.rider_name);
      if (!cleanName || cleanName === '-' || cleanName.toLowerCase() === 'null') continue;
      const normKey = normalizeRiderName(cleanName);
      if (!normKey) continue;

      let entry = riderMap.get(normKey);
      if (!entry) {
        entry = {
          displayName: cleanName,
          dailyMetrics: {},
        };
        riderMap.set(normKey, entry);
      } else if (!item.rider_name.includes('*')) {
        // Prefer display name from records that did not originally carry an asterisk
        entry.displayName = cleanName;
      }

      const distMeters = item.distance_meters || 0;
      const otpBreached = item.otp_breached_count || 0;
      const btoCount = item.bto_count || 0;
      const existingMetric = entry.dailyMetrics[item.order_date];
      if (existingMetric) {
        const newMeters = (existingMetric.distanceMeters || 0) + distMeters;
        entry.dailyMetrics[item.order_date] = {
          hours: Math.min(24, existingMetric.hours + item.hours),
          orders: existingMetric.orders + item.orders,
          distanceMeters: newMeters,
          distanceKm: Math.round((newMeters / 1000) * 10) / 10,
          otpBreachedCount: (existingMetric.otpBreachedCount || 0) + otpBreached,
          btoCount: (existingMetric.btoCount || 0) + btoCount,
        };
      } else {
        entry.dailyMetrics[item.order_date] = {
          hours: item.hours,
          orders: item.orders,
          distanceMeters: distMeters,
          distanceKm: Math.round((distMeters / 1000) * 10) / 10,
          otpBreachedCount: otpBreached,
          btoCount,
        };
      }
    }

    // 5. Construct final sorted rider pivot rows
    const rows: RiderPivotRow[] = [];
    let cumulativeSumHours = 0;
    let cumulativeSumOrders = 0;
    let cumulativeSumDistanceKm = 0;

    for (const entry of riderMap.values()) {
      const riderName = entry.displayName;
      let workingDays = 0;
      let totalHours = 0;
      let totalOrders = 0;
      let totalDistanceMeters = 0;
      let otpBreachedCount = 0;
      let otpBreachedDays = 0;
      let btoCount = 0;
      let btoDays = 0;

      for (const m of Object.values(entry.dailyMetrics)) {
        if (m.orders > 0 || m.hours > 0 || (m.distanceKm && m.distanceKm > 0)) {
          workingDays += 1;
          totalHours += m.hours;
          totalOrders += m.orders;
          totalDistanceMeters += (m.distanceMeters ?? (m.distanceKm * 1000));
        }
        const dayBreaches = m.otpBreachedCount ?? 0;
        if (dayBreaches > 0) {
          otpBreachedCount += dayBreaches;
          otpBreachedDays += 1;
        }
        const dayBto = m.btoCount ?? 0;
        if (dayBto > 0) {
          btoCount += dayBto;
          btoDays += 1;
        }
      }

      // Period average: total hours/orders/km divided by the selected range days (e.g. 7 days)
      const avgHours =
        Math.round((totalHours / totalPeriodDays) * 10) / 10;
      const avgOrders =
        Math.round((totalOrders / totalPeriodDays) * 10) / 10;
      const totalDistanceKm =
        Math.round((totalDistanceMeters / 1000) * 10) / 10;
      const avgDistanceKm =
        Math.round((totalDistanceKm / totalPeriodDays) * 10) / 10;

      // Active working-days average: total divided by working days
      const activeAvgHours =
        workingDays > 0
          ? Math.round((totalHours / workingDays) * 10) / 10
          : 0;
      const activeAvgOrders =
        workingDays > 0
          ? Math.round((totalOrders / workingDays) * 10) / 10
          : 0;
      const activeAvgDistanceKm =
        workingDays > 0
          ? Math.round((totalDistanceKm / workingDays) * 10) / 10
          : 0;

      rows.push({
        riderName,
        dailyMetrics: entry.dailyMetrics,
        workingDays,
        totalHours,
        totalOrders,
        totalDistanceKm,
        otpBreachedCount,
        otpBreachedDays,
        btoCount,
        btoDays,
        avgHours,
        avgOrders,
        avgDistanceKm,
        activeAvgHours,
        activeAvgOrders,
        activeAvgDistanceKm,
      });

      cumulativeSumHours += totalHours;
      cumulativeSumOrders += totalOrders;
      cumulativeSumDistanceKm += totalDistanceKm;
    }

    // Sort riders alphabetically
    rows.sort((a, b) => a.riderName.localeCompare(b.riderName));

    const overallAvgHours =
      rows.length > 0
        ? Math.round((cumulativeSumHours / (rows.length * totalPeriodDays)) * 10) / 10
        : 0;
    const overallAvgOrders =
      rows.length > 0
        ? Math.round((cumulativeSumOrders / (rows.length * totalPeriodDays)) * 10) / 10
        : 0;
    const overallAvgDistanceKm =
      rows.length > 0
        ? Math.round((cumulativeSumDistanceKm / (rows.length * totalPeriodDays)) * 10) / 10
        : 0;
    const overallTotalDistanceKm = Math.round(cumulativeSumDistanceKm * 10) / 10;

    const ridersUnder6HoursCount = rows.filter((r) => r.activeAvgHours < 6.0).length;

    return {
      data: {
        storeId,
        startDate,
        endDate,
        periodDays: totalPeriodDays,
        dateColumns,
        rows,
        totalRiders: rows.length,
        overallAvgHours,
        overallAvgOrders,
        overallAvgDistanceKm,
        overallTotalDistanceKm,
        ridersUnder6HoursCount,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      data: null,
      error: `Failed to compute rider performance analytics: ${msg}`,
    };
  }
}

export interface RiderExportShiftMeta {
  shiftType: string;
  timings?: string;
  target8h?: string;
  onboardedBy?: string | null;
  referredBy?: string | null;
  referredPhone?: string | null;
}

export interface RiderExportExtraColumnMeta {
  otpBreachesLabel?: string;
  btoLabel?: string;
  dnrSummaryLabel?: string;
}

export interface RiderExportOptions {
  includeOtpBreachCol?: boolean;
  includeBtoCol?: boolean;
  includeDnrCol?: boolean;
  extraMetaByNameMap?: Map<string, RiderExportExtraColumnMeta>;
}

export function buildRiderPerformanceExportSheet(
  pivot: RiderPerformancePivotResult,
  storeCode: string,
  useActiveAvg = false,
  activeNamesSet?: Set<string>,
  phoneByNameMap?: Map<string, string>,
  riderShiftsMap?: Map<string, RiderExportShiftMeta>,
  options?: RiderExportOptions
): {
  sheetData: Array<Array<string | number>>;
  merges: XLSX.Range[];
  filename: string;
} {
  const includeOtpCol = Boolean(options?.includeOtpBreachCol);
  const includeBtoCol = Boolean(options?.includeBtoCol);
  const includeDnrCol = Boolean(options?.includeDnrCol);
  const extraMetaMap = options?.extraMetaByNameMap;

  // Row 1: Group headers
  const row1: string[] = [
    'Rider Name',
    'Rider Number',
    'Active',
    'Shift',
    'Timings',
    '8h Target',
    'Active Days',
    'Onboarded By',
    'Referred By',
    'Referred Mobile No',
  ];
  if (includeOtpCol) {
    row1.push('OTP Breaches');
  }
  if (includeBtoCol) {
    row1.push('BTO Orders');
  }
  if (includeDnrCol) {
    row1.push('DNR Cases');
  }
  const baseColCount = row1.length;
  const row2: string[] = Array(baseColCount).fill('');

  for (const col of pivot.dateColumns) {
    row1.push(col.formattedHeader, '', '');
    row2.push('Hours', 'Orders', 'KM');
  }

  const periodLabel = useActiveAvg
    ? 'Active Days Avg'
    : `${pivot.periodDays || pivot.dateColumns.length} Days Avg`;
  row1.push(periodLabel, '', '', 'Totals', '');
  row2.push('Hours', 'Orders', 'KM', 'Total Orders', 'Total KM');

  const sheetData: Array<Array<string | number>> = [row1, row2];

  for (const row of pivot.rows) {
    const norm = normalizeRiderName(row.riderName);
    const isActive = activeNamesSet ? activeNamesSet.has(norm) : false;
    const phone = phoneByNameMap ? phoneByNameMap.get(norm) ?? '' : '';
    const shift = riderShiftsMap?.get(norm);
    const shiftName = shift?.shiftType ?? 'Not Set';
    const shiftTimings = shift?.timings ?? '';
    const target8h = shift?.target8h ?? '—';
    const onboardedBy = shift?.onboardedBy ?? '';
    const referredBy = shift?.referredBy ?? '';
    const referredPhone = shift?.referredPhone ?? '';
    const rowVals: Array<string | number> = [
      row.riderName,
      phone,
      isActive ? 'Yes' : 'No',
      shiftName,
      shiftTimings,
      target8h,
      row.workingDays,
      onboardedBy,
      referredBy,
      referredPhone,
    ];
    if (includeOtpCol) {
      const customOtp = extraMetaMap?.get(norm)?.otpBreachesLabel;
      const bCount = row.otpBreachedCount ?? 0;
      const bDays = row.otpBreachedDays ?? 0;
      rowVals.push(customOtp ?? (bCount > 0 ? `${bCount} (${bDays}d)` : '0'));
    }
    if (includeBtoCol) {
      const customBto = extraMetaMap?.get(norm)?.btoLabel;
      const btoCount = row.btoCount ?? 0;
      const btoDays = row.btoDays ?? 0;
      rowVals.push(customBto ?? (btoCount > 0 ? `${btoCount} (${btoDays}d)` : '0'));
    }
    if (includeDnrCol) {
      rowVals.push(extraMetaMap?.get(norm)?.dnrSummaryLabel ?? '0');
    }

    for (const col of pivot.dateColumns) {
      const metric = row.dailyMetrics[col.dateStr];
      if (metric && (metric.orders > 0 || metric.hours > 0 || metric.distanceKm > 0)) {
        rowVals.push(metric.hours, metric.orders, metric.distanceKm > 0 ? metric.distanceKm : 0);
      } else {
        rowVals.push('', '', '');
      }
    }

    const avgH = useActiveAvg ? row.activeAvgHours : row.avgHours;
    const avgO = useActiveAvg ? row.activeAvgOrders : row.avgOrders;
    const avgD = useActiveAvg ? row.activeAvgDistanceKm : row.avgDistanceKm;
    rowVals.push(avgH, avgO, avgD, row.totalOrders, row.totalDistanceKm);
    sheetData.push(rowVals);
  }

  // Set merge ranges for top-tier headers
  const merges: XLSX.Range[] = [];
  let colIdx = baseColCount;
  for (let i = 0; i < pivot.dateColumns.length; i++) {
    merges.push({
      s: { r: 0, c: colIdx },
      e: { r: 0, c: colIdx + 2 },
    });
    colIdx += 3;
  }
  // Merge for the Avg column (3 sub-columns: Hours, Orders, KM)
  merges.push({
    s: { r: 0, c: colIdx },
    e: { r: 0, c: colIdx + 2 },
  });
  colIdx += 3;
  // Merge for Totals column (2 sub-columns: Total Orders, Total KM)
  merges.push({
    s: { r: 0, c: colIdx },
    e: { r: 0, c: colIdx + 1 },
  });

  const filename = `Rider_Performance_${storeCode}_${pivot.startDate}_to_${pivot.endDate}.xlsx`;
  return { sheetData, merges, filename };
}

/**
 * Exports the Rider Performance Pivot Table to a formatted Excel workbook (.xlsx).
 */
export function exportRiderPerformanceToExcel(
  pivot: RiderPerformancePivotResult,
  storeCode: string,
  useActiveAvg = false,
  activeNamesSet?: Set<string>,
  phoneByNameMap?: Map<string, string>,
  riderShiftsMap?: Map<string, RiderExportShiftMeta>,
  options?: RiderExportOptions
): void {
  const wb = XLSX.utils.book_new();
  const { sheetData, merges, filename } = buildRiderPerformanceExportSheet(
    pivot,
    storeCode,
    useActiveAvg,
    activeNamesSet,
    phoneByNameMap,
    riderShiftsMap,
    options
  );

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!merges'] = merges;

  XLSX.utils.book_append_sheet(wb, ws, 'Rider Performance');
  XLSX.writeFile(wb, filename);
}

export interface Under6HoursReportRow {
  riderName: string;
  avgHours: number;
  loginTimeLabel: string;
  totalOrders: number;
}

/**
 * Formats period-average login hours cleanly for the <=6h performance list
 * (e.g. 1 -> "1 hr", 2 -> "2 hrs", 2.5 -> "2.5 hrs").
 */
export function formatUnder6HoursLoginTime(hours: number): string {
  const safeHours = Number.isFinite(hours) ? Math.max(0, Math.round(hours * 10) / 10) : 0;
  if (safeHours === 1) {
    return '1 hr';
  }
  const numericStr = Number.isInteger(safeHours) ? String(safeHours) : safeHours.toFixed(1);
  return `${numericStr} hrs`;
}

/**
 * Filters Rider Performance rows to riders with period average login time <= 6 hours,
 * sorted by total orders ascending (then avg hours ascending, then rider name).
 */
export function buildUnder6HoursReportRows(rows: RiderPivotRow[]): Under6HoursReportRow[] {
  return rows
    .filter((row) => row.avgHours <= 6.0)
    .slice()
    .sort((a, b) => {
      const ordersDiff = a.totalOrders - b.totalOrders;
      if (ordersDiff !== 0) return ordersDiff;
      const hoursDiff = a.avgHours - b.avgHours;
      if (hoursDiff !== 0) return hoursDiff;
      return a.riderName.localeCompare(b.riderName);
    })
    .map((row) => ({
      riderName: row.riderName,
      avgHours: row.avgHours,
      loginTimeLabel: formatUnder6HoursLoginTime(row.avgHours),
      totalOrders: row.totalOrders,
    }));
}

export interface DelayedOrdersReportRow {
  riderName: string;
  delayedOrders: number;
  delayedDays: number;
}

const FULL_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseIsoParts(dateStr: string): { year: number; monthName: string; day: number } | null {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [year, month, day] = parts;
  const monthName = FULL_MONTH_NAMES[month - 1];
  if (!monthName || day < 1 || day > 31) {
    return null;
  }
  return { year, monthName, day };
}

/**
 * Formats an ISO date range for display headers (e.g. "20 November – 26 November 2026" or "26 November 2026").
 */
export function formatHumanReportPeriod(startDate: string, endDate: string): string {
  const start = parseIsoParts(startDate);
  const end = parseIsoParts(endDate);
  if (!start || !end) {
    return startDate === endDate ? startDate : `${startDate} – ${endDate}`;
  }
  if (startDate === endDate) {
    return `${start.day} ${start.monthName} ${start.year}`;
  }
  if (start.year === end.year) {
    return `${start.day} ${start.monthName} – ${end.day} ${end.monthName} ${end.year}`;
  }
  return `${start.day} ${start.monthName} ${start.year} – ${end.day} ${end.monthName} ${end.year}`;
}

/**
 * Filters Rider Performance rows to riders with >= 1 delayed (OTP breached) order,
 * sorted highest-to-lowest by delayed orders (then breached days descending, then rider name).
 */
export function buildDelayedOrdersReportRows(rows: RiderPivotRow[]): DelayedOrdersReportRow[] {
  return rows
    .filter((row) => (row.otpBreachedCount ?? 0) >= 1)
    .map((row) => {
      const delayedOrders = row.otpBreachedCount ?? 0;
      const delayedDays = row.otpBreachedDays ?? (delayedOrders > 0 ? 1 : 0);
      return {
        riderName: row.riderName,
        delayedOrders,
        delayedDays,
      };
    })
    .sort((a, b) => {
      const ordersDiff = b.delayedOrders - a.delayedOrders;
      if (ordersDiff !== 0) return ordersDiff;
      const daysDiff = b.delayedDays - a.delayedDays;
      if (daysDiff !== 0) return daysDiff;
      return a.riderName.localeCompare(b.riderName);
    });
}
