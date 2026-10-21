import React, { useMemo, useState } from 'react';
import {
  type RiderPerformancePivotResult,
  type RiderPivotRow,
  exportRiderPerformanceToExcel,
} from '../services/analyticsService';
import { normalizeRiderName } from '../services/activeRiderService';

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
  rosterLastUpdated?: string | null;
  rosterTotalCount?: number;
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
  rosterLastUpdated,
  rosterTotalCount = 0,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'phone' | 'avgOrders' | 'avgHours' | 'totalOrders'>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [customStart, setCustomStart] = useState(startDate);
  const [customEnd, setCustomEnd] = useState(endDate);
  const [avgMode, setAvgMode] = useState<'period' | 'active'>('period');
  const [dateOrder, setDateOrder] = useState<'desc' | 'asc'>('desc');

  const presets = [3, 7, 10, 14, 20, 30];

  const periodDays = data.periodDays || data.dateColumns.length || selectedDays;
  const periodLabel = avgMode === 'period' ? `${periodDays} Days Avg` : 'Active Days Avg';

  const displayedDateColumns = useMemo(() => {
    if (dateOrder === 'desc') {
      return [...data.dateColumns].sort((a, b) => b.dateStr.localeCompare(a.dateStr));
    }
    return [...data.dateColumns].sort((a, b) => a.dateStr.localeCompare(b.dateStr));
  }, [data.dateColumns, dateOrder]);

  const handleSort = (field: 'name' | 'phone' | 'avgOrders' | 'avgHours' | 'totalOrders') => {
    if (sortBy === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(field);
      setSortAsc(field === 'name' || field === 'phone'); // default asc for text
    }
  };

  const filteredRows = useMemo(() => {
    let result = [...data.rows];

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
  }, [data.rows, searchQuery, sortBy, sortAsc, avgMode, phoneByNameMap]);

  const handleApplyCustomDate = () => {
    if (customStart && customEnd && onCustomDateChange) {
      onCustomDateChange(customStart, customEnd);
    }
  };

  const handleExport = () => {
    exportRiderPerformanceToExcel(
      { ...data, dateColumns: displayedDateColumns },
      storeCode,
      avgMode === 'active',
      activeNamesSet,
      phoneByNameMap
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
                    {days} Days
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

          {/* Date Order Segmented Control */}
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

      {/* Main Two-Tier Pivot Table */}
      <div className="perf-table-wrapper">
        <table className="perf-pivot-table" aria-label="Rider Hours and Orders Performance Pivot Table">
          <thead>
            {/* Tier 1 Header */}
            <tr className="tier1-header-row">
              <th
                rowSpan={1}
                className="th-rider-name sticky-col text-center"
                onClick={() => handleSort('name')}
                title="Click to sort by rider name"
              >
                <div className="th-content th-content-center">
                  <span>Rider Name</span>
                  <span className="sort-arrow">
                    {sortBy === 'name' ? (sortAsc ? '▲' : '▼') : '↕'}
                  </span>
                </div>
              </th>

              <th
                rowSpan={1}
                className="th-rider-number text-center"
                onClick={() => handleSort('phone')}
                title="Click to sort by rider phone number"
              >
                <div className="th-content th-content-center">
                  <span>Rider Number</span>
                  <span className="sort-arrow">
                    {sortBy === 'phone' ? (sortAsc ? '▲' : '▼') : '↕'}
                  </span>
                </div>
              </th>

              <th rowSpan={1} className="th-active-status text-center">
                Active
              </th>

              {displayedDateColumns.map((col) => (
                <th key={col.dateStr} colSpan={2} className="th-date-group text-center">
                  {col.formattedHeader}
                </th>
              ))}

              <th colSpan={2} className="th-avg-group text-center">
                {periodLabel}
              </th>
            </tr>

            {/* Tier 2 Header */}
            <tr className="tier2-header-row">
              <th className="sticky-col th-sub-blank text-center" />
              <th className="th-sub-blank text-center" />
              <th className="th-sub-blank text-center" />

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
                  <span>Hours</span>
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
                  <span>Orders</span>
                  <span className="sort-arrow">
                    {sortBy === 'avgOrders' ? (sortAsc ? '▲' : '▼') : '↕'}
                  </span>
                </div>
              </th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={displayedDateColumns.length * 2 + 5}
                  className="table-empty-cell text-center"
                >
                  <div className="perf-loading-state">
                    <div className="spinner-sm" aria-hidden="true" />
                    <span>Aggregating rider hours and orders for {storeCode}...</span>
                  </div>
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={displayedDateColumns.length * 2 + 5}
                  className="table-empty-cell text-center"
                >
                  {searchQuery
                    ? `No riders matching "${searchQuery}".`
                    : `No order records found for ${storeCode} between ${startDate} and ${endDate}. Upload order files in the Data Ingestion tab to see rider analytics.`}
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const displayHours = avgMode === 'period' ? row.avgHours : row.activeAvgHours;
                const displayOrders = avgMode === 'period' ? row.avgOrders : row.activeAvgOrders;
                const tooltipText = `Period Avg: ${row.avgHours.toFixed(1)} hrs / ${row.avgOrders.toFixed(1)} orders (divided by ${periodDays} days) • Active Avg: ${row.activeAvgHours.toFixed(1)} hrs / ${row.activeAvgOrders.toFixed(1)} orders (across ${row.workingDays} working days)`;
                const normName = normalizeRiderName(row.riderName);
                const riderPhone = phoneByNameMap?.get(normName);
                const isRiderActive = activeNamesSet
                  ? activeNamesSet.has(normName)
                  : false;

                return (
                  <tr key={row.riderName} className="perf-data-row">
                    <td className="td-rider-name sticky-col text-center">
                      <span className="rider-name-text">{row.riderName}</span>
                    </td>

                    <td className="td-rider-number text-center">
                      {riderPhone ? (
                        <span className="rider-phone-text" title={`Rider Phone: ${riderPhone}`}>
                          {riderPhone}
                        </span>
                      ) : (
                        <span className="cell-dash" title="Phone not in uploaded active roster">—</span>
                      )}
                    </td>

                    <td className="td-active text-center">
                      {isRiderActive ? (
                        <span className="badge-active-yes" title="Verified in Active Riders Roster">
                          Yes
                        </span>
                      ) : (
                        <span className="badge-active-no" title="Not found in Active Riders Roster">
                          No
                        </span>
                      )}
                    </td>

                    {displayedDateColumns.map((col) => {
                      const metric = row.dailyMetrics[col.dateStr];
                      const hasData = metric && (metric.orders > 0 || metric.hours > 0);
                      return (
                        <React.Fragment key={`${row.riderName}-${col.dateStr}`}>
                          <td
                            className={`td-metric td-hours text-center ${
                              !hasData ? 'td-blank' : ''
                            }`}
                          >
                            {hasData ? metric.hours : <span className="cell-dash">—</span>}
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

                    <td
                      className="td-metric td-avg-hours text-center"
                      title={tooltipText}
                    >
                      <strong className="avg-num-text">{displayHours > 0 ? displayHours.toFixed(1) : '—'}</strong>
                    </td>

                    <td
                      className="td-metric td-avg-orders text-center"
                      title={tooltipText}
                    >
                      <strong className="avg-num-text">{displayOrders > 0 ? displayOrders.toFixed(1) : '—'}</strong>
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
                <td className="sticky-col text-center">
                  <strong>Total Active: {filteredRows.length}</strong>
                </td>
                <td className="text-center">—</td>
                <td className="text-center">—</td>
                {displayedDateColumns.map((col) => (
                  <React.Fragment key={`foot-${col.dateStr}`}>
                    <td className="td-foot-blank text-center">—</td>
                    <td className="td-foot-blank text-center">—</td>
                  </React.Fragment>
                ))}
                <td className="td-metric td-avg-hours text-center">
                  <strong>{data.overallAvgHours.toFixed(1)}</strong>
                </td>
                <td className="td-metric td-avg-orders text-center">
                  <strong>{data.overallAvgOrders.toFixed(1)}</strong>
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
