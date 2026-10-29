import React, { useState } from 'react';
import {
  type DnrResolutionType,
  type RiderDnrSummary,
  DNR_RESOLUTION_OPTIONS,
  formatDnrTimestamp,
  saveDnrResolution,
} from '../services/dnrService';

interface RiderDnrResolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  siteCode: string;
  storeName?: string;
  riderSummary: RiderDnrSummary;
  currentUserName?: string;
  onSaved: () => void;
}

export const RiderDnrResolutionModal: React.FC<RiderDnrResolutionModalProps> = ({
  isOpen,
  onClose,
  siteCode,
  storeName,
  riderSummary,
  currentUserName = 'Admin',
  onSaved,
}) => {
  const [selectedResolution, setSelectedResolution] = useState<DnrResolutionType>(
    (riderSummary.latestResolution?.resolution as DnrResolutionType) || 'Given Warning to Rider'
  );
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await saveDnrResolution({
        siteCode,
        riderName: riderSummary.riderName,
        normalizedName: riderSummary.normalizedRiderName,
        dpId: riderSummary.dpId,
        resolution: selectedResolution,
        notes,
        resolvedBy: currentUserName,
      });

      if (!res.ok) {
        setErrorMsg(res.error || 'Failed to save resolution.');
        setSaving(false);
        return;
      }

      setSuccessMsg(`✓ Resolution saved: "${selectedResolution}". Updated in dashboard.`);
      setSaving(false);
      onSaved();
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Error saving resolution: ${msg}`);
      setSaving(false);
    }
  };

  const history = riderSummary.resolutionHistory || [];

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card modal-dnr-resolution">
        <div className="modal-header">
          <div className="modal-title-with-icon">
            <span className="modal-icon-badge badge-warning">⚖️</span>
            <div>
              <h3 className="modal-title">DNR Resolution for Rider</h3>
              <p className="modal-subtitle">
                Store: <strong>{siteCode} {storeName ? `— ${storeName}` : ''}</strong>
              </p>
            </div>
          </div>
          <button type="button" className="btn-close" onClick={onClose} disabled={saving} aria-label="Close modal">
            ×
          </button>
        </div>

        <div className="modal-body">
          {/* Rider DNR Overview Card */}
          <div className="dnr-rider-overview-box">
            <div className="dnr-overview-header">
              <strong className="dnr-rider-name">{riderSummary.riderName}</strong>
              {riderSummary.dpId && (
                <span className="dnr-dpid-tag">DP: {riderSummary.dpId}</span>
              )}
            </div>

            <div className="dnr-kpi-badges-row">
              <span className="badge-dnr badge-dnr-frequent">
                Total DNR Cases: <strong>{riderSummary.totalDnrCount}</strong>
              </span>
              <span className="badge-dnr badge-dnr-non-abusive">
                Non_abusive: <strong>{riderSummary.nonAbusiveCount}</strong>
              </span>
              <span className="badge-dnr badge-dnr-potential-abuse">
                Potential_abuse: <strong>{riderSummary.potentialAbuseCount}</strong>
              </span>
              {riderSummary.isFrequentExploiter && (
                <span className="badge-dnr badge-dnr-frequent">
                  🚨 Frequent Exploiter
                </span>
              )}
            </div>

            {/* List of associated orders */}
            {riderSummary.records && riderSummary.records.length > 0 && (
              <div className="dnr-orders-mini-list">
                <span className="mini-list-title">Associated Incident Orders:</span>
                <div className="dnr-orders-chips">
                  {riderSummary.records.map((r, idx) => (
                    <span key={idx} className="dnr-order-chip" title={`${r.orderId} • ${r.abuseFlag} • ${r.orderDate || 'N/A'}`}>
                      <span className="mono">{r.orderId}</span>
                      <span className={`chip-abuse-tag ${r.abuseFlag === 'Non_abusive' ? 'text-danger' : 'text-blue'}`}>
                        ({r.abuseFlag === 'Non_abusive' ? 'Non-abusive' : 'Pot. abuse'})
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Active Resolution Banner */}
          {riderSummary.latestResolution && (
            <div className="dnr-active-resolution-banner">
              <div className="banner-top-row">
                <span className="badge-resolved-green">✓ DNR Resolved</span>
                <span className="banner-resolved-date">
                  {formatDnrTimestamp(riderSummary.latestResolution.resolvedAt) || riderSummary.latestResolution.resolvedAt}
                </span>
              </div>
              <div className="banner-resolution-highlight">
                <span className="resolution-label">Current Resolution:</span>
                <strong className="resolution-value">
                  {riderSummary.latestResolution.resolution}
                </strong>
              </div>
              {riderSummary.latestResolution.notes && (
                <div className="banner-notes-box">
                  <span className="notes-label">Notes:</span>
                  <p className="banner-notes-text">
                    "{riderSummary.latestResolution.notes}"
                  </p>
                </div>
              )}
              <div className="banner-meta-footer">
                <span>Resolved by: <strong>{riderSummary.latestResolution.resolvedBy || 'Admin'}</strong></span>
                <span>Store: <strong>{riderSummary.latestResolution.siteCode || siteCode}</strong></span>
              </div>
            </div>
          )}

          {/* Form to submit resolution */}
          <form onSubmit={handleSave} className="dnr-resolution-form">
            <div className="form-group">
              <label htmlFor="dnr-resolution-select" className="form-label">
                {riderSummary.latestResolution ? 'Update Resolution Action' : 'Resolution Action'} <span className="text-danger">*</span>
              </label>
              <select
                id="dnr-resolution-select"
                className="form-control"
                value={selectedResolution}
                onChange={(e) => setSelectedResolution(e.target.value as DnrResolutionType)}
                disabled={saving}
                required
              >
                {DNR_RESOLUTION_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <small className="form-hint">
                Select the administrative outcome decided for this rider.
              </small>
            </div>

            <div className="form-group">
              <label htmlFor="dnr-resolution-notes" className="form-label">
                Resolution Notes & Remarks <span className="text-muted">(Optional)</span>
              </label>
              <textarea
                id="dnr-resolution-notes"
                className="form-control"
                rows={2}
                placeholder="e.g., Rider acknowledged issue, or investigation proved vendor parcel drop misplacement..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={saving}
              />
            </div>

            {errorMsg && (
              <div className="alert alert-danger py-xs my-xs">{errorMsg}</div>
            )}
            {successMsg && (
              <div className="alert alert-success py-xs my-xs">{successMsg}</div>
            )}

            <div className="modal-actions-bar">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
              >
                {saving
                  ? 'Saving Resolution...'
                  : riderSummary.latestResolution
                  ? 'Update Resolution'
                  : 'Save Resolution'}
              </button>
            </div>
          </form>

          {/* Past Resolution Audit History */}
          <div className="dnr-resolution-history-section">
            <h4 className="history-section-title">
              Resolution Audit History ({history.length})
            </h4>

            {history.length === 0 ? (
              <p className="no-history-text">
                No past resolutions recorded for this rider yet.
              </p>
            ) : (
              <div className="dnr-history-timeline">
                {history.map((item, idx) => (
                  <div key={item.id || idx} className="history-timeline-item">
                    <div className="timeline-marker"></div>
                    <div className="timeline-content">
                      <div className="timeline-header-row">
                        <strong className="timeline-resolution-text">
                          {item.resolution}
                        </strong>
                        <span className="timeline-date-text">
                          {formatDnrTimestamp(item.resolvedAt) || item.resolvedAt}
                        </span>
                      </div>
                      <div className="timeline-meta-row">
                        <span>Resolved by: <strong>{item.resolvedBy || 'Admin'}</strong></span>
                        <span>Store: <strong>{item.siteCode}</strong></span>
                      </div>
                      {item.notes && (
                        <p className="timeline-notes-text">"{item.notes}"</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
