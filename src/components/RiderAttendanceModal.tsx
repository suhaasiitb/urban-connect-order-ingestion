// ==============================================================================
// Rider Attendance Modal Component
// Allows store operators to mark next day's rider attendance (unmarked, present, absent).
// Provides quick bulk actions (Mark All Present, Reset), search & shift filters,
// and saves to Supabase + localStorage with real-time slot turn-up reflection.
// ==============================================================================

import React, { useMemo, useState, useEffect } from 'react';
import {
  type RiderAttendanceRecord,
  type AttendanceStatus,
  calculateSlotTurnUpFromAttendance,
  saveStoreRiderAttendance,
} from '../services/riderAttendanceService';
import { formatShiftTimings } from '../services/riderShiftService';

interface RiderAttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  storeId?: string;
  warehouseId: string;
  storeName?: string;
  attendanceDate: string; // "YYYY-MM-DD"
  initialRecords: RiderAttendanceRecord[];
  onSaved: (records: RiderAttendanceRecord[]) => void;
}

export const RiderAttendanceModal: React.FC<RiderAttendanceModalProps> = ({
  isOpen,
  onClose,
  storeId,
  warehouseId,
  storeName,
  attendanceDate,
  initialRecords,
  onSaved,
}) => {
  const [records, setRecords] = useState<RiderAttendanceRecord[]>(initialRecords);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterShift, setFilterShift] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync state whenever modal opens or initialRecords change
  useEffect(() => {
    if (isOpen) {
      setRecords(initialRecords);
      setSearchQuery('');
      setFilterShift('ALL');
      setFilterStatus('ALL');
      setSaveError(null);
    }
  }, [isOpen, initialRecords]);

  // Derived attendance counts
  const { presentCount, absentCount, unmarkedCount, peakSlotTurnUp } = useMemo(() => {
    let p = 0;
    let a = 0;
    let u = 0;

    for (const r of records) {
      if (r.status === 'present') p++;
      else if (r.status === 'absent') a++;
      else u++;
    }

    const slotTurnUp = calculateSlotTurnUpFromAttendance(records);
    let peak = 0;
    for (let h = 6; h <= 23; h++) {
      if ((slotTurnUp[h] || 0) > peak) {
        peak = slotTurnUp[h];
      }
    }

    return {
      presentCount: p,
      absentCount: a,
      unmarkedCount: u,
      peakSlotTurnUp: peak,
    };
  }, [records]);

  // Filter records based on search query, shift filter, and status filter
  const displayedRecords = useMemo(() => {
    let list = records;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (r) =>
          r.riderName.toLowerCase().includes(q) ||
          (r.phone && r.phone.toLowerCase().includes(q))
      );
    }

    if (filterShift !== 'ALL') {
      list = list.filter((r) => r.shiftType === filterShift);
    }

    if (filterStatus !== 'ALL') {
      list = list.filter((r) => r.status === filterStatus);
    }

    return list;
  }, [records, searchQuery, filterShift, filterStatus]);

  // Single rider status change
  const handleStatusChange = (indexInAll: number, newStatus: AttendanceStatus) => {
    setRecords((prev) => {
      const copy = [...prev];
      copy[indexInAll] = {
        ...copy[indexInAll],
        status: newStatus,
        isPresent: newStatus === 'present',
      };
      return copy;
    });
  };

  // Bulk actions on displayed (filtered) riders
  const handleBulkSetStatus = (newStatus: AttendanceStatus) => {
    const displayedNames = new Set(displayedRecords.map((r) => r.normalizedName));
    setRecords((prev) =>
      prev.map((r) => {
        if (displayedNames.has(r.normalizedName)) {
          return {
            ...r,
            status: newStatus,
            isPresent: newStatus === 'present',
          };
        }
        return r;
      })
    );
  };

  // Save attendance
  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);

    const res = await saveStoreRiderAttendance({
      storeId,
      warehouseId,
      attendanceDate,
      records,
      updatedBy: 'Store User',
    });

    setSaving(false);

    if (res.ok) {
      onSaved(records);
      onClose();
    } else {
      setSaveError(res.error || 'Failed to save rider attendance.');
    }
  };

  if (!isOpen) return null;

  // Format attendance date for header
  const formattedDate = (() => {
    try {
      const [y, m, d] = attendanceDate.split('-').map(Number);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
        return new Intl.DateTimeFormat('en-IN', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }).format(dt);
      }
    } catch {
      // Fallback
    }
    return attendanceDate;
  })();

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-container rider-attendance-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '920px', width: '95vw', maxHeight: '92vh' }}
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>📋</span>
              <span>Rider Attendance & Turn-Up Planning</span>
            </h2>
            <p className="modal-subtitle">
              Store <strong>{warehouseId}</strong> {storeName ? `(${storeName})` : ''} • Date: <strong>{formattedDate}</strong>
            </p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Attendance KPI Stats Summary */}
        <div className="attendance-summary-kpis">
          <div className="attendance-kpi-pill kpi-total">
            <span className="kpi-label">Active Roster</span>
            <span className="kpi-value">{records.length}</span>
          </div>

          <div className="attendance-kpi-pill kpi-present">
            <span className="kpi-label">Present</span>
            <span className="kpi-value">{presentCount}</span>
          </div>

          <div className="attendance-kpi-pill kpi-absent">
            <span className="kpi-label">Absent</span>
            <span className="kpi-value">{absentCount}</span>
          </div>

          <div className="attendance-kpi-pill kpi-unmarked">
            <span className="kpi-label">Unmarked</span>
            <span className="kpi-value">{unmarkedCount}</span>
          </div>

          <div className="attendance-kpi-pill kpi-peak">
            <span className="kpi-label">Peak Slot Turn-Up</span>
            <span className="kpi-value font-bold text-blue">{peakSlotTurnUp} riders</span>
          </div>
        </div>

        {/* Controls & Quick Bulk Actions */}
        <div className="attendance-controls-bar">
          <div className="attendance-search-filters">
            <input
              type="text"
              className="shift-search-input"
              style={{ minWidth: '220px' }}
              placeholder="Search rider name or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            <select
              className="shift-type-filter"
              value={filterShift}
              onChange={(e) => setFilterShift(e.target.value)}
            >
              <option value="ALL">All Shifts</option>
              <option value="Morning Shift">Morning Shift</option>
              <option value="2nd Shift">2nd Shift</option>
              <option value="Split Shift">Split Shift</option>
            </select>

            {/* Status Quick Filter Buttons */}
            <div className="attendance-status-segmented">
              <button
                type="button"
                className={`segmented-btn ${filterStatus === 'ALL' ? 'active' : ''}`}
                onClick={() => setFilterStatus('ALL')}
              >
                All ({records.length})
              </button>
              <button
                type="button"
                className={`segmented-btn ${filterStatus === 'present' ? 'active' : ''}`}
                onClick={() => setFilterStatus('present')}
              >
                Present ({presentCount})
              </button>
              <button
                type="button"
                className={`segmented-btn ${filterStatus === 'absent' ? 'active' : ''}`}
                onClick={() => setFilterStatus('absent')}
              >
                Absent ({absentCount})
              </button>
              <button
                type="button"
                className={`segmented-btn ${filterStatus === 'unmarked' ? 'active' : ''}`}
                onClick={() => setFilterStatus('unmarked')}
              >
                Unmarked ({unmarkedCount})
              </button>
            </div>
          </div>

          {/* Quick Bulk Action Buttons */}
          <div className="attendance-bulk-btns">
            <span className="bulk-label text-xs text-secondary font-medium">Quick Mark:</span>
            <button
              type="button"
              className="btn-attendance-bulk btn-bulk-present"
              onClick={() => handleBulkSetStatus('present')}
              title="Mark all visible riders as Present"
            >
              ✓ Mark All Present
            </button>
            <button
              type="button"
              className="btn-attendance-bulk btn-bulk-absent"
              onClick={() => handleBulkSetStatus('absent')}
              title="Mark all visible riders as Absent"
            >
              ✗ Mark All Absent
            </button>
            <button
              type="button"
              className="btn-attendance-bulk btn-bulk-unmark"
              onClick={() => handleBulkSetStatus('unmarked')}
              title="Reset visible riders to Unmarked"
            >
              ↺ Reset Unmarked
            </button>
          </div>
        </div>

        {/* Roster Table */}
        <div className="attendance-table-container">
          <table className="perf-pivot-table attendance-roster-table">
            <thead>
              <tr className="tier1-header-row">
                <th style={{ width: '45px', textAlign: 'center' }}>#</th>
                <th style={{ width: '38%', textAlign: 'left' }}>Rider Name & Phone</th>
                <th style={{ width: '30%', textAlign: 'left' }}>Shift Timing</th>
                <th style={{ width: '28%', textAlign: 'center' }}>Attendance Status</th>
              </tr>
            </thead>
            <tbody>
              {displayedRecords.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-lg text-muted">
                    No riders found matching the filter criteria.
                  </td>
                </tr>
              ) : (
                displayedRecords.map((rider, idx) => {
                  const originalIndex = records.findIndex(
                    (r) => r.normalizedName === rider.normalizedName
                  );

                  const timingsLabel = formatShiftTimings({
                    slot1StartHour: rider.slot1StartHour,
                    slot1EndHour: rider.slot1EndHour,
                    slot2StartHour: rider.slot2StartHour,
                    slot2EndHour: rider.slot2EndHour,
                  });

                  return (
                    <tr
                      key={rider.normalizedName}
                      className={`attendance-row status-${rider.status}`}
                    >
                      {/* Row Index */}
                      <td className="text-center text-muted font-mono text-xs">
                        {idx + 1}
                      </td>

                      {/* Rider Name and Phone */}
                      <td>
                        <div className="rider-cell-content">
                          <span className="rider-name font-semibold text-slate">
                            {rider.riderName}
                          </span>
                          {rider.phone && (
                            <span className="rider-phone font-mono text-xs text-muted">
                              📞 {rider.phone}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Shift Timing */}
                      <td>
                        <div className="rider-shift-badge-group">
                          <span
                            className={`shift-badge ${
                              rider.shiftType === 'Morning Shift'
                                ? 'badge-morning'
                                : rider.shiftType === '2nd Shift'
                                ? 'badge-second'
                                : 'badge-split'
                            }`}
                          >
                            {rider.shiftType}
                          </span>
                          <span className="shift-hours-text text-xs text-secondary">
                            {timingsLabel}
                          </span>
                        </div>
                      </td>

                      {/* Attendance Toggle Segmented Buttons */}
                      <td className="text-center">
                        <div className="attendance-toggle-group">
                          <button
                            type="button"
                            className={`btn-toggle-att btn-att-present ${
                              rider.status === 'present' ? 'selected' : ''
                            }`}
                            onClick={() => handleStatusChange(originalIndex, 'present')}
                          >
                            ✓ Present
                          </button>

                          <button
                            type="button"
                            className={`btn-toggle-att btn-att-absent ${
                              rider.status === 'absent' ? 'selected' : ''
                            }`}
                            onClick={() => handleStatusChange(originalIndex, 'absent')}
                          >
                            ✗ Absent
                          </button>

                          <button
                            type="button"
                            className={`btn-toggle-att btn-att-unmark ${
                              rider.status === 'unmarked' ? 'selected' : ''
                            }`}
                            onClick={() => handleStatusChange(originalIndex, 'unmarked')}
                          >
                            — Unmarked
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="attendance-footer-summary text-xs text-secondary">
            {records.length > 0 ? (
              <span>
                <strong>{presentCount}</strong> of <strong>{records.length}</strong> riders marked Present
                {unmarkedCount > 0 && (
                  <span className="text-amber font-medium ml-xs">
                    ({unmarkedCount} still unmarked)
                  </span>
                )}
              </span>
            ) : (
              <span>No active riders configured for this store.</span>
            )}
            {saveError && (
              <span className="text-red font-semibold ml-md">⚠ {saveError}</span>
            )}
          </div>

          <div className="modal-footer-actions" style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              type="button"
              className="btn btn-primary btn-save-attendance"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? 'Saving Attendance...' : '✓ Save Attendance & Plan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
