import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StoreMaster } from '../domain/types';
import { formatDateToHeader, getTodayDateString } from '../services/analyticsService';
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

  return (
    <div className="analytics-container admin-dashboard-container">
      <div className="section-card admin-dashboard-header-card">
        <div className="flex-row items-center justify-between flex-wrap gap-sm">
          <div>
            <h2 className="section-title editorial-serif-heading">
              Executive Dashboard — All Stores (Today)
            </h2>
            <p className="section-subtitle">
              Current-day KPI snapshot for {orderedStores.map((s) => s.store_code).join(', ')} ·{' '}
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
            />
          </section>
        );
      })}
    </div>
  );
};
