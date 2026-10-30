import React, { useCallback, useEffect, useState } from 'react';
import type { StoreMaster } from '../domain/types';
import type { UserProfile } from '../services/authService';
import { getDateRangeForDays } from '../services/analyticsService';
import {
  type S2POtpSummaryResult,
  exportS2POtpToExcel,
  fetchS2POtpAnalytics,
  getDphImpactedSlots,
} from '../services/s2pOtpService';

interface S2POtpSectionProps {
  stores: StoreMaster[];
  selectedStoreId: string;
  onSelectStoreId: (id: string) => void;
  currentUser?: UserProfile | null;
}

type SlotViewType = 'all' | 's2p' | 'otp' | 'dph';

export const S2POtpSection: React.FC<S2POtpSectionProps> = ({
  stores,
  selectedStoreId,
  onSelectStoreId,
  currentUser,
}) => {
  const selectedStore = stores.find((s) => s.id === selectedStoreId) ?? stores[0];

  // Presets: 3, 7, 10, 14, 20, 30 days
  const [selectedDays, setSelectedDays] = useState<number>(7);
  const initialRange = getDateRangeForDays(7, selectedStore?.timezone || 'Asia/Kolkata');
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);

  const [showCustomRange, setShowCustomRange] = useState(false);
  const [customStart, setCustomStart] = useState(initialRange.startDate);
  const [customEnd, setCustomEnd] = useState(initialRange.endDate);

  const [summary, setSummary] = useState<S2POtpSummaryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadSource, setLoadSource] = useState<'cache' | 'rpc' | 'client' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Set of dates that are currently expanded to show slot breakdown
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  // Active slot sub-view per date (defaults to 'all', can switch to 's2p', 'otp', 'dph')
  const [slotViewModes, setSlotViewModes] = useState<Record<string, SlotViewType>>({});

  const presets = [1, 3, 7, 10, 14, 20, 30];

  const loadData = useCallback(async (forceRefresh = false) => {
    if (!selectedStore) return;
    setLoading(true);
    setError(null);

    const res = await fetchS2POtpAnalytics({
      storeId: selectedStore.id,
      startDate,
      endDate,
      forceRefresh,
    });

    setLoading(false);
    if (res.error) {
      setError(res.error);
    } else if (res.data) {
      setSummary(res.data);
      setLoadSource(res.source ?? null);
      // Auto-expand the latest date if there's only 1 date, or keep previous state
      if (res.data.days.length === 1) {
        setExpandedDates(new Set([res.data.days[0].dateStr]));
      }
    }
  }, [selectedStore, startDate, endDate]);

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  const handleSelectPreset = (days: number) => {
    setSelectedDays(days);
    setShowCustomRange(false);
    const range = getDateRangeForDays(days, selectedStore?.timezone || 'Asia/Kolkata');
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    setCustomStart(range.startDate);
    setCustomEnd(range.endDate);
  };

  const handleApplyCustomDate = () => {
    if (customStart && customEnd) {
      setStartDate(customStart);
      setEndDate(customEnd);
      setSelectedDays(0);
    }
  };

  const toggleExpandDate = (dateStr: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) {
        next.delete(dateStr);
      } else {
        next.add(dateStr);
      }
      return next;
    });
  };

  const toggleAllDates = () => {
    if (!summary) return;
    if (expandedDates.size === summary.days.length) {
      setExpandedDates(new Set());
    } else {
      setExpandedDates(new Set(summary.days.map((d) => d.dateStr)));
    }
  };

  const setDateSlotView = (dateStr: string, mode: SlotViewType) => {
    setSlotViewModes((prev) => ({
      ...prev,
      [dateStr]: mode,
    }));
  };

  const handleExport = () => {
    if (!summary || !selectedStore) return;
    exportS2POtpToExcel(summary, selectedStore.store_code);
  };

  // Helper to color-code DPH heatmap background (matching Excel pivot in Image 3)
  const getDphHeatmapStyle = (dph: number): React.CSSProperties => {
    if (dph <= 0) return {};
    if (dph >= 2.6) {
      return { backgroundColor: '#fecdd3', color: '#9f1239', fontWeight: 700 }; // intense rose/red
    }
    if (dph >= 2.3) {
      return { backgroundColor: '#ffe4e6', color: '#be123c', fontWeight: 600 }; // light rose
    }
    if (dph >= 2.0) {
      return { backgroundColor: '#fff1f2', color: '#e11d48' }; // soft pink
    }
    return { backgroundColor: '#f8fafc', color: '#475569' };
  };

  // Helper for S2P duration color badge (Target: <= 0.60 min)
  const getS2pBadgeClass = (s2p: number): string => {
    if (s2p <= 0.60) return 'text-green font-bold';
    return 'text-red font-bold';
  };

  return (
    <div className="analytics-container s2p-otp-container">
      {/* 1. Filter & Controls Bar */}
      <div className="section-card">
        <div className="perf-controls-bar" style={{ marginTop: 0 }}>
          <div className="perf-controls-left flex-wrap items-center">
            {/* Store Selector */}
            <div className="store-selector-group mr-md">
              <span className="field-label">Store:</span>
              {currentUser?.role === 'store_user' ? (
                <div className="store-badge-locked flex-row items-center gap-xs">
                  <span className="badge badge-primary">{selectedStore?.store_code}</span>
                  <strong>{selectedStore?.store_name}</strong>
                </div>
              ) : (
                <select
                  id="s2p-store-select"
                  className="select-input"
                  value={selectedStoreId}
                  onChange={(e) => onSelectStoreId(e.target.value)}
                >
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.store_code} — {s.store_name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Period Segmented Control */}
            <div className="perf-filter-group">
              <span className="perf-control-label">Period:</span>
              <div className="segmented-control">
                {presets.map((days) => (
                  <button
                    key={days}
                    type="button"
                    className={`segmented-btn ${selectedDays === days && !showCustomRange ? 'segmented-btn-active' : ''}`}
                    onClick={() => handleSelectPreset(days)}
                    title={days === 1 ? "Yesterday's date (1 Day)" : `Last ${days} days`}
                  >
                    {days === 1 ? '1 Day (Yesterday)' : `${days} Days`}
                  </button>
                ))}
                <button
                  type="button"
                  className={`segmented-btn ${showCustomRange ? 'segmented-btn-active' : ''}`}
                  onClick={() => setShowCustomRange((v) => !v)}
                  title="Select custom date range"
                >
                  Custom
                </button>
              </div>
            </div>

            {showCustomRange && (
              <div className="custom-range-inline-picker">
                <div className="custom-range-field">
                  <span className="custom-range-label">From:</span>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="custom-range-date-input"
                  />
                </div>
                <div className="custom-range-field">
                  <span className="custom-range-label">To:</span>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="custom-range-date-input"
                  />
                </div>
                <button
                  type="button"
                  className="btn-apply-custom"
                  onClick={handleApplyCustomDate}
                  disabled={loading || !customStart || !customEnd}
                >
                  Apply
                </button>
              </div>
            )}
          </div>

          <div className="perf-actions-right">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={toggleAllDates}
              disabled={!summary || summary.days.length === 0}
              title="Expand or collapse all date rows"
            >
              {expandedDates.size === (summary?.days.length ?? 0)
                ? 'Collapse All Days'
                : 'Expand All Days'}
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm perf-btn-refresh"
              onClick={() => void loadData(true)}
              disabled={loading}
              title="Refresh S2P & OTP data"
            >
              <svg
                className={`btn-icon ${loading ? 'spin-icon' : ''}`}
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M23 4v6h-6M1 20v-6h6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
            </button>

            <button
              type="button"
              className="btn-export-excel"
              onClick={handleExport}
              disabled={!summary || summary.days.length === 0}
              title="Download full Excel workbook with S2P, OTP+3 & DPH pivots"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Export Excel</span>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert-box alert-box-warning mt-md" role="alert">
          <strong>Notice:</strong> {error}
        </div>
      )}

      {/* 2. Top Summary KPI Cards */}
      <div className="kpi-grid mt-md">
        <div className="kpi-card">
          <div className="kpi-header-row">
            <span className="kpi-label">DSR (Delivery Success Rate)</span>
            <span className="kpi-target-badge">Target: &gt; 99%</span>
          </div>
          <strong
            className={`kpi-value ${
              (summary?.overallDsrPct ?? 0) > 99.0 ? 'text-green' : 'text-red'
            }`}
          >
            {loading ? '...' : `${(summary?.overallDsrPct ?? 0).toFixed(2)}%`}
          </strong>
          <span className="kpi-sub">
            Completed: {(summary?.overallCompletedOrders ?? 0).toLocaleString()} of {(summary?.overallTotalOrders ?? 0).toLocaleString()} orders
          </span>
        </div>

        <div className="kpi-card">
          <div className="kpi-header-row">
            <span className="kpi-label">Average S2P Time</span>
            <span className="kpi-target-badge">Target: ≤ 0.60 min</span>
          </div>
          <strong
            className={`kpi-value ${
              (summary?.overallAvgS2p ?? 0) > 0.60 ? 'text-red' : 'text-green'
            }`}
          >
            {loading ? '...' : `${summary?.overallAvgS2p.toFixed(2) ?? '0.00'} min`}
          </strong>
          <span className="kpi-sub">
            Staging-to-Pickup duration across {summary?.periodDays ?? selectedDays} {(summary?.periodDays ?? selectedDays) === 1 ? 'day' : 'days'}
          </span>
        </div>

        <div className="kpi-card">
          <div className="kpi-header-row">
            <span className="kpi-label">OTP+3 Performance</span>
            <span className="kpi-target-badge">Target: ≥ 98%</span>
          </div>
          <strong
            className={`kpi-value ${
              (summary?.overallOtpAchievedPct ?? 0) < 98.0 ? 'text-red' : 'text-green'
            }`}
          >
            {loading ? '...' : `${summary?.overallOtpAchievedPct.toFixed(2) ?? '0.00'}%`}
          </strong>
          <span className="kpi-sub">
            Achieved: {summary?.overallOtpAchievedPct.toFixed(1)}% | Breached:{' '}
            {summary?.overallOtpBreachedPct.toFixed(1)}%
          </span>
        </div>

        <div className="kpi-card">
          <div className="kpi-header-row">
            <span className="kpi-label">Deliveries Per Hour (DPH)</span>
            <span className="kpi-target-badge">Target: ≤ 2.1</span>
          </div>
          <strong
            className={`kpi-value ${
              (summary?.overallAvgDph ?? 0) > 2.1 ? 'text-red' : 'text-green'
            }`}
          >
            {loading ? '...' : summary?.overallAvgDph.toFixed(1) ?? '0.0'}
          </strong>
          <span className="kpi-sub">
            Orders per active rider working hour (turn-up)
          </span>
        </div>

        <div className="kpi-card">
          <div className="kpi-header-row">
            <span className="kpi-label">Total Volume &amp; Riders</span>
          </div>
          <strong className="kpi-value text-slate">
            {loading ? '...' : `${summary?.overallTotalOrders.toLocaleString() ?? '0'}`}
          </strong>
          <span className="kpi-sub">
            Delivered by {summary?.overallDistinctRiders ?? 0} active riders in period
          </span>
        </div>
      </div>

      {/* 3. Daily Summary Table with Expandable Slot Drill-Downs */}
      <div className="section-card perf-card mt-md">
        <div className="perf-section-header">
          <div className="flex-row items-center justify-between">
            <div>
              <h3 className="section-title">Daily S2P, OTP, DPH &amp; DSR Summary</h3>
              <p className="section-subtitle">
                Click on any calendar day row to expand its hourly/slot breakdown matching Excel pivots.
              </p>
            </div>
            <div className="badge badge-info">
              {summary?.days.length ?? 0} active days detected ({startDate} to {endDate})
            </div>
          </div>
        </div>

        {loading && (
          <div className="s2p-loading-bar">
            <span className="spinner-sm mr-xs" aria-hidden="true" />
            <span>
              {loadSource === 'client'
                ? 'Fetching order records in parallel chunks...'
                : 'Aggregating performance metrics...'}
            </span>
          </div>
        )}

        {loading && !summary && (
          <div className="p-xl text-center text-slate">
            <span className="spinner-sm mr-xs" aria-hidden="true" />
            Loading S2P, OTP & DPH performance metrics...
          </div>
        )}

        {!loading && (!summary || summary.days.length === 0) && (
          <div className="p-xl text-center text-slate">
            No order records found for store {selectedStore?.store_code} between {startDate} and {endDate}.
          </div>
        )}

        {summary && summary.days.length > 0 && (
          <div className={`s2p-daily-table-container ${loading ? 'opacity-70' : ''}`}>
            <table className="s2p-daily-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }} aria-label="Expand toggle" />
                  <th>Date</th>
                  <th>Day</th>
                  <th className="text-right">Orders</th>
                  <th className="text-right">DSR %</th>
                  <th className="text-right">Actual Riders Turn-up</th>
                  <th className="text-right">DPH</th>
                  <th className="text-center">DPH Impacted Slots</th>
                  <th className="text-right">Avg S2P (min)</th>
                  <th className="text-right">OTP+3 Achieved %</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {summary.days.map((day) => {
                  const isExpanded = expandedDates.has(day.dateStr);
                  const activeView = slotViewModes[day.dateStr] || 'all';
                  const impactedSlots = getDphImpactedSlots(day.slots);

                  return (
                    <React.Fragment key={day.dateStr}>
                      {/* Parent Day Row */}
                      <tr
                        className={`s2p-day-row ${isExpanded ? 's2p-day-row-expanded' : ''}`}
                        onClick={() => toggleExpandDate(day.dateStr)}
                        title="Click to expand/collapse hourly slot breakdown"
                      >
                        <td className="text-center font-bold">
                          <button
                            type="button"
                            className="s2p-expand-toggle-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpandDate(day.dateStr);
                            }}
                            aria-label={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            {isExpanded ? '−' : '+'}
                          </button>
                        </td>
                        <td className="font-bold text-slate">
                          <div className="flex-row items-center gap-xs">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                              <line x1="16" y1="2" x2="16" y2="6" />
                              <line x1="8" y1="2" x2="8" y2="6" />
                              <line x1="3" y1="10" x2="21" y2="10" />
                            </svg>
                            <span>{day.formattedDate}</span>
                            <span className="text-xs text-muted">({day.dateStr})</span>
                          </div>
                        </td>
                        <td>
                          <span className="badge badge-secondary">{day.dayOfWeek}</span>
                        </td>
                        <td className="text-right font-bold">{day.totalOrders.toLocaleString()}</td>
                        <td className="text-right font-bold">
                          <span
                            className={(day.dsrPct ?? 0) > 99.0 ? 'text-green' : 'text-red'}
                            title={`Completed: ${(day.completedOrdersCount ?? 0).toLocaleString()} / ${(day.totalOrders ?? 0).toLocaleString()} orders`}
                          >
                            {(day.dsrPct ?? 0).toFixed(1)}%
                          </span>
                        </td>
                        <td className="text-right">{day.distinctRidersCount} riders</td>
                        <td className="text-right">
                          <span className="dph-pill" style={getDphHeatmapStyle(day.avgDph)}>
                            {day.avgDph.toFixed(1)}
                          </span>
                        </td>
                        <td className="text-center">
                          {impactedSlots.length > 0 ? (
                            <span
                              className="dph-impacted-slots"
                              title={`Slots with DPH > 2.1: ${impactedSlots.join(', ')}`}
                            >
                              {impactedSlots.join(', ')}
                            </span>
                          ) : (
                            ''
                          )}
                        </td>
                        <td className={`text-right ${getS2pBadgeClass(day.avgS2p)}`}>
                          {day.avgS2p.toFixed(2)} min
                        </td>
                        <td className="text-right font-bold text-green">
                          {day.avgOtpAchievedPct.toFixed(2)}%
                        </td>
                        <td className="text-center">
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpandDate(day.dateStr);
                            }}
                          >
                            {isExpanded ? 'Hide Slots ↑' : 'View Slots ↓'}
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Child Accordion Row */}
                      {isExpanded && (
                        <tr className="s2p-expanded-row">
                          <td colSpan={11} className="s2p-expanded-cell">
                            <div className="s2p-slot-breakdown-card">
                              {/* Sub-Header & Pivot View Switcher */}
                              <div className="s2p-slot-header">
                                <div className="flex-row items-center gap-xs">
                                  <h4 className="s2p-slot-title">
                                    Hourly Slot Breakdown — {day.formattedDate} ({day.dateStr})
                                  </h4>
                                  <span className="badge badge-info">
                                    {day.slots.length} Slots | {day.totalOrders} Orders | {day.distinctRidersCount} Active Riders
                                  </span>
                                </div>

                                <div className="segmented-control">
                                  <button
                                    type="button"
                                    className={`segmented-btn ${activeView === 'all' ? 'segmented-btn-active' : ''}`}
                                    onClick={() => setDateSlotView(day.dateStr, 'all')}
                                    title="All metrics in one unified slot matrix"
                                  >
                                    All-in-One Matrix
                                  </button>
                                  <button
                                    type="button"
                                    className={`segmented-btn ${activeView === 's2p' ? 'segmented-btn-active' : ''}`}
                                    onClick={() => setDateSlotView(day.dateStr, 's2p')}
                                    title="Replicates Image 1: Slot and Average S2P"
                                  >
                                    S2P Pivot
                                  </button>
                                  <button
                                    type="button"
                                    className={`segmented-btn ${activeView === 'otp' ? 'segmented-btn-active' : ''}`}
                                    onClick={() => setDateSlotView(day.dateStr, 'otp')}
                                    title="Replicates Image 2: OTP+3 Performance (% Achieved vs % Breached)"
                                  >
                                    OTP+3 Pivot
                                  </button>
                                  <button
                                    type="button"
                                    className={`segmented-btn ${activeView === 'dph' ? 'segmented-btn-active' : ''}`}
                                    onClick={() => setDateSlotView(day.dateStr, 'dph')}
                                    title="Replicates Image 3: Orders, Actual Riders Turn-up, and DPH"
                                  >
                                    DPH Pivot
                                  </button>
                                </div>
                              </div>

                              {/* VIEW A: All-in-One Master Slot Matrix */}
                              {activeView === 'all' && (
                                <div className="excel-pivot-table-container">
                                  <table className="excel-pivot-table">
                                    <thead>
                                      <tr>
                                        <th className="text-center" style={{ width: '80px' }}>Slot</th>
                                        <th className="text-center">Orders</th>
                                        <th className="text-center">DSR %</th>
                                        <th className="text-center">Actual Riders Turn-up</th>
                                        <th className="text-center">DPH</th>
                                        <th className="text-center">AVERAGE of S2P (min)</th>
                                        <th className="text-center">OTP Achieved %</th>
                                        <th className="text-center">OTP Breached %</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {day.slots.map((s) => (
                                        <tr key={s.slotHour}>
                                          <td className="text-center font-bold text-slate" title={s.slotLabel}>{s.slotHour}</td>
                                          <td className="text-center font-semibold">{s.ordersCount}</td>
                                          <td className="text-center font-semibold">
                                            <span
                                              className={(s.dsrPct ?? 0) > 99.0 ? 'text-green' : 'text-red'}
                                              title={`Completed: ${(s.completedOrdersCount ?? 0).toLocaleString()} / ${s.ordersCount.toLocaleString()}`}
                                            >
                                              {(s.dsrPct ?? 0).toFixed(1)}%
                                            </span>
                                          </td>
                                          <td className="text-center">{s.ridersCount}</td>
                                          <td className="text-center">
                                            <span className="dph-pill" style={getDphHeatmapStyle(s.dph)}>
                                              {s.dph.toFixed(1)}
                                            </span>
                                          </td>
                                          <td className={`text-center ${getS2pBadgeClass(s.avgS2p)}`}>
                                            {s.avgS2p.toFixed(2)}
                                          </td>
                                          <td className="text-center font-semibold text-green">
                                            {s.otpAchievedPct.toFixed(2)}%
                                          </td>
                                          <td className="text-center text-red">
                                            {s.otpBreachedPct > 0 ? `${s.otpBreachedPct.toFixed(2)}%` : '0.00%'}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot>
                                      <tr className="excel-pivot-grand-total">
                                        <td className="text-center font-bold">Grand Total</td>
                                        <td className="text-center font-bold">{day.totalOrders}</td>
                                        <td className="text-center font-bold">
                                          <span className={(day.dsrPct ?? 0) > 99.0 ? 'text-green' : 'text-red'}>
                                            {(day.dsrPct ?? 0).toFixed(1)}%
                                          </span>
                                        </td>
                                        <td className="text-center font-bold">{day.distinctRidersCount}</td>
                                        <td className="text-center font-bold">
                                          <span className="dph-pill" style={getDphHeatmapStyle(day.avgDph)}>
                                            {day.avgDph.toFixed(1)}
                                          </span>
                                        </td>
                                        <td className={`text-center font-bold ${getS2pBadgeClass(day.avgS2p)}`}>
                                          {day.avgS2p.toFixed(2)}
                                        </td>
                                        <td className="text-center font-bold text-green">
                                          {day.avgOtpAchievedPct.toFixed(2)}%
                                        </td>
                                        <td className="text-center font-bold text-red">
                                          {day.avgOtpBreachedPct.toFixed(2)}%
                                        </td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              )}

                              {/* VIEW B: S2P Pivot (Replicates User Image 1) */}
                              {activeView === 's2p' && (
                                <div className="excel-pivot-layout">
                                  <div className="excel-pivot-table-container max-w-sm">
                                    <table className="excel-pivot-table">
                                      <thead>
                                        <tr>
                                          <th className="text-center" style={{ width: '120px' }}><em>Slot</em></th>
                                          <th className="text-center">AVERAGE of S2P</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {day.slots.map((s) => (
                                          <tr key={s.slotHour}>
                                            <td className="text-center">{s.slotHour}</td>
                                            <td className="text-center font-semibold">{s.avgS2p.toFixed(2)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                      <tfoot>
                                        <tr className="excel-pivot-grand-total">
                                          <td className="text-center font-bold">Grand Total</td>
                                          <td className="text-center font-bold">{day.avgS2p.toFixed(2)}</td>
                                        </tr>
                                      </tfoot>
                                    </table>
                                  </div>
                                  <div className="excel-pivot-legend-note">
                                    <p className="text-xs text-muted">
                                      <strong>Pivot Configuration:</strong> Slot in Rows, S2P in Values (summarized by AVERAGE).
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* VIEW C: OTP+3 Pivot (Replicates User Image 2) */}
                              {activeView === 'otp' && (
                                <div className="excel-pivot-layout">
                                  <div className="excel-pivot-table-container max-w-lg">
                                    <table className="excel-pivot-table">
                                      <thead>
                                        <tr>
                                          <th rowSpan={2} className="text-center" style={{ width: '100px', verticalAlign: 'bottom' }}>
                                            <em>Slot</em>
                                          </th>
                                          <th colSpan={2} className="text-center border-b">
                                            OTP+3 Performance
                                          </th>
                                        </tr>
                                        <tr>
                                          <th className="text-center">OTP Achieved</th>
                                          <th className="text-center">OTP Breached</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {day.slots.map((s) => (
                                          <tr key={s.slotHour}>
                                            <td className="text-center">{s.slotHour}</td>
                                            <td className="text-center font-semibold text-green">
                                              {s.otpAchievedPct.toFixed(2)}%
                                            </td>
                                            <td className="text-center text-red">
                                              {s.otpBreachedPct > 0 ? `${s.otpBreachedPct.toFixed(2)}%` : ''}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                      <tfoot>
                                        <tr className="excel-pivot-grand-total">
                                          <td className="text-center font-bold">Grand Total</td>
                                          <td className="text-center font-bold text-green">
                                            {day.avgOtpAchievedPct.toFixed(2)}%
                                          </td>
                                          <td className="text-center font-bold text-red">
                                            {day.avgOtpBreachedPct.toFixed(2)}%
                                          </td>
                                        </tr>
                                      </tfoot>
                                    </table>
                                  </div>
                                  <div className="excel-pivot-legend-note">
                                    <p className="text-xs text-muted">
                                      <strong>Pivot Configuration:</strong> Slot in Rows, OTP+3 Performance in Columns & Values (summarized by COUNTA and Show as % of Row).
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* VIEW D: DPH Pivot (Replicates User Image 3) */}
                              {activeView === 'dph' && (
                                <div className="excel-pivot-layout">
                                  <div className="excel-pivot-table-container max-w-md">
                                    <table className="excel-pivot-table">
                                      <thead>
                                        <tr>
                                          <th className="text-center" style={{ width: '80px' }}><em>Slot</em></th>
                                          <th className="text-center">Orders</th>
                                          <th className="text-center">Actual Riders Turn-up</th>
                                          <th className="text-center">DPH</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {day.slots.map((s) => (
                                          <tr key={s.slotHour}>
                                            <td className="text-center">{s.slotHour}</td>
                                            <td className="text-center">{s.ordersCount}</td>
                                            <td className="text-center">{s.ridersCount}</td>
                                            <td className="text-center" style={getDphHeatmapStyle(s.dph)}>
                                              {s.dph.toFixed(1)}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                      <tfoot>
                                        <tr className="excel-pivot-grand-total">
                                          <td className="text-center font-bold">Grand Total</td>
                                          <td className="text-center font-bold">{day.totalOrders}</td>
                                          <td className="text-center font-bold">{day.distinctRidersCount}</td>
                                          <td className="text-center font-bold" style={getDphHeatmapStyle(day.avgDph)}>
                                            {day.avgDph.toFixed(1)}
                                          </td>
                                        </tr>
                                      </tfoot>
                                    </table>
                                  </div>
                                  <div className="excel-pivot-legend-note">
                                    <p className="text-xs text-muted">
                                      <strong>Pivot Configuration:</strong> Slot in Rows, Order ID (COUNTA), Rider Number (COUNTUNIQUE as Actual Riders Turn-Up), and DPH (Orders / Riders).
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="s2p-overall-grand-total">
                  <td colSpan={3} className="font-bold">
                    Period Grand Total ({summary.periodDays} {summary.periodDays === 1 ? 'Day' : 'Days'})
                  </td>
                  <td className="text-right font-bold">{summary.overallTotalOrders.toLocaleString()}</td>
                  <td className="text-right font-bold">{summary.overallDistinctRiders} riders</td>
                  <td className="text-right font-bold">
                    <span className="dph-pill" style={getDphHeatmapStyle(summary.overallAvgDph)}>
                      {summary.overallAvgDph.toFixed(1)}
                    </span>
                  </td>
                  <td className="text-center font-normal text-muted" />
                  <td className={`text-right font-bold ${getS2pBadgeClass(summary.overallAvgS2p)}`}>
                    {summary.overallAvgS2p.toFixed(2)} min
                  </td>
                  <td className="text-right font-bold text-green">
                    {summary.overallOtpAchievedPct.toFixed(2)}%
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
