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
  getDefaultPlanningDate,
  getStoreTargetDphSync,
  recalculatePlanningWithDph,
  saveStoreTargetDph,
  subscribeStoreTargetDph,
} from '../services/planningService';
import {
  type RiderAttendanceRecord,
  type StoreAttendanceSummary,
  buildAttendanceSummary,
  fetchStoreRiderAttendance,
  subscribeStoreRiderAttendance,
} from '../services/riderAttendanceService';
import { RiderAttendanceModal } from './RiderAttendanceModal';

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

  // Rider attendance state for tomorrow / selected date
  const [attendanceSummary, setAttendanceSummary] = useState<StoreAttendanceSummary | null>(null);
  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);

  // Load available forecast dates whenever store changes
  useEffect(() => {
    if (!selectedStore) return;
    const storeCode = selectedStore.store_code;
    const dates = getAvailableForecastDates(storeCode);
    setAvailableDates(dates);

    // Display next dates data from current date by default (e.g. tomorrow or nearest upcoming forecast date)
    setSelectedDate((prev) => {
      if (prev && dates.includes(prev)) return prev;
      return getDefaultPlanningDate(dates, selectedStore.timezone || 'Asia/Kolkata');
    });

    // Sync DPH for store
    void fetchStoreTargetDph(storeCode).then((val) => {
      setTargetDph(val);
      setDphInput(String(val));
    });

    // Realtime subscription for cross-session / multi-tab DPH updates
    const unsubscribe = subscribeStoreTargetDph(storeCode, (newDph) => {
      setTargetDph(newDph);
      setDphInput(String(newDph));
      setSummary((prev) => (prev ? recalculatePlanningWithDph(prev, newDph) : null));
    });

    return () => {
      unsubscribe();
    };
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

  // Load Attendance Summary and subscribe to real-time attendance changes
  useEffect(() => {
    if (!selectedStore || !selectedDate) return;
    const storeCode = selectedStore.store_code;

    void fetchStoreRiderAttendance({
      storeId: selectedStore.id,
      warehouseId: storeCode,
      attendanceDate: selectedDate,
    }).then((att) => {
      setAttendanceSummary(att);
    });

    const unsubAttendance = subscribeStoreRiderAttendance(
      storeCode,
      selectedDate,
      (newSummary) => {
        setAttendanceSummary(newSummary);
        void loadPlanningData();
      }
    );

    return () => {
      unsubAttendance();
    };
  }, [selectedStore, selectedDate, loadPlanningData]);

  const handleAttendanceSaved = (updatedRecords: RiderAttendanceRecord[]) => {
    const newSummary = buildAttendanceSummary(
      selectedStore?.store_code || 'TMK7',
      selectedDate,
      updatedRecords,
      selectedStore?.id
    );
    setAttendanceSummary(newSummary);
    void loadPlanningData();
  };

  // Handle changing DPH input with live recalculation of Required Riders, Turn-Up & Status
  const handleDphInputChange = (valStr: string) => {
    setDphInput(valStr);
    const parsed = parseFloat(valStr);
    if (!isNaN(parsed) && parsed > 0) {
      setTargetDph(parsed);
      setSummary((prev) => (prev ? recalculatePlanningWithDph(prev, parsed) : null));
    }
  };

  // Quick increment/decrement stepper for Target DPH (+0.1 / -0.1)
  const handleStepDph = (delta: number) => {
    const nextVal = Math.max(0.5, Math.min(10, Math.round((targetDph + delta) * 10) / 10));
    setDphInput(nextVal.toFixed(1));
    setTargetDph(nextVal);
    setSummary((prev) => (prev ? recalculatePlanningWithDph(prev, nextVal) : null));
    void saveStoreTargetDph(
      selectedStore?.store_code || 'TMK7',
      nextVal,
      currentUser?.email || 'User'
    );
  };

  // Save updated DPH to Supabase and persist
  const handleSaveDph = async () => {
    const parsed = parseFloat(dphInput);
    if (isNaN(parsed) || parsed <= 0) {
      setDphSaveNotice('Invalid DPH: Must be a positive number greater than 0.');
      return;
    }

    // Immediately recalculate summary
    setTargetDph(parsed);
    setSummary((prev) => (prev ? recalculatePlanningWithDph(prev, parsed) : null));

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
      setIsEditingDph(false);
      setDphSaveNotice(`✓ Target DPH saved (${parsed.toFixed(2)})`);
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

        {/* Card 2: Peak Required Riders - Morning (6 AM – 3 PM) */}
        <div className="kpi-card">
          <div className="kpi-header-row">
            <span className="kpi-label">PEAK REQUIRED RIDERS - Morning</span>
            {summary && (
              <span
                className="badge badge-secondary"
                style={{ fontSize: '0.68rem', padding: '1px 6px' }}
                title={`Morning Shift Peak Slot: Hour ${summary.peakMorning?.hour ?? 6} (${summary.peakMorning?.slotLabel ?? '6 AM'})`}
              >
                Slot {summary.peakMorning?.hour ?? 6} ({summary.peakMorning?.slotLabel ?? '6 AM'})
              </span>
            )}
          </div>
          <strong className="kpi-value text-amber">
            {loading ? '...' : summary?.peakMorning?.requiredRiders ?? 0}
          </strong>
          <span className="kpi-sub">
            Peak Demand: <strong>{summary?.peakMorning?.projectedOrders.toLocaleString() ?? 0} orders</strong> (6 AM – 3 PM)
          </span>
        </div>

        {/* Card 3: Peak Required Riders - 2nd (3 PM – 12 AM) */}
        <div className="kpi-card">
          <div className="kpi-header-row">
            <span className="kpi-label">PEAK REQUIRED RIDERS - 2nd</span>
            {summary && (
              <span
                className="badge badge-secondary"
                style={{ fontSize: '0.68rem', padding: '1px 6px' }}
                title={`2nd Shift Peak Slot: Hour ${summary.peakSecond?.hour ?? 15} (${summary.peakSecond?.slotLabel ?? '3 PM'})`}
              >
                Slot {summary.peakSecond?.hour ?? 15} ({summary.peakSecond?.slotLabel ?? '3 PM'})
              </span>
            )}
          </div>
          <strong className="kpi-value text-amber">
            {loading ? '...' : summary?.peakSecond?.requiredRiders ?? 0}
          </strong>
          <span className="kpi-sub">
            Peak Demand: <strong>{summary?.peakSecond?.projectedOrders.toLocaleString() ?? 0} orders</strong> (3 PM – 12 AM)
          </span>
        </div>

        {/* Card 4: Planned Workforce Balance */}
        <div className="kpi-card">
          <div className="kpi-header-row">
            <span className="kpi-label">PLANNED WORKFORCE BALANCE</span>
            {summary && (
              <span
                className={`badge ${
                  summary.netTurnUpDelta < 0
                    ? 'badge-danger'
                    : summary.netTurnUpDelta > 0
                    ? 'badge-success'
                    : 'badge-secondary'
                }`}
                style={{ fontSize: '0.68rem', padding: '1px 6px' }}
              >
                {summary.netTurnUpDelta > 0
                  ? `+${summary.netTurnUpDelta} Surplus`
                  : summary.netTurnUpDelta < 0
                  ? `${summary.netTurnUpDelta} Short`
                  : 'Balanced'}
              </span>
            )}
          </div>
          <strong
            className={`kpi-value ${
              (summary?.netTurnUpDelta ?? 0) < 0
                ? 'text-red'
                : (summary?.netTurnUpDelta ?? 0) > 0
                ? 'text-green'
                : 'text-slate'
            }`}
          >
            {loading
              ? '...'
              : `${attendanceSummary?.presentCount ?? 0} Present`}
          </strong>
          <span className="kpi-sub">
            {attendanceSummary ? (
              <>
                Active: <strong>{attendanceSummary.totalRiders}</strong> | Peak Slot: <strong>{summary?.peakTurnUp ?? 0} riders</strong>
              </>
            ) : (
              'Attendance unmarked'
            )}
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

            {/* Target DPH Segmented Control & Inline Editor */}
            <div className="perf-filter-group">
              <span className="perf-control-label">Target DPH:</span>
              {!isEditingDph ? (
                <div className="segmented-control">
                  <button
                    type="button"
                    className="segmented-btn"
                    onClick={() => handleStepDph(-0.1)}
                    title="Decrease DPH by 0.1 (recalculates immediately)"
                  >
                    −
                  </button>
                  <span
                    className="segmented-btn segmented-btn-active font-mono font-bold"
                    style={{ color: '#166534', minWidth: '70px', textAlign: 'center' }}
                  >
                    {targetDph.toFixed(2)} DPH
                  </span>
                  <button
                    type="button"
                    className="segmented-btn"
                    onClick={() => handleStepDph(0.1)}
                    title="Increase DPH by 0.1 (recalculates immediately)"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="segmented-btn"
                    onClick={() => {
                      setDphInput(String(targetDph));
                      setIsEditingDph(true);
                    }}
                    title="Edit Target DPH value"
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
                    style={{ width: '75px', fontWeight: 'bold', textAlign: 'center' }}
                    value={dphInput}
                    onChange={(e) => handleDphInputChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleSaveDph();
                      if (e.key === 'Escape') handleCancelDphEdit();
                    }}
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

          {/* Right Actions: Mark Attendance, Refresh, and Export Excel */}
          <div className="perf-actions-right">
            <button
              type="button"
              className={`btn-mark-attendance ${attendanceSummary && attendanceSummary.presentCount > 0 ? 'has-attendance' : ''}`}
              onClick={() => setIsAttendanceModalOpen(true)}
              title="Mark next day's rider attendance and populate expected slot turn-up"
            >
              <span style={{ fontSize: '1rem', lineHeight: 1 }}>📋</span>
              <span>
                {attendanceSummary && attendanceSummary.presentCount > 0
                  ? `Attendance: ${attendanceSummary.presentCount} Present`
                  : 'Mark Attendance'}
              </span>
              {(!attendanceSummary || attendanceSummary.presentCount === 0) ? (
                <span className="attendance-unmarked-badge">Unmarked</span>
              ) : (
                <span className="attendance-badge-present">
                  {attendanceSummary.presentCount}/{attendanceSummary.totalRiders}
                </span>
              )}
            </button>

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
                Displaying hourly order projections for <strong>{formattedSelectedDate}</strong> with required workforce sizing computed at <strong>{targetDph.toFixed(2)} DPH</strong> [<code>CEIL(Orders ÷ DPH)</code>] and turn-up from marked attendance ({attendanceSummary?.presentCount ?? 0} Present).
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
                  style={{ minWidth: '85px', width: '95px', textAlign: 'center' }}
                >
                  <div className="th-content th-content-center" style={{ justifyContent: 'center', textAlign: 'center' }}>
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
                    <span>Planned Turn-Up</span>
                  </div>
                </th>

                <th className="th-avg-group text-center">
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
                    <td
                      className="td-rider-name sticky-col text-center font-bold"
                      style={{ textAlign: 'center' }}
                    >
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

                    {/* Planned Turn-Up (populated from marked attendance) */}
                    <td className="td-active text-center font-medium">
                      <span className={s.plannedTurnUp > 0 ? 'text-slate font-semibold text-base' : 'text-muted'}>
                        {s.plannedTurnUp}
                      </span>
                    </td>

                    {/* Status Column with Coloured Gradient Font for Short vs Surplus */}
                    <td className="td-active text-center">
                      {s.requiredRiders === 0 && s.plannedTurnUp === 0 ? (
                        <span className="text-muted">—</span>
                      ) : isDeficit ? (
                        <span className="status-pill status-pill-short">
                          <span className="status-symbol">⚠</span>
                          <span className="status-gradient-short">
                            {s.deltaTurnUpVsRequired} Short
                          </span>
                        </span>
                      ) : isSurplus ? (
                        <span className="status-pill status-pill-surplus">
                          <span className="status-symbol">✓</span>
                          <span className="status-gradient-surplus">
                            +{s.deltaTurnUpVsRequired} Surplus
                          </span>
                        </span>
                      ) : (
                        <span className="status-pill status-pill-balanced">
                          <span className="status-symbol">✓</span>
                          <span className="status-gradient-balanced">
                            Balanced
                          </span>
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
                  <td
                    className="th-rider-name sticky-col text-center font-bold"
                    style={{ textAlign: 'center' }}
                  >
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
                      className={`status-pill ${
                        summary.netTurnUpDelta < 0
                          ? 'status-pill-short'
                          : summary.netTurnUpDelta > 0
                          ? 'status-pill-surplus'
                          : 'status-pill-balanced'
                      }`}
                    >
                      <span className="status-symbol">
                        {summary.netTurnUpDelta < 0 ? '⚠' : '✓'}
                      </span>
                      <span
                        className={
                          summary.netTurnUpDelta < 0
                            ? 'status-gradient-short'
                            : summary.netTurnUpDelta > 0
                            ? 'status-gradient-surplus'
                            : 'status-gradient-balanced'
                        }
                      >
                        Net: {summary.netTurnUpDelta > 0 ? `+${summary.netTurnUpDelta} Surplus` : summary.netTurnUpDelta < 0 ? `${summary.netTurnUpDelta} Short` : 'Balanced'}
                      </span>
                    </span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Rider Attendance Modal */}
      {selectedStore && (
        <RiderAttendanceModal
          isOpen={isAttendanceModalOpen}
          onClose={() => setIsAttendanceModalOpen(false)}
          storeId={selectedStore.id}
          warehouseId={selectedStore.store_code}
          storeName={selectedStore.store_name}
          attendanceDate={selectedDate}
          initialRecords={attendanceSummary?.records ?? []}
          onSaved={handleAttendanceSaved}
        />
      )}
    </div>
  );
};
