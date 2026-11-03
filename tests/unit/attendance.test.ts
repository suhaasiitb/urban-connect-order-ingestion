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
  getRidersForSlot,
  isRiderWorkingInSlot,
  saveStoreRiderAttendance,
  subscribeStoreRiderAttendance,
  syncAttendanceWithLatestShifts,
} from '../../src/services/riderAttendanceService';
import { fetchPlanningForDate, recalculatePlanningWithDph } from '../../src/services/planningService';
import {
  type RiderShiftConfig,
  saveSingleRiderShift,
  STORE_RIDER_SHIFTS_CHANGED_EVENT,
} from '../../src/services/riderShiftService';

// Polyfill window.localStorage and EventTarget for Node environment if missing
if (typeof window === 'undefined') {
  const store: Record<string, string> = {};
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  (global as unknown as { window: Record<string, unknown> }).window = {
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
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((cb) => cb !== fn);
      }
    },
    dispatchEvent: (event: { type: string }) => {
      if (listeners[event.type]) {
        for (const fn of listeners[event.type]) {
          fn(event);
        }
      }
      return true;
    },
  };
  (global as unknown as Record<string, unknown>).CustomEvent = class CustomEvent {
    type: string;
    detail: unknown;
    constructor(type: string, params?: { detail?: unknown }) {
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

    it('guarantees date isolation: saving for Date A does not contaminate Date B, which starts fresh and unmarked', async () => {
      // 1. Mark Nov 2nd with 10 Present riders
      const nov2Records: RiderAttendanceRecord[] = [
        {
          warehouseId: 'TMK7',
          attendanceDate: '2026-11-02',
          riderName: 'Rider Alpha',
          normalizedName: 'rider alpha',
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          status: 'present',
          isPresent: true,
          updatedBy: 'admin@urbanconnect.in',
        },
      ];

      const saveRes = await saveStoreRiderAttendance({
        storeId: 'test-store-id',
        warehouseId: 'TMK7',
        attendanceDate: '2026-11-02',
        records: nov2Records,
        updatedBy: 'admin@urbanconnect.in',
      });
      expect(saveRes.ok).toBe(true);

      // 2. Fetch Nov 3rd attendance - it must be completely fresh (0 Present)
      const nov3Summary = await fetchStoreRiderAttendance({
        storeId: 'test-store-id',
        warehouseId: 'TMK7',
        attendanceDate: '2026-11-03',
      });
      expect(nov3Summary.presentCount).toBe(0);
      expect(nov3Summary.attendanceDate).toBe('2026-11-03');

      // 3. Fetch Nov 2nd back - it must retain its saved marked attendance and audit metadata
      const nov2Summary = await fetchStoreRiderAttendance({
        storeId: 'test-store-id',
        warehouseId: 'TMK7',
        attendanceDate: '2026-11-02',
      });
      expect(nov2Summary.presentCount).toBe(1);
      expect(nov2Summary.records[0].status).toBe('present');
      expect(nov2Summary.updatedBy).toBe('admin@urbanconnect.in');
      expect(nov2Summary.lastUpdated).toBeDefined();
    });
  });

  describe('6. Shift Timing Synchronization, Dynamic Turn-Up Recalibration & Slot Breakdown', () => {
    it('synchronizes attendance records with the latest shiftsMap updates', () => {
      const records: RiderAttendanceRecord[] = [
        {
          warehouseId: 'TPE2',
          attendanceDate: '2026-11-02',
          riderName: 'ABHAY GORE',
          normalizedName: 'abhay gore',
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          status: 'unmarked',
          isPresent: false,
        },
      ];

      const shiftsMap = new Map<string, RiderShiftConfig>();
      shiftsMap.set('abhay gore', {
        riderName: 'ABHAY GORE',
        normalizedName: 'abhay gore',
        shiftType: '2nd Shift',
        slot1StartHour: 15,
        slot1EndHour: 24,
        totalPlannedHours: 9,
        onboardedBy: 'Sunil',
      });

      const synced = syncAttendanceWithLatestShifts(records, shiftsMap);
      expect(synced[0].shiftType).toBe('2nd Shift');
      expect(synced[0].slot1StartHour).toBe(15);
      expect(synced[0].slot1EndHour).toBe(24);
      expect(synced[0].onboardedBy).toBe('Sunil');
    });

    it('recalibrates hourly slot turn-up dynamically when shift timings change', () => {
      // Initially Rider 1 is on Morning Shift (6-15), Rider 2 is on 2nd Shift (15-24)
      const records: RiderAttendanceRecord[] = [
        {
          warehouseId: 'TPE2',
          attendanceDate: '2026-11-02',
          riderName: 'Rider 1',
          normalizedName: 'rider 1',
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          status: 'unmarked',
          isPresent: false,
        },
        {
          warehouseId: 'TPE2',
          attendanceDate: '2026-11-02',
          riderName: 'Rider 2',
          normalizedName: 'rider 2',
          shiftType: '2nd Shift',
          slot1StartHour: 15,
          slot1EndHour: 24,
          status: 'unmarked',
          isPresent: false,
        },
      ];

      // With fallbackToRosterIfUnmarked: true, Slot 6 has 1 rider, Slot 15 has 1 rider
      const initialTurnUp = calculateSlotTurnUpFromAttendance(records, {
        fallbackToRosterIfUnmarked: true,
      });
      expect(initialTurnUp[6]).toBe(1);
      expect(initialTurnUp[15]).toBe(1);

      // Now Rider 1 is edited to 2nd Shift (15-24)
      const shiftsMap = new Map<string, RiderShiftConfig>();
      shiftsMap.set('rider 1', {
        riderName: 'Rider 1',
        normalizedName: 'rider 1',
        shiftType: '2nd Shift',
        slot1StartHour: 15,
        slot1EndHour: 24,
        totalPlannedHours: 9,
        onboardedBy: 'Atharva',
      });

      const recalibratedRecords = syncAttendanceWithLatestShifts(records, shiftsMap);
      const recalibratedTurnUp = calculateSlotTurnUpFromAttendance(recalibratedRecords, {
        fallbackToRosterIfUnmarked: true,
      });

      // Slot 6 now has 0 riders (Rider 1 moved to evening)
      expect(recalibratedTurnUp[6]).toBe(0);
      // Slot 15 now has 2 riders
      expect(recalibratedTurnUp[15]).toBe(2);
    });

    it('returns exact list of riders active in a slot with onboardedBy, shift timings, and status', () => {
      const records: RiderAttendanceRecord[] = [
        {
          warehouseId: 'TPE2',
          attendanceDate: '2026-11-02',
          riderName: 'Abdul Raheem salmani',
          normalizedName: 'abdul raheem salmani',
          phone: '8429891727',
          shiftType: '2nd Shift',
          slot1StartHour: 16,
          slot1EndHour: 24,
          status: 'unmarked',
          isPresent: false,
          onboardedBy: 'Krushna',
        },
        {
          warehouseId: 'TPE2',
          attendanceDate: '2026-11-02',
          riderName: 'ABHAY GORE',
          normalizedName: 'abhay gore',
          phone: '8530615177',
          shiftType: '2nd Shift',
          slot1StartHour: 15,
          slot1EndHour: 24,
          status: 'unmarked',
          isPresent: false,
          onboardedBy: 'Sunil',
        },
        {
          warehouseId: 'TPE2',
          attendanceDate: '2026-11-02',
          riderName: 'ABHIJEET WAGH',
          normalizedName: 'abhijeet wagh',
          phone: '7499579269',
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 14,
          status: 'unmarked',
          isPresent: false,
          onboardedBy: 'FM1',
        },
      ];

      // Query Slot 16 (4 PM)
      const slot16Riders = getRidersForSlot(records, 16, { fallbackToRosterIfUnmarked: true });
      expect(slot16Riders.length).toBe(2);
      expect(slot16Riders.map((r) => r.riderName)).toContain('Abdul Raheem salmani');
      expect(slot16Riders.map((r) => r.riderName)).toContain('ABHAY GORE');
      expect(slot16Riders.map((r) => r.riderName)).not.toContain('ABHIJEET WAGH');

      const abhay = slot16Riders.find((r) => r.riderName === 'ABHAY GORE');
      expect(abhay?.onboardedBy).toBe('Sunil');
      expect(abhay?.isCountedInTurnUp).toBe(true);
      expect(abhay?.timingsFormatted).toBe('3 PM – 12 AM');

      // Query Slot 6 (6 AM)
      const slot6Riders = getRidersForSlot(records, 6, { fallbackToRosterIfUnmarked: true });
      expect(slot6Riders.length).toBe(1);
      expect(slot6Riders[0].riderName).toBe('ABHIJEET WAGH');
      expect(slot6Riders[0].onboardedBy).toBe('FM1');
      expect(slot6Riders[0].timingsFormatted).toBe('6 AM – 2 PM');
    });

    it('dispatches store_rider_shifts_changed event when saving individual rider shift', async () => {
      let notifiedStoreId: string | null = null;
      const listener = (e: unknown) => {
        const custom = e as { detail?: { storeId?: string } };
        notifiedStoreId = custom.detail?.storeId ?? null;
      };

      window.addEventListener(STORE_RIDER_SHIFTS_CHANGED_EVENT, listener);

      await saveSingleRiderShift({
        storeId: 'test-store-123',
        shift: {
          riderName: 'Test Rider',
          normalizedName: 'test rider',
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          totalPlannedHours: 9,
          onboardedBy: 'FM2',
        },
      });

      expect(notifiedStoreId).toBe('test-store-123');
      window.removeEventListener(STORE_RIDER_SHIFTS_CHANGED_EVENT, listener);
    });
  });
});
