// ==============================================================================
// Planning Section Component
// Replicated layout & UI matching Rider Analytics:
// Top section card, KPI Metric Cards grid, Controls bar, Callout banner,
// and Modern Pivot Table wrapper.
// ==============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { StoreMaster } from '../domain/types';
import type { UserProfile } from '../services/authService';
import {
  type DayPlanningSummary,
  exportPlanningToExcel,
  fetchPlanningForDate,
  fetchStoreTargetDph,
  getAvailableForecastDates,
  getStoreTargetDphSync,
  saveStoreTargetDph,
} from '../services/planningService';

interface PlanningSectionProps {
  stores: StoreMaster[];
  selectedStoreId: string;
  onSelectStoreId: (storeId: string) => void;
  currentUser?: UserProfile | null;
  onNavigateToUploadSnop?: () => void;
}

export const PlanningSection: React.FC<PlanningSectionProps> = ({
  stores,
  selectedStoreId,
  onSelectStoreId,
  currentUser,
  onNavigateToUploadSnop,
}) => {
  const selectedStore =
    stores.find((s) => s.id === selectedStoreId) ?? stores[0] ?? null;
  const isStoreUser = currentUser?.role === 'store_user';

  // Available SNOP forecast dates for this store
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');

  // Target DPH state
  const [targetDph, setTargetDph] = useState<number>(() =>
    getStoreTargetDphSync(selectedStore?.store_code || 'TMK7')
  );
  const [dphInput, setDphInput] = useState<string>(() =>
    String(getStoreTargetDphSync(selectedStore?.store_code || 'TMK7'))
  );
  const [isEditingDph, setIsEditingDph] = useState(false);
  const [isSavingDph, setIsSavingDph] = useState(false);
  const [dphSaveNotice, setDphSaveNotice] = useState<string | null>(null);

  // Planning summary and slot metrics
  const [summary, setSummary] = useState<DayPlanningSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load available forecast dates whenever store changes
  useEffect(() => {
    if (!selectedStore) return;
    const storeCode = selectedStore.store_code;
    const dates = getAvailableForecastDates(storeCode);
    setAvailableDates(dates);

    // Pick first available date, or keep current if valid
    setSelectedDate((prev) => {
      if (prev && dates.includes(prev)) return prev;
      return dates.length > 0 ? dates[0] : '2026-10-25';
    });

    // Sync DPH for store
    void fetchStoreTargetDph(storeCode).then((val) => {
      setTargetDph(val);
      setDphInput(String(val));
    });
  }, [selectedStore]);

  // Load planning calculation for selected date and target DPH
  const loadPlanningData = useCallback(async () => {
    if (!selectedStore || !selectedDate) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetchPlanningForDate({
        storeId: selectedStore.id,
        warehouseId: selectedStore.store_code,
        dateStr: selectedDate,
        targetDph,
        timeZone: selectedStore.timezone || 'Asia/Kolkata',
      });
      setSummary(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to calculate planning data: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [selectedStore, selectedDate, targetDph]);

  useEffect(() => {
    void loadPlanningData();
  }, [loadPlanningData]);

  // Save updated DPH to Supabase and recalculate immediately
  const handleSaveDph = async () => {
    const parsed = parseFloat(dphInput);
    if (isNaN(parsed) || parsed <= 0) {
      setDphSaveNotice('Invalid DPH: Must be a positive number greater than 0.');
      return;
    }

    setIsSavingDph(true);
    setDphSaveNotice(null);

    const storeCode = selectedStore?.store_code || 'TMK7';
    const res = await saveStoreTargetDph(
      storeCode,
      parsed,
      currentUser?.email || 'User'
    );

    setIsSavingDph(false);
    if (res.ok) {
      setTargetDph(parsed);
      setIsEditingDph(false);
      setDphSaveNotice('Target DPH saved to database & recalculating slots...');
      setTimeout(() => setDphSaveNotice(null), 3000);
    } else {
      setDphSaveNotice(res.error || 'Failed to save DPH.');
    }
  };

  const handleCancelDphEdit = () => {
    setDphInput(String(targetDph));
    setIsEditingDph(false);
    setDphSaveNotice(null);
  };

  // Date navigation helpers
  const currentIndex = useMemo(
    () => availableDates.indexOf(selectedDate),
    [availableDates, selectedDate]
  );
  const hasPreviousDate = currentIndex > 0;
  const hasNextDate = currentIndex >= 0 && currentIndex < availableDates.length - 1;

  const handlePrevDate = () => {
    if (hasPreviousDate) {
      setSelectedDate(availableDates[currentIndex - 1]);
    }
  };

  const handleNextDate = () => {
    if (hasNextDate) {
      setSelectedDate(availableDates[currentIndex + 1]);
    }
  };

  // Format date display for selector
  const formattedSelectedDate = useMemo(() => {
    if (!selectedDate) return '';
    try {
      const d = new Date(`${selectedDate}T00:00:00`);
      return d.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return selectedDate;
    }
  }, [selectedDate]);

  return (
    <div className="analytics-container">
      {/* 1. Above Section: Tab Switcher & Store Selector Card (Replicating Rider Analytics) */}
      <div className="section-card">
        <div className="flex-row items-center justify-between gap-md flex-wrap">
          <div className="analytics-tab-pill-group">
            <div className="analytics-tab-pill active">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
              <span>Hourly Slot Planning</span>
            </div>
          </div>

          <div className="store-selector-group">
            <span className="field-label">Store:</span>
            {isStoreUser ? (
              <div className="store-badge-locked flex-row items-center gap-xs">
                <span className="badge badge-primary">{selectedStore?.store_code}</span>
                <strong>{selectedStore?.store_name}</strong>
              </div>
            ) : (
              <select
                id="planning-store-select"
                className="select-input"
                value={selectedStoreId}
                onChange={(e) => onSelectStoreId(e.target.value)}
                disabled={loading}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.store_code} — {s.store_name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* 2. Top Quick KPI Metric Cards (Replicating Rider Analytics kpi-grid & kpi-card) */}
      <div className="kpi-grid planning-compact-kpi">
        {/* Card 1: Total Projected Orders */}
        <div className="kpi-card">
          <div className="kpi-header-row">
            <span className="kpi-label">Total Projected Orders</span>
          </div>
          <strong className="kpi-value text-blue">
            {loading ? '...' : summary?.totalProjectedOrders.toLocaleString() ?? 0}
          </strong>
          <span className="kpi-sub">
            Slots 6 AM – 11 PM ({summary?.slots.length ?? 18} operational slots)
          </span>
        </div>

        {/* Card 2: Store Operational Target DPH */}
        <div className="kpi-card">
          <div className="kpi-header-row">
            <span className="kpi-label">Store Target DPH</span>
            <span className="kpi-target-badge">Target: {targetDph.toFixed(2)} DPH</span>
          </div>
          <strong className="kpi-value text-green">
            {loading ? '...' : targetDph.toFixed(2)}
          </strong>
          <span className="kpi-sub">Deliveries Per Hour / Slot</span>
        </div>

        {/* Card 3: Peak Required Riders */}
        <div className="kpi-card">
          <div className="kpi-header-row">
            <span className="kpi-label">Peak Required Riders</span>
            {summary && (
              <span
                className="badge badge-secondary"
                style={{ fontSize: '0.68rem', padding: '1px 6px' }}
              >
                {summary.peakHour % 12 === 0 ? 12 : summary.peakHour % 12}{' '}
                {summary.peakHour >= 12 ? 'PM' : 'AM'}
              </span>
            )}
          </div>
          <strong className="kpi-value text-amber">
            {loading ? '...' : summary?.peakRequiredRiders ?? 0}
          </strong>
          <span className="kpi-sub">Max riders required at peak slot</span>
        </div>

        {/* Card 4: Store Avg Required Riders */}
        <div className="kpi-card">
          <div className="kpi-header-row">
            <span className="kpi-label">Store Avg Required Riders</span>
          </div>
          <strong className="kpi-value text-slate">
            {loading ? '...' : `${summary?.avgRequiredRiders.toFixed(1) ?? '0.0'} riders`}
          </strong>
          <span className="kpi-sub">Per active slot hour</span>
        </div>

        {/* Card 5: Last 1-Wk Avg Turn-Up */}
        <div className="kpi-card">
          <div className="kpi-header-row">
            <span className="kpi-label">Last 1-Wk Avg Turn-Up</span>
            <span
              className="badge badge-secondary"
              style={{ fontSize: '0.68rem', padding: '1px 6px' }}
            >
              S2P &amp; OTP
            </span>
          </div>
          <strong className="kpi-value text-blue">
            {loading ? '...' : `${summary?.avgTurnUp ?? 0} riders`}
          </strong>
          <span className="kpi-sub">
            Peak Turn-Up: {summary?.peakTurnUp ?? 0} riders
          </span>
        </div>

        {/* Card 6: Net Capacity Variance */}
        <div className="kpi-card">
          <div className="kpi-header-row">
            <span className="kpi-label">Net Capacity Variance</span>
            <span
              className={`badge ${
                (summary?.netTurnUpDelta ?? 0) < 0 ? 'badge-danger' : 'badge-success'
              }`}
              style={{ fontSize: '0.68rem', padding: '1px 6px' }}
            >
              {(summary?.netTurnUpDelta ?? 0) < 0 ? '⚠ Deficit' : '✓ Capacity Met'}
            </span>
          </div>
          <strong
            className={`kpi-value ${
              !loading && (summary?.netTurnUpDelta ?? 0) < 0 ? 'text-red' : 'text-green'
            }`}
          >
            {loading
              ? '...'
              : (summary?.netTurnUpDelta ?? 0) > 0
              ? `+${summary?.netTurnUpDelta.toFixed(1)}`
              : summary?.netTurnUpDelta.toFixed(1) ?? '0.0'}
          </strong>
          <span className="kpi-sub">
            {(summary?.netTurnUpDelta ?? 0) < 0
              ? 'Turn-up trails projected demand'
              : 'Expected turn-up meets or exceeds demand'}
          </span>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="alert-box alert-box-warning my-sm" role="alert">
          <strong>Planning Error:</strong> {error}
        </div>
      )}

      {/* SNOP Data Notice if missing */}
      {summary && !summary.hasSnopData && (
        <div className="alert-box alert-box-warning my-sm" role="alert">
          <strong>No SNOP Forecast data for {formattedSelectedDate}.</strong>{' '}
          Upload a forecast file for this date in Data Ingestion, or choose another date from the dropdown.
        </div>
      )}

      {/* 3. Primary Table Section Card (Replicating Rider Analytics perf-card) */}
      <div className="section-card perf-card planning-perf-card">
        {/* Section Header */}
        <div className="perf-section-header">
          <div className="flex-row items-center justify-between gap-md flex-wrap">
            <div>
              <h3 className="section-title">Hourly Slot Planning Table</h3>
              <p className="section-subtitle">
                Slot-wise projected demand and required rider workforce against historical turn-up for{' '}
                <strong>{selectedStore?.store_code} — {selectedStore?.store_name}</strong>.
              </p>
            </div>

            {onNavigateToUploadSnop && (
              <button
                type="button"
                className="btn btn-secondary btn-manage-shifts"
                onClick={onNavigateToUploadSnop}
                title="Upload or rewrite SNOP Forecast in Data Ingestion"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span>Ingest SNOP</span>
              </button>
            )}
          </div>
        </div>

        {/* Controls Toolbar (Replicating Rider Analytics perf-controls-bar) */}
        <div className="perf-controls-bar">
          <div className="perf-controls-left">
            {/* Planning Date Dropdown */}
            <div className="perf-filter-group">
              <label htmlFor="planning-date-select" className="perf-control-label">
                Planning Date:
              </label>
              <div className="custom-select-wrapper">
                <select
                  id="planning-date-select"
                  className="perf-dropdown-select"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  disabled={loading}
                >
                  {availableDates.map((dStr) => {
                    const dObj = new Date(`${dStr}T00:00:00`);
                    const label = dObj.toLocaleDateString('en-GB', {
                      weekday: 'short',
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    });
                    return (
                      <option key={dStr} value={dStr}>
                        {label}
                      </option>
                    );
                  })}
                  {!availableDates.includes(selectedDate) && selectedDate && (
                    <option value={selectedDate}>{selectedDate}</option>
                  )}
                </select>
                <span className="select-chevron" aria-hidden="true">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path
                      d="M6 8l4 4 4-4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>
            </div>

            {/* Prev / Next Day navigation */}
            <div className="segmented-control">
              <button
                type="button"
                className="segmented-btn"
                onClick={handlePrevDate}
                disabled={!hasPreviousDate || loading}
                title="Previous Day"
              >
                ‹ Prev
              </button>
              <button
                type="button"
                className="segmented-btn"
                onClick={handleNextDate}
                disabled={!hasNextDate || loading}
                title="Next Day"
              >
                Next ›
              </button>
            </div>

            {/* Calendar Date Input */}
            <div className="perf-filter-group">
              <input
                type="date"
                className="custom-range-date-input"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                disabled={loading}
              />
            </div>

            {/* Target DPH Segmented Control & Inline Editor */}
            <div className="perf-filter-group">
              <span className="perf-control-label">Target DPH:</span>
              {!isEditingDph ? (
                <div className="segmented-control">
                  <span
                    className="segmented-btn segmented-btn-active font-mono font-bold"
                    style={{ color: '#166534' }}
                  >
                    {targetDph.toFixed(2)} DPH
                  </span>
                  <button
                    type="button"
                    className="segmented-btn"
                    onClick={() => setIsEditingDph(true)}
                    title="Edit Target DPH"
                  >
                    ✏️ Edit
                  </button>
                </div>
              ) : (
                <div className="custom-range-inline-picker">
                  <input
                    type="number"
                    step="0.05"
                    min="0.5"
                    max="10"
                    className="custom-range-date-input"
                    style={{ width: '70px', fontWeight: 'bold' }}
                    value={dphInput}
                    onChange={(e) => setDphInput(e.target.value)}
                    disabled={isSavingDph}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn-apply-custom"
                    onClick={() => void handleSaveDph()}
                    disabled={isSavingDph}
                  >
                    {isSavingDph ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className="segmented-btn"
                    onClick={handleCancelDphEdit}
                    disabled={isSavingDph}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {dphSaveNotice && (
                <span className="text-xs text-green font-semibold ml-xs">
                  {dphSaveNotice}
                </span>
              )}
            </div>
          </div>

          {/* Right Actions: Refresh and Export Excel */}
          <div className="perf-actions-right">
            <button
              type="button"
              className="btn btn-secondary btn-sm perf-btn-refresh"
              onClick={() => void loadPlanningData()}
              disabled={loading}
              title="Refresh planning calculations"
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
                <path
                  d="M23 4v6h-6M1 20v-6h6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
            </button>

            <button
              type="button"
              className="btn-export-excel"
              onClick={() =>
                summary && exportPlanningToExcel(summary, selectedStore?.store_name || '')
              }
              disabled={!summary || summary.slots.length === 0}
              title="Download Planning Sheet as Excel"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points="7 10 12 15 17 10"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <line
                  x1="12"
                  y1="15"
                  x2="12"
                  y2="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Export Excel</span>
            </button>
          </div>
        </div>

        {/* Callout Banner (Replicating Rider Analytics .perf-view-callout) */}
        {summary && (
          <div className="perf-view-callout callout-summary">
            <div className="callout-left">
              <span className="callout-badge">Operations Plan</span>
              <span className="callout-text">
                Displaying hourly order projections for <strong>{formattedSelectedDate}</strong> with required workforce sizing computed at <strong>{targetDph.toFixed(2)} DPH</strong> [<code>CEIL(Orders ÷ DPH)</code>].
              </span>
            </div>
            <span className="text-secondary text-xs">
              Store: <strong>{selectedStore?.store_code}</strong> ({availableDates.length} forecast days available)
            </span>
          </div>
        )}

        {/* Table Wrapper (Replicating Rider Analytics .perf-table-wrapper & .perf-pivot-table) */}
        <div className="perf-table-wrapper planning-table-wrapper">
          <table
            className="perf-pivot-table"
            aria-label="Hourly Slot Planning Table"
          >
            <thead>
              <tr className="tier1-header-row modern-summary-header">
                <th
                  className="th-rider-name sticky-col text-center"
                  style={{ minWidth: '75px', width: '75px' }}
                >
                  <div className="th-content th-content-center">
                    <span>Slot Window</span>
                  </div>
                </th>

                <th className="th-avg-group text-center">
                  <div className="th-content th-content-center">
                    <span>Projected Orders</span>
                  </div>
                </th>

                <th
                  className="th-avg-group text-center"
                  style={{ backgroundColor: '#eff6ff', color: '#1e40af' }}
                >
                  <div className="th-content th-content-center">
                    <span>Required Riders</span>
                  </div>
                </th>

                <th className="th-avg-group text-center">
                  <div className="th-content th-content-center">
                    <span>Last 1-Wk Avg Turn-Up</span>
                  </div>
                </th>

                <th className="th-avg-group text-center">
                  <div className="th-content th-content-center">
                    <span>Capacity Variance</span>
                  </div>
                </th>

                <th className="th-active-status text-center">
                  <div className="th-content th-content-center">
                    <span>Status</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {summary?.slots.map((s) => {
                const isDeficit = s.status === 'deficit';
                const isSurplus = s.status === 'surplus';

                return (
                  <tr key={s.hour} className="perf-data-row">
                    {/* Slot Window (strictly hour number, e.g. 6) */}
                    <td className="td-rider-name sticky-col text-center font-bold">
                      {s.hour}
                    </td>

                    {/* Projected Orders */}
                    <td className="td-active text-center font-semibold text-blue">
                      {s.projectedOrders > 0 ? s.projectedOrders.toLocaleString() : '0'}
                    </td>

                    {/* Required Riders */}
                    <td
                      className="td-active text-center"
                      style={{ backgroundColor: '#f0f7ff' }}
                    >
                      <strong className="text-blue font-extrabold text-base">
                        {s.requiredRiders}
                      </strong>
                    </td>

                    {/* Last 1-Week Average Turn-Up (rounded down to nearest whole number) */}
                    <td className="td-active text-center font-medium">
                      <span className={s.avgTurnUpLastWeek > 0 ? 'text-slate font-semibold' : 'text-muted'}>
                        {s.avgTurnUpLastWeek}
                      </span>
                    </td>

                    {/* Capacity Variance */}
                    <td className="td-active text-center">
                      {s.requiredRiders === 0 && s.avgTurnUpLastWeek === 0 ? (
                        <span className="text-muted">—</span>
                      ) : isDeficit ? (
                        <span className="badge badge-danger">
                          ⚠ {s.deltaTurnUpVsRequired > 0 ? `+${s.deltaTurnUpVsRequired}` : s.deltaTurnUpVsRequired} Short
                        </span>
                      ) : (
                        <span className="badge badge-success">
                          ✓ {s.deltaTurnUpVsRequired > 0 ? `+${s.deltaTurnUpVsRequired}` : s.deltaTurnUpVsRequired} Surplus
                        </span>
                      )}
                    </td>

                    {/* Capacity Status Badge */}
                    <td className="td-active text-center">
                      {isDeficit ? (
                        <span className="badge badge-danger font-bold">
                          ⚠ Deficit ({s.turnUpCoveragePct}%)
                        </span>
                      ) : isSurplus ? (
                        <span className="badge badge-active-yes">
                          ✓ Surplus
                        </span>
                      ) : (
                        <span className="badge badge-secondary">
                          Balanced
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* Totals & Operational Rollup Footer */}
            {summary && summary.slots.length > 0 && (
              <tfoot>
                <tr className="tier1-header-row modern-summary-header font-bold">
                  <td className="th-rider-name sticky-col text-center font-bold">
                    TOTALS
                  </td>

                  <td className="th-avg-group text-center font-bold text-blue">
                    {summary.totalProjectedOrders.toLocaleString()}
                  </td>

                  <td
                    className="th-avg-group text-center font-bold"
                    style={{ backgroundColor: '#eff6ff', color: '#1e40af' }}
                  >
                    Peak: {summary.peakRequiredRiders} | Avg: {summary.avgRequiredRiders.toFixed(1)}
                  </td>

                  <td className="th-avg-group text-center font-bold">
                    Peak: {summary.peakTurnUp} | Avg: {summary.avgTurnUp}
                  </td>

                  <td className="th-avg-group text-center font-bold">
                    <span
                      className={`badge ${
                        summary.netTurnUpDelta < 0 ? 'badge-danger' : 'badge-success'
                      }`}
                    >
                      Net: {summary.netTurnUpDelta > 0 ? `+${summary.netTurnUpDelta}` : summary.netTurnUpDelta}
                    </span>
                  </td>

                  <td className="th-active-status text-center font-bold">
                    <span
                      className={`badge ${
                        summary.netTurnUpDelta < 0 ? 'badge-danger' : 'badge-success'
                      }`}
                    >
                      {summary.netTurnUpDelta < 0 ? 'Net Deficit' : 'Capacity Met'}
                    </span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
