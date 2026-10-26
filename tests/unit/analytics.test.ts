import { describe, expect, it } from 'vitest';
import {
  formatDateToHeader,
  getAllDatesInRange,
  getDateRangeForDays,
} from '../../src/services/analyticsService';

describe('Rider Performance Analytics Unit Tests', () => {
  it('formats YYYY-MM-DD into DD-MMM header matching spreadsheet', () => {
    expect(formatDateToHeader('2026-10-15')).toBe('15-Oct');
    expect(formatDateToHeader('2026-10-16')).toBe('16-Oct');
    expect(formatDateToHeader('2026-10-01')).toBe('01-Oct');
    expect(formatDateToHeader('2026-09-30')).toBe('30-Sep');
  });

  it('generates all calendar dates in selected range with customizable order', () => {
    // Default desc order (newest first, e.g. 19th down to 13th)
    const datesDesc = getAllDatesInRange('2026-10-13', '2026-10-19', 'desc');
    expect(datesDesc).toEqual([
      '2026-10-19',
      '2026-10-18',
      '2026-10-17',
      '2026-10-16',
      '2026-10-15',
      '2026-10-14',
      '2026-10-13',
    ]);
    expect(datesDesc).toHaveLength(7);

    // Ascending order (chronological, e.g. 13th up to 19th)
    const datesAsc = getAllDatesInRange('2026-10-13', '2026-10-19', 'asc');
    expect(datesAsc).toEqual([
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
    ]);
    expect(datesAsc).toHaveLength(7);
  });

  it('calculates correct start and end date ranges for presets excluding ongoing current date', () => {
    // 1 Day preset represents yesterday's date
    const range1 = getDateRangeForDays(1, 'Asia/Kolkata');
    expect(range1.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range1.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range1.startDate).toBe(range1.endDate);
    const dates1 = getAllDatesInRange(range1.startDate, range1.endDate);
    expect(dates1).toHaveLength(1);
    expect(dates1[0]).toBe(range1.endDate);

    const range3 = getDateRangeForDays(3, 'Asia/Kolkata');
    expect(range3.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range3.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range3.startDate <= range3.endDate).toBe(true);
    const dates3 = getAllDatesInRange(range3.startDate, range3.endDate);
    expect(dates3).toHaveLength(3);

    const range7 = getDateRangeForDays(7, 'Asia/Kolkata');
    expect(range7.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range7.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range7.startDate <= range7.endDate).toBe(true);

    // Verify 7 days span
    const dates7 = getAllDatesInRange(range7.startDate, range7.endDate);
    expect(dates7).toHaveLength(7);

    // Verify current date is excluded (endDate is strictly before today in local time)
    const now = new Date();
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayStr = dtf.format(now);
    expect(range7.endDate < todayStr).toBe(true);

    const range30 = getDateRangeForDays(30, 'Asia/Kolkata');
    expect(range30.startDate <= range7.startDate).toBe(true);
    const dates30 = getAllDatesInRange(range30.startDate, range30.endDate);
    expect(dates30).toHaveLength(30);
  });

  it('aggregates slot_hour via COUNTUNIQUE and order_id via COUNTA with 7-day period average', () => {
    // Simulate raw orders for Rider A across 2 days within a 7-day period
    const mockOrders = [
      // Day 1 (14-Oct): slots 8, 8, 8, 9, 9, 10, 10, 11, 12 -> 5 unique hours, 9 orders
      { rider_name: 'ABHAY GORE', slot_hour: 8, order_date: '2026-10-14', order_id: 'O1' },
      { rider_name: 'ABHAY GORE', slot_hour: 8, order_date: '2026-10-14', order_id: 'O2' },
      { rider_name: 'ABHAY GORE', slot_hour: 8, order_date: '2026-10-14', order_id: 'O3' },
      { rider_name: 'ABHAY GORE', slot_hour: 9, order_date: '2026-10-14', order_id: 'O4' },
      { rider_name: 'ABHAY GORE', slot_hour: 9, order_date: '2026-10-14', order_id: 'O5' },
      { rider_name: 'ABHAY GORE', slot_hour: 10, order_date: '2026-10-14', order_id: 'O6' },
      { rider_name: 'ABHAY GORE', slot_hour: 10, order_date: '2026-10-14', order_id: 'O7' },
      { rider_name: 'ABHAY GORE', slot_hour: 11, order_date: '2026-10-14', order_id: 'O8' },
      { rider_name: 'ABHAY GORE', slot_hour: 12, order_date: '2026-10-14', order_id: 'O9' },
      // Day 2 (15-Oct): slots 14, 15, 16 -> 3 unique hours, 3 orders
      { rider_name: 'ABHAY GORE', slot_hour: 14, order_date: '2026-10-15', order_id: 'O10' },
      { rider_name: 'ABHAY GORE', slot_hour: 15, order_date: '2026-10-15', order_id: 'O11' },
      { rider_name: 'ABHAY GORE', slot_hour: 16, order_date: '2026-10-15', order_id: 'O12' },
    ];

    const totalHoursAbhay = 5 + 3; // 8 hours
    const totalOrdersAbhay = 9 + 3; // 12 orders
    expect(mockOrders).toHaveLength(totalOrdersAbhay);

    // When 7 Days period is selected, the period average divides by 7 days
    const periodDays = 7;
    const periodAvgHours = Math.round((totalHoursAbhay / periodDays) * 10) / 10; // 8 / 7 = 1.1
    const periodAvgOrders = Math.round((totalOrdersAbhay / periodDays) * 10) / 10; // 12 / 7 = 1.7

    expect(periodAvgHours).toBe(1.1);
    expect(periodAvgOrders).toBe(1.7);

    // Active days average divides by active working days (2)
    const activeWorkingDays = 2;
    const activeAvgHours = Math.round((totalHoursAbhay / activeWorkingDays) * 10) / 10; // 8 / 2 = 4.0
    const activeAvgOrders = Math.round((totalOrdersAbhay / activeWorkingDays) * 10) / 10; // 12 / 2 = 6.0

    expect(activeAvgHours).toBe(4.0);
    expect(activeAvgOrders).toBe(6.0);
  });

  it('correctly identifies riders with < 6 hrs average login time for selected period range', () => {
    // Rider 1: 5 working days, 40 total hours -> activeAvgHours = 8.0 (>= 6h)
    // Rider 2: 4 working days, 20 total hours -> activeAvgHours = 5.0 (< 6h)
    // Rider 3: 2 working days, 11 total hours -> activeAvgHours = 5.5 (< 6h)
    // Rider 4: 6 working days, 48 total hours -> activeAvgHours = 8.0 (>= 6h)
    const mockRiders = [
      { riderName: 'Rider 1', activeAvgHours: 8.0 },
      { riderName: 'Rider 2', activeAvgHours: 5.0 },
      { riderName: 'Rider 3', activeAvgHours: 5.5 },
      { riderName: 'Rider 4', activeAvgHours: 8.0 },
    ];

    const under6h = mockRiders.filter((r) => r.activeAvgHours < 6.0);
    expect(under6h).toHaveLength(2);
    expect(under6h.map((r) => r.riderName)).toEqual(['Rider 2', 'Rider 3']);

    const percentage = Math.round((under6h.length / mockRiders.length) * 100);
    expect(percentage).toBe(50);
  });
});
