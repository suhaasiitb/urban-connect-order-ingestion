import * as fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

class LocalStorageMock {
  store: Record<string, string> = {};
  clear() {
    this.store = {};
  }
  getItem(key: string) {
    return this.store[key] || null;
  }
  setItem(key: string, value: string) {
    this.store[key] = String(value);
  }
  removeItem(key: string) {
    delete this.store[key];
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = new LocalStorageMock();
}

import {
  INITIAL_SEED_DNR_RECORDS,
  LOCAL_STORAGE_DNR_LAST_UPLOAD_KEY,
  classifyAbuseFlag,
  getAllMasterDnrRecords,
  getDnrSummaryForStore,
  parseDnrFile,
  saveDnrRecords,
} from '../../src/services/dnrService';
import { normalizeRiderName } from '../../src/services/activeRiderService';

describe('DNR (Delivery Not Received) Service Suite', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('1. Pre-seeded Baseline Audit Dataset', () => {
    it('contains exactly 13 seed records with correct store distribution', () => {
      expect(INITIAL_SEED_DNR_RECORDS).toHaveLength(13);

      const byStore = INITIAL_SEED_DNR_RECORDS.reduce((acc, r) => {
        acc[r.siteCode] = (acc[r.siteCode] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      expect(byStore.TPH1).toBe(8);
      expect(byStore.TMK7).toBe(3);
      expect(byStore.TPE2).toBe(2);
    });

    it('identifies Sehbudi Shekh as a frequent exploiter with 2 genuine non-abusive delivery failures', () => {
      const sehbudiCases = INITIAL_SEED_DNR_RECORDS.filter(
        (r) => normalizeRiderName(r.riderName) === 'sehbudi shekh'
      );
      expect(sehbudiCases).toHaveLength(2);
      expect(sehbudiCases[0].abuseFlag).toBe('Non_abusive');
      expect(sehbudiCases[1].abuseFlag).toBe('Non_abusive');
      expect(sehbudiCases[0].siteCode).toBe('TPH1');
      expect(sehbudiCases[0].dpId).toBe('1083794');
    });
  });

  describe('2. Store Summary & Frequent Exploiter Aggregation', () => {
    it('aggregates TPH1 store summary correctly with 1 frequent exploiter', () => {
      const summary = getDnrSummaryForStore('TPH1');
      expect(summary.siteCode).toBe('TPH1');
      expect(summary.totalRecords).toBe(8);
      expect(summary.totalNonAbusive).toBe(6);
      expect(summary.totalPotentialAbuse).toBe(2);
      expect(summary.frequentExploitersCount).toBe(1);

      const sehbudi = summary.riderSummariesMap.get('sehbudi shekh');
      expect(sehbudi).toBeDefined();
      expect(sehbudi?.totalDnrCount).toBe(2);
      expect(sehbudi?.nonAbusiveCount).toBe(2);
      expect(sehbudi?.potentialAbuseCount).toBe(0);
      expect(sehbudi?.isFrequentExploiter).toBe(true);

      const vislavath = summary.riderSummariesMap.get('vislavath anil naik');
      expect(vislavath).toBeDefined();
      expect(vislavath?.totalDnrCount).toBe(1);
      expect(vislavath?.nonAbusiveCount).toBe(0);
      expect(vislavath?.potentialAbuseCount).toBe(1);
      expect(vislavath?.isFrequentExploiter).toBe(false);
    });

    it('aggregates TMK7 store summary correctly with 3 cases and 0 frequent exploiters', () => {
      const summary = getDnrSummaryForStore('TMK7');
      expect(summary.siteCode).toBe('TMK7');
      expect(summary.totalRecords).toBe(3);
      expect(summary.totalNonAbusive).toBe(0);
      expect(summary.totalPotentialAbuse).toBe(3);
      expect(summary.frequentExploitersCount).toBe(0);

      const chate = summary.riderSummariesMap.get('chate ashok bharat');
      expect(chate).toBeDefined();
      expect(chate?.isFrequentExploiter).toBe(false);
      expect(chate?.potentialAbuseCount).toBe(1);
    });

    it('aggregates TPE2 store summary correctly with 1 genuine failure and 1 customer abuse flag', () => {
      const summary = getDnrSummaryForStore('TPE2');
      expect(summary.siteCode).toBe('TPE2');
      expect(summary.totalRecords).toBe(2);
      expect(summary.totalNonAbusive).toBe(1);
      expect(summary.totalPotentialAbuse).toBe(1);
      expect(summary.frequentExploitersCount).toBe(0);
    });
  });

  describe('3. classifyAbuseFlag Semantics', () => {
    it('classifies Non_abusive correctly', () => {
      expect(classifyAbuseFlag('Non_abusive')).toBe('Non_abusive');
      expect(classifyAbuseFlag('non-abusive')).toBe('Non_abusive');
      expect(classifyAbuseFlag('genuine failure')).toBe('Non_abusive');
      expect(classifyAbuseFlag('Valid Claim')).toBe('Non_abusive');
    });

    it('classifies Potential_abuse correctly', () => {
      expect(classifyAbuseFlag('Potential_abuse')).toBe('Potential_abuse');
      expect(classifyAbuseFlag('potential customer abuse')).toBe('Potential_abuse');
      expect(classifyAbuseFlag('fraud')).toBe('Potential_abuse');
    });
  });

  describe('4. File Parsing with Real User Uploaded Excel File', () => {
    const uploadedFilePath =
      '/Users/suhaasvaddi/.gemini/antigravity/brain/15ed1fa3-415d-490d-a6cc-9636a7705f5e/.user_uploaded/media_1793184745994_bcbdc79d.xlsx';

    it('parses the user-provided Excel workbook successfully', () => {
      if (!fs.existsSync(uploadedFilePath)) return;

      const fileBuffer = fs.readFileSync(uploadedFilePath);
      const arrayBuffer = fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
      );

      const result = parseDnrFile({
        fileBytes: arrayBuffer,
        filename: 'media_1793184745994_bcbdc79d.xlsx',
        targetSiteCode: 'TPH1',
      });

      expect(result.is_valid).toBe(true);
      expect(result.total_rows).toBe(13);
      expect(result.valid_records).toHaveLength(13);
      expect(result.nonAbusiveCount).toBe(7);
      expect(result.potentialAbuseCount).toBe(6);
      expect(result.siteCodesFound).toContain('TPH1');
      expect(result.siteCodesFound).toContain('TPE2');
      expect(result.siteCodesFound).toContain('TMK7');
    });

    it('rejects an empty or invalid workbook gracefully', () => {
      const emptyBuffer = new ArrayBuffer(0);
      const result = parseDnrFile({
        fileBytes: emptyBuffer,
        filename: 'empty.xlsx',
      });

      expect(result.is_valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('5. Persistence & Merge Workflow', () => {
    it('saves new DNR records and updates upload metadata in localStorage', async () => {
      const res = await saveDnrRecords({
        filename: 'custom_dnr_batch.xlsx',
        records: [
          {
            siteCode: 'TPH1',
            orderId: 'ORDER-NEW-999',
            riderName: 'Test Rider',
            normalizedRiderName: 'test rider',
            abuseFlag: 'Non_abusive',
          },
        ],
        uploadedBy: 'Manager',
        targetSiteCode: 'TPH1',
      });

      expect(res.ok).toBe(true);
      expect(res.totalSaved).toBe(1);

      const master = getAllMasterDnrRecords();
      expect(master.some((r) => r.orderId === 'ORDER-NEW-999')).toBe(true);

      const lastUpload = JSON.parse(
        localStorage.getItem(LOCAL_STORAGE_DNR_LAST_UPLOAD_KEY) || '{}'
      );
      expect(lastUpload.filename).toBe('custom_dnr_batch.xlsx');
      expect(lastUpload.uploadedBy).toBe('Manager');
    });
  });
});
