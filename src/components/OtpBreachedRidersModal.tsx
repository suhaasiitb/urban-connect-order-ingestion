import React, { useEffect, useMemo, useState } from 'react';
import {
  type OtpBreachedOrderRecord,
  fetchOtpBreachedOrders,
  formatSlotHourLabel,
} from '../services/s2pOtpService';

interface OtpBreachedRidersModalProps {
  isOpen: boolean;
  onClose: () => void;
  storeId: string;
  storeCode: string;
  orderDate?: string;
  formattedDate?: string;
  slotHour?: number | null; // null = full day
  startDate?: string;
  endDate?: string;
  riderName?: string;
}

export const OtpBreachedRidersModal: React.FC<OtpBreachedRidersModalProps> = ({
  isOpen,
  onClose,
  storeId,
  storeCode,
  orderDate,
  formattedDate,
  slotHour = null,
  startDate,
  endDate,
  riderName,
}) => {
  const [orders, setOrders] = useState<OtpBreachedOrderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRangeMode = Boolean(startDate && endDate);

  useEffect(() => {
    if (!isOpen || !storeId || (!orderDate && !(startDate && endDate))) return;
    let active = true;
    setLoading(true);
    setError(null);

    void fetchOtpBreachedOrders({
      storeId,
      orderDate,
      startDate,
      endDate,
      riderName,
      slotHour,
    }).then((res) => {
      if (!active) return;
      if (res.error) {
        setError(res.error);
        setOrders([]);
      } else {
        setOrders(res.orders);
      }
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [isOpen, storeId, orderDate, startDate, endDate, riderName, slotHour]);

  const distinctRidersCount = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      set.add((o.riderNumber || o.riderName).toLowerCase());
    }
    return set.size;
  }, [orders]);

  const distinctDaysCount = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      if (o.orderDate) set.add(o.orderDate);
    }
    return set.size;
  }, [orders]);

  if (!isOpen) return null;

  const slotDescription =
    slotHour !== null ? `Slot ${slotHour} (${formatSlotHourLabel(slotHour)})` : 'All Slots';

  const subtitle = isRangeMode
    ? `${storeCode}${riderName ? ` · ${riderName}` : ''} · ${startDate} → ${endDate}`
    : `${storeCode} · ${formattedDate ?? orderDate} (${orderDate}) · ${slotDescription}`;

  const showSlotCol = slotHour === null;
  const totalCols = 7 + (isRangeMode ? 1 : 0) + (showSlotCol ? 1 : 0);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-card otp-breached-modal"
        style={{ maxWidth: isRangeMode ? '940px' : '860px', width: '95vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header flex-row items-center justify-between gap-sm">
          <div>
            <h3 className="modal-title" style={{ margin: 0 }}>
              OTP+3 Breached {riderName ? `Orders — ${riderName}` : 'Riders'}
            </h3>
            <p className="text-xs text-muted" style={{ margin: '0.2rem 0 0' }}>
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <div className="flex-row items-center gap-sm flex-wrap mt-sm mb-sm">
          <span className="badge badge-danger">
            {loading ? '...' : `${orders.length} Breached ${orders.length === 1 ? 'Order' : 'Orders'}`}
          </span>
          {isRangeMode ? (
            <span className="badge badge-neutral">
              {loading ? '...' : `${distinctDaysCount} ${distinctDaysCount === 1 ? 'Day' : 'Days'}`}
            </span>
          ) : (
            <span className="badge badge-neutral">
              {loading ? '...' : `${distinctRidersCount} ${distinctRidersCount === 1 ? 'Rider' : 'Riders'}`}
            </span>
          )}
          <span className="text-xs text-muted">
            Time Difference = Arrival Time ETA − Actual Arrival Time (negative = late)
          </span>
        </div>

        {error && (
          <div className="alert alert-error mb-sm" role="alert">
            {error}
          </div>
        )}

        <div className="table-wrapper" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-center" style={{ width: '44px' }}>#</th>
                {isRangeMode && <th>Order Date</th>}
                <th>Rider Name</th>
                <th>Rider Number</th>
                <th>Order ID</th>
                {showSlotCol && <th className="text-center">Slot</th>}
                <th className="text-right">Arrival ETA (min)</th>
                <th className="text-right">Actual Arrival (min)</th>
                <th className="text-right">Time Diff (ETA − Actual)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={totalCols} className="text-center py-md text-muted">
                    Loading breached orders...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={totalCols} className="text-center py-md text-muted">
                    No OTP+3 breached orders found for this selection.
                  </td>
                </tr>
              ) : (
                orders.map((ord, idx) => (
                  <tr key={`${ord.orderId}-${idx}`}>
                    <td className="text-center text-muted font-mono text-xs">{idx + 1}</td>
                    {isRangeMode && (
                      <td className="font-mono text-xs" style={{ whiteSpace: 'nowrap' }}>
                        {ord.orderDate || '—'}
                      </td>
                    )}
                    <td className="font-semibold">{ord.riderName}</td>
                    <td className="font-mono text-xs">{ord.riderNumber || '—'}</td>
                    <td className="font-mono text-xs">{ord.orderId}</td>
                    {showSlotCol && <td className="text-center">{ord.slotHour}</td>}
                    <td className="text-right font-mono">{ord.arrivalEtaMinutes.toFixed(2)}</td>
                    <td className="text-right font-mono">{ord.actualArrivalMinutes.toFixed(2)}</td>
                    <td className="text-right font-mono font-bold text-red">
                      {ord.timeDiffMinutes.toFixed(2)} min
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
