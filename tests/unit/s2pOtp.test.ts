import { describe, expect, it } from 'vitest';
import {
  buildSummaryFromRawOrders,
  buildSummaryFromRpcRows,
  formatDateToHeader,
  formatSlotHourLabel,
  getDayOfWeekName,
  getDphImpactedSlots,
  invalidateS2POtpCache,
} from '../../src/services/s2pOtpService';

describe('S2P, OTP & DPH Analytics Calculations & Formatting', () => {
  it('formats slot hours and dates accurately', () => {
    expect(formatSlotHourLabel(6)).toBe('06:00 – 07:00');
    expect(formatSlotHourLabel(18)).toBe('18:00 – 19:00');
    expect(formatSlotHourLabel(23)).toBe('23:00 – 00:00');

    expect(formatDateToHeader('2026-10-19')).toBe('19-Oct');
    expect(formatDateToHeader('2026-10-06')).toBe('06-Oct');

    expect(getDayOfWeekName('2026-10-19')).toBe('Mon');
    expect(getDayOfWeekName('2026-10-25')).toBe('Sun');
  });

  it('accurately computes DPH, S2P and OTP+3 matching the user reference pivots', () => {
    // Reference numbers from the user screenshot pivots (Image 1, 2, 3)
    const slotMetrics = [
      { slotHour: 0, orders: 1, riders: 1, s2pMinutesSum: 0.04, otpAch: 1, otpBr: 0 },
      { slotHour: 6, orders: 16, riders: 7, s2pMinutesSum: 12.0, otpAch: 16, otpBr: 0 },
      { slotHour: 7, orders: 33, riders: 12, s2pMinutesSum: 31.02, otpAch: 33, otpBr: 0 },
      { slotHour: 8, orders: 44, riders: 19, s2pMinutesSum: 29.04, otpAch: 44, otpBr: 0 },
      { slotHour: 9, orders: 53, riders: 24, s2pMinutesSum: 23.85, otpAch: 51, otpBr: 2 },
      { slotHour: 10, orders: 42, riders: 21, s2pMinutesSum: 8.82, otpAch: 42, otpBr: 0 },
      { slotHour: 17, orders: 51, riders: 20, s2pMinutesSum: 258.06, otpAch: 50, otpBr: 1 },
      { slotHour: 18, orders: 62, riders: 27, s2pMinutesSum: 319.3, otpAch: 44, otpBr: 18 },
      { slotHour: 19, orders: 60, riders: 27, s2pMinutesSum: 931.8, otpAch: 59, otpBr: 1 },
      { slotHour: 22, orders: 37, riders: 17, s2pMinutesSum: 31.82, otpAch: 35, otpBr: 2 },
      { slotHour: 23, orders: 27, riders: 12, s2pMinutesSum: 21.06, otpAch: 26, otpBr: 1 },
    ];

    for (const s of slotMetrics) {
      // 1. DPH = Orders / Actual Riders Turn-up
      const dph = Math.round((s.orders / s.riders) * 10) / 10;
      if (s.slotHour === 6) expect(dph).toBe(2.3);
      if (s.slotHour === 7) expect(dph).toBe(2.8);
      if (s.slotHour === 8) expect(dph).toBe(2.3);
      if (s.slotHour === 9) expect(dph).toBe(2.2);
      if (s.slotHour === 10) expect(dph).toBe(2.0);
      if (s.slotHour === 18) expect(dph).toBe(2.3);
      if (s.slotHour === 19) expect(dph).toBe(2.2);

      // 2. S2P = sum(s2p) / orders
      const avgS2p = Math.round((s.s2pMinutesSum / s.orders) * 100) / 100;
      if (s.slotHour === 6) expect(avgS2p).toBe(0.75);
      if (s.slotHour === 7) expect(avgS2p).toBe(0.94);
      if (s.slotHour === 8) expect(avgS2p).toBe(0.66);
      if (s.slotHour === 9) expect(avgS2p).toBe(0.45);
      if (s.slotHour === 10) expect(avgS2p).toBe(0.21);
      if (s.slotHour === 17) expect(avgS2p).toBe(5.06);
      if (s.slotHour === 18) expect(avgS2p).toBe(5.15);
      if (s.slotHour === 19) expect(avgS2p).toBe(15.53);

      // 3. OTP+3 = % of Row (Achieved / (Achieved + Breached))
      const totalOtp = s.otpAch + s.otpBr;
      const otpAchPct = Math.round((s.otpAch / totalOtp) * 10000) / 100;
      const otpBrPct = Math.round((s.otpBr / totalOtp) * 10000) / 100;

      if (s.slotHour === 6) {
        expect(otpAchPct).toBe(100.0);
        expect(otpBrPct).toBe(0.0);
      }
      if (s.slotHour === 9) {
        expect(otpAchPct).toBe(96.23);
        expect(otpBrPct).toBe(3.77);
      }
      if (s.slotHour === 18) {
        expect(otpAchPct).toBe(70.97);
        expect(otpBrPct).toBe(29.03);
      }
      if (s.slotHour === 19) {
        expect(otpAchPct).toBe(98.33);
        expect(otpBrPct).toBe(1.67);
      }
    }
  });

  it('buildSummaryFromRpcRows builds complete performance structure from server aggregated RPC rows', () => {
    const mockRpcRows = [
      {
        order_date: '2026-10-19',
        slot_hour: 7,
        orders_count: 33,
        riders_count: 12,
        s2p_sum: 31.02,
        s2p_count: 33,
        otp_achieved_count: 33,
        otp_breached_count: 0,
        day_distinct_riders: 12,
        period_distinct_riders: 15,
      },
      {
        order_date: '2026-10-19',
        slot_hour: 18,
        orders_count: 62,
        riders_count: 27,
        s2p_sum: 319.3,
        s2p_count: 62,
        otp_achieved_count: 44,
        otp_breached_count: 18,
        day_distinct_riders: 12,
        period_distinct_riders: 15,
      },
    ];

    const result = buildSummaryFromRpcRows(mockRpcRows, {
      storeId: '00000000-0000-0000-0000-000000000001',
      startDate: '2026-10-19',
      endDate: '2026-10-19',
    });

    expect(result.days).toHaveLength(1);
    expect(result.overallTotalOrders).toBe(95);
    expect(result.overallDistinctRiders).toBe(15);
    expect(result.days[0].slots).toHaveLength(2);

    const slot7 = result.days[0].slots[0];
    expect(slot7.ordersCount).toBe(33);
    expect(slot7.ridersCount).toBe(12);
    expect(slot7.dph).toBe(2.8);
    expect(slot7.avgS2p).toBe(0.94);
    expect(slot7.otpAchievedPct).toBe(100.0);

    const slot18 = result.days[0].slots[1];
    expect(slot18.ordersCount).toBe(62);
    expect(slot18.ridersCount).toBe(27);
    expect(slot18.dph).toBe(2.3);
    expect(slot18.avgS2p).toBe(5.15);
    expect(slot18.otpAchievedPct).toBe(70.97);
  });

  it('buildSummaryFromRawOrders produces identical aggregated metrics for fallback client path', () => {
    const rawOrders = [
      {
        rider_number: 'R1',
        slot_hour: 7,
        order_date: '2026-10-19',
        s2p_minutes: 1.0,
        otp_plus_3_performance: 'OTP Achieved',
      },
      {
        rider_number: 'R2',
        slot_hour: 7,
        order_date: '2026-10-19',
        s2p_minutes: 2.0,
        otp_plus_3_performance: 'OTP Achieved',
      },
      {
        rider_number: 'R1',
        slot_hour: 18,
        order_date: '2026-10-19',
        s2p_minutes: 5.0,
        otp_plus_3_performance: 'OTP Breached',
      },
    ];

    const result = buildSummaryFromRawOrders(rawOrders, {
      storeId: '00000000-0000-0000-0000-000000000001',
      startDate: '2026-10-19',
      endDate: '2026-10-19',
    });

    expect(result.overallTotalOrders).toBe(3);
    expect(result.overallDistinctRiders).toBe(2);
    expect(result.days[0].slots).toHaveLength(2);
    expect(result.days[0].slots[0].dph).toBe(1); // 2 orders / 2 riders
    expect(result.days[0].slots[0].avgS2p).toBe(1.5); // (1+2)/2
    expect(result.days[0].slots[0].otpAchievedPct).toBe(100.0);

    // Invalidate cache without error
    expect(() => invalidateS2POtpCache()).not.toThrow();
    expect(() => invalidateS2POtpCache('store-123')).not.toThrow();
  });

  it('getDphImpactedSlots detects slots where DPH went beyond 2.1 and returns empty array if none', () => {
    const slots = [
      {
        slotHour: 7,
        slotLabel: '07:00 – 08:00',
        ordersCount: 33,
        ridersCount: 12,
        dph: 2.8, // > 2.1 -> IMPACTED
        avgS2p: 0.94,
        otpAchievedCount: 33,
        otpBreachedCount: 0,
        otpApplicableCount: 33,
        otpAchievedPct: 100,
        otpBreachedPct: 0,
      },
      {
        slotHour: 8,
        slotLabel: '08:00 – 09:00',
        ordersCount: 44,
        ridersCount: 19,
        dph: 2.3, // > 2.1 -> IMPACTED
        avgS2p: 0.66,
        otpAchievedCount: 44,
        otpBreachedCount: 0,
        otpApplicableCount: 44,
        otpAchievedPct: 100,
        otpBreachedPct: 0,
      },
      {
        slotHour: 9,
        slotLabel: '09:00 – 10:00',
        ordersCount: 53,
        ridersCount: 24,
        dph: 2.2, // > 2.1 -> IMPACTED
        avgS2p: 0.45,
        otpAchievedCount: 51,
        otpBreachedCount: 2,
        otpApplicableCount: 53,
        otpAchievedPct: 96.23,
        otpBreachedPct: 3.77,
      },
      {
        slotHour: 10,
        slotLabel: '10:00 – 11:00',
        ordersCount: 42,
        ridersCount: 21,
        dph: 2.0, // <= 2.1 -> NOT impacted
        avgS2p: 0.21,
        otpAchievedCount: 42,
        otpBreachedCount: 0,
        otpApplicableCount: 42,
        otpAchievedPct: 100,
        otpBreachedPct: 0,
      },
      {
        slotHour: 18,
        slotLabel: '18:00 – 19:00',
        ordersCount: 62,
        ridersCount: 27,
        dph: 2.3, // > 2.1 -> IMPACTED
        avgS2p: 5.15,
        otpAchievedCount: 44,
        otpBreachedCount: 18,
        otpApplicableCount: 62,
        otpAchievedPct: 70.97,
        otpBreachedPct: 29.03,
      },
      {
        slotHour: 19,
        slotLabel: '19:00 – 20:00',
        ordersCount: 60,
        ridersCount: 27,
        dph: 2.2, // > 2.1 -> IMPACTED
        avgS2p: 15.53,
        otpAchievedCount: 59,
        otpBreachedCount: 1,
        otpApplicableCount: 60,
        otpAchievedPct: 98.33,
        otpBreachedPct: 1.67,
      },
    ];

    const impacted = getDphImpactedSlots(slots, 2.1);
    expect(impacted).toEqual([7, 8, 9, 18, 19]);

    // Test with only low-DPH slots (all <= 2.1)
    const lowDphSlots = [
      {
        slotHour: 11,
        slotLabel: '11:00 – 12:00',
        ordersCount: 20,
        ridersCount: 10,
        dph: 2.0,
        avgS2p: 0.5,
        otpAchievedCount: 20,
        otpBreachedCount: 0,
        otpApplicableCount: 20,
        otpAchievedPct: 100,
        otpBreachedPct: 0,
      },
      {
        slotHour: 12,
        slotLabel: '12:00 – 13:00',
        ordersCount: 21,
        ridersCount: 10,
        dph: 2.1,
        avgS2p: 0.5,
        otpAchievedCount: 21,
        otpBreachedCount: 0,
        otpApplicableCount: 21,
        otpAchievedPct: 100,
        otpBreachedPct: 0,
      },
    ];

    const noImpact = getDphImpactedSlots(lowDphSlots, 2.1);
    expect(noImpact).toEqual([]);
  });

  it('accurately computes DSR (Delivery Success Rate) for Completed orders vs Total Orders', () => {
    // 1. Test buildSummaryFromRpcRows with completed_orders_count
    const rpcRows = [
      {
        order_date: '2026-10-19',
        slot_hour: 7,
        orders_count: 100,
        riders_count: 20,
        s2p_sum: 50,
        s2p_count: 100,
        otp_achieved_count: 99,
        otp_breached_count: 1,
        completed_orders_count: 99, // 99/100 = 99.00%
      },
      {
        order_date: '2026-10-19',
        slot_hour: 8,
        orders_count: 100,
        riders_count: 20,
        s2p_sum: 50,
        s2p_count: 100,
        otp_achieved_count: 100,
        otp_breached_count: 0,
        completed_orders_count: 100, // 100/100 = 100.00%
      },
    ];

    const rpcSummary = buildSummaryFromRpcRows(rpcRows, {
      storeId: 'test-store',
      startDate: '2026-10-19',
      endDate: '2026-10-19',
    });

    expect(rpcSummary.overallTotalOrders).toBe(200);
    expect(rpcSummary.overallCompletedOrders).toBe(199);
    // (199 / 200) * 100 = 99.5% (> 99 target)
    expect(rpcSummary.overallDsrPct).toBe(99.5);
    expect(rpcSummary.days[0].slots[0].dsrPct).toBe(99.0);
    expect(rpcSummary.days[0].slots[1].dsrPct).toBe(100.0);

    // 2. Test buildSummaryFromRawOrders with order status field
    const rawOrders = [
      {
        rider_number: 'R1',
        slot_hour: 9,
        order_date: '2026-10-20',
        s2p_minutes: 0.5,
        otp_plus_3_performance: 'OTP Achieved',
        status: 'Completed',
      },
      {
        rider_number: 'R2',
        slot_hour: 9,
        order_date: '2026-10-20',
        s2p_minutes: 0.4,
        otp_plus_3_performance: 'OTP Achieved',
        status: 'completed ', // Case & whitespace tolerance
      },
      {
        rider_number: 'R3',
        slot_hour: 9,
        order_date: '2026-10-20',
        s2p_minutes: 0.6,
        otp_plus_3_performance: 'Not Applicable',
        status: 'Cancelled',
      },
    ];

    const rawSummary = buildSummaryFromRawOrders(rawOrders, {
      storeId: 'test-store',
      startDate: '2026-10-20',
      endDate: '2026-10-20',
    });

    expect(rawSummary.overallTotalOrders).toBe(3);
    expect(rawSummary.overallCompletedOrders).toBe(2);
    // 2/3 = 66.67%
    expect(rawSummary.overallDsrPct).toBe(66.67);
    expect(rawSummary.days[0].completedOrdersCount).toBe(2);
    expect(rawSummary.days[0].dsrPct).toBe(66.67);
  });
});
