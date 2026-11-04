import React, { useMemo, useState, useEffect } from 'react';
import type { ActiveRosterSummary } from '../services/activeRiderService';
import {
  type RiderShiftConfig,
  type ShiftType,
  ONBOARDED_BY_OPTIONS,
  SHIFT_PRESETS,
  calculatePlannedHours,
  classifyShiftType,
  formatShiftTimings,
  exportRiderManagementToExcel,
} from '../services/riderShiftService';
import { cleanRiderDisplayName, normalizeRiderName } from '../services/activeRiderService';
import { IndividualRiderShiftModal } from './IndividualRiderShiftModal';

export interface RiderManagementRow {
  riderName: string;
  normalizedName: string;
  phone?: string;
  isActive: boolean;
  shiftConfig?: RiderShiftConfig;
  // Local editable draft fields
  draftShiftType: ShiftType | 'UNASSIGNED';
  draftSlot1Start: number;
  draftSlot1End: number;
  draftSlot2Start: number | null;
  draftSlot2End: number | null;
  draftTotalHours: number;
  draftJoiningDate: string;
  draftOnboardedBy: string;
  draftReferredBy: string;
  draftReferredPhone: string;
  isModified: boolean;
}

export interface RiderManagementSectionProps {
  storeId: string;
  storeCode: string;
  storeName: string;
  activeRoster: ActiveRosterSummary | null;
  riderShiftsMap: Map<string, RiderShiftConfig>;
  pivotRiderNames?: string[];
  loading?: boolean;
  onRefresh: () => void;
  onSaveSingleShift: (config: RiderShiftConfig) => Promise<{ ok: boolean; error?: string }>;
  onSaveBatchShifts?: (shifts: RiderShiftConfig[]) => Promise<{ ok: boolean; error?: string }>;
  onDeleteSingleShift: (riderName: string) => Promise<{ ok: boolean; error?: string }>;
}

export const RiderManagementSection: React.FC<RiderManagementSectionProps> = ({
  storeId,
  storeCode,
  storeName,
  activeRoster,
  riderShiftsMap,
  pivotRiderNames = [],
  loading = false,
  onRefresh,
  onSaveSingleShift,
  onSaveBatchShifts,
  onDeleteSingleShift,
}) => {
  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE' | 'MISSING_SHIFT' | 'WITH_REFERRAL'>('ALL');
  const [shiftFilter, setShiftFilter] = useState<string>('ALL');
  const [onboardedByFilter, setOnboardedByFilter] = useState<string>('ALL');

  // Modal for deep custom shift edit
  const [modalRider, setModalRider] = useState<string | null>(null);

  // Row-level saving state
  const [savingRider, setSavingRider] = useState<string | null>(null);
  const [justSavedRiders, setJustSavedRiders] = useState<Set<string>>(new Set());
  const [savingAll, setSavingAll] = useState(false);
  const [alertBanner, setAlertBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Editable draft rows state
  const [draftRows, setDraftRows] = useState<Map<string, RiderManagementRow>>(new Map());

  // Aggregate ALL distinct store delivery partners
  const combinedRiders = useMemo(() => {
    const map = new Map<string, { riderName: string; phone?: string; isActive: boolean }>();

    // 1. Active roster riders
    if (activeRoster?.riders) {
      for (const r of activeRoster.riders) {
        const cleanName = cleanRiderDisplayName(r.name);
        const norm = normalizeRiderName(cleanName);
        if (!norm) continue;
        const isActive = activeRoster.activeNamesSet?.has(norm) ?? true;
        map.set(norm, {
          riderName: cleanName,
          phone: r.phone || activeRoster.phoneByNameMap?.get(norm),
          isActive,
        });
      }
    }

    // 2. Rider shifts configured
    if (riderShiftsMap) {
      for (const [norm, shift] of riderShiftsMap.entries()) {
        const cleanName = cleanRiderDisplayName(shift.riderName);
        const isActive = activeRoster?.activeNamesSet?.has(norm) ?? false;
        if (!map.has(norm)) {
          map.set(norm, {
            riderName: cleanName,
            phone: activeRoster?.phoneByNameMap?.get(norm),
            isActive,
          });
        }
      }
    }

    // 3. Historical riders from pivot
    for (const rawName of pivotRiderNames) {
      const cleanName = cleanRiderDisplayName(rawName);
      const norm = normalizeRiderName(cleanName);
      if (!norm) continue;
      const isActive = activeRoster?.activeNamesSet?.has(norm) ?? false;
      if (!map.has(norm)) {
        map.set(norm, {
          riderName: cleanName,
          phone: activeRoster?.phoneByNameMap?.get(norm),
          isActive,
        });
      }
    }

    return Array.from(map.entries()).map(([norm, val]) => ({
      normalizedName: norm,
      riderName: val.riderName,
      phone: val.phone,
      isActive: val.isActive,
    }));
  }, [activeRoster, riderShiftsMap, pivotRiderNames]);

  // Sync draft state from source whenever source data updates, preserving local unsaved modifications
  useEffect(() => {
    setDraftRows((prevDrafts) => {
      const nextMap = new Map<string, RiderManagementRow>();

      for (const r of combinedRiders) {
        const existingShift = riderShiftsMap.get(r.normalizedName);
        const existingDraft = prevDrafts.get(r.normalizedName);

        // If user already touched this row locally and hasn't saved, preserve their uncommitted edits
        if (existingDraft && existingDraft.isModified) {
          nextMap.set(r.normalizedName, {
            ...existingDraft,
            phone: r.phone || existingDraft.phone,
            isActive: r.isActive,
            shiftConfig: existingShift,
          });
          continue;
        }

        const shiftType: ShiftType | 'UNASSIGNED' = existingShift
          ? existingShift.shiftType || classifyShiftType(existingShift)
          : 'UNASSIGNED';

        const s1Start = existingShift?.slot1StartHour ?? 6;
        const s1End = existingShift?.slot1EndHour ?? 15;
        const s2Start = existingShift?.slot2StartHour ?? null;
        const s2End = existingShift?.slot2EndHour ?? null;
        const plannedHrs = existingShift
          ? calculatePlannedHours({
              slot1StartHour: s1Start,
              slot1EndHour: s1End,
              slot2StartHour: s2Start,
              slot2EndHour: s2End,
            })
          : 0;

        nextMap.set(r.normalizedName, {
          riderName: r.riderName,
          normalizedName: r.normalizedName,
          phone: r.phone,
          isActive: r.isActive,
          shiftConfig: existingShift,
          draftShiftType: shiftType,
          draftSlot1Start: s1Start,
          draftSlot1End: s1End,
          draftSlot2Start: s2Start,
          draftSlot2End: s2End,
          draftTotalHours: plannedHrs,
          draftJoiningDate: existingShift?.joiningDate || '',
          draftOnboardedBy: existingShift?.onboardedBy || '',
          draftReferredBy: existingShift?.referredBy || '',
          draftReferredPhone: existingShift?.referredPhone || '',
          isModified: false,
        });
      }

      return nextMap;
    });
  }, [combinedRiders, riderShiftsMap]);

  // Helpers to update draft fields for a rider
  const handleUpdateField = (
    norm: string,
    updates: Partial<RiderManagementRow>
  ) => {
    setDraftRows((prev) => {
      const current = prev.get(norm);
      if (!current) return prev;

      const next = { ...current, ...updates, isModified: true };

      // Recalculate planned hours if time slots changed
      if (
        updates.draftSlot1Start !== undefined ||
        updates.draftSlot1End !== undefined ||
        updates.draftSlot2Start !== undefined ||
        updates.draftSlot2End !== undefined
      ) {
        next.draftTotalHours = calculatePlannedHours({
          slot1StartHour: next.draftSlot1Start,
          slot1EndHour: next.draftSlot1End,
          slot2StartHour: next.draftSlot2Start,
          slot2EndHour: next.draftSlot2End,
        });
        next.draftShiftType = classifyShiftType({
          slot1StartHour: next.draftSlot1Start,
          slot1EndHour: next.draftSlot1End,
          slot2StartHour: next.draftSlot2Start,
          slot2EndHour: next.draftSlot2End,
        });
      }

      const copy = new Map(prev);
      copy.set(norm, next);
      return copy;
    });
  };

  // Quick Preset Handlers
  const handleApplyPreset = (norm: string, presetName: 'Morning Shift' | '2nd Shift' | 'Split Shift') => {
    const p = SHIFT_PRESETS[presetName];
    handleUpdateField(norm, {
      draftShiftType: presetName,
      draftSlot1Start: p.slot1Start,
      draftSlot1End: p.slot1End,
      draftSlot2Start: p.slot2Start ?? null,
      draftSlot2End: p.slot2End ?? null,
      draftTotalHours: p.hours,
    });
  };

  // Save Single Row
  const handleSaveRow = async (row: RiderManagementRow) => {
    setSavingRider(row.normalizedName);
    setAlertBanner(null);

    const shiftType = row.draftShiftType === 'UNASSIGNED' ? 'Morning Shift' : row.draftShiftType;
    const configToSave: RiderShiftConfig = {
      riderName: row.riderName,
      normalizedName: row.normalizedName,
      shiftType: shiftType as ShiftType,
      slot1StartHour: row.draftSlot1Start,
      slot1EndHour: row.draftSlot1End,
      slot2StartHour: row.draftSlot2Start,
      slot2EndHour: row.draftSlot2End,
      totalPlannedHours: row.draftTotalHours > 0 ? row.draftTotalHours : 9,
      joiningDate: row.draftJoiningDate ? row.draftJoiningDate.trim() : null,
      onboardedBy: row.draftOnboardedBy ? row.draftOnboardedBy.trim() : null,
      referredBy: row.draftReferredBy ? row.draftReferredBy.trim() : null,
      referredPhone: row.draftReferredPhone ? row.draftReferredPhone.trim() : null,
    };

    try {
      const res = await onSaveSingleShift(configToSave);
      if (res.ok) {
        setJustSavedRiders((prev) => new Set(prev).add(row.normalizedName));
        setTimeout(() => {
          setJustSavedRiders((prev) => {
            const next = new Set(prev);
            next.delete(row.normalizedName);
            return next;
          });
        }, 3000);

        // Mark unmodified in draft
        setDraftRows((prev) => {
          const cur = prev.get(row.normalizedName);
          if (!cur) return prev;
          const copy = new Map(prev);
          copy.set(row.normalizedName, {
            ...cur,
            isModified: false,
            shiftConfig: configToSave,
          });
          return copy;
        });
      } else {
        setAlertBanner({ type: 'error', message: res.error || 'Failed to save rider shift' });
      }
    } catch (err) {
      setAlertBanner({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSavingRider(null);
    }
  };

  // Unassign Shift
  const handleUnassignShift = async (row: RiderManagementRow) => {
    if (!window.confirm(`Unassign shift for ${row.riderName}?`)) return;
    setSavingRider(row.normalizedName);
    try {
      const res = await onDeleteSingleShift(row.riderName);
      if (res.ok) {
        handleUpdateField(row.normalizedName, {
          draftShiftType: 'UNASSIGNED',
          draftTotalHours: 0,
          isModified: false,
        });
        onRefresh();
      }
    } finally {
      setSavingRider(null);
    }
  };

  // Bulk Save All Modified Rows
  const modifiedRows = useMemo(() => {
    return Array.from(draftRows.values()).filter((r) => r.isModified);
  }, [draftRows]);

  const handleSaveAll = async () => {
    if (modifiedRows.length === 0) return;
    setSavingAll(true);
    setAlertBanner(null);

    try {
      const configs: RiderShiftConfig[] = modifiedRows.map((row) => ({
        riderName: row.riderName,
        normalizedName: row.normalizedName,
        shiftType: (row.draftShiftType === 'UNASSIGNED' ? 'Morning Shift' : row.draftShiftType) as ShiftType,
        slot1StartHour: row.draftSlot1Start,
        slot1EndHour: row.draftSlot1End,
        slot2StartHour: row.draftSlot2Start,
        slot2EndHour: row.draftSlot2End,
        totalPlannedHours: row.draftTotalHours > 0 ? row.draftTotalHours : 9,
        joiningDate: row.draftJoiningDate ? row.draftJoiningDate.trim() : null,
        onboardedBy: row.draftOnboardedBy ? row.draftOnboardedBy.trim() : null,
        referredBy: row.draftReferredBy ? row.draftReferredBy.trim() : null,
        referredPhone: row.draftReferredPhone ? row.draftReferredPhone.trim() : null,
      }));

      if (onSaveBatchShifts) {
        const res = await onSaveBatchShifts(configs);
        if (!res.ok) {
          setAlertBanner({ type: 'error', message: res.error || 'Failed to save changes.' });
          setSavingAll(false);
          return;
        }
      } else {
        for (const cfg of configs) {
          await onSaveSingleShift(cfg);
        }
      }

      setAlertBanner({
        type: 'success',
        message: `Successfully saved ${modifiedRows.length} rider records.`,
      });
      setTimeout(() => setAlertBanner(null), 4000);

      // Reset modified flags
      setDraftRows((prev) => {
        const copy = new Map(prev);
        for (const [norm, row] of copy.entries()) {
          if (row.isModified) {
            copy.set(norm, { ...row, isModified: false });
          }
        }
        return copy;
      });
      onRefresh();
    } catch (err) {
      setAlertBanner({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSavingAll(false);
    }
  };

  // Excel Export
  const handleExportExcel = () => {
    const ridersToExport = Array.from(draftRows.values()).map((r) => {
      const timings = r.draftShiftType === 'UNASSIGNED'
        ? 'Not Assigned'
        : formatShiftTimings({
            slot1StartHour: r.draftSlot1Start,
            slot1EndHour: r.draftSlot1End,
            slot2StartHour: r.draftSlot2Start,
            slot2EndHour: r.draftSlot2End,
          });

      return {
        riderName: r.riderName,
        phone: r.phone || null,
        isActive: r.isActive,
        shiftType: r.draftShiftType,
        shiftTimings: timings,
        totalPlannedHours: r.draftTotalHours,
        joiningDate: r.draftJoiningDate || null,
        onboardedBy: r.draftOnboardedBy || null,
        referredBy: r.draftReferredBy || null,
        referredPhone: r.draftReferredPhone || null,
      };
    });

    exportRiderManagementToExcel({
      riders: ridersToExport,
      storeCode,
    });
  };

  // Filter and Search logic
  const filteredRows = useMemo(() => {
    let rows = Array.from(draftRows.values());

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      rows = rows.filter(
        (r) =>
          r.riderName.toLowerCase().includes(q) ||
          (r.phone && r.phone.toLowerCase().includes(q)) ||
          r.draftOnboardedBy.toLowerCase().includes(q) ||
          r.draftReferredBy.toLowerCase().includes(q) ||
          r.draftReferredPhone.toLowerCase().includes(q)
      );
    }

    // Status filter
    if (statusFilter === 'ACTIVE') {
      rows = rows.filter((r) => r.isActive);
    } else if (statusFilter === 'INACTIVE') {
      rows = rows.filter((r) => !r.isActive);
    } else if (statusFilter === 'MISSING_SHIFT') {
      rows = rows.filter((r) => r.isActive && (!r.shiftConfig || r.draftShiftType === 'UNASSIGNED'));
    } else if (statusFilter === 'WITH_REFERRAL') {
      rows = rows.filter((r) => !!r.draftReferredBy || !!r.draftReferredPhone);
    }

    // Shift filter
    if (shiftFilter !== 'ALL') {
      if (shiftFilter === 'MISSING') {
        rows = rows.filter((r) => !r.shiftConfig || r.draftShiftType === 'UNASSIGNED');
      } else {
        rows = rows.filter((r) => r.draftShiftType === shiftFilter);
      }
    }

    // Onboarded by filter
    if (onboardedByFilter !== 'ALL') {
      if (onboardedByFilter === 'UNASSIGNED') {
        rows = rows.filter((r) => !r.draftOnboardedBy);
      } else {
        rows = rows.filter((r) => r.draftOnboardedBy === onboardedByFilter);
      }
    }

    // Sort: Active first, then name alphabetical
    return rows.sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.riderName.localeCompare(b.riderName);
    });
  }, [draftRows, searchQuery, statusFilter, shiftFilter, onboardedByFilter]);

  // Overall counts for KPI & status pills
  const totalRidersCount = draftRows.size;
  const activeRidersCount = useMemo(
    () => Array.from(draftRows.values()).filter((r) => r.isActive).length,
    [draftRows]
  );
  const inactiveRidersCount = totalRidersCount - activeRidersCount;
  const missingShiftsCount = useMemo(
    () =>
      Array.from(draftRows.values()).filter(
        (r) => r.isActive && (!r.shiftConfig || r.draftShiftType === 'UNASSIGNED')
      ).length,
    [draftRows]
  );
  const configuredShiftsCount = useMemo(
    () =>
      Array.from(draftRows.values()).filter(
        (r) => r.shiftConfig && r.draftShiftType !== 'UNASSIGNED'
      ).length,
    [draftRows]
  );
  const withReferralCount = useMemo(
    () =>
      Array.from(draftRows.values()).filter(
        (r) => !!r.draftReferredBy || !!r.draftReferredPhone
      ).length,
    [draftRows]
  );

  return (
    <div className="rider-management-section">
      {/* KPI Cards Strip */}
      <div className="kpi-grid">
        <div
          className={`kpi-card ${statusFilter === 'ALL' ? 'kpi-card-active' : 'kpi-card-interactive'}`}
          onClick={() => setStatusFilter('ALL')}
          title="Click to view all riders"
        >
          <div className="kpi-header-row">
            <span className="kpi-label">Total Store Riders</span>
            <span className="badge badge-secondary" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
              All Profiles
            </span>
          </div>
          <strong className="kpi-value text-blue">{totalRidersCount}</strong>
          <span className="kpi-sub">{activeRidersCount} Active • {inactiveRidersCount} Inactive</span>
        </div>

        <div
          className={`kpi-card ${statusFilter === 'ACTIVE' ? 'kpi-card-active' : 'kpi-card-interactive'}`}
          onClick={() => setStatusFilter('ACTIVE')}
          title="Click to filter to active delivery partners"
        >
          <div className="kpi-header-row">
            <span className="kpi-label">Active Delivery Partners</span>
            <span className="badge badge-success" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
              Roster
            </span>
          </div>
          <strong className="kpi-value text-green">{activeRidersCount}</strong>
          <span className="kpi-sub">Ready for order assignments</span>
        </div>

        <div className="kpi-card">
          <div className="kpi-header-row">
            <span className="kpi-label">Shifts Configured</span>
            <span className="kpi-target-badge">Planned</span>
          </div>
          <strong className="kpi-value text-teal">{configuredShiftsCount}</strong>
          <span className="kpi-sub">
            {totalRidersCount > 0 ? Math.round((configuredShiftsCount / totalRidersCount) * 100) : 0}% of all riders
          </span>
        </div>

        <div
          className={`kpi-card kpi-card-interactive ${statusFilter === 'MISSING_SHIFT' ? 'kpi-card-active' : ''}`}
          onClick={() => setStatusFilter('MISSING_SHIFT')}
          title="Click to filter to active riders missing shifts"
        >
          <div className="kpi-header-row">
            <span className="kpi-label">Missing Shift Warning</span>
            {missingShiftsCount > 0 ? (
              <span className="badge badge-danger" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                Action Required
              </span>
            ) : (
              <span className="badge badge-success" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                All Assigned
              </span>
            )}
          </div>
          <strong className={`kpi-value ${missingShiftsCount > 0 ? 'text-amber' : 'text-slate'}`}>
            {missingShiftsCount}
          </strong>
          <span className="kpi-sub">
            {missingShiftsCount > 0
              ? `${missingShiftsCount} active riders need shift assigned`
              : 'All active riders configured'}
          </span>
        </div>

        <div
          className={`kpi-card kpi-card-interactive ${statusFilter === 'WITH_REFERRAL' ? 'kpi-card-active' : ''}`}
          onClick={() => setStatusFilter('WITH_REFERRAL')}
          title="Click to filter to riders with referral logged"
        >
          <div className="kpi-header-row">
            <span className="kpi-label">Referrals Logged</span>
            <span className="badge badge-purple" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
              Referral Program
            </span>
          </div>
          <strong className="kpi-value text-purple">{withReferralCount}</strong>
          <span className="kpi-sub">Riders referred by team</span>
        </div>
      </div>

      {/* Alert Banner */}
      {alertBanner && (
        <div
          className={`alert-box ${alertBanner.type === 'success' ? 'alert-box-success' : 'alert-box-warning'} mt-md`}
          role="alert"
        >
          <strong>{alertBanner.type === 'success' ? '✓' : '⚠️'}</strong> {alertBanner.message}
        </div>
      )}

      {/* Main Table Card */}
      <div className="section-card perf-card mt-md">
        {/* Header with Title & Primary Actions */}
        <div className="perf-section-header perf-section-header-row">
          <div>
            <h3 className="section-title">Rider Management</h3>
            <p className="section-subtitle">
              Manage rider profiles, shift timings, joining dates, onboarding fleet managers, and referral tracking.
            </p>
          </div>

          <div className="management-header-actions flex-row items-center gap-sm flex-wrap">
            {modifiedRows.length > 0 && (
              <button
                type="button"
                className="btn btn-primary btn-save-all-changes"
                onClick={handleSaveAll}
                disabled={savingAll}
                title="Save all modified rider records"
              >
                {savingAll ? 'Saving Changes...' : `💾 Save All Changes (${modifiedRows.length})`}
              </button>
            )}

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExportExcel}
              title="Download Excel sheet with all rider shifts, onboarders, and referrals"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Export Excel</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={onRefresh}
              title="Refresh rider and shift records"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Toolbar: Status Filter Pills + Search + Dropdown Filters */}
        <div className="management-toolbar-wrapper">
          <div className="management-status-pills-row">
            <span className="filter-pill-label">ROSTER STATUS:</span>
            <div className="btn-group-segmented">
              <button
                type="button"
                className={`segmented-btn ${statusFilter === 'ALL' ? 'active' : ''}`}
                onClick={() => setStatusFilter('ALL')}
              >
                All ({totalRidersCount})
              </button>
              <button
                type="button"
                className={`segmented-btn ${statusFilter === 'ACTIVE' ? 'active' : ''}`}
                onClick={() => setStatusFilter('ACTIVE')}
              >
                Active ({activeRidersCount})
              </button>
              <button
                type="button"
                className={`segmented-btn ${statusFilter === 'INACTIVE' ? 'active' : ''}`}
                onClick={() => setStatusFilter('INACTIVE')}
              >
                Inactive ({inactiveRidersCount})
              </button>
              <button
                type="button"
                className={`segmented-btn ${statusFilter === 'MISSING_SHIFT' ? 'active warn' : ''}`}
                onClick={() => setStatusFilter('MISSING_SHIFT')}
              >
                ⚠️ Missing Shift ({missingShiftsCount})
              </button>
              <button
                type="button"
                className={`segmented-btn ${statusFilter === 'WITH_REFERRAL' ? 'active' : ''}`}
                onClick={() => setStatusFilter('WITH_REFERRAL')}
              >
                🎁 Referrals ({withReferralCount})
              </button>
            </div>
          </div>

          <div className="management-filter-inputs-row flex-row items-center justify-between gap-md flex-wrap mt-sm">
            {/* Search Input */}
            <div className="search-field-wrapper">
              <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="input-text management-search-input"
                placeholder="Search rider, phone, onboarder, referrer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="filter-dropdowns-group flex-row items-center gap-md flex-wrap">
              {/* Shift Filter Dropdown */}
              <div className="filter-select-item flex-row items-center gap-xs">
                <span className="field-label-sm">SHIFT:</span>
                <select
                  className="select-input select-input-sm"
                  value={shiftFilter}
                  onChange={(e) => setShiftFilter(e.target.value)}
                >
                  <option value="ALL">All Shifts</option>
                  <option value="Morning Shift">Morning Shift (6 AM – 3 PM)</option>
                  <option value="2nd Shift">2nd Shift (3 PM – 12 AM)</option>
                  <option value="Split Shift">Split Shift (2 PM – 10 PM)</option>
                  <option value="Custom Shift">Custom Shift</option>
                  <option value="MISSING">⚠️ Missing Shift</option>
                </select>
              </div>

              {/* Onboarded By Filter Dropdown */}
              <div className="filter-select-item flex-row items-center gap-xs">
                <span className="field-label-sm">ONBOARDED BY:</span>
                <select
                  className="select-input select-input-sm"
                  value={onboardedByFilter}
                  onChange={(e) => setOnboardedByFilter(e.target.value)}
                >
                  <option value="ALL">All Onboarders</option>
                  {ONBOARDED_BY_OPTIONS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                  <option value="UNASSIGNED">Unassigned</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Riders Table */}
        <div className="management-table-container table-responsive mt-md">
          <table className="table table-bordered table-management">
            <thead>
              <tr className="table-header-row">
                <th className="th-rider-info text-center" style={{ minWidth: 200 }}>
                  Rider Info &amp; Status
                </th>
                <th className="th-shift-timings text-center" style={{ minWidth: 260 }}>
                  Assigned Shift &amp; Timings
                </th>
                <th className="th-joining-date text-center" style={{ minWidth: 150 }}>
                  Joining Date (Day 1)
                </th>
                <th className="th-onboarded-by text-center" style={{ minWidth: 160 }}>
                  Onboarded By
                </th>
                <th className="th-referred-by text-center" style={{ minWidth: 160 }}>
                  Referred By
                </th>
                <th className="th-referred-phone text-center" style={{ minWidth: 150 }}>
                  Referred Mobile No
                </th>
                <th className="th-action text-center" style={{ minWidth: 120 }}>
                  Action
                </th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="td-empty text-center py-xl">
                    <span className="spinner-icon">⏳</span> Loading rider management data...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="td-empty text-center py-xl">
                    <span className="text-muted">No riders match the selected filters or search.</span>
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const isSavingThis = savingRider === row.normalizedName;
                  const isJustSaved = justSavedRiders.has(row.normalizedName);
                  const isCompliant = row.draftTotalHours >= 8;

                  return (
                    <tr
                      key={row.normalizedName}
                      className={`management-data-row ${row.isModified ? 'row-modified' : ''}`}
                    >
                      {/* 1. Rider Info (Name, Phone, Active Status) */}
                      <td className="td-rider-info text-center">
                        <div className="rider-cell-stack flex-col items-center justify-center gap-xs">
                          <strong className="rider-name-text text-center" title={row.riderName}>
                            {row.riderName}
                          </strong>
                          {row.phone ? (
                            <span className="rider-phone-sub text-center" title={`Phone: ${row.phone}`}>
                              📞 {row.phone}
                            </span>
                          ) : (
                            <span className="rider-phone-none text-center">No phone</span>
                          )}
                          <div className="active-tag-wrapper mt-xxs">
                            {row.isActive ? (
                              <span className="badge-active-yes" title="Active on store delivery roster">
                                Active
                              </span>
                            ) : (
                              <span className="badge-active-no" title="Inactive on delivery roster">
                                Inactive
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 2. Assigned Shift & Timings */}
                      <td className="td-shift-timings">
                        <div className="shift-cell-controls flex-col gap-xs">
                          {/* Quick Preset Buttons */}
                          <div className="preset-buttons-strip flex-row items-center gap-xxs flex-wrap">
                            <button
                              type="button"
                              className={`btn-shift-pill pill-morning ${
                                row.draftShiftType === 'Morning Shift' ? 'active' : ''
                              }`}
                              onClick={() => handleApplyPreset(row.normalizedName, 'Morning Shift')}
                              title="Set Morning Shift (6 AM – 3 PM, 9h)"
                            >
                              ☀️ Morning
                            </button>
                            <button
                              type="button"
                              className={`btn-shift-pill pill-2nd ${
                                row.draftShiftType === '2nd Shift' ? 'active' : ''
                              }`}
                              onClick={() => handleApplyPreset(row.normalizedName, '2nd Shift')}
                              title="Set 2nd Shift (3 PM – 12 AM, 9h)"
                            >
                              🌙 2nd
                            </button>
                            <button
                              type="button"
                              className={`btn-shift-pill pill-split ${
                                row.draftShiftType === 'Split Shift' ? 'active' : ''
                              }`}
                              onClick={() => handleApplyPreset(row.normalizedName, 'Split Shift')}
                              title="Set Split Shift (2 PM – 10 PM, 8h)"
                            >
                              ⚡ Split
                            </button>
                            <button
                              type="button"
                              className="btn-shift-pill pill-custom"
                              onClick={() => setModalRider(row.riderName)}
                              title="Configure custom hours / split reporting window"
                            >
                              ✏️ Custom
                            </button>
                          </div>

                          {/* Hours and Compliance status */}
                          <div className="shift-timings-caption-row flex-row items-center justify-between gap-xs mt-xxs">
                            {row.draftShiftType !== 'UNASSIGNED' && row.draftTotalHours > 0 ? (
                              <>
                                <span className="shift-timings-text font-semibold text-xs">
                                  {formatShiftTimings({
                                    slot1StartHour: row.draftSlot1Start,
                                    slot1EndHour: row.draftSlot1End,
                                    slot2StartHour: row.draftSlot2Start,
                                    slot2EndHour: row.draftSlot2End,
                                  })}
                                </span>
                                <span
                                  className={isCompliant ? 'badge-compliance-ok text-xxs' : 'badge-compliance-warn text-xxs'}
                                  title={
                                    isCompliant
                                      ? `Planned for ${row.draftTotalHours}h (≥8h target satisfied)`
                                      : `Planned for ${row.draftTotalHours}h (<8h target deficit)`
                                  }
                                >
                                  {isCompliant ? `✓ ${row.draftTotalHours}h` : `⚠ ${row.draftTotalHours}h`}
                                </span>
                              </>
                            ) : (
                              <span className="text-warning text-xs font-semibold">
                                ⚠️ No shift assigned
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 3. Joining Date (Day 1) */}
                      <td className="td-joining-date text-center">
                        <input
                          type="date"
                          className="input-table-field input-date text-center"
                          value={row.draftJoiningDate}
                          onChange={(e) =>
                            handleUpdateField(row.normalizedName, {
                              draftJoiningDate: e.target.value,
                            })
                          }
                          title="Sets Day 1 joining date for onboarding tracker"
                        />
                      </td>

                      {/* 4. Onboarded By */}
                      <td className="td-onboarded-by text-center">
                        <select
                          className="input-table-field select-onboarder text-center"
                          value={row.draftOnboardedBy}
                          onChange={(e) =>
                            handleUpdateField(row.normalizedName, {
                              draftOnboardedBy: e.target.value,
                            })
                          }
                        >
                          <option value="">— Select —</option>
                          {ONBOARDED_BY_OPTIONS.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* 5. Referred By */}
                      <td className="td-referred-by text-center">
                        <input
                          type="text"
                          className="input-table-field input-referred text-center"
                          placeholder="Referrer name"
                          value={row.draftReferredBy}
                          onChange={(e) =>
                            handleUpdateField(row.normalizedName, {
                              draftReferredBy: e.target.value,
                            })
                          }
                        />
                      </td>

                      {/* 6. Referred Mobile No */}
                      <td className="td-referred-phone text-center">
                        <input
                          type="tel"
                          className="input-table-field input-phone text-center"
                          placeholder="10-digit mobile"
                          value={row.draftReferredPhone}
                          onChange={(e) =>
                            handleUpdateField(row.normalizedName, {
                              draftReferredPhone: e.target.value,
                            })
                          }
                        />
                      </td>

                      {/* 7. Action Button */}
                      <td className="td-action text-center">
                        <div className="action-buttons-cell flex-row items-center justify-center gap-xs">
                          {isJustSaved ? (
                            <span className="badge badge-success animate-fade-in" title="Saved to cloud">
                              ✓ Saved
                            </span>
                          ) : (
                            <button
                              type="button"
                              className={`btn btn-sm ${row.isModified ? 'btn-primary' : 'btn-secondary'}`}
                              onClick={() => handleSaveRow(row)}
                              disabled={isSavingThis}
                              title={row.isModified ? 'Save changes for this rider' : 'Record is up to date'}
                            >
                              {isSavingThis ? '...' : row.isModified ? '💾 Save' : '✓ Saved'}
                            </button>
                          )}

                          {row.draftShiftType !== 'UNASSIGNED' && (
                            <button
                              type="button"
                              className="btn-icon-subtle text-danger"
                              onClick={() => handleUnassignShift(row)}
                              disabled={isSavingThis}
                              title="Unassign shift"
                              aria-label={`Unassign shift for ${row.riderName}`}
                            >
                              🗑️
                            </button>
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

        {/* Table Caption Footer */}
        <div className="management-footer-caption flex-row items-center justify-between gap-md flex-wrap mt-md">
          <div className="caption-summary-pill">
            <span>
              Showing <strong>{filteredRows.length}</strong> of <strong>{totalRidersCount}</strong> riders for store{' '}
              <strong>{storeCode}</strong> ({storeName}).
            </span>
          </div>

          <div className="caption-summary-pill pill-compliance-summary">
            <span>
              Configured Shifts: <strong>{configuredShiftsCount}</strong> • Missing:{' '}
              <strong className={missingShiftsCount > 0 ? 'text-danger' : 'text-success'}>
                {missingShiftsCount}
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* Deep Individual Edit Modal */}
      {modalRider && (
        <IndividualRiderShiftModal
          isOpen={!!modalRider}
          onClose={() => setModalRider(null)}
          riderName={modalRider}
          storeId={storeId}
          storeCode={storeCode}
          storeName={storeName}
          phoneNumber={draftRows.get(normalizeRiderName(modalRider))?.phone}
          currentShift={draftRows.get(normalizeRiderName(modalRider))?.shiftConfig || null}
          onSave={async (config) => {
            const res = await onSaveSingleShift(config);
            if (res.ok) {
              setModalRider(null);
              onRefresh();
            }
            return res;
          }}
          onDelete={async (name) => {
            const res = await onDeleteSingleShift(name);
            if (res.ok) {
              setModalRider(null);
              onRefresh();
            }
            return res;
          }}
        />
      )}
    </div>
  );
};
