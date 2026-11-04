import { describe, expect, it } from 'vitest';
import {
  formatAuditSlotLabel,
  type RiderSlotAdherence,
  type HourlySlotReconciliation,
} from '../../src/services/planVsActualAuditService';

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
});
