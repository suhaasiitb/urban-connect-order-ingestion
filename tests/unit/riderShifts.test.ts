import { describe, expect, it } from 'vitest';
import {
  SHIFT_PRESETS,
  calculatePlannedHours,
  formatHour,
  formatShiftTimings,
} from '../../src/services/riderShiftService';

describe('Rider Shift & 8-Hour Mandatory Compliance Unit Tests', () => {
  it('formats hours from 0-24 into human-friendly AM/PM strings', () => {
    expect(formatHour(6)).toBe('6 AM');
    expect(formatHour(10)).toBe('10 AM');
    expect(formatHour(12)).toBe('12 PM');
    expect(formatHour(14)).toBe('2 PM');
    expect(formatHour(18)).toBe('6 PM');
    expect(formatHour(22)).toBe('10 PM');
    expect(formatHour(24)).toBe('12 AM');
    expect(formatHour(0)).toBe('12 AM');
  });

  it('formats shift timings correctly for single and split shifts', () => {
    // Single Morning Shift
    const morning = {
      slot1StartHour: 6,
      slot1EndHour: 14,
    };
    expect(formatShiftTimings(morning)).toBe('6 AM – 2 PM');

    // Single 2nd Shift
    const secondShift = {
      slot1StartHour: 14,
      slot1EndHour: 22,
    };
    expect(formatShiftTimings(secondShift)).toBe('2 PM – 10 PM');

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
    // Morning: 6 AM to 2 PM (8h)
    expect(
      calculatePlannedHours({
        slot1StartHour: 6,
        slot1EndHour: 14,
      })
    ).toBe(8);

    // 2nd Shift: 2 PM to 10 PM (8h)
    expect(
      calculatePlannedHours({
        slot1StartHour: 14,
        slot1EndHour: 22,
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
  });

  it('verifies all standard shift presets fulfill the mandatory 8-hour shift target', () => {
    for (const [, preset] of Object.entries(SHIFT_PRESETS)) {
      const hours = calculatePlannedHours({
        slot1StartHour: preset.slot1Start,
        slot1EndHour: preset.slot1End,
        slot2StartHour: preset.slot2Start,
        slot2EndHour: preset.slot2End,
      });

      expect(hours).toBe(8);
      expect(preset.hours).toBe(8);
      expect(hours >= 8).toBe(true);
    }
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
});
