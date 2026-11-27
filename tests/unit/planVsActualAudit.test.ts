import { describe, expect, it } from 'vitest';
import {
  computePlanVsActualAudit,
  formatAuditSlotLabel,
  expandDateRange,
  fetchAvailableAuditDates,
  fetchPlanVsActualAudit,
  type RiderSlotAdherence,
  type HourlySlotReconciliation,
} from '../../src/services/planVsActualAuditService';
import type { RiderAttendanceRecord } from '../../src/services/riderAttendanceService';

describe('Plan vs Actual Attendance & Turn-Up Audit Unit Tests', () => {
  it('formats slot hours into clean 12-hour audit labels', () => {
    expect(formatAuditSlotLabel(6)).toBe('6 AM');
    expect(formatAuditSlotLabel(11)).toBe('11 AM');
    expect(formatAuditSlotLabel(12)).toBe('12 PM');
    expect(formatAuditSlotLabel(15)).toBe('3 PM');
    expect(formatAuditSlotLabel(23)).toBe('11 PM');
  });

  it('correctly calculates 1-hour late arrival when first order is in Slot 7 for a 6 AM shift', () => {
    // Scheduled Morning Shift: 6 AM to 3 PM (slots 6 to 14)
    const scheduledStart = 6;
    const scheduledEnd = 15;
    expect(scheduledEnd - scheduledStart).toBe(9);
    const scheduledSlots = [6, 7, 8, 9, 10, 11, 12, 13, 14];

    // Rider A has first order at 7:15 AM (Slot 7)
    const actualSlots = [7, 8, 9, 10, 11, 12, 13, 14];
    const firstOrderHour = Math.min(...actualSlots); // 7

    const lateArrivalHours = firstOrderHour - scheduledStart; // 7 - 6 = 1
    expect(lateArrivalHours).toBe(1);

    const missedStartingSlots = scheduledSlots.filter((h) => h < firstOrderHour);
    expect(missedStartingSlots).toEqual([6]);
  });

  it('correctly calculates 3-hour late arrival when first order is at 9:30 AM (Slot 9)', () => {
    const scheduledStart = 6;
    const scheduledSlots = [6, 7, 8, 9, 10, 11, 12, 13, 14];

    // Rider B arrived at 9 AM (Slot 9)
    const actualSlots = [9, 10, 11, 12, 13, 14];
    const firstOrderHour = Math.min(...actualSlots); // 9

    const lateArrivalHours = firstOrderHour - scheduledStart; // 9 - 6 = 3
    expect(lateArrivalHours).toBe(3);

    const missedStartingSlots = scheduledSlots.filter((h) => h < firstOrderHour);
    expect(missedStartingSlots).toEqual([6, 7, 8]);
  });

  it('identifies No-Show (False Present) when rider was marked Present but has 0 orders', () => {
    const mockRider: RiderSlotAdherence = {
      riderName: 'ABHAY GORE',
      normalizedName: 'abhay gore',
      phone: '9876543210',
      onboardedBy: 'Sanjay',
      shiftType: 'Morning Shift',
      scheduledStartHour: 6,
      scheduledEndHour: 15,
      scheduledSlots: [6, 7, 8, 9, 10, 11, 12, 13, 14],
      attendanceStatus: 'present',
      isPresentMarked: true,
      actualSlots: [],
      firstOrderHour: null,
      lastOrderHour: null,
      totalOrders: 0,
      totalHoursClocked: 0,
      lateArrivalHours: 0,
      earlyDepartureHours: 0,
      missedStartingSlots: [6, 7, 8, 9, 10, 11, 12, 13, 14],
      missedEndingSlots: [],
      allMissedSlots: [6, 7, 8, 9, 10, 11, 12, 13, 14],
      adherenceCategory: 'NO_SHOW',
      adherenceBadgeText: '🔴 No-Show',
      adherenceSeverity: 'danger',
    };

    expect(mockRider.isPresentMarked).toBe(true);
    expect(mockRider.totalOrders).toBe(0);
    expect(mockRider.adherenceCategory).toBe('NO_SHOW');
    expect(mockRider.allMissedSlots).toHaveLength(9);
  });

  it('identifies Early Departure when last order is before shift end', () => {
    // Scheduled Morning Shift: 6 AM to 3 PM (last scheduled slot is 14)
    const scheduledSlots = [6, 7, 8, 9, 10, 11, 12, 13, 14];
    const scheduledLastSlot = 14;

    // Rider left early: last order was at 12 PM (Slot 12)
    const actualSlots = [6, 7, 8, 9, 10, 11, 12];
    const lastOrderHour = Math.max(...actualSlots); // 12

    const earlyHours = scheduledLastSlot - lastOrderHour; // 14 - 12 = 2
    expect(earlyHours).toBe(2);

    const missedEndingSlots = scheduledSlots.filter((h) => h > lastOrderHour);
    expect(missedEndingSlots).toEqual([13, 14]);
  });

  it('identifies Unplanned Turn-Up when an unmarked or absent rider delivers orders', () => {
    const mockRider: RiderSlotAdherence = {
      riderName: 'ROHIT VERMA',
      normalizedName: 'rohit verma',
      phone: '9876543211',
      onboardedBy: null,
      shiftType: '2nd Shift',
      scheduledStartHour: 15,
      scheduledEndHour: 24,
      scheduledSlots: [15, 16, 17, 18, 19, 20, 21, 22, 23],
      attendanceStatus: 'absent',
      isPresentMarked: false,
      actualSlots: [15, 16, 17, 18, 19],
      firstOrderHour: 15,
      lastOrderHour: 19,
      totalOrders: 15,
      totalHoursClocked: 5,
      lateArrivalHours: 0,
      earlyDepartureHours: 0,
      missedStartingSlots: [],
      missedEndingSlots: [],
      allMissedSlots: [],
      adherenceCategory: 'UNPLANNED_TURNUP',
      adherenceBadgeText: '🟣 Unplanned Turn-Up',
      adherenceSeverity: 'info',
    };

    expect(mockRider.isPresentMarked).toBe(false);
    expect(mockRider.totalOrders).toBe(15);
    expect(mockRider.adherenceCategory).toBe('UNPLANNED_TURNUP');
  });

  it('reconciles hourly slot turn-up and identifies missing riders per slot', () => {
    // Slot 6: Planned 3 riders, but 1 was No-Show and 1 arrived late at 7 AM
    const plannedForSlot6 = ['Rider A', 'Rider B', 'Rider C'];
    const actualForSlot6 = ['Rider A']; // Only Rider A had orders in slot 6

    const missingRiders = plannedForSlot6.filter((name) => !actualForSlot6.includes(name));
    expect(missingRiders).toEqual(['Rider B', 'Rider C']);

    const plannedTurnUp = plannedForSlot6.length; // 3
    const actualTurnUp = actualForSlot6.length;   // 1
    const variance = actualTurnUp - plannedTurnUp; // -2

    const slot6Reconciliation: HourlySlotReconciliation = {
      hour: 6,
      slotLabel: '6 AM',
      plannedTurnUp,
      actualTurnUp,
      variance,
      status: variance < 0 ? 'deficit' : 'balanced',
      plannedRiders: plannedForSlot6,
      actualRiders: actualForSlot6,
      missingRiders,
      unplannedRiders: [],
    };

    expect(slot6Reconciliation.variance).toBe(-2);
    expect(slot6Reconciliation.status).toBe('deficit');
    expect(slot6Reconciliation.missingRiders).toHaveLength(2);
  });

  describe('Historical Date Expansion & Audit Data Availability', () => {
    it('expands multi-day date range inclusive in descending order', () => {
      const dates = expandDateRange('2026-10-31', '2026-11-06');
      expect(dates).toHaveLength(7);
      expect(dates[0]).toBe('2026-11-06');
      expect(dates[6]).toBe('2026-10-31');
      expect(dates).toEqual([
        '2026-11-06',
        '2026-11-05',
        '2026-11-04',
        '2026-11-03',
        '2026-11-02',
        '2026-11-01',
        '2026-10-31',
      ]);
    });

    it('expands single-day date range correctly', () => {
      const dates = expandDateRange('2026-11-05', '2026-11-05');
      expect(dates).toEqual(['2026-11-05']);
    });

    it('handles inverted or invalid date ranges gracefully', () => {
      expect(expandDateRange('2026-11-06', '2026-11-01')).toEqual([]);
      expect(expandDateRange('', '2026-11-06')).toEqual([]);
      expect(expandDateRange('invalid', '2026-11-06')).toEqual([]);
    });

    it('fetches available audit dates including past historical dates', async () => {
      const dates = await fetchAvailableAuditDates('test-store-id', 'Asia/Kolkata', 'TMK7');
      expect(dates.length).toBeGreaterThanOrEqual(14);
      // Confirms all elements are YYYY-MM-DD
      for (const d of dates) {
        expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      // Confirms descending order
      for (let i = 0; i < dates.length - 1; i++) {
        expect(dates[i] >= dates[i + 1]).toBe(true);
      }
    });

    it('marks hasOrderData as false and totalOrdersCount as 0 when no orders exist for date', async () => {
      const res = await fetchPlanVsActualAudit({
        storeId: 'test-store-id',
        warehouseId: 'TMK7',
        dateStr: '2020-01-01', // date in the distant past with zero orders
      });
      expect(res.data).not.toBeNull();
      if (res.data) {
        expect(res.data.hasOrderData).toBe(false);
        expect(res.data.totalOrdersCount).toBe(0);
      }
    });

    it('reconciles Split Shift break slots, UNASSIGNED shifts, and planned turn-up rate accurately', () => {
      const attendanceRecords: RiderAttendanceRecord[] = [
        // 1. Split Shift rider (8 AM - 2 PM & 5 PM - 11 PM, off during slots 14, 15, 16)
        {
          warehouseId: 'TPE2',
          attendanceDate: '2026-11-20',
          riderName: 'Split Rider',
          normalizedName: 'split rider',
          shiftType: 'Split Shift',
          slot1StartHour: 8,
          slot1EndHour: 14,
          slot2StartHour: 17,
          slot2EndHour: 23,
          status: 'present',
          isPresent: true,
        },
        // 2. No-Show Morning rider (marked present, 0 orders)
        {
          warehouseId: 'TPE2',
          attendanceDate: '2026-11-20',
          riderName: 'NoShow Rider',
          normalizedName: 'noshow rider',
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          status: 'present',
          isPresent: true,
        },
        // 3. UNASSIGNED shift rider marked Present (must NOT generate fake 6-15 slots)
        {
          warehouseId: 'TPE2',
          attendanceDate: '2026-11-20',
          riderName: 'Unassigned Present',
          normalizedName: 'unassigned present',
          shiftType: 'UNASSIGNED',
          slot1StartHour: 6,
          slot1EndHour: 14,
          status: 'present',
          isPresent: true,
        },
        // 4. Absent rider who actually worked (Unplanned Turn-Up)
        {
          warehouseId: 'TPE2',
          attendanceDate: '2026-11-20',
          riderName: 'Unplanned Worker',
          normalizedName: 'unplanned worker',
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          status: 'absent',
          isPresent: false,
        },
      ];

      const orderRows = [
        // Split Rider works exact split slots: 8..13 and 17..22 (NOT 14, 15, 16)
        ...[8, 9, 10, 11, 12, 13, 17, 18, 19, 20, 21, 22].map((h, i) => ({
          rider_name: 'Split Rider',
          slot_hour: h,
          order_id: `split-${i}`,
        })),
        // Unassigned Present delivers in slot 10
        { rider_name: 'Unassigned Present', slot_hour: 10, order_id: 'unassigned-1' },
        // Unplanned Worker delivers in slot 9
        { rider_name: 'Unplanned Worker', slot_hour: 9, order_id: 'unplanned-1' },
      ];

      const summary = computePlanVsActualAudit({
        storeId: 'store-tpe2',
        warehouseId: 'TPE2',
        dateStr: '2026-11-20',
        attendanceRecords,
        orderRows,
      });

      // Planned Turn-Up Rate: 2 of 3 marked Present worked (Split Rider + Unassigned Present) = 67%, NOT 100%
      expect(summary.plannedPresentCount).toBe(3);
      expect(summary.plannedWorkedCount).toBe(2);
      expect(summary.actualWorkedCount).toBe(3);
      expect(summary.noShowCount).toBe(1);
      expect(summary.unplannedTurnUpCount).toBe(1);
      expect(summary.turnUpRatePct).toBe(67);

      // Split Rider must be Compliant with 0 missed slots and accurate split timings label
      const splitAudit = summary.riders.find((r) => r.normalizedName === 'split rider');
      expect(splitAudit?.adherenceCategory).toBe('COMPLIANT');
      expect(splitAudit?.allMissedSlots).toEqual([]);
      expect(splitAudit?.shiftTimingsLabel).toContain('&');

      // Mid-day break slot 15 must NOT count Split Rider or Unassigned Present as planned or missing!
      const slot15 = summary.hourlySlots.find((s) => s.hour === 15);
      expect(slot15?.plannedTurnUp).toBe(0);
      expect(slot15?.missingRiders).toEqual([]);

      // Slot 6 must ONLY count NoShow Rider (NOT Unassigned Present)
      const slot6 = summary.hourlySlots.find((s) => s.hour === 6);
      expect(slot6?.plannedRiders).toEqual(['NoShow Rider']);
      expect(slot6?.missingRiders).toEqual(['NoShow Rider']);
    });
  });
});
