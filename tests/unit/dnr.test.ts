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
  (globalThis as unknown as { localStorage: LocalStorageMock }).localStorage =
    new LocalStorageMock();
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

    it('identifies Sehbudi Shekh as a frequent exploiter with 2 Non_abusive delivery cases', () => {
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

    it('aggregates TPE2 store summary correctly with 1 Non_abusive case and 1 Potential_abuse case', () => {
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

    it('deduplicates records with identical orderId in saveDnrRecords so batch upserts never conflict', async () => {
      const res = await saveDnrRecords({
        filename: 'duplicate_order_batch.xlsx',
        records: [
          {
            siteCode: 'TPH1',
            orderId: 'DUP-ORDER-101',
            riderName: 'Test Rider',
            normalizedRiderName: 'test rider',
            abuseFlag: 'Potential_abuse',
          },
          {
            siteCode: 'TPH1',
            orderId: 'DUP-ORDER-101',
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
      const matched = master.filter((r) => r.orderId === 'DUP-ORDER-101');
      expect(matched).toHaveLength(1);
      expect(matched[0].abuseFlag).toBe('Non_abusive');
    });

    it('supports bulk multi-store DNR upload and reflects records to their respective stores', async () => {
      const res = await saveDnrRecords({
        filename: 'bulk_multi_store_dnr.xlsx',
        records: [
          {
            siteCode: 'TPH1',
            orderId: 'MULTI-TPH1-01',
            riderName: 'Rider Alpha',
            normalizedRiderName: 'rider alpha',
            abuseFlag: 'Non_abusive',
          },
          {
            siteCode: 'TMK7',
            orderId: 'MULTI-TMK7-01',
            riderName: 'Rider Beta',
            normalizedRiderName: 'rider beta',
            abuseFlag: 'Potential_abuse',
          },
          {
            siteCode: 'TPE2',
            orderId: 'MULTI-TPE2-01',
            riderName: 'Rider Gamma',
            normalizedRiderName: 'rider gamma',
            abuseFlag: 'Non_abusive',
          },
        ],
        uploadedBy: 'Admin',
      });

      expect(res.ok).toBe(true);
      expect(res.totalSaved).toBe(3);
      expect(res.storesUpdated).toEqual(['TMK7', 'TPE2', 'TPH1']);

      const summaryTph1 = getDnrSummaryForStore('TPH1');
      expect(summaryTph1.records.some((r) => r.orderId === 'MULTI-TPH1-01')).toBe(true);

      const summaryTmk7 = getDnrSummaryForStore('TMK7');
      expect(summaryTmk7.records.some((r) => r.orderId === 'MULTI-TMK7-01')).toBe(true);

      const summaryTpe2 = getDnrSummaryForStore('TPE2');
      expect(summaryTpe2.records.some((r) => r.orderId === 'MULTI-TPE2-01')).toBe(true);
    });
  });

  describe('6. Highlight DNR Priority Sorting', () => {
    it('sorts riders with DNR cases to the top with frequent exploiters first', () => {
      const summary = getDnrSummaryForStore('TPH1');

      // Riders sample
      const riders = [
        { riderName: 'Aaron Zebra' }, // No DNR
        { riderName: 'Nagnath Datta Kokate' }, // 1 DNR (Non_abusive)
        { riderName: 'Sehbudi Shekh' }, // 2 DNRs (Frequent Exploiter)
        { riderName: 'Zachary Apple' }, // No DNR
      ];

      const sortWithHighlight = (highlight: boolean) => {
        return [...riders].sort((a, b) => {
          if (highlight) {
            const normA = normalizeRiderName(a.riderName);
            const normB = normalizeRiderName(b.riderName);
            const dnrA = summary.riderSummariesMap.get(normA);
            const dnB = summary.riderSummariesMap.get(normB);
            const countA = dnrA?.totalDnrCount ?? 0;
            const countB = dnB?.totalDnrCount ?? 0;
            const isDnrA = countA > 0;
            const isDnrB = countB > 0;

            if (isDnrA !== isDnrB) {
              return isDnrA ? -1 : 1;
            }

            if (isDnrA && isDnrB) {
              const freqA = dnrA?.isFrequentExploiter ? 1 : 0;
              const freqB = dnB?.isFrequentExploiter ? 1 : 0;
              if (freqA !== freqB) {
                return freqB - freqA;
              }
              const nonAbusiveA = dnrA?.nonAbusiveCount ?? 0;
              const nonAbusiveB = dnB?.nonAbusiveCount ?? 0;
              if (nonAbusiveA !== nonAbusiveB) {
                return nonAbusiveB - nonAbusiveA;
              }
              if (countA !== countB) {
                return countB - countA;
              }
            }
          }
          return a.riderName.localeCompare(b.riderName);
        });
      };

      // When highlight is OFF: alphabetical sort
      const unhighlighted = sortWithHighlight(false);
      expect(unhighlighted.map((r) => r.riderName)).toEqual([
        'Aaron Zebra',
        'Nagnath Datta Kokate',
        'Sehbudi Shekh',
        'Zachary Apple',
      ]);

      // When highlight is ON: Sehbudi Shekh (frequent exploiter) first, then Nagnath, then non-DNR riders
      const highlighted = sortWithHighlight(true);
      expect(highlighted.map((r) => r.riderName)).toEqual([
        'Sehbudi Shekh',
        'Nagnath Datta Kokate',
        'Aaron Zebra',
        'Zachary Apple',
      ]);
    });
  });
});
