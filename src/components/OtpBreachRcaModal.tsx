import React, { useEffect, useMemo, useState } from 'react';
import {
  DSR_RCA_OPTIONS,
  OTP_BREACH_RCA_OPTIONS,
  fetchDsrRtoOrders,
  fetchOtpBreachedOrders,
  formatSlotHourLabel,
  saveDsrRcas,
  saveOtpBreachRcas,
} from '../services/s2pOtpService';

interface RcaOrderRow {
  orderId: string;
  orderDate?: string;
  slotHour?: number;
  riderName: string;
  timeDiffMinutes?: number;
  trackingUrl?: string | null;
  status?: string;
}

interface OtpBreachRcaModalProps {
  isOpen: boolean;
  onClose: () => void;
  storeId: string;
  storeCode: string;
  orderDate?: string;
  formattedDate?: string;
  slotHour?: number | null;
  startDate?: string;
  endDate?: string;
  riderName?: string;
  mode?: 'otp' | 'dsr';
  onSaved?: () => void;
}

export const OtpBreachRcaModal: React.FC<OtpBreachRcaModalProps> = ({
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
  mode = 'otp',
  onSaved,
}) => {
  const [orders, setOrders] = useState<RcaOrderRow[]>([]);
  const [draftRcas, setDraftRcas] = useState<Record<string, string>>({});
  const [initialRcas, setInitialRcas] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const isDsrMode = mode === 'dsr';
  const isRangeMode = Boolean(startDate && endDate);
  const showSlotCol = slotHour === null;
  const rcaOptions = isDsrMode ? DSR_RCA_OPTIONS : OTP_BREACH_RCA_OPTIONS;

  useEffect(() => {
    if (!isOpen || !storeId || (!orderDate && !(startDate && endDate))) return;
    let active = true;
    setLoading(true);
    setError(null);
    setSaveMessage(null);

    const loadOrders = async () => {
      if (isDsrMode) {
        const res = await fetchDsrRtoOrders({
          storeId,
          orderDate,
          startDate,
          endDate,
          riderName,
          slotHour,
        });
        if (!active) return;
        if (res.error) {
          setError(res.error);
          setOrders([]);
          setDraftRcas({});
          setInitialRcas({});
        } else {
          const rows: RcaOrderRow[] = res.orders.map((ord) => ({
            orderId: ord.orderId,
            orderDate: ord.orderDate,
            slotHour: ord.slotHour,
            riderName: ord.riderName,
            status: ord.status,
          }));
          setOrders(rows);
          const rcaMap: Record<string, string> = {};
          for (const ord of res.orders) {
            rcaMap[ord.orderId] = ord.dsrRca ?? '';
          }
          setDraftRcas(rcaMap);
          setInitialRcas(rcaMap);
        }
      } else {
        const res = await fetchOtpBreachedOrders({
          storeId,
          orderDate,
          startDate,
          endDate,
          riderName,
          slotHour,
        });
        if (!active) return;
        if (res.error) {
          setError(res.error);
          setOrders([]);
          setDraftRcas({});
          setInitialRcas({});
        } else {
          const rows: RcaOrderRow[] = res.orders.map((ord) => ({
            orderId: ord.orderId,
            orderDate: ord.orderDate,
            slotHour: ord.slotHour,
            riderName: ord.riderName,
            timeDiffMinutes: ord.timeDiffMinutes,
            trackingUrl: ord.trackingUrl ?? null,
          }));
          setOrders(rows);
          const rcaMap: Record<string, string> = {};
          for (const ord of res.orders) {
            rcaMap[ord.orderId] = ord.otpBreachRca ?? '';
          }
          setDraftRcas(rcaMap);
          setInitialRcas(rcaMap);
        }
      }
      setLoading(false);
    };

    void loadOrders();

    return () => {
      active = false;
    };
  }, [isOpen, storeId, orderDate, startDate, endDate, riderName, slotHour, isDsrMode]);

  const dirtyUpdates = useMemo(() => {
    const changes: Array<{ orderId: string; rca: string | null }> = [];
    for (const ord of orders) {
      const currentVal = draftRcas[ord.orderId] ?? '';
      const origVal = initialRcas[ord.orderId] ?? '';
      if (currentVal !== origVal) {
        changes.push({
          orderId: ord.orderId,
          rca: currentVal || null,
        });
      }
    }
    return changes;
  }, [orders, draftRcas, initialRcas]);

  const filledCount = useMemo(() => {
    return orders.filter((o) => Boolean((draftRcas[o.orderId] ?? '').trim())).length;
  }, [orders, draftRcas]);

  if (!isOpen) return null;

  const handleSelectRca = (orderId: string, val: string) => {
    setSaveMessage(null);
    setError(null);
    setDraftRcas((prev) => ({
      ...prev,
      [orderId]: val,
    }));
  };

  const handleSave = async () => {
    if (dirtyUpdates.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);

    const res = isDsrMode
      ? await saveDsrRcas({ storeId, updates: dirtyUpdates })
      : await saveOtpBreachRcas({ storeId, updates: dirtyUpdates });

    if (!res.ok) {
      setError(res.error || 'Failed to save RCA entries.');
      setSaving(false);
      return;
    }

    setInitialRcas({ ...draftRcas });
    setSaveMessage(`Saved ${dirtyUpdates.length} RCA update${dirtyUpdates.length === 1 ? '' : 's'} to database.`);
    setSaving(false);
    onSaved?.();
  };

  const showTrackingCol = !isDsrMode;
  const slotDescription =
    slotHour !== null ? `Slot ${slotHour} (${formatSlotHourLabel(slotHour)})` : 'All Slots';
  const subtitle = isRangeMode
    ? `${storeCode}${riderName ? ` · ${riderName}` : ''} · ${startDate} → ${endDate}`
    : `${storeCode} · ${formattedDate ?? orderDate} (${orderDate}) · ${slotDescription}`;
  const totalCols = 5 + (isRangeMode ? 1 : 0) + (showSlotCol ? 1 : 0) + (showTrackingCol ? 1 : 0);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-card otp-breached-modal otp-rca-modal"
        style={{
          maxWidth: isRangeMode ? '1040px' : showTrackingCol ? '940px' : '820px',
          width: '95vw',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header flex-row items-center justify-between gap-sm">
          <div>
            <h3 className="modal-title" style={{ margin: 0 }}>
              {isDsrMode
                ? riderName
                  ? `BTO (RTO_DELIVERED) Orders — ${riderName}`
                  : 'Submit DSR RCA (RTO_DELIVERED)'
                : 'Submit OTP Breach RCA'}
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

        <div className="flex-row items-center justify-between gap-sm flex-wrap mt-sm mb-sm">
          <div className="flex-row items-center gap-sm flex-wrap">
            <span className="badge badge-danger">
              {loading
                ? '...'
                : isDsrMode
                ? `${orders.length} RTO ${orders.length === 1 ? 'Order' : 'Orders'}`
                : `${orders.length} Breached ${orders.length === 1 ? 'Order' : 'Orders'}`}
            </span>
            <span className="badge badge-neutral">
              {loading ? '...' : `${filledCount} / ${orders.length} RCA Tagged`}
            </span>
          </div>
          <span className="text-xs text-muted">
            Saved directly on order records (30-day retention)
          </span>
        </div>

        {error && (
          <div className="alert alert-error mb-sm" role="alert">
            {error}
          </div>
        )}

        {saveMessage && (
          <div className="alert alert-success mb-sm" role="status">
            {saveMessage}
          </div>
        )}

        <div className="table-wrapper" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-center" style={{ width: '40px' }}>#</th>
                {isRangeMode && <th>Order Date</th>}
                <th>Rider Name</th>
                <th>Order ID</th>
                {showTrackingCol && <th className="text-center">Tracking URL</th>}
                {showSlotCol && <th className="text-center">Slot</th>}
                <th className={isDsrMode ? 'text-center' : 'text-right'}>
                  {isDsrMode ? 'Order Status' : 'Time Diff'}
                </th>
                <th style={{ minWidth: '240px' }}>RCA</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={totalCols} className="text-center py-md text-muted">
                    {isDsrMode ? 'Loading RTO_DELIVERED orders...' : 'Loading breached orders...'}
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={totalCols} className="text-center py-md text-muted">
                    {isDsrMode
                      ? 'No RTO_DELIVERED orders found for this selection.'
                      : 'No OTP+3 breached orders found for this selection.'}
                  </td>
                </tr>
              ) : (
                orders.map((ord, idx) => {
                  const selectedVal = draftRcas[ord.orderId] ?? '';
                  return (
                    <tr key={`${ord.orderId}-${idx}`}>
                      <td className="text-center text-muted font-mono text-xs">{idx + 1}</td>
                      {isRangeMode && (
                        <td className="font-mono text-xs" style={{ whiteSpace: 'nowrap' }}>
                          {ord.orderDate || '—'}
                        </td>
                      )}
                      <td className="font-semibold">{ord.riderName}</td>
                      <td className="font-mono text-xs">{ord.orderId}</td>
                      {showTrackingCol && (
                        <td className="text-center" style={{ whiteSpace: 'nowrap' }}>
                          {ord.trackingUrl ? (
                            <a
                              href={ord.trackingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={ord.trackingUrl}
                              style={{
                                color: 'var(--accent-blue, #3b82f6)',
                                textDecoration: 'underline',
                                fontWeight: 500,
                                fontSize: '0.78rem',
                              }}
                            >
                              Track Order ↗
                            </a>
                          ) : (
                            <span className="text-muted text-xs">—</span>
                          )}
                        </td>
                      )}
                      {showSlotCol && <td className="text-center">{ord.slotHour ?? '—'}</td>}
                      {isDsrMode ? (
                        <td className="text-center" style={{ whiteSpace: 'nowrap' }}>
                          <span className="badge badge-warning">{ord.status || 'RTO_DELIVERED'}</span>
                        </td>
                      ) : (
                        <td className="text-right font-mono font-bold text-red" style={{ whiteSpace: 'nowrap' }}>
                          {(ord.timeDiffMinutes ?? 0).toFixed(2)} min
                        </td>
                      )}
                      <td>
                        <select
                          aria-label={`RCA for order ${ord.orderId}`}
                          className="select-input otp-rca-select"
                          value={selectedVal}
                          onChange={(e) => handleSelectRca(ord.orderId, e.target.value)}
                          disabled={saving}
                        >
                          <option value="">-- Select RCA --</option>
                          {rcaOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="modal-footer flex-row items-center justify-between gap-sm mt-md">
          <span className="text-xs text-muted">
            {dirtyUpdates.length > 0
              ? `${dirtyUpdates.length} unsaved change${dirtyUpdates.length === 1 ? '' : 's'}`
              : 'All changes saved'}
          </span>
          <div className="flex-row items-center gap-xs">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onClose}
              disabled={saving}
            >
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void handleSave()}
              disabled={loading || saving || dirtyUpdates.length === 0}
            >
              {saving ? 'Saving...' : 'Save RCA'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
