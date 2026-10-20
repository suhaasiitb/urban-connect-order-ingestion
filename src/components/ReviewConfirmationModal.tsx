import React, { useState } from 'react';
import type { StoreMaster, WorkbookValidationResult } from '../domain/types';
import type { PreUploadDiffSummary } from '../services/ingestionService';

interface ReviewConfirmationModalProps {
  store: StoreMaster;
  validation: WorkbookValidationResult;
  diffPreview: PreUploadDiffSummary;
  loadingDiff: boolean;
  onCancel: () => void;
  onConfirmUpload: (forceReprocess: boolean) => void;
}

export const ReviewConfirmationModal: React.FC<ReviewConfirmationModalProps> = ({
  store,
  validation,
  diffPreview,
  loadingDiff,
  onCancel,
  onConfirmUpload,
}) => {
  const [confirmedCheckbox, setConfirmedCheckbox] = useState(false);
  const [forceReprocess, setForceReprocess] = useState(false);

  const dateRangeText =
    validation.min_order_date && validation.max_order_date
      ? validation.min_order_date === validation.max_order_date
        ? validation.min_order_date
        : `${validation.min_order_date} to ${validation.max_order_date}`
      : 'N/A';

  const nonCompletedCount = validation.rows.filter(
    (r) => r.normalized_source.status !== 'COMPLETED'
  ).length;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-header">
          <h2>Review & Confirm Order Ingestion</h2>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>

        <div className="modal-body">
          <p className="subtitle">
            Please verify the target store, business date range, expected record
            actions, and transformation rules before committing to PostgreSQL.
          </p>

          <div className="metrics-grid mt-sm">
            <div className="metric-box">
              <span className="metric-label">Selected Store</span>
              <span className="metric-value">
                {store.store_code} ({store.store_name})
              </span>
            </div>
            <div className="metric-box">
              <span className="metric-label">External Store ID</span>
              <span className="metric-value">{store.external_store_id ?? 'N/A'}</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Detected Business Date(s)</span>
              <span className="metric-value">{dateRangeText}</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Workbook Filename</span>
              <span className="metric-value">{validation.filename}</span>
            </div>
          </div>

          <h3 className="section-subtitle mt-md">
            Expected Database Actions (Pre-Upload Comparison)
          </h3>

          {loadingDiff ? (
            <div className="alert alert-info">
              Comparing {validation.total_rows_detected} orders against existing
              PostgreSQL records for store {store.store_code}...
            </div>
          ) : (
            <>
              {diffPreview.alreadyProcessedBatch && (
                <div className="alert alert-warning mb-sm">
                  <strong>Identical File Detected:</strong> This exact file
                  (SHA-256: <code>{validation.file_checksum_sha256.slice(0, 16)}...</code>)
                  was already imported in batch{' '}
                  <code>{diffPreview.alreadyProcessedBatch.id}</code>. By default,
                  the backend will skip re-importing and log a{' '}
                  <code>Duplicate Skipped</code> audit entry unless you check
                  "Force re-evaluation" below.
                  <div className="mt-xs">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={forceReprocess}
                        onChange={(e) => setForceReprocess(e.target.checked)}
                      />
                      <span>
                        Force order-by-order re-evaluation even though file checksum matches prior batch
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {diffPreview.warningMessage && (
                <div className="alert alert-warning mb-sm">
                  {diffPreview.warningMessage}
                </div>
              )}

              <div className="metrics-grid">
                <div className="metric-box">
                  <span className="metric-label">Total Valid Rows</span>
                  <span className="metric-value">{validation.valid_rows_count}</span>
                </div>
                <div className="metric-box metric-positive">
                  <span className="metric-label">Will Insert (New)</span>
                  <span className="metric-value">{diffPreview.expectedInserts}</span>
                </div>
                <div className="metric-box metric-info">
                  <span className="metric-label">Will Update (Changed)</span>
                  <span className="metric-value">{diffPreview.expectedUpdates}</span>
                </div>
                <div className="metric-box">
                  <span className="metric-label">Will Leave Unchanged</span>
                  <span className="metric-value">{diffPreview.expectedUnchanged}</span>
                </div>
                <div className="metric-box metric-negative">
                  <span className="metric-label">Rejected Rows</span>
                  <span className="metric-value">{diffPreview.expectedRejected}</span>
                </div>
              </div>
            </>
          )}

          <h3 className="section-subtitle mt-md">
            Authoritative Transformation & Data-Retention Rules
          </h3>
          <ul className="rules-list">
            <li>
              <strong>Full Business Date (AG):</strong> Stored as a full PostgreSQL{' '}
              <code>DATE</code> (<code>{dateRangeText}</code>) in{' '}
              <code>Asia/Kolkata (+05:30)</code> rather than only the day number.
            </li>
            <li>
              <strong>Exact-Second Interval Precision (AH, AI, AK, AL):</strong>{' '}
              Calculated from the exact second-level timestamps in{' '}
              <code>Raw Data</code> (rounded to 4 decimal places in minutes) without
              spreadsheet floating-point drift.
            </li>
            <li>
              <strong>Non-Completed Orders OTP Policy (AM, AN):</strong> All{' '}
              <strong>{nonCompletedCount}</strong> non-completed order(s) in this
              file have both <code>otp_performance</code> and{' '}
              <code>otp_plus_3_performance</code> set to{' '}
              <code>Not Applicable</code>.
            </li>
            <li>
              <strong>Revision History:</strong> Any existing order with changed
              source values will have its previous source and derived snapshots
              archived in <code>order_revision_history</code>.
            </li>
          </ul>

          <div className="confirmation-box mt-md">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmedCheckbox}
                onChange={(e) => setConfirmedCheckbox(e.target.checked)}
              />
              <span>
                I confirm that this workbook belongs to store{' '}
                <strong>{store.store_code}</strong> for business date(s){' '}
                <strong>{dateRangeText}</strong> and authorize committing these{' '}
                <strong>{validation.valid_rows_count}</strong> records to PostgreSQL.
              </span>
            </label>
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
          >
            Back to Preview
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!confirmedCheckbox || loadingDiff || !validation.is_valid}
            onClick={() => onConfirmUpload(forceReprocess)}
          >
            Confirm & Ingest {validation.valid_rows_count} Orders
          </button>
        </div>
      </div>
    </div>
  );
};
