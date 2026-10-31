// ==============================================================================
// Rider Attendance & Turn-Up Planning Unit Tests
// Tests attendance marking (unmarked, present, absent), slot mapping from shift timings,
// persistence, real-time subscription, and integration with slot planning.
// ==============================================================================

import { beforeEach, describe, expect, it } from 'vitest';
import {
  type RiderAttendanceRecord,
  buildAttendanceSummary,
  calculateSlotTurnUpFromAttendance,
  fetchStoreRiderAttendance,
  getStoreAttendanceStorageKey,
  isRiderWorkingInSlot,
  saveStoreRiderAttendance,
  subscribeStoreRiderAttendance,
} from '../../src/services/riderAttendanceService';
import { fetchPlanningForDate, recalculatePlanningWithDph } from '../../src/services/planningService';

// Polyfill window.localStorage and EventTarget for Node environment if missing
if (typeof window === 'undefined') {
  const store: Record<string, string> = {};
  const listeners: Record<string, ((e: any) => void)[]> = {};
  (global as unknown as { window: any }).window = {
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
    addEventListener: (type: string, fn: (e: any) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    removeEventListener: (type: string, fn: (e: any) => void) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((cb) => cb !== fn);
      }
    },
    dispatchEvent: (event: any) => {
      if (listeners[event.type]) {
        for (const fn of listeners[event.type]) {
          fn(event);
        }
      }
      return true;
    },
  };
  (global as any).CustomEvent = class CustomEvent {
    type: string;
    detail: any;
    constructor(type: string, params?: { detail?: any }) {
      this.type = type;
      this.detail = params?.detail;
    }
  };
}

describe('Rider Attendance & Turn-Up Planning Suite', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe('1. Shift Timing Slot Membership [isRiderWorkingInSlot]', () => {
    it('correctly maps Morning Shift (6 AM – 3 PM) to slots 6 through 14', () => {
      const morningShift = { slot1StartHour: 6, slot1EndHour: 15 };

      // Slots 6 to 14 should be active
      for (let h = 6; h <= 14; h++) {
        expect(isRiderWorkingInSlot(morningShift, h)).toBe(true);
      }

      // Slot 5 (before 6 AM) and slot 15 (after 3 PM) should not be active
      expect(isRiderWorkingInSlot(morningShift, 5)).toBe(false);
      expect(isRiderWorkingInSlot(morningShift, 15)).toBe(false);
      expect(isRiderWorkingInSlot(morningShift, 20)).toBe(false);
    });

    it('correctly maps 2nd Shift (3 PM – 12 AM) to slots 15 through 23', () => {
      const secondShift = { slot1StartHour: 15, slot1EndHour: 24 };

      // Slots 15 to 23 should be active
      for (let h = 15; h <= 23; h++) {
        expect(isRiderWorkingInSlot(secondShift, h)).toBe(true);
      }

      // Slots 6 to 14 should not be active for 2nd shift
      for (let h = 6; h <= 14; h++) {
        expect(isRiderWorkingInSlot(secondShift, h)).toBe(false);
      }
    });

    it('correctly maps Split Shifts with slot1 and slot2', () => {
      const splitShift = {
        slot1StartHour: 6,
        slot1EndHour: 11,  // 6 AM to 11 AM (slots 6, 7, 8, 9, 10)
        slot2StartHour: 17,
        slot2EndHour: 22,  // 5 PM to 10 PM (slots 17, 18, 19, 20, 21)
      };

      // Morning slot 1
      expect(isRiderWorkingInSlot(splitShift, 6)).toBe(true);
      expect(isRiderWorkingInSlot(splitShift, 10)).toBe(true);
      expect(isRiderWorkingInSlot(splitShift, 11)).toBe(false);

      // Mid-day break
      expect(isRiderWorkingInSlot(splitShift, 12)).toBe(false);
      expect(isRiderWorkingInSlot(splitShift, 14)).toBe(false);

      // Evening slot 2
      expect(isRiderWorkingInSlot(splitShift, 17)).toBe(true);
      expect(isRiderWorkingInSlot(splitShift, 21)).toBe(true);
      expect(isRiderWorkingInSlot(splitShift, 22)).toBe(false);
    });
  });

  describe('2. Expected Turn-Up Derivation from Attendance [calculateSlotTurnUpFromAttendance]', () => {
    it('returns 0 for all slots when all riders are unmarked (default state)', () => {
      const sampleUnmarked: RiderAttendanceRecord[] = [
        {
          warehouseId: 'TMK7',
          attendanceDate: '2026-10-31',
          riderName: 'Rider A',
          normalizedName: 'rider a',
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          status: 'unmarked',
          isPresent: false,
        },
        {
          warehouseId: 'TMK7',
          attendanceDate: '2026-10-31',
          riderName: 'Rider B',
          normalizedName: 'rider b',
          shiftType: '2nd Shift',
          slot1StartHour: 15,
          slot1EndHour: 24,
          status: 'unmarked',
          isPresent: false,
        },
      ];

      const slotMap = calculateSlotTurnUpFromAttendance(sampleUnmarked);
      for (let h = 6; h <= 23; h++) {
        expect(slotMap[h]).toBe(0);
      }
    });

    it('returns 0 for all slots when all riders are marked absent', () => {
      const sampleAbsent: RiderAttendanceRecord[] = [
        {
          warehouseId: 'TMK7',
          attendanceDate: '2026-10-31',
          riderName: 'Rider A',
          normalizedName: 'rider a',
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          status: 'absent',
          isPresent: false,
        },
      ];

      const slotMap = calculateSlotTurnUpFromAttendance(sampleAbsent);
      for (let h = 6; h <= 23; h++) {
        expect(slotMap[h]).toBe(0);
      }
    });

    it('aggregates present riders across their corresponding shift slots accurately', () => {
      // 5 Morning riders (6-15) and 3 Second shift riders (15-24) marked present
      const records: RiderAttendanceRecord[] = [];

      for (let i = 1; i <= 5; i++) {
        records.push({
          warehouseId: 'TMK7',
          attendanceDate: '2026-10-31',
          riderName: `Morning Rider ${i}`,
          normalizedName: `morning rider ${i}`,
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          status: 'present',
          isPresent: true,
        });
      }

      for (let i = 1; i <= 3; i++) {
        records.push({
          warehouseId: 'TMK7',
          attendanceDate: '2026-10-31',
          riderName: `Evening Rider ${i}`,
          normalizedName: `evening rider ${i}`,
          shiftType: '2nd Shift',
          slot1StartHour: 15,
          slot1EndHour: 24,
          status: 'present',
          isPresent: true,
        });
      }

      // Add 2 absent riders who should NOT count
      records.push({
        warehouseId: 'TMK7',
        attendanceDate: '2026-10-31',
        riderName: 'Absent Rider 1',
        normalizedName: 'absent rider 1',
        shiftType: 'Morning Shift',
        slot1StartHour: 6,
        slot1EndHour: 15,
        status: 'absent',
        isPresent: false,
      });

      const slotMap = calculateSlotTurnUpFromAttendance(records);

      // Morning slots (6 to 14) should have turn-up = 5
      for (let h = 6; h <= 14; h++) {
        expect(slotMap[h]).toBe(5);
      }

      // Evening slots (15 to 23) should have turn-up = 3
      for (let h = 15; h <= 23; h++) {
        expect(slotMap[h]).toBe(3);
      }
    });
  });

  describe('3. Persistence & Summary Operations', () => {
    it('builds attendance summary with correct present, absent, unmarked counts', () => {
      const records: RiderAttendanceRecord[] = [
        {
          warehouseId: 'TMK7',
          attendanceDate: '2026-10-31',
          riderName: 'Rider 1',
          normalizedName: 'rider 1',
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          status: 'present',
          isPresent: true,
        },
        {
          warehouseId: 'TMK7',
          attendanceDate: '2026-10-31',
          riderName: 'Rider 2',
          normalizedName: 'rider 2',
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          status: 'absent',
          isPresent: false,
        },
        {
          warehouseId: 'TMK7',
          attendanceDate: '2026-10-31',
          riderName: 'Rider 3',
          normalizedName: 'rider 3',
          shiftType: '2nd Shift',
          slot1StartHour: 15,
          slot1EndHour: 24,
          status: 'unmarked',
          isPresent: false,
        },
      ];

      const summary = buildAttendanceSummary('TMK7', '2026-10-31', records);
      expect(summary.totalRiders).toBe(3);
      expect(summary.presentCount).toBe(1);
      expect(summary.absentCount).toBe(1);
      expect(summary.unmarkedCount).toBe(1);
      expect(summary.isFullyMarked).toBe(false);
    });

    it('saves attendance to localStorage cache and retrieves it via fetchStoreRiderAttendance', async () => {
      const records: RiderAttendanceRecord[] = [
        {
          warehouseId: 'TMK7',
          attendanceDate: '2026-10-31',
          riderName: 'Rider A',
          normalizedName: 'rider a',
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          status: 'present',
          isPresent: true,
        },
      ];

      const saveRes = await saveStoreRiderAttendance({
        storeId: 'test-store-id',
        warehouseId: 'TMK7',
        attendanceDate: '2026-10-31',
        records,
      });

      expect(saveRes.ok).toBe(true);
      expect(saveRes.presentCount).toBe(1);

      // Verify localStorage was populated
      const key = getStoreAttendanceStorageKey('TMK7', '2026-10-31');
      expect(window.localStorage.getItem(key)).not.toBeNull();

      // Fetch back
      const fetched = await fetchStoreRiderAttendance({
        storeId: 'test-store-id',
        warehouseId: 'TMK7',
        attendanceDate: '2026-10-31',
      });

      expect(fetched.totalRiders).toBe(1);
      expect(fetched.presentCount).toBe(1);
      expect(fetched.records[0].status).toBe('present');
    });

    it('subscribes to real-time attendance changes and triggers callback on update', async () => {
      let notifiedCount = -1;

      const unsubscribe = subscribeStoreRiderAttendance('TMK7', '2026-10-31', (summary) => {
        notifiedCount = summary.presentCount;
      });

      const records: RiderAttendanceRecord[] = [
        {
          warehouseId: 'TMK7',
          attendanceDate: '2026-10-31',
          riderName: 'Rider X',
          normalizedName: 'rider x',
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          status: 'present',
          isPresent: true,
        },
      ];

      await saveStoreRiderAttendance({
        storeId: 'test-store-id',
        warehouseId: 'TMK7',
        attendanceDate: '2026-10-31',
        records,
      });

      expect(notifiedCount).toBe(1);
      unsubscribe();
    });
  });

  describe('4. Planning Integration with Attendance-Driven Turn-Up', () => {
    it('populates plannedTurnUp from attendance and calculates short/surplus status against required riders', async () => {
      // 1. Save attendance for 2026-10-25 with 20 Morning Shift riders and 15 2nd Shift riders
      const records: RiderAttendanceRecord[] = [];
      for (let i = 1; i <= 20; i++) {
        records.push({
          warehouseId: 'TMK7',
          attendanceDate: '2026-10-25',
          riderName: `Morning Rider ${i}`,
          normalizedName: `morning rider ${i}`,
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          status: 'present',
          isPresent: true,
        });
      }
      for (let i = 1; i <= 15; i++) {
        records.push({
          warehouseId: 'TMK7',
          attendanceDate: '2026-10-25',
          riderName: `Evening Rider ${i}`,
          normalizedName: `evening rider ${i}`,
          shiftType: '2nd Shift',
          slot1StartHour: 15,
          slot1EndHour: 24,
          status: 'present',
          isPresent: true,
        });
      }

      await saveStoreRiderAttendance({
        storeId: 'test-store-id',
        warehouseId: 'TMK7',
        attendanceDate: '2026-10-25',
        records,
      });

      // 2. Fetch planning for that date
      const summary = await fetchPlanningForDate({
        storeId: 'test-store-id',
        warehouseId: 'TMK7',
        dateStr: '2026-10-25',
        targetDph: 2.1,
      });

      expect(summary.dateStr).toBe('2026-10-25');
      expect(summary.slots).toHaveLength(18);

      // Hour 6: orders 6 -> required ceil(6 / 2.1) = 3
      // Planned turn-up from attendance = 20 morning riders
      const slot6 = summary.slots.find((s) => s.hour === 6);
      expect(slot6?.plannedTurnUp).toBe(20);
      expect(slot6?.requiredRiders).toBe(3);
      expect(slot6?.deltaTurnUpVsRequired).toBe(17); // 20 - 3 = +17
      expect(slot6?.status).toBe('surplus');

      // Hour 10: orders 88 -> required ceil(88 / 2.1) = 42
      // Planned turn-up from attendance = 20 morning riders
      const slot10 = summary.slots.find((s) => s.hour === 10);
      expect(slot10?.plannedTurnUp).toBe(20);
      expect(slot10?.requiredRiders).toBe(42);
      expect(slot10?.deltaTurnUpVsRequired).toBe(-22); // 20 - 42 = -22
      expect(slot10?.status).toBe('deficit');

      // Hour 16 (4 PM in 2nd Shift): 15 evening riders
      const slot16 = summary.slots.find((s) => s.hour === 16);
      expect(slot16?.plannedTurnUp).toBe(15);

      // Rollups reflect planned turn-up
      expect(summary.peakTurnUp).toBe(20);
    });

    it('recalculates status seamlessly when Target DPH changes', async () => {
      const records: RiderAttendanceRecord[] = [
        {
          warehouseId: 'TMK7',
          attendanceDate: '2026-10-25',
          riderName: 'Rider 1',
          normalizedName: 'rider 1',
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          status: 'present',
          isPresent: true,
        },
      ];

      await saveStoreRiderAttendance({
        storeId: 'test-store-id',
        warehouseId: 'TMK7',
        attendanceDate: '2026-10-25',
        records,
      });

      const initial = await fetchPlanningForDate({
        storeId: 'test-store-id',
        warehouseId: 'TMK7',
        dateStr: '2026-10-25',
        targetDph: 2.1,
      });

      const updated = recalculatePlanningWithDph(initial, 3.0);
      expect(updated.targetDph).toBe(3.0);

      for (const slot of updated.slots) {
        expect(slot.deltaTurnUpVsRequired).toBe(slot.plannedTurnUp - slot.requiredRiders);
      }
    });
  });
});
