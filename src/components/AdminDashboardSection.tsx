import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StoreMaster } from '../domain/types';
import {
  formatDateToHeader,
  getTodayDateString,
  shiftIsoDate,
} from '../services/analyticsService';
import { getDefaultStoreDph } from '../services/planningService';
import {
  type S2POtpSummaryResult,
  fetchS2POtpAnalytics,
} from '../services/s2pOtpService';
import {
  createSnapshotEnvironment,
  formatCapturedTimestamp,
  renderAndDownloadSnapshot,
} from '../utils/snapshotExport';
import { S2PKpiCardsGrid } from './S2PKpiCardsGrid';
import { SnapshotButton, type SnapshotStatus } from './SnapshotButton';

interface AdminDashboardSectionProps {
  stores: StoreMaster[];
  onOpenStoreS2POtp: (storeId: string) => void;
}

interface StoreDayState {
  summary: S2POtpSummaryResult | null;
  loadedForDate: string | null;
  loading: boolean;
  error: string | null;
}

const PREFERRED_STORE_ORDER = ['TMK7', 'TPH1', 'TPE2', 'TPI4'];

export const AdminDashboardSection: React.FC<AdminDashboardSectionProps> = ({
  stores,
  onOpenStoreS2POtp,
}) => {
  const orderedStores = useMemo(() => {
    return [...stores].sort((a, b) => {
      const idxA = PREFERRED_STORE_ORDER.indexOf(a.store_code);
      const idxB = PREFERRED_STORE_ORDER.indexOf(b.store_code);
      const rankA = idxA === -1 ? Number.MAX_SAFE_INTEGER : idxA;
      const rankB = idxB === -1 ? Number.MAX_SAFE_INTEGER : idxB;
      if (rankA !== rankB) return rankA - rankB;
      return a.store_code.localeCompare(b.store_code);
    });
  }, [stores]);

  const primaryTimeZone = orderedStores[0]?.timezone || 'Asia/Kolkata';
  const primaryTodayStr = getTodayDateString(primaryTimeZone);
  const yesterdayStr = shiftIsoDate(primaryTodayStr, -1);

  const [selectedDate, setSelectedDate] = useState<string>(() =>
    getTodayDateString(orderedStores[0]?.timezone || 'Asia/Kolkata')
  );
  const [storeStates, setStoreStates] = useState<Record<string, StoreDayState>>({});
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [takingScreenshot, setTakingScreenshot] = useState<boolean>(false);
  const [screenshotStatus, setScreenshotStatus] = useState<SnapshotStatus>('idle');
  const latestRequestIdRef = useRef<number>(0);
  const dashboardContainerRef = useRef<HTMLDivElement | null>(null);

  const isViewingToday = selectedDate === primaryTodayStr;
  const isViewingYesterday = selectedDate === yesterdayStr;

  const handleSelectDate = useCallback((nextDate: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) return;
    setSelectedDate(nextDate);
  }, []);

  const loadAllStoresForDate = useCallback(
    async (targetDate: string, forceRefresh = false) => {
      if (orderedStores.length === 0) return;

      const requestId = ++latestRequestIdRef.current;
      setRefreshing(true);

      setStoreStates((prev) => {
        const next: Record<string, StoreDayState> = {};
        for (const store of orderedStores) {
          const prevState = prev[store.id];
          const sameDate = prevState?.loadedForDate === targetDate;
          next[store.id] = {
            summary: sameDate ? prevState.summary : null,
            loadedForDate: sameDate ? prevState.loadedForDate : null,
            loading: true,
            error: null,
          };
        }
        return next;
      });

      const usePerStoreToday = targetDate === primaryTodayStr;
      const results = await Promise.all(
        orderedStores.map(async (store) => {
          const storeDate = usePerStoreToday
            ? getTodayDateString(store.timezone || 'Asia/Kolkata')
            : targetDate;
          const res = await fetchS2POtpAnalytics({
            storeId: store.id,
            startDate: storeDate,
            endDate: storeDate,
            forceRefresh,
          });
          return { storeId: store.id, res };
        })
      );

      if (requestId !== latestRequestIdRef.current) return;

      const nextStates: Record<string, StoreDayState> = {};
      for (const { storeId, res } of results) {
        nextStates[storeId] = {
          summary: res.data,
          loadedForDate: targetDate,
          loading: false,
          error: res.error ?? null,
        };
      }
      setStoreStates(nextStates);
      setLastUpdatedAt(
        new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
      setRefreshing(false);
    },
    [orderedStores, primaryTodayStr]
  );

  useEffect(() => {
    void loadAllStoresForDate(selectedDate, false);
  }, [loadAllStoresForDate, selectedDate]);

  const isAnyStoreLoading = useMemo(() => {
    if (orderedStores.length === 0) return false;
    return orderedStores.some((s) => storeStates[s.id]?.loading ?? true);
  }, [orderedStores, storeStates]);

  const combinedSummary = useMemo<S2POtpSummaryResult>(() => {
    const activeSummaries = orderedStores
      .map((s) => {
        const st = storeStates[s.id];
        if (!st || st.loadedForDate !== selectedDate) return null;
        return st.summary;
      })
      .filter((sum): sum is S2POtpSummaryResult => Boolean(sum && sum.overallTotalOrders > 0));

    const count = activeSummaries.length;
    const avg = (getter: (s: S2POtpSummaryResult) => number): number =>
      count > 0 ? activeSummaries.reduce((acc, s) => acc + getter(s), 0) / count : 0;

    const totalOrders = activeSummaries.reduce((acc, s) => acc + s.overallTotalOrders, 0);
    const totalRiders = activeSummaries.reduce((acc, s) => acc + s.overallDistinctRiders, 0);
    const totalCompleted = activeSummaries.reduce((acc, s) => acc + s.overallCompletedOrders, 0);
    const totalDsrEligible = activeSummaries.reduce((acc, s) => acc + s.overallDsrEligibleOrders, 0);
    const avgOtp = avg((s) => s.overallOtpAchievedPct);

    return {
      storeId: 'ALL_STORES',
      startDate: selectedDate,
      endDate: selectedDate,
      periodDays: 1,
      days: [],
      overallTotalOrders: totalOrders,
      overallDistinctRiders: totalRiders,
      overallTotalRiderSlotHours: 0,
      overallAvgDph: Math.round(avg((s) => s.overallAvgDph) * 10) / 10,
      overallAvgS2p: Math.round(avg((s) => s.overallAvgS2p) * 100) / 100,
      overallOtpAchievedPct: Math.round(avgOtp * 100) / 100,
      overallOtpBreachedPct: count > 0 ? Math.round((100 - avgOtp) * 100) / 100 : 0,
      overallCompletedOrders: totalCompleted,
      overallDsrEligibleOrders: totalDsrEligible,
      overallDsrPct: Math.round(avg((s) => s.overallDsrPct) * 100) / 100,
    };
  }, [orderedStores, storeStates, selectedDate]);

  const handleTakeScreenshot = async () => {
    const dashboardRoot = dashboardContainerRef.current;
    if (!dashboardRoot || orderedStores.length === 0 || isAnyStoreLoading || refreshing || takingScreenshot) {
      return;
    }

    setTakingScreenshot(true);
    setScreenshotStatus('idle');

    const minWidth = Math.max(1360, dashboardRoot.scrollWidth || 1360);
    const { offscreenHost, captureTarget, bgColor, subTextColor } = createSnapshotEnvironment(
      minWidth,
      'analytics-container admin-dashboard-container'
    );
    captureTarget.style.gap = '0.75rem';

    try {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      for (const child of Array.from(dashboardRoot.children)) {
        if (!(child instanceof HTMLElement)) continue;
        if (child.contains(offscreenHost) || child.dataset.screenshotRoot === 'true') continue;

        const cloned = child.cloneNode(true) as HTMLElement;
        cloned.querySelectorAll('[data-snapshot-exclude="true"]').forEach((el) => el.remove());

        if (cloned.classList.contains('admin-dashboard-header-card')) {
          const topHeaderRow = cloned.querySelector(':scope > div:first-child') as HTMLElement | null;
          if (topHeaderRow) {
            const stampEl = document.createElement('span');
            stampEl.textContent = formatCapturedTimestamp(primaryTimeZone);
            stampEl.style.fontSize = '11px';
            stampEl.style.color = subTextColor;
            stampEl.style.whiteSpace = 'nowrap';
            topHeaderRow.appendChild(stampEl);
          }
        }

        captureTarget.appendChild(cloned);
      }

      await renderAndDownloadSnapshot({
        rootContainer: dashboardRoot,
        offscreenHost,
        captureTarget,
        bgColor,
        minWidth,
        fileName: `Executive-Dashboard-All-Stores-${selectedDate}.png`,
      });

      setScreenshotStatus('saved');
      window.setTimeout(() => setScreenshotStatus('idle'), 2200);
    } catch (err) {
      console.error('Failed to capture Executive Dashboard screenshot:', err);
      setScreenshotStatus('error');
      window.setTimeout(() => setScreenshotStatus('idle'), 3000);
    } finally {
      offscreenHost.remove();
      setTakingScreenshot(false);
    }
  };

  const formattedSelectedDate = formatDateToHeader(selectedDate);

  return (
    <div ref={dashboardContainerRef} className="analytics-container admin-dashboard-container">
      <div className="section-card admin-dashboard-header-card">
        <div className="flex-row items-center justify-between flex-wrap gap-sm">
          <div>
            <div className="flex-row items-center gap-xs flex-wrap">
              <span className="admin-summary-pill">All-Store Summary</span>
              <h2 className="section-title editorial-serif-heading" style={{ margin: 0 }}>
                Executive Dashboard — All Stores ({isViewingToday ? 'Today' : formattedSelectedDate})
              </h2>
            </div>
            <p className="section-subtitle">
              Average metrics &amp; combined volume across {orderedStores.map((s) => s.store_code).join(', ')} ·{' '}
              {formattedSelectedDate} ({selectedDate})
              {lastUpdatedAt ? ` · Updated ${lastUpdatedAt}` : ''}
            </p>
          </div>
          <div className="flex-row items-center gap-sm flex-wrap" data-snapshot-exclude="true">
            <div className="admin-date-controls">
              <div className="segmented-control" role="group" aria-label="Quick date selection">
                <button
                  type="button"
                  className={`segmented-btn ${isViewingToday ? 'segmented-btn-active' : ''}`}
                  onClick={() => handleSelectDate(primaryTodayStr)}
                  disabled={refreshing}
                  title={`View today's metrics (${primaryTodayStr})`}
                >
                  Today
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${isViewingYesterday ? 'segmented-btn-active' : ''}`}
                  onClick={() => handleSelectDate(yesterdayStr)}
                  disabled={refreshing}
                  title={`View yesterday's metrics (${yesterdayStr})`}
                >
                  Yesterday
                </button>
              </div>
              <div className="admin-date-stepper">
                <button
                  type="button"
                  className="btn-date-step"
                  onClick={() => handleSelectDate(shiftIsoDate(selectedDate, -1))}
                  disabled={refreshing}
                  title="Previous day"
                  aria-label="Previous day"
                >
                  ‹
                </button>
                <input
                  id="admin-dashboard-date-input"
                  type="date"
                  className="custom-range-date-input admin-date-input"
                  value={selectedDate}
                  max={primaryTodayStr}
                  onChange={(e) => handleSelectDate(e.target.value)}
                  disabled={refreshing}
                  aria-label="Select date for Executive Dashboard"
                  title="Pick any date to view all-store metrics"
                />
                <button
                  type="button"
                  className="btn-date-step"
                  onClick={() => handleSelectDate(shiftIsoDate(selectedDate, 1))}
                  disabled={refreshing || selectedDate >= primaryTodayStr}
                  title="Next day"
                  aria-label="Next day"
                >
                  ›
                </button>
              </div>
            </div>

            <SnapshotButton
              icon="camera"
              loading={takingScreenshot}
              status={screenshotStatus}
              disabled={orderedStores.length === 0 || isAnyStoreLoading || refreshing}
              onClick={() => void handleTakeScreenshot()}
              title="Capture and download the All-Store Summary and Individual Store Breakdown together in one PNG snapshot"
              labels={{
                idle: 'Take Screenshot',
                loading: 'Capturing...',
                saved: 'Screenshot Saved',
                error: 'Screenshot Failed',
              }}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void loadAllStoresForDate(selectedDate, true)}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing...' : '↻ Refresh All'}
            </button>
          </div>
        </div>

        <S2PKpiCardsGrid
          summary={combinedSummary}
          loading={isAnyStoreLoading}
          className="kpi-grid mt-sm"
          compact
        />
      </div>

      {orderedStores.length > 0 && (
        <div className="admin-stores-divider">
          <span>Individual Store Breakdown ({orderedStores.length} Stores)</span>
        </div>
      )}

      {orderedStores.length === 0 && (
        <div className="section-card mt-sm">
          <p className="subtitle">No active stores found.</p>
        </div>
      )}

      {orderedStores.map((store) => {
        const state = storeStates[store.id];
        const summary = state?.summary ?? null;
        const isLoading = state?.loading ?? true;
        const hasOrders = (summary?.overallTotalOrders ?? 0) > 0;

        return (
          <section key={store.id} className="section-card perf-card admin-dashboard-store-card">
            <div className="flex-row items-center justify-between flex-wrap gap-sm">
              <div className="flex-row items-center gap-sm flex-wrap">
                <span className="badge badge-info">{store.store_code}</span>
                <h3 className="section-title editorial-serif-heading" style={{ margin: 0, fontSize: '1.05rem' }}>
                  {store.store_name.replace(/\s*\([^)]*\)/g, '').trim() || store.store_name}
                </h3>
                {!isLoading && (
                  <span
                    className={`badge ${hasOrders ? 'badge-success' : 'badge-neutral'}`}
                  >
                    {hasOrders
                      ? `${isViewingToday ? 'Live Today' : formattedSelectedDate} · ${summary?.overallTotalOrders.toLocaleString()} orders`
                      : isViewingToday
                      ? 'No orders uploaded today'
                      : `No orders for ${formattedSelectedDate}`}
                  </span>
                )}
              </div>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-snapshot-exclude="true"
                onClick={() => onOpenStoreS2POtp(store.id)}
              >
                View Store S2P &amp; OTP →
              </button>
            </div>

            {state?.error && (
              <div className="alert alert-error mt-sm" role="alert">
                <strong>{store.store_code} Error:</strong> {state.error}
              </div>
            )}

            <S2PKpiCardsGrid
              summary={summary}
              loading={isLoading}
              className="kpi-grid"
              compact
              dphTarget={getDefaultStoreDph(store.store_code)}
            />
          </section>
        );
      })}
    </div>
  );
};
