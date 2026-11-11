import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { StoreMaster } from '../domain/types';
import {
  type PlanVsActualAuditSummary,
  type HourlySlotReconciliation,
  type AdherenceCategory,
  fetchPlanVsActualAudit,
  fetchAvailableAuditDates,
  exportPlanVsActualAuditToExcel,
  formatAuditSlotLabel,
} from '../services/planVsActualAuditService';

interface PlanVsActualAuditViewProps {
  selectedStore: StoreMaster;
  onNavigateToForwardPlan?: () => void;
}

export const PlanVsActualAuditView: React.FC<PlanVsActualAuditViewProps> = ({
  selectedStore,
  onNavigateToForwardPlan,
}) => {
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [summary, setSummary] = useState<PlanVsActualAuditSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter and search state
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | AdherenceCategory>('ALL');

  // Slot modal inspection state
  const [inspectedSlot, setInspectedSlot] = useState<HourlySlotReconciliation | null>(null);

  // Compute store's current local date (today)
  const todayStr = useMemo(() => {
    const now = new Date();
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone: selectedStore.timezone || 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return dtf.format(now);
  }, [selectedStore]);

  // Formats a date string for display in selectors and labels
  const formatDateLabel = useCallback(
    (dStr: string) => {
      if (!dStr) return '';
      const dObj = new Date(`${dStr}T00:00:00`);
      const formatted = dObj.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      return dStr === todayStr ? `${formatted} (Today)` : formatted;
    },
    [todayStr]
  );

  // Load available dates across batches, orders, attendance, and recent history
  useEffect(() => {
    let isCancelled = false;
    async function loadDates() {
      const dates = await fetchAvailableAuditDates(
        selectedStore.id,
        selectedStore.timezone || 'Asia/Kolkata',
        selectedStore.store_code
      );
      if (!isCancelled) {
        setAvailableDates(dates);
        if (dates.length > 0) {
          setSelectedDate((prev) => (prev && /^\d{4}-\d{2}-\d{2}$/.test(prev) ? prev : dates[0]));
        } else {
          setSelectedDate((prev) => prev || todayStr);
        }
      }
    }
    void loadDates();
    return () => {
      isCancelled = true;
    };
  }, [selectedStore, todayStr]);

  // Load audit data for selected date
  const loadAuditData = useCallback(async () => {
    if (!selectedDate || !selectedStore) return;
    setLoading(true);
    setError(null);

    const res = await fetchPlanVsActualAudit({
      storeId: selectedStore.id,
      warehouseId: selectedStore.store_code,
      dateStr: selectedDate,
    });

    setLoading(false);
    if (res.error) {
      setError(res.error);
    } else if (res.data) {
      setSummary(res.data);
    }
  }, [selectedStore, selectedDate]);

  useEffect(() => {
    void loadAuditData();
  }, [loadAuditData]);

  // Combined set of all selectable dates in the dropdown (guarantees selectedDate & today are present)
  const allDropdownDates = useMemo(() => {
    const set = new Set<string>(availableDates);
    if (selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      set.add(selectedDate);
    }
    if (todayStr) {
      set.add(todayStr);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [availableDates, selectedDate, todayStr]);

  // Shifts a date string by a number of calendar days
  const shiftDateByDays = (dateStr: string, days: number): string => {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    const [y, m, d] = dateStr.split('-').map(Number);
    const dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    dateObj.setUTCDate(dateObj.getUTCDate() + days);
    const yyyy = dateObj.getUTCFullYear();
    const mm = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  // Date navigation handlers allowing navigation across any historical day
  const handlePrevDate = () => {
    const base = selectedDate || todayStr;
    setSelectedDate(shiftDateByDays(base, -1));
  };

  const handleNextDate = () => {
    const base = selectedDate || todayStr;
    if (base >= todayStr) return;
    setSelectedDate(shiftDateByDays(base, 1));
  };

  // Filtered riders
  const filteredRiders = useMemo(() => {
    if (!summary || !summary.hasOrderData) return [];
    return summary.riders.filter((r) => {
      // Category filter
      if (categoryFilter !== 'ALL') {
        if (categoryFilter === 'LATE_ARRIVAL' && r.adherenceCategory !== 'LATE_ARRIVAL') {
          return false;
        }
        if (categoryFilter === 'NO_SHOW' && r.adherenceCategory !== 'NO_SHOW') {
          return false;
        }
        if (categoryFilter === 'EARLY_DEPARTURE' && r.adherenceCategory !== 'EARLY_DEPARTURE') {
          return false;
        }
        if (categoryFilter === 'UNPLANNED_TURNUP' && r.adherenceCategory !== 'UNPLANNED_TURNUP') {
          return false;
        }
        if (categoryFilter === 'COMPLIANT' && r.adherenceCategory !== 'COMPLIANT') {
          return false;
        }
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = r.riderName.toLowerCase().includes(q);
        const matchesPhone = r.phone ? r.phone.toLowerCase().includes(q) : false;
        const matchesOnboarded = r.onboardedBy ? r.onboardedBy.toLowerCase().includes(q) : false;
        const matchesShift = r.shiftType.toLowerCase().includes(q);
        return matchesName || matchesPhone || matchesOnboarded || matchesShift;
      }

      return true;
    });
  }, [summary, categoryFilter, searchQuery]);

  return (
    <div className="plan-audit-container">
      {/* 1. Header Toolbar */}
      <div className="perf-controls-bar perf-controls-bar-structured my-sm">
        <div className="perf-toolbar-tier perf-toolbar-tier-primary">
          <div className="perf-toolbar-group">
            {/* Audit Date Selector */}
            <div className="perf-filter-group">
              <label htmlFor="audit-date-select" className="perf-control-label">
                Audit Date:
              </label>
              <div className="custom-select-wrapper">
                <select
                  id="audit-date-select"
                  className="perf-dropdown-select"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  disabled={loading}
                >
                  {allDropdownDates.map((dStr) => (
                    <option key={dStr} value={dStr}>
                      {formatDateLabel(dStr)}
                    </option>
                  ))}
                </select>
                <span className="select-chevron" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </div>
            </div>

            {/* Calendar Date Picker Input for Any Historical Date */}
            <div className="perf-filter-group">
              <label htmlFor="audit-date-picker" className="perf-control-label">
                Calendar:
              </label>
              <input
                type="date"
                id="audit-date-picker"
                className="perf-dropdown-select perf-date-picker-input"
                value={selectedDate}
                max={todayStr}
                onChange={(e) => {
                  if (e.target.value) {
                    setSelectedDate(e.target.value);
                  }
                }}
                disabled={loading}
                title="Select any historical calendar date"
                aria-label="Pick any calendar date"
              />
            </div>

            {/* Prev / Next Date Navigation */}
            <div className="segmented-control">
              <button
                type="button"
                className="segmented-btn"
                onClick={handlePrevDate}
                disabled={loading}
                title="Previous Day (Older)"
              >
                ‹ Prev Day
              </button>
              <button
                type="button"
                className="segmented-btn"
                onClick={handleNextDate}
                disabled={loading || selectedDate >= todayStr}
                title="Next Day (Newer)"
              >
                Next Day ›
              </button>
            </div>
          </div>

          <div className="perf-toolbar-group perf-toolbar-group-right">
            {onNavigateToForwardPlan && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onNavigateToForwardPlan}
                title="Return to Forward Slot Planning Table"
              >
                ‹ Forward Plan
              </button>
            )}

            {/* Actions: Refresh & Export */}
            <button
              type="button"
              className="btn btn-secondary btn-sm perf-btn-refresh"
              onClick={() => void loadAuditData()}
              disabled={loading}
              title="Refresh audit data"
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
              <span>{loading ? 'Auditing...' : 'Refresh'}</span>
            </button>

            <button
              type="button"
              className="btn-export-excel"
              onClick={() =>
                summary &&
                exportPlanVsActualAuditToExcel(summary, selectedStore.store_name)
              }
              disabled={!summary || !summary.hasOrderData || summary.riders.length === 0}
              title={summary?.hasOrderData ? 'Export Plan vs Actual Audit to Excel' : 'Data not available to export'}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Export Audit Excel</span>
            </button>
          </div>
        </div>

        {/* Search Input - shown only when order data exists */}
        {summary && summary.hasOrderData && (
          <div className="perf-toolbar-tier perf-toolbar-tier-secondary">
            <div className="perf-search-box perf-search-box-wide">
              <span className="search-icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <input
                type="text"
                placeholder="Search rider name, phone, or shift..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="perf-search-input"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="alert-box alert-box-warning my-sm" role="alert">
          <strong>Audit Warning:</strong> {error}
        </div>
      )}

      {/* 2. Loading State */}
      {loading && (
        <div className="section-card perf-card text-center p-xl my-md">
          <div className="perf-loading-state" style={{ justifyContent: 'center' }}>
            <div className="spinner-sm" aria-hidden="true" />
            <span>Auditing plan vs actual attendance and orders for {formatDateLabel(selectedDate)}...</span>
          </div>
        </div>
      )}

      {/* 3. Data Not Available / Pending Actual Orders State */}
      {!loading && summary && !summary.hasOrderData && (
        <div className="section-card perf-card text-center p-xl my-md">
          <div className="mb-sm" style={{ fontSize: '2.5rem' }} aria-hidden="true">
            {summary.hasAttendanceData ? '⏳' : '📋'}
          </div>
          <h3 className="section-title editorial-serif-heading text-lg font-bold mb-xs">
            {summary.hasAttendanceData
              ? 'Actual Order Data Not Uploaded Yet'
              : 'Data Not Available'}
          </h3>
          <div className="section-subtitle max-w-lg mx-auto mb-md" style={{ color: 'var(--color-slate-400, #94a3b8)' }}>
            {summary.hasAttendanceData ? (
              <>
                <p className="mb-xs">
                  Attendance and shift schedules are saved for <strong>{summary.formattedDate || formatDateLabel(selectedDate)}</strong> ({summary.plannedPresentCount} {summary.plannedPresentCount === 1 ? 'rider' : 'riders'} planned in turn-up), but delivered order records have not been uploaded yet for store <strong>{selectedStore.store_name}</strong>.
                </p>
                <p className="text-xs text-muted m-0">
                  The <strong>Hourly Slot Planning Table</strong> displays your forward schedule (attendance &amp; shifts), whereas <strong>Plan vs Actual Audit</strong> cross-checks scheduled shifts against completed customer orders. Once order data for this date is uploaded in Data Ingestion, actual turn-up and rider adherence will calculate here automatically.
                </p>
              </>
            ) : (
              <p className="m-0">
                No order delivery or attendance data is available for <strong>{summary.formattedDate || formatDateLabel(selectedDate)}</strong> for store <strong>{selectedStore.store_name}</strong>.
              </p>
            )}
          </div>

          <div className="flex-row items-center justify-center gap-sm flex-wrap mt-md">
            {summary.hasAttendanceData && onNavigateToForwardPlan && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={onNavigateToForwardPlan}
              >
                ‹ View Planned Turn-Up in Forward Plan
              </button>
            )}
            {availableDates.length > 0 && availableDates[0] !== selectedDate && (
              <button
                type="button"
                className={summary.hasAttendanceData && onNavigateToForwardPlan ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}
                onClick={() => setSelectedDate(availableDates[0])}
              >
                Go to Latest Available ({formatDateLabel(availableDates[0])})
              </button>
            )}
            {selectedDate !== todayStr && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedDate(todayStr)}
              >
                Go to Today ({formatDateLabel(todayStr)})
              </button>
            )}
          </div>
        </div>
      )}

      {/* 4. Full Plan vs Actual Audit View */}
      {!loading && summary && summary.hasOrderData && (
        <>
          {/* Top Summary KPI Cards */}
          <div className="kpi-grid planning-compact-kpi mb-md">
            {/* Card 1: Turn-Up Rate */}
            <div className="kpi-card">
            <div className="kpi-header-row">
              <span className="kpi-label">Planned vs Actual Turn-Up</span>
              <span className={`badge ${summary.turnUpRatePct >= 90 ? 'badge-success' : summary.turnUpRatePct >= 75 ? 'badge-warning' : 'badge-danger'}`} style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                {summary.turnUpRatePct}% Rate
              </span>
            </div>
            <strong className="kpi-value text-blue">
              {summary.actualWorkedCount} / {summary.plannedPresentCount} Worked
            </strong>
            <span className="kpi-sub">
              {summary.plannedPresentCount - summary.actualWorkedCount > 0
                ? `${summary.plannedPresentCount - summary.actualWorkedCount} fewer riders than planned`
                : 'Full planned workforce turned up'}
            </span>
          </div>

          {/* Card 2: No-Shows (False Present) */}
          <div
            className={`kpi-card kpi-card-interactive ${categoryFilter === 'NO_SHOW' ? 'kpi-card-active' : ''}`}
            onClick={() => setCategoryFilter((prev) => (prev === 'NO_SHOW' ? 'ALL' : 'NO_SHOW'))}
            title="Click to filter to No-Show riders"
          >
            <div className="kpi-header-row">
              <span className="kpi-label">No-Shows (False Present)</span>
              {summary.noShowCount > 0 ? (
                <span className="badge badge-danger" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                  {summary.noShowCount} Critical
                </span>
              ) : (
                <span className="badge badge-success" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                  0 No-Shows
                </span>
              )}
            </div>
            <strong className={`kpi-value ${summary.noShowCount > 0 ? 'text-red' : 'text-slate'}`}>
              {summary.noShowCount} Riders
            </strong>
            <span className="kpi-sub">Marked Present but 0 orders delivered</span>
          </div>

          {/* Card 3: Late Arrivals */}
          <div
            className={`kpi-card kpi-card-interactive ${categoryFilter === 'LATE_ARRIVAL' ? 'kpi-card-active' : ''}`}
            onClick={() => setCategoryFilter((prev) => (prev === 'LATE_ARRIVAL' ? 'ALL' : 'LATE_ARRIVAL'))}
            title="Click to filter to Late Arrival riders"
          >
            <div className="kpi-header-row">
              <span className="kpi-label">Late Arrivals (Missed Slots)</span>
              {summary.lateArrivalCount > 0 ? (
                <span className="badge badge-warning" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                  {summary.lateArrivalCount} Delayed
                </span>
              ) : (
                <span className="badge badge-success" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                  All on time
                </span>
              )}
            </div>
            <strong className={`kpi-value ${summary.lateArrivalCount > 0 ? 'text-amber' : 'text-slate'}`}>
              {summary.lateArrivalCount} Riders
            </strong>
            <span className="kpi-sub">
              {summary.lateArrivalCount > 0
                ? `Avg ${summary.avgLateArrivalHours}h delayed starting slot`
                : 'Zero late arrivals detected'}
            </span>
          </div>

          {/* Card 4: Total Missed Slots */}
          <div className="kpi-card">
            <div className="kpi-header-row">
              <span className="kpi-label">Total Lost Slot Capacity</span>
              <span className="badge badge-secondary" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                Lost Hours
              </span>
            </div>
            <strong className="kpi-value text-slate">
              {summary.totalMissedSlotHours} Slot-Hours
            </strong>
            <span className="kpi-sub">Lost morning/evening shift coverage</span>
          </div>

          {/* Card 5: Unplanned Turn-Up */}
          <div
            className={`kpi-card kpi-card-interactive ${categoryFilter === 'UNPLANNED_TURNUP' ? 'kpi-card-active' : ''}`}
            onClick={() => setCategoryFilter((prev) => (prev === 'UNPLANNED_TURNUP' ? 'ALL' : 'UNPLANNED_TURNUP'))}
            title="Click to filter to Unplanned riders"
          >
            <div className="kpi-header-row">
              <span className="kpi-label">Unplanned Turn-Up</span>
              <span className="badge badge-info" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                Ad-hoc
              </span>
            </div>
            <strong className="kpi-value text-blue">
              {summary.unplannedTurnUpCount} Riders
            </strong>
            <span className="kpi-sub">Marked Absent/Unmarked but worked</span>
          </div>
        </div>

        {/* 3. Hourly Slot Turn-Up Reconciliation Bar (Slots 6 AM to 11 PM) */}
        {summary.hourlySlots.length > 0 && (
          <div className="section-card perf-card mb-md p-md">
            <div className="flex-row items-center justify-between gap-md mb-sm flex-wrap">
              <div>
                <h4 className="font-bold text-sm text-slate-800 m-0">
                  Hourly Slot Turn-Up Reconciliation ({summary.formattedDate})
                </h4>
                <p className="text-xs text-muted m-0">
                  Click any slot box to view scheduled riders vs who showed up and who was missing.
                </p>
              </div>
              <div className="flex-row items-center gap-sm text-xs">
                <span className="flex-row items-center gap-xs">
                  <span className="legend-dot dot-deficit" /> Deficit (Late/No-Show)
                </span>
                <span className="flex-row items-center gap-xs">
                  <span className="legend-dot dot-balanced" /> Balanced
                </span>
                <span className="flex-row items-center gap-xs">
                  <span className="legend-dot dot-surplus" /> Surplus
                </span>
              </div>
            </div>

            <div className="hourly-reconciliation-strip">
              {summary.hourlySlots.map((s) => {
                const isDeficit = s.variance < 0;
                const isSurplus = s.variance > 0;
                return (
                  <button
                    key={s.hour}
                    type="button"
                    className={`hourly-slot-box cursor-pointer ${
                      isDeficit ? 'box-deficit' : isSurplus ? 'box-surplus' : 'box-balanced'
                    }`}
                    onClick={() => setInspectedSlot(s)}
                    title={`Slot ${s.hour} (${s.slotLabel}): Planned ${s.plannedTurnUp} | Actual ${s.actualTurnUp} (${s.variance >= 0 ? `+${s.variance}` : s.variance}). Click to inspect riders.`}
                  >
                    <span className="slot-box-hour">{s.hour}</span>
                    <span className="slot-box-counts">
                      <strong>{s.actualTurnUp}</strong>
                      <small className="muted">/{s.plannedTurnUp}</small>
                    </span>
                    <span className={`slot-box-tag ${isDeficit ? 'tag-deficit' : isSurplus ? 'tag-surplus' : 'tag-balanced'}`}>
                      {s.variance > 0 ? `+${s.variance}` : s.variance < 0 ? s.variance : '✓'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 4. Filter Pills */}
        <div className="perf-filter-group mb-sm flex-row items-center gap-xs flex-wrap">
          <span className="perf-control-label">Filter Verdict:</span>
          <div className="perf-highlight-pills flex-wrap">
            <button
              type="button"
              className={`segmented-btn ${categoryFilter === 'ALL' ? 'segmented-btn-active' : ''}`}
              onClick={() => setCategoryFilter('ALL')}
            >
              All Riders ({summary.riders.length})
            </button>
            <button
              type="button"
              className={`segmented-btn ${categoryFilter === 'NO_SHOW' ? 'segmented-btn-active font-bold text-red' : ''}`}
              onClick={() => setCategoryFilter('NO_SHOW')}
            >
              🔴 No-Shows ({summary.noShowCount})
            </button>
            <button
              type="button"
              className={`segmented-btn ${categoryFilter === 'LATE_ARRIVAL' ? 'segmented-btn-active font-bold text-amber' : ''}`}
              onClick={() => setCategoryFilter('LATE_ARRIVAL')}
            >
              🟡 Late Arrivals ({summary.lateArrivalCount})
            </button>
            <button
              type="button"
              className={`segmented-btn ${categoryFilter === 'EARLY_DEPARTURE' ? 'segmented-btn-active font-bold' : ''}`}
              onClick={() => setCategoryFilter('EARLY_DEPARTURE')}
            >
              🟠 Left Early ({summary.earlyDepartureCount})
            </button>
            <button
              type="button"
              className={`segmented-btn ${categoryFilter === 'UNPLANNED_TURNUP' ? 'segmented-btn-active font-bold text-blue' : ''}`}
              onClick={() => setCategoryFilter('UNPLANNED_TURNUP')}
            >
              🟣 Unplanned ({summary.unplannedTurnUpCount})
            </button>
            <button
              type="button"
              className={`segmented-btn ${categoryFilter === 'COMPLIANT' ? 'segmented-btn-active font-bold text-green' : ''}`}
              onClick={() => setCategoryFilter('COMPLIANT')}
            >
              🟢 Compliant ({summary.compliantCount})
            </button>
          </div>
        </div>

      {/* 5. Detailed Rider Shift Adherence & Audit Table */}
      <div className="section-card perf-card">
        <div className="perf-section-header">
          <div>
            <h3 className="section-title editorial-serif-heading">Rider Shift Adherence &amp; Turn-Up Audit</h3>
            <p className="section-subtitle">
              Evaluating marked attendance &amp; scheduled shift slots vs actual delivered orders for{' '}
              <strong>{summary?.formattedDate || selectedDate}</strong> ({filteredRiders.length} riders shown).
            </p>
          </div>
        </div>

        <div className="perf-table-wrapper">
          <table className="perf-pivot-table" aria-label="Rider Shift Adherence & Attendance Audit Table">
            <thead>
              <tr className="tier1-header-row modern-summary-header">
                <th className="th-rider-name sticky-col text-center" style={{ minWidth: '180px' }}>
                  <div className="th-content th-content-center">
                    <span>Rider Info</span>
                  </div>
                </th>

                <th className="th-active-shift text-center" style={{ minWidth: '130px' }}>
                  <div className="th-content th-content-center">
                    <span>Assigned Shift</span>
                  </div>
                </th>

                <th className="text-center" style={{ minWidth: '95px' }}>
                  <div className="th-content th-content-center">
                    <span>Attendance</span>
                  </div>
                </th>

                <th className="text-center" style={{ minWidth: '100px' }}>
                  <div className="th-content th-content-center">
                    <span>Active Window</span>
                  </div>
                </th>

                <th className="text-center" style={{ minWidth: '85px' }}>
                  <div className="th-content th-content-center">
                    <span>Orders</span>
                  </div>
                </th>

                <th className="text-center" style={{ minWidth: '220px' }}>
                  <div className="th-content th-content-center">
                    <span>Slot Activity Timeline (6 AM – 11 PM)</span>
                  </div>
                </th>

                <th className="text-center" style={{ minWidth: '130px' }}>
                  <div className="th-content th-content-center">
                    <span>Missed Slots</span>
                  </div>
                </th>

                <th className="text-center" style={{ minWidth: '150px' }}>
                  <div className="th-content th-content-center">
                    <span>Audit Verdict</span>
                  </div>
                </th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="table-empty-cell text-center">
                    <div className="perf-loading-state">
                      <div className="spinner-sm" aria-hidden="true" />
                      <span>Reconciling attendance and order records for {selectedDate}...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredRiders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="table-empty-cell text-center">
                    {searchQuery
                      ? `No riders matching "${searchQuery}".`
                      : `No records found for ${selectedDate}. Ensure order data has been uploaded for this date.`}
                  </td>
                </tr>
              ) : (
                filteredRiders.map((row) => {
                  return (
                    <tr key={row.normalizedName} className="perf-data-row">
                      {/* Rider Info */}
                      <td className="td-rider-name sticky-col text-center">
                        <div className="rider-cell-content rider-cell-content-center">
                          <div className="rider-info-stacked items-center text-center">
                            <strong className="rider-name-text" title={row.riderName}>
                              {row.riderName}
                            </strong>
                            {row.onboardedBy && (
                              <span className="rider-onboarded-tag" title={`Onboarded by ${row.onboardedBy}`}>
                                👤 {row.onboardedBy}
                              </span>
                            )}
                            {row.phone ? (
                              <span className="rider-phone-sub text-center">{row.phone}</span>
                            ) : (
                              <span className="rider-phone-none text-center">No phone</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Assigned Shift */}
                      <td className="td-active-shift text-center">
                        <div className="flex-col items-center justify-center gap-xs">
                          <span className="badge-shift badge-morning">
                            {row.shiftType.replace(' Shift', '')}
                          </span>
                          <span className="shift-timings-caption muted">
                            {formatAuditSlotLabel(row.scheduledStartHour)} – {formatAuditSlotLabel(row.scheduledEndHour)}
                          </span>
                        </div>
                      </td>

                      {/* Attendance Marked Status */}
                      <td className="text-center">
                        {row.isPresentMarked ? (
                          <span className="badge-active-yes" title="Marked Present in Planning">
                            ✓ Present
                          </span>
                        ) : row.attendanceStatus === 'absent' ? (
                          <span className="badge-active-no" title="Marked Absent in Planning">
                            ✕ Absent
                          </span>
                        ) : (
                          <span className="badge-shift badge-shift-unassigned" title="Unmarked">
                            Unmarked
                          </span>
                        )}
                      </td>

                      {/* Active Window */}
                      <td className="text-center">
                        {row.firstOrderHour !== null && row.lastOrderHour !== null ? (
                          <div className="flex-col items-center justify-center">
                            <strong className="text-xs">
                              {formatAuditSlotLabel(row.firstOrderHour)} → {formatAuditSlotLabel(row.lastOrderHour)}
                            </strong>
                            <span className="text-xs text-muted">
                              {row.totalHoursClocked} unique hrs
                            </span>
                          </div>
                        ) : (
                          <span className="cell-dash">—</span>
                        )}
                      </td>

                      {/* Orders */}
                      <td className="text-center">
                        {row.totalOrders > 0 ? (
                          <span className="total-orders-pill">{row.totalOrders} ord</span>
                        ) : (
                          <span className="cell-dash">0</span>
                        )}
                      </td>

                      {/* Hourly Slot Timeline Mini-Grid (Slots 6 AM to 11 PM = 18 slots) */}
                      <td className="text-center">
                        <div className="rider-mini-timeline flex-row items-center justify-center gap-xs">
                          {Array.from({ length: 18 }, (_, idx) => idx + 6).map((slotH) => {
                            const isScheduled = row.scheduledSlots.includes(slotH);
                            const isWorked = row.actualSlots.includes(slotH);

                            let blockClass = 'block-off';
                            let tooltip = `Slot ${slotH} (${formatAuditSlotLabel(slotH)}): Off`;

                            if (isScheduled && isWorked) {
                              blockClass = 'block-worked';
                              tooltip = `Slot ${slotH}: Scheduled & Worked ✓`;
                            } else if (isScheduled && !isWorked) {
                              blockClass = 'block-missed';
                              tooltip = `Slot ${slotH}: Scheduled but MISSED ⚠`;
                            } else if (!isScheduled && isWorked) {
                              blockClass = 'block-unplanned';
                              tooltip = `Slot ${slotH}: Unscheduled but Worked (Ad-hoc)`;
                            }

                            return (
                              <span
                                key={slotH}
                                className={`timeline-block ${blockClass}`}
                                title={tooltip}
                              >
                                {slotH}
                              </span>
                            );
                          })}
                        </div>
                      </td>

                      {/* Missed Slots */}
                      <td className="text-center">
                        {row.allMissedSlots.length > 0 ? (
                          <div className="missed-slots-wrapper">
                            <span className="missed-slots-pill">
                              {row.lateArrivalHours > 0 && (
                                <strong>{row.lateArrivalHours}h Late: </strong>
                              )}
                              {row.allMissedSlots.slice(0, 3).map(formatAuditSlotLabel).join(', ')}
                              {row.allMissedSlots.length > 3 && ` +${row.allMissedSlots.length - 3} more`}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-green font-semibold">None (Full)</span>
                        )}
                      </td>

                      {/* Audit Verdict Badge */}
                      <td className="text-center">
                        <span className={`adherence-badge adherence-${row.adherenceSeverity}`}>
                          {row.adherenceBadgeText}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {/* 6. Slot Inspection Modal */}
      {inspectedSlot && (
        <div className="modal-backdrop" onClick={() => setInspectedSlot(null)}>
          <div
            className="modal-card modal-lg"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <div>
                <h3 className="modal-title">
                  Slot {inspectedSlot.hour} ({inspectedSlot.slotLabel}) Attendance Reconciliation
                </h3>
                <p className="modal-subtitle">
                  {summary?.formattedDate} • Planned: <strong>{inspectedSlot.plannedTurnUp}</strong> | Actual:{' '}
                  <strong>{inspectedSlot.actualTurnUp}</strong> (
                  <span className={inspectedSlot.variance < 0 ? 'text-red' : 'text-green'}>
                    {inspectedSlot.variance >= 0 ? `+${inspectedSlot.variance} Surplus` : `${inspectedSlot.variance} Deficit`}
                  </span>
                  )
                </p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setInspectedSlot(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="modal-body p-md">
              {/* Missing Riders Group (Late or No-Show) */}
              <div className="mb-md">
                <h4 className="font-bold text-sm text-red mb-xs flex-row items-center gap-xs">
                  <span>⚠ Missing Riders in Slot {inspectedSlot.hour} ({inspectedSlot.missingRiders.length})</span>
                </h4>
                {inspectedSlot.missingRiders.length > 0 ? (
                  <div className="grid grid-cols-2 gap-xs">
                    {inspectedSlot.missingRiders.map((name) => {
                      const rObj = summary?.riders.find((r) => r.riderName === name);
                      return (
                        <div key={name} className="audit-slot-chip audit-chip-missing p-xs rounded text-xs">
                          <strong>{name}</strong>
                          <span className="text-muted ml-xs">
                            ({rObj ? rObj.adherenceBadgeText : 'Missing'})
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-green">All planned riders turned up for this slot!</p>
                )}
              </div>

              {/* Active Riders Group */}
              <div className="mb-md">
                <h4 className="font-bold text-sm text-green mb-xs">
                  ✓ Active Riders ({inspectedSlot.actualRiders.length})
                </h4>
                <div className="grid grid-cols-3 gap-xs">
                  {inspectedSlot.actualRiders.map((name) => (
                    <div key={name} className="audit-slot-chip audit-chip-active p-xs rounded text-xs">
                      {name}
                    </div>
                  ))}
                </div>
              </div>

              {/* Unplanned Riders Group */}
              {inspectedSlot.unplannedRiders.length > 0 && (
                <div>
                  <h4 className="font-bold text-sm text-blue mb-xs">
                    🟣 Unplanned Riders in this Slot ({inspectedSlot.unplannedRiders.length})
                  </h4>
                  <div className="grid grid-cols-3 gap-xs">
                    {inspectedSlot.unplannedRiders.map((name) => (
                      <div key={name} className="audit-slot-chip audit-chip-unplanned p-xs rounded text-xs text-blue">
                        {name}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setInspectedSlot(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
