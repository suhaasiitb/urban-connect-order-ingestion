import React, { useCallback, useEffect, useRef, useState } from 'react';
import { parseAndValidateOrderWorkbook } from '../domain/excelParser';
import type { StoreMaster, WorkbookValidationResult } from '../domain/types';
import {
  type CommittedBatchResult,
  submitConfirmedOrderBatch,
} from '../services/ingestionService';
import {
  type StoreCoverageSummary,
  fetchStoreDateCoverage,
} from '../services/storeService';
import {
  type ActiveRosterParseResult,
  type ActiveRosterSummary,
  getActiveRidersRoster,
  parseActiveRidersFile,
  saveActiveRidersRoster,
} from '../services/activeRiderService';
import { StoreCalendarView } from './StoreCalendarView';
import {
  RosterConfirmModal,
  RosterSuccessModal,
  UploadConfirmModal,
  UploadErrorModal,
  UploadSuccessModal,
} from './UploadModals';

interface UploadWorkspaceProps {
  stores: StoreMaster[];
  selectedStoreId: string;
  onSelectStoreId: (storeId: string) => void;
  onBatchCommitted: () => void;
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
  const [isUploading, setIsUploading] = useState(false);

  // Upload Mode: 'orders' (Daily Store Orders) vs 'riders' (Active Riders Roster)
  const [uploadType, setUploadType] = useState<'orders' | 'riders'>('orders');

  // 30-Day Ingestion Coverage
  const [coverage, setCoverage] = useState<StoreCoverageSummary | null>(null);
  const [loadingCoverage, setLoadingCoverage] = useState(false);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);

  // Active Riders Roster state
  const [activeRoster, setActiveRoster] = useState<ActiveRosterSummary | null>(null);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [rosterParseResult, setRosterParseResult] = useState<ActiveRosterParseResult | null>(null);
  const [showRosterConfirm, setShowRosterConfirm] = useState(false);
  const [showRosterSuccess, setShowRosterSuccess] = useState(false);
  const [isSavingRoster, setIsSavingRoster] = useState(false);

  // Validation & Modal states for Orders
  const [validationResult, setValidationResult] =
    useState<WorkbookValidationResult | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [committedResult, setCommittedResult] =
    useState<CommittedBatchResult | null>(null);

  // Error modal state
  const [errorModalData, setErrorModalData] = useState<{
    filename: string;
    errors: string[];
    rowErrors?: Array<{ row: number; message: string }>;
  } | null>(null);

  const selectedStore =
    stores.find((s) => s.id === selectedStoreId) ?? stores[0] ?? null;

  // Load 30-day coverage when selected store changes
  const loadCoverage = useCallback(async () => {
    if (!selectedStore) return;
    setLoadingCoverage(true);
    try {
      const res = await fetchStoreDateCoverage(
        selectedStore.id,
        selectedStore.timezone || 'Asia/Kolkata'
      );
      setCoverage(res.summary);
    } finally {
      setLoadingCoverage(false);
    }
  }, [selectedStore]);

  // Load active riders roster when selected store changes
  const loadRoster = useCallback(async () => {
    if (!selectedStore) return;
    setLoadingRoster(true);
    try {
      const summary = await getActiveRidersRoster(selectedStore.id, selectedStore.store_code);
      setActiveRoster(summary);
    } finally {
      setLoadingRoster(false);
    }
  }, [selectedStore]);

  useEffect(() => {
    void loadCoverage();
    void loadRoster();
  }, [loadCoverage, loadRoster]);

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setValidationResult(null);
    setRosterParseResult(null);
  };

  // Handle file selection and parsing for either Orders or Riders
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

    // 1. Process Active Riders Roster file
    if (uploadType === 'riders') {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const parsed = parseActiveRidersFile({
          fileBytes: arrayBuffer,
          filename: file.name,
          targetStoreCode: selectedStore.store_code,
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

        setRosterParseResult(parsed);
        setShowRosterConfirm(true);
      } catch (err) {
        setParsingFile(false);
        const msg = err instanceof Error ? err.message : String(err);
        setErrorModalData({
          filename: file.name,
          errors: [`Failed to parse active riders file: ${msg}`],
        });
        resetFileInput();
      }
      return;
    }

    // 2. Process Daily Orders report file
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = parseAndValidateOrderWorkbook({
        fileBytes: arrayBuffer,
        filename: file.name,
        store: selectedStore,
      });

      setParsingFile(false);

      if (!result.is_valid) {
        // Collect clear, plain-language error messages
        const topErrors = [...result.file_errors];

        if (result.missing_headers.length > 0) {
          topErrors.push(
            `Missing mandatory columns (${result.missing_headers.length}): ${result.missing_headers.join(', ')}`
          );
        }

        const invalidRows = result.rows
          .filter((r) => !r.is_valid)
          .map((r) => ({
            row: r.source_row_number,
            message:
              r.issues.find((i) => i.severity === 'error')?.message ??
              'Row validation failed',
          }));

        setErrorModalData({
          filename: file.name,
          errors:
            topErrors.length > 0
              ? topErrors
              : [`${invalidRows.length} row(s) failed business validation checks.`],
          rowErrors: invalidRows,
        });
        resetFileInput();
        return;
      }

      // Valid: open the clean confirmation prompt
      setValidationResult(result);
      setShowConfirmModal(true);
    } catch (err) {
      setParsingFile(false);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorModalData({
        filename: file.name,
        errors: [`Failed to read file: ${msg}`],
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

  // Confirm and upload daily orders batch
  const handleConfirmUpload = async () => {
    if (!selectedStore || !validationResult) return;

    setIsUploading(true);

    try {
      const result = await submitConfirmedOrderBatch({
        storeId: selectedStore.id,
        storeCode: selectedStore.store_code,
        validation: validationResult,
        forceReprocess: true,
      });

      setIsUploading(false);
      setShowConfirmModal(false);

      if (!result.ok) {
        setErrorModalData({
          filename: validationResult.filename,
          errors: [
            result.error_message ||
              'Upload rejected under strict all-or-nothing validation.',
          ],
        });
        resetFileInput();
        return;
      }

      // Succeeded: show success popup!
      setCommittedResult(result);
      setShowSuccessModal(true);
      resetFileInput();
      onBatchCommitted();
    } catch (err) {
      setIsUploading(false);
      setShowConfirmModal(false);
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setErrorModalData({
        filename: validationResult.filename,
        errors: [`Ingestion request failed: ${msg}`],
      });
      resetFileInput();
    }
  };

  // Confirm and save active riders roster
  const handleConfirmRosterUpload = async () => {
    if (!selectedStore || !rosterParseResult) return;

    setIsSavingRoster(true);

    try {
      const result = await saveActiveRidersRoster({
        storeId: selectedStore.id,
        storeCode: selectedStore.store_code,
        filename: rosterParseResult.filename,
        riders: rosterParseResult.valid_riders,
      });

      setIsSavingRoster(false);
      setShowRosterConfirm(false);

      if (!result.ok) {
        setErrorModalData({
          filename: rosterParseResult.filename,
          errors: [result.error || 'Failed to save active riders roster.'],
        });
        resetFileInput();
        return;
      }

      await loadRoster();
      setShowRosterSuccess(true);
      resetFileInput();
      onBatchCommitted();
    } catch (err) {
      setIsSavingRoster(false);
      setShowRosterConfirm(false);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorModalData({
        filename: rosterParseResult.filename,
        errors: [`Could not save roster: ${msg}`],
      });
      resetFileInput();
    }
  };

  const handleDismissSuccess = () => {
    setShowSuccessModal(false);
    setCommittedResult(null);
    void loadCoverage(); // Re-fetch 30-day status so the date turns green!
  };

  const isCurrentBusinessDateUploaded = Boolean(
    validationResult?.min_order_date &&
      coverage?.days.find(
        (d) => d.dateStr === validationResult.min_order_date && d.isUploaded
      )
  );

  return (
    <div className="upload-portal-container">
      {/* 1. Store Selector Section */}
      <div className="section-card store-selector-card">
        <div className="store-selector-row">
          <div className="store-title-group">
            <span className="section-step">Step 1</span>
            <div>
              <h2 className="section-title">Select Store</h2>
              <p className="section-subtitle">
                Choose the store for which you are uploading data
              </p>
            </div>
          </div>

          <div className="store-control">
            <select
              id="store-select"
              className="store-dropdown"
              value={selectedStoreId}
              onChange={(e) => onSelectStoreId(e.target.value)}
              disabled={parsingFile || isUploading || isSavingRoster}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.store_code} — {s.store_name} (ID: {s.external_store_id ?? 'N/A'})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 2. 30-Day Coverage Calendar (shown in Orders mode) */}
      {selectedStore && uploadType === 'orders' && (
        <StoreCalendarView
          storeCode={selectedStore.store_code}
          storeName={selectedStore.store_name}
          coverage={coverage}
          loading={loadingCoverage}
          onRefresh={() => void loadCoverage()}
          onSelectDate={(d) => setSelectedCalendarDate(d)}
          selectedDate={selectedCalendarDate}
        />
      )}

      {/* 3. File Upload Section */}
      <div className="section-card upload-dropzone-card">
        {/* Step 2 Header & Upload Mode Switch */}
        <div className="upload-header-row">
          <div className="upload-header">
            <span className="section-step">Step 2</span>
            <div>
              <h2 className="section-title">
                {uploadType === 'orders' ? 'Upload Daily Orders' : 'Upload Active Riders Roster'}
              </h2>
              <p className="section-subtitle">
                {uploadType === 'orders'
                  ? `Upload the daily orders file (.csv or .xlsx) for ${selectedStore?.store_code ?? 'store'}.`
                  : `Upload active riders list (.csv) for ${selectedStore?.store_code ?? 'store'} to mark Active (Yes/No).`}
              </p>
            </div>
          </div>

          {/* Mode Switch: Daily Orders vs Active Riders Roster */}
          <div className="upload-mode-toggle">
            <button
              type="button"
              className={`mode-toggle-btn ${uploadType === 'orders' ? 'mode-toggle-btn-active' : ''}`}
              onClick={() => {
                setUploadType('orders');
                resetFileInput();
              }}
              disabled={parsingFile || isUploading || isSavingRoster}
            >
              <span className="mode-icon">📦</span>
              <span>Daily Orders</span>
            </button>
            <button
              type="button"
              className={`mode-toggle-btn ${uploadType === 'riders' ? 'mode-toggle-btn-active' : ''}`}
              onClick={() => {
                setUploadType('riders');
                resetFileInput();
              }}
              disabled={parsingFile || isUploading || isSavingRoster}
            >
              <span className="mode-icon">🚴</span>
              <span>Active Riders</span>
              {activeRoster && activeRoster.totalRiders > 0 && (
                <span className="mode-pill-badge">{activeRoster.totalRiders}</span>
              )}
            </button>
          </div>
        </div>

        {/* Active Riders Status Banner (shown when in Riders mode) */}
        {uploadType === 'riders' && (
          <div className="roster-status-banner">
            <div className="roster-status-main">
              <span className="roster-status-icon-box">🚴</span>
              <div className="roster-status-content">
                <div className="roster-status-heading-row">
                  <h4 className="roster-status-heading">
                    Active Roster for {selectedStore?.store_code} ({selectedStore?.store_name})
                  </h4>
                  {loadingRoster && <span className="roster-loading-tag">Checking roster...</span>}
                </div>
                <p className="roster-status-info">
                  {activeRoster && activeRoster.totalRiders > 0 ? (
                    <>
                      Currently <strong>{activeRoster.totalRiders} active riders</strong> registered.{' '}
                      Last updated: <strong>{activeRoster.lastUpdatedFormatted}</strong>
                      {activeRoster.filename && (
                        <> (file: <span className="mono">{activeRoster.filename}</span>)</>
                      )}.
                    </>
                  ) : (
                    'No active riders roster has been uploaded yet for this store. Riders in Store Analytics will show Active as "No" until a roster is uploaded.'
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
            if (!parsingFile && !isUploading && !isSavingRoster) {
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
            disabled={parsingFile || isUploading || isSavingRoster}
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
                  ? uploadType === 'riders'
                    ? 'Validating active riders roster...'
                    : 'Analyzing and validating order file...'
                  : uploadType === 'riders'
                  ? 'Click to select or drag and drop Active Riders CSV'
                  : 'Click to select or drag and drop store order file (.csv or .xlsx)'}
              </strong>
              <p>
                {uploadType === 'riders' ? (
                  <>
                    Target Store: <strong>{selectedStore?.store_code}</strong> • Expected Columns:{' '}
                    <code>Name, Phone, Online Status, Eligibility, Attendance, Store</code>
                  </>
                ) : selectedStore ? (
                  <>
                    Target Store: <strong>{selectedStore.store_code}</strong> • Supports daily order exports
                  </>
                ) : (
                  'Please select a store first'
                )}
              </p>
            </div>

            <button
              type="button"
              className="btn btn-secondary btn-sm dropzone-btn"
              disabled={parsingFile || isUploading || isSavingRoster}
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

      {/* 4. Popups & Modals */}
      {/* Error Popup Modal */}
      {errorModalData && (
        <UploadErrorModal
          filename={errorModalData.filename}
          errors={errorModalData.errors}
          rowErrors={errorModalData.rowErrors}
          onClose={() => setErrorModalData(null)}
        />
      )}

      {/* Orders Confirmation & Ingestion Prompt Modal */}
      {showConfirmModal && validationResult && selectedStore && (
        <UploadConfirmModal
          store={selectedStore}
          validation={validationResult}
          isDateAlreadyUploaded={isCurrentBusinessDateUploaded}
          isUploading={isUploading}
          onCancel={() => {
            setShowConfirmModal(false);
            resetFileInput();
          }}
          onConfirm={() => void handleConfirmUpload()}
        />
      )}

      {/* Orders Success Modal */}
      {showSuccessModal && committedResult && (
        <UploadSuccessModal
          result={committedResult}
          onDone={handleDismissSuccess}
        />
      )}

      {/* Active Riders Roster Confirmation Modal */}
      {showRosterConfirm && rosterParseResult && selectedStore && (
        <RosterConfirmModal
          store={selectedStore}
          filename={rosterParseResult.filename}
          totalRiders={rosterParseResult.valid_riders.length}
          sampleRiders={rosterParseResult.valid_riders.map((r) => r.name)}
          warnings={rosterParseResult.warnings}
          isSaving={isSavingRoster}
          onCancel={() => {
            setShowRosterConfirm(false);
            resetFileInput();
          }}
          onConfirm={() => void handleConfirmRosterUpload()}
        />
      )}

      {/* Active Riders Roster Success Modal */}
      {showRosterSuccess && activeRoster && selectedStore && (
        <RosterSuccessModal
          storeCode={selectedStore.store_code}
          totalRiders={activeRoster.totalRiders}
          lastUpdatedFormatted={activeRoster.lastUpdatedFormatted || 'Just now'}
          onDone={() => {
            setShowRosterSuccess(false);
          }}
        />
      )}
    </div>
  );
};
