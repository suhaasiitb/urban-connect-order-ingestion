import React, { useMemo, useState } from 'react';
import {
  type NewRiderOnboardingRecord,
  type NewRiderOnboardingSummary,
  exportNewRidersToExcel,
} from '../services/newRiderOnboardingService';

interface NewRiderOnboardingSectionProps {
  summary: NewRiderOnboardingSummary | null;
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
  cohortDays: number;
  onSelectCohortDays: (days: number) => void;
  onOpenShiftModal?: () => void;
  onUpdateJoiningDate?: (riderName: string, newDate: string) => Promise<void>;
}

export const NewRiderOnboardingSection: React.FC<NewRiderOnboardingSectionProps> = ({
  summary,
  loading,
  error,
  onRefresh,
  cohortDays,
  onSelectCohortDays,
  onOpenShiftModal,
  onUpdateJoiningDate,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [editingRiderName, setEditingRiderName] = useState<string | null>(null);
  const [editDateValue, setEditDateValue] = useState<string>('');
  const [savingDate, setSavingDate] = useState(false);

  const cohortOptions = [
    { label: 'Last 7 Days (Default)', value: 7 },
    { label: 'Last 14 Days', value: 14 },
    { label: 'Last 21 Days', value: 21 },
    { label: 'Last 30 Days', value: 30 },
  ];

  const getInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const filteredRiders = useMemo(() => {
    if (!summary?.riders) return [];
    let list = [...summary.riders];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (r) =>
          r.riderName.toLowerCase().includes(q) ||
          (r.phone && r.phone.toLowerCase().includes(q))
      );
    }

    // Status filter
    if (statusFilter !== 'ALL') {
      if (statusFilter === 'ACTIVE') {
        list = list.filter((r) => r.onboardingStatus === 'ACTIVE_WEEK_1');
      } else if (statusFilter === 'COMPLETED') {
        list = list.filter((r) => r.onboardingStatus === 'COMPLETED_WEEK_1');
      } else if (statusFilter === 'ON_TRACK') {
        list = list.filter((r) => r.healthStatus === 'ON_TRACK');
      } else if (statusFilter === 'NEEDS_ATTENTION') {
        list = list.filter((r) => r.healthStatus === 'NEEDS_ATTENTION');
      } else if (statusFilter === 'AT_RISK') {
        list = list.filter((r) => r.healthStatus === 'AT_RISK');
      }
    }

    return list;
  }, [summary?.riders, searchQuery, statusFilter]);

  const handleStartEdit = (rider: NewRiderOnboardingRecord) => {
    setEditingRiderName(rider.riderName);
    setEditDateValue(rider.joiningDate);
  };

  const handleCancelEdit = () => {
    setEditingRiderName(null);
    setEditDateValue('');
  };

  const handleSaveDate = async (riderName: string) => {
    if (!editDateValue || !onUpdateJoiningDate) return;
    setSavingDate(true);
    try {
      await onUpdateJoiningDate(riderName, editDateValue);
      setEditingRiderName(null);
      setEditDateValue('');
    } finally {
      setSavingDate(false);
    }
  };

  const handleExport = () => {
    if (summary) {
      exportNewRidersToExcel(summary);
    }
  };

  return (
    <div className="new-rider-onboarding-section">
      {/* Onboarding Header Banner */}
      <div className="onboarding-header-card">
        <div className="onboarding-header-text">
          <div className="onboarding-badge-tag">
            <span>🚀 7-Day Ramp-Up Tracking</span>
          </div>
          <h3 className="onboarding-title">New Rider First 7 Days Onboarding Tracker</h3>
          <p className="onboarding-subtitle">
            Monitors newly joined riders across their first 7 calendar days to ensure they ramp up orders and meet the mandatory 8-hour shift target.
          </p>
        </div>

        <div className="onboarding-header-actions">
          {onOpenShiftModal && (
            <button
              type="button"
              className="btn btn-secondary btn-sm perf-btn-shifts"
              onClick={onOpenShiftModal}
              title="Configure shifts and joining dates"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Manage Shifts & Dates</span>
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary btn-sm perf-btn-refresh"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh onboarding analytics data"
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
            disabled={!summary || summary.riders.length === 0}
            title="Download full 7-day onboarding report in Excel"
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

      {/* Onboarding Quick KPI Cards */}
      <div className="onboarding-kpi-grid">
        <div className="kpi-card onboarding-kpi-card">
          <span className="kpi-label">New Riders in Cohort</span>
          <strong className="kpi-value text-blue">
            {loading ? '...' : summary?.totalNewRiders ?? 0}
          </strong>
          <span className="kpi-sub">Joined in last {cohortDays} days</span>
        </div>

        <div className="kpi-card onboarding-kpi-card">
          <span className="kpi-label">Currently in Week 1</span>
          <strong className="kpi-value text-indigo">
            {loading ? '...' : summary?.activeWeek1Count ?? 0}
          </strong>
          <span className="kpi-sub">Active first 7 calendar days</span>
        </div>

        <div className="kpi-card onboarding-kpi-card">
          <span className="kpi-label">Week 1 8h Compliance</span>
          <strong
            className={`kpi-value ${(summary?.overallComplianceRate ?? 0) >= 70 ? 'text-green' : 'text-amber'}`}
          >
            {loading ? '...' : `${summary?.overallComplianceRate ?? 0}%`}
          </strong>
          <span className="kpi-sub">Days meeting ≥ 8h target</span>
        </div>

        <div className="kpi-card onboarding-kpi-card">
          <span className="kpi-label">Avg Daily Orders</span>
          <strong className="kpi-value text-green">
            {loading ? '...' : `${summary?.overallAvgOrders ?? 0}`}
          </strong>
          <span className="kpi-sub">Orders delivered per day</span>
        </div>

        <div className="kpi-card onboarding-kpi-card">
          <span className="kpi-label">At-Risk Drop-Offs</span>
          <strong
            className={`kpi-value ${(summary?.atRiskCount ?? 0) > 0 ? 'text-red' : 'text-slate'}`}
          >
            {loading ? '...' : summary?.atRiskCount ?? 0}
          </strong>
          <span className="kpi-sub">Absent for 2+ consecutive days</span>
        </div>
      </div>

      {error && (
        <div className="alert-box alert-box-warning" role="alert">
          <strong>Notice:</strong> {error}
        </div>
      )}

      {/* Controls & Filters Bar */}
      <div className="perf-controls-bar">
        <div className="perf-controls-left">
          {/* Cohort Selector */}
          <div className="perf-filter-group">
            <label htmlFor="cohort-select" className="perf-control-label">
              Cohort Window:
            </label>
            <div className="custom-select-wrapper">
              <select
                id="cohort-select"
                className="perf-dropdown-select"
                value={cohortDays}
                onChange={(e) => onSelectCohortDays(Number(e.target.value))}
                disabled={loading}
              >
                {cohortOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
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

          {/* Status Filter */}
          <div className="perf-filter-group">
            <label htmlFor="status-filter-select" className="perf-control-label">
              Status:
            </label>
            <div className="custom-select-wrapper">
              <select
                id="status-filter-select"
                className="perf-dropdown-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                disabled={loading}
              >
                <option value="ALL">All Statuses ({summary?.riders.length ?? 0})</option>
                <option value="ACTIVE">⚡ Active in Week 1</option>
                <option value="COMPLETED">✓ Completed Week 1</option>
                <option value="ON_TRACK">🟢 On Track (≥ 8h)</option>
                <option value="NEEDS_ATTENTION">🟡 Needs Attention (&lt; 8h)</option>
                <option value="AT_RISK">🔴 At-Risk (Drop-Off)</option>
              </select>
              <span className="select-chevron" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
          </div>
        </div>

        {/* Right Search Input */}
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
              placeholder="Search new rider or phone..."
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
      </div>

      {/* Main 7-Day Onboarding Table */}
      <div className="perf-table-wrapper onboarding-table-wrapper">
        <table className="perf-pivot-table onboarding-table" aria-label="New Rider First 7 Days Table">
          <thead>
            <tr className="tier1-header-row onboarding-header-row">
              <th className="th-rider-name sticky-col text-left">
                Rider Info
              </th>

              <th className="th-shift text-center">
                Shift
              </th>

              <th className="th-joining-date text-center">
                Day 1 (Joined)
              </th>

              <th className="th-health text-center">
                Health
              </th>

              {/* Day 1 to Day 7 Columns */}
              {[1, 2, 3, 4, 5, 6, 7].map((num) => (
                <th key={num} className="th-day-card-col text-center">
                  Day {num}
                </th>
              ))}

              <th className="th-avg-group th-sub-avg-hours text-center">
                Avg Hours
              </th>

              <th className="th-avg-group th-sub-avg-orders text-center">
                Avg Orders
              </th>

              <th className="th-avg-group th-sub-total-orders text-center">
                Total Orders
              </th>

              <th className="th-action text-center" style={{ width: '80px' }}>
                Action
              </th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={15} className="table-empty-cell text-center">
                  <div className="perf-loading-state">
                    <div className="spinner-sm" aria-hidden="true" />
                    <span>Aggregating new rider first 7 days data...</span>
                  </div>
                </td>
              </tr>
            ) : filteredRiders.length === 0 ? (
              <tr>
                <td colSpan={15} className="table-empty-cell text-center">
                  {searchQuery
                    ? `No new riders matching "${searchQuery}".`
                    : `No new riders found who joined in the last ${cohortDays} days. You can change the Cohort Window to "Last 60 Days" or set a manual Joining Date in Manage Shifts.`}
                </td>
              </tr>
            ) : (
              filteredRiders.map((rider) => {
                const meets8hTarget = rider.avgHours >= 8.0;

                return (
                  <tr key={rider.riderName} className="perf-data-row onboarding-data-row">
                    {/* Sticky Rider Name & Phone */}
                    <td className="td-rider-name sticky-col text-left">
                      <div className="rider-cell-content">
                        <span className="rider-avatar-bubble" aria-hidden="true">
                          {getInitials(rider.riderName)}
                        </span>
                        <div className="rider-info-stacked">
                          <strong className="rider-name-text" title={rider.riderName}>
                            {rider.riderName}
                          </strong>
                          {rider.phone ? (
                            <span className="rider-phone-sub">{rider.phone}</span>
                          ) : (
                            <span className="rider-phone-none">No phone</span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Shift & Timings */}
                    <td className="td-shift text-center">
                      <div className="shift-cell-badge-wrapper">
                        <span
                          className={`badge-shift badge-shift-${rider.shiftType.toLowerCase().replace(/\s+/g, '-')}`}
                        >
                          {rider.shiftType === 'Split Shift' ? 'Split' : rider.shiftType.replace(' Shift', '')}
                        </span>
                        <span className="shift-timings-caption">
                          {rider.shiftTimings}
                        </span>
                      </div>
                    </td>

                    {/* Joining Date (Day 1) with edit mode */}
                    <td className="td-joining-date text-center">
                      {editingRiderName === rider.riderName ? (
                        <div className="inline-date-editor">
                          <input
                            type="date"
                            value={editDateValue}
                            onChange={(e) => setEditDateValue(e.target.value)}
                            className="inline-date-input"
                          />
                          <div className="inline-editor-btns">
                            <button
                              type="button"
                              className="btn-date-save"
                              onClick={() => handleSaveDate(rider.riderName)}
                              disabled={savingDate || !editDateValue}
                            >
                              ✓
                            </button>
                            <button
                              type="button"
                              className="btn-date-cancel"
                              onClick={handleCancelEdit}
                              disabled={savingDate}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="joining-date-wrapper">
                          <span
                            className="joining-date-pill"
                            title={rider.isManualJoiningDate ? 'Manual joining date' : 'Auto-detected from first order date'}
                          >
                            {rider.joiningDate}
                          </span>
                          <span className={`timeline-tag ${rider.onboardingStatus === 'ACTIVE_WEEK_1' ? 'tag-active-week' : 'tag-done-week'}`}>
                            {rider.onboardingStatus === 'ACTIVE_WEEK_1'
                              ? `Day ${rider.calendarDaysElapsed} of 7`
                              : 'Week 1 Done'}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Health Status */}
                    <td className="td-health text-center">
                      {rider.healthStatus === 'ON_TRACK' ? (
                        <span className="badge-health badge-health-ok" title="Clocking regular 8h shifts and active">
                          🟢 On Track
                        </span>
                      ) : rider.healthStatus === 'AT_RISK' ? (
                        <span className="badge-health badge-health-risk" title="At risk of drop-off: absent 2+ consecutive days">
                          🔴 At-Risk
                        </span>
                      ) : (
                        <span className="badge-health badge-health-warn" title="Active but averaging under 8h mandatory target">
                          🟡 Under 8h
                        </span>
                      )}
                    </td>

                    {/* Day 1 through Day 7 Metric Cells */}
                    {rider.days.map((day) => {
                      return (
                        <td key={day.dayNumber} className="td-day-box text-center">
                          <div className={`onboarding-day-card day-status-${day.status.toLowerCase()}`}>
                            <div className="day-card-header">
                              <span className="day-card-date">{day.formattedDate}</span>
                              <span className="day-card-dow">{day.dayOfWeek}</span>
                            </div>

                            <div className="day-card-metric-row">
                              {day.status === 'UPCOMING' ? (
                                <span className="day-metric-upcoming">—</span>
                              ) : day.status === 'ABSENT' ? (
                                <span className="day-metric-absent">Absent</span>
                              ) : (
                                <>
                                  <strong className={`day-metric-hours ${day.isCompliant8h ? 'hours-target-ok' : 'hours-target-warn'}`}>
                                    {day.hours > 0 ? `${day.hours}h` : '0h'}
                                  </strong>
                                  <span className="day-metric-orders">
                                    {day.orders} ord
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                      );
                    })}

                    {/* Avg Hours */}
                    <td className="td-metric td-avg-hours text-center">
                      <div className="avg-hours-wrapper">
                        <div className="avg-val-row">
                          <strong className={`avg-num-text ${meets8hTarget ? 'val-target-met' : 'val-target-under'}`}>
                            {rider.avgHours > 0 ? rider.avgHours.toFixed(1) : '—'}
                          </strong>
                          {rider.avgHours > 0 && <span className="avg-unit-tag">h/d</span>}
                        </div>
                        {rider.avgHours > 0 && (
                          <div
                            className="mini-progress-track"
                            title={`${rider.avgHours.toFixed(1)} / 8.0h daily target (${Math.round(
                              (rider.avgHours / 8) * 100
                            )}%)`}
                          >
                            <div
                              className={`mini-progress-fill ${meets8hTarget ? 'fill-target-met' : 'fill-target-under'}`}
                              style={{ width: `${Math.min(100, Math.round((rider.avgHours / 8) * 100))}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Avg Orders */}
                    <td className="td-metric td-avg-orders text-center">
                      <strong className="avg-num-text avg-orders-accent">
                        {rider.avgOrders > 0 ? rider.avgOrders.toFixed(1) : '—'}
                      </strong>
                    </td>

                    {/* Total Orders */}
                    <td className="td-metric td-total-orders text-center">
                      <span className="total-orders-pill">{rider.totalOrders}</span>
                    </td>

                    {/* Action Button: Edit Joining Date */}
                    <td className="td-action text-center">
                      <button
                        type="button"
                        className="btn-edit-joining"
                        onClick={() => handleStartEdit(rider)}
                        title="Edit Joining Date override"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {/* Footer Summary */}
          {filteredRiders.length > 0 && !loading && summary && (
            <tfoot>
              <tr className="perf-footer-row">
                <td className="sticky-col text-left">
                  <strong>Total: {filteredRiders.length} New Riders</strong>
                </td>
                <td className="text-center">—</td>
                <td className="text-center">—</td>
                <td className="text-center">
                  <strong className="summary-compliance-rate">
                    {summary.overallComplianceRate}% Target Met
                  </strong>
                </td>
                {[1, 2, 3, 4, 5, 6, 7].map((num) => (
                  <td key={`foot-${num}`} className="text-center">
                    —
                  </td>
                ))}
                <td className="td-metric td-avg-hours text-center">
                  <strong>{summary.overallAvgHours.toFixed(1)}h</strong>
                </td>
                <td className="td-metric td-avg-orders text-center">
                  <strong>{summary.overallAvgOrders.toFixed(1)}</strong>
                </td>
                <td className="td-metric td-total-orders text-center">
                  <strong>
                    {filteredRiders
                      .reduce((acc, r) => acc + r.totalOrders, 0)
                      .toLocaleString()}
                  </strong>
                </td>
                <td className="text-center">—</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="perf-footer-caption">
        <div className="caption-summary-pill">
          <span>
            Tracking <strong>{filteredRiders.length}</strong> new delivery partners across their first 7 calendar days for{' '}
            <strong>{summary?.storeCode}</strong> ({summary?.storeName}).
          </span>
        </div>
        <div className="caption-summary-pill pill-compliance-summary">
          <span>
            Week 1 Shift Target: <strong>{summary?.overallComplianceRate ?? 0}%</strong> compliance with the mandatory 8-hour shift.
          </span>
        </div>
        <div className="formula-hint-pills">
          <span className="formula-tag"><strong>Day 1:</strong> Joining Date</span>
          <span className="formula-tag"><strong>Day 7:</strong> Day 1 + 6 Calendar Days</span>
          <span className="formula-tag"><strong>Detection:</strong> Earliest Order Date with Shift override</span>
        </div>
      </div>
    </div>
  );
};
