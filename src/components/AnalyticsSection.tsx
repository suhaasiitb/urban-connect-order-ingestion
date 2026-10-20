import React, { useCallback, useEffect, useState } from 'react';
import type { StoreMaster } from '../domain/types';
import { supabase } from '../config/supabaseClient';
import {
  type RiderPerformancePivotResult,
  fetchRiderPerformanceAnalytics,
  getDateRangeForDays,
} from '../services/analyticsService';
import { RiderPerformanceTable } from './RiderPerformanceTable';

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

  // Presets: 7, 10, 14, 20, 30 days
  const [selectedDays, setSelectedDays] = useState<number>(7);
  const initialRange = getDateRangeForDays(7, selectedStore?.timezone || 'Asia/Kolkata');
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);

  const [quickStats, setQuickStats] = useState<AnalyticsQuickStats>({
    totalOrders: 0,
    completedOrders: 0,
    rtoOrders: 0,
    distinctDates: 0,
    loading: true,
  });

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
  const [loadingPivot, setLoadingPivot] = useState(false);
  const [pivotError, setPivotError] = useState<string | null>(null);

  // Load KPI Stats
  const loadQuickStats = useCallback(async () => {
    if (!selectedStore) return;
    setQuickStats((prev) => ({ ...prev, loading: true }));

    try {
      // 1. Exact total orders count via head query (bypasses PostgREST 1,000-row limit)
      const { count: totalCount } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('store_id', selectedStore.id);

      const { count: completedCount } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('store_id', selectedStore.id)
        .eq('status', 'COMPLETED');

      const { count: rtoCount } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('store_id', selectedStore.id)
        .eq('status', 'RTO_DELIVERED');

      // 2. Distinct dates from batches
      const { data: batches } = await supabase
        .from('ingestion_batches')
        .select('min_order_date, max_order_date')
        .eq('store_id', selectedStore.id)
        .eq('status', 'Succeeded');

      const dateSet = new Set<string>();
      for (const b of batches ?? []) {
        if (b.min_order_date) dateSet.add(b.min_order_date);
        if (b.max_order_date) dateSet.add(b.max_order_date);
      }

      setQuickStats({
        totalOrders: totalCount ?? 0,
        completedOrders: completedCount ?? 0,
        rtoOrders: rtoCount ?? 0,
        distinctDates: dateSet.size,
        loading: false,
      });
    } catch {
      setQuickStats({
        totalOrders: 0,
        completedOrders: 0,
        rtoOrders: 0,
        distinctDates: 0,
        loading: false,
      });
    }
  }, [selectedStore]);

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
    void loadQuickStats();
  }, [loadQuickStats]);

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

  return (
    <div className="analytics-container">
      {/* Header & Store Selector */}
      <div className="section-card">
        <div className="analytics-header">
          <div>
            <h2 className="section-title">Store & Rider Analytics</h2>
            <p className="section-subtitle">
              Pivot analysis of Rider Hours (COUNTUNIQUE slot) and Orders (COUNTA order_id) across dates.
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

      {/* Top Quick KPI Metric Cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Total Ingested Orders</span>
          <strong className="kpi-value">
            {quickStats.loading ? '...' : quickStats.totalOrders.toLocaleString()}
          </strong>
          <span className="kpi-sub">Across {quickStats.distinctDates} business dates</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Active Working Riders</span>
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
            onRefresh={() => void loadRiderPivot()}
          />
        )}
      </div>
    </div>
  );
};
