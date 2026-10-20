// ==============================================================================
// Store Master Service
// Loads active stores and 30-day data ingestion coverage via Supabase Data API.
// ==============================================================================

import { supabase } from '../config/supabaseClient';
import type { StoreMaster } from '../domain/types';

export interface DayCoverage {
  dateStr: string; // 'YYYY-MM-DD'
  dayNumber: number; // 1..31
  dayOfWeek: string; // 'Mon', 'Tue'
  monthShort: string; // 'Oct'
  formattedDate: string; // '19 Oct 2026'
  isUploaded: boolean;
  orderCount?: number;
  lastUploadedAt?: string;
}

export interface StoreCoverageSummary {
  days: DayCoverage[];
  totalDays: number;
  uploadedCount: number;
  missingCount: number;
}

export async function fetchActiveStores(): Promise<{
  stores: StoreMaster[];
  error?: string;
}> {
  const { data, error } = await supabase
    .from('stores')
    .select('id, store_code, store_name, external_store_id, timezone, is_active')
    .eq('is_active', true)
    .order('store_code', { ascending: true });

  if (error) {
    return {
      stores: [],
      error: `Failed to load active stores: ${error.message}`,
    };
  }

  return {
    stores: (data ?? []) as StoreMaster[],
  };
}

/**
 * Computes the last 30 calendar days for the given canonical timezone (default Asia/Kolkata).
 */
export function getLast30DaysList(timeZone: string = 'Asia/Kolkata'): Array<{
  dateStr: string;
  dayNumber: number;
  dayOfWeek: string;
  monthShort: string;
  formattedDate: string;
}> {
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

  const days: Array<{
    dateStr: string;
    dayNumber: number;
    dayOfWeek: string;
    monthShort: string;
    formattedDate: string;
  }> = [];

  const dayOfWeekNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  for (let i = 29; i >= 0; i--) {
    const d = new Date(anchorUtc - i * 86400000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const dayOfWeek = dayOfWeekNames[d.getUTCDay()];
    const monthShort = monthNames[d.getUTCMonth()];
    days.push({
      dateStr,
      dayNumber: d.getUTCDate(),
      dayOfWeek,
      monthShort,
      formattedDate: `${d.getUTCDate()} ${monthShort} ${yyyy}`,
    });
  }

  return days;
}

/**
 * Loads the 30-day ingestion coverage status for a specific store.
 * Returns each date marked as uploaded (green) or missing (orange).
 */
export async function fetchStoreDateCoverage(
  storeId: string,
  timeZone: string = 'Asia/Kolkata'
): Promise<{
  summary: StoreCoverageSummary;
  error?: string;
}> {
  const daysList = getLast30DaysList(timeZone);
  const thirtyDaysAgoStr = daysList[0].dateStr;
  const todayStr = daysList[daysList.length - 1].dateStr;

  try {
    // 1. Fetch succeeded batches for this store
    const { data: batches, error: batchError } = await supabase
      .from('ingestion_batches')
      .select('id, min_order_date, max_order_date, total_rows, completed_at, status')
      .eq('store_id', storeId)
      .eq('status', 'Succeeded')
      .order('completed_at', { ascending: false });

    if (batchError) {
      return {
        summary: {
          days: daysList.map((d) => ({ ...d, isUploaded: false })),
          totalDays: daysList.length,
          uploadedCount: 0,
          missingCount: daysList.length,
        },
        error: `Could not load batch history: ${batchError.message}`,
      };
    }

    // 2. Query orders count by date across the last 30 days
    const { data: orderRows } = await supabase
      .from('orders')
      .select('order_date')
      .eq('store_id', storeId)
      .gte('order_date', thirtyDaysAgoStr)
      .lte('order_date', todayStr);

    const countByDate = new Map<string, number>();
    if (orderRows) {
      for (const row of orderRows) {
        if (row.order_date) {
          countByDate.set(
            row.order_date,
            (countByDate.get(row.order_date) ?? 0) + 1
          );
        }
      }
    }

    // 3. Mark each day as uploaded (green) or missing (orange)
    let uploadedCount = 0;
    const days: DayCoverage[] = daysList.map((day) => {
      const orderCount = countByDate.get(day.dateStr);

      const matchingBatch = (batches ?? []).find(
        (b) =>
          b.min_order_date &&
          b.max_order_date &&
          b.min_order_date <= day.dateStr &&
          b.max_order_date >= day.dateStr
      );

      const isUploaded =
        (orderCount !== undefined && orderCount > 0) || Boolean(matchingBatch);
      if (isUploaded) {
        uploadedCount += 1;
      }

      return {
        ...day,
        isUploaded,
        orderCount: orderCount ?? matchingBatch?.total_rows ?? undefined,
        lastUploadedAt: matchingBatch?.completed_at ?? undefined,
      };
    });

    return {
      summary: {
        days,
        totalDays: days.length,
        uploadedCount,
        missingCount: days.length - uploadedCount,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      summary: {
        days: daysList.map((d) => ({ ...d, isUploaded: false })),
        totalDays: daysList.length,
        uploadedCount: 0,
        missingCount: daysList.length,
      },
      error: `Failed to load store date coverage: ${msg}`,
    };
  }
}
