import React, { useState, useEffect } from 'react';
import {
  type RiderShiftConfig,
  type ShiftType,
  ONBOARDED_BY_OPTIONS,
  SHIFT_PRESETS,
  TIME_SLOT_OPTIONS,
  calculatePlannedHours,
  classifyShiftType,
} from '../services/riderShiftService';
import { normalizeRiderName } from '../services/activeRiderService';

export interface IndividualRiderShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  riderName: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  phoneNumber?: string;
  currentShift?: RiderShiftConfig | null;
  onSave: (config: RiderShiftConfig) => Promise<{ ok: boolean; error?: string }>;
  onDelete?: (riderName: string) => Promise<{ ok: boolean; error?: string }>;
}

export const IndividualRiderShiftModal: React.FC<IndividualRiderShiftModalProps> = ({
  isOpen,
  onClose,
  riderName,
  storeCode,
  storeName,
  phoneNumber,
  currentShift,
  onSave,
  onDelete,
}) => {
  // Preset defaults if no shift
  const morningPreset = SHIFT_PRESETS['Morning Shift'];

  const [slot1StartHour, setSlot1StartHour] = useState<number>(
    currentShift?.slot1StartHour ?? morningPreset.slot1Start
  );
  const [slot1EndHour, setSlot1EndHour] = useState<number>(
    currentShift?.slot1EndHour ?? morningPreset.slot1End
  );
  const [hasSplitSlot, setHasSplitSlot] = useState<boolean>(
    currentShift?.slot2StartHour != null && currentShift?.slot2EndHour != null
  );
  const [slot2StartHour, setSlot2StartHour] = useState<number>(
    currentShift?.slot2StartHour ?? 15
  );
  const [slot2EndHour, setSlot2EndHour] = useState<number>(
    currentShift?.slot2EndHour ?? 24
  );
  const [onboardedBy, setOnboardedBy] = useState<string>(
    currentShift?.onboardedBy || ''
  );

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync state whenever modal opens or rider changes
  useEffect(() => {
    if (!isOpen) return;
    const s1Start = currentShift?.slot1StartHour ?? morningPreset.slot1Start;
    const s1End = currentShift?.slot1EndHour ?? morningPreset.slot1End;
    const isSplit = currentShift?.slot2StartHour != null && currentShift?.slot2EndHour != null;

    setSlot1StartHour(s1Start);
    setSlot1EndHour(s1End);
    setHasSplitSlot(isSplit);
    setSlot2StartHour(currentShift?.slot2StartHour ?? 15);
    setSlot2EndHour(currentShift?.slot2EndHour ?? 24);
    setOnboardedBy(currentShift?.onboardedBy || '');
    setErrorMsg(null);
    setSaving(false);
    setDeleting(false);
  }, [isOpen, riderName, currentShift, morningPreset.slot1Start, morningPreset.slot1End]);

  // Handle ESC key to close
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

  if (!isOpen) return null;

  // Compute live hours & shift type
  const plannedHours = calculatePlannedHours({
    slot1StartHour,
    slot1EndHour,
    slot2StartHour: hasSplitSlot ? slot2StartHour : null,
    slot2EndHour: hasSplitSlot ? slot2EndHour : null,
  });

  const effectiveShiftType: ShiftType = classifyShiftType({
    slot1StartHour,
    slot1EndHour,
    slot2StartHour: hasSplitSlot ? slot2StartHour : null,
    slot2EndHour: hasSplitSlot ? slot2EndHour : null,
  });

  const meets8hTarget = plannedHours >= 8;

  // Apply a quick preset
  const handleApplyPreset = (presetKey: keyof typeof SHIFT_PRESETS) => {
    const p = SHIFT_PRESETS[presetKey];
    setSlot1StartHour(p.slot1Start);
    setSlot1EndHour(p.slot1End);
    if (p.slot2Start != null && p.slot2End != null) {
      setHasSplitSlot(true);
      setSlot2StartHour(p.slot2Start);
      setSlot2EndHour(p.slot2End);
    } else {
      setHasSplitSlot(false);
    }
  };

  // Handle Save
  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    setErrorMsg(null);

    const norm = normalizeRiderName(riderName);
    const updatedConfig: RiderShiftConfig = {
      riderName,
      normalizedName: norm,
      shiftType: effectiveShiftType,
      slot1StartHour,
      slot1EndHour,
      slot2StartHour: hasSplitSlot ? slot2StartHour : null,
      slot2EndHour: hasSplitSlot ? slot2EndHour : null,
      totalPlannedHours: plannedHours,
      joiningDate: currentShift?.joiningDate || null,
      onboardedBy: onboardedBy ? onboardedBy.trim() : null,
    };

    try {
      const res = await onSave(updatedConfig);
      if (!res.ok) {
        setErrorMsg(res.error || 'Failed to save rider shift.');
        setSaving(false);
        return;
      }
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setSaving(false);
    }
  };

  // Handle Unassign / Delete
  const handleUnassign = async () => {
    if (!onDelete) return;
    if (!window.confirm(`Are you sure you want to unassign shift for ${riderName}?`)) {
      return;
    }
    setDeleting(true);
    setErrorMsg(null);
    try {
      const res = await onDelete(riderName);
      if (!res.ok) {
        setErrorMsg(res.error || 'Failed to unassign shift.');
        setDeleting(false);
        return;
      }
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setDeleting(false);
    }
  };

  return (
    <div
      className="individual-shift-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="individual-shift-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="individual-shift-modal-card">
        {/* Header */}
        <div className="individual-shift-modal-header">
          <div className="individual-shift-title-group">
            <span className="individual-shift-header-icon" aria-hidden="true">⏱️</span>
            <div>
              <h3 id="individual-shift-modal-title" className="individual-shift-modal-title">
                {currentShift ? 'Edit Assigned Shift' : 'Assign Rider Shift'}
              </h3>
              <p className="individual-shift-modal-subtitle">
                <strong>{riderName}</strong>
                {phoneNumber && <span className="modal-sub-phone"> • 📞 {phoneNumber}</span>}
                <span className="modal-sub-store"> • {storeName} ({storeCode})</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            className="individual-shift-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="individual-shift-error-alert" role="alert">
            <span>⚠️ {errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="individual-shift-modal-body">
          {/* Quick Preset Selector */}
          <div className="individual-shift-section">
            <label className="individual-shift-label">Quick Shift Presets:</label>
            <div className="shift-preset-pills-row">
              <button
                type="button"
                className="btn-preset-pill pill-morning"
                onClick={() => handleApplyPreset('Morning Shift')}
              >
                ☀️ Morning Shift (6 AM – 3 PM)
              </button>
              <button
                type="button"
                className="btn-preset-pill pill-2nd"
                onClick={() => handleApplyPreset('2nd Shift')}
              >
                🌙 2nd Shift (3 PM – 12 AM)
              </button>
              <button
                type="button"
                className="btn-preset-pill pill-split"
                onClick={() => handleApplyPreset('Split Shift')}
              >
                ⚡ Split Shift (2 PM – 10 PM)
              </button>
            </div>
          </div>

          {/* Slot 1 Timing Controls */}
          <div className="individual-shift-section">
            <label className="individual-shift-label">Reporting Hours (Slot 1):</label>
            <div className="timing-picker-row">
              <div className="time-field-group">
                <span className="time-field-label">Start Time:</span>
                <select
                  className="hour-dropdown-select"
                  value={slot1StartHour}
                  onChange={(e) => setSlot1StartHour(Number(e.target.value))}
                >
                  {TIME_SLOT_OPTIONS.map((opt) => (
                    <option key={`s1-start-${opt.value}`} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <span className="time-separator-to">to</span>

              <div className="time-field-group">
                <span className="time-field-label">End Time:</span>
                <select
                  className="hour-dropdown-select"
                  value={slot1EndHour}
                  onChange={(e) => setSlot1EndHour(Number(e.target.value))}
                >
                  {TIME_SLOT_OPTIONS.map((opt) => (
                    <option key={`s1-end-${opt.value}`} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <span className="slot-hours-badge">
                {calculatePlannedHours({ slot1StartHour, slot1EndHour })}h
              </span>
            </div>
          </div>

          {/* Optional Split Slot 2 */}
          <div className="individual-shift-section split-slot-section">
            <div className="split-toggle-header">
              <label className="checkbox-label-split cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasSplitSlot}
                  onChange={(e) => setHasSplitSlot(e.target.checked)}
                />
                <span className="checkbox-text font-semibold">
                  Enable Split Shift (Second Reporting Window)
                </span>
              </label>
            </div>

            {hasSplitSlot && (
              <div className="timing-picker-row split-picker-row mt-xs">
                <div className="time-field-group">
                  <span className="time-field-label">Slot 2 Start:</span>
                  <select
                    className="hour-dropdown-select"
                    value={slot2StartHour}
                    onChange={(e) => setSlot2StartHour(Number(e.target.value))}
                  >
                    {TIME_SLOT_OPTIONS.map((opt) => (
                      <option key={`s2-start-${opt.value}`} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <span className="time-separator-to">to</span>

                <div className="time-field-group">
                  <span className="time-field-label">Slot 2 End:</span>
                  <select
                    className="hour-dropdown-select"
                    value={slot2EndHour}
                    onChange={(e) => setSlot2EndHour(Number(e.target.value))}
                  >
                    {TIME_SLOT_OPTIONS.map((opt) => (
                      <option key={`s2-end-${opt.value}`} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <span className="slot-hours-badge">
                  {calculatePlannedHours({
                    slot1StartHour: slot2StartHour,
                    slot1EndHour: slot2EndHour,
                  })}h
                </span>
              </div>
            )}
          </div>

          {/* Planned Hours & 8h Compliance Strip */}
          <div className="individual-shift-kpi-strip">
            <div className="kpi-hours-summary">
              <span className="kpi-label-text">Total Planned Hours:</span>
              <strong className="kpi-hours-val">{plannedHours}h</strong>
              <span className="kpi-shift-type-tag">({effectiveShiftType})</span>
            </div>

            <div className="kpi-compliance-badge-wrapper">
              {meets8hTarget ? (
                <span className="badge-compliance-ok" title="Mandatory target ≥ 8h satisfied">
                  ✓ ≥ 8h Compliant Target
                </span>
              ) : (
                <span className="badge-compliance-warn" title="Planned hours below mandatory 8h threshold">
                  ⚠ &lt; 8h Target Deficit
                </span>
              )}
            </div>
          </div>

          {/* Onboarded By Selection */}
          <div className="individual-shift-section">
            <label htmlFor="onboarded-by-select" className="individual-shift-label">
              Onboarded By:
            </label>
            <div className="onboarder-field-wrapper">
              <select
                id="onboarded-by-select"
                className="hour-dropdown-select onboarder-dropdown"
                value={onboardedBy}
                onChange={(e) => setOnboardedBy(e.target.value)}
              >
                <option value="">— Select Onboarder —</option>
                {ONBOARDED_BY_OPTIONS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <span className="field-hint-text">
                Logs which Fleet Manager / Onboarder introduced this rider
              </span>
            </div>
          </div>

          {/* Modal Footer Actions */}
          <div className="individual-shift-modal-footer">
            <div className="footer-left">
              {currentShift && onDelete && (
                <button
                  type="button"
                  className="btn-danger-outline"
                  onClick={handleUnassign}
                  disabled={saving || deleting}
                  title="Remove shift configuration for this rider"
                >
                  {deleting ? 'Removing...' : '🗑️ Unassign Shift'}
                </button>
              )}
            </div>

            <div className="footer-right">
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={onClose}
                disabled={saving || deleting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-modal-primary-save"
                disabled={saving || deleting}
              >
                {saving ? 'Saving...' : '💾 Save Shift'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
