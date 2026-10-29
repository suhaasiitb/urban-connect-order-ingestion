import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_STORE_DPH,
  calculateRequiredRiders,
  fetchPlanningForDate,
  formatPlanningSlotLabel,
  getAvailableForecastDates,
  getDefaultPlanningDate,
  getSnopUploadMeta,
  getStoreTargetDphSync,
  getStoredSnopRecords,
  parseSnopDateField,
  parseSnopFile,
  recalculatePlanningWithDph,
  saveSnopRecords,
  saveStoreTargetDph,
} from '../../src/services/planningService';
import { INITIAL_TMK7_SNOP_RECORDS } from '../../src/services/planningDataSeed';

// Polyfill window.localStorage for Node environment if missing
if (typeof window === 'undefined') {
  const store: Record<string, string> = {};
  (global as unknown as { window: { localStorage: Storage } }).window = {
    localStorage: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const k of Object.keys(store)) {
          delete store[k];
        }
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
      length: Object.keys(store).length,
    },
  };
}

describe('Store Planning & SNOP Forecast Suite', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe('1. Required Riders Calculation [CEIL(orders / DPH)]', () => {
    it('accurately computes required riders with user-specified example (50 orders, 2.1 DPH -> 24 riders)', () => {
      // 50 / 2.1 = 23.8095 -> Math.ceil = 24
      const result = calculateRequiredRiders(50, 2.1);
      expect(result).toBe(24);
    });

    it('returns 0 when orders count is 0 or negative', () => {
      expect(calculateRequiredRiders(0, 2.1)).toBe(0);
      expect(calculateRequiredRiders(-10, 2.1)).toBe(0);
    });

    it('returns 0 when DPH is 0 or negative', () => {
      expect(calculateRequiredRiders(50, 0)).toBe(0);
      expect(calculateRequiredRiders(50, -1)).toBe(0);
    });

    it('handles exact integer multiples cleanly without rounding up extra', () => {
      // 42 / 2.1 = 20 exactly
      expect(calculateRequiredRiders(42, 2.1)).toBe(20);
      // 50 / 2.5 = 20 exactly
      expect(calculateRequiredRiders(50, 2.5)).toBe(20);
    });

    it('handles fractional / decimal projected orders accurately', () => {
      // 8.8 / 2.1 = 4.1904 -> ceil = 5
      expect(calculateRequiredRiders(8.8, 2.1)).toBe(5);
      // 107.8 / 2.1 = 51.333 -> ceil = 52
      expect(calculateRequiredRiders(107.8, 2.1)).toBe(52);
    });

    it('recalculates required riders immediately when DPH changes', () => {
      const orders = 100;
      expect(calculateRequiredRiders(orders, 2.0)).toBe(50);
      expect(calculateRequiredRiders(orders, 2.1)).toBe(48); // 100 / 2.1 = 47.619 -> 48
      expect(calculateRequiredRiders(orders, 2.5)).toBe(40);
      expect(calculateRequiredRiders(orders, 3.0)).toBe(34); // 100 / 3.0 = 33.333 -> 34
    });
  });

  describe('2. Date Formatting and Slot Helpers', () => {
    it('converts Excel serial date codes to YYYY-MM-DD strings', () => {
      // 46320 = 2026-10-25
      expect(parseSnopDateField(46320)).toBe('2026-10-25');
      // 46347 = 2026-11-21
      expect(parseSnopDateField(46347)).toBe('2026-11-21');
    });

    it('formats ISO dates, YYYY-MM-DD, and DD-MM-YYYY', () => {
      expect(parseSnopDateField('2026-10-25')).toBe('2026-10-25');
      expect(parseSnopDateField('25-10-2026')).toBe('2026-10-25');
    });

    it('formats slot labels into clear human-readable 12-hour format (e.g. 6 AM)', () => {
      expect(formatPlanningSlotLabel(6)).toBe('6 AM');
      expect(formatPlanningSlotLabel(12)).toBe('12 PM');
      expect(formatPlanningSlotLabel(18)).toBe('6 PM');
      expect(formatPlanningSlotLabel(23)).toBe('11 PM');
    });
  });

  describe('3. SNOP File Parsing (CSV & Excel)', () => {
    it('parses valid CSV forecast with City, Warehouse Id, Date, Hour, Order', async () => {
      const csvContent =
        'City,Warehouse Id,Date,Hour,Order\n' +
        'Pune,TMK7,2026-10-25,6,50\n' +
        'Pune,TMK7,2026-10-25,7,75\n' +
        'Pune,TMK7,2026-10-25,8,100\n';

      const encoder = new TextEncoder();
      const buffer = encoder.encode(csvContent).buffer;

      const res = await parseSnopFile({
        fileBytes: buffer,
        filename: 'test_snop.csv',
        targetSiteCode: 'TMK7',
      });

      expect(res.is_valid).toBe(true);
      expect(res.total_rows).toBe(3);
      expect(res.start_date).toBe('2026-10-25');
      expect(res.end_date).toBe('2026-10-25');
      expect(res.total_projected_orders).toBe(225);
      expect(res.records[0]).toEqual({
        city: 'Pune',
        warehouseId: 'TMK7',
        dateStr: '2026-10-25',
        hour: 6,
        projectedOrders: 50,
      });
    });

    it('parses binary Excel (.xlsx) workbook with serial dates', async () => {
      const rows = [
        ['City', 'Warehouse Id', 'Date', 'Hour', 'Order'],
        ['Pune', 'TMK7', 46320, 6, 6],
        ['Pune', 'TMK7', 46320, 7, 21],
      ];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Forecast');
      const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;

      const res = await parseSnopFile({
        fileBytes: wbOut,
        filename: 'excel_test.xlsx',
        targetSiteCode: 'TMK7',
      });

      expect(res.is_valid).toBe(true);
      expect(res.total_rows).toBe(2);
      expect(res.records[0].dateStr).toBe('2026-10-25');
      expect(res.records[0].hour).toBe(6);
      expect(res.records[0].projectedOrders).toBe(6);
    });

    it('rejects files missing required columns', async () => {
      const badCsv = 'City,InvalidHeader,Something\nPune,X,Y\n';
      const buffer = new TextEncoder().encode(badCsv).buffer;

      const res = await parseSnopFile({
        fileBytes: buffer,
        filename: 'bad.csv',
        targetSiteCode: 'TMK7',
      });

      expect(res.is_valid).toBe(false);
      expect(res.errors[0]).toMatch(/Missing required columns/);
    });
  });

  describe('4. Pre-seeded TMK7 Baseline Dataset', () => {
    it('contains all 504 forecast slots for TMK7 covering 28 calendar days', () => {
      expect(INITIAL_TMK7_SNOP_RECORDS.length).toBe(504);

      const dates = Array.from(new Set(INITIAL_TMK7_SNOP_RECORDS.map((r) => r.dateStr))).sort();
      expect(dates).toHaveLength(28);
      expect(dates[0]).toBe('2026-10-25');
      expect(dates[dates.length - 1]).toBe('2026-11-21');

      // Check each day has 18 slots (hours 6 through 23)
      for (const d of dates) {
        const slotsForDay = INITIAL_TMK7_SNOP_RECORDS.filter((r) => r.dateStr === d);
        expect(slotsForDay).toHaveLength(18);
        expect(slotsForDay.map((s) => s.hour)).toEqual([
          6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
        ]);
      }
    });

    it('provides baseline data and metadata out-of-the-box before any upload', () => {
      const records = getStoredSnopRecords('TMK7');
      expect(records).toHaveLength(504);

      const meta = getSnopUploadMeta('TMK7');
      expect(meta).not.toBeNull();
      expect(meta?.totalRows).toBe(504);
      expect(meta?.startDate).toBe('2026-10-25');
      expect(meta?.endDate).toBe('2026-11-21');
    });

    it('returns all available forecast dates for TMK7', () => {
      const dates = getAvailableForecastDates('TMK7');
      expect(dates).toHaveLength(28);
      expect(dates).toContain('2026-10-25');
      expect(dates).toContain('2026-11-21');
    });

    it('defaults planning date to the next date (tomorrow) from current date', () => {
      const dates = getAvailableForecastDates('TMK7'); // 2026-10-25 to 2026-11-21

      // When current date is 2026-10-28, tomorrow is 2026-10-29
      const baseOct28 = new Date('2026-10-28T12:00:00+05:30');
      const defaultDate = getDefaultPlanningDate(dates, 'Asia/Kolkata', baseOct28);
      expect(defaultDate).toBe('2026-10-29');

      // When current date is before available dates (e.g. 2026-10-20), next upcoming is 2026-10-25
      const baseOct20 = new Date('2026-10-20T12:00:00+05:30');
      expect(getDefaultPlanningDate(dates, 'Asia/Kolkata', baseOct20)).toBe('2026-10-25');

      // When all dates are in the past (e.g. 2026-12-01), fallback to latest available date
      const baseDec01 = new Date('2026-12-01T12:00:00+05:30');
      expect(getDefaultPlanningDate(dates, 'Asia/Kolkata', baseDec01)).toBe('2026-11-21');
    });
  });

  describe('5. Rewrite / Overwrite Persistence Semantics', () => {
    it('rewrites and replaces existing forecast data when a new upload occurs', async () => {
      // 1. Initial TMK7 baseline has 504 rows
      expect(getStoredSnopRecords('TMK7')).toHaveLength(504);

      // 2. User uploads a new updated forecast with 2 slots
      const newUpload = [
        {
          city: 'Pune',
          warehouseId: 'TMK7',
          dateStr: '2026-11-01',
          hour: 6,
          projectedOrders: 99,
        },
        {
          city: 'Pune',
          warehouseId: 'TMK7',
          dateStr: '2026-11-01',
          hour: 7,
          projectedOrders: 120,
        },
      ];

      const res = await saveSnopRecords({
        warehouseId: 'TMK7',
        records: newUpload,
        filename: 'Updated_TMK7_SNOP.xlsx',
        uploadedBy: 'TestUser',
      });

      expect(res.ok).toBe(true);
      expect(res.count).toBe(2);

      // 3. Confirm prior 504 records were completely rewritten/replaced by the new 2 records
      const updated = getStoredSnopRecords('TMK7');
      expect(updated).toHaveLength(2);
      expect(updated[0].projectedOrders).toBe(99);
      expect(updated[1].projectedOrders).toBe(120);

      const updatedMeta = getSnopUploadMeta('TMK7');
      expect(updatedMeta?.filename).toBe('Updated_TMK7_SNOP.xlsx');
      expect(updatedMeta?.totalRows).toBe(2);
      expect(updatedMeta?.startDate).toBe('2026-11-01');
      expect(updatedMeta?.endDate).toBe('2026-11-01');
      expect(updatedMeta?.totalProjectedOrders).toBe(219);
    });

    it('supports bulk multi-store forecast upload and reflects each store independently', async () => {
      const multiStoreUpload = [
        {
          city: 'Pune',
          warehouseId: 'TMK7',
          dateStr: '2026-11-02',
          hour: 6,
          projectedOrders: 50,
        },
        {
          city: 'Pune',
          warehouseId: 'TPH1',
          dateStr: '2026-11-02',
          hour: 6,
          projectedOrders: 75,
        },
        {
          city: 'Pune',
          warehouseId: 'TPE2',
          dateStr: '2026-11-02',
          hour: 6,
          projectedOrders: 90,
        },
      ];

      const res = await saveSnopRecords({
        records: multiStoreUpload,
        filename: 'Bulk_All_Stores_SNOP.xlsx',
        uploadedBy: 'AdminUser',
      });

      expect(res.ok).toBe(true);
      expect(res.count).toBe(3);
      expect(res.warehousesUpdated).toEqual(['TMK7', 'TPH1', 'TPE2']);

      // Verify each store received its respective data
      const tmk7 = getStoredSnopRecords('TMK7');
      expect(tmk7).toHaveLength(1);
      expect(tmk7[0].projectedOrders).toBe(50);

      const tph1 = getStoredSnopRecords('TPH1');
      expect(tph1).toHaveLength(1);
      expect(tph1[0].projectedOrders).toBe(75);

      const tpe2 = getStoredSnopRecords('TPE2');
      expect(tpe2).toHaveLength(1);
      expect(tpe2[0].projectedOrders).toBe(90);
    });
  });

  describe('6. Store Target DPH Configuration & Editing', () => {
    it('defaults to 2.10 for TMK7', () => {
      expect(DEFAULT_STORE_DPH['TMK7']).toBe(2.1);
      expect(getStoreTargetDphSync('TMK7')).toBe(2.1);
    });

    it('persists modified target DPH and updates getStoreTargetDphSync', async () => {
      const saveRes = await saveStoreTargetDph('TMK7', 2.35);
      expect(saveRes.ok).toBe(true);

      const updated = getStoreTargetDphSync('TMK7');
      expect(updated).toBe(2.35);
    });

    it('rejects invalid or negative DPH values', async () => {
      const resZero = await saveStoreTargetDph('TMK7', 0);
      expect(resZero.ok).toBe(false);

      const resNeg = await saveStoreTargetDph('TMK7', -1.5);
      expect(resNeg.ok).toBe(false);
    });
  });

  describe('7. Day Planning Summary Assembly', () => {
    it('assembles slot planning rows and correctly computes required riders and rollups', async () => {
      const summary = await fetchPlanningForDate({
        storeId: 'test-store-id',
        warehouseId: 'TMK7',
        dateStr: '2026-10-25',
        targetDph: 2.1,
      });

      expect(summary.dateStr).toBe('2026-10-25');
      expect(summary.warehouseId).toBe('TMK7');
      expect(summary.targetDph).toBe(2.1);
      expect(summary.hasSnopData).toBe(true);
      expect(summary.slots).toHaveLength(18); // Hours 6 to 23

      // Hour 6: orders 6 -> ceil(6 / 2.1) = 3
      const slot6 = summary.slots.find((s) => s.hour === 6);
      expect(slot6).toBeDefined();
      expect(slot6?.projectedOrders).toBe(6);
      expect(slot6?.requiredRiders).toBe(3);

      // Hour 10: orders 88 -> ceil(88 / 2.1) = 42
      const slot10 = summary.slots.find((s) => s.hour === 10);
      expect(slot10).toBeDefined();
      expect(slot10?.projectedOrders).toBe(88);
      expect(slot10?.requiredRiders).toBe(42);

      // Peak required riders should match max required across all slots
      const maxRequired = Math.max(...summary.slots.map((s) => s.requiredRiders));
      expect(summary.peakRequiredRiders).toBe(maxRequired);
      expect(summary.peakHour).toBe(10);

      // Morning shift peak (6 AM – 3 PM: hours 6 to 14): highest order is hour 10 with 88 orders & 42 riders
      expect(summary.peakMorning).toBeDefined();
      expect(summary.peakMorning.hour).toBe(10);
      expect(summary.peakMorning.slotLabel).toBe('10 AM');
      expect(summary.peakMorning.projectedOrders).toBe(88);
      expect(summary.peakMorning.requiredRiders).toBe(42);

      // 2nd shift peak (3 PM – 12 AM: hours 15 to 23): highest order is hour 19 with 66 orders & 32 riders
      expect(summary.peakSecond).toBeDefined();
      expect(summary.peakSecond.hour).toBe(19);
      expect(summary.peakSecond.slotLabel).toBe('7 PM');
      expect(summary.peakSecond.projectedOrders).toBe(66);
      expect(summary.peakSecond.requiredRiders).toBe(32);
    });

    it('rounds down last 1-week average turn-up to the nearest whole number (integer)', async () => {
      // Provide fractional turn-up map, e.g. 14.8 riders, 7.2 riders, 3.9 riders
      const fractionalTurnUpMap: Record<number, number> = {
        6: 3.9,
        7: 7.2,
        8: 14.8,
        9: 22.1,
      };

      const summary = await fetchPlanningForDate({
        storeId: 'test-store-id',
        warehouseId: 'TMK7',
        dateStr: '2026-10-25',
        targetDph: 2.1,
        avgTurnUpMap: fractionalTurnUpMap,
      });

      // Hour 6: 3.9 -> rounded down to 3
      const s6 = summary.slots.find((s) => s.hour === 6);
      expect(s6?.avgTurnUpLastWeek).toBe(3);
      expect(Number.isInteger(s6?.avgTurnUpLastWeek)).toBe(true);

      // Hour 7: 7.2 -> rounded down to 7
      const s7 = summary.slots.find((s) => s.hour === 7);
      expect(s7?.avgTurnUpLastWeek).toBe(7);

      // Hour 8: 14.8 -> rounded down to 14
      const s8 = summary.slots.find((s) => s.hour === 8);
      expect(s8?.avgTurnUpLastWeek).toBe(14);

      // Hour 9: 22.1 -> rounded down to 22
      const s9 = summary.slots.find((s) => s.hour === 9);
      expect(s9?.avgTurnUpLastWeek).toBe(22);

      // Confirm all slots have integer turn-up values
      for (const slot of summary.slots) {
        expect(Number.isInteger(slot.avgTurnUpLastWeek)).toBe(true);
        expect(Number.isInteger(slot.deltaTurnUpVsRequired)).toBe(true);
      }

      // Summary average turn-up and peak turn-up should also be integers
      expect(Number.isInteger(summary.avgTurnUp)).toBe(true);
      expect(Number.isInteger(summary.peakTurnUp)).toBe(true);
      expect(Number.isInteger(summary.netTurnUpDelta)).toBe(true);
    });

    it('immediately recalculates REQUIRED RIDERS, LAST 1-WK AVG TURN-UP, and STATUS when Target DPH changes', async () => {
      // 1. Load baseline summary with DPH 2.1
      const initial = await fetchPlanningForDate({
        storeId: 'test-store-id',
        warehouseId: 'TMK7',
        dateStr: '2026-10-25',
        targetDph: 2.1,
      });

      // Hour 10 has 88 orders -> CEIL(88 / 2.1) = 42 riders
      const initialSlot10 = initial.slots.find((s) => s.hour === 10);
      expect(initialSlot10?.requiredRiders).toBe(42);

      // 2. Change Target DPH to 2.5 (e.g. higher efficiency)
      const updated25 = recalculatePlanningWithDph(initial, 2.5);
      expect(updated25.targetDph).toBe(2.5);

      // Hour 10: CEIL(88 / 2.5) = 36 riders
      const slot10at25 = updated25.slots.find((s) => s.hour === 10);
      expect(slot10at25?.requiredRiders).toBe(36);
      expect(slot10at25?.deltaTurnUpVsRequired).toBe(
        (slot10at25?.avgTurnUpLastWeek ?? 0) - 36
      );

      // Morning peak is recalculated according to new DPH
      expect(updated25.peakMorning.requiredRiders).toBe(36);
      expect(updated25.peakMorning.hour).toBe(10);
      expect(updated25.peakMorning.projectedOrders).toBe(88);

      // 3. Change Target DPH to 1.5 (e.g. lower throughput, more riders needed)
      const updated15 = recalculatePlanningWithDph(initial, 1.5);
      expect(updated15.targetDph).toBe(1.5);

      // Hour 10: CEIL(88 / 1.5) = 59 riders
      const slot10at15 = updated15.slots.find((s) => s.hour === 10);
      expect(slot10at15?.requiredRiders).toBe(59);
      expect(slot10at15?.deltaTurnUpVsRequired).toBe(
        (slot10at15?.avgTurnUpLastWeek ?? 0) - 59
      );
      expect(updated15.peakMorning.requiredRiders).toBe(59);

      // Status shifts to deficit or surplus based on new required rider threshold
      for (const s of updated15.slots) {
        if (s.avgTurnUpLastWeek < s.requiredRiders) {
          expect(s.status).toBe('deficit');
        } else if (s.avgTurnUpLastWeek > s.requiredRiders) {
          expect(s.status).toBe('surplus');
        } else {
          expect(s.status).toBe('balanced');
        }
      }
    });
  });
});
