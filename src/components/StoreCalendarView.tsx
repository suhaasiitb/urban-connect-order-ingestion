import React from 'react';
import type { DayCoverage, StoreCoverageSummary } from '../services/storeService';

interface StoreCalendarViewProps {
  storeCode: string;
  storeName: string;
  coverage: StoreCoverageSummary | null;
  loading: boolean;
  onRefresh: () => void;
  onSelectDate?: (dateStr: string) => void;
  selectedDate?: string | null;
}

export const StoreCalendarView: React.FC<StoreCalendarViewProps> = ({
  storeCode,
  coverage,
  loading,
  onRefresh,
  onSelectDate,
  selectedDate,
}) => {
  if (loading && !coverage) {
    return (
      <div className="calendar-card calendar-compact">
        <div className="calendar-loading-compact">
          <div className="spinner-sm" aria-hidden="true" />
          <span>Checking 30-day coverage for {storeCode}...</span>
        </div>
      </div>
    );
  }

  const days = coverage?.days ?? [];
  const uploadedCount = coverage?.uploadedCount ?? 0;
  const missingCount = coverage?.missingCount ?? 0;
  const totalDays = coverage?.totalDays ?? 30;

  return (
    <div className="calendar-card calendar-compact">
      <div className="calendar-compact-header">
        <div className="calendar-compact-title">
          <span className="calendar-dot-label">Last 30 Days Status:</span>
          <span className="badge badge-success badge-sm">
            <span className="dot dot-success" />
            {uploadedCount}/{totalDays} Uploaded
          </span>
          {missingCount > 0 && (
            <span className="badge badge-warning badge-sm">
              <span className="dot dot-warning" />
              {missingCount} Missing
            </span>
          )}
        </div>

        <div className="calendar-compact-meta">
          <div className="calendar-mini-legend">
            <span className="mini-legend-item">
              <span className="mini-dot mini-dot-green" /> Uploaded
            </span>
            <span className="mini-legend-item">
              <span className="mini-dot mini-dot-orange" /> Missing
            </span>
          </div>

          <button
            type="button"
            className="btn-icon btn-icon-sm"
            onClick={onRefresh}
            title="Refresh 30-day coverage status"
            disabled={loading}
          >
            ↻
          </button>
        </div>
      </div>

      <div className="calendar-compact-grid" role="grid" aria-label="Last 30 days upload status">
        {days.map((day: DayCoverage) => {
          const isSelected = selectedDate === day.dateStr;
          const tooltip = `${day.formattedDate}: ${
            day.isUploaded
              ? `Uploaded (${day.orderCount !== undefined ? `${day.orderCount} orders` : 'Complete'})`
              : 'Missing (Upload required)'
          }`;

          return (
            <button
              type="button"
              key={day.dateStr}
              className={`mini-day-chip ${
                day.isUploaded ? 'mini-day-uploaded' : 'mini-day-missing'
              } ${isSelected ? 'mini-day-selected' : ''}`}
              onClick={() => onSelectDate?.(day.dateStr)}
              title={tooltip}
            >
              <span className="mini-day-dow">{day.dayOfWeek.slice(0, 2)}</span>
              <span className="mini-day-num">{day.dayNumber}</span>
              <span
                className={`mini-day-dot ${
                  day.isUploaded ? 'mini-dot-green' : 'mini-dot-orange'
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};

