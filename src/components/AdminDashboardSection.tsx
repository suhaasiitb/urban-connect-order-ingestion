import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StoreMaster } from '../domain/types';
import { formatDateToHeader, getTodayDateString } from '../services/analyticsService';
import { getDefaultStoreDph } from '../services/planningService';
import {
  type S2POtpSummaryResult,
  fetchS2POtpAnalytics,
} from '../services/s2pOtpService';
import { S2PKpiCardsGrid } from './S2PKpiCardsGrid';

interface AdminDashboardSectionProps {
  stores: StoreMaster[];
  onOpenStoreS2POtp: (storeId: string) => void;
}

interface StoreTodayState {
  summary: S2POtpSummaryResult | null;
  loading: boolean;
  error: string | null;
}

const PREFERRED_STORE_ORDER = ['TMK7', 'TPH1', 'TPE2'];
const EXCLUDED_DASHBOARD_STORES = new Set(['TPI4']);

export const AdminDashboardSection: React.FC<AdminDashboardSectionProps> = ({
  stores,
  onOpenStoreS2POtp,
}) => {
  const orderedStores = useMemo(() => {
    return [...stores]
      .filter((s) => !EXCLUDED_DASHBOARD_STORES.has(s.store_code.toUpperCase()))
      .sort((a, b) => {
        const idxA = PREFERRED_STORE_ORDER.indexOf(a.store_code);
        const idxB = PREFERRED_STORE_ORDER.indexOf(b.store_code);
        const rankA = idxA === -1 ? Number.MAX_SAFE_INTEGER : idxA;
        const rankB = idxB === -1 ? Number.MAX_SAFE_INTEGER : idxB;
        if (rankA !== rankB) return rankA - rankB;
        return a.store_code.localeCompare(b.store_code);
      });
  }, [stores]);

  const [storeStates, setStoreStates] = useState<Record<string, StoreTodayState>>({});
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const latestRequestIdRef = useRef<number>(0);

  const primaryTodayStr = getTodayDateString(orderedStores[0]?.timezone || 'Asia/Kolkata');

  const loadAllStoresToday = useCallback(
    async (forceRefresh = false) => {
      if (orderedStores.length === 0) return;

      const requestId = ++latestRequestIdRef.current;
      setRefreshing(true);

      setStoreStates((prev) => {
        const next: Record<string, StoreTodayState> = {};
        for (const store of orderedStores) {
          next[store.id] = {
            summary: prev[store.id]?.summary ?? null,
            loading: true,
            error: null,
          };
        }
        return next;
      });

      const results = await Promise.all(
        orderedStores.map(async (store) => {
          const storeToday = getTodayDateString(store.timezone || 'Asia/Kolkata');
          const res = await fetchS2POtpAnalytics({
            storeId: store.id,
            startDate: storeToday,
            endDate: storeToday,
            forceRefresh,
          });
          return { storeId: store.id, res };
        })
      );

      if (requestId !== latestRequestIdRef.current) return;

      const nextStates: Record<string, StoreTodayState> = {};
      for (const { storeId, res } of results) {
        nextStates[storeId] = {
          summary: res.data,
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
    [orderedStores]
  );

  useEffect(() => {
    void loadAllStoresToday(false);
  }, [loadAllStoresToday]);

  const isAnyStoreLoading = useMemo(() => {
    if (orderedStores.length === 0) return false;
    return orderedStores.some((s) => storeStates[s.id]?.loading ?? true);
  }, [orderedStores, storeStates]);

  const combinedSummary = useMemo<S2POtpSummaryResult>(() => {
    const activeSummaries = orderedStores
      .map((s) => storeStates[s.id]?.summary)
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
      startDate: primaryTodayStr,
      endDate: primaryTodayStr,
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
  }, [orderedStores, storeStates, primaryTodayStr]);

  return (
    <div className="analytics-container admin-dashboard-container">
      <div className="section-card admin-dashboard-header-card">
        <div className="flex-row items-center justify-between flex-wrap gap-sm">
          <div>
            <h2 className="section-title editorial-serif-heading">
              Executive Dashboard — All Stores (Today)
            </h2>
            <p className="section-subtitle">
              Average metrics &amp; combined volume across {orderedStores.map((s) => s.store_code).join(', ')} ·{' '}
              {formatDateToHeader(primaryTodayStr)} ({primaryTodayStr})
              {lastUpdatedAt ? ` · Updated ${lastUpdatedAt}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void loadAllStoresToday(true)}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing...' : '↻ Refresh All'}
          </button>
        </div>

        <S2PKpiCardsGrid
          summary={combinedSummary}
          loading={isAnyStoreLoading}
          className="kpi-grid mt-sm"
          compact
        />
      </div>

      {orderedStores.length === 0 && (
        <div className="section-card mt-sm">
          <p className="subtitle">No active stores found.</p>
        </div>
      )}

      {orderedStores.map((store) => {
        const state = storeStates[store.id];
        const summary = state?.summary ?? null;
        const isLoading = state?.loading ?? true;
        const hasOrdersToday = (summary?.overallTotalOrders ?? 0) > 0;

        return (
          <section key={store.id} className="section-card perf-card admin-dashboard-store-card">
            <div className="flex-row items-center justify-between flex-wrap gap-sm">
              <div className="flex-row items-center gap-sm flex-wrap">
                <span className="badge badge-info">{store.store_code}</span>
                <h3 className="section-title editorial-serif-heading" style={{ margin: 0, fontSize: '1.05rem' }}>
                  {store.store_name}
                </h3>
                {!isLoading && (
                  <span
                    className={`badge ${hasOrdersToday ? 'badge-success' : 'badge-neutral'}`}
                  >
                    {hasOrdersToday
                      ? `Live Today · ${summary?.overallTotalOrders.toLocaleString()} orders`
                      : 'No orders uploaded today'}
                  </span>
                )}
              </div>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
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
