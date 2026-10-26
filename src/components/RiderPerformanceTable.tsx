import React, { useMemo, useState } from 'react';
import {
  type RiderPerformancePivotResult,
  type RiderPivotRow,
  exportRiderPerformanceToExcel,
} from '../services/analyticsService';
import { normalizeRiderName } from '../services/activeRiderService';
import {
  type RiderShiftConfig,
  formatShiftTimings,
  calculatePlannedHours,
} from '../services/riderShiftService';

interface RiderPerformanceTableProps {
  data: RiderPerformancePivotResult;
  storeCode: string;
  storeName: string;
  selectedDays: number;
  onSelectDaysPreset: (days: number) => void;
  startDate: string;
  endDate: string;
  onCustomDateChange?: (start: string, end: string) => void;
  loading: boolean;
  onRefresh: () => void;
  activeNamesSet?: Set<string>;
  phoneByNameMap?: Map<string, string>;
  riderShiftsMap?: Map<string, RiderShiftConfig>;
  onOpenShiftModal?: () => void;
  rosterLastUpdated?: string | null;
  rosterTotalCount?: number;
  shiftFilter?: string;
  onSelectShiftFilter?: (filter: string) => void;
}

export const RiderPerformanceTable: React.FC<RiderPerformanceTableProps> = ({
  data,
  storeCode,
  storeName,
  selectedDays,
  onSelectDaysPreset,
  startDate,
  endDate,
  onCustomDateChange,
  loading,
  onRefresh,
  activeNamesSet,
  phoneByNameMap,
  riderShiftsMap,
  onOpenShiftModal,
  rosterLastUpdated,
  rosterTotalCount = 0,
  shiftFilter: shiftFilterProp,
  onSelectShiftFilter,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [internalShiftFilter, setInternalShiftFilter] = useState<string>('ALL');
  const activeShiftFilter = shiftFilterProp !== undefined ? shiftFilterProp : internalShiftFilter;
  const setShiftFilter = (newVal: string) => {
    setInternalShiftFilter(newVal);
    onSelectShiftFilter?.(newVal);
  };
  const [showDailyBreakdown, setShowDailyBreakdown] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<
    'name' | 'phone' | 'shift' | 'compliance' | 'activeDays' | 'avgOrders' | 'avgHours' | 'totalOrders'
  >('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [customStart, setCustomStart] = useState(startDate);
  const [customEnd, setCustomEnd] = useState(endDate);
  const [avgMode, setAvgMode] = useState<'period' | 'active'>('period');
  const [dateOrder, setDateOrder] = useState<'desc' | 'asc'>('desc');

  const presets = [1, 3, 7, 10, 14, 20, 30];

  const periodDays = data.periodDays || data.dateColumns.length || selectedDays;
  const periodLabel = avgMode === 'period' ? `${periodDays}d Avg` : 'Active Avg';

  const displayedDateColumns = useMemo(() => {
    if (dateOrder === 'desc') {
      return [...data.dateColumns].sort((a, b) => b.dateStr.localeCompare(a.dateStr));
    }
    return [...data.dateColumns].sort((a, b) => a.dateStr.localeCompare(b.dateStr));
  }, [data.dateColumns, dateOrder]);

  const handleSort = (
    field: 'name' | 'phone' | 'shift' | 'compliance' | 'activeDays' | 'avgOrders' | 'avgHours' | 'totalOrders'
  ) => {
    if (sortBy === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(field);
      setSortAsc(field === 'name' || field === 'phone' || field === 'shift'); // default asc for text
    }
  };

  const filteredRows = useMemo(() => {
    let result = [...data.rows];

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((r) => {
        if (r.riderName.toLowerCase().includes(q)) return true;
        const norm = normalizeRiderName(r.riderName);
        const phone = phoneByNameMap?.get(norm);
        if (phone && phone.toLowerCase().includes(q)) return true;
        return false;
      });
    }

    // Shift / Compliance filter
    if (activeShiftFilter !== 'ALL') {
      result = result.filter((r) => {
        const norm = normalizeRiderName(r.riderName);
        const shift = riderShiftsMap?.get(norm);
        const displayHours = avgMode === 'period' ? r.avgHours : r.activeAvgHours;
        if (activeShiftFilter === 'COMPLIANT_8H') {
          return displayHours >= 8.0;
        }
        if (activeShiftFilter === 'UNDER_8H') {
          return displayHours < 8.0;
        }
        if (activeShiftFilter === 'UNDER_6H') {
          return displayHours < 6.0;
        }
        if (activeShiftFilter === 'NOT_SET') {
          return !shift;
        }
        return shift?.shiftType === activeShiftFilter;
      });
    }

    result.sort((a: RiderPivotRow, b: RiderPivotRow) => {
      let comparison = 0;
      switch (sortBy) {
        case 'name':
          comparison = a.riderName.localeCompare(b.riderName);
          break;
        case 'phone': {
          const normA = normalizeRiderName(a.riderName);
          const normB = normalizeRiderName(b.riderName);
          const phoneA = phoneByNameMap?.get(normA) ?? '';
          const phoneB = phoneByNameMap?.get(normB) ?? '';
          comparison = phoneA.localeCompare(phoneB);
          break;
        }
        case 'shift': {
          const normA = normalizeRiderName(a.riderName);
          const normB = normalizeRiderName(b.riderName);
          const shiftA = riderShiftsMap?.get(normA)?.shiftType ?? 'ZZZ';
          const shiftB = riderShiftsMap?.get(normB)?.shiftType ?? 'ZZZ';
          comparison = shiftA.localeCompare(shiftB);
          break;
        }
        case 'compliance': {
          const normA = normalizeRiderName(a.riderName);
          const normB = normalizeRiderName(b.riderName);
          const shiftA = riderShiftsMap?.get(normA);
          const shiftB = riderShiftsMap?.get(normB);
          const hoursA = shiftA ? Math.max(shiftA.totalPlannedHours ?? 0, calculatePlannedHours(shiftA)) : 0;
          const hoursB = shiftB ? Math.max(shiftB.totalPlannedHours ?? 0, calculatePlannedHours(shiftB)) : 0;
          comparison = hoursA - hoursB;
          break;
        }
        case 'activeDays':
          comparison = a.workingDays - b.workingDays;
          break;
        case 'avgOrders': {
          const valA = avgMode === 'period' ? a.avgOrders : a.activeAvgOrders;
          const valB = avgMode === 'period' ? b.avgOrders : b.activeAvgOrders;
          comparison = valA - valB;
          break;
        }
        case 'avgHours': {
          const valA = avgMode === 'period' ? a.avgHours : a.activeAvgHours;
          const valB = avgMode === 'period' ? b.avgHours : b.activeAvgHours;
          comparison = valA - valB;
          break;
        }
        case 'totalOrders':
          comparison = a.totalOrders - b.totalOrders;
          break;
      }
      return sortAsc ? comparison : -comparison;
    });

    return result;
  }, [data.rows, searchQuery, activeShiftFilter, sortBy, sortAsc, avgMode, phoneByNameMap, riderShiftsMap]);

  const compliantShiftCount = useMemo(() => {
    return filteredRows.filter((r) => {
      const norm = normalizeRiderName(r.riderName);
      const shift = riderShiftsMap?.get(norm);
      if (!shift) return false;
      const hours = Math.max(shift.totalPlannedHours ?? 0, calculatePlannedHours(shift));
      return hours >= 8.0;
    }).length;
  }, [filteredRows, riderShiftsMap]);

  const totalOrdersSum = useMemo(() => {
    return filteredRows.reduce((sum, r) => sum + r.totalOrders, 0);
  }, [filteredRows]);

  const avgWorkingDays = useMemo(() => {
    if (filteredRows.length === 0) return 0;
    return filteredRows.reduce((sum, r) => sum + r.workingDays, 0) / filteredRows.length;
  }, [filteredRows]);

  const totalColSpan = showDailyBreakdown ? displayedDateColumns.length * 2 + 8 : 8;

  const getInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const handleApplyCustomDate = () => {
    if (customStart && customEnd && onCustomDateChange) {
      onCustomDateChange(customStart, customEnd);
    }
  };

  const handleExport = () => {
    const shiftsExportMap = new Map<string, { shiftType: string; timings?: string }>();
    if (riderShiftsMap) {
      for (const [norm, cfg] of riderShiftsMap.entries()) {
        shiftsExportMap.set(norm, {
          shiftType: cfg.shiftType,
          timings: formatShiftTimings(cfg),
        });
      }
    }

    exportRiderPerformanceToExcel(
      { ...data, dateColumns: displayedDateColumns },
      storeCode,
      avgMode === 'active',
      activeNamesSet,
      phoneByNameMap,
      shiftsExportMap
    );
  };

  return (
    <div className="rider-perf-section">
      {/* Modern Controls & Filter Bar */}
      <div className="perf-controls-bar">
        <div className="perf-controls-left">
          {/* Period Range Dropdown */}
          <div className="perf-filter-group">
            <label htmlFor="period-range-select" className="perf-control-label">
              Period Range:
            </label>
            <div className="custom-select-wrapper">
              <select
                id="period-range-select"
                className="perf-dropdown-select"
                value={showCustomRange ? 'custom' : selectedDays}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'custom') {
                    setShowCustomRange(true);
                  } else {
                    setShowCustomRange(false);
                    onSelectDaysPreset(Number(val));
                  }
                }}
                disabled={loading}
              >
                {presets.map((days) => (
                  <option key={days} value={days}>
                    {days === 1 ? '1 Day (Yesterday)' : `${days} Days`}
                  </option>
                ))}
                <option value="custom">Custom Range...</option>
              </select>
              <span className="select-chevron" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
          </div>

          {/* Shift & Compliance Filter Dropdown */}
          <div className="perf-filter-group">
            <label htmlFor="shift-filter-select" className="perf-control-label">
              Shift:
            </label>
            <div className="custom-select-wrapper">
              <select
                id="shift-filter-select"
                className="perf-dropdown-select"
                value={activeShiftFilter}
                onChange={(e) => setShiftFilter(e.target.value)}
                disabled={loading}
              >
                <option value="ALL">All Shifts</option>
                <option value="Morning Shift">Morning (6A–2P)</option>
                <option value="2nd Shift">2nd Shift (2P–10P)</option>
                <option value="Split Shift">Split (6–10A & 6–10P)</option>
                <option value="Custom">Custom Shift</option>
                <option value="COMPLIANT_8H">✓ Clocking ≥ 8h</option>
                <option value="UNDER_8H">⚠ Clocking &lt; 8h</option>
                <option value="UNDER_6H">⚠ Clocking &lt; 6h</option>
                <option value="NOT_SET">Not Assigned</option>
              </select>
              <span className="select-chevron" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
          </div>

          {/* Inline Custom Range Inputs when Custom is Selected */}
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

          {/* View Mode Toggle: Summary vs Daily Breakdown */}
          <div className="perf-filter-group">
            <span className="perf-control-label">View:</span>
            <div className="segmented-control view-segmented-control">
              <button
                type="button"
                className={`segmented-btn ${!showDailyBreakdown ? 'segmented-btn-active' : ''}`}
                onClick={() => setShowDailyBreakdown(false)}
                title="Compact summary view (Avg Hours, Avg Orders, Shifts & Compliance)"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ marginRight: '4px', verticalAlign: '-1px' }}>
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                </svg>
                Summary
              </button>
              <button
                type="button"
                className={`segmented-btn ${showDailyBreakdown ? 'segmented-btn-active' : ''}`}
                onClick={() => setShowDailyBreakdown(true)}
                title="Expand day-by-day hours and orders columns"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ marginRight: '4px', verticalAlign: '-1px' }}>
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
                Daily Breakdown ({displayedDateColumns.length}d)
              </button>
            </div>
          </div>

          {/* Average Divisor Segmented Control */}
          <div className="perf-filter-group">
            <span className="perf-control-label">Avg Divisor:</span>
            <div className="segmented-control">
              <button
                type="button"
                className={`segmented-btn ${avgMode === 'period' ? 'segmented-btn-active' : ''}`}
                onClick={() => setAvgMode('period')}
                title={`Divide by total ${periodDays} days in period`}
              >
                {periodDays} Days
              </button>
              <button
                type="button"
                className={`segmented-btn ${avgMode === 'active' ? 'segmented-btn-active' : ''}`}
                onClick={() => setAvgMode('active')}
                title="Divide by active working days only"
              >
                Active Days
              </button>
            </div>
          </div>

          {/* Date Order Segmented Control (relevant when Daily Breakdown is open) */}
          {showDailyBreakdown && (
            <div className="perf-filter-group">
              <span className="perf-control-label">Date Order:</span>
              <div className="segmented-control">
                <button
                  type="button"
                  className={`segmented-btn ${dateOrder === 'desc' ? 'segmented-btn-active' : ''}`}
                  onClick={() => setDateOrder('desc')}
                  title="Newest date first (e.g. 19-Oct → 13-Oct)"
                >
                  Newest First ↓
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${dateOrder === 'asc' ? 'segmented-btn-active' : ''}`}
                  onClick={() => setDateOrder('asc')}
                  title="Oldest date first (e.g. 13-Oct → 19-Oct)"
                >
                  Oldest First ↑
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Actions: Search, Refresh, Export */}
        <div className="perf-actions-right">
          <div className="perf-search-box">
            <span className="search-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="Search rider name or number..."
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

          {onOpenShiftModal && (
            <button
              type="button"
              className="btn btn-secondary btn-sm perf-btn-shifts"
              onClick={onOpenShiftModal}
              title="Configure rider shifts and 8h timings"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Shifts</span>
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary btn-sm perf-btn-refresh"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh analytics data"
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
            disabled={data.rows.length === 0}
            title="Download Excel spreadsheet matching Google Sheets layout"
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

      {/* Summary / Breakdown Callout Banner */}
      {!loading && filteredRows.length > 0 && (
        <div className={`perf-view-callout ${showDailyBreakdown ? 'callout-breakdown' : 'callout-summary'}`}>
          <div className="callout-left">
            <span className="callout-badge">
              {showDailyBreakdown ? 'Full Breakdown' : 'Summary View'}
            </span>
            <span className="callout-text">
              {showDailyBreakdown ? (
                <>
                  Showing <strong>{displayedDateColumns.length}</strong> individual calendar days ({startDate} to {endDate}) with day-by-day hours and orders.
                </>
              ) : (
                <>
                  Calendar days are collapsed into average metrics across <strong>{periodDays} days</strong> ({startDate} to {endDate}). Expand to view day-by-day numbers.
                </>
              )}
            </span>
          </div>
          <button
            type="button"
            className="callout-toggle-btn"
            onClick={() => setShowDailyBreakdown(!showDailyBreakdown)}
            title={showDailyBreakdown ? 'Collapse to Summary View' : 'Expand full daily breakdown'}
          >
            {showDailyBreakdown ? (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
                <span>Collapse Days</span>
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
                <span>Expand Days ({displayedDateColumns.length}d)</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Main Pivot Table */}
      <div className="perf-table-wrapper">
        <table className="perf-pivot-table" aria-label="Rider Hours and Orders Performance Pivot Table">
          <thead>
            {/* When collapsed to Summary: Clean Single-Tier Modern Header */}
            {!showDailyBreakdown ? (
              <tr className="tier1-header-row modern-summary-header">
                <th
                  className="th-rider-name sticky-col text-left"
                  onClick={() => handleSort('name')}
                  title="Click to sort by rider name"
                >
                  <div className="th-content">
                    <span>Rider Info</span>
                    <span className="sort-arrow">
                      {sortBy === 'name' ? (sortAsc ? '▲' : '▼') : '↕'}
                    </span>
                  </div>
                </th>

                <th className="th-active-status text-center">Active</th>

                <th
                  className="th-shift text-center"
                  onClick={() => handleSort('shift')}
                  title="Click to sort by assigned shift"
                >
                  <div className="th-content th-content-center">
                    <span>Assigned Shift</span>
                    <span className="sort-arrow">
                      {sortBy === 'shift' ? (sortAsc ? '▲' : '▼') : '↕'}
                    </span>
                  </div>
                </th>

                <th
                  className="th-compliance text-center"
                  onClick={() => handleSort('compliance')}
                  title="Click to sort by 8-hour shift compliance"
                >
                  <div className="th-content th-content-center">
                    <span>8h Target</span>
                    <span className="sort-arrow">
                      {sortBy === 'compliance' ? (sortAsc ? '▲' : '▼') : '↕'}
                    </span>
                  </div>
                </th>

                <th
                  className="th-active-days text-center"
                  onClick={() => handleSort('activeDays')}
                  title="Click to sort by active working days"
                >
                  <div className="th-content th-content-center">
                    <span>Active Days</span>
                    <span className="sort-arrow">
                      {sortBy === 'activeDays' ? (sortAsc ? '▲' : '▼') : '↕'}
                    </span>
                  </div>
                </th>

                <th
                  className="th-avg-group th-sub-avg-hours text-center"
                  onClick={() => handleSort('avgHours')}
                  title={`Click to sort by ${periodLabel} Hours`}
                >
                  <div className="th-content th-content-center">
                    <span>{periodLabel} Hours</span>
                    <span className="sort-arrow">
                      {sortBy === 'avgHours' ? (sortAsc ? '▲' : '▼') : '↕'}
                    </span>
                  </div>
                </th>

                <th
                  className="th-avg-group th-sub-avg-orders text-center"
                  onClick={() => handleSort('avgOrders')}
                  title={`Click to sort by ${periodLabel} Orders`}
                >
                  <div className="th-content th-content-center">
                    <span>{periodLabel} Orders</span>
                    <span className="sort-arrow">
                      {sortBy === 'avgOrders' ? (sortAsc ? '▲' : '▼') : '↕'}
                    </span>
                  </div>
                </th>

                <th
                  className="th-avg-group th-sub-total-orders text-center"
                  onClick={() => handleSort('totalOrders')}
                  title="Click to sort by Total Orders"
                >
                  <div className="th-content th-content-center">
                    <span>Total Orders</span>
                    <span className="sort-arrow">
                      {sortBy === 'totalOrders' ? (sortAsc ? '▲' : '▼') : '↕'}
                    </span>
                  </div>
                </th>
              </tr>
            ) : (
              /* When Expanded: Two-Tier Header */
              <>
                <tr className="tier1-header-row">
                  <th
                    rowSpan={2}
                    className="th-rider-name sticky-col text-left"
                    onClick={() => handleSort('name')}
                    title="Click to sort by rider name"
                  >
                    <div className="th-content">
                      <span>Rider Info</span>
                      <span className="sort-arrow">
                        {sortBy === 'name' ? (sortAsc ? '▲' : '▼') : '↕'}
                      </span>
                    </div>
                  </th>

                  <th rowSpan={2} className="th-active-status text-center">
                    Active
                  </th>

                  <th
                    rowSpan={2}
                    className="th-shift text-center"
                    onClick={() => handleSort('shift')}
                    title="Click to sort by assigned shift"
                  >
                    <div className="th-content th-content-center">
                      <span>Assigned Shift</span>
                      <span className="sort-arrow">
                        {sortBy === 'shift' ? (sortAsc ? '▲' : '▼') : '↕'}
                      </span>
                    </div>
                  </th>

                  <th
                    rowSpan={2}
                    className="th-compliance text-center"
                    onClick={() => handleSort('compliance')}
                    title="Click to sort by 8-hour shift compliance"
                  >
                    <div className="th-content th-content-center">
                      <span>8h Target</span>
                      <span className="sort-arrow">
                        {sortBy === 'compliance' ? (sortAsc ? '▲' : '▼') : '↕'}
                      </span>
                    </div>
                  </th>

                  <th
                    rowSpan={2}
                    className="th-active-days text-center"
                    onClick={() => handleSort('activeDays')}
                    title="Click to sort by active working days"
                  >
                    <div className="th-content th-content-center">
                      <span>Active Days</span>
                      <span className="sort-arrow">
                        {sortBy === 'activeDays' ? (sortAsc ? '▲' : '▼') : '↕'}
                      </span>
                    </div>
                  </th>

                  {displayedDateColumns.map((col) => (
                    <th key={col.dateStr} colSpan={2} className="th-date-group text-center">
                      {col.formattedHeader}
                    </th>
                  ))}

                  <th colSpan={3} className="th-avg-group text-center">
                    {periodLabel} Summary
                  </th>
                </tr>

                {/* Tier 2 Header for Expanded Mode */}
                <tr className="tier2-header-row">
                  {displayedDateColumns.map((col) => (
                    <React.Fragment key={`sub-${col.dateStr}`}>
                      <th className="th-sub-hours text-center">Hours</th>
                      <th className="th-sub-orders text-center">Orders</th>
                    </React.Fragment>
                  ))}

                  <th
                    className="th-sub-avg-hours text-center"
                    onClick={() => handleSort('avgHours')}
                    title="Sort by Average Daily Hours"
                  >
                    <div className="th-content th-content-center">
                      <span>Avg Hrs</span>
                      <span className="sort-arrow">
                        {sortBy === 'avgHours' ? (sortAsc ? '▲' : '▼') : '↕'}
                      </span>
                    </div>
                  </th>

                  <th
                    className="th-sub-avg-orders text-center"
                    onClick={() => handleSort('avgOrders')}
                    title="Sort by Average Daily Orders"
                  >
                    <div className="th-content th-content-center">
                      <span>Avg Ords</span>
                      <span className="sort-arrow">
                        {sortBy === 'avgOrders' ? (sortAsc ? '▲' : '▼') : '↕'}
                      </span>
                    </div>
                  </th>

                  <th
                    className="th-sub-total-orders text-center"
                    onClick={() => handleSort('totalOrders')}
                    title="Sort by Total Orders"
                  >
                    <div className="th-content th-content-center">
                      <span>Total</span>
                      <span className="sort-arrow">
                        {sortBy === 'totalOrders' ? (sortAsc ? '▲' : '▼') : '↕'}
                      </span>
                    </div>
                  </th>
                </tr>
              </>
            )}
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={totalColSpan} className="table-empty-cell text-center">
                  <div className="perf-loading-state">
                    <div className="spinner-sm" aria-hidden="true" />
                    <span>Aggregating rider hours and orders for {storeCode}...</span>
                  </div>
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={totalColSpan} className="table-empty-cell text-center">
                  {searchQuery
                    ? `No riders matching "${searchQuery}".`
                    : `No order records found for ${storeCode} between ${startDate} and ${endDate}. Upload order files in the Data Ingestion tab to see rider analytics.`}
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const displayHours = avgMode === 'period' ? row.avgHours : row.activeAvgHours;
                const displayOrders = avgMode === 'period' ? row.avgOrders : row.activeAvgOrders;
                const tooltipText = `Period Avg: ${row.avgHours.toFixed(1)} hrs / ${row.avgOrders.toFixed(1)} orders (divided by ${periodDays} days) • Active Avg: ${row.activeAvgHours.toFixed(1)} hrs / ${row.activeAvgOrders.toFixed(1)} orders (across ${row.workingDays} working days) • Total: ${row.totalOrders} orders`;
                const normName = normalizeRiderName(row.riderName);
                const riderPhone = phoneByNameMap?.get(normName);
                const isRiderActive = activeNamesSet
                  ? activeNamesSet.has(normName)
                  : false;
                const riderShift = riderShiftsMap?.get(normName);
                const shiftPlannedHours = riderShift
                  ? Math.max(riderShift.totalPlannedHours ?? 0, calculatePlannedHours(riderShift))
                  : 0;
                const meetsShift8hTarget = riderShift ? shiftPlannedHours >= 8.0 : false;
                const meetsActual8hTarget = displayHours >= 8.0;

                return (
                  <tr key={row.riderName} className="perf-data-row">
                    {/* Sticky Rider Name & Stacked Phone Number */}
                    <td className="td-rider-name sticky-col text-left">
                      <div className="rider-cell-content">
                        <span className="rider-avatar-bubble" aria-hidden="true">
                          {getInitials(row.riderName)}
                        </span>
                        <div className="rider-info-stacked">
                          <strong className="rider-name-text" title={row.riderName}>
                            {row.riderName}
                          </strong>
                          {riderPhone ? (
                            <span className="rider-phone-sub" title={`Phone: ${riderPhone}`}>
                              {riderPhone}
                            </span>
                          ) : (
                            <span className="rider-phone-none">No phone</span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Active Status */}
                    <td className="td-active text-center">
                      {isRiderActive ? (
                        <span className="badge-active-yes" title="Verified in Active Riders Roster">
                          Active
                        </span>
                      ) : (
                        <span className="badge-active-no" title="Not found in Active Riders Roster">
                          Inactive
                        </span>
                      )}
                    </td>

                    {/* Assigned Shift */}
                    <td className="td-shift text-center">
                      {riderShift ? (
                        <div className="shift-cell-badge-wrapper">
                          <span
                            className={`badge-shift badge-shift-${riderShift.shiftType.toLowerCase().replace(/\s+/g, '-')}`}
                          >
                            {riderShift.shiftType === 'Split Shift' ? 'Split' : riderShift.shiftType.replace(' Shift', '')}
                          </span>
                          <span className="shift-timings-caption">
                            {formatShiftTimings(riderShift)}
                          </span>
                        </div>
                      ) : (
                        <span className="badge-shift-unassigned">Not Set</span>
                      )}
                    </td>

                    {/* 8-Hour Shift Target Compliance */}
                    <td className="td-compliance text-center">
                      {riderShift ? (
                        meetsShift8hTarget ? (
                          <span
                            className="badge-compliance-ok"
                            title={`Assigned shift planned for ${shiftPlannedHours}h (≥ 8h mandatory target met)`}
                          >
                            ✓ ≥ 8h
                          </span>
                        ) : (
                          <span
                            className="badge-compliance-warn"
                            title={`Assigned shift planned for ${shiftPlannedHours}h (Below 8h mandatory target)`}
                          >
                            ⚠ &lt; 8h
                          </span>
                        )
                      ) : (
                        <span className="cell-dash" title="No shift assigned">—</span>
                      )}
                    </td>

                    {/* Active Working Days */}
                    <td className="td-active-days text-center">
                      <span
                        className="active-days-pill"
                        title={`Active on ${row.workingDays} out of ${periodDays} calendar days in period`}
                      >
                        <strong className="active-days-num">{row.workingDays}</strong>
                        <span className="active-days-denom">/{periodDays}d</span>
                      </span>
                    </td>

                    {/* Individual Day Breakdown Columns (Only when Expanded) */}
                    {showDailyBreakdown &&
                      displayedDateColumns.map((col) => {
                        const metric = row.dailyMetrics[col.dateStr];
                        const hasData = metric && (metric.orders > 0 || metric.hours > 0);
                        const clocked8hToday = hasData && metric.hours >= 8;
                        return (
                          <React.Fragment key={`${row.riderName}-${col.dateStr}`}>
                            <td
                              className={`td-metric td-hours text-center ${
                                !hasData ? 'td-blank' : ''
                              } ${clocked8hToday ? 'td-hours-target-met' : ''}`}
                              title={
                                clocked8hToday
                                  ? `${metric.hours} hrs clocked on ${col.formattedHeader} (≥ 8h mandatory target met)`
                                  : undefined
                              }
                            >
                              {hasData ? (
                                clocked8hToday ? (
                                  <strong className="hours-met-tag">{metric.hours}</strong>
                                ) : (
                                  metric.hours
                                )
                              ) : (
                                <span className="cell-dash">—</span>
                              )}
                            </td>
                            <td
                              className={`td-metric td-orders text-center ${
                                !hasData ? 'td-blank' : ''
                              }`}
                            >
                              {hasData ? metric.orders : <span className="cell-dash">—</span>}
                            </td>
                          </React.Fragment>
                        );
                      })}

                    {/* Modern Avg Hours with Visual Progress Bar */}
                    <td className="td-metric td-avg-hours text-center" title={tooltipText}>
                      <div className="avg-hours-wrapper">
                        <div className="avg-val-row">
                          <strong className={`avg-num-text ${meetsActual8hTarget ? 'val-target-met' : 'val-target-under'}`}>
                            {displayHours > 0 ? displayHours.toFixed(1) : '—'}
                          </strong>
                          {displayHours > 0 && <span className="avg-unit-tag">h/d</span>}
                        </div>
                        {displayHours > 0 && (
                          <div
                            className="mini-progress-track"
                            title={`${displayHours.toFixed(1)} / 8.0h daily target (${Math.round(
                              (displayHours / 8) * 100
                            )}%)`}
                          >
                            <div
                              className={`mini-progress-fill ${meetsActual8hTarget ? 'fill-target-met' : 'fill-target-under'}`}
                              style={{ width: `${Math.min(100, Math.round((displayHours / 8) * 100))}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Avg Orders */}
                    <td className="td-metric td-avg-orders text-center" title={tooltipText}>
                      <strong className="avg-num-text avg-orders-accent">
                        {displayOrders > 0 ? displayOrders.toFixed(1) : '—'}
                      </strong>
                    </td>

                    {/* Total Orders */}
                    <td className="td-metric td-total-orders text-center" title={`Total orders in period: ${row.totalOrders}`}>
                      <span className="total-orders-pill">{row.totalOrders}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {/* Table Footer with Summary Averages */}
          {filteredRows.length > 0 && !loading && (
            <tfoot>
              <tr className="perf-footer-row">
                <td className="sticky-col text-left">
                  <strong>Total Active: {filteredRows.length}</strong>
                </td>
                <td className="text-center">—</td>
                <td className="text-center">—</td>
                <td className="text-center">
                  <strong className="summary-compliance-rate">
                    {compliantShiftCount} / {filteredRows.length} (
                    {filteredRows.length > 0
                      ? Math.round((compliantShiftCount / filteredRows.length) * 100)
                      : 0}
                    %)
                  </strong>
                </td>
                <td className="text-center">
                  <span className="summary-avg-days">
                    {avgWorkingDays.toFixed(1)}d avg
                  </span>
                </td>
                {showDailyBreakdown &&
                  displayedDateColumns.map((col) => (
                    <React.Fragment key={`foot-${col.dateStr}`}>
                      <td className="td-foot-blank text-center">—</td>
                      <td className="td-foot-blank text-center">—</td>
                    </React.Fragment>
                  ))}
                <td className="td-metric td-avg-hours text-center">
                  <strong>{data.overallAvgHours.toFixed(1)}h</strong>
                </td>
                <td className="td-metric td-avg-orders text-center">
                  <strong>{data.overallAvgOrders.toFixed(1)}</strong>
                </td>
                <td className="td-metric td-total-orders text-center">
                  <strong>{totalOrdersSum.toLocaleString()}</strong>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="perf-footer-caption">
        <div className="caption-summary-pill">
          <span>
            Showing <strong>{filteredRows.length}</strong> riders across <strong>{data.dateColumns.length}</strong> days ({data.startDate} to {data.endDate}) for{' '}
            <strong>{storeCode}</strong> ({storeName}).
          </span>
        </div>
        <div className="caption-summary-pill pill-compliance-summary">
          <span>
            8h Shift Target: <strong>{compliantShiftCount} / {filteredRows.length}</strong> riders (
            {filteredRows.length > 0
              ? Math.round((compliantShiftCount / filteredRows.length) * 100)
              : 0}
            %) with assigned shifts ≥ 8h.
          </span>
        </div>
        <div className="roster-last-updated-pill">
          <span className={`roster-dot ${rosterLastUpdated ? 'dot-active' : 'dot-none'}`} />
          <span>
            {rosterLastUpdated ? (
              <>Active Roster: <strong>{rosterLastUpdated}</strong> ({rosterTotalCount} active)</>
            ) : (
              'Active Roster: Not uploaded yet'
            )}
          </span>
        </div>
        <div className="formula-hint-pills">
          <span className="formula-tag"><strong>Hours:</strong> COUNTUNIQUE(slot)</span>
          <span className="formula-tag"><strong>Orders:</strong> COUNTA(orders)</span>
          <span className="formula-tag"><strong>Avg Mode:</strong> {avgMode === 'period' ? `Divided by ${periodDays} days` : 'Divided by active working days'}</span>
        </div>
      </div>
    </div>
  );
};
