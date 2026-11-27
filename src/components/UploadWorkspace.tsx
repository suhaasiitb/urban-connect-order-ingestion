import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { StoreMaster } from '../domain/types';
import type { UserProfile } from '../services/authService';
import {
  type DnrParseResult,
  type StoreDnrSummary,
  getDnrSummaryForStore,
  fetchDnrSummaryForStore,
  parseDnrFile,
  saveDnrRecords,
} from '../services/dnrService';
import {
  type SnopParseResult,
  type SnopUploadMeta,
  fetchSnopUploadMeta,
  parseSnopFile,
  saveSnopRecords,
} from '../services/planningService';
import {
  DnrConfirmModal,
  DnrSuccessModal,
  SnopConfirmModal,
  SnopSuccessModal,
  UploadErrorModal,
} from './UploadModals';

export interface UploadWorkspaceProps {
  stores: StoreMaster[];
  selectedStoreId: string;
  onSelectStoreId: (storeId: string) => void;
  onBatchCommitted?: () => void;
  onNavigateToPlanning?: () => void;
  currentUser?: UserProfile | null;
  uploadType?: 'dnr' | 'snop';
  onChangeUploadType?: (type: 'dnr' | 'snop') => void;
}

export const UploadWorkspace: React.FC<UploadWorkspaceProps> = ({
  stores,
  selectedStoreId,
  onSelectStoreId,
  onBatchCommitted,
  onNavigateToPlanning,
  currentUser,
  uploadType: controlledUploadType,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsingFile, setParsingFile] = useState(false);

  // Upload Mode: 'dnr' (DNR Reports) vs 'snop' (SNOP Forecast)
  const uploadType = controlledUploadType ?? 'dnr';

  // DNR Reports state
  const [dnrSummary, setDnrSummary] = useState<StoreDnrSummary | null>(null);
  const [loadingDnr, setLoadingDnr] = useState(false);
  const [dnrParseResult, setDnrParseResult] = useState<DnrParseResult | null>(null);
  const [dnrStoresUpdated, setDnrStoresUpdated] = useState<string[]>([]);
  const [showDnrConfirm, setShowDnrConfirm] = useState(false);
  const [showDnrSuccess, setShowDnrSuccess] = useState(false);
  const [isSavingDnr, setIsSavingDnr] = useState(false);

  // SNOP Forecast state
  const [snopMeta, setSnopMeta] = useState<SnopUploadMeta | null>(null);
  const [loadingSnop, setLoadingSnop] = useState(false);
  const [snopParseResult, setSnopParseResult] = useState<SnopParseResult | null>(null);
  const [snopWarehousesUpdated, setSnopWarehousesUpdated] = useState<string[]>([]);
  const [showSnopConfirm, setShowSnopConfirm] = useState(false);
  const [showSnopSuccess, setShowSnopSuccess] = useState(false);
  const [isSavingSnop, setIsSavingSnop] = useState(false);

  // Error modal state
  const [errorModalData, setErrorModalData] = useState<{
    filename: string;
    errors: string[];
    rowErrors?: Array<{ row: number; message: string }>;
  } | null>(null);

  const selectedStore =
    stores.find((s) => s.id === selectedStoreId) ?? stores[0] ?? null;

  // Load DNR cases summary when selected store changes
  const loadDnr = useCallback(async () => {
    if (!selectedStore) return;
    setLoadingDnr(true);
    try {
      // 1. Instant local display
      setDnrSummary(getDnrSummaryForStore(selectedStore.store_code));
      // 2. Background sync with Supabase PostgreSQL
      const remote = await fetchDnrSummaryForStore(selectedStore.store_code);
      setDnrSummary(remote);
    } finally {
      setLoadingDnr(false);
    }
  }, [selectedStore]);

  // Load SNOP forecast metadata when selected store changes
  const loadSnop = useCallback(async () => {
    if (!selectedStore) return;
    setLoadingSnop(true);
    try {
      const meta = await fetchSnopUploadMeta(selectedStore.store_code);
      setSnopMeta(meta);
    } finally {
      setLoadingSnop(false);
    }
  }, [selectedStore]);

  useEffect(() => {
    void loadDnr();
    void loadSnop();
  }, [loadDnr, loadSnop]);

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setDnrParseResult(null);
    setSnopParseResult(null);
  };

  useEffect(() => {
    resetFileInput();
  }, [uploadType]);

  // Handle file selection and parsing for DNR or SNOP
  const processSelectedFile = async (file: File) => {
    if (!selectedStore) return;

    const lowerName = file.name.toLowerCase();
    if (
      !lowerName.endsWith('.csv') &&
      !lowerName.endsWith('.xlsx') &&
      !lowerName.endsWith('.xls')
    ) {
      setErrorModalData({
        filename: file.name,
        errors: [
          `Unsupported file format "${file.name}". Please upload a CSV (.csv) or Excel (.xlsx / .xls) file.`,
        ],
      });
      resetFileInput();
      return;
    }

    setParsingFile(true);

    if (uploadType === 'dnr') {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const parsed = parseDnrFile({
          fileBytes: arrayBuffer,
          filename: file.name,
          targetSiteCode: selectedStore.store_code,
        });

        setParsingFile(false);

        if (!parsed.is_valid) {
          setErrorModalData({
            filename: file.name,
            errors: parsed.errors,
          });
          resetFileInput();
          return;
        }

        setDnrParseResult(parsed);
        setShowDnrConfirm(true);
      } catch (err) {
        setParsingFile(false);
        const msg = err instanceof Error ? err.message : String(err);
        setErrorModalData({
          filename: file.name,
          errors: [`Failed to parse DNR report file: ${msg}`],
        });
        resetFileInput();
      }
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const parsed = await parseSnopFile({
        fileBytes: arrayBuffer,
        filename: file.name,
        targetSiteCode: selectedStore.store_code,
      });

      setParsingFile(false);

      if (!parsed.is_valid) {
        setErrorModalData({
          filename: file.name,
          errors: parsed.errors,
        });
        resetFileInput();
        return;
      }

      setSnopParseResult(parsed);
      setShowSnopConfirm(true);
    } catch (err) {
      setParsingFile(false);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorModalData({
        filename: file.name,
        errors: [`Failed to parse SNOP forecast file: ${msg}`],
      });
      resetFileInput();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void processSelectedFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processSelectedFile(file);
    }
  };

  // Confirm and save DNR report records
  const handleConfirmDnrUpload = async () => {
    if (!selectedStore || !dnrParseResult) return;

    setIsSavingDnr(true);

    try {
      const result = await saveDnrRecords({
        filename: dnrParseResult.filename,
        records: dnrParseResult.valid_records,
        uploadedBy: currentUser?.full_name || 'Admin',
        targetSiteCode: selectedStore.store_code,
      });

      setIsSavingDnr(false);
      setShowDnrConfirm(false);

      if (!result.ok) {
        setErrorModalData({
          filename: dnrParseResult.filename,
          errors: [result.error || 'Failed to save DNR report.'],
        });
        resetFileInput();
        return;
      }

      setDnrStoresUpdated(result.storesUpdated || [selectedStore.store_code]);
      await loadDnr();
      setShowDnrSuccess(true);
      resetFileInput();
      onBatchCommitted?.();
    } catch (err) {
      setIsSavingDnr(false);
      setShowDnrConfirm(false);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorModalData({
        filename: dnrParseResult.filename,
        errors: [`Could not save DNR report: ${msg}`],
      });
      resetFileInput();
    }
  };

  // Confirm and rewrite SNOP Orders Forecast
  const handleConfirmSnopUpload = async () => {
    if (!selectedStore || !snopParseResult) return;

    setIsSavingSnop(true);

    try {
      const result = await saveSnopRecords({
        warehouseId: selectedStore.store_code,
        records: snopParseResult.records,
        filename: snopParseResult.filename,
        uploadedBy: currentUser?.email || 'User',
      });

      setIsSavingSnop(false);
      setShowSnopConfirm(false);

      if (!result.ok) {
        setErrorModalData({
          filename: snopParseResult.filename,
          errors: [result.error || 'Failed to save SNOP forecast.'],
        });
        resetFileInput();
        return;
      }

      setSnopWarehousesUpdated(result.warehousesUpdated || [selectedStore.store_code]);
      await loadSnop();
      setShowSnopSuccess(true);
      resetFileInput();
      onBatchCommitted?.();
    } catch (err) {
      setIsSavingSnop(false);
      setShowSnopConfirm(false);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorModalData({
        filename: snopParseResult.filename,
        errors: [`Could not save SNOP forecast: ${msg}`],
      });
      resetFileInput();
    }
  };

  const handleDownloadSnopTemplate = (e: React.MouseEvent) => {
    e.stopPropagation();
    const templateCsv =
      'City,Warehouse Id,Date,Hour,Order\n' +
      'Pune,TMK7,2026-10-25,6,6\n' +
      'Pune,TMK7,2026-10-25,7,21\n' +
      'Pune,TMK7,2026-10-25,8,55\n' +
      'Pune,TMK7,2026-10-25,9,80\n' +
      'Pune,TMK7,2026-10-25,10,88\n' +
      'Pune,TMK7,2026-10-25,11,87\n' +
      'Pune,TMK7,2026-10-25,12,71\n' +
      'Pune,TMK7,2026-10-25,13,60\n' +
      'Pune,TMK7,2026-10-25,14,52\n' +
      'Pune,TMK7,2026-10-25,15,47\n' +
      'Pune,TMK7,2026-10-25,16,49\n' +
      'Pune,TMK7,2026-10-25,17,62\n' +
      'Pune,TMK7,2026-10-25,18,71\n' +
      'Pune,TMK7,2026-10-25,19,71\n' +
      'Pune,TMK7,2026-10-25,20,70\n' +
      'Pune,TMK7,2026-10-25,21,60\n' +
      'Pune,TMK7,2026-10-25,22,43\n' +
      'Pune,TMK7,2026-10-25,23,24\n';

    const blob = new Blob([templateCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'SNOP_Orders_Forecast_Template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isStoreUser = currentUser?.role === 'store_user';
  const isBusy = parsingFile || isSavingDnr || isSavingSnop;

  return (
    <div className="upload-portal-container">
      {/* 1. Store Selector / Store Indicator Section */}
      <div className="section-card store-selector-card">
        <div className="store-selector-row">
          <div className="store-title-group">
            <span className="section-step">{isStoreUser ? 'Store' : 'Step 1'}</span>
            <div>
              <h2 className="section-title editorial-serif-heading">
                {isStoreUser ? 'Assigned Store' : 'Select Store'}
              </h2>
              <p className="section-subtitle">
                {isStoreUser
                  ? 'All data ingestion and analytics are scoped exclusively to your assigned store.'
                  : 'Choose the store for which you are uploading data'}
              </p>
            </div>
          </div>

          <div className="store-control">
            {isStoreUser ? (
              <div className="store-badge-locked flex-row items-center gap-xs">
                <span className="badge badge-primary">{selectedStore?.store_code}</span>
                <strong>{selectedStore?.store_name}</strong>
              </div>
            ) : (
              <select
                id="store-select"
                className="store-dropdown"
                value={selectedStoreId}
                onChange={(e) => onSelectStoreId(e.target.value)}
                disabled={isBusy}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.store_code} — {s.store_name} (ID: {s.external_store_id ?? 'N/A'})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* 2. File Upload Section */}
      <div className="section-card upload-dropzone-card">
        <div className="upload-header-row">
          <div className="upload-header">
            <span className="section-step">Step 2</span>
            <div>
              <h2 className="section-title editorial-serif-heading">
                {uploadType === 'dnr'
                  ? 'Upload DNR (Delivery Not Received) Reports'
                  : 'Upload SNOP Orders Forecast'}
              </h2>
              <p className="section-subtitle">
                {uploadType === 'dnr'
                  ? `Upload DNR incident report (.csv or .xlsx) for ${selectedStore?.store_code ?? 'store'} to track Non_abusive and Potential_abuse cases.`
                  : `Upload orders forecast (.csv or .xlsx) for ${selectedStore?.store_code ?? 'store'}. Updates future dates (> today) while locking existing past & today dates (<= today).`}
              </p>
            </div>
          </div>
        </div>

        {/* SNOP Orders Forecast Status Banner (shown when in SNOP mode) */}
        {uploadType === 'snop' && (
          <div className="roster-status-banner snop-status-banner">
            <div className="roster-status-main">
              <span className="roster-status-icon-box snop-icon-box">📈</span>
              <div className="roster-status-content">
                <div className="roster-status-heading-row">
                  <h4 className="roster-status-heading">
                    SNOP Orders Forecast for {selectedStore?.store_code} ({selectedStore?.store_name})
                  </h4>
                  {loadingSnop && <span className="roster-loading-tag">Checking forecast...</span>}
                </div>
                <p className="roster-status-info">
                  {snopMeta && snopMeta.totalRows > 0 ? (
                    <>
                      Active forecast covers <strong>{snopMeta.totalRows} hourly slots</strong> from{' '}
                      <strong>{snopMeta.startDate}</strong> to <strong>{snopMeta.endDate}</strong>{' '}
                      (Total volume: <strong>{snopMeta.totalProjectedOrders.toLocaleString()} orders</strong>).{' '}
                      Last updated: <strong>{new Date(snopMeta.uploadedAt).toLocaleDateString()}</strong>
                      {snopMeta.filename && (
                        <> (file: <span className="mono">{snopMeta.filename}</span>)</>
                      )}.
                    </>
                  ) : (
                    'No active SNOP forecast found for this store. Upload a forecast file (.csv or .xlsx) with columns: City, Warehouse Id, Date, Hour, Order.'
                  )}
                </p>
                <div className="snop-banner-meta mt-xs flex-row items-center gap-sm">
                  <span className="badge badge-info">🔒 Historical SNOP Lock</span>
                  <span className="text-secondary text-sm">
                    Updates future dates (&gt; today); existing past &amp; today dates (&le; today) remain frozen so historical SNOP breaches never change.
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs ml-auto"
                    onClick={handleDownloadSnopTemplate}
                  >
                    ⬇ Download Template
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DNR Incident Reports Status Banner (shown when in DNR mode) */}
        {uploadType === 'dnr' && (
          <div className="roster-status-banner dnr-status-banner">
            <div className="roster-status-main">
              <span className="roster-status-icon-box dnr-icon-box">⚠️</span>
              <div className="roster-status-content">
                <div className="roster-status-heading-row">
                  <h4 className="roster-status-heading">
                    DNR Monitoring for {selectedStore?.store_code} ({selectedStore?.store_name})
                  </h4>
                  {loadingDnr && <span className="roster-loading-tag">Updating DNR stats...</span>}
                </div>
                <p className="roster-status-info">
                  {dnrSummary && dnrSummary.totalRecords > 0 ? (
                    <>
                      Currently tracking <strong>{dnrSummary.totalRecords} DNR cases</strong> across{' '}
                      <strong>{dnrSummary.totalRidersAffected} riders</strong> (
                      <span className="text-danger font-semibold">Non_abusive: {dnrSummary.totalNonAbusive}</span>,{' '}
                      <span className="text-blue font-semibold">Potential_abuse: {dnrSummary.totalPotentialAbuse}</span>).{' '}
                      {dnrSummary.frequentExploitersCount > 0 && (
                        <span className="dnr-exploiter-alert">
                          🚨 <strong>{dnrSummary.frequentExploitersCount} frequent exploiter(s)</strong> detected with multiple DNRs.{' '}
                        </span>
                      )}
                      Last upload: <strong>{dnrSummary.lastUpdatedFormatted || 'Baseline Audit'}</strong>
                      {dnrSummary.filename && (
                        <> (file: <span className="mono">{dnrSummary.filename}</span>)</>
                      )}.
                    </>
                  ) : (
                    'No DNR records found for this store. Upload a DNR report (.csv or .xlsx) with abuse_flag (Non_abusive / Potential_abuse).'
                  )}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Unified Clean Dropzone */}
        <div
          className={`clean-dropzone ${isDragging ? 'dropzone-active' : ''} ${
            parsingFile ? 'dropzone-busy' : ''
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => {
            if (!isBusy) {
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
            disabled={isBusy}
          />

          <div className="dropzone-inner">
            <div className="dropzone-icon">
              {parsingFile ? (
                <div className="spinner" aria-hidden="true" />
              ) : (
                <svg
                  width="44"
                  height="44"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              )}
            </div>

            <div className="dropzone-text">
              <strong>
                {parsingFile
                  ? uploadType === 'dnr'
                    ? 'Analyzing and validating DNR incident report...'
                    : 'Analyzing and validating SNOP orders forecast...'
                  : uploadType === 'dnr'
                  ? 'Click to select or drag and drop DNR Report (.csv or .xlsx)'
                  : 'Click to select or drag and drop SNOP Orders Forecast (.csv or .xlsx)'}
              </strong>
              <p>
                {uploadType === 'dnr' ? (
                  <>
                    Target Store: <strong>{selectedStore?.store_code}</strong>{' '}
                    <span className="badge badge-secondary ml-xs">Supports All-Store Bulk Upload</span> •
                    Expected Columns: <code>week, order_date, site_code, dp_id, order_id, Ride Name, abuse_flag, delivery_time, scan_data_delivered</code>
                  </>
                ) : (
                  <>
                    Target Store: <strong>{selectedStore?.store_code}</strong>{' '}
                    <span className="badge badge-secondary ml-xs">Supports All-Store Bulk Upload</span> •
                    Expected Columns: <code>City, Warehouse Id, Date, Hour, Order</code> (Updates uploaded dates, preserves history)
                  </>
                )}
              </p>
            </div>

            <button
              type="button"
              className="btn btn-secondary btn-sm dropzone-btn"
              disabled={isBusy}
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              Browse File
            </button>
          </div>
        </div>
      </div>

      {/* 3. Popups & Modals */}
      {/* Error Popup Modal */}
      {errorModalData && (
        <UploadErrorModal
          filename={errorModalData.filename}
          errors={errorModalData.errors}
          rowErrors={errorModalData.rowErrors}
          onClose={() => setErrorModalData(null)}
        />
      )}

      {/* DNR Confirmation Modal */}
      {showDnrConfirm && dnrParseResult && selectedStore && (
        <DnrConfirmModal
          store={selectedStore}
          filename={dnrParseResult.filename}
          totalRecords={dnrParseResult.valid_records.length}
          nonAbusiveCount={dnrParseResult.nonAbusiveCount}
          potentialAbuseCount={dnrParseResult.potentialAbuseCount}
          siteCodesFound={dnrParseResult.siteCodesFound}
          sampleRecords={dnrParseResult.valid_records.slice(0, 5).map((r) => ({
            orderId: r.orderId,
            riderName: r.riderName,
            abuseFlag: r.abuseFlag,
            scanDataDelivered: r.scanDataDelivered,
          }))}
          warnings={dnrParseResult.warnings}
          isSaving={isSavingDnr}
          onCancel={() => {
            setShowDnrConfirm(false);
            resetFileInput();
          }}
          onConfirm={() => void handleConfirmDnrUpload()}
        />
      )}

      {/* DNR Success Modal */}
      {showDnrSuccess && dnrSummary && selectedStore && (
        <DnrSuccessModal
          storeCode={selectedStore.store_code}
          storesUpdated={dnrStoresUpdated}
          totalRecords={dnrSummary.totalRecords}
          nonAbusiveCount={dnrSummary.totalNonAbusive}
          potentialAbuseCount={dnrSummary.totalPotentialAbuse}
          lastUpdatedFormatted={dnrSummary.lastUpdatedFormatted || 'Just now'}
          onDone={() => {
            setShowDnrSuccess(false);
          }}
        />
      )}

      {/* SNOP Forecast Confirmation Modal */}
      {showSnopConfirm && snopParseResult && selectedStore && (
        <SnopConfirmModal
          store={selectedStore}
          filename={snopParseResult.filename}
          totalRows={snopParseResult.total_rows}
          startDate={snopParseResult.start_date}
          endDate={snopParseResult.end_date}
          totalProjectedOrders={snopParseResult.total_projected_orders}
          warehouseCodesFound={snopParseResult.warehouseCodesFound}
          sampleRecords={snopParseResult.records.slice(0, 5)}
          warnings={snopParseResult.warnings}
          isSaving={isSavingSnop}
          onCancel={() => {
            setShowSnopConfirm(false);
            resetFileInput();
          }}
          onConfirm={() => void handleConfirmSnopUpload()}
        />
      )}

      {/* SNOP Forecast Success Modal */}
      {showSnopSuccess && snopMeta && selectedStore && (
        <SnopSuccessModal
          storeCode={selectedStore.store_code}
          warehousesUpdated={snopWarehousesUpdated}
          totalRows={snopMeta.totalRows}
          startDate={snopMeta.startDate}
          endDate={snopMeta.endDate}
          totalProjectedOrders={snopMeta.totalProjectedOrders}
          onGoToPlanning={onNavigateToPlanning}
          onDone={() => {
            setShowSnopSuccess(false);
          }}
        />
      )}
    </div>
  );
};
