import { describe, expect, it } from 'vitest';
import {
  ONBOARDED_BY_OPTIONS,
  SHIFT_PRESETS,
  calculatePlannedHours,
  classifyShiftType,
  formatHour,
  formatShiftTimings,
  getActiveRidersWithoutShift,
  getRiderShiftsForStore,
  saveRiderShiftsForStore,
  saveSingleRiderShift,
  deleteSingleRiderShift,
  cacheSingleRiderShiftLocally,
  type RiderShiftConfig,
} from '../../src/services/riderShiftService';

// Polyfill window.localStorage for Node environment if missing
if (typeof window === 'undefined' || !window.localStorage) {
  const memStore: Record<string, string> = {};
  const mockStorage = {
    getItem: (key: string) => memStore[key] ?? null,
    setItem: (key: string, val: string) => {
      memStore[key] = String(val);
    },
    removeItem: (key: string) => {
      delete memStore[key];
    },
    clear: () => {
      Object.keys(memStore).forEach((k) => delete memStore[k]);
    },
    length: 0,
    key: () => null,
  };
  (global as unknown as { localStorage: Storage; window: { localStorage: Storage } }).localStorage = mockStorage as Storage;
  (global as unknown as { window: { localStorage: Storage } }).window = { localStorage: mockStorage as Storage };
}

describe('Rider Shift & 8-Hour Mandatory Compliance Unit Tests', () => {
  it('formats hours from 0-24 into human-friendly AM/PM strings', () => {
    expect(formatHour(6)).toBe('6 AM');
    expect(formatHour(10)).toBe('10 AM');
    expect(formatHour(12)).toBe('12 PM');
    expect(formatHour(14)).toBe('2 PM');
    expect(formatHour(15)).toBe('3 PM');
    expect(formatHour(18)).toBe('6 PM');
    expect(formatHour(22)).toBe('10 PM');
    expect(formatHour(24)).toBe('12 AM');
    expect(formatHour(0)).toBe('12 AM');
  });

  it('formats shift timings correctly for single and split shifts', () => {
    // Single Morning Shift (6 AM – 3 PM)
    const morning = {
      slot1StartHour: 6,
      slot1EndHour: 15,
    };
    expect(formatShiftTimings(morning)).toBe('6 AM – 3 PM');

    // Single 2nd Shift (3 PM – 12 AM)
    const secondShift = {
      slot1StartHour: 15,
      slot1EndHour: 24,
    };
    expect(formatShiftTimings(secondShift)).toBe('3 PM – 12 AM');

    // Split Shift: 6-10 AM and 6-10 PM
    const splitShift = {
      slot1StartHour: 6,
      slot1EndHour: 10,
      slot2StartHour: 18,
      slot2EndHour: 22,
    };
    expect(formatShiftTimings(splitShift)).toBe('6 AM – 10 AM & 6 PM – 10 PM');
  });

  it('accurately calculates planned hours for single and split shifts', () => {
    // Morning: 6 AM to 3 PM (9h)
    expect(
      calculatePlannedHours({
        slot1StartHour: 6,
        slot1EndHour: 15,
      })
    ).toBe(9);

    // 2nd Shift: 3 PM to 12 AM (9h)
    expect(
      calculatePlannedHours({
        slot1StartHour: 15,
        slot1EndHour: 24,
      })
    ).toBe(9);

    // 7 AM to 3 PM (8h)
    expect(
      calculatePlannedHours({
        slot1StartHour: 7,
        slot1EndHour: 15,
      })
    ).toBe(8);

    // Split Shift: 6-10 AM (4h) + 6-10 PM (4h) = 8h
    expect(
      calculatePlannedHours({
        slot1StartHour: 6,
        slot1EndHour: 10,
        slot2StartHour: 18,
        slot2EndHour: 22,
      })
    ).toBe(8);

    // Part-time custom: 9 AM to 2 PM (5h)
    expect(
      calculatePlannedHours({
        slot1StartHour: 9,
        slot1EndHour: 14,
      })
    ).toBe(5);

    // Split Shift: 8 AM to 3 PM (7h) & 4 PM to 12 AM (8h) = 15h
    expect(
      calculatePlannedHours({
        slot1StartHour: 8,
        slot1EndHour: 15,
        slot2StartHour: 16,
        slot2EndHour: 24,
      })
    ).toBe(15);

    // Split Shift wrapping at midnight (slot2EndHour = 0)
    expect(
      calculatePlannedHours({
        slot1StartHour: 8,
        slot1EndHour: 15,
        slot2StartHour: 16,
        slot2EndHour: 0,
      })
    ).toBe(15);
  });

  it('verifies all standard shift presets fulfill the mandatory 8-hour shift target', () => {
    for (const [, preset] of Object.entries(SHIFT_PRESETS)) {
      const hours = calculatePlannedHours({
        slot1StartHour: preset.slot1Start,
        slot1EndHour: preset.slot1End,
        slot2StartHour: preset.slot2Start,
        slot2EndHour: preset.slot2End,
      });

      expect(hours).toBe(preset.hours);
      expect(hours >= 8).toBe(true);
    }
  });

  it('correctly classifies shift types adhering strictly to Morning, 2nd, and Split', () => {
    // 7 AM – 3 PM must be Morning Shift, NOT 2nd Shift
    expect(
      classifyShiftType({
        slot1StartHour: 7,
        slot1EndHour: 15,
      })
    ).toBe('Morning Shift');

    // 6 AM – 3 PM is Morning Shift
    expect(
      classifyShiftType({
        slot1StartHour: 6,
        slot1EndHour: 15,
      })
    ).toBe('Morning Shift');

    // 6 AM – 2 PM is Morning Shift
    expect(
      classifyShiftType({
        slot1StartHour: 6,
        slot1EndHour: 14,
      })
    ).toBe('Morning Shift');

    // 3 PM – 12 AM is 2nd Shift
    expect(
      classifyShiftType({
        slot1StartHour: 15,
        slot1EndHour: 24,
      })
    ).toBe('2nd Shift');

    // 4 PM – 12 AM is 2nd Shift
    expect(
      classifyShiftType({
        slot1StartHour: 16,
        slot1EndHour: 0,
      })
    ).toBe('2nd Shift');

    // 6 AM – 12 PM & 9 PM – 11 PM must be tagged as Split Shift (NOT Custom)
    expect(
      classifyShiftType({
        slot1StartHour: 6,
        slot1EndHour: 12,
        slot2StartHour: 21,
        slot2EndHour: 23,
      })
    ).toBe('Split Shift');

    // 6 AM – 3 PM & 3 PM – 12 AM is Split Shift
    expect(
      classifyShiftType({
        slot1StartHour: 6,
        slot1EndHour: 15,
        slot2StartHour: 15,
        slot2EndHour: 24,
      })
    ).toBe('Split Shift');

    // Single slot spanning morning and second shift (e.g. 8 AM to 8 PM) is Split Shift
    expect(
      classifyShiftType({
        slot1StartHour: 8,
        slot1EndHour: 20,
      })
    ).toBe('Split Shift');
  });

  it('identifies 8-hour compliance thresholds for clocked daily hours', () => {
    const isCompliant = (dailyAvgHours: number) => dailyAvgHours >= 8.0;

    // Full 8-hour compliance
    expect(isCompliant(8.0)).toBe(true);
    expect(isCompliant(8.5)).toBe(true);
    expect(isCompliant(10.0)).toBe(true);

    // Below 8-hour mandatory threshold
    expect(isCompliant(7.9)).toBe(false);
    expect(isCompliant(5.2)).toBe(false);
    expect(isCompliant(0)).toBe(false);
  });

  describe('Onboarded By Field & Active Rider Missing Shift Warning Suite', () => {
    it('defines the required Onboarded By dropdown options: Sunil, Atharva, Krushna, FM1, FM2', () => {
      expect(ONBOARDED_BY_OPTIONS).toEqual([
        'Sunil',
        'Atharva',
        'Krushna',
        'FM1',
        'FM2',
      ]);
      expect(ONBOARDED_BY_OPTIONS).toHaveLength(5);
    });

    it('identifies active riders whose shift is empty using getActiveRidersWithoutShift', () => {
      const activeRoster = [
        { name: 'Rider Alpha' },
        { name: 'Rider Beta' },
        { name: 'Rider Gamma' },
      ];

      const shiftsMap = new Map<string, RiderShiftConfig>();
      // Only Rider Alpha has a configured shift
      shiftsMap.set('rider alpha', {
        riderName: 'Rider Alpha',
        normalizedName: 'rider alpha',
        shiftType: 'Morning Shift',
        slot1StartHour: 6,
        slot1EndHour: 15,
        totalPlannedHours: 9,
        onboardedBy: 'Sunil',
      });

      const missing = getActiveRidersWithoutShift(activeRoster, shiftsMap);
      expect(missing).toEqual(['Rider Beta', 'Rider Gamma']);
      expect(missing).toHaveLength(2);
    });

    it('returns empty array when all active riders have configured shifts', () => {
      const activeRoster = ['Rider One', 'Rider Two'];
      const shiftsMap = new Map<string, RiderShiftConfig>([
        ['rider one', {
          riderName: 'Rider One',
          normalizedName: 'rider one',
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          totalPlannedHours: 9,
          onboardedBy: 'Atharva',
        }],
        ['rider two', {
          riderName: 'Rider Two',
          normalizedName: 'rider two',
          shiftType: '2nd Shift',
          slot1StartHour: 15,
          slot1EndHour: 24,
          totalPlannedHours: 9,
          onboardedBy: 'Krushna',
        }],
      ]);

      const missing = getActiveRidersWithoutShift(activeRoster, shiftsMap);
      expect(missing).toHaveLength(0);
    });

    it('persists and retrieves onboardedBy in dual persistence layer', async () => {
      const testStoreId = '00000000-0000-0000-0000-000000000099';
      const testShifts: RiderShiftConfig[] = [
        {
          riderName: 'Test Rider FM1',
          normalizedName: 'test rider fm1',
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          totalPlannedHours: 9,
          joiningDate: '2026-10-25',
          onboardedBy: 'FM1',
        },
        {
          riderName: 'Test Rider FM2',
          normalizedName: 'test rider fm2',
          shiftType: '2nd Shift',
          slot1StartHour: 15,
          slot1EndHour: 24,
          totalPlannedHours: 9,
          joiningDate: '2026-10-26',
          onboardedBy: 'FM2',
        },
      ];

      // Save shifts
      await saveRiderShiftsForStore({
        storeId: testStoreId,
        shifts: testShifts,
      });

      // Retrieve shifts
      const loaded = await getRiderShiftsForStore(testStoreId);
      expect(loaded.has('test rider fm1')).toBe(true);
      expect(loaded.has('test rider fm2')).toBe(true);

      const r1 = loaded.get('test rider fm1');
      expect(r1?.onboardedBy).toBe('FM1');
      expect(r1?.shiftType).toBe('Morning Shift');

      const r2 = loaded.get('test rider fm2');
      expect(r2?.onboardedBy).toBe('FM2');
      expect(r2?.shiftType).toBe('2nd Shift');
    });
  });

  describe('Individual Rider Shift Assignment & Inline Editing Suite', () => {
    const testStoreId = '00000000-0000-0000-0000-000000000088';

    it('assigns and updates an individual rider shift without wiping other riders', async () => {
      // 1. Assign first rider shift
      const riderA: RiderShiftConfig = {
        riderName: 'Abhay Gore',
        normalizedName: 'abhay gore',
        shiftType: '2nd Shift',
        slot1StartHour: 15,
        slot1EndHour: 24,
        totalPlannedHours: 9,
        onboardedBy: 'Sunil',
        referredBy: 'Krushna',
        referredPhone: '9876543210',
      };
      const resA = await saveSingleRiderShift({ storeId: testStoreId, shift: riderA });
      expect(resA.ok).toBe(true);

      // Verify rider A is saved
      let map = await getRiderShiftsForStore(testStoreId);
      expect(map.has('abhay gore')).toBe(true);
      expect(map.get('abhay gore')?.shiftType).toBe('2nd Shift');
      expect(map.get('abhay gore')?.onboardedBy).toBe('Sunil');
      expect(map.get('abhay gore')?.referredBy).toBe('Krushna');
      expect(map.get('abhay gore')?.referredPhone).toBe('9876543210');

      // 2. Assign second rider shift
      const riderB: RiderShiftConfig = {
        riderName: 'Abhijit Dhonde',
        normalizedName: 'abhijit dhonde',
        shiftType: 'Split Shift',
        slot1StartHour: 14,
        slot1EndHour: 22,
        totalPlannedHours: 8,
        onboardedBy: 'Atharva',
      };
      const resB = await saveSingleRiderShift({ storeId: testStoreId, shift: riderB });
      expect(resB.ok).toBe(true);

      // Verify both riders exist
      map = await getRiderShiftsForStore(testStoreId);
      expect(map.has('abhay gore')).toBe(true);
      expect(map.has('abhijit dhonde')).toBe(true);
      expect(map.get('abhijit dhonde')?.shiftType).toBe('Split Shift');

      // 3. Edit rider A's shift to Morning Shift
      const updatedA: RiderShiftConfig = {
        ...riderA,
        shiftType: 'Morning Shift',
        slot1StartHour: 6,
        slot1EndHour: 15,
        totalPlannedHours: 9,
        onboardedBy: 'Krushna',
      };
      await saveSingleRiderShift({ storeId: testStoreId, shift: updatedA });

      map = await getRiderShiftsForStore(testStoreId);
      expect(map.get('abhay gore')?.shiftType).toBe('Morning Shift');
      expect(map.get('abhay gore')?.onboardedBy).toBe('Krushna');
      // Verify rider B is still intact
      expect(map.has('abhijit dhonde')).toBe(true);
      expect(map.get('abhijit dhonde')?.shiftType).toBe('Split Shift');
      expect(map.get('abhijit dhonde')?.onboardedBy).toBe('Atharva');
    });

    it('unassigns an individual rider shift cleanly via deleteSingleRiderShift', async () => {
      // Unassign rider A
      const delRes = await deleteSingleRiderShift({
        storeId: testStoreId,
        riderName: 'Abhay Gore',
      });
      expect(delRes.ok).toBe(true);

      const map = await getRiderShiftsForStore(testStoreId);
      expect(map.has('abhay gore')).toBe(false);
      // Rider B remains intact
      expect(map.has('abhijit dhonde')).toBe(true);
    });

    it('verifies split shift preset is 8 hours (2 PM – 10 PM) for operational alignment', () => {
      const splitPreset = SHIFT_PRESETS['Split Shift'];
      expect(splitPreset.hours).toBe(8);
      expect(splitPreset.slot1Start).toBe(14);
      expect(splitPreset.slot1End).toBe(22);
      expect(formatShiftTimings({ slot1StartHour: 14, slot1EndHour: 22 })).toBe('2 PM – 10 PM');
    });

    it('preserves referrals across immediate page refresh via cacheSingleRiderShiftLocally and partial batch saves', async () => {
      const referralStoreId = 'test-referral-store-001';

      // 1. User types referral on mobile -> immediately cached locally before network completes
      cacheSingleRiderShiftLocally({
        storeId: referralStoreId,
        shift: {
          riderName: 'Sagar Patil',
          normalizedName: 'sagar patil',
          shiftType: 'Morning Shift',
          slot1StartHour: 6,
          slot1EndHour: 15,
          totalPlannedHours: 9,
          referredBy: 'Sunil',
          referredPhone: '9123456789',
        },
      });

      // Simulate page refresh on mobile
      let map = await getRiderShiftsForStore(referralStoreId);
      expect(map.get('sagar patil')?.referredBy).toBe('Sunil');
      expect(map.get('sagar patil')?.referredPhone).toBe('9123456789');

      // 2. Partial batch save of a second rider's referral must NOT wipe the first rider
      await saveRiderShiftsForStore({
        storeId: referralStoreId,
        shifts: [
          {
            riderName: 'Rohan More',
            normalizedName: 'rohan more',
            shiftType: '2nd Shift',
            slot1StartHour: 15,
            slot1EndHour: 24,
            totalPlannedHours: 9,
            referredBy: 'Atharva',
            referredPhone: '9988776655',
          },
        ],
      });

      map = await getRiderShiftsForStore(referralStoreId);
      expect(map.get('sagar patil')?.referredBy).toBe('Sunil');
      expect(map.get('sagar patil')?.referredPhone).toBe('9123456789');
      expect(map.get('rohan more')?.referredBy).toBe('Atharva');
      expect(map.get('rohan more')?.referredPhone).toBe('9988776655');
    });
  });
});
