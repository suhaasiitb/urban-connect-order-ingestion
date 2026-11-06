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
  saveSingleRiderShift,
  deleteSingleRiderShift,
  subscribeToStoreRiderShifts,
} from '../services/riderShiftService';
import {
  type StoreDnrSummary,
  getDnrSummaryForStore,
  fetchDnrSummaryForStore,
} from '../services/dnrService';
import {
  type NewRiderOnboardingSummary,
  fetchNewRiderOnboardingAnalytics,
} from '../services/newRiderOnboardingService';
import { RiderPerformanceTable } from './RiderPerformanceTable';
import { RiderManagementSection } from './RiderManagementSection';
import { NewRiderOnboardingSection } from './NewRiderOnboardingSection';
import { RiderShiftModal } from './RiderShiftModal';

export interface AnalyticsSectionProps {
  stores: StoreMaster[];
  selectedStoreId: string;
  onSelectStoreId: (id: string) => void;
  currentUser?: UserProfile | null;
  activeTab?: 'performance' | 'management' | 'new-riders';
  onChangeTab?: (tab: 'performance' | 'management' | 'new-riders') => void;
}

export const AnalyticsSection: React.FC<AnalyticsSectionProps> = ({
  stores,
  selectedStoreId,
  onSelectStoreId,
  currentUser,
  activeTab: controlledTab,
  onChangeTab,
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
  const [internalActiveTab, setInternalActiveTab] = useState<'performance' | 'management' | 'new-riders'>('performance');
  const activeTab = controlledTab ?? internalActiveTab;
  const setActiveTab = (tab: 'performance' | 'management' | 'new-riders') => {
    setInternalActiveTab(tab);
    onChangeTab?.(tab);
  };
  const [tableShiftFilter, setTableShiftFilter] = useState<string>('ALL');
  const [shiftModalFilter, setShiftModalFilter] = useState<string | undefined>(undefined);
  const [shiftModalSearchQuery, setShiftModalSearchQuery] = useState<string | undefined>(undefined);

  const handleOpenShiftModal = (targetRider?: string, initialFilter?: string) => {
    setShiftModalSearchQuery(targetRider);
    setShiftModalFilter(initialFilter);
    setIsShiftModalOpen(true);
  };
  const [loadingPivot, setLoadingPivot] = useState(false);
  const [pivotError, setPivotError] = useState<string | null>(null);
  const [activeRoster, setActiveRoster] = useState<ActiveRosterSummary | null>(null);
  const [riderShiftsMap, setRiderShiftsMap] = useState<Map<string, RiderShiftConfig>>(new Map());
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [dnrSummary, setDnrSummary] = useState<StoreDnrSummary | null>(null);

  // Compute number of riders with < 6 hrs average login time on active working days
  const under6hCount = React.useMemo(() => {
    return pivotResult.rows.filter((r) => r.activeAvgHours < 6.0).length;
  }, [pivotResult.rows]);

  const under6hPct = React.useMemo(() => {
    if (pivotResult.totalRiders === 0) return 0;
    return Math.round((under6hCount / pivotResult.totalRiders) * 100);
  }, [under6hCount, pivotResult.totalRiders]);

  const activeWithoutShiftCount = React.useMemo(() => {
    if (!activeRoster?.activeNamesSet) return 0;
    let count = 0;
    for (const norm of activeRoster.activeNamesSet) {
      if (!riderShiftsMap?.has(norm)) {
        count++;
      }
    }
    return count;
  }, [activeRoster, riderShiftsMap]);

  // New Rider Onboarding State (Last 7 Days)
  const [onboardingCohortDays, setOnboardingCohortDays] = useState<number>(7);
  const [onboardingStartDate, setOnboardingStartDate] = useState<string>('');
  const [onboardingEndDate, setOnboardingEndDate] = useState<string>('');
  const [isOnboardingCustomRange, setIsOnboardingCustomRange] = useState<boolean>(false);
  const [onboardingSummary, setOnboardingSummary] = useState<NewRiderOnboardingSummary | null>(null);
  const [loadingOnboarding, setLoadingOnboarding] = useState(false);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);

  const handleSelectOnboardingCohortDays = (days: number) => {
    setOnboardingCohortDays(days);
    setIsOnboardingCustomRange(false);
  };

  const handleSelectOnboardingDateRange = (start: string, end: string) => {
    setIsOnboardingCustomRange(true);
    setOnboardingStartDate(start);
    setOnboardingEndDate(end);
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    const diff = Math.max(1, Math.round((e - s) / 86400000) + 1);
    setOnboardingCohortDays(diff);
  };

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

  // Load DNR Summary for store
  const loadDnr = useCallback(async () => {
    if (!selectedStore) return;
    try {
      // 1. Instant local display
      setDnrSummary(getDnrSummaryForStore(selectedStore.store_code));
      // 2. Background sync with Supabase PostgreSQL
      const remote = await fetchDnrSummaryForStore(selectedStore.store_code);
      setDnrSummary(remote);
    } catch (err) {
      console.warn('Could not load DNR summary in analytics:', err);
    }
  }, [selectedStore]);

  useEffect(() => {
    void loadRoster();
    void loadShifts();
    void loadDnr();
  }, [loadRoster, loadShifts, loadDnr]);

  // Subscribe to live cross-device and cross-tab updates for store_rider_shifts
  useEffect(() => {
    if (!selectedStore?.id) return;
    const unsubscribe = subscribeToStoreRiderShifts(selectedStore.id, (freshShifts) => {
      setRiderShiftsMap(freshShifts);
    });
    return () => {
      unsubscribe();
    };
  }, [selectedStore?.id]);

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
      startDate: isOnboardingCustomRange ? onboardingStartDate : undefined,
      endDate: isOnboardingCustomRange ? onboardingEndDate : undefined,
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
  }, [
    selectedStore,
    onboardingCohortDays,
    isOnboardingCustomRange,
    onboardingStartDate,
    onboardingEndDate,
    riderShiftsMap,
    activeRoster,
  ]);

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
      slot1EndHour: 15,
      slot2StartHour: null,
      slot2EndHour: null,
      totalPlannedHours: 9,
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

  // Handle inline saving of single rider shift from pivot table or management table
  const handleSaveSingleShift = useCallback(
    async (shift: RiderShiftConfig) => {
      if (!selectedStore) return { ok: false, error: 'No store selected' };
      const norm = shift.normalizedName || normalizeRiderName(shift.riderName);
      const updatedConfig: RiderShiftConfig = {
        ...shift,
        normalizedName: norm,
      };
      setRiderShiftsMap((prev) => {
        const next = new Map(prev);
        next.set(norm, updatedConfig);
        return next;
      });

      const res = await saveSingleRiderShift({
        storeId: selectedStore.id,
        shift: updatedConfig,
      });
      return res;
    },
    [selectedStore]
  );

  // Handle inline deleting/unassigning of single rider shift from pivot table
  const handleDeleteSingleShift = useCallback(
    async (riderName: string) => {
      if (!selectedStore) return { ok: false, error: 'No store selected' };
      const norm = normalizeRiderName(riderName);
      setRiderShiftsMap((prev) => {
        const next = new Map(prev);
        next.delete(norm);
        return next;
      });

      const res = await deleteSingleRiderShift({
        storeId: selectedStore.id,
        riderName,
      });
      return res;
    },
    [selectedStore]
  );

  return (
    <div className="analytics-container">
      {/* Tab Switcher & Store Selector */}
      <div className="section-card">
        <div className="flex-row items-center justify-between gap-md flex-wrap">
          <div className="analytics-tab-pill-group">
            <button
              type="button"
              className={`analytics-tab-pill ${activeTab === 'performance' ? 'active' : ''}`}
              onClick={() => setActiveTab('performance')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
              <span>Rider Performance</span>
            </button>

            <button
              type="button"
              className={`analytics-tab-pill ${activeTab === 'management' ? 'active' : ''}`}
              onClick={() => setActiveTab('management')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>Rider Management</span>
              {activeWithoutShiftCount > 0 && (
                <span className="tab-live-badge tab-live-badge-warn">
                  {activeWithoutShiftCount} Missing Shift
                </span>
              )}
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
      </div>

      {/* VIEW 1: Rider Performance Table View */}
      {activeTab === 'performance' && (
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
              <div className="kpi-header-row">
                <span className="kpi-label">Active Working Riders</span>
                {tableShiftFilter !== 'ALL' ? (
                  <span className="badge badge-secondary" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                    Show All
                  </span>
                ) : (
                  <span className="basedash-live-indicator">
                    <span className="basedash-live-dot" aria-hidden="true" />
                    <span>Live</span>
                  </span>
                )}
              </div>
              <strong className="kpi-value text-blue">
                {loadingPivot ? '...' : pivotResult.totalRiders}
              </strong>
              <span className="kpi-sub">
                In selected period ({selectedDays} {selectedDays === 1 ? 'day' : 'days'})
              </span>
            </div>

            <div className="kpi-card">
              <div className="kpi-header-row">
                <span className="kpi-label">Store Avg Daily Hours</span>
                <span className="kpi-target-badge">Target: ≥ 8 hrs</span>
              </div>
              <strong
                className={`kpi-value ${
                  !loadingPivot && (pivotResult.overallAvgHours ?? 0) < 8 ? 'text-red' : 'text-green'
                }`}
              >
                {loadingPivot ? '...' : `${pivotResult.overallAvgHours} hrs`}
              </strong>
              <span className="kpi-sub">Per working rider / day</span>
            </div>

            <div className="kpi-card">
              <div className="kpi-header-row">
                <span className="kpi-label">Store Avg Daily Orders</span>
                <span className="kpi-target-badge">Target: ≥ 16 orders</span>
              </div>
              <strong
                className={`kpi-value ${
                  !loadingPivot && (pivotResult.overallAvgOrders ?? 0) < 16 ? 'text-red' : 'text-green'
                }`}
              >
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
              <div className="kpi-header-row">
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

            {/* Active Without Shift KPI Card */}
            <div
              className={`kpi-card kpi-card-interactive ${tableShiftFilter === 'ACTIVE_NO_SHIFT' ? 'kpi-card-active' : ''}`}
              onClick={() => {
                setTableShiftFilter((prev) => (prev === 'ACTIVE_NO_SHIFT' ? 'ALL' : 'ACTIVE_NO_SHIFT'));
              }}
              title="Click to filter table to active riders whose shift is empty"
            >
              <div className="kpi-header-row">
                <span className="kpi-label">Active Without Shift</span>
                {tableShiftFilter === 'ACTIVE_NO_SHIFT' ? (
                  <span className="badge badge-warning" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                    Filtered
                  </span>
                ) : activeWithoutShiftCount > 0 ? (
                  <span className="badge badge-danger" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                    Action Required
                  </span>
                ) : (
                  <span className="badge badge-success" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                    Complete
                  </span>
                )}
              </div>
              <strong className={`kpi-value ${activeWithoutShiftCount > 0 ? 'text-amber' : 'text-slate'}`}>
                {activeWithoutShiftCount}
              </strong>
              <span className="kpi-sub">
                {activeWithoutShiftCount > 0
                  ? `${activeWithoutShiftCount} active riders need shift assigned`
                  : 'All active riders have shifts set'}
              </span>
            </div>
          </div>

          {pivotError && (
            <div className="alert-box alert-box-warning" role="alert">
              <strong>Notice:</strong> {pivotError}
            </div>
          )}

          {/* Primary Rider Performance Section */}
          <div className="section-card perf-card">
            <div className="perf-section-header perf-section-header-row">
              <div>
                <h3 className="section-title editorial-serif-heading">Rider Performance</h3>
                <p className="section-subtitle">
                  Daily working hours (unique slot count), one-way LM distance, and order volume per rider with working-day cumulative average.
                </p>
              </div>
              {selectedStore && (
                <div className="basedash-pill-badge">
                  <span className="basedash-live-dot" aria-hidden="true" />
                  <span>{selectedStore.store_code} • {startDate} → {endDate}</span>
                </div>
              )}
            </div>

            {selectedStore && (
              <RiderPerformanceTable
                data={pivotResult}
                storeCode={selectedStore.store_code}
                storeName={selectedStore.store_name}
                storeId={selectedStore.id}
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
                  void loadDnr();
                  void loadOnboarding();
                }}
                activeNamesSet={activeRoster?.activeNamesSet}
                phoneByNameMap={activeRoster?.phoneByNameMap}
                riderShiftsMap={riderShiftsMap}
                dnrSummary={dnrSummary}
                onOpenShiftModal={handleOpenShiftModal}
                onSaveSingleShift={handleSaveSingleShift}
                onDeleteSingleShift={handleDeleteSingleShift}
                rosterLastUpdated={activeRoster?.lastUpdatedFormatted}
                rosterTotalCount={activeRoster?.totalRiders}
                shiftFilter={tableShiftFilter}
                onSelectShiftFilter={setTableShiftFilter}
              />
            )}
          </div>
        </>
      )}

      {/* VIEW 2: Rider Management View */}
      {activeTab === 'management' && selectedStore && (
        <RiderManagementSection
          storeId={selectedStore.id}
          storeCode={selectedStore.store_code}
          storeName={selectedStore.store_name}
          activeRoster={activeRoster}
          riderShiftsMap={riderShiftsMap}
          pivotRiderNames={pivotResult.rows.map((r) => r.riderName)}
          loading={loadingPivot}
          onRefresh={() => {
            void loadRiderPivot();
            void loadRoster();
            void loadShifts();
            void loadDnr();
            void loadOnboarding();
          }}
          onSaveSingleShift={handleSaveSingleShift}
          onSaveBatchShifts={async (shifts) => {
            setRiderShiftsMap((prev) => {
              const next = new Map(prev);
              for (const s of shifts) {
                const norm = s.normalizedName || normalizeRiderName(s.riderName);
                if (norm) next.set(norm, { ...s, normalizedName: norm });
              }
              return next;
            });
            const res = await saveRiderShiftsForStore({
              storeId: selectedStore.id,
              shifts,
            });
            if (res.ok) {
              void loadShifts();
            }
            return res;
          }}
          onDeleteSingleShift={handleDeleteSingleShift}
        />
      )}

      {/* VIEW 3: New Rider Onboarding (First 7 Days) View */}
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
            onSelectCohortDays={handleSelectOnboardingCohortDays}
            startDate={isOnboardingCustomRange ? onboardingStartDate : undefined}
            endDate={isOnboardingCustomRange ? onboardingEndDate : undefined}
            onSelectDateRange={handleSelectOnboardingDateRange}
            onOpenShiftModal={() => handleOpenShiftModal()}
            onUpdateJoiningDate={handleUpdateJoiningDate}
          />
        </div>
      )}

      {/* Rider Shifts & Timings Modal */}
      {selectedStore && (
        <RiderShiftModal
          isOpen={isShiftModalOpen}
          onClose={() => {
            setIsShiftModalOpen(false);
            setShiftModalFilter(undefined);
            setShiftModalSearchQuery(undefined);
          }}
          storeId={selectedStore.id}
          storeCode={selectedStore.store_code}
          storeName={selectedStore.store_name}
          activeRidersList={activeRoster?.riders ?? []}
          existingShiftsMap={riderShiftsMap}
          initialFilter={shiftModalFilter}
          initialSearchQuery={shiftModalSearchQuery}
          onSaved={() => {
            void loadShifts();
          }}
        />
      )}
    </div>
  );
};
