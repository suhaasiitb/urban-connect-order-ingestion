import { describe, expect, it } from 'vitest';
import {
  type RiderPerformancePivotResult,
  type RiderPivotRow,
  buildRiderPerformanceExportSheet,
  buildUnder6HoursReportRows,
  formatDateToHeader,
  formatUnder6HoursLoginTime,
  getAllDatesInRange,
  getDateRangeForDays,
  isHighBtoRider,
  shiftIsoDate,
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

    // When includeToday is true, range ends on today
    const range7WithToday = getDateRangeForDays(7, 'Asia/Kolkata', true);
    expect(range7WithToday.endDate).toBe(todayStr);
    const dates7WithToday = getAllDatesInRange(range7WithToday.startDate, range7WithToday.endDate);
    expect(dates7WithToday).toHaveLength(7);
    expect(dates7WithToday[0]).toBe(todayStr);

    // When daysCount is 0 (Today preset), startDate and endDate are today
    const rangeToday = getDateRangeForDays(0, 'Asia/Kolkata');
    expect(rangeToday.startDate).toBe(todayStr);
    expect(rangeToday.endDate).toBe(todayStr);
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

  it('correctly aggregates LM Distance in meters and converts to kilometers for daily and period averages', () => {
    // Simulate orders for Rider with LM Distance in meters (one-way delivery distance)
    const mockOrdersWithDistance = [
      // Day 1 (14-Oct): 3 orders, distances 989m, 1450m, 2100m -> Total 4539m -> 4.5 km
      { rider_name: 'ABHAY GORE', order_date: '2026-10-14', distance_meters: 989 },
      { rider_name: 'ABHAY GORE', order_date: '2026-10-14', distance_meters: 1450 },
      { rider_name: 'ABHAY GORE', order_date: '2026-10-14', distance_meters: 2100 },
      // Day 2 (15-Oct): 2 orders, distances 3200m, 800m -> Total 4000m -> 4.0 km
      { rider_name: 'ABHAY GORE', order_date: '2026-10-15', distance_meters: 3200 },
      { rider_name: 'ABHAY GORE', order_date: '2026-10-15', distance_meters: 800 },
    ];
    expect(mockOrdersWithDistance).toHaveLength(5);

    const day1Meters = 989 + 1450 + 2100;
    const day2Meters = 3200 + 800;
    const day1Km = Math.round((day1Meters / 1000) * 10) / 10;
    const day2Km = Math.round((day2Meters / 1000) * 10) / 10;

    expect(day1Meters).toBe(4539);
    expect(day1Km).toBe(4.5);
    expect(day2Meters).toBe(4000);
    expect(day2Km).toBe(4.0);

    const totalMeters = day1Meters + day2Meters; // 8539m
    const totalDistanceKm = Math.round((totalMeters / 1000) * 10) / 10; // 8.5 km
    expect(totalDistanceKm).toBe(8.5);

    // Across 7-day period range
    const periodDays = 7;
    const avgDistanceKm = Math.round((totalDistanceKm / periodDays) * 10) / 10; // 8.5 / 7 = 1.2 km/day
    expect(avgDistanceKm).toBe(1.2);

    // Across 2 active working days
    const activeWorkingDays = 2;
    const activeAvgDistanceKm = Math.round((totalDistanceKm / activeWorkingDays) * 10) / 10; // 8.5 / 2 = 4.3 km/day
    expect(activeAvgDistanceKm).toBe(4.3);
  });

  it('builds Rider Performance export matching filtered table rows, referral/shift metadata, active days, and 8h target', () => {
    const filteredPivot: RiderPerformancePivotResult = {
      storeId: 'store-tpe2',
      startDate: '2026-11-04',
      endDate: '2026-11-05',
      periodDays: 2,
      totalRiders: 2,
      overallAvgHours: 4.3,
      overallAvgOrders: 9,
      dateColumns: [
        { dateStr: '2026-11-05', formattedHeader: '05-Nov' },
        { dateStr: '2026-11-04', formattedHeader: '04-Nov' },
      ],
      rows: [
        {
          riderName: 'Aditya Ananta Yadav',
          dailyMetrics: {
            '2026-11-05': { hours: 9, orders: 20, distanceKm: 55.2 },
            '2026-11-04': { hours: 8, orders: 16, distanceKm: 42.1 },
          },
          workingDays: 2,
          totalHours: 17,
          totalOrders: 36,
          totalDistanceKm: 97.3,
          avgHours: 8.5,
          avgOrders: 18,
          avgDistanceKm: 48.7,
          activeAvgHours: 8.5,
          activeAvgOrders: 18,
          activeAvgDistanceKm: 48.7,
          otpBreachedCount: 2,
          otpBreachedDays: 2,
        },
        {
          riderName: 'Zero Turnup Referral',
          dailyMetrics: {},
          workingDays: 0,
          totalHours: 0,
          totalOrders: 0,
          totalDistanceKm: 0,
          avgHours: 0,
          avgOrders: 0,
          avgDistanceKm: 0,
          activeAvgHours: 0,
          activeAvgOrders: 0,
          activeAvgDistanceKm: 0,
        },
      ],
    };

    const activeNames = new Set<string>(['aditya ananta yadav']);
    const phoneMap = new Map<string, string>([['aditya ananta yadav', '9876543210']]);
    const shiftsMap = new Map([
      [
        'aditya ananta yadav',
        {
          shiftType: 'Split Shift',
          timings: '7 AM - 12 PM & 4 PM - 9 PM',
          target8h: '≥ 8h',
          onboardedBy: 'Supervisor',
          referredBy: 'KETAN JADHAV',
          referredPhone: '9000011111',
        },
      ],
      [
        'zero turnup referral',
        {
          shiftType: 'Unassigned',
          timings: '',
          target8h: '—',
          onboardedBy: null,
          referredBy: 'KETAN JADHAV',
          referredPhone: null,
        },
      ],
    ]);

    const { sheetData, merges, filename } = buildRiderPerformanceExportSheet(
      filteredPivot,
      'TPE2',
      false,
      activeNames,
      phoneMap,
      shiftsMap,
      { includeOtpBreachCol: true }
    );

    expect(filename).toBe('Rider_Performance_TPE2_2026-11-04_to_2026-11-05.xlsx');
    // 2 header rows + 2 filtered rider rows
    expect(sheetData).toHaveLength(4);
    expect(sheetData[0].slice(0, 11)).toEqual([
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
      'OTP Breaches',
    ]);
    // Dynamic merges start right after baseColCount (11)
    expect(merges[0]).toEqual({ s: { r: 0, c: 11 }, e: { r: 0, c: 13 } });
    expect(merges[1]).toEqual({ s: { r: 0, c: 14 }, e: { r: 0, c: 16 } });

    // Row 1: active referral rider with deliveries
    expect(sheetData[2]).toEqual([
      'Aditya Ananta Yadav',
      '9876543210',
      'Yes',
      'Split Shift',
      '7 AM - 12 PM & 4 PM - 9 PM',
      '≥ 8h',
      2,
      'Supervisor',
      'KETAN JADHAV',
      '9000011111',
      '2 (2d)',
      9,
      20,
      55.2,
      8,
      16,
      42.1,
      8.5,
      18,
      48.7,
      36,
      97.3,
    ]);

    // Row 2: 0-delivery referral rider with blank daily metrics
    expect(sheetData[3]).toEqual([
      'Zero Turnup Referral',
      '',
      'No',
      'Unassigned',
      '',
      '—',
      0,
      '',
      'KETAN JADHAV',
      '',
      '0',
      '',
      '',
      '',
      '',
      '',
      '',
      0,
      0,
      0,
      0,
      0,
    ]);
  });

  it('identifies high BTO riders using >= 1 on single-day periods and >= 2 on multi-day periods', () => {
    expect(isHighBtoRider({ btoCount: 0 }, true)).toBe(false);
    expect(isHighBtoRider({ btoCount: 1 }, true)).toBe(true);
    expect(isHighBtoRider({ btoCount: 1 }, false)).toBe(false);
    expect(isHighBtoRider({ btoCount: 2 }, false)).toBe(true);
    expect(isHighBtoRider({ btoCount: undefined }, false)).toBe(false);
  });

  it('includes BTO Orders column and shifted date merges when includeBtoCol is enabled in export', () => {
    const pivot: RiderPerformancePivotResult = {
      storeId: 'store-tpe2',
      startDate: '2026-11-20',
      endDate: '2026-11-21',
      periodDays: 2,
      totalRiders: 1,
      overallAvgHours: 8,
      overallAvgOrders: 15,
      dateColumns: [
        { dateStr: '2026-11-21', formattedHeader: '21-Nov' },
        { dateStr: '2026-11-20', formattedHeader: '20-Nov' },
      ],
      rows: [
        {
          riderName: 'Rohan Shinde',
          dailyMetrics: {
            '2026-11-21': { hours: 8, orders: 16, distanceKm: 40, btoCount: 2 },
            '2026-11-20': { hours: 8, orders: 14, distanceKm: 35, btoCount: 1 },
          },
          workingDays: 2,
          totalHours: 16,
          totalOrders: 30,
          totalDistanceKm: 75,
          btoCount: 3,
          btoDays: 2,
          avgHours: 8,
          avgOrders: 15,
          avgDistanceKm: 37.5,
          activeAvgHours: 8,
          activeAvgOrders: 15,
          activeAvgDistanceKm: 37.5,
        },
      ],
    };

    const { sheetData, merges } = buildRiderPerformanceExportSheet(
      pivot,
      'TPE2',
      false,
      new Set(['rohan shinde']),
      new Map([['rohan shinde', '9876543210']]),
      undefined,
      { includeBtoCol: true }
    );

    expect(sheetData[0].slice(0, 11)).toEqual([
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
      'BTO Orders',
    ]);
    expect(sheetData[2][10]).toBe('3 (2d)');
    expect(merges[0]).toEqual({ s: { r: 0, c: 11 }, e: { r: 0, c: 13 } });
  });

  it('shifts ISO YYYY-MM-DD dates accurately across month, year, and leap boundaries', () => {
    expect(shiftIsoDate('2026-11-25', -1)).toBe('2026-11-24');
    expect(shiftIsoDate('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftIsoDate('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftIsoDate('2024-02-29', 1)).toBe('2024-03-01');
    expect(shiftIsoDate('2024-03-01', -1)).toBe('2024-02-29');
    expect(shiftIsoDate('invalid-date', -1)).toBe('invalid-date');
  });

  it('formats <=6h performance list login time cleanly (1 hr vs plural hrs & decimals)', () => {
    expect(formatUnder6HoursLoginTime(1)).toBe('1 hr');
    expect(formatUnder6HoursLoginTime(1.0)).toBe('1 hr');
    expect(formatUnder6HoursLoginTime(2)).toBe('2 hrs');
    expect(formatUnder6HoursLoginTime(6)).toBe('6 hrs');
    expect(formatUnder6HoursLoginTime(2.5)).toBe('2.5 hrs');
    expect(formatUnder6HoursLoginTime(0)).toBe('0 hrs');
  });

  it('builds <=6h Rider Performance List filtered to avgHours <= 6 and sorted by orders ascending', () => {
    const makeRow = (riderName: string, avgHours: number, totalOrders: number): RiderPivotRow => ({
      riderName,
      dailyMetrics: {},
      workingDays: 1,
      totalHours: avgHours,
      totalOrders,
      totalDistanceKm: 0,
      avgHours,
      avgOrders: totalOrders,
      avgDistanceKm: 0,
      activeAvgHours: avgHours,
      activeAvgOrders: totalOrders,
      activeAvgDistanceKm: 0,
    });

    const input: RiderPivotRow[] = [
      makeRow('Rahul Walhekar', 5, 7),
      makeRow('Borderline Six', 6.0, 9),
      makeRow('Above Six', 6.1, 4),
      makeRow('Full Time Rider', 8.0, 22),
      makeRow('Atharva Ladkat', 1, 1),
      makeRow('Dipak Waghmare', 2, 4),
      makeRow('Anil Pawar', 3, 4),
      makeRow('Jetharam Choudhary', 2, 2),
    ];

    const reportRows = buildUnder6HoursReportRows(input);

    expect(reportRows).toEqual([
      { riderName: 'Atharva Ladkat', avgHours: 1, loginTimeLabel: '1 hr', totalOrders: 1 },
      { riderName: 'Jetharam Choudhary', avgHours: 2, loginTimeLabel: '2 hrs', totalOrders: 2 },
      { riderName: 'Dipak Waghmare', avgHours: 2, loginTimeLabel: '2 hrs', totalOrders: 4 },
      { riderName: 'Anil Pawar', avgHours: 3, loginTimeLabel: '3 hrs', totalOrders: 4 },
      { riderName: 'Rahul Walhekar', avgHours: 5, loginTimeLabel: '5 hrs', totalOrders: 7 },
      { riderName: 'Borderline Six', avgHours: 6, loginTimeLabel: '6 hrs', totalOrders: 9 },
    ]);
  });
});
