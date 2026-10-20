import React, { useEffect, useState } from 'react';
import type { StoreMaster } from '../domain/types';
import { supabase } from '../config/supabaseClient';

interface AnalyticsSectionProps {
  stores: StoreMaster[];
  selectedStoreId: string;
  onSelectStoreId: (id: string) => void;
}

interface AnalyticsQuickStats {
  totalOrders: number;
  completedOrders: number;
  rtoOrders: number;
  distinctDates: number;
  loading: boolean;
}

export const AnalyticsSection: React.FC<AnalyticsSectionProps> = ({
  stores,
  selectedStoreId,
  onSelectStoreId,
}) => {
  const selectedStore = stores.find((s) => s.id === selectedStoreId) ?? stores[0];

  const [stats, setStats] = useState<AnalyticsQuickStats>({
    totalOrders: 0,
    completedOrders: 0,
    rtoOrders: 0,
    distinctDates: 0,
    loading: true,
  });

  useEffect(() => {
    let mounted = true;
    const loadStoreStats = async () => {
      if (!selectedStore) return;
      setStats((prev) => ({ ...prev, loading: true }));

      try {
        const { data, error } = await supabase
          .from('orders')
          .select('id, status, order_date')
          .eq('store_id', selectedStore.id);

        if (!mounted) return;
        if (error || !data) {
          setStats({
            totalOrders: 0,
            completedOrders: 0,
            rtoOrders: 0,
            distinctDates: 0,
            loading: false,
          });
          return;
        }

        const totalOrders = data.length;
        const completedOrders = data.filter((o) => o.status === 'COMPLETED').length;
        const rtoOrders = data.filter((o) => o.status === 'RTO_DELIVERED').length;
        const dateSet = new Set(data.map((o) => o.order_date).filter(Boolean));

        setStats({
          totalOrders,
          completedOrders,
          rtoOrders,
          distinctDates: dateSet.size,
          loading: false,
        });
      } catch {
        if (mounted) {
          setStats({
            totalOrders: 0,
            completedOrders: 0,
            rtoOrders: 0,
            distinctDates: 0,
            loading: false,
          });
        }
      }
    };

    void loadStoreStats();
    return () => {
      mounted = false;
    };
  }, [selectedStore]);

  return (
    <div className="analytics-container">
      {/* Header & Store Selector */}
      <div className="section-card">
        <div className="analytics-header">
          <div>
            <h2 className="section-title">Store Performance & Dispatch Analytics</h2>
            <p className="section-subtitle">
              Aggregated KPI metrics, delivery performance, and SLAs computed from ingested daily reports.
            </p>
          </div>

          <div className="store-selector-group">
            <label htmlFor="analytics-store-select" className="field-label">
              Store:
            </label>
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
          </div>
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Total Ingested Orders</span>
          <strong className="kpi-value">
            {stats.loading ? '...' : stats.totalOrders.toLocaleString()}
          </strong>
          <span className="kpi-sub">Across {stats.distinctDates} active business dates</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Completed Deliveries</span>
          <strong className="kpi-value text-green">
            {stats.loading ? '...' : stats.completedOrders.toLocaleString()}
          </strong>
          <span className="kpi-sub">
            {stats.totalOrders > 0
              ? `${Math.round((stats.completedOrders / stats.totalOrders) * 100)}% completion rate`
              : 'No orders yet'}
          </span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">RTO Orders</span>
          <strong className="kpi-value text-amber">
            {stats.loading ? '...' : stats.rtoOrders.toLocaleString()}
          </strong>
          <span className="kpi-sub">Returned to origin</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Store SLA Coverage</span>
          <strong className="kpi-value">
            {stats.loading ? '...' : `${stats.distinctDates} Days`}
          </strong>
          <span className="kpi-sub">{selectedStore?.store_code ?? 'TMK7'} historical data</span>
        </div>
      </div>

      {/* Next Step Banner */}
      <div className="analytics-roadmap-card">
        <div className="roadmap-badge">Phase Ready</div>
        <h3 className="roadmap-title">Ready for Advanced Analytics</h3>
        <p className="roadmap-desc">
          Now that daily order ingestion is live and verified with exact second precision,
          we can build out custom hourly volume distribution charts, rider OTP dispatch performance,
          and Staging-to-Pickup (S2P) metric breakdown.
        </p>
      </div>
    </div>
  );
};
