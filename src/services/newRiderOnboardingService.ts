// ==============================================================================
// New Rider Onboarding Service
// Tracks new delivery partners across their FIRST 7 CALENDAR DAYS of joining.
// Supports hybrid detection: automatic earliest order date with manual shift override.
// Evaluates daily hours (COUNTUNIQUE slot), orders (COUNTA), and 8h target compliance.
// ==============================================================================

import * as XLSX from 'xlsx';
import { supabase } from '../config/supabaseClient';
import { normalizeRiderName } from './activeRiderService';
import { type RiderShiftConfig, formatShiftTimings } from './riderShiftService';

export interface RiderDayMetric {
  dayNumber: number; // 1 to 7
  dateStr: string;   // 'YYYY-MM-DD'
  formattedDate: string; // '18-Oct'
  dayOfWeek: string; // 'Sat'
  hours: number;
  orders: number;
  isCompliant8h: boolean;
  status: 'COMPLIANT' | 'UNDER_8H' | 'ABSENT' | 'TODAY' | 'UPCOMING';
}

export interface NewRiderOnboardingRecord {
  riderName: string;
  normalizedName: string;
  phone: string | null;
  shiftType: string;
  shiftTimings: string;
  joiningDate: string; // YYYY-MM-DD (Day 1)
  isManualJoiningDate: boolean;
  endDate: string;     // YYYY-MM-DD (Day 7 = joiningDate + 6 days)
  calendarDaysElapsed: number; // 1 to 7
  activeDaysWorked: number;    // days where hours > 0
  totalHours: number;
  totalOrders: number;
  avgHours: number;
  avgOrders: number;
  compliantDaysCount: number;
  complianceRate: number;      // %
  onboardingStatus: 'ACTIVE_WEEK_1' | 'COMPLETED_WEEK_1';
  healthStatus: 'ON_TRACK' | 'NEEDS_ATTENTION' | 'AT_RISK';
  days: RiderDayMetric[];      // exactly 7 items: Day 1 through Day 7
}

export interface NewRiderOnboardingSummary {
  storeId: string;
  storeCode: string;
  storeName: string;
  cohortWindowDays: number;
  totalNewRiders: number;
  activeWeek1Count: number;
  completedWeek1Count: number;
  overallComplianceRate: number;
  overallAvgHours: number;
  overallAvgOrders: number;
  atRiskCount: number;
  riders: NewRiderOnboardingRecord[];
}

/**
 * Returns the 7 consecutive calendar dates (YYYY-MM-DD) starting from startDate.
 */
export function getFirst7CalendarDates(startDate: string): string[] {
  const [y, m, d] = startDate.split('-').map(Number);
  const startUtc = Date.UTC(y, m - 1, d, 12, 0, 0);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const t = startUtc + i * 86400000;
    const cur = new Date(t);
    const cY = cur.getUTCFullYear();
    const cM = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const cD = String(cur.getUTCDate()).padStart(2, '0');
    dates.push(`${cY}-${cM}-${cD}`);
  }
  return dates;
}

/**
 * Formats YYYY-MM-DD into "DD-MMM" (e.g. "2026-10-18" -> "18-Oct").
 */
export function formatDayHeader(dateStr: string): string {
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
 * Returns short day of week for a YYYY-MM-DD string in UTC (e.g. 'Sat', 'Sun').
 */
export function getDayOfWeekName(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[dt.getUTCDay()] || '';
}

/**
 * Calculates current date string in specific time zone (e.g. '2026-10-24').
 */
export function getTodayDateString(timeZone: string = 'Asia/Kolkata'): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(new Date());
}

/**
 * Fetches and builds the 7-day onboarding analytics for new riders of a store.
 */
export async function fetchNewRiderOnboardingAnalytics(params: {
  storeId: string;
  storeCode: string;
  storeName: string;
  cohortWindowDays?: number; // default 7 days
  timeZone?: string;
  shiftsMap?: Map<string, RiderShiftConfig>;
  phoneByNameMap?: Map<string, string>;
}): Promise<{
  data: NewRiderOnboardingSummary | null;
  error?: string;
}> {
  const {
    storeId,
    storeCode,
    storeName,
    cohortWindowDays = 7,
    timeZone = 'Asia/Kolkata',
    shiftsMap,
    phoneByNameMap,
  } = params;

  try {
    const todayStr = getTodayDateString(timeZone);

    // 1. Calculate cohort cutoff date (e.g. 14 days ago)
    const [tY, tM, tD] = todayStr.split('-').map(Number);
    const todayUtc = Date.UTC(tY, tM - 1, tD, 12, 0, 0);
    const cutoffUtc = todayUtc - cohortWindowDays * 86400000;
    const cDate = new Date(cutoffUtc);
    const cutoffStr = `${cDate.getUTCFullYear()}-${String(cDate.getUTCMonth() + 1).padStart(2, '0')}-${String(cDate.getUTCDate()).padStart(2, '0')}`;

    // 2. Fast Aggregation: Fetch daily performance ONLY for the last 14 days (cutoffStr to todayStr)
    // normName -> dateStr -> { hours, orders }
    const riderDailyMap = new Map<string, Map<string, { hours: number; orders: number }>>();
    const candidateRiderNames = new Map<string, string>(); // normName -> originalDisplayName
    let dailyMetricsLoaded = false;

    // Try fast server-side RPC get_rider_daily_performance (already installed in Postgres)
    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        'get_rider_daily_performance',
        {
          p_store_id: storeId,
          p_start_date: cutoffStr,
          p_end_date: todayStr,
        }
      );

      if (!rpcErr && Array.isArray(rpcData) && rpcData.length > 0) {
        for (const row of rpcData) {
          const rawName = String(row.rider_name || '').trim();
          if (!rawName) continue;
          const norm = normalizeRiderName(rawName);
          if (!norm) continue;

          candidateRiderNames.set(norm, rawName);

          let dateMap = riderDailyMap.get(norm);
          if (!dateMap) {
            dateMap = new Map();
            riderDailyMap.set(norm, dateMap);
          }

          const dateStr = String(row.order_date).slice(0, 10);
          dateMap.set(dateStr, {
            hours: Number(row.hours || 0),
            orders: Number(row.orders || 0),
          });
        }
        dailyMetricsLoaded = true;
      }
    } catch {
      dailyMetricsLoaded = false;
    }

    // Fallback: If RPC not present, query orders table with strict index filter (.gte('order_date', cutoffStr))
    if (!dailyMetricsLoaded) {
      const PAGE_SIZE = 1000;
      let from = 0;
      let hasMore = true;
      const rawHourSets = new Map<string, Map<string, { hours: Set<number>; orders: number }>>();

      while (hasMore) {
        const { data: pageRows, error: ordersErr } = await supabase
          .from('orders')
          .select('rider_name, slot_hour, order_date, order_id')
          .eq('store_id', storeId)
          .gte('order_date', cutoffStr)
          .lte('order_date', todayStr)
          .range(from, from + PAGE_SIZE - 1);

        if (ordersErr) {
          if (from === 0) {
            return { data: null, error: `Failed to load order records: ${ordersErr.message}` };
          }
          break;
        }

        if (Array.isArray(pageRows) && pageRows.length > 0) {
          for (const row of pageRows) {
            if (!row.rider_name) continue;
            const norm = normalizeRiderName(row.rider_name);
            if (!norm) continue;

            candidateRiderNames.set(norm, row.rider_name);

            let dateMap = rawHourSets.get(norm);
            if (!dateMap) {
              dateMap = new Map();
              rawHourSets.set(norm, dateMap);
            }

            let metric = dateMap.get(row.order_date);
            if (!metric) {
              metric = { hours: new Set<number>(), orders: 0 };
              dateMap.set(row.order_date, metric);
            }

            metric.hours.add(Number(row.slot_hour));
            metric.orders += 1;
          }

          if (pageRows.length < PAGE_SIZE) {
            hasMore = false;
          } else {
            from += PAGE_SIZE;
          }
        } else {
          hasMore = false;
        }
      }

      // Convert Set sizes to hours
      for (const [norm, dateMap] of rawHourSets.entries()) {
        const converted = new Map<string, { hours: number; orders: number }>();
        for (const [dateStr, val] of dateMap.entries()) {
          converted.set(dateStr, {
            hours: val.hours.size,
            orders: val.orders,
          });
        }
        riderDailyMap.set(norm, converted);
      }
    }

    // 3. Fast Verification: Check which candidates are genuinely NEW (started >= cutoffStr)
    // Step A: Check RPC get_store_riders_first_dates if installed
    const riderFirstDates = new Map<string, string>();
    let firstDatesLoaded = false;

    try {
      const { data: rpcRows, error: rpcErr } = await supabase.rpc(
        'get_store_riders_first_dates',
        { p_store_id: storeId }
      );
      if (!rpcErr && Array.isArray(rpcRows) && rpcRows.length > 0) {
        for (const r of rpcRows) {
          const norm = normalizeRiderName(r.rider_name);
          if (norm && r.first_active_date) {
            riderFirstDates.set(norm, String(r.first_active_date).slice(0, 10));
          }
        }
        firstDatesLoaded = true;
      }
    } catch {
      firstDatesLoaded = false;
    }

    // Step B: If first_dates RPC is not installed, verify candidates by querying if they had prior orders (< cutoffStr)
    // Any candidate who had an order before cutoffStr is an existing/veteran rider.
    const veteranRiders = new Set<string>();

    if (!firstDatesLoaded) {
      const candidatesToCheck: string[] = [];
      for (const norm of candidateRiderNames.keys()) {
        const manualJoin = shiftsMap?.get(norm)?.joiningDate;
        if (!manualJoin) {
          const origName = candidateRiderNames.get(norm);
          if (origName) candidatesToCheck.push(origName);
        }
      }

      if (candidatesToCheck.length > 0) {
        // Query in concurrent chunks of 40 to avoid postgREST URL limits
        const CHUNK_SIZE = 40;
        const chunks: string[][] = [];
        for (let i = 0; i < candidatesToCheck.length; i += CHUNK_SIZE) {
          chunks.push(candidatesToCheck.slice(i, i + CHUNK_SIZE));
        }

        const priorChecks = await Promise.all(
          chunks.map((chunk) =>
            supabase
              .from('orders')
              .select('rider_name')
              .eq('store_id', storeId)
              .lt('order_date', cutoffStr)
              .in('rider_name', chunk)
              .limit(500)
          )
        );

        for (const res of priorChecks) {
          if (Array.isArray(res.data)) {
            for (const row of res.data) {
              if (row.rider_name) {
                veteranRiders.add(normalizeRiderName(row.rider_name));
              }
            }
          }
        }
      }
    }

    // Collect all candidate rider norms
    const allRiderNorms = new Set<string>();
    for (const norm of candidateRiderNames.keys()) {
      allRiderNorms.add(norm);
    }
    if (shiftsMap) {
      for (const [norm, cfg] of shiftsMap.entries()) {
        if (cfg.joiningDate && cfg.joiningDate >= cutoffStr) {
          allRiderNorms.add(norm);
        }
      }
    }

    const onboardingRecords: NewRiderOnboardingRecord[] = [];

    for (const norm of allRiderNorms) {
      const shiftConfig = shiftsMap?.get(norm);
      const isManual = Boolean(shiftConfig?.joiningDate);

      let effectiveStartDate: string | undefined;

      if (isManual) {
        effectiveStartDate = shiftConfig?.joiningDate || undefined;
      } else if (firstDatesLoaded) {
        effectiveStartDate = riderFirstDates.get(norm);
      } else {
        // If they had orders before cutoffStr, they are a veteran rider, so skip!
        if (veteranRiders.has(norm)) {
          continue;
        }
        // Otherwise, their first date is the earliest order date in the last 14 days
        const dateMap = riderDailyMap.get(norm);
        if (dateMap && dateMap.size > 0) {
          const sortedDates = Array.from(dateMap.keys()).sort();
          effectiveStartDate = sortedDates[0];
        }
      }

      if (!effectiveStartDate) continue;
      effectiveStartDate = effectiveStartDate.slice(0, 10);

      // Only include riders who joined new in the selected cohort window (last 14 days)
      const isWithinCohortWindow = effectiveStartDate >= cutoffStr;
      if (!isWithinCohortWindow) {
        continue;
      }

      // Compute first 7 calendar dates
      const sevenDates = getFirst7CalendarDates(effectiveStartDate);
      const endDate = sevenDates[6]; // Day 7

      // Determine rider display name
      const riderName =
        shiftConfig?.riderName ||
        candidateRiderNames.get(norm) ||
        norm.toUpperCase();

      const phone = phoneByNameMap?.get(norm) ?? null;
      const shiftType = shiftConfig?.shiftType || 'Morning Shift';
      const shiftTimings = shiftConfig ? formatShiftTimings(shiftConfig) : '6 AM – 2 PM';

      // Build daily metric objects
      const riderDateMap = riderDailyMap.get(norm);
      let totalHours = 0;
      let totalOrders = 0;
      let activeDaysWorked = 0;
      let compliantDaysCount = 0;
      let consecutiveAbsent = 0;
      let maxConsecutiveAbsent = 0;

      const daysMetrics: RiderDayMetric[] = [];

      for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        const dateStr = sevenDates[dayIdx];
        const formattedDate = formatDayHeader(dateStr);
        const dayOfWeek = getDayOfWeekName(dateStr);

        const metric = riderDateMap?.get(dateStr);
        const hours = metric ? metric.hours : 0;
        const orders = metric ? metric.orders : 0;
        const isCompliant8h = hours >= 8.0;

        let status: 'COMPLIANT' | 'UNDER_8H' | 'ABSENT' | 'TODAY' | 'UPCOMING';

        if (dateStr < todayStr) {
          if (isCompliant8h) {
            status = 'COMPLIANT';
            consecutiveAbsent = 0;
          } else if (hours > 0) {
            status = 'UNDER_8H';
            consecutiveAbsent = 0;
          } else {
            status = 'ABSENT';
            consecutiveAbsent += 1;
            if (consecutiveAbsent > maxConsecutiveAbsent) {
              maxConsecutiveAbsent = consecutiveAbsent;
            }
          }
        } else if (dateStr === todayStr) {
          status = isCompliant8h ? 'COMPLIANT' : 'TODAY';
        } else {
          status = 'UPCOMING';
        }

        if (hours > 0) {
          activeDaysWorked += 1;
        }
        if (isCompliant8h) {
          compliantDaysCount += 1;
        }

        totalHours += hours;
        totalOrders += orders;

        daysMetrics.push({
          dayNumber: dayIdx + 1,
          dateStr,
          formattedDate,
          dayOfWeek,
          hours,
          orders,
          isCompliant8h,
          status,
        });
      }

      // Calculate calendar days elapsed so far (1 to 7)
      let calendarDaysElapsed = 0;
      for (const d of sevenDates) {
        if (d <= todayStr) {
          calendarDaysElapsed += 1;
        }
      }
      calendarDaysElapsed = Math.max(1, Math.min(7, calendarDaysElapsed));

      const avgHours =
        calendarDaysElapsed > 0
          ? Math.round((totalHours / calendarDaysElapsed) * 10) / 10
          : 0;
      const avgOrders =
        calendarDaysElapsed > 0
          ? Math.round((totalOrders / calendarDaysElapsed) * 10) / 10
          : 0;
      const complianceRate =
        calendarDaysElapsed > 0
          ? Math.round((compliantDaysCount / calendarDaysElapsed) * 100)
          : 0;

      const onboardingStatus: 'ACTIVE_WEEK_1' | 'COMPLETED_WEEK_1' =
        todayStr <= endDate ? 'ACTIVE_WEEK_1' : 'COMPLETED_WEEK_1';

      // Health status calculation:
      // At Risk if:
      // 1. Inactive/absent for 2+ consecutive days in past
      // 2. Or 0 active days worked while >= 3 days elapsed
      let healthStatus: 'ON_TRACK' | 'NEEDS_ATTENTION' | 'AT_RISK';
      if (maxConsecutiveAbsent >= 2 || (calendarDaysElapsed >= 3 && activeDaysWorked === 0)) {
        healthStatus = 'AT_RISK';
      } else if (avgHours >= 8.0 || compliantDaysCount >= Math.ceil(calendarDaysElapsed * 0.7)) {
        healthStatus = 'ON_TRACK';
      } else {
        healthStatus = 'NEEDS_ATTENTION';
      }

      onboardingRecords.push({
        riderName,
        normalizedName: norm,
        phone,
        shiftType,
        shiftTimings,
        joiningDate: effectiveStartDate,
        isManualJoiningDate: isManual,
        endDate,
        calendarDaysElapsed,
        activeDaysWorked,
        totalHours,
        totalOrders,
        avgHours,
        avgOrders,
        compliantDaysCount,
        complianceRate,
        onboardingStatus,
        healthStatus,
        days: daysMetrics,
      });
    }

    // Sort by joiningDate descending (newest joiners at top)
    onboardingRecords.sort((a, b) => {
      const cmp = b.joiningDate.localeCompare(a.joiningDate);
      if (cmp !== 0) return cmp;
      return a.riderName.localeCompare(b.riderName);
    });

    // Store-level summary
    const totalNewRiders = onboardingRecords.length;
    const activeWeek1Count = onboardingRecords.filter(
      (r) => r.onboardingStatus === 'ACTIVE_WEEK_1'
    ).length;
    const completedWeek1Count = onboardingRecords.filter(
      (r) => r.onboardingStatus === 'COMPLETED_WEEK_1'
    ).length;
    const atRiskCount = onboardingRecords.filter(
      (r) => r.healthStatus === 'AT_RISK'
    ).length;

    const totalHoursSum = onboardingRecords.reduce((acc, r) => acc + r.totalHours, 0);
    const totalOrdersSum = onboardingRecords.reduce((acc, r) => acc + r.totalOrders, 0);
    const totalDaysElapsedSum = onboardingRecords.reduce(
      (acc, r) => acc + r.calendarDaysElapsed,
      0
    );
    const totalCompliantDays = onboardingRecords.reduce(
      (acc, r) => acc + r.compliantDaysCount,
      0
    );

    const overallAvgHours =
      totalDaysElapsedSum > 0
        ? Math.round((totalHoursSum / totalDaysElapsedSum) * 10) / 10
        : 0;
    const overallAvgOrders =
      totalDaysElapsedSum > 0
        ? Math.round((totalOrdersSum / totalDaysElapsedSum) * 10) / 10
        : 0;
    const overallComplianceRate =
      totalDaysElapsedSum > 0
        ? Math.round((totalCompliantDays / totalDaysElapsedSum) * 100)
        : 0;

    return {
      data: {
        storeId,
        storeCode,
        storeName,
        cohortWindowDays,
        totalNewRiders,
        activeWeek1Count,
        completedWeek1Count,
        overallComplianceRate,
        overallAvgHours,
        overallAvgOrders,
        atRiskCount,
        riders: onboardingRecords,
      },
    };
  } catch (err) {
    return {
      data: null,
      error: `Error computing new rider onboarding analytics: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

/**
 * Exports the New Rider First 7 Days Onboarding Report to an Excel workbook.
 */
export function exportNewRidersToExcel(
  summary: NewRiderOnboardingSummary,
  filenamePrefix: string = 'New_Rider_Onboarding'
): void {
  const wb = XLSX.utils.book_new();

  const headers = [
    'Rider Name',
    'Rider Number',
    'Assigned Shift',
    'Shift Timings',
    'Joining Date (Day 1)',
    'Onboarding Status',
    'Health Status',
    'Day 1 Date',
    'Day 1 Hours',
    'Day 1 Orders',
    'Day 2 Date',
    'Day 2 Hours',
    'Day 2 Orders',
    'Day 3 Date',
    'Day 3 Hours',
    'Day 3 Orders',
    'Day 4 Date',
    'Day 4 Hours',
    'Day 4 Orders',
    'Day 5 Date',
    'Day 5 Hours',
    'Day 5 Orders',
    'Day 6 Date',
    'Day 6 Hours',
    'Day 6 Orders',
    'Day 7 Date',
    'Day 7 Hours',
    'Day 7 Orders',
    'Total Week 1 Hours',
    'Total Week 1 Orders',
    'Avg Daily Hours',
    'Avg Daily Orders',
    '8h Target Met Days',
    '8h Compliance Rate %',
  ];

  const rows = summary.riders.map((r) => {
    const rowData: (string | number)[] = [
      r.riderName,
      r.phone || '—',
      r.shiftType,
      r.shiftTimings,
      r.joiningDate,
      r.onboardingStatus === 'ACTIVE_WEEK_1' ? 'Active (Week 1)' : 'Completed (Week 1)',
      r.healthStatus === 'ON_TRACK'
        ? 'On Track'
        : r.healthStatus === 'AT_RISK'
        ? 'At-Risk (Drop-Off)'
        : 'Needs Attention (< 8h)',
    ];

    for (const d of r.days) {
      rowData.push(d.formattedDate);
      rowData.push(d.hours > 0 ? d.hours : 0);
      rowData.push(d.orders > 0 ? d.orders : 0);
    }

    rowData.push(r.totalHours);
    rowData.push(r.totalOrders);
    rowData.push(r.avgHours);
    rowData.push(r.avgOrders);
    rowData.push(`${r.compliantDaysCount} / ${r.calendarDaysElapsed}`);
    rowData.push(`${r.complianceRate}%`);

    return rowData;
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Set column widths
  ws['!cols'] = [
    { wch: 24 }, // Name
    { wch: 15 }, // Phone
    { wch: 16 }, // Shift
    { wch: 22 }, // Timings
    { wch: 14 }, // Joining Date
    { wch: 18 }, // Status
    { wch: 20 }, // Health
    // Days
    { wch: 11 }, { wch: 10 }, { wch: 10 },
    { wch: 11 }, { wch: 10 }, { wch: 10 },
    { wch: 11 }, { wch: 10 }, { wch: 10 },
    { wch: 11 }, { wch: 10 }, { wch: 10 },
    { wch: 11 }, { wch: 10 }, { wch: 10 },
    { wch: 11 }, { wch: 10 }, { wch: 10 },
    { wch: 11 }, { wch: 10 }, { wch: 10 },
    // Summary
    { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 18 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'New Rider Onboarding');

  const filename = `${filenamePrefix}_${summary.storeCode}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}
