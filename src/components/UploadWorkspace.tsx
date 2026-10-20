import React, { useRef, useState } from 'react';
import { parseAndValidateOrderWorkbook } from '../domain/excelParser';
import {
  EXPECTED_RAW_HEADERS,
  type StoreMaster,
  type WorkbookValidationResult,
} from '../domain/types';
import {
  type CommittedBatchResult,
  type PreUploadDiffSummary,
  computePreUploadDiffPreview,
  submitConfirmedOrderBatch,
} from '../services/ingestionService';
import { ReviewConfirmationModal } from './ReviewConfirmationModal';
import { UploadResultBanner } from './UploadResultBanner';

interface UploadWorkspaceProps {
  stores: StoreMaster[];
  selectedStoreId: string;
  onSelectStoreId: (storeId: string) => void;
  onBatchCommitted: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export const UploadWorkspace: React.FC<UploadWorkspaceProps> = ({
  stores,
  selectedStoreId,
  onSelectStoreId,
  onBatchCommitted,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsingFile, setParsingFile] = useState(false);
  const [validation, setValidation] = useState<WorkbookValidationResult | null>(
    null
  );
  const [previewTab, setPreviewTab] = useState<'derived' | 'source'>('derived');

  // Review & Confirmation modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [diffPreview, setDiffPreview] = useState<PreUploadDiffSummary | null>(
    null
  );

  // Upload progress & committed result state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<CommittedBatchResult | null>(
    null
  );

  const selectedStore = stores.find((s) => s.id === selectedStoreId) ?? null;

  const processSelectedFile = async (file: File) => {
    if (!selectedStore) return;

    setUploadResult(null);
    setShowConfirmModal(false);
    setDiffPreview(null);

    const lowerName = file.name.toLowerCase();
    if (
      !lowerName.endsWith('.csv') &&
      !lowerName.endsWith('.xlsx') &&
      !lowerName.endsWith('.xls')
    ) {
      setValidation({
        filename: file.name,
        file_size_bytes: file.size,
        file_checksum_sha256: 'N/A',
        worksheet_found: false,
        detected_sheet_name: null,
        missing_headers: [...EXPECTED_RAW_HEADERS],
        unexpected_headers: [],
        file_errors: [
          `Unsupported file format "${file.name}". Please upload a CSV (.csv) or Excel (.xlsx / .xls) file.`,
        ],
        file_warnings: [],
        total_rows_detected: 0,
        valid_rows_count: 0,
        invalid_rows_count: 0,
        duplicate_order_ids: [],
        status_distribution: {},
        min_order_date: null,
        max_order_date: null,
        is_valid: false,
        rows: [],
      });
      return;
    }

    setParsingFile(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = parseAndValidateOrderWorkbook({
        fileBytes: arrayBuffer,
        filename: file.name,
        store: selectedStore,
      });
      setValidation(result);
    } finally {
      setParsingFile(false);
    }
  };

  const handleStoreChange = (newStoreId: string) => {
    onSelectStoreId(newStoreId);
    // Clear current preview when store changes so validation is always bound to selected store
    setValidation(null);
    setUploadResult(null);
    setShowConfirmModal(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processSelectedFile(file);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processSelectedFile(file);
    }
  };

  const handleOpenReviewModal = async () => {
    if (!selectedStore || !validation || !validation.is_valid) return;
    setShowConfirmModal(true);
    setLoadingDiff(true);
    try {
      const summary = await computePreUploadDiffPreview(
        selectedStore.id,
        validation
      );
      setDiffPreview(summary);
    } finally {
      setLoadingDiff(false);
    }
  };

  const executeUpload = async (forceReprocess = false) => {
    if (!selectedStore || !validation || !validation.is_valid) return;
    setShowConfirmModal(false);
    setIsUploading(true);
    try {
      const committed = await submitConfirmedOrderBatch({
        storeId: selectedStore.id,
        storeCode: selectedStore.store_code,
        validation,
        forceReprocess,
      });
      setUploadResult(committed);
      if (committed.ok) {
        onBatchCommitted();
      }
    } finally {
      setIsUploading(false);
    }
  };

  const rowsWithIssues =
    validation?.rows.filter((r) => r.issues.length > 0) ?? [];
  const blockingIssueRows = rowsWithIssues.filter((r) =>
    r.issues.some((i) => i.severity === 'error')
  );
  const warningOnlyRows = rowsWithIssues.filter(
    (r) => !r.issues.some((i) => i.severity === 'error')
  );

  const samplePreviewRows = validation?.rows.slice(0, 25) ?? [];

  return (
    <div className="workspace-stack">
      <UploadResultBanner
        isUploading={isUploading}
        result={uploadResult}
        onRetryUpload={(force) => executeUpload(Boolean(force))}
        onClearResult={() => setUploadResult(null)}
      />

      {/* Step 1 & 2: Store Selector and Workbook Upload */}
      <section className="card">
        <div className="section-header">
          <div>
            <h2>1. Select Store & Upload Daily Order File (.csv / .xlsx)</h2>
            <p className="subtitle">
              Select the target store first, then upload the store&apos;s daily{' '}
              <code>.csv</code> export (or <code>.xlsx</code> workbook with any
              system-generated sheet name).
            </p>
          </div>
        </div>

        <div className="upload-controls-grid mt-md">
          <div className="form-group">
            <label htmlFor="store-selector">Configured Active Store</label>
            <select
              id="store-selector"
              value={selectedStoreId}
              onChange={(e) => handleStoreChange(e.target.value)}
              disabled={parsingFile || isUploading || stores.length === 0}
            >
              {stores.length === 0 && (
                <option value="">No active stores available</option>
              )}
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.store_code} — {s.store_name}
                  {s.external_store_id ? ` (Store ID: ${s.external_store_id})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div
            className={`dropzone ${isDragging ? 'dropzone-active' : ''} ${
              !selectedStore ? 'dropzone-disabled' : ''
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              if (selectedStore) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => {
              if (selectedStore && !parsingFile && !isUploading) {
                fileInputRef.current?.click();
              }
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={handleFileChange}
              style={{ display: 'none' }}
              disabled={!selectedStore || parsingFile || isUploading}
            />
            <div className="dropzone-content">
              <strong>
                {parsingFile
                  ? 'Parsing & Validating File...'
                  : 'Click to select or drag and drop CSV (.csv) or Excel (.xlsx) file'}
              </strong>
              <span>
                Automatically detects headers from CSV or system-generated sheets and
                validates against{' '}
                {selectedStore ? (
                  <strong>
                    {selectedStore.store_code} (ID:{' '}
                    {selectedStore.external_store_id ?? 'N/A'})
                  </strong>
                ) : (
                  'the selected store'
                )}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Step 3: Validation & Preview Panel */}
      {validation && selectedStore && (
        <section className="card">
          <div className="section-header">
            <div>
              <h2>2. Workbook Validation & Derived Field Preview</h2>
              <p className="subtitle">
                File: <strong>{validation.filename}</strong> (
                {formatBytes(validation.file_size_bytes)}) • SHA-256:{' '}
                <code className="mono">{validation.file_checksum_sha256}</code>
              </p>
            </div>
            <div className="action-row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setValidation(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                disabled={isUploading}
              >
                Clear File
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!validation.is_valid || isUploading}
                onClick={handleOpenReviewModal}
              >
                Review & Confirm Upload ({validation.valid_rows_count} Orders)
              </button>
            </div>
          </div>

          {/* Schema & Summary Metrics */}
          <div className="metrics-grid mt-md">
            <div
              className={`metric-box ${
                validation.is_valid ? 'metric-positive' : 'metric-negative'
              }`}
            >
              <span className="metric-label">Validation Status</span>
              <span className="metric-value">
                {validation.is_valid ? 'Ready to Ingest' : 'Blocked (Errors Found)'}
              </span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Detected Source / Sheet</span>
              <span className="metric-value mono">
                {validation.worksheet_found
                  ? validation.detected_sheet_name ?? 'Found'
                  : 'Missing'}
              </span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Mandatory Headers</span>
              <span className="metric-value">
                {EXPECTED_RAW_HEADERS.length - validation.missing_headers.length} /{' '}
                {EXPECTED_RAW_HEADERS.length}
              </span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Records Detected</span>
              <span className="metric-value">{validation.total_rows_detected}</span>
            </div>
            <div className="metric-box metric-positive">
              <span className="metric-label">Valid Rows</span>
              <span className="metric-value">{validation.valid_rows_count}</span>
            </div>
            <div
              className={`metric-box ${
                validation.invalid_rows_count > 0 ? 'metric-negative' : ''
              }`}
            >
              <span className="metric-label">Invalid Rows</span>
              <span className="metric-value">{validation.invalid_rows_count}</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Business Date</span>
              <span className="metric-value">
                {validation.min_order_date
                  ? validation.min_order_date === validation.max_order_date
                    ? validation.min_order_date
                    : `${validation.min_order_date} to ${validation.max_order_date}`
                  : 'N/A'}
              </span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Duplicate Order IDs</span>
              <span className="metric-value">
                {validation.duplicate_order_ids.length}
              </span>
            </div>
          </div>

          {/* Status Distribution Chips */}
          {Object.keys(validation.status_distribution).length > 0 && (
            <div className="status-distribution-bar mt-md">
              <span className="status-bar-title">Order Status Distribution:</span>
              {Object.entries(validation.status_distribution).map(
                ([statusName, count]) => (
                  <span key={statusName} className="badge badge-neutral">
                    {statusName}: <strong>{count}</strong>
                  </span>
                )
              )}
            </div>
          )}

          {/* Blocking File Errors */}
          {validation.file_errors.length > 0 && (
            <div className="alert alert-error mt-md" role="alert">
              <strong>Blocking File-Level Validation Errors:</strong>
              <ul className="compact-list">
                {validation.file_errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Non-Blocking File Warnings */}
          {validation.file_warnings.length > 0 && (
            <div className="alert alert-warning mt-md">
              <strong>Non-Blocking File Warnings:</strong>
              <ul className="compact-list">
                {validation.file_warnings.map((warn, idx) => (
                  <li key={idx}>{warn}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Row-Level Issues Inspector */}
          {(blockingIssueRows.length > 0 || warningOnlyRows.length > 0) && (
            <div className="mt-md">
              <h3 className="section-subtitle">
                Row-Level Validation Issues ({blockingIssueRows.length} Blocking
                Row(s), {warningOnlyRows.length} Warning Row(s))
              </h3>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Excel Row #</th>
                      <th>Order ID</th>
                      <th>Severity</th>
                      <th>Field</th>
                      <th>Code</th>
                      <th>Explanation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsWithIssues.slice(0, 100).flatMap((r) =>
                      r.issues.map((issue, idx) => (
                        <tr
                          key={`${r.source_row_number}-${idx}`}
                          className={
                            issue.severity === 'error'
                              ? 'row-error'
                              : 'row-warning'
                          }
                        >
                          <td className="mono">{r.source_row_number}</td>
                          <td className="mono">
                            {r.normalized_source.order_id || '(missing)'}
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                issue.severity === 'error'
                                  ? 'badge-error'
                                  : 'badge-warning'
                              }`}
                            >
                              {issue.severity.toUpperCase()}
                            </span>
                          </td>
                          <td>{issue.field}</td>
                          <td className="mono">{issue.code}</td>
                          <td>{issue.message}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sample Rows Preview Table */}
          {samplePreviewRows.length > 0 && (
            <div className="mt-lg">
              <div className="preview-tabs-bar">
                <h3 className="section-subtitle">
                  Sample Preview (First {samplePreviewRows.length} of{' '}
                  {validation.total_rows_detected} Orders)
                </h3>
                <div className="tab-group">
                  <button
                    type="button"
                    className={`btn btn-sm ${
                      previewTab === 'derived' ? 'btn-primary' : 'btn-secondary'
                    }`}
                    onClick={() => setPreviewTab('derived')}
                  >
                    11 Calculated Columns (AD–AN) + Key Fields
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${
                      previewTab === 'source' ? 'btn-primary' : 'btn-secondary'
                    }`}
                    onClick={() => setPreviewTab('source')}
                  >
                    All 29 Normalized Source Columns (A–AC)
                  </button>
                </div>
              </div>

              <div className="table-scroll mt-sm">
                {previewTab === 'derived' ? (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Row #</th>
                        <th>Order ID (R)</th>
                        <th>Status (P)</th>
                        <th>Created At (O)</th>
                        <th>AD: Order Type</th>
                        <th>AE: Store Code</th>
                        <th>AF: Slot</th>
                        <th>AG: Order Date</th>
                        <th>AH: Time (min)</th>
                        <th>AI: S2P (min)</th>
                        <th>AJ: Distance (m)</th>
                        <th>AK: Actual Arrival (min)</th>
                        <th>AL: Arrival ETA (min)</th>
                        <th>AM: OTP Performance</th>
                        <th>AN: OTP+3 Performance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {samplePreviewRows.map((r) => (
                        <tr
                          key={r.source_row_number}
                          className={!r.is_valid ? 'row-error' : ''}
                        >
                          <td className="mono">{r.source_row_number}</td>
                          <td className="mono">{r.normalized_source.order_id}</td>
                          <td>
                            <span className="badge badge-neutral">
                              {r.normalized_source.status}
                            </span>
                          </td>
                          <td className="mono">
                            {r.normalized_source.order_created_at}
                          </td>
                          <td>{r.derived_fields.order_type}</td>
                          <td className="mono">{r.derived_fields.store_code}</td>
                          <td className="mono">{r.derived_fields.slot_hour}</td>
                          <td className="mono">{r.derived_fields.order_date}</td>
                          <td className="mono">
                            {r.derived_fields.staging_to_pickup_minutes}
                          </td>
                          <td className="mono">{r.derived_fields.s2p_minutes}</td>
                          <td className="mono">
                            {r.derived_fields.distance_meters}
                          </td>
                          <td className="mono">
                            {r.derived_fields.actual_arrival_minutes}
                          </td>
                          <td className="mono">
                            {r.derived_fields.arrival_eta_minutes}
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                r.derived_fields.otp_performance === 'OTP Achieved'
                                  ? 'badge-success'
                                  : r.derived_fields.otp_performance ===
                                      'Not Applicable'
                                    ? 'badge-neutral'
                                    : 'badge-error'
                              }`}
                            >
                              {r.derived_fields.otp_performance}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                r.derived_fields.otp_plus_3_performance ===
                                'OTP Achieved'
                                  ? 'badge-success'
                                  : r.derived_fields.otp_plus_3_performance ===
                                      'Not Applicable'
                                    ? 'badge-neutral'
                                    : 'badge-error'
                              }`}
                            >
                              {r.derived_fields.otp_plus_3_performance}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Row #</th>
                        <th>1. Rider Number</th>
                        <th>2. Arrived Pickup At</th>
                        <th>3. LM Distance</th>
                        <th>4. Resting Pt Name</th>
                        <th>5. Total ETA</th>
                        <th>6. Completed At</th>
                        <th>7. Resting Pt ID</th>
                        <th>8. Store Name</th>
                        <th>9. Pickup At</th>
                        <th>10. Order ETA Status</th>
                        <th>11. Staged At</th>
                        <th>12. Pickup ETA</th>
                        <th>13. Arrive Pickup ETA</th>
                        <th>14. Status Text</th>
                        <th>15. Created At</th>
                        <th>16. Status</th>
                        <th>17. Rider Name</th>
                        <th>18. Order ID</th>
                        <th>19. Store ID</th>
                        <th>20. Total Time</th>
                        <th>21. Arrive Deliv ETA</th>
                        <th>22. Arrived Deliv At</th>
                        <th>23. Tracking URL</th>
                        <th>24. Customer ID</th>
                        <th>25. RTO At</th>
                        <th>26. FM Distance</th>
                        <th>27. Assigned At</th>
                        <th>28. Delivery ETA</th>
                        <th>29. Batch ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {samplePreviewRows.map((r) => {
                        const s = r.normalized_source;
                        return (
                          <tr key={r.source_row_number}>
                            <td className="mono">{r.source_row_number}</td>
                            <td className="mono">{s.rider_number ?? 'NULL'}</td>
                            <td className="mono">{s.arrived_pickup_at ?? 'NULL'}</td>
                            <td className="mono">{s.lm_distance ?? 'NULL'}</td>
                            <td>{s.resting_point_name ?? 'NULL'}</td>
                            <td className="mono">{s.total_eta ?? 'NULL'}</td>
                            <td className="mono">{s.completed_at ?? 'NULL'}</td>
                            <td>{s.resting_point_id ?? 'NULL'}</td>
                            <td>{s.source_store_name}</td>
                            <td className="mono">{s.pickup_at ?? 'NULL'}</td>
                            <td>{s.order_eta_status ?? 'NULL'}</td>
                            <td className="mono">{s.staged_at ?? 'NULL'}</td>
                            <td className="mono">{s.pickup_eta ?? 'NULL'}</td>
                            <td className="mono">
                              {s.arrive_at_pickup_eta ?? 'NULL'}
                            </td>
                            <td>{s.status_text ?? 'NULL'}</td>
                            <td className="mono">{s.order_created_at}</td>
                            <td>{s.status}</td>
                            <td>{s.rider_name ?? 'NULL'}</td>
                            <td className="mono">{s.order_id}</td>
                            <td className="mono">{s.external_store_id}</td>
                            <td className="mono">{s.total_time ?? 'NULL'}</td>
                            <td className="mono">
                              {s.arrive_at_delivery_eta ?? 'NULL'}
                            </td>
                            <td className="mono">
                              {s.arrived_delivery_at ?? 'NULL'}
                            </td>
                            <td className="mono">{s.tracking_url ?? 'NULL'}</td>
                            <td className="mono">{s.customer_id ?? 'NULL'}</td>
                            <td className="mono">{s.rto_at ?? 'NULL'}</td>
                            <td className="mono">{s.fm_distance ?? 'NULL'}</td>
                            <td className="mono">{s.assigned_at ?? 'NULL'}</td>
                            <td className="mono">{s.delivery_eta ?? 'NULL'}</td>
                            <td>{s.source_batch_id ?? 'NULL'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {showConfirmModal && selectedStore && validation && (
        <ReviewConfirmationModal
          store={selectedStore}
          validation={validation}
          diffPreview={
            diffPreview ?? {
              alreadyProcessedBatch: null,
              expectedInserts: validation.valid_rows_count,
              expectedUpdates: 0,
              expectedUnchanged: 0,
              expectedRejected: validation.invalid_rows_count,
              comparisonAvailable: false,
            }
          }
          loadingDiff={loadingDiff}
          onCancel={() => setShowConfirmModal(false)}
          onConfirmUpload={(force) => executeUpload(force)}
        />
      )}
    </div>
  );
};
