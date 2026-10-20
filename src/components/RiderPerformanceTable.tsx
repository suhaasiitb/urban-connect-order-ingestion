import React, { useMemo, useState } from 'react';
import {
  type RiderPerformancePivotResult,
  type RiderPivotRow,
  exportRiderPerformanceToExcel,
} from '../services/analyticsService';

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
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'avgOrders' | 'avgHours' | 'totalOrders'>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [customStart, setCustomStart] = useState(startDate);
  const [customEnd, setCustomEnd] = useState(endDate);
  const [avgMode, setAvgMode] = useState<'period' | 'active'>('period');
  const [dateOrder, setDateOrder] = useState<'desc' | 'asc'>('desc');

  const presets = [7, 10, 14, 20, 30];

  const periodDays = data.periodDays || data.dateColumns.length || selectedDays;
  const periodLabel = avgMode === 'period' ? `${periodDays} Days Avg` : 'Active Days Avg';

  const displayedDateColumns = useMemo(() => {
    if (dateOrder === 'desc') {
      return [...data.dateColumns].sort((a, b) => b.dateStr.localeCompare(a.dateStr));
    }
    return [...data.dateColumns].sort((a, b) => a.dateStr.localeCompare(b.dateStr));
  }, [data.dateColumns, dateOrder]);

  const handleSort = (field: 'name' | 'avgOrders' | 'avgHours' | 'totalOrders') => {
    if (sortBy === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(field);
      setSortAsc(field === 'name'); // default asc for names, desc for numbers
    }
  };

  const filteredRows = useMemo(() => {
    let result = [...data.rows];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((r) => r.riderName.toLowerCase().includes(q));
    }

    result.sort((a: RiderPivotRow, b: RiderPivotRow) => {
      let comparison = 0;
      switch (sortBy) {
        case 'name':
          comparison = a.riderName.localeCompare(b.riderName);
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
  }, [data.rows, searchQuery, sortBy, sortAsc, avgMode]);

  const handleApplyCustomDate = () => {
    if (customStart && customEnd && onCustomDateChange) {
      onCustomDateChange(customStart, customEnd);
    }
  };

  const handleExport = () => {
    exportRiderPerformanceToExcel(
      { ...data, dateColumns: displayedDateColumns },
      storeCode,
      avgMode === 'active'
    );
  };

  return (
    <div className="rider-perf-section">
      {/* Controls & Filter Bar */}
      <div className="perf-controls-bar">
        <div className="perf-range-selector">
          <span className="perf-control-label">Period Range:</span>
          <div className="preset-pill-group">
            {presets.map((days) => (
              <button
                type="button"
                key={days}
                className={`preset-pill ${
                  !showCustomRange && selectedDays === days ? 'preset-pill-active' : ''
                }`}
                onClick={() => {
                  setShowCustomRange(false);
                  onSelectDaysPreset(days);
                }}
                disabled={loading}
              >
                {days} Days
              </button>
            ))}
            <button
              type="button"
              className={`preset-pill ${showCustomRange ? 'preset-pill-active' : ''}`}
              onClick={() => setShowCustomRange(!showCustomRange)}
            >
              Custom Range
            </button>
          </div>

          <div className="perf-avg-toggle-group">
            <span className="perf-control-label">Avg Divisor:</span>
            <div className="preset-pill-group">
              <button
                type="button"
                className={`preset-pill ${avgMode === 'period' ? 'preset-pill-active' : ''}`}
                onClick={() => setAvgMode('period')}
                title={`Divide by total ${periodDays} days in period`}
              >
                {periodDays} Days
              </button>
              <button
                type="button"
                className={`preset-pill ${avgMode === 'active' ? 'preset-pill-active' : ''}`}
                onClick={() => setAvgMode('active')}
                title="Divide by active working days only"
              >
                Active Days Worked
              </button>
            </div>
          </div>

          <div className="perf-avg-toggle-group">
            <span className="perf-control-label">Date Order:</span>
            <div className="preset-pill-group">
              <button
                type="button"
                className={`preset-pill ${dateOrder === 'desc' ? 'preset-pill-active' : ''}`}
                onClick={() => setDateOrder('desc')}
                title="Newest date first (e.g. 19-Oct → 13-Oct)"
              >
                Newest First ↓
              </button>
              <button
                type="button"
                className={`preset-pill ${dateOrder === 'asc' ? 'preset-pill-active' : ''}`}
                onClick={() => setDateOrder('asc')}
                title="Oldest date first (e.g. 13-Oct → 19-Oct)"
              >
                Oldest First ↑
              </button>
            </div>
          </div>
        </div>

        <div className="perf-actions-right">
          <div className="perf-search-box">
            <input
              type="text"
              placeholder="Search rider..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="perf-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery('')}
              >
                ×
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh analytics data"
          >
            ↻ {loading ? 'Loading...' : 'Refresh'}
          </button>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleExport}
            disabled={data.rows.length === 0}
            title="Download Excel spreadsheet matching Google Sheets layout"
          >
            Export Excel
          </button>
        </div>
      </div>

      {/* Optional Custom Date Picker Drawer */}
      {showCustomRange && (
        <div className="custom-range-drawer">
          <div className="date-field">
            <label htmlFor="custom-start-date">From:</label>
            <input
              id="custom-start-date"
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
            />
          </div>
          <div className="date-field">
            <label htmlFor="custom-end-date">To:</label>
            <input
              id="custom-end-date"
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleApplyCustomDate}
            disabled={loading || !customStart || !customEnd}
          >
            Apply Range
          </button>
        </div>
      )}

      {/* Main Two-Tier Pivot Table */}
      <div className="perf-table-wrapper">
        <table className="perf-pivot-table" aria-label="Rider Hours and Orders Performance Pivot Table">
          <thead>
            {/* Tier 1 Header */}
            <tr className="tier1-header-row">
              <th
                rowSpan={1}
                className="th-rider-name sticky-col"
                onClick={() => handleSort('name')}
              >
                <div className="th-content">
                  <span>Rider Name</span>
                  {sortBy === 'name' && (
                    <span className="sort-arrow">{sortAsc ? '▲' : '▼'}</span>
                  )}
                </div>
              </th>

              <th rowSpan={1} className="th-active-status">
                Active
              </th>

              {displayedDateColumns.map((col) => (
                <th key={col.dateStr} colSpan={2} className="th-date-group">
                  {col.formattedHeader}
                </th>
              ))}

              <th colSpan={2} className="th-avg-group">
                {periodLabel}
              </th>
            </tr>

            {/* Tier 2 Header */}
            <tr className="tier2-header-row">
              <th className="sticky-col th-sub-blank" />
              <th className="th-sub-blank" />

              {displayedDateColumns.map((col) => (
                <React.Fragment key={`sub-${col.dateStr}`}>
                  <th className="th-sub-hours">Hours</th>
                  <th className="th-sub-orders">Orders</th>
                </React.Fragment>
              ))}

              <th
                className="th-sub-avg-hours"
                onClick={() => handleSort('avgHours')}
                title="Sort by Average Daily Hours"
              >
                <div className="th-content">
                  <span>Hours</span>
                  {sortBy === 'avgHours' && (
                    <span className="sort-arrow">{sortAsc ? '▲' : '▼'}</span>
                  )}
                </div>
              </th>

              <th
                className="th-sub-avg-orders"
                onClick={() => handleSort('avgOrders')}
                title="Sort by Average Daily Orders"
              >
                <div className="th-content">
                  <span>Orders</span>
                  {sortBy === 'avgOrders' && (
                    <span className="sort-arrow">{sortAsc ? '▲' : '▼'}</span>
                  )}
                </div>
              </th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={displayedDateColumns.length * 2 + 4}
                  className="table-empty-cell"
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
                  colSpan={displayedDateColumns.length * 2 + 4}
                  className="table-empty-cell"
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

                return (
                  <tr key={row.riderName} className="perf-data-row">
                    <td className="td-rider-name sticky-col">
                      <strong>{row.riderName}</strong>
                    </td>

                    <td className="td-active text-center">
                      <span className="badge-active">Yes</span>
                    </td>

                    {displayedDateColumns.map((col) => {
                      const metric = row.dailyMetrics[col.dateStr];
                      const hasData = metric && metric.orders > 0;
                      return (
                        <React.Fragment key={`${row.riderName}-${col.dateStr}`}>
                          <td
                            className={`td-metric td-hours ${
                              !hasData ? 'td-blank' : ''
                            }`}
                          >
                            {hasData ? metric.hours : ''}
                          </td>
                          <td
                            className={`td-metric td-orders ${
                              !hasData ? 'td-blank' : ''
                            }`}
                          >
                            {hasData ? metric.orders : ''}
                          </td>
                        </React.Fragment>
                      );
                    })}

                    <td
                      className="td-metric td-avg-hours"
                      title={tooltipText}
                    >
                      <strong>{displayHours > 0 ? displayHours.toFixed(1) : '-'}</strong>
                    </td>

                    <td
                      className="td-metric td-avg-orders"
                      title={tooltipText}
                    >
                      <strong>{displayOrders > 0 ? displayOrders.toFixed(1) : '-'}</strong>
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
                <td className="sticky-col">
                  <strong>Total Active Riders: {filteredRows.length}</strong>
                </td>
                <td className="text-center">-</td>
                {displayedDateColumns.map((col) => (
                  <React.Fragment key={`foot-${col.dateStr}`}>
                    <td className="td-foot-blank" />
                    <td className="td-foot-blank" />
                  </React.Fragment>
                ))}
                <td className="td-metric td-avg-hours">
                  <strong>{data.overallAvgHours.toFixed(1)}</strong>
                </td>
                <td className="td-metric td-avg-orders">
                  <strong>{data.overallAvgOrders.toFixed(1)}</strong>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="perf-footer-caption">
        <span>
          Showing <strong>{filteredRows.length}</strong> riders across <strong>{data.dateColumns.length}</strong> days ({data.startDate} to {data.endDate}) for store{' '}
          <strong>{storeCode}</strong> ({storeName}).
        </span>
        <span className="formula-hint">
          <strong>Hours:</strong> COUNTUNIQUE(slot_hour) • <strong>Orders:</strong> COUNTA(order_id) • <strong>Avg Mode:</strong> {avgMode === 'period' ? `Divided by ${periodDays} days` : 'Divided by active working days'}
        </span>
      </div>
    </div>
  );
};
