import React, { useMemo, useState } from 'react';
import {
  type RiderShiftConfig,
  type ShiftType,
  ONBOARDED_BY_OPTIONS,
  SHIFT_PRESETS,
  TIME_SLOT_OPTIONS,
  calculatePlannedHours,
  classifyShiftType,
  saveRiderShiftsForStore,
} from '../services/riderShiftService';
import { normalizeRiderName } from '../services/activeRiderService';

interface RiderShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  storeId: string;
  storeCode: string;
  storeName: string;
  activeRidersList: Array<{ name: string; phone?: string }>;
  existingShiftsMap: Map<string, RiderShiftConfig>;
  onSaved: () => void;
  initialFilter?: string;
  initialSearchQuery?: string;
}

export const RiderShiftModal: React.FC<RiderShiftModalProps> = ({
  isOpen,
  onClose,
  storeId,
  storeCode,
  storeName,
  activeRidersList,
  existingShiftsMap,
  onSaved,
  initialFilter,
  initialSearchQuery,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterShift, setFilterShift] = useState<string>('ALL');
  const [filterOnboardedBy, setFilterOnboardedBy] = useState<string>('ALL');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Initialize editable state from active riders + existing shifts
  const [shiftsState, setShiftsState] = useState<Record<string, RiderShiftConfig>>(() => {
    const initial: Record<string, RiderShiftConfig> = {};
    for (const r of activeRidersList) {
      const norm = normalizeRiderName(r.name);
      if (existingShiftsMap.has(norm)) {
        const existing = existingShiftsMap.get(norm)!;
        initial[norm] = {
          ...existing,
          shiftType: classifyShiftType(existing),
          totalPlannedHours: Math.max(existing.totalPlannedHours ?? 0, calculatePlannedHours(existing)),
          onboardedBy: existing.onboardedBy || null,
        };
      } else {
        // Default to Morning Shift (9h: 6 AM – 3 PM)
        const preset = SHIFT_PRESETS['Morning Shift'];
        initial[norm] = {
          riderName: r.name,
          normalizedName: norm,
          shiftType: 'Morning Shift',
          slot1StartHour: preset.slot1Start,
          slot1EndHour: preset.slot1End,
          slot2StartHour: null,
          slot2EndHour: null,
          totalPlannedHours: preset.hours,
          onboardedBy: null,
        };
      }
    }
    return initial;
  });

  // Re-sync when modal opens or active riders list changes
  React.useEffect(() => {
    if (!isOpen) return;
    const updated: Record<string, RiderShiftConfig> = {};
    for (const r of activeRidersList) {
      const norm = normalizeRiderName(r.name);
      if (existingShiftsMap.has(norm)) {
        const existing = existingShiftsMap.get(norm)!;
        updated[norm] = {
          ...existing,
          shiftType: classifyShiftType(existing),
          totalPlannedHours: Math.max(existing.totalPlannedHours ?? 0, calculatePlannedHours(existing)),
          onboardedBy: existing.onboardedBy || null,
        };
      } else {
        const preset = SHIFT_PRESETS['Morning Shift'];
        updated[norm] = {
          riderName: r.name,
          normalizedName: norm,
          shiftType: 'Morning Shift',
          slot1StartHour: preset.slot1Start,
          slot1EndHour: preset.slot1End,
          slot2StartHour: null,
          slot2EndHour: null,
          totalPlannedHours: preset.hours,
          onboardedBy: null,
        };
      }
    }
    setShiftsState(updated);
    setSaveSuccess(false);

    if (initialFilter) {
      setFilterShift(initialFilter);
    }
    if (initialSearchQuery) {
      setSearchQuery(initialSearchQuery);
    }
  }, [isOpen, activeRidersList, existingShiftsMap, initialFilter, initialSearchQuery]);

  // Count unconfigured / missing shifts
  const unconfiguredRidersCount = useMemo(() => {
    return activeRidersList.filter((r) => {
      const norm = normalizeRiderName(r.name);
      return !existingShiftsMap.has(norm);
    }).length;
  }, [activeRidersList, existingShiftsMap]);

  // Filter riders
  const displayedRiders = useMemo(() => {
    let list = activeRidersList;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.phone && r.phone.toLowerCase().includes(q))
      );
    }

    if (filterShift === 'UNASSIGNED') {
      list = list.filter((r) => {
        const norm = normalizeRiderName(r.name);
        return !existingShiftsMap.has(norm);
      });
    } else if (filterShift !== 'ALL') {
      list = list.filter((r) => {
        const norm = normalizeRiderName(r.name);
        const shift = shiftsState[norm];
        return shift && shift.shiftType === filterShift;
      });
    }

    if (filterOnboardedBy === 'UNASSIGNED') {
      list = list.filter((r) => {
        const norm = normalizeRiderName(r.name);
        return !shiftsState[norm]?.onboardedBy;
      });
    } else if (filterOnboardedBy !== 'ALL') {
      list = list.filter((r) => {
        const norm = normalizeRiderName(r.name);
        return shiftsState[norm]?.onboardedBy === filterOnboardedBy;
      });
    }

    return list;
  }, [activeRidersList, searchQuery, filterShift, filterOnboardedBy, shiftsState, existingShiftsMap]);

  // Update a single rider's shift type
  const handleShiftTypeChange = (riderName: string, newType: ShiftType) => {
    const norm = normalizeRiderName(riderName);
    const targetType = (newType === 'Custom' ? 'Morning Shift' : newType) as keyof typeof SHIFT_PRESETS;
    const preset = SHIFT_PRESETS[targetType] || SHIFT_PRESETS['Morning Shift'];

    setShiftsState((prev) => {
      const current = prev[norm] || {
        riderName,
        normalizedName: norm,
        shiftType: targetType,
        slot1StartHour: preset.slot1Start,
        slot1EndHour: preset.slot1End,
        slot2StartHour: preset.slot2Start ?? null,
        slot2EndHour: preset.slot2End ?? null,
        totalPlannedHours: preset.hours,
      };

      return {
        ...prev,
        [norm]: {
          ...current,
          shiftType: targetType,
          slot1StartHour: preset.slot1Start,
          slot1EndHour: preset.slot1End,
          slot2StartHour: preset.slot2Start ?? null,
          slot2EndHour: preset.slot2End ?? null,
          totalPlannedHours: preset.hours,
        },
      };
    });
  };

  // Update slot timing and automatically re-classify shift type
  const handleTimingChange = (
    riderName: string,
    field: 'slot1StartHour' | 'slot1EndHour' | 'slot2StartHour' | 'slot2EndHour',
    val: number | null
  ) => {
    const norm = normalizeRiderName(riderName);
    setShiftsState((prev) => {
      const current = prev[norm];
      if (!current) return prev;
      const updated: RiderShiftConfig = {
        ...current,
        [field]: val,
      };

      // Automatically classify shiftType based on standard windows (Morning, 2nd, Split)
      updated.shiftType = classifyShiftType(updated);
      updated.totalPlannedHours = calculatePlannedHours(updated);

      return {
        ...prev,
        [norm]: updated,
      };
    });
  };

  // Handle Joining Date change for 7-day onboarding tracking
  const handleJoiningDateChange = (riderName: string, dateStr: string) => {
    const norm = normalizeRiderName(riderName);
    setShiftsState((prev) => {
      const cur = prev[norm];
      if (!cur) return prev;
      return {
        ...prev,
        [norm]: {
          ...cur,
          joiningDate: dateStr ? dateStr : null,
        },
      };
    });
  };

  // Handle Onboarded By change (Sunil, Atharva, Krushna, FM1, FM2)
  const handleOnboardedByChange = (riderName: string, val: string) => {
    const norm = normalizeRiderName(riderName);
    setShiftsState((prev) => {
      const cur = prev[norm];
      if (!cur) return prev;
      return {
        ...prev,
        [norm]: {
          ...cur,
          onboardedBy: val ? val.trim() : null,
        },
      };
    });
  };

  // Bulk Apply Preset
  const handleBulkApply = (presetType: ShiftType) => {
    const preset = SHIFT_PRESETS[presetType as keyof typeof SHIFT_PRESETS];
    if (!preset) return;

    setShiftsState((prev) => {
      const next = { ...prev };
      for (const r of displayedRiders) {
        const norm = normalizeRiderName(r.name);
        next[norm] = {
          ...next[norm],
          riderName: r.name,
          normalizedName: norm,
          shiftType: presetType,
          slot1StartHour: preset.slot1Start,
          slot1EndHour: preset.slot1End,
          slot2StartHour: preset.slot2Start ?? null,
          slot2EndHour: preset.slot2End ?? null,
          totalPlannedHours: preset.hours,
        };
      }
      return next;
    });
  };

  // Bulk Apply Onboarded By to visible riders
  const handleBulkApplyOnboarder = (onboarder: string) => {
    if (!onboarder) return;
    setShiftsState((prev) => {
      const next = { ...prev };
      for (const r of displayedRiders) {
        const norm = normalizeRiderName(r.name);
        if (next[norm]) {
          next[norm] = {
            ...next[norm],
            onboardedBy: onboarder.trim(),
          };
        }
      }
      return next;
    });
  };

  // Save changes
  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    const shiftsToSave = Object.values(shiftsState);
    try {
      const res = await saveRiderShiftsForStore({
        storeId,
        shifts: shiftsToSave,
      });
      if (!res.ok) {
        setSaveError(res.error || 'Failed to save rider shifts.');
        return;
      }
      setSaveSuccess(true);
      onSaved();
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Summary counts
  const allShifts = Object.values(shiftsState);
  const compliantCount = allShifts.filter((s) => s.totalPlannedHours >= 8).length;
  const underCount = allShifts.filter((s) => s.totalPlannedHours < 8).length;

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card shift-modal-card">
        {/* Solid Aesthetic Header */}
        <div className="shift-modal-header">
          <div className="shift-modal-header-left">
            <div className="shift-modal-title-row">
              <span className="shift-header-icon-badge" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </span>
              <h3 className="shift-modal-title">Manage Rider Shifts & Timings</h3>
              <span className="shift-store-badge">{storeCode} — {storeName}</span>
            </div>
            <p className="shift-modal-desc">
              Configure recurring shifts, split shift timings (e.g. 6–10 AM & 6–10 PM), and ensure each rider meets the mandatory 8-hour requirement.
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

        {/* Scrollable Modal Body */}
        <div className="shift-modal-body">
          {saveError && (
            <div className="alert alert-error mb-md" role="alert">
              <strong>Save Error:</strong> {saveError}
            </div>
          )}

          {/* Stats & Quick Presets Toolbar */}
          <div className="shift-toolbar">
            <div className="shift-metrics-strip">
              <span className="shift-metric-pill">
                Total Active: <strong>{activeRidersList.length}</strong>
              </span>
              <span className="shift-metric-pill pill-success">
                Meeting 8h: <strong>{compliantCount}</strong>
              </span>
              {underCount > 0 && (
                <span className="shift-metric-pill pill-warning">
                  Below 8h: <strong>{underCount}</strong>
                </span>
              )}
              {unconfiguredRidersCount > 0 && (
                <button
                  type="button"
                  className={`shift-metric-pill pill-danger cursor-pointer ${filterShift === 'UNASSIGNED' ? 'pill-active' : ''}`}
                  onClick={() => setFilterShift((prev) => (prev === 'UNASSIGNED' ? 'ALL' : 'UNASSIGNED'))}
                  title="Click to view only active riders whose shift is missing / not configured"
                >
                  ⚠️ Missing Shifts: <strong>{unconfiguredRidersCount}</strong>
                </button>
              )}
            </div>

            <div className="shift-bulk-actions">
              <span className="bulk-label">Set visible shifts:</span>
              <button
                type="button"
                className="btn-shift-preset"
                onClick={() => handleBulkApply('Morning Shift')}
              >
                Morning (6 AM – 3 PM)
              </button>
              <button
                type="button"
                className="btn-shift-preset"
                onClick={() => handleBulkApply('2nd Shift')}
              >
                2nd Shift (3 PM – 12 AM)
              </button>
              <button
                type="button"
                className="btn-shift-preset"
                onClick={() => handleBulkApply('Split Shift')}
              >
                Split (6 AM – 3 PM & 3 PM – 12 AM)
              </button>

              <span className="bulk-label ml-xs">Set Onboarder:</span>
              <select
                className="btn-shift-preset"
                onChange={(e) => {
                  if (e.target.value) {
                    handleBulkApplyOnboarder(e.target.value);
                    e.target.value = '';
                  }
                }}
                defaultValue=""
                title="Bulk set Onboarded By for all currently visible riders"
              >
                <option value="" disabled>Apply to visible...</option>
                {ONBOARDED_BY_OPTIONS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="shift-filter-bar">
            <input
              type="text"
              className="shift-search-input"
              placeholder="Search rider name or number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            <select
              className="shift-type-filter"
              value={filterShift}
              onChange={(e) => setFilterShift(e.target.value)}
            >
              <option value="ALL">All Shifts ({activeRidersList.length})</option>
              {unconfiguredRidersCount > 0 && (
                <option value="UNASSIGNED">⚠️ Missing Shifts ({unconfiguredRidersCount})</option>
              )}
              <option value="Morning Shift">Morning Shift</option>
              <option value="2nd Shift">2nd Shift</option>
              <option value="Split Shift">Split Shift</option>
            </select>

            <select
              className="shift-type-filter shift-onboarder-filter"
              value={filterOnboardedBy}
              onChange={(e) => setFilterOnboardedBy(e.target.value)}
              title="Filter by who onboarded the rider"
            >
              <option value="ALL">All Onboarders</option>
              <option value="UNASSIGNED">No Onboarder Set</option>
              {ONBOARDED_BY_OPTIONS.map((name) => (
                <option key={name} value={name}>
                  Onboarded by: {name}
                </option>
              ))}
            </select>
          </div>

          {/* Shift Table */}
          <div className="shift-table-container">
          <table className="shift-table">
            <thead>
              <tr>
                <th style={{ width: '16%' }}>Rider Name</th>
                <th style={{ width: '11%' }}>Rider Number</th>
                <th style={{ width: '13%' }}>Joining Date</th>
                <th style={{ width: '14%' }}>Onboarded By</th>
                <th style={{ width: '14%' }}>Shift Type</th>
                <th style={{ width: '20%' }}>Timings (Slot 1 & Split Slot 2)</th>
                <th style={{ width: '12%' }} className="text-center">Planned Hours</th>
              </tr>
            </thead>
            <tbody>
              {displayedRiders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="table-empty-cell text-center">
                    No riders matching criteria.
                  </td>
                </tr>
              ) : (
                displayedRiders.map((rider) => {
                  const norm = normalizeRiderName(rider.name);
                  const isExistingSaved = existingShiftsMap.has(norm);
                  const shift = shiftsState[norm] || {
                    riderName: rider.name,
                    normalizedName: norm,
                    shiftType: 'Morning Shift',
                    slot1StartHour: 6,
                    slot1EndHour: 14,
                    slot2StartHour: null,
                    slot2EndHour: null,
                    totalPlannedHours: 8,
                    joiningDate: null,
                    onboardedBy: null,
                  };

                  const isSplit = shift.shiftType === 'Split Shift' || shift.slot2StartHour != null;
                  const meetsMandatory8h = shift.totalPlannedHours >= 8;

                  return (
                    <tr key={rider.name} className={`shift-row ${!isExistingSaved ? 'shift-row-unconfigured' : ''}`}>
                      {/* Name */}
                      <td>
                        <div className="shift-rider-cell flex-row items-center gap-xs">
                          <strong className="rider-row-name">{rider.name}</strong>
                          {!isExistingSaved && (
                            <span className="badge-new-shift" title="Shift not saved in database yet">
                              New / Unset
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Number */}
                      <td className="rider-row-phone">
                        {rider.phone ? (
                          <span>{rider.phone}</span>
                        ) : (
                          <span className="cell-dash">—</span>
                        )}
                      </td>

                      {/* Joining Date (Day 1 for 7-day onboarding) */}
                      <td>
                        <div className="shift-date-cell">
                          <input
                            type="date"
                            className="shift-date-input"
                            value={shift.joiningDate || ''}
                            onChange={(e) =>
                              handleJoiningDateChange(rider.name, e.target.value)
                            }
                            title="Joining date (Day 1). Leave blank to auto-detect from first order in data."
                          />
                          {!shift.joiningDate && (
                            <span className="shift-date-auto-tag">Auto (1st order)</span>
                          )}
                        </div>
                      </td>

                      {/* Onboarded By Dropdown Menu (Sunil, Atharva, Krushna, FM1, FM2) */}
                      <td>
                        <select
                          className="shift-select-input shift-onboarder-select"
                          value={shift.onboardedBy || ''}
                          onChange={(e) =>
                            handleOnboardedByChange(rider.name, e.target.value)
                          }
                          title="Select who onboarded this rider: Sunil, Atharva, Krushna, FM1, FM2"
                        >
                          <option value="">— Select —</option>
                          {ONBOARDED_BY_OPTIONS.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Shift Type Select */}
                      <td>
                        <select
                          className="shift-select-input"
                          value={shift.shiftType}
                          onChange={(e) =>
                            handleShiftTypeChange(rider.name, e.target.value as ShiftType)
                          }
                        >
                          <option value="Morning Shift">Morning Shift (6 AM – 3 PM)</option>
                          <option value="2nd Shift">2nd Shift (3 PM – 12 AM)</option>
                          <option value="Split Shift">Split Shift</option>
                        </select>
                      </td>

                      {/* Timings (Slot 1 & Split Slot 2) - Always Editable */}
                      <td>
                        <div className="timing-editor-container">
                          {/* Slot 1 */}
                          <div className="timing-slot-row">
                            <span className="slot-badge">Slot 1:</span>
                            <select
                              className="hour-select"
                              value={shift.slot1StartHour}
                              onChange={(e) =>
                                handleTimingChange(
                                  rider.name,
                                  'slot1StartHour',
                                  Number(e.target.value)
                                )
                              }
                            >
                              {TIME_SLOT_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            <span className="timing-to-text">to</span>
                            <select
                              className="hour-select"
                              value={shift.slot1EndHour}
                              onChange={(e) =>
                                handleTimingChange(
                                  rider.name,
                                  'slot1EndHour',
                                  Number(e.target.value)
                                )
                              }
                            >
                              {TIME_SLOT_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            <span className="slot-duration-pill">
                              {calculatePlannedHours({
                                slot1StartHour: shift.slot1StartHour,
                                slot1EndHour: shift.slot1EndHour,
                              })}h
                            </span>
                          </div>

                          {/* Split Slot 2 */}
                          {isSplit ? (
                            <div className="timing-slot-row slot2-row">
                              <span className="slot-badge slot2-badge">Slot 2:</span>
                              <select
                                className="hour-select"
                                value={shift.slot2StartHour ?? 18}
                                onChange={(e) =>
                                  handleTimingChange(
                                    rider.name,
                                    'slot2StartHour',
                                    Number(e.target.value)
                                  )
                                }
                              >
                                {TIME_SLOT_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                              <span className="timing-to-text">to</span>
                              <select
                                className="hour-select"
                                value={shift.slot2EndHour ?? 22}
                                onChange={(e) =>
                                  handleTimingChange(
                                    rider.name,
                                    'slot2EndHour',
                                    Number(e.target.value)
                                  )
                                }
                              >
                                {TIME_SLOT_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                              <span className="slot-duration-pill">
                                {calculatePlannedHours({
                                  slot1StartHour: shift.slot2StartHour ?? 18,
                                  slot1EndHour: shift.slot2EndHour ?? 22,
                                })}h
                              </span>
                              <button
                                type="button"
                                className="btn-remove-slot2"
                                title="Remove Split Slot 2"
                                onClick={() => {
                                  handleTimingChange(rider.name, 'slot2StartHour', null);
                                  handleTimingChange(rider.name, 'slot2EndHour', null);
                                }}
                              >
                                ×
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="btn-add-split-slot"
                              onClick={() => {
                                handleTimingChange(rider.name, 'slot2StartHour', 15);
                                handleTimingChange(rider.name, 'slot2EndHour', 24);
                              }}
                            >
                              + Add Split Slot (3 PM – 12 AM)
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Planned Hours & Compliance Indicator */}
                      <td className="text-center">
                        <div className="planned-hours-cell">
                          <strong className="hours-val">{shift.totalPlannedHours}h</strong>
                          {meetsMandatory8h ? (
                            <span className="badge-compliance-ok" title="Meets mandatory 8h shift">
                              ✓ 8h Target
                            </span>
                          ) : (
                            <span className="badge-compliance-warn" title="Below mandatory 8h minimum">
                              ⚠ Under 8h
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Solid Pinned Footer */}
      <div className="shift-modal-footer">
        {saveSuccess && (
          <span className="save-toast-msg">✓ Rider shifts saved successfully!</span>
        )}
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
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving Shifts...' : 'Save Shifts'}
        </button>
      </div>
    </div>
  </div>
);
};
