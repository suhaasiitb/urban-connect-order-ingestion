import React, { useCallback, useEffect, useState } from 'react';
import type { StoreMaster } from '../domain/types';
import {
  type BatchHistoryRecord,
  type BatchRowAuditRecord,
  type OrderRevisionAuditRecord,
  fetchBatchHistory,
  fetchBatchInspectionDetails,
} from '../services/ingestionService';

interface BatchHistoryTableProps {
  stores: StoreMaster[];
  refreshTrigger: number;
}

export const BatchHistoryTable: React.FC<BatchHistoryTableProps> = ({
  stores,
  refreshTrigger,
}) => {
  const [filterStoreId, setFilterStoreId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchHistoryRecord[]>([]);

  // Drill-down inspector modal state
  const [selectedBatch, setSelectedBatch] = useState<BatchHistoryRecord | null>(
    null
  );
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [batchRows, setBatchRows] = useState<BatchRowAuditRecord[]>([]);
  const [revisions, setRevisions] = useState<OrderRevisionAuditRecord[]>([]);
  const [inspectorTab, setInspectorTab] = useState<'revisions' | 'rows'>(
    'revisions'
  );

  const loadBatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchBatchHistory(filterStoreId || undefined);
      if (res.error) {
        setError(res.error);
      } else {
        setBatches(res.batches);
      }
    } finally {
      setLoading(false);
    }
  }, [filterStoreId]);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches, refreshTrigger]);

  const handleInspectBatch = async (batch: BatchHistoryRecord) => {
    setSelectedBatch(batch);
    setLoadingDetails(true);
    setDetailsError(null);
    setInspectorTab(batch.updated_count > 0 ? 'revisions' : 'rows');

    try {
      const res = await fetchBatchInspectionDetails(batch.id);
      if (res.error) {
        setDetailsError(res.error);
      }
      setBatchRows(res.batchRows);
      setRevisions(res.revisions);
    } finally {
      setLoadingDetails(false);
    }
  };

  return (
    <section className="card">
      <div className="section-header">
        <div>
          <h2>Prior Upload Batch History & Audit Log</h2>
          <p className="subtitle">
            Inspect upload attempts, row-level outcomes, and historical order
            revisions across configured stores.
          </p>
        </div>

        <div className="action-row">
          <select
            aria-label="Filter by store"
            value={filterStoreId}
            onChange={(e) => setFilterStoreId(e.target.value)}
          >
            <option value="">All Configured Stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.store_code} — {s.store_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void loadBatches()}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh History'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error mt-md" role="alert">
          {error}
        </div>
      )}

      <div className="table-scroll mt-md">
        <table className="data-table">
          <thead>
            <tr>
              <th>Upload Timestamp</th>
              <th>Store</th>
              <th>Date Range</th>
              <th>Filename</th>
              <th>Uploader UID</th>
              <th>Status</th>
              <th>Total</th>
              <th>Inserted</th>
              <th>Updated</th>
              <th>Unchanged</th>
              <th>Rejected</th>
              <th>Audit</th>
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 ? (
              <tr>
                <td colSpan={12} className="empty-cell">
                  {loading
                    ? 'Loading upload history...'
                    : 'No ingestion batches recorded yet.'}
                </td>
              </tr>
            ) : (
              batches.map((b) => {
                const dateRange =
                  b.min_order_date && b.max_order_date
                    ? b.min_order_date === b.max_order_date
                      ? b.min_order_date
                      : `${b.min_order_date} → ${b.max_order_date}`
                    : 'N/A';

                const badgeClass =
                  b.status === 'Succeeded'
                    ? 'badge-success'
                    : b.status === 'Duplicate Skipped'
                      ? 'badge-warning'
                      : 'badge-error';

                return (
                  <tr key={b.id}>
                    <td className="mono">
                      {new Date(b.started_at).toLocaleString()}
                    </td>
                    <td>
                      <strong>{b.stores?.store_code ?? 'Store'}</strong>
                    </td>
                    <td className="mono">{dateRange}</td>
                    <td>
                      <div>{b.original_filename}</div>
                      <small className="mono muted">
                        SHA-256: {b.file_checksum_sha256.slice(0, 12)}...
                      </small>
                    </td>
                    <td className="mono">{b.uploaded_by.slice(0, 8)}...</td>
                    <td>
                      <span className={`badge ${badgeClass}`}>{b.status}</span>
                    </td>
                    <td className="mono">{b.total_rows}</td>
                    <td className="mono">{b.inserted_count}</td>
                    <td className="mono">{b.updated_count}</td>
                    <td className="mono">{b.unchanged_count}</td>
                    <td className="mono">{b.rejected_count}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void handleInspectBatch(b)}
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Batch Row & Order Revision Inspector Modal */}
      {selectedBatch && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card modal-wide">
            <div className="modal-header">
              <div>
                <h2>Batch Audit & Revision Inspector</h2>
                <p className="subtitle mono">
                  Batch ID: {selectedBatch.id} • File:{' '}
                  {selectedBatch.original_filename}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedBatch(null)}
              >
                Close
              </button>
            </div>

            <div className="modal-body">
              {selectedBatch.error_summary && (
                <div className="alert alert-error mb-sm">
                  <strong>Batch Error Summary:</strong>{' '}
                  {selectedBatch.error_summary}
                </div>
              )}

              {detailsError && (
                <div className="alert alert-error mb-sm">{detailsError}</div>
              )}

              <div className="preview-tabs-bar">
                <div className="tab-group">
                  <button
                    type="button"
                    className={`btn btn-sm ${
                      inspectorTab === 'revisions'
                        ? 'btn-primary'
                        : 'btn-secondary'
                    }`}
                    onClick={() => setInspectorTab('revisions')}
                  >
                    Order Revisions ({revisions.length})
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${
                      inspectorTab === 'rows' ? 'btn-primary' : 'btn-secondary'
                    }`}
                    onClick={() => setInspectorTab('rows')}
                  >
                    Batch Row Outcomes (First {batchRows.length})
                  </button>
                </div>
              </div>

              {loadingDetails ? (
                <div className="alert alert-info mt-sm">
                  Loading batch audit details...
                </div>
              ) : inspectorTab === 'revisions' ? (
                <div className="table-scroll mt-sm">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Order ID</th>
                        <th>Action</th>
                        <th>Changed Source Fields (Before → After)</th>
                        <th>Derived OTP Impact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revisions.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="empty-cell">
                            No existing orders were modified in this batch.
                          </td>
                        </tr>
                      ) : (
                        revisions.map((rev) => (
                          <tr key={rev.id}>
                            <td className="mono">
                              {new Date(rev.changed_at).toLocaleString()}
                            </td>
                            <td className="mono">{rev.order_id}</td>
                            <td>
                              <span className="badge badge-neutral">
                                {rev.action_type}
                              </span>
                            </td>
                            <td>
                              <pre className="json-diff">
                                {JSON.stringify(rev.changed_fields, null, 2)}
                              </pre>
                            </td>
                            <td className="mono">
                              OTP:{' '}
                              {String(
                                rev.previous_derived_snapshot?.otp_performance ??
                                  'N/A'
                              )}{' '}
                              →{' '}
                              {String(
                                rev.new_derived_snapshot?.otp_performance ?? 'N/A'
                              )}
                              <br />
                              OTP+3:{' '}
                              {String(
                                rev.previous_derived_snapshot
                                  ?.otp_plus_3_performance ?? 'N/A'
                              )}{' '}
                              →{' '}
                              {String(
                                rev.new_derived_snapshot
                                  ?.otp_plus_3_performance ?? 'N/A'
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="table-scroll mt-sm">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Worksheet Row #</th>
                        <th>Order ID</th>
                        <th>Outcome Action</th>
                        <th>Row Hash</th>
                        <th>Validation Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchRows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="empty-cell">
                            No row-level records found for this batch.
                          </td>
                        </tr>
                      ) : (
                        batchRows.map((row) => (
                          <tr key={row.id}>
                            <td className="mono">{row.source_row_number}</td>
                            <td className="mono">{row.order_id ?? 'N/A'}</td>
                            <td>
                              <span className="badge badge-neutral">
                                {row.action}
                              </span>
                            </td>
                            <td className="mono">
                              {row.row_hash
                                ? `${row.row_hash.slice(0, 14)}...`
                                : 'N/A'}
                            </td>
                            <td>
                              {row.validation_errors &&
                              row.validation_errors.length > 0 ? (
                                <ul className="compact-list">
                                  {row.validation_errors.map((err, i) => (
                                    <li key={i}>
                                      <strong>{err.field}:</strong> {err.message}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="muted">None</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
