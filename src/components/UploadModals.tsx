import React from 'react';
import type { StoreMaster, WorkbookValidationResult } from '../domain/types';
import type { CommittedBatchResult } from '../services/ingestionService';

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
