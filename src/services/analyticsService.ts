// ==============================================================================
// Rider Performance Analytics Service
// Aggregates rider hours (COUNTUNIQUE slot_hour) and orders (COUNTA order_id)
// over selectable date ranges with working-day cumulative averages and Excel export.
// ==============================================================================

import * as XLSX from 'xlsx';
import { supabase } from '../config/supabaseClient';

export interface RiderDailyMetric {
  hours: number;
  orders: number;
}

export interface RiderPivotRow {
  riderName: string;
  dailyMetrics: Record<string, RiderDailyMetric>; // dateStr -> { hours, orders }
  workingDays: number;
  totalHours: number;
  totalOrders: number;
  avgHours: number; // Period average (totalHours / periodDays)
  avgOrders: number; // Period average (totalOrders / periodDays)
  activeAvgHours: number; // Active-working-days average (totalHours / workingDays)
  activeAvgOrders: number; // Active-working-days average (totalOrders / workingDays)
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
    const d = new Date(t);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    result.push(`${yyyy}-${mm}-${dd}`);
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

        rpcRanSuccessfully = true;

        if (Array.isArray(rpcData) && rpcData.length > 0) {
          for (const item of rpcData) {
            rpcRows.push({
              rider_name: String(item.rider_name || '').trim(),
              order_date: String(item.order_date),
              hours: Number(item.hours || 0),
              orders: Number(item.orders || 0),
            });
          }
          if (rpcData.length < RPC_PAGE_SIZE) {
            rpcHasMore = false;
          } else {
            rpcFrom += RPC_PAGE_SIZE;
          }
        } else {
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
      }> = [];

      while (hasMore) {
        const { data: pageRows, error: ordersError } = await supabase
          .from('orders')
          .select('rider_name, slot_hour, order_date, order_id')
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

      // Group by (rider_name, order_date) and compute COUNTUNIQUE(slot_hour) & COUNT(order_id)
      const riderDateSlots = new Map<string, Set<number>>();
      const riderDateOrders = new Map<string, number>();

      for (const row of orderRows) {
        const rawName = row.rider_name;
        if (!rawName || typeof rawName !== 'string') continue;
        const name = rawName.trim();
        if (!name || name === '-' || name.toLowerCase() === 'null') continue;

        const date = String(row.order_date);
        const slot = Number(row.slot_hour);
        const key = `${name}:::${date}`;

        if (!riderDateSlots.has(key)) {
          riderDateSlots.set(key, new Set<number>());
        }
        if (Number.isFinite(slot) && slot >= 0 && slot <= 23) {
          riderDateSlots.get(key)!.add(slot);
        }

        riderDateOrders.set(key, (riderDateOrders.get(key) ?? 0) + 1);
      }

      for (const [key, slots] of riderDateSlots.entries()) {
        const [rider_name, order_date] = key.split(':::');
        const orders = riderDateOrders.get(key) ?? 0;
        rawAggregated.push({
          rider_name,
          order_date,
          hours: slots.size,
          orders,
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

    // 4. Build rider row map
    const riderMap = new Map<
      string,
      {
        dailyMetrics: Record<string, RiderDailyMetric>;
        workingDays: number;
        totalHours: number;
        totalOrders: number;
      }
    >();

    for (const item of rawAggregated) {
      if (!item.rider_name) continue;
      let entry = riderMap.get(item.rider_name);
      if (!entry) {
        entry = {
          dailyMetrics: {},
          workingDays: 0,
          totalHours: 0,
          totalOrders: 0,
        };
        riderMap.set(item.rider_name, entry);
      }

      entry.dailyMetrics[item.order_date] = {
        hours: item.hours,
        orders: item.orders,
      };

      if (item.orders > 0 || item.hours > 0) {
        entry.workingDays += 1;
        entry.totalHours += item.hours;
        entry.totalOrders += item.orders;
      }
    }

    // 5. Construct final sorted rider pivot rows
    const rows: RiderPivotRow[] = [];
    let cumulativeSumHours = 0;
    let cumulativeSumOrders = 0;

    for (const [riderName, entry] of riderMap.entries()) {
      // Period average: total hours/orders divided by the selected range days (e.g. 7 days)
      const avgHours =
        Math.round((entry.totalHours / totalPeriodDays) * 10) / 10;
      const avgOrders =
        Math.round((entry.totalOrders / totalPeriodDays) * 10) / 10;

      // Active working-days average: total divided by working days
      const activeAvgHours =
        entry.workingDays > 0
          ? Math.round((entry.totalHours / entry.workingDays) * 10) / 10
          : 0;
      const activeAvgOrders =
        entry.workingDays > 0
          ? Math.round((entry.totalOrders / entry.workingDays) * 10) / 10
          : 0;

      rows.push({
        riderName,
        dailyMetrics: entry.dailyMetrics,
        workingDays: entry.workingDays,
        totalHours: entry.totalHours,
        totalOrders: entry.totalOrders,
        avgHours,
        avgOrders,
        activeAvgHours,
        activeAvgOrders,
      });

      cumulativeSumHours += entry.totalHours;
      cumulativeSumOrders += entry.totalOrders;
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

/**
 * Exports the Rider Performance Pivot Table to a formatted Excel workbook (.xlsx).
 */
export function exportRiderPerformanceToExcel(
  pivot: RiderPerformancePivotResult,
  storeCode: string,
  useActiveAvg = false,
  activeNamesSet?: Set<string>,
  phoneByNameMap?: Map<string, string>,
  riderShiftsMap?: Map<string, { shiftType: string; timings?: string }>
): void {
  const wb = XLSX.utils.book_new();

  // Row 1: Group headers
  // [Rider Name, Rider Number, Active, Shift, Timings, Date1, '', Date2, '', ... Avg, '']
  const row1: string[] = ['Rider Name', 'Rider Number', 'Active', 'Shift', 'Timings'];
  const row2: string[] = ['', '', '', '', ''];

  for (const col of pivot.dateColumns) {
    row1.push(col.formattedHeader, '');
    row2.push('Hours', 'Orders');
  }

  const periodLabel = useActiveAvg ? 'Active Days Avg' : `${pivot.dateColumns.length} Days Avg`;
  row1.push(periodLabel, '');
  row2.push('Hours', 'Orders');

  const sheetData: Array<Array<string | number>> = [row1, row2];

  for (const row of pivot.rows) {
    const norm = row.riderName.trim().toLowerCase().replace(/\s+/g, ' ');
    const isActive = activeNamesSet ? activeNamesSet.has(norm) : true;
    const phone = phoneByNameMap ? phoneByNameMap.get(norm) ?? '' : '';
    const shift = riderShiftsMap?.get(norm);
    const shiftName = shift?.shiftType ?? 'Not Set';
    const shiftTimings = shift?.timings ?? '';
    const rowVals: Array<string | number> = [
      row.riderName,
      phone,
      isActive ? 'Yes' : 'No',
      shiftName,
      shiftTimings,
    ];

    for (const col of pivot.dateColumns) {
      const metric = row.dailyMetrics[col.dateStr];
      if (metric && (metric.orders > 0 || metric.hours > 0)) {
        rowVals.push(metric.hours, metric.orders);
      } else {
        rowVals.push('', '');
      }
    }

    const avgH = useActiveAvg ? row.activeAvgHours : row.avgHours;
    const avgO = useActiveAvg ? row.activeAvgOrders : row.avgOrders;
    rowVals.push(avgH, avgO);
    sheetData.push(rowVals);
  }

  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Set merge ranges for top-tier headers
  const merges: XLSX.Range[] = [];
  let colIdx = 5;
  for (let i = 0; i < pivot.dateColumns.length; i++) {
    merges.push({
      s: { r: 0, c: colIdx },
      e: { r: 0, c: colIdx + 1 },
    });
    colIdx += 2;
  }
  // Merge for the Avg column
  merges.push({
    s: { r: 0, c: colIdx },
    e: { r: 0, c: colIdx + 1 },
  });

  ws['!merges'] = merges;

  XLSX.utils.book_append_sheet(wb, ws, 'Rider Performance');
  const filename = `Rider_Performance_${storeCode}_${pivot.startDate}_to_${pivot.endDate}.xlsx`;
  XLSX.writeFile(wb, filename);
}
