import React from 'react';
import type { StoreMaster, WorkbookValidationResult } from '../domain/types';
import type { CommittedBatchResult } from '../services/ingestionService';
import type { SnopForecastRecord } from '../services/planningService';

// -----------------------------------------------------------------------------
// 1. Error Modal
// -----------------------------------------------------------------------------
interface UploadErrorModalProps {
  filename: string;
  errors: string[];
  rowErrors?: Array<{ row: number; message: string }>;
  onClose: () => void;
}

export const UploadErrorModal: React.FC<UploadErrorModalProps> = ({
  filename,
  errors,
  rowErrors = [],
  onClose,
}) => {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card modal-error">
        <div className="modal-header">
          <div className="modal-title-with-icon">
            <span className="modal-icon-badge badge-error">✕</span>
            <div>
              <h3 className="modal-title">Upload Could Not Be Processed</h3>
              <p className="modal-subtitle">File: <span className="mono">{filename}</span></p>
            </div>
          </div>
          <button type="button" className="btn-close" onClick={onClose} aria-label="Close modal">
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="error-intro">
            Please resolve the following issue(s) before uploading this file:
          </p>

          <div className="error-list">
            {errors.map((err, idx) => (
              <div key={idx} className="error-item">
                <span className="error-bullet">•</span>
                <span className="error-text">{err}</span>
              </div>
            ))}

            {rowErrors.slice(0, 10).map((rErr, idx) => (
              <div key={`row-${idx}`} className="error-item">
                <span className="error-bullet">•</span>
                <span className="error-text">
                  <strong>Row {rErr.row}:</strong> {rErr.message}
                </span>
              </div>
            ))}

            {rowErrors.length > 10 && (
              <p className="error-more-note">
                ...and {rowErrors.length - 10} additional row errors.
              </p>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close & Select Correct File
          </button>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// 2. Confirmation Modal (Prompt before upload)
// -----------------------------------------------------------------------------
interface UploadConfirmModalProps {
  store: StoreMaster;
  validation: WorkbookValidationResult;
  isDateAlreadyUploaded: boolean;
  isUploading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const UploadConfirmModal: React.FC<UploadConfirmModalProps> = ({
  store,
  validation,
  isDateAlreadyUploaded,
  isUploading,
  onCancel,
  onConfirm,
}) => {
  const businessDate = validation.min_order_date ?? 'N/A';

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-header">
          <div className="modal-title-with-icon">
            <span className="modal-icon-badge badge-info">↑</span>
            <div>
              <h3 className="modal-title">Ready to Ingest Orders</h3>
              <p className="modal-subtitle">Confirm details for store {store.store_code}</p>
            </div>
          </div>
          {!isUploading && (
            <button type="button" className="btn-close" onClick={onCancel} aria-label="Cancel">
              ×
            </button>
          )}
        </div>

        <div className="modal-body">
          <div className="confirm-summary-grid">
            <div className="confirm-stat-box">
              <span className="stat-label">Store</span>
              <strong className="stat-val">{store.store_code}</strong>
              <span className="stat-sub">{store.store_name}</span>
            </div>
            <div className="confirm-stat-box">
              <span className="stat-label">Business Date</span>
              <strong className="stat-val stat-highlight">{businessDate}</strong>
              <span className="stat-sub">Asia/Kolkata</span>
            </div>
            <div className="confirm-stat-box">
              <span className="stat-label">Valid Orders</span>
              <strong className="stat-val text-green">{validation.valid_rows_count}</strong>
              <span className="stat-sub">0 Errors Detected</span>
            </div>
            <div className="confirm-stat-box">
              <span className="stat-label">Source File</span>
              <strong className="stat-val file-val">{validation.filename}</strong>
              <span className="stat-sub">{validation.detected_sheet_name ?? 'CSV'}</span>
            </div>
          </div>

          {isDateAlreadyUploaded && (
            <div className="alert-box alert-box-warning mt-md">
              <span className="alert-icon">⚠️</span>
              <div>
                <strong>Existing Data Detected:</strong> Data for{' '}
                <strong>{businessDate}</strong> is already uploaded for {store.store_code}.
                Proceeding will update and refresh the records for this date.
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={isUploading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={isUploading}
          >
            {isUploading ? (
              <>
                <span className="spinner-sm" aria-hidden="true" />
                Ingesting {validation.valid_rows_count} Orders...
              </>
            ) : (
              `Confirm & Ingest ${validation.valid_rows_count} Orders`
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// 3. Success Modal
// -----------------------------------------------------------------------------
interface UploadSuccessModalProps {
  result: CommittedBatchResult;
  onDone: () => void;
}

export const UploadSuccessModal: React.FC<UploadSuccessModalProps> = ({
  result,
  onDone,
}) => {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card modal-success">
        <div className="modal-body text-center pt-md">
          <div className="success-icon-circle">✓</div>
          <h2 className="success-title">Upload Successful</h2>
          <p className="success-subtitle">
            Successfully uploaded <strong>{result.inserted_count + result.updated_count + result.unchanged_count} orders</strong>{' '}
            for <strong>{result.store_code}</strong> on{' '}
            <strong>{result.min_order_date ?? 'Business Date'}</strong>.
          </p>

          <div className="success-stats-row">
            <div className="success-stat-chip">
              <span>Inserted</span>
              <strong>{result.inserted_count}</strong>
            </div>
            <div className="success-stat-chip">
              <span>Updated</span>
              <strong>{result.updated_count}</strong>
            </div>
            <div className="success-stat-chip">
              <span>Unchanged</span>
              <strong>{result.unchanged_count}</strong>
            </div>
            <div className="success-stat-chip">
              <span>Rejected</span>
              <strong className={result.rejected_count > 0 ? 'text-red' : ''}>
                {result.rejected_count}
              </strong>
            </div>
          </div>

          {result.batch_id && (
            <p className="batch-id-note">
              Batch ID: <span className="mono">{result.batch_id}</span>
            </p>
          )}
        </div>

        <div className="modal-footer justify-center">
          <button type="button" className="btn btn-primary btn-wide" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// 4. Roster Confirmation Modal
// -----------------------------------------------------------------------------
interface RosterConfirmModalProps {
  store: StoreMaster;
  filename: string;
  totalRiders: number;
  sampleRiders: string[];
  warnings: string[];
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const RosterConfirmModal: React.FC<RosterConfirmModalProps> = ({
  store,
  filename,
  totalRiders,
  sampleRiders,
  warnings,
  isSaving,
  onCancel,
  onConfirm,
}) => {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card modal-confirm">
        <div className="modal-header">
          <div className="modal-title-with-icon">
            <span className="modal-icon-badge badge-primary">🚴</span>
            <div>
              <h3 className="modal-title">Confirm Active Riders Roster</h3>
              <p className="modal-subtitle">
                Store: <strong>{store.store_code} — {store.store_name}</strong>
              </p>
            </div>
          </div>
          <button type="button" className="btn-close" onClick={onCancel} disabled={isSaving}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="confirm-summary-box">
            <div className="confirm-row">
              <span className="confirm-label">File:</span>
              <span className="confirm-value mono">{filename}</span>
            </div>
            <div className="confirm-row">
              <span className="confirm-label">Active Riders to Register:</span>
              <span className="confirm-value font-bold text-blue">{totalRiders} riders</span>
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="confirm-warning-box">
              {warnings.map((w, idx) => (
                <p key={idx} className="warning-text">⚠️ {w}</p>
              ))}
            </div>
          )}

          <div className="roster-sample-preview">
            <span className="sample-label">Sample Riders Detected ({Math.min(6, sampleRiders.length)} of {totalRiders}):</span>
            <div className="sample-chips">
              {sampleRiders.slice(0, 6).map((name, i) => (
                <span key={i} className="rider-sample-chip">{name}</span>
              ))}
              {sampleRiders.length > 6 && (
                <span className="rider-sample-more">+{totalRiders - 6} more</span>
              )}
            </div>
          </div>

          <p className="confirm-prompt-text">
            Uploading this roster will update the <strong>Active (Yes / No)</strong> tags for <strong>{store.store_code}</strong> riders across all analytics views.
          </p>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={isSaving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={isSaving}>
            {isSaving ? 'Saving Roster...' : `Confirm & Save ${totalRiders} Riders`}
          </button>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// 5. Roster Success Modal
// -----------------------------------------------------------------------------
interface RosterSuccessModalProps {
  storeCode: string;
  totalRiders: number;
  lastUpdatedFormatted: string;
  onDone: () => void;
}

export const RosterSuccessModal: React.FC<RosterSuccessModalProps> = ({
  storeCode,
  totalRiders,
  lastUpdatedFormatted,
  onDone,
}) => {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card modal-success">
        <div className="modal-body text-center pt-md">
          <div className="success-icon-circle">✓</div>
          <h2 className="success-title">Roster Updated Successfully!</h2>
          <p className="success-subtitle">
            Registered <strong>{totalRiders} active riders</strong> for store <strong>{storeCode}</strong>.
          </p>
          <p className="batch-id-note">
            Last Updated: <strong>{lastUpdatedFormatted}</strong>
          </p>
        </div>
        <div className="modal-footer justify-center">
          <button type="button" className="btn btn-primary btn-wide" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// 6. DNR Confirmation Modal
// -----------------------------------------------------------------------------
interface DnrConfirmModalProps {
  store: StoreMaster;
  filename: string;
  totalRecords: number;
  nonAbusiveCount: number;
  potentialAbuseCount: number;
  sampleRecords: Array<{ orderId: string; riderName: string; abuseFlag: string; scanDataDelivered?: string }>;
  warnings: string[];
  siteCodesFound?: string[];
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const DnrConfirmModal: React.FC<DnrConfirmModalProps> = ({
  store,
  filename,
  totalRecords,
  nonAbusiveCount,
  potentialAbuseCount,
  sampleRecords,
  warnings,
  siteCodesFound = [],
  isSaving,
  onCancel,
  onConfirm,
}) => {
  const isMultiStore = siteCodesFound.length > 1;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card modal-confirm">
        <div className="modal-header">
          <div className="modal-title-with-icon">
            <span className="modal-icon-badge badge-warning">⚠️</span>
            <div>
              <h3 className="modal-title">
                {isMultiStore
                  ? 'Confirm Multi-Store DNR Bulk Ingestion'
                  : 'Confirm DNR (Delivery Not Received) Ingestion'}
              </h3>
              <p className="modal-subtitle">
                {isMultiStore ? (
                  <>
                    Scope: <strong>Bulk Upload ({siteCodesFound.join(', ')})</strong>
                  </>
                ) : (
                  <>
                    Store: <strong>{store.store_code} — {store.store_name}</strong>
                  </>
                )}
              </p>
            </div>
          </div>
          <button type="button" className="btn-close" onClick={onCancel} disabled={isSaving}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="confirm-summary-box">
            <div className="confirm-row">
              <span className="confirm-label">File:</span>
              <span className="confirm-value mono">{filename}</span>
            </div>
            {isMultiStore && (
              <div className="confirm-row">
                <span className="confirm-label">Stores Included:</span>
                <span className="confirm-value font-bold text-primary">
                  {siteCodesFound.join(', ')} ({siteCodesFound.length} stores)
                </span>
              </div>
            )}
            <div className="confirm-row">
              <span className="confirm-label">Total DNR Cases:</span>
              <span className="confirm-value font-bold text-amber">{totalRecords} cases</span>
            </div>
            <div className="confirm-row">
              <span className="confirm-label">Non_abusive:</span>
              <span className="confirm-value font-semibold text-danger">{nonAbusiveCount} cases</span>
            </div>
            <div className="confirm-row">
              <span className="confirm-label">Potential_abuse:</span>
              <span className="confirm-value font-semibold text-blue">{potentialAbuseCount} cases</span>
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="confirm-warning-box">
              {warnings.map((w, idx) => (
                <p key={idx} className="warning-text">⚠️ {w}</p>
              ))}
            </div>
          )}

          <div className="roster-sample-preview">
            <span className="sample-label">
              Sample Flagged DNR Incidents ({Math.min(5, sampleRecords.length)} of {totalRecords}):
            </span>
            <div className="dnr-sample-cards">
              {sampleRecords.slice(0, 5).map((rec, i) => (
                <div key={i} className="dnr-sample-row">
                  <div className="dnr-sample-meta">
                    <span className="dnr-sample-order mono">{rec.orderId}</span>
                    <span className="dnr-sample-rider font-medium">{rec.riderName}</span>
                  </div>
                  <div className="dnr-sample-tags">
                    <span
                      className={`badge ${
                        rec.abuseFlag === 'Non_abusive' ? 'badge-danger' : 'badge-info'
                      }`}
                    >
                      {rec.abuseFlag}
                    </span>
                    {rec.scanDataDelivered && (
                      <span className="badge badge-secondary">{rec.scanDataDelivered}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="confirm-prompt-text">
            Ingesting this DNR report will update the <strong>Non_abusive</strong> and <strong>Potential_abuse</strong> tracking across Rider Analytics.
          </p>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={isSaving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={isSaving}>
            {isSaving ? 'Ingesting Cases...' : `Confirm & Save ${totalRecords} Records`}
          </button>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// 7. DNR Success Modal
// -----------------------------------------------------------------------------
interface DnrSuccessModalProps {
  storeCode: string;
  storesUpdated?: string[];
  totalRecords: number;
  nonAbusiveCount: number;
  potentialAbuseCount: number;
  lastUpdatedFormatted: string;
  onDone: () => void;
}

export const DnrSuccessModal: React.FC<DnrSuccessModalProps> = ({
  storeCode,
  storesUpdated = [],
  totalRecords,
  nonAbusiveCount,
  potentialAbuseCount,
  lastUpdatedFormatted,
  onDone,
}) => {
  const isMultiStore = storesUpdated.length > 1;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card modal-success">
        <div className="modal-body text-center pt-md">
          <div className="success-icon-circle">✓</div>
          <h2 className="success-title">
            {isMultiStore ? 'Multi-Store DNR Report Ingested!' : 'DNR Report Ingested Successfully!'}
          </h2>
          <p className="success-subtitle">
            Recorded <strong>{totalRecords} DNR cases</strong> (Non_abusive: {nonAbusiveCount}, Potential_abuse: {potentialAbuseCount}).
          </p>
          <p className="batch-id-note">
            {isMultiStore ? (
              <>
                Updated Stores: <strong>{storesUpdated.join(', ')}</strong> • Last Updated: <strong>{lastUpdatedFormatted}</strong>
              </>
            ) : (
              <>
                Target Store: <strong>{storeCode}</strong> • Last Updated: <strong>{lastUpdatedFormatted}</strong>
              </>
            )}
          </p>
        </div>
        <div className="modal-footer justify-center">
          <button type="button" className="btn btn-primary btn-wide" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// 8. SNOP Forecast Confirm Modal
// -----------------------------------------------------------------------------
interface SnopConfirmModalProps {
  store: StoreMaster;
  filename: string;
  totalRows: number;
  startDate: string;
  endDate: string;
  totalProjectedOrders: number;
  sampleRecords: SnopForecastRecord[];
  warnings?: string[];
  warehouseCodesFound?: string[];
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const SnopConfirmModal: React.FC<SnopConfirmModalProps> = ({
  store,
  filename,
  totalRows,
  startDate,
  endDate,
  totalProjectedOrders,
  sampleRecords,
  warnings = [],
  warehouseCodesFound = [],
  isSaving,
  onCancel,
  onConfirm,
}) => {
  const isMultiStore = warehouseCodesFound.length > 1;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card modal-confirm">
        <div className="modal-header">
          <div className="modal-title-with-icon">
            <span className="modal-icon-badge badge-primary">📈</span>
            <div>
              <h3 className="modal-title">
                {isMultiStore
                  ? 'Confirm Multi-Store SNOP Forecast Ingestion'
                  : 'Confirm SNOP Orders Forecast Ingestion'}
              </h3>
              <p className="modal-subtitle">
                {isMultiStore ? (
                  <>
                    Scope: <strong>Bulk Upload ({warehouseCodesFound.join(', ')})</strong>
                  </>
                ) : (
                  <>
                    Store: <strong>{store.store_code} — {store.store_name}</strong>
                  </>
                )}
              </p>
            </div>
          </div>
          <button type="button" className="btn-close" onClick={onCancel} disabled={isSaving}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="confirm-summary-box">
            <div className="confirm-row">
              <span className="confirm-label">File Name:</span>
              <span className="confirm-value mono">{filename}</span>
            </div>
            {isMultiStore && (
              <div className="confirm-row">
                <span className="confirm-label">Stores Included:</span>
                <span className="confirm-value font-bold text-primary">
                  {warehouseCodesFound.join(', ')} ({warehouseCodesFound.length} stores)
                </span>
              </div>
            )}
            <div className="confirm-row">
              <span className="confirm-label">Total Forecast Slots:</span>
              <span className="confirm-value font-bold text-amber">{totalRows} slots</span>
            </div>
            <div className="confirm-row">
              <span className="confirm-label">Date Coverage:</span>
              <span className="confirm-value font-semibold">{startDate} → {endDate}</span>
            </div>
            <div className="confirm-row">
              <span className="confirm-label">Total Projected Volume:</span>
              <span className="confirm-value font-semibold text-primary">
                {totalProjectedOrders.toLocaleString()} orders
              </span>
            </div>
          </div>

          <div className="alert alert-warning my-sm">
            <strong>⚠️ Operational Notice:</strong> Ingesting this forecast will{' '}
            <strong>completely rewrite and replace</strong> all existing SNOP forecast data for{' '}
            <strong>{isMultiStore ? `each respective store (${warehouseCodesFound.join(', ')})` : store.store_code}</strong>.
          </div>

          {warnings.length > 0 && (
            <div className="confirm-warning-box">
              {warnings.map((w, idx) => (
                <p key={idx} className="warning-text">⚠️ {w}</p>
              ))}
            </div>
          )}

          <div className="roster-sample-preview">
            <span className="sample-label">
              Sample Forecast Slots ({Math.min(5, sampleRecords.length)} of {totalRows}):
            </span>
            <div className="dnr-sample-cards">
              {sampleRecords.slice(0, 5).map((rec, i) => (
                <div key={i} className="dnr-sample-row">
                  <div className="dnr-sample-meta">
                    <span className="dnr-sample-order mono">
                      {rec.dateStr} • Slot {rec.hour} ({String(rec.hour).padStart(2, '0')}:00)
                    </span>
                    <span className="dnr-sample-rider font-medium">
                      Projected Orders: <strong>{rec.projectedOrders}</strong>
                    </span>
                  </div>
                  <span className="badge badge-primary">{rec.warehouseId}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={isSaving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={isSaving}>
            {isSaving ? 'Rewriting Forecast...' : `Confirm & Rewrite ${totalRows} Slots`}
          </button>
        </div>
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// 9. SNOP Success Modal
// -----------------------------------------------------------------------------
interface SnopSuccessModalProps {
  storeCode: string;
  warehousesUpdated?: string[];
  totalRows: number;
  startDate: string;
  endDate: string;
  totalProjectedOrders: number;
  onGoToPlanning?: () => void;
  onDone: () => void;
}

export const SnopSuccessModal: React.FC<SnopSuccessModalProps> = ({
  storeCode,
  warehousesUpdated = [],
  totalRows,
  startDate,
  endDate,
  totalProjectedOrders,
  onGoToPlanning,
  onDone,
}) => {
  const isMultiStore = warehousesUpdated.length > 1;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card modal-success">
        <div className="modal-body text-center pt-md">
          <div className="success-icon-circle">✓</div>
          <h2 className="success-title">
            {isMultiStore ? 'Multi-Store SNOP Forecast Ingested!' : 'SNOP Forecast Ingested Successfully!'}
          </h2>
          <p className="success-subtitle">
            {isMultiStore ? (
              <>
                Updated forecasts across <strong>{warehousesUpdated.join(', ')}</strong> with{' '}
                <strong>{totalRows} hourly slots</strong> ({totalProjectedOrders.toLocaleString()} total orders).
              </>
            ) : (
              <>
                Updated forecast for <strong>{storeCode}</strong> with{' '}
                <strong>{totalRows} hourly slots</strong> ({totalProjectedOrders.toLocaleString()} total orders).
              </>
            )}
          </p>
          <p className="batch-id-note">
            Coverage Period: <strong>{startDate}</strong> to <strong>{endDate}</strong>
          </p>
        </div>
        <div className="modal-footer justify-center gap-sm">
          {onGoToPlanning && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                onDone();
                onGoToPlanning();
              }}
            >
              📅 Open Planning Section
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onDone}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
