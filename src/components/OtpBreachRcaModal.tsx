import React, { useEffect, useMemo, useState } from 'react';
import {
  OTP_BREACH_RCA_OPTIONS,
  type OtpBreachedOrderRecord,
  fetchOtpBreachedOrders,
  formatSlotHourLabel,
  saveOtpBreachRcas,
} from '../services/s2pOtpService';

interface OtpBreachRcaModalProps {
  isOpen: boolean;
  onClose: () => void;
  storeId: string;
  storeCode: string;
  orderDate: string;
  formattedDate: string;
  slotHour: number;
}

export const OtpBreachRcaModal: React.FC<OtpBreachRcaModalProps> = ({
  isOpen,
  onClose,
  storeId,
  storeCode,
  orderDate,
  formattedDate,
  slotHour,
}) => {
  const [orders, setOrders] = useState<OtpBreachedOrderRecord[]>([]);
  const [draftRcas, setDraftRcas] = useState<Record<string, string>>({});
  const [initialRcas, setInitialRcas] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !storeId || !orderDate) return;
    let active = true;
    setLoading(true);
    setError(null);
    setSaveMessage(null);

    void fetchOtpBreachedOrders({ storeId, orderDate, slotHour }).then((res) => {
      if (!active) return;
      if (res.error) {
        setError(res.error);
        setOrders([]);
        setDraftRcas({});
        setInitialRcas({});
      } else {
        setOrders(res.orders);
        const rcaMap: Record<string, string> = {};
        for (const ord of res.orders) {
          rcaMap[ord.orderId] = ord.otpBreachRca ?? '';
        }
        setDraftRcas(rcaMap);
        setInitialRcas(rcaMap);
      }
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [isOpen, storeId, orderDate, slotHour]);

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

    const res = await saveOtpBreachRcas({
      storeId,
      updates: dirtyUpdates,
    });

    if (!res.ok) {
      setError(res.error || 'Failed to save RCA entries.');
      setSaving(false);
      return;
    }

    setInitialRcas({ ...draftRcas });
    setSaveMessage(`Saved ${dirtyUpdates.length} RCA update${dirtyUpdates.length === 1 ? '' : 's'} to database.`);
    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-card otp-breached-modal otp-rca-modal"
        style={{ maxWidth: '820px', width: '95vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header flex-row items-center justify-between gap-sm">
          <div>
            <h3 className="modal-title" style={{ margin: 0 }}>
              Submit OTP Breach RCA
            </h3>
            <p className="text-xs text-muted" style={{ margin: '0.2rem 0 0' }}>
              {storeCode} · {formattedDate} ({orderDate}) · Slot {slotHour} ({formatSlotHourLabel(slotHour)})
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
              {loading ? '...' : `${orders.length} Breached ${orders.length === 1 ? 'Order' : 'Orders'}`}
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
                <th>Rider Name</th>
                <th>Order ID</th>
                <th className="text-right">Time Diff</th>
                <th style={{ minWidth: '240px' }}>RCA</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="text-center py-md text-muted">
                    Loading breached orders...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-md text-muted">
                    No OTP+3 breached orders found for this slot.
                  </td>
                </tr>
              ) : (
                orders.map((ord, idx) => {
                  const selectedVal = draftRcas[ord.orderId] ?? '';
                  return (
                    <tr key={`${ord.orderId}-${idx}`}>
                      <td className="text-center text-muted font-mono text-xs">{idx + 1}</td>
                      <td className="font-semibold">{ord.riderName}</td>
                      <td className="font-mono text-xs">{ord.orderId}</td>
                      <td className="text-right font-mono font-bold text-red" style={{ whiteSpace: 'nowrap' }}>
                        {ord.timeDiffMinutes.toFixed(2)} min
                      </td>
                      <td>
                        <select
                          aria-label={`RCA for order ${ord.orderId}`}
                          className="select-input otp-rca-select"
                          value={selectedVal}
                          onChange={(e) => handleSelectRca(ord.orderId, e.target.value)}
                          disabled={saving}
                        >
                          <option value="">-- Select RCA --</option>
                          {OTP_BREACH_RCA_OPTIONS.map((opt) => (
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
