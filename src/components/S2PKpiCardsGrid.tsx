import React from 'react';
import type { S2POtpSummaryResult } from '../services/s2pOtpService';

interface S2PKpiCardsGridProps {
  summary: S2POtpSummaryResult | null | undefined;
  loading?: boolean;
  className?: string;
}

/**
 * Shared 5-card KPI grid (S2P, OTP+3, DPH, DSR, Total Volume & Riders)
 * used by both the Store S2P & OTP view and the Admin Multi-Store Dashboard.
 */
export const S2PKpiCardsGrid: React.FC<S2PKpiCardsGridProps> = ({
  summary,
  loading = false,
  className = 'kpi-grid mt-md',
}) => {
  const periodDays = summary?.periodDays ?? 1;

  return (
    <div className={className}>
      <div className="kpi-card">
        <div className="kpi-header-row">
          <span className="kpi-label">Average S2P Time</span>
          <span className="kpi-target-badge">Target: ≤ 0.60 min</span>
        </div>
        <strong
          className={`kpi-value ${
            (summary?.overallAvgS2p ?? 0) > 0.60 ? 'text-red' : 'text-green'
          }`}
        >
          {loading ? '...' : `${(summary?.overallAvgS2p ?? 0).toFixed(2)} min`}
        </strong>
        <span className="kpi-sub">
          Staging-to-Pickup duration across {periodDays} {periodDays === 1 ? 'day' : 'days'}
        </span>
      </div>

      <div className="kpi-card">
        <div className="kpi-header-row">
          <span className="kpi-label">OTP+3 Performance</span>
          <span className="kpi-target-badge">Target: ≥ 98%</span>
        </div>
        <strong
          className={`kpi-value ${
            (summary?.overallOtpAchievedPct ?? 0) < 98.0 ? 'text-red' : 'text-green'
          }`}
        >
          {loading ? '...' : `${(summary?.overallOtpAchievedPct ?? 0).toFixed(2)}%`}
        </strong>
        <span className="kpi-sub">
          Achieved: {(summary?.overallOtpAchievedPct ?? 0).toFixed(1)}% | Breached:{' '}
          {(summary?.overallOtpBreachedPct ?? 0).toFixed(1)}%
        </span>
      </div>

      <div className="kpi-card">
        <div className="kpi-header-row">
          <span className="kpi-label">Deliveries Per Hour (DPH)</span>
          <span className="kpi-target-badge">Target: ≤ 2.1</span>
        </div>
        <strong
          className={`kpi-value ${
            (summary?.overallAvgDph ?? 0) > 2.1 ? 'text-red' : 'text-green'
          }`}
        >
          {loading ? '...' : (summary?.overallAvgDph ?? 0).toFixed(1)}
        </strong>
        <span className="kpi-sub">
          Orders per active rider working hour (turn-up)
        </span>
      </div>

      <div className="kpi-card">
        <div className="kpi-header-row">
          <span className="kpi-label">DSR (Delivery Success Rate)</span>
          <span className="kpi-target-badge">Target: &gt; 99%</span>
        </div>
        <strong
          className={`kpi-value ${
            (summary?.overallDsrPct ?? 0) > 99.0 ? 'text-green' : 'text-red'
          }`}
        >
          {loading ? '...' : `${(summary?.overallDsrPct ?? 0).toFixed(2)}%`}
        </strong>
        <span className="kpi-sub">
          Completed: {(summary?.overallCompletedOrders ?? 0).toLocaleString()} of{' '}
          {(summary?.overallTotalOrders ?? 0).toLocaleString()} orders
        </span>
      </div>

      <div className="kpi-card">
        <div className="kpi-header-row">
          <span className="kpi-label">Total Volume &amp; Riders</span>
        </div>
        <strong className="kpi-value text-slate">
          {loading ? '...' : `${(summary?.overallTotalOrders ?? 0).toLocaleString()}`}
        </strong>
        <span className="kpi-sub">
          Delivered by {summary?.overallDistinctRiders ?? 0} active riders in period
        </span>
      </div>
    </div>
  );
};
