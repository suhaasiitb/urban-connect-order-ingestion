import React, { useCallback, useEffect, useState } from 'react';
import type { StoreMaster } from '../domain/types';
import type { UserProfile } from '../services/authService';
import {
  type RiderPerformancePivotResult,
  fetchRiderPerformanceAnalytics,
  getDateRangeForDays,
} from '../services/analyticsService';
import {
  type ActiveRosterSummary,
  getActiveRidersRoster,
  normalizeRiderName,
} from '../services/activeRiderService';
import {
  type RiderShiftConfig,
  getRiderShiftsForStore,
  saveRiderShiftsForStore,
} from '../services/riderShiftService';
import {
  type NewRiderOnboardingSummary,
  fetchNewRiderOnboardingAnalytics,
} from '../services/newRiderOnboardingService';
import { RiderPerformanceTable } from './RiderPerformanceTable';
import { NewRiderOnboardingSection } from './NewRiderOnboardingSection';
import { RiderShiftModal } from './RiderShiftModal';

interface AnalyticsSectionProps {
  stores: StoreMaster[];
  selectedStoreId: string;
  onSelectStoreId: (id: string) => void;
  currentUser?: UserProfile | null;
}

export const AnalyticsSection: React.FC<AnalyticsSectionProps> = ({
  stores,
  selectedStoreId,
  onSelectStoreId,
  currentUser,
}) => {
  const selectedStore = stores.find((s) => s.id === selectedStoreId) ?? stores[0];

  // Presets: 7, 10, 14, 20, 30 days
  const [selectedDays, setSelectedDays] = useState<number>(7);
  const initialRange = getDateRangeForDays(7, selectedStore?.timezone || 'Asia/Kolkata');
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);

  const [pivotResult, setPivotResult] = useState<RiderPerformancePivotResult>({
    storeId: selectedStore?.id ?? '',
    startDate: initialRange.startDate,
    endDate: initialRange.endDate,
    periodDays: 7,
    dateColumns: [],
    rows: [],
    totalRiders: 0,
    overallAvgHours: 0,
    overallAvgOrders: 0,
  });
  const [activeTab, setActiveTab] = useState<'all-riders' | 'new-riders'>('all-riders');
  const [tableShiftFilter, setTableShiftFilter] = useState<string>('ALL');
  const [loadingPivot, setLoadingPivot] = useState(false);
  const [pivotError, setPivotError] = useState<string | null>(null);
  const [activeRoster, setActiveRoster] = useState<ActiveRosterSummary | null>(null);
  const [riderShiftsMap, setRiderShiftsMap] = useState<Map<string, RiderShiftConfig>>(new Map());
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);

  // Compute number of riders with < 6 hrs average login time on active working days
  const under6hCount = React.useMemo(() => {
    return pivotResult.rows.filter((r) => r.activeAvgHours < 6.0).length;
  }, [pivotResult.rows]);

  const under6hPct = React.useMemo(() => {
    if (pivotResult.totalRiders === 0) return 0;
    return Math.round((under6hCount / pivotResult.totalRiders) * 100);
  }, [under6hCount, pivotResult.totalRiders]);

  // New Rider Onboarding State (Last 7 Days)
  const [onboardingCohortDays, setOnboardingCohortDays] = useState<number>(7);
  const [onboardingSummary, setOnboardingSummary] = useState<NewRiderOnboardingSummary | null>(null);
  const [loadingOnboarding, setLoadingOnboarding] = useState(false);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);

  // Load Active Riders Roster
  const loadRoster = useCallback(async () => {
    if (!selectedStore) return;
    try {
      const summary = await getActiveRidersRoster(selectedStore.id, selectedStore.store_code);
      setActiveRoster(summary);
    } catch (err) {
      console.warn('Could not load active riders roster in analytics:', err);
    }
  }, [selectedStore]);

  // Load Rider Shifts
  const loadShifts = useCallback(async () => {
    if (!selectedStore) return;
    try {
      const shifts = await getRiderShiftsForStore(selectedStore.id);
      setRiderShiftsMap(shifts);
    } catch (err) {
      console.warn('Could not load rider shifts in analytics:', err);
    }
  }, [selectedStore]);

  useEffect(() => {
    void loadRoster();
    void loadShifts();
  }, [loadRoster, loadShifts]);

  // Load Rider Performance Pivot
  const loadRiderPivot = useCallback(async () => {
    if (!selectedStore) return;
    setLoadingPivot(true);
    setPivotError(null);

    const res = await fetchRiderPerformanceAnalytics({
      storeId: selectedStore.id,
      startDate,
      endDate,
    });

    setLoadingPivot(false);
    if (res.error) {
      setPivotError(res.error);
    } else if (res.data) {
      setPivotResult(res.data);
    }
  }, [selectedStore, startDate, endDate]);

  useEffect(() => {
    void loadRiderPivot();
  }, [loadRiderPivot]);

  const handleSelectDaysPreset = (days: number) => {
    setSelectedDays(days);
    const range = getDateRangeForDays(days, selectedStore?.timezone || 'Asia/Kolkata');
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  };

  const handleCustomDateChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  };

  // Load New Rider Onboarding Analytics
  const loadOnboarding = useCallback(async () => {
    if (!selectedStore) return;
    setLoadingOnboarding(true);
    setOnboardingError(null);

    const res = await fetchNewRiderOnboardingAnalytics({
      storeId: selectedStore.id,
      storeCode: selectedStore.store_code,
      storeName: selectedStore.store_name,
      cohortWindowDays: onboardingCohortDays,
      timeZone: selectedStore.timezone || 'Asia/Kolkata',
      shiftsMap: riderShiftsMap,
      phoneByNameMap: activeRoster?.phoneByNameMap,
    });

    setLoadingOnboarding(false);
    if (res.error) {
      setOnboardingError(res.error);
    } else if (res.data) {
      setOnboardingSummary(res.data);
    }
  }, [selectedStore, onboardingCohortDays, riderShiftsMap, activeRoster]);

  // Load onboarding data when active tab is selected or parameters change
  useEffect(() => {
    if (activeTab === 'new-riders') {
      void loadOnboarding();
    }
  }, [activeTab, loadOnboarding]);

  // Handle inline updating of Joining Date override
  const handleUpdateJoiningDate = async (riderName: string, newDate: string) => {
    if (!selectedStore) return;
    const norm = normalizeRiderName(riderName);
    const existing = riderShiftsMap.get(norm) || {
      riderName,
      normalizedName: norm,
      shiftType: 'Morning Shift',
      slot1StartHour: 6,
      slot1EndHour: 14,
      slot2StartHour: null,
      slot2EndHour: null,
      totalPlannedHours: 8,
      joiningDate: newDate,
    };

    const updatedConfig = {
      ...existing,
      joiningDate: newDate,
    };

    const updatedMap = new Map(riderShiftsMap);
    updatedMap.set(norm, updatedConfig);
    setRiderShiftsMap(updatedMap);

    await saveRiderShiftsForStore({
      storeId: selectedStore.id,
      shifts: Array.from(updatedMap.values()),
    });

    void loadOnboarding();
  };

  return (
    <div className="analytics-container">
      {/* Header & Store Selector */}
      <div className="section-card">
        <div className="analytics-header">
          <div>
            <h2 className="section-title">Store & Rider Analytics</h2>
            <p className="section-subtitle">
              Comprehensive rider operations dashboard: daily hours, order volumes, shift compliance, and new joiner ramp-up.
            </p>
          </div>

          <div className="store-selector-group">
            <span className="field-label">Store:</span>
            {currentUser?.role === 'store_user' ? (
              <div className="store-badge-locked flex-row items-center gap-xs">
                <span className="badge badge-primary">{selectedStore?.store_code}</span>
                <strong>{selectedStore?.store_name}</strong>
              </div>
            ) : (
              <select
                id="analytics-store-select"
                className="select-input"
                value={selectedStoreId}
                onChange={(e) => onSelectStoreId(e.target.value)}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.store_code} — {s.store_name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Dedicated Tab Switcher: All Riders vs New Rider Onboarding */}
        <div className="analytics-view-switch-bar">
          <div className="analytics-tab-pill-group">
            <button
              type="button"
              className={`analytics-tab-pill ${activeTab === 'all-riders' ? 'active' : ''}`}
              onClick={() => setActiveTab('all-riders')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
              <span>All Riders Pivot Table</span>
            </button>

            <button
              type="button"
              className={`analytics-tab-pill ${activeTab === 'new-riders' ? 'active' : ''}`}
              onClick={() => setActiveTab('new-riders')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <line x1="20" y1="8" x2="20" y2="14" />
                <line x1="23" y1="11" x2="17" y2="11" />
              </svg>
              <span>New Rider Onboarding (First 7 Days)</span>
              {onboardingSummary && onboardingSummary.activeWeek1Count > 0 && (
                <span className="tab-live-badge">
                  {onboardingSummary.activeWeek1Count} Active
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* VIEW 1: All Riders Pivot Table View */}
      {activeTab === 'all-riders' && (
        <>
          {/* Top Quick KPI Metric Cards */}
          <div className="kpi-grid">
            <div
              className={`kpi-card ${tableShiftFilter !== 'ALL' ? 'kpi-card-interactive' : ''}`}
              onClick={() => {
                if (tableShiftFilter !== 'ALL') setTableShiftFilter('ALL');
              }}
              title={tableShiftFilter !== 'ALL' ? 'Click to show all working riders' : undefined}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="kpi-label">Active Working Riders</span>
                {tableShiftFilter !== 'ALL' && (
                  <span className="badge badge-secondary" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                    Show All
                  </span>
                )}
              </div>
              <strong className="kpi-value text-blue">
                {loadingPivot ? '...' : pivotResult.totalRiders}
              </strong>
              <span className="kpi-sub">In selected period ({selectedDays} days)</span>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">Store Avg Daily Hours</span>
              <strong className="kpi-value">
                {loadingPivot ? '...' : `${pivotResult.overallAvgHours} hrs`}
              </strong>
              <span className="kpi-sub">Per working rider / day</span>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">Store Avg Daily Orders</span>
              <strong className="kpi-value text-green">
                {loadingPivot ? '...' : `${pivotResult.overallAvgOrders} orders`}
              </strong>
              <span className="kpi-sub">Per working rider / day</span>
            </div>

            <div
              className={`kpi-card kpi-card-interactive ${tableShiftFilter === 'UNDER_6H' ? 'kpi-card-active' : ''}`}
              onClick={() => {
                setTableShiftFilter((prev) => (prev === 'UNDER_6H' ? 'ALL' : 'UNDER_6H'));
              }}
              title="Click to filter table to riders with < 6 hrs average login time"
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="kpi-label">Riders with &lt; 6h Login</span>
                {tableShiftFilter === 'UNDER_6H' && (
                  <span className="badge badge-warning" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                    Filtered
                  </span>
                )}
              </div>
              <strong className={`kpi-value ${under6hCount > 0 ? 'text-amber' : 'text-slate'}`}>
                {loadingPivot ? '...' : under6hCount}
              </strong>
              <span className="kpi-sub">
                {loadingPivot
                  ? 'Calculating...'
                  : `${under6hCount} of ${pivotResult.totalRiders} riders (${under6hPct}%) in selected period`}
              </span>
            </div>
          </div>

          {pivotError && (
            <div className="alert-box alert-box-warning" role="alert">
              <strong>Notice:</strong> {pivotError}
            </div>
          )}

          {/* Primary Rider Hours & Orders Pivot Section */}
          <div className="section-card perf-card">
            <div className="perf-section-header">
              <div>
                <h3 className="section-title">Rider Hours & Orders Pivot Table</h3>
                <p className="section-subtitle">
                  Daily working hours (unique slot count) and order volume per rider with working-day cumulative average.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-manage-shifts"
                onClick={() => setIsShiftModalOpen(true)}
                title="Configure recurring rider shifts and 8h timings"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>Manage Shifts</span>
              </button>
            </div>

            {selectedStore && (
              <RiderPerformanceTable
                data={pivotResult}
                storeCode={selectedStore.store_code}
                storeName={selectedStore.store_name}
                selectedDays={selectedDays}
                onSelectDaysPreset={handleSelectDaysPreset}
                startDate={startDate}
                endDate={endDate}
                onCustomDateChange={handleCustomDateChange}
                loading={loadingPivot}
                onRefresh={() => {
                  void loadRiderPivot();
                  void loadRoster();
                  void loadShifts();
                  void loadOnboarding();
                }}
                activeNamesSet={activeRoster?.activeNamesSet}
                phoneByNameMap={activeRoster?.phoneByNameMap}
                riderShiftsMap={riderShiftsMap}
                onOpenShiftModal={() => setIsShiftModalOpen(true)}
                rosterLastUpdated={activeRoster?.lastUpdatedFormatted}
                rosterTotalCount={activeRoster?.totalRiders}
                shiftFilter={tableShiftFilter}
                onSelectShiftFilter={setTableShiftFilter}
              />
            )}
          </div>
        </>
      )}

      {/* VIEW 2: New Rider Onboarding (First 7 Days) View */}
      {activeTab === 'new-riders' && (
        <div className="section-card perf-card onboarding-card">
          <NewRiderOnboardingSection
            summary={onboardingSummary}
            loading={loadingOnboarding}
            error={onboardingError}
            onRefresh={() => {
              void loadOnboarding();
              void loadShifts();
              void loadRoster();
            }}
            cohortDays={onboardingCohortDays}
            onSelectCohortDays={setOnboardingCohortDays}
            onOpenShiftModal={() => setIsShiftModalOpen(true)}
            onUpdateJoiningDate={handleUpdateJoiningDate}
          />
        </div>
      )}

      {/* Rider Shifts & Timings Modal */}
      {selectedStore && (
        <RiderShiftModal
          isOpen={isShiftModalOpen}
          onClose={() => setIsShiftModalOpen(false)}
          storeId={selectedStore.id}
          storeCode={selectedStore.store_code}
          storeName={selectedStore.store_name}
          activeRidersList={activeRoster?.riders ?? []}
          existingShiftsMap={riderShiftsMap}
          onSaved={() => {
            void loadShifts();
          }}
        />
      )}
    </div>
  );
};
