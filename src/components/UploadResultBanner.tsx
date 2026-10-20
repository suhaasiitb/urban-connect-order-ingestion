import React from 'react';
import type { CommittedBatchResult } from '../services/ingestionService';

interface UploadResultBannerProps {
  isUploading: boolean;
  result: CommittedBatchResult | null;
  onRetryUpload: (forceReprocess?: boolean) => void;
  onClearResult: () => void;
}

export const UploadResultBanner: React.FC<UploadResultBannerProps> = ({
  isUploading,
  result,
  onRetryUpload,
  onClearResult,
}) => {
  if (isUploading) {
    return (
      <section className="card status-banner status-processing" aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        <div>
          <h3>Processing Order Batch...</h3>
          <p>
            The backend Edge Function is independently validating all 29 source
            columns, recalculating the 11 derived fields, and committing the
            database transaction. Please do not close this window.
          </p>
        </div>
      </section>
    );
  }

  if (!result) return null;

  const isSuccess = result.ok && result.status === 'Succeeded';
  const isDuplicate = result.ok && result.status === 'Duplicate Skipped';
  const bannerClass = isSuccess
    ? 'status-success'
    : isDuplicate
      ? 'status-warning'
      : 'status-error';

  const dateRangeText =
    result.min_order_date && result.max_order_date
      ? result.min_order_date === result.max_order_date
        ? result.min_order_date
        : `${result.min_order_date} to ${result.max_order_date}`
      : 'N/A';

  return (
    <section className={`card status-banner ${bannerClass}`} aria-live="polite">
      <div className="status-banner-header">
        <div>
          <span className="badge">{result.status}</span>
          <h3>
            {isSuccess && 'Database Transaction Committed Successfully'}
            {isDuplicate && 'Identical Workbook Already Processed (Skipped)'}
            {!result.ok && 'Ingestion Failed — No Orders Committed'}
          </h3>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onClearResult}
        >
          Dismiss
        </button>
      </div>

      {result.error_message && (
        <div className="alert alert-error mt-sm">
          <strong>Details:</strong> {result.error_message}
        </div>
      )}

      {isDuplicate && (
        <div className="alert alert-warning mt-sm">
          <strong>File-Level Idempotency:</strong> A file with this exact SHA-256
          checksum was already imported for store <strong>{result.store_code}</strong>{' '}
          in prior batch <code>{result.prior_batch_id}</code>. No duplicate orders
          were created.
        </div>
      )}

      <div className="metrics-grid mt-md">
        <div className="metric-box">
          <span className="metric-label">Batch ID</span>
          <span className="metric-value mono">{result.batch_id ?? 'Not created'}</span>
        </div>
        {result.prior_batch_id && (
          <div className="metric-box">
            <span className="metric-label">Prior Batch Reference</span>
            <span className="metric-value mono">{result.prior_batch_id}</span>
          </div>
        )}
        <div className="metric-box">
          <span className="metric-label">Store</span>
          <span className="metric-value">{result.store_code}</span>
        </div>
        <div className="metric-box">
          <span className="metric-label">Business Date(s)</span>
          <span className="metric-value">{dateRangeText}</span>
        </div>
        <div className="metric-box">
          <span className="metric-label">Total Submitted</span>
          <span className="metric-value">{result.total_rows}</span>
        </div>
        <div className="metric-box metric-positive">
          <span className="metric-label">Inserted</span>
          <span className="metric-value">{result.inserted_count}</span>
        </div>
        <div className="metric-box metric-info">
          <span className="metric-label">Updated</span>
          <span className="metric-value">{result.updated_count}</span>
        </div>
        <div className="metric-box">
          <span className="metric-label">Unchanged</span>
          <span className="metric-value">{result.unchanged_count}</span>
        </div>
        <div className="metric-box metric-negative">
          <span className="metric-label">Rejected</span>
          <span className="metric-value">{result.rejected_count}</span>
        </div>
        <div className="metric-box metric-negative">
          <span className="metric-label">Failed</span>
          <span className="metric-value">{result.failed_count}</span>
        </div>
      </div>

      {result.file_warnings && result.file_warnings.length > 0 && (
        <div className="alert alert-warning mt-sm">
          <strong>Warnings:</strong> {result.file_warnings.join(' | ')}
        </div>
      )}

      <div className="action-row mt-md">
        {result.is_network_error && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onRetryUpload(false)}
          >
            Safe Retry Upload
          </button>
        )}
        {isDuplicate && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onRetryUpload(true)}
          >
            Force Re-Verify Against Current Orders
          </button>
        )}
      </div>
    </section>
  );
};
