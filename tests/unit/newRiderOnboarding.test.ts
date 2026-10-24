import { describe, expect, it } from 'vitest';
import {
  formatDayHeader,
  getDayOfWeekName,
  getFirst7CalendarDates,
} from '../../src/services/newRiderOnboardingService';

describe('New Rider Onboarding Service Unit Tests', () => {
  it('generates exactly 7 consecutive calendar dates starting from joining date', () => {
    const dates = getFirst7CalendarDates('2026-10-18');
    expect(dates).toHaveLength(7);
    expect(dates).toEqual([
      '2026-10-18', // Day 1
      '2026-10-19', // Day 2
      '2026-10-20', // Day 3
      '2026-10-21', // Day 4
      '2026-10-22', // Day 5
      '2026-10-23', // Day 6
      '2026-10-24', // Day 7
    ]);
  });

  it('correctly handles month boundary when calculating 7 calendar days', () => {
    const dates = getFirst7CalendarDates('2026-10-28');
    expect(dates).toHaveLength(7);
    expect(dates).toEqual([
      '2026-10-28', // Day 1
      '2026-10-29', // Day 2
      '2026-10-30', // Day 3
      '2026-10-31', // Day 4
      '2026-11-01', // Day 5
      '2026-11-02', // Day 6
      '2026-11-03', // Day 7
    ]);
  });

  it('formats dates into DD-MMM headers matching operations convention', () => {
    expect(formatDayHeader('2026-10-18')).toBe('18-Oct');
    expect(formatDayHeader('2026-11-01')).toBe('01-Nov');
    expect(formatDayHeader('2026-12-25')).toBe('25-Dec');
  });

  it('computes correct day of week for calendar dates', () => {
    // 2026-10-18 is Sunday
    expect(getDayOfWeekName('2026-10-18')).toBe('Sun');
    // 2026-10-19 is Monday
    expect(getDayOfWeekName('2026-10-19')).toBe('Mon');
    // 2026-10-24 is Saturday
    expect(getDayOfWeekName('2026-10-24')).toBe('Sat');
  });

  it('determines 7-day cohort cutoff threshold correctly', () => {
    // Given today is 2026-10-24, a 7-day cutoff is 2026-10-17
    const todayUtc = Date.UTC(2026, 9, 24, 12, 0, 0); // month 9 is Oct (0-indexed)
    const cutoffUtc = todayUtc - 7 * 86400000;
    const cDate = new Date(cutoffUtc);
    const cutoffStr = `${cDate.getUTCFullYear()}-${String(cDate.getUTCMonth() + 1).padStart(2, '0')}-${String(cDate.getUTCDate()).padStart(2, '0')}`;
    expect(cutoffStr).toBe('2026-10-17');

    // Riders starting on or after 2026-10-17 are inside the 7-day window
    expect('2026-10-18' >= cutoffStr).toBe(true);
    expect('2026-10-17' >= cutoffStr).toBe(true);
    // Riders starting before 2026-10-17 are outside the 7-day window
    expect('2026-10-16' >= cutoffStr).toBe(false);
    expect('2026-10-09' >= cutoffStr).toBe(false);
  });
});
