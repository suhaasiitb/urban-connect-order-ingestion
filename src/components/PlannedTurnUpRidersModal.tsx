// ==============================================================================
// Planned Turn-Up Riders Modal Component
// Displays the list of riders counted / scheduled in a specific slot hour,
// including their name, phone, assigned shift, timings, attendance status,
// and onboarded-by field.
// ==============================================================================

import React, { useMemo, useState, useEffect } from 'react';
import type { SlotRiderInfo } from '../services/riderAttendanceService';

interface PlannedTurnUpRidersModalProps {
  isOpen: boolean;
  onClose: () => void;
  slotHour: number;
  slotLabel: string;
  storeName?: string;
  warehouseId?: string;
  planningDate?: string; // "YYYY-MM-DD"
  requiredRiders: number;
  plannedTurnUp: number;
  riders: SlotRiderInfo[];
  isTurnUpFromRoster?: boolean;
}

export const PlannedTurnUpRidersModal: React.FC<PlannedTurnUpRidersModalProps> = ({
  isOpen,
  onClose,
  slotHour,
  slotLabel,
  storeName,
  warehouseId,
  planningDate,
  requiredRiders,
  plannedTurnUp,
  riders,
  isTurnUpFromRoster = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterShift, setFilterShift] = useState<string>('ALL');
  const [filterCategory, setFilterCategory] = useState<'counted' | 'all' | 'present' | 'unmarked' | 'absent'>('counted');

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent background scrolling when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Breakdown counts
  const { countedCount, presentCount, unmarkedCount, absentCount } = useMemo(() => {
    let counted = 0;
    let present = 0;
    let unmarked = 0;
    let absent = 0;

    for (const r of riders) {
      if (r.isCountedInTurnUp) counted++;
      if (r.status === 'present' || r.isPresent) present++;
      else if (r.status === 'absent') absent++;
      else unmarked++;
    }

    return {
      countedCount: counted,
      presentCount: present,
      unmarkedCount: unmarked,
      absentCount: absent,
    };
  }, [riders]);

  // Available shift types in this slot
  const availableShifts = useMemo(() => {
    const set = new Set<string>();
    for (const r of riders) {
      if (r.shiftType) set.add(r.shiftType);
    }
    return Array.from(set).sort();
  }, [riders]);

  // Filtered riders list
  const filteredRiders = useMemo(() => {
    let list = riders;

    // Filter category
    if (filterCategory === 'counted') {
      list = list.filter((r) => r.isCountedInTurnUp);
    } else if (filterCategory === 'present') {
      list = list.filter((r) => r.status === 'present' || r.isPresent);
    } else if (filterCategory === 'absent') {
      list = list.filter((r) => r.status === 'absent');
    } else if (filterCategory === 'unmarked') {
      list = list.filter((r) => r.status === 'unmarked' && !r.isPresent);
    }

    // Shift filter
    if (filterShift !== 'ALL') {
      list = list.filter((r) => r.shiftType === filterShift);
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (r) =>
          r.riderName.toLowerCase().includes(q) ||
          (r.phone && r.phone.toLowerCase().includes(q)) ||
          (r.onboardedBy && r.onboardedBy.toLowerCase().includes(q)) ||
          r.shiftType.toLowerCase().includes(q)
      );
    }

    return list;
  }, [riders, filterCategory, filterShift, searchQuery]);

  if (!isOpen) return null;

  // Format planning date for display
  const formattedDate = planningDate
    ? new Date(planningDate + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '';

  const delta = plannedTurnUp - requiredRiders;
  const isDeficit = delta < 0;
  const isSurplus = delta > 0;

  return (
    <div
      className="turnup-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="turnup-modal-title"
    >
      <div
        className="turnup-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="turnup-modal-header">
          <div className="turnup-modal-header-info">
            <div className="turnup-modal-title-row">
              <span className="turnup-modal-icon">👥</span>
              <h2 id="turnup-modal-title" className="turnup-modal-title">
                Planned Turn-Up Riders — Slot {slotHour} ({slotLabel})
              </h2>
            </div>
            <p className="turnup-modal-subtitle">
              {warehouseId ? <strong>{warehouseId}</strong> : null}
              {storeName ? ` — ${storeName}` : ''}
              {formattedDate ? ` • ${formattedDate}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="turnup-modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Top KPI Metrics Bar */}
        <div className="turnup-modal-kpi-bar">
          <div className="turnup-kpi-card highlight-turnup">
            <span className="turnup-kpi-label">PLANNED TURN-UP</span>
            <span className="turnup-kpi-value text-blue">{plannedTurnUp}</span>
            <span className="turnup-kpi-hint">
              {isTurnUpFromRoster ? 'From Shift Roster' : 'From Attendance (Present)'}
            </span>
          </div>

          <div className="turnup-kpi-card">
            <span className="turnup-kpi-label">REQUIRED RIDERS</span>
            <span className="turnup-kpi-value">{requiredRiders}</span>
            <span className="turnup-kpi-hint">CEIL(Orders ÷ DPH)</span>
          </div>

          <div className={`turnup-kpi-card ${isDeficit ? 'card-deficit' : isSurplus ? 'card-surplus' : 'card-balanced'}`}>
            <span className="turnup-kpi-label">SLOT STATUS</span>
            <span className="turnup-kpi-value">
              {isDeficit ? `${delta} Short` : isSurplus ? `+${delta} Surplus` : 'Balanced'}
            </span>
            <span className="turnup-kpi-hint">
              {isDeficit ? '⚠ Below Target' : '✓ Target Covered'}
            </span>
          </div>

          <div className="turnup-kpi-card">
            <span className="turnup-kpi-label">ROSTER IN SLOT</span>
            <span className="turnup-kpi-value">{riders.length}</span>
            <span className="turnup-kpi-hint">
              {presentCount} Present • {unmarkedCount} Unmarked • {absentCount} Absent
            </span>
          </div>
        </div>

        {/* Filter Controls Row */}
        <div className="turnup-modal-controls">
          <div className="turnup-search-box">
            <span className="turnup-search-icon">🔍</span>
            <input
              type="text"
              className="turnup-search-input"
              placeholder="Search rider name, phone, or onboarded by..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="turnup-search-clear"
                onClick={() => setSearchQuery('')}
              >
                ✕
              </button>
            )}
          </div>

          {availableShifts.length > 1 && (
            <div className="turnup-shift-filter">
              <select
                value={filterShift}
                onChange={(e) => setFilterShift(e.target.value)}
                className="turnup-select"
              >
                <option value="ALL">All Shifts ({riders.length})</option>
                {availableShifts.map((s) => (
                  <option key={s} value={s}>
                    {s} ({riders.filter((r) => r.shiftType === s).length})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="turnup-category-tabs">
            <button
              type="button"
              className={`turnup-tab-btn ${filterCategory === 'counted' ? 'active' : ''}`}
              onClick={() => setFilterCategory('counted')}
            >
              Counted ({countedCount})
            </button>
            <button
              type="button"
              className={`turnup-tab-btn ${filterCategory === 'all' ? 'active' : ''}`}
              onClick={() => setFilterCategory('all')}
            >
              All In Slot ({riders.length})
            </button>
            <button
              type="button"
              className={`turnup-tab-btn ${filterCategory === 'present' ? 'active' : ''}`}
              onClick={() => setFilterCategory('present')}
            >
              Present ({presentCount})
            </button>
            <button
              type="button"
              className={`turnup-tab-btn ${filterCategory === 'unmarked' ? 'active' : ''}`}
              onClick={() => setFilterCategory('unmarked')}
            >
              Unmarked ({unmarkedCount})
            </button>
            {absentCount > 0 && (
              <button
                type="button"
                className={`turnup-tab-btn ${filterCategory === 'absent' ? 'active' : ''}`}
                onClick={() => setFilterCategory('absent')}
              >
                Absent ({absentCount})
              </button>
            )}
          </div>
        </div>

        {/* Riders Table */}
        <div className="turnup-modal-table-container">
          <table className="turnup-riders-table">
            <thead>
              <tr>
                <th style={{ width: '45px', textAlign: 'center' }}>#</th>
                <th style={{ textAlign: 'left' }}>Rider Name &amp; Phone</th>
                <th style={{ width: '150px', textAlign: 'left' }}>Assigned Shift</th>
                <th style={{ width: '160px', textAlign: 'left' }}>Shift Timings</th>
                <th style={{ width: '180px', textAlign: 'center' }}>Attendance Status</th>
                <th style={{ width: '130px', textAlign: 'left' }}>Onboarded By</th>
              </tr>
            </thead>
            <tbody>
              {filteredRiders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="turnup-empty-cell">
                    <div className="turnup-empty-content">
                      <span className="turnup-empty-icon">🔍</span>
                      <p className="turnup-empty-text">
                        No riders found in Slot {slotHour} matching the selected filter.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRiders.map((rider, idx) => {
                  const isCounted = rider.isCountedInTurnUp;
                  const shiftBadgeClass =
                    rider.shiftType === 'Morning Shift'
                      ? 'shift-badge-morning'
                      : rider.shiftType === '2nd Shift'
                      ? 'shift-badge-second'
                      : rider.shiftType === 'Split Shift'
                      ? 'shift-badge-split'
                      : 'shift-badge-custom';

                  return (
                    <tr
                      key={rider.normalizedName}
                      className={`turnup-row ${isCounted ? 'row-counted' : 'row-uncounted'}`}
                    >
                      {/* Row Index */}
                      <td className="text-center font-mono text-xs text-muted">
                        {idx + 1}
                      </td>

                      {/* Rider Name and Phone */}
                      <td>
                        <div className="turnup-rider-cell">
                          <span className="turnup-rider-avatar">
                            {rider.riderName.charAt(0).toUpperCase()}
                          </span>
                          <div className="turnup-rider-details">
                            <span className="turnup-rider-name">
                              {rider.riderName}
                            </span>
                            {rider.phone ? (
                              <span className="turnup-rider-phone">
                                📞 {rider.phone}
                              </span>
                            ) : (
                              <span className="turnup-rider-phone text-muted">—</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Assigned Shift Badge */}
                      <td>
                        <span className={`turnup-shift-badge ${shiftBadgeClass}`}>
                          {rider.shiftType}
                        </span>
                      </td>

                      {/* Shift Timings */}
                      <td>
                        <span className="turnup-timings-text">
                          🕒 {rider.timingsFormatted}
                        </span>
                      </td>

                      {/* Attendance Status */}
                      <td className="text-center">
                        {rider.status === 'present' || rider.isPresent ? (
                          <span className="turnup-status-badge status-present">
                            ✓ Present
                          </span>
                        ) : rider.status === 'absent' ? (
                          <span className="turnup-status-badge status-absent">
                            ✕ Absent
                          </span>
                        ) : (
                          <span className="turnup-status-badge status-unmarked">
                            — Unmarked {isCounted ? '(Counted)' : ''}
                          </span>
                        )}
                      </td>

                      {/* Onboarded By */}
                      <td>
                        {rider.onboardedBy ? (
                          <span className="turnup-onboarded-pill">
                            👤 {rider.onboardedBy}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Modal Footer */}
        <div className="turnup-modal-footer">
          <div className="turnup-footer-info">
            Showing <strong>{filteredRiders.length}</strong> of <strong>{riders.length}</strong> riders active during Slot {slotHour} ({slotLabel})
          </div>
          <button
            type="button"
            className="turnup-modal-btn-close"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
