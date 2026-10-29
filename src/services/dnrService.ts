// ==============================================================================
// Delivery Not Received (DNR) Service
// Handles parsing, validation, persistence, and rider/store analytics for DNR cases.
// Supports dual-persistence: Supabase tables with instant localStorage fallback.
// ==============================================================================

import * as XLSX from 'xlsx';
import { supabase } from '../config/supabaseClient';
import { normalizeRiderName } from './activeRiderService';

export type DnrAbuseFlag = 'Non_abusive' | 'Potential_abuse';

export interface DnrRecord {
  id?: string;
  week?: number | string;
  orderDate?: string;
  siteCode: string;
  dpId?: string;
  orderId: string;
  riderName: string;
  normalizedRiderName: string;
  markedDelFrom?: string;
  abuseFlag: DnrAbuseFlag;
  deliveryTime?: string;
  scanDataDelivered?: string;
  uploadedAt?: string;
}

export interface RiderDnrSummary {
  riderName: string;
  normalizedRiderName: string;
  dpId?: string;
  siteCode: string;
  totalDnrCount: number;
  nonAbusiveCount: number; // Genuine non-delivery failure by rider
  potentialAbuseCount: number; // Suspected customer abuse / fraudulent claim
  isFrequentExploiter: boolean; // Flagged if rider has 2+ DNRs or 2+ non-abusive failures
  records: DnrRecord[];
}

export interface StoreDnrSummary {
  siteCode: string;
  totalRecords: number;
  totalNonAbusive: number;
  totalPotentialAbuse: number;
  totalRidersAffected: number;
  frequentExploitersCount: number;
  lastUpdated: string | null;
  lastUpdatedFormatted: string | null;
  filename: string | null;
  riderSummariesMap: Map<string, RiderDnrSummary>;
  records: DnrRecord[];
}

export interface DnrParseResult {
  is_valid: boolean;
  filename: string;
  total_rows: number;
  valid_records: DnrRecord[];
  errors: string[];
  warnings: string[];
  siteCodesFound: string[];
  nonAbusiveCount: number;
  potentialAbuseCount: number;
}

// Master storage keys for dual-persistence fallback
export const LOCAL_STORAGE_DNR_MASTER_KEY = 'urban_connect_dnr_records_master';
export const LOCAL_STORAGE_DNR_LAST_UPLOAD_KEY = 'urban_connect_dnr_last_upload';

/**
 * Pre-seeded default DNR cases provided as baseline audit records.
 * Seeded across TPH1, TPE2, and TMK7 with genuine non-abusive cases and customer abuse flags.
 */
export const INITIAL_SEED_DNR_RECORDS: DnrRecord[] = [
  {
    week: 43,
    orderDate: '2026-10-21 00:00',
    siteCode: 'TPH1',
    dpId: '1083794',
    orderId: '405-8852180-8267501',
    riderName: 'Sehbudi Shekh',
    normalizedRiderName: 'sehbudi shekh',
    markedDelFrom: 'From App',
    abuseFlag: 'Non_abusive',
    deliveryTime: '2026-10-22 00:12',
    scanDataDelivered: '0-30m',
  },
  {
    week: 43,
    orderDate: '2026-10-18 00:00',
    siteCode: 'TPE2',
    dpId: '1121550',
    orderId: '408-1216432-6134753',
    riderName: 'Prathamesh Balasaheb Kadam',
    normalizedRiderName: 'prathamesh balasaheb kadam',
    markedDelFrom: 'From App',
    abuseFlag: 'Potential_abuse',
    deliveryTime: '2026-10-18 10:33',
    scanDataDelivered: '0-30m',
  },
  {
    week: 43,
    orderDate: '2026-10-22 00:00',
    siteCode: 'TPH1',
    dpId: '768878',
    orderId: '171-2515326-5568315',
    riderName: 'VISLAVATH ANIL NAIK',
    normalizedRiderName: 'vislavath anil naik',
    markedDelFrom: 'Manual',
    abuseFlag: 'Potential_abuse',
    deliveryTime: '2026-10-22 21:16',
    scanDataDelivered: '>500m',
  },
  {
    week: 43,
    orderDate: '2026-10-22 00:00',
    siteCode: 'TMK7',
    dpId: '724190',
    orderId: '408-0582958-9981911',
    riderName: 'Chate Ashok Bharat',
    normalizedRiderName: 'chate ashok bharat',
    markedDelFrom: 'From App',
    abuseFlag: 'Potential_abuse',
    deliveryTime: '2026-10-22 16:09',
    scanDataDelivered: '0-30m',
  },
  {
    week: 43,
    orderDate: '2026-10-19 00:00',
    siteCode: 'TPH1',
    dpId: '888547',
    orderId: '404-5173617-4043512',
    riderName: 'Nagnath Datta Kokate',
    normalizedRiderName: 'nagnath datta kokate',
    markedDelFrom: 'From App',
    abuseFlag: 'Non_abusive',
    deliveryTime: '2026-10-19 20:29',
    scanDataDelivered: '0-30m',
  },
  {
    week: 43,
    orderDate: '2026-10-18 00:00',
    siteCode: 'TPH1',
    dpId: '1035267',
    orderId: '406-0769305-3459565',
    riderName: 'Ramrao Utthamrao Rathod',
    normalizedRiderName: 'ramrao utthamrao rathod',
    markedDelFrom: 'From App',
    abuseFlag: 'Non_abusive',
    deliveryTime: '2026-10-18 20:16',
    scanDataDelivered: '0-30m',
  },
  {
    week: 43,
    orderDate: '2026-10-19 00:00',
    siteCode: 'TPH1',
    dpId: '767944',
    orderId: '406-6156536-1520306',
    riderName: 'Sunil ',
    normalizedRiderName: 'sunil',
    markedDelFrom: 'Manual',
    abuseFlag: 'Non_abusive',
    deliveryTime: '2026-10-19 19:01',
    scanDataDelivered: '>500m',
  },
  {
    week: 43,
    orderDate: '2026-10-18 00:00',
    siteCode: 'TMK7',
    dpId: '1067791',
    orderId: '406-3978694-5733940',
    riderName: 'Rider (DP: 1067791)',
    normalizedRiderName: 'dp:1067791',
    markedDelFrom: 'From App',
    abuseFlag: 'Potential_abuse',
    deliveryTime: '2026-10-18 00:12',
    scanDataDelivered: '50-100m',
  },
  {
    week: 43,
    orderDate: '2026-10-19 00:00',
    siteCode: 'TPH1',
    dpId: '938424',
    orderId: '404-9709272-3993968',
    riderName: 'Manohar Prabhakar Budhavant',
    normalizedRiderName: 'manohar prabhakar budhavant',
    markedDelFrom: 'From App',
    abuseFlag: 'Potential_abuse',
    deliveryTime: '2026-10-19 14:19',
    scanDataDelivered: '0-30m',
  },
  {
    week: 43,
    orderDate: '2026-10-18 00:00',
    siteCode: 'TMK7',
    dpId: '1030709',
    orderId: '407-0286236-8549956',
    riderName: 'HEMANT DHOTRE',
    normalizedRiderName: 'hemant dhotre',
    markedDelFrom: 'From App',
    abuseFlag: 'Potential_abuse',
    deliveryTime: '2026-10-18 19:10',
    scanDataDelivered: '0-30m',
  },
  {
    week: 43,
    orderDate: '2026-10-20 00:00',
    siteCode: 'TPH1',
    dpId: '1083794',
    orderId: '171-0205363-5333955',
    riderName: 'Sehbudi Shekh',
    normalizedRiderName: 'sehbudi shekh',
    markedDelFrom: 'From App',
    abuseFlag: 'Non_abusive',
    deliveryTime: '2026-10-20 18:19',
    scanDataDelivered: '0-30m',
  },
  {
    week: 43,
    orderDate: '2026-10-19 00:00',
    siteCode: 'TPE2',
    dpId: '1126116',
    orderId: '405-4470710-1402748',
    riderName: 'JETHARAM CHOUDHARY',
    normalizedRiderName: 'jetharam choudhary',
    markedDelFrom: 'From App',
    abuseFlag: 'Non_abusive',
    deliveryTime: '2026-10-19 13:10',
    scanDataDelivered: '50-100m',
  },
  {
    week: 43,
    orderDate: '2026-10-18 00:00',
    siteCode: 'TPH1',
    dpId: '875863',
    orderId: '408-5264812-3578756',
    riderName: 'Sushil Kumar Rai',
    normalizedRiderName: 'sushil kumar rai',
    markedDelFrom: 'Manual',
    abuseFlag: 'Non_abusive',
    deliveryTime: '2026-10-18 14:08',
    scanDataDelivered: '>500m',
  },
];

/**
 * Formats an ISO date or timestamp into a user-friendly timestamp in Asia/Kolkata timezone.
 */
export function formatDnrTimestamp(isoStr: string | null | undefined): string | null {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return null;
  }
}

/**
 * Normalizes raw date values from Excel or CSV to clean strings.
 */
function formatRawDate(val: unknown): string {
  if (!val) return '';
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return '';
    return val.toISOString().replace('T', ' ').substring(0, 16);
  }
  if (typeof val === 'number') {
    try {
      const date = new Date((val - (25567 + 2)) * 86400 * 1000);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().replace('T', ' ').substring(0, 16);
      }
    } catch {
      // ignore
    }
  }
  return String(val).trim();
}

/**
 * Classifies the abuse flag string into canonical 'Non_abusive' or 'Potential_abuse'.
 */
export function classifyAbuseFlag(val: unknown): DnrAbuseFlag {
  const str = String(val ?? '').trim().toLowerCase();
  if (str.includes('non') || str.includes('genuin') || str.includes('valid')) {
    return 'Non_abusive';
  }
  if (str.includes('pot') || str.includes('abuse') || str.includes('fraud')) {
    return 'Potential_abuse';
  }
  return 'Non_abusive';
}

/**
 * Parses and validates an uploaded DNR file (.csv or .xlsx).
 */
export function parseDnrFile(params: {
  fileBytes: ArrayBuffer;
  filename: string;
  targetSiteCode?: string;
}): DnrParseResult {
  const { fileBytes, filename, targetSiteCode } = params;
  const warnings: string[] = [];

  try {
    const workbook = XLSX.read(fileBytes, {
      type: 'array',
      raw: false,
      cellDates: true,
    });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return {
        is_valid: false,
        filename,
        total_rows: 0,
        valid_records: [],
        errors: ['The workbook does not contain any sheets.'],
        warnings: [],
        siteCodesFound: [],
        nonAbusiveCount: 0,
        potentialAbuseCount: 0,
      };
    }

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
      defval: '',
      blankrows: false,
    });

    if (rawRows.length === 0) {
      return {
        is_valid: false,
        filename,
        total_rows: 0,
        valid_records: [],
        errors: ['The uploaded DNR sheet contains no data rows.'],
        warnings: [],
        siteCodesFound: [],
        nonAbusiveCount: 0,
        potentialAbuseCount: 0,
      };
    }

    // Inspect headers
    const sampleKeys = Object.keys(rawRows[0]);
    const findKey = (patterns: RegExp[]): string | undefined => {
      return sampleKeys.find((k) => {
        const clean = k.trim().toLowerCase();
        return patterns.some((p) => p.test(clean));
      });
    };

    const weekKey = findKey([/^week$/i]);
    const orderDateKey = findKey([/order[_\s]*date/i, /^date$/i]);
    const siteKey = findKey([/site[_\s]*code/i, /^store/i, /^site/i]);
    const dpIdKey = findKey([/dp[_\s]*id/i, /rider[_\s]*id/i]);
    const orderIdKey = findKey([/^order[_\s]*id$/i, /order[_\s]*id/i, /tracking/i]);
    const riderNameKey = findKey([/ride[_\s]*name/i, /rider[_\s]*name/i, /^name$/i]);
    const markedDelKey = findKey([/marked[_\s]*del/i, /marked[_\s]*from/i, /source/i]);
    const abuseKey = findKey([/abuse[_\s]*flag/i, /^abuse$/i, /^flag$/i]);
    const delivTimeKey = findKey([/deliv.*time/i, /time/i]);
    const scanDataKey = findKey([/scan.*deliv/i, /scan.*data/i, /distance/i]);

    if (!orderIdKey && !siteKey && !riderNameKey) {
      return {
        is_valid: false,
        filename,
        total_rows: rawRows.length,
        valid_records: [],
        errors: [
          `File does not contain expected DNR columns (e.g. "order_id", "site_code", "Ride Name", "abuse_flag"). Found headers: ${sampleKeys.join(', ')}`,
        ],
        warnings: [],
        siteCodesFound: [],
        nonAbusiveCount: 0,
        potentialAbuseCount: 0,
      };
    }

    const dedupedByOrderId = new Map<string, DnrRecord>();
    const siteCodesSet = new Set<string>();

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];

      const rawOrderId = orderIdKey ? String(row[orderIdKey] ?? '').trim() : '';
      if (!rawOrderId && !dpIdKey && !riderNameKey) continue;

      const orderId = rawOrderId || `DNR-ROW-${i + 1}-${Date.now()}`;
      const rawSite = siteKey ? String(row[siteKey] ?? '').trim().toUpperCase() : '';
      const siteCode = rawSite || targetSiteCode || 'STORE';
      if (siteCode) siteCodesSet.add(siteCode);

      const rawDpId = dpIdKey ? String(row[dpIdKey] ?? '').trim() : '';
      const rawName = riderNameKey ? String(row[riderNameKey] ?? '').trim() : '';
      const riderName = rawName || (rawDpId ? `Rider (DP: ${rawDpId})` : 'Unassigned Rider');
      const normalizedRiderName = normalizeRiderName(rawName) || (rawDpId ? `dp:${rawDpId}` : '');

      const abuseFlag = classifyAbuseFlag(abuseKey ? row[abuseKey] : 'Non_abusive');

      dedupedByOrderId.set(orderId, {
        week: weekKey ? String(row[weekKey] ?? '').trim() : undefined,
        orderDate: orderDateKey ? formatRawDate(row[orderDateKey]) : undefined,
        siteCode,
        dpId: rawDpId || undefined,
        orderId,
        riderName,
        normalizedRiderName,
        markedDelFrom: markedDelKey ? String(row[markedDelKey] ?? '').trim() : undefined,
        abuseFlag,
        deliveryTime: delivTimeKey ? formatRawDate(row[delivTimeKey]) : undefined,
        scanDataDelivered: scanDataKey ? String(row[scanDataKey] ?? '').trim() : undefined,
      });
    }

    const validRecords: DnrRecord[] = Array.from(dedupedByOrderId.values());
    let nonAbusiveCount = 0;
    let potentialAbuseCount = 0;
    for (const rec of validRecords) {
      if (rec.abuseFlag === 'Non_abusive') {
        nonAbusiveCount++;
      } else {
        potentialAbuseCount++;
      }
    }

    if (validRecords.length === 0) {
      return {
        is_valid: false,
        filename,
        total_rows: rawRows.length,
        valid_records: [],
        errors: ['No valid DNR records found in the uploaded file.'],
        warnings: [],
        siteCodesFound: [],
        nonAbusiveCount: 0,
        potentialAbuseCount: 0,
      };
    }

    const siteCodesFound = Array.from(siteCodesSet).sort();
    if (targetSiteCode && siteCodesFound.length > 1 && !siteCodesSet.has(targetSiteCode)) {
      warnings.push(
        `File contains records for stores [${siteCodesFound.join(', ')}]. Records will be mapped and saved for their respective stores.`
      );
    } else if (siteCodesFound.length > 1) {
      warnings.push(
        `Bulk multi-store DNR upload detected: contains records for ${siteCodesFound.length} stores (${siteCodesFound.join(', ')}). Each store's DNR metrics will be updated.`
      );
    }

    return {
      is_valid: true,
      filename,
      total_rows: rawRows.length,
      valid_records: validRecords,
      errors: [],
      warnings,
      siteCodesFound,
      nonAbusiveCount,
      potentialAbuseCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      is_valid: false,
      filename,
      total_rows: 0,
      valid_records: [],
      errors: [`Failed to parse DNR file: ${msg}`],
      warnings: [],
      siteCodesFound: [],
      nonAbusiveCount: 0,
      potentialAbuseCount: 0,
    };
  }
}

/**
 * Loads all master DNR records from localStorage or falls back to pre-seeded dataset.
 */
export function getAllMasterDnrRecords(): DnrRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_DNR_MASTER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as DnrRecord[];
      }
    }
  } catch {
    // ignore
  }

  // Fallback: seed initial records into localStorage
  try {
    localStorage.setItem(
      LOCAL_STORAGE_DNR_MASTER_KEY,
      JSON.stringify(INITIAL_SEED_DNR_RECORDS)
    );
    localStorage.setItem(
      LOCAL_STORAGE_DNR_LAST_UPLOAD_KEY,
      JSON.stringify({
        filename: 'Amazon_DNR_Baseline_Audit.xlsx',
        uploadedAt: '2026-10-22T18:00:00.000Z',
        totalRecords: INITIAL_SEED_DNR_RECORDS.length,
        nonAbusiveCount: INITIAL_SEED_DNR_RECORDS.filter((r) => r.abuseFlag === 'Non_abusive').length,
        potentialAbuseCount: INITIAL_SEED_DNR_RECORDS.filter((r) => r.abuseFlag === 'Potential_abuse').length,
        uploadedBy: 'System Pre-seed',
      })
    );
  } catch {
    // ignore
  }

  return INITIAL_SEED_DNR_RECORDS;
}

/**
 * Saves DNR records to both Supabase and localStorage fallback.
 */
export async function saveDnrRecords(params: {
  filename: string;
  records: DnrRecord[];
  uploadedBy?: string;
  targetSiteCode?: string;
}): Promise<{
  ok: boolean;
  totalSaved: number;
  lastUpdated: string;
  storesUpdated?: string[];
  error?: string;
}> {
  const { filename, records, uploadedBy, targetSiteCode } = params;
  const nowIso = new Date().toISOString();

  // Deduplicate incoming records by orderId so batch upserts never conflict with themselves
  const uniqueBatchMap = new Map<string, DnrRecord>();
  const storesSet = new Set<string>();
  for (const r of records) {
    if (r.orderId) {
      uniqueBatchMap.set(r.orderId, r);
      if (r.siteCode) storesSet.add(r.siteCode.toUpperCase());
    }
  }
  const uniqueRecords = Array.from(uniqueBatchMap.values());
  const storesUpdated = Array.from(storesSet).sort();

  // 1. Merge into existing master records in localStorage
  try {
    const existing = getAllMasterDnrRecords();
    const orderIdMap = new Map<string, DnrRecord>();
    for (const r of existing) {
      orderIdMap.set(r.orderId, r);
    }
    for (const r of uniqueRecords) {
      orderIdMap.set(r.orderId, {
        ...r,
        uploadedAt: nowIso,
      });
    }

    const merged = Array.from(orderIdMap.values());
    localStorage.setItem(LOCAL_STORAGE_DNR_MASTER_KEY, JSON.stringify(merged));

    const nonAbusive = uniqueRecords.filter((r) => r.abuseFlag === 'Non_abusive').length;
    const potAbuse = uniqueRecords.filter((r) => r.abuseFlag === 'Potential_abuse').length;

    const auditSiteCode =
      storesUpdated.length === 1
        ? storesUpdated[0]
        : storesUpdated.length > 1
        ? 'ALL'
        : targetSiteCode || 'ALL';

    const lastUploadPayload = {
      filename,
      uploadedAt: nowIso,
      totalRecords: uniqueRecords.length,
      nonAbusiveCount: nonAbusive,
      potentialAbuseCount: potAbuse,
      uploadedBy: uploadedBy || 'Admin',
      siteCode: auditSiteCode,
      storesUpdated,
    };

    // Store global upload metadata
    localStorage.setItem(
      LOCAL_STORAGE_DNR_LAST_UPLOAD_KEY,
      JSON.stringify(lastUploadPayload)
    );

    // Also store per-store upload metadata so each store shows the upload timestamp & filename
    for (const store of storesUpdated) {
      const storeRecs = uniqueRecords.filter((r) => r.siteCode.toUpperCase() === store);
      localStorage.setItem(
        `${LOCAL_STORAGE_DNR_LAST_UPLOAD_KEY}_${store}`,
        JSON.stringify({
          ...lastUploadPayload,
          siteCode: store,
          totalRecords: storeRecs.length,
          nonAbusiveCount: storeRecs.filter((r) => r.abuseFlag === 'Non_abusive').length,
          potentialAbuseCount: storeRecs.filter((r) => r.abuseFlag === 'Potential_abuse').length,
        })
      );
    }
  } catch (err) {
    console.warn('Could not save DNR records to localStorage:', err);
  }

  // 2. Attempt persistence to Supabase
  try {
    const chunks = [];
    const CHUNK_SIZE = 500;
    for (let i = 0; i < uniqueRecords.length; i += CHUNK_SIZE) {
      chunks.push(uniqueRecords.slice(i, i + CHUNK_SIZE));
    }

    for (const chunk of chunks) {
      const payload = chunk.map((r) => ({
        site_code: r.siteCode,
        week: r.week != null && String(r.week).trim() !== '' && Number.isFinite(Number(r.week)) ? Math.trunc(Number(r.week)) : null,
        order_date: r.orderDate || null,
        dp_id: r.dpId || null,
        order_id: r.orderId,
        rider_name: r.riderName || null,
        normalized_name: r.normalizedRiderName || null,
        marked_del_from: r.markedDelFrom || null,
        abuse_flag: r.abuseFlag,
        delivery_time: r.deliveryTime || null,
        scan_data_delivered: r.scanDataDelivered || null,
        uploaded_at: nowIso,
      }));

      const { error: upsertErr } = await supabase
        .from('store_dnr_records')
        .upsert(payload, { onConflict: 'order_id' });

      if (upsertErr) {
        // Fallback: if the remote table does not have a UNIQUE(order_id) constraint yet,
        // delete existing matching order_ids and perform a standard insert.
        const orderIds = payload.map((p) => p.order_id);
        await supabase
          .from('store_dnr_records')
          .delete()
          .in('order_id', orderIds);

        const { error: insertErr } = await supabase
          .from('store_dnr_records')
          .insert(payload);

        if (insertErr) {
          console.warn(
            'Supabase store_dnr_records persistence error (using localStorage cache):',
            insertErr.message
          );
          break;
        }
      }
    }

    // Insert upload audit record
    const auditSiteCode =
      storesUpdated.length === 1
        ? storesUpdated[0]
        : storesUpdated.length > 1
        ? 'ALL'
        : targetSiteCode || 'ALL';

    await supabase.from('store_dnr_uploads').insert({
      site_code: auditSiteCode,
      filename,
      total_records: uniqueRecords.length,
      non_abusive_count: uniqueRecords.filter((r) => r.abuseFlag === 'Non_abusive').length,
      potential_abuse_count: uniqueRecords.filter((r) => r.abuseFlag === 'Potential_abuse').length,
      uploaded_at: nowIso,
      uploaded_by: uploadedBy || 'Admin',
    });

    return {
      ok: true,
      totalSaved: uniqueRecords.length,
      lastUpdated: nowIso,
      storesUpdated,
    };
  } catch (err) {
    console.warn('Supabase DNR persistence note (cached safely in localStorage):', err);
    return {
      ok: true,
      totalSaved: uniqueRecords.length,
      lastUpdated: nowIso,
      storesUpdated,
    };
  }
}

/**
 * Returns the aggregated DNR summary for a given store.
 */
export function getDnrSummaryForStore(siteCode: string): StoreDnrSummary {
  const normSite = siteCode.trim().toUpperCase();
  const allRecords = getAllMasterDnrRecords();

  const storeRecords = allRecords.filter((r) => {
    return r.siteCode.trim().toUpperCase() === normSite;
  });

  const riderSummariesMap = new Map<string, RiderDnrSummary>();
  let totalNonAbusive = 0;
  let totalPotentialAbuse = 0;
  let frequentExploitersCount = 0;

  for (const rec of storeRecords) {
    if (rec.abuseFlag === 'Non_abusive') {
      totalNonAbusive++;
    } else {
      totalPotentialAbuse++;
    }

    const key = rec.normalizedRiderName || (rec.dpId ? `dp:${rec.dpId}` : rec.orderId);
    let summary = riderSummariesMap.get(key);
    if (!summary) {
      summary = {
        riderName: rec.riderName,
        normalizedRiderName: key,
        dpId: rec.dpId,
        siteCode: rec.siteCode,
        totalDnrCount: 0,
        nonAbusiveCount: 0,
        potentialAbuseCount: 0,
        isFrequentExploiter: false,
        records: [],
      };
      riderSummariesMap.set(key, summary);
    }

    summary.totalDnrCount++;
    if (rec.abuseFlag === 'Non_abusive') {
      summary.nonAbusiveCount++;
    } else {
      summary.potentialAbuseCount++;
    }
    summary.records.push(rec);

    // Exploit rule: frequent exploitation if totalDnrCount >= 2 or nonAbusiveCount >= 2
    summary.isFrequentExploiter = summary.totalDnrCount >= 2 || summary.nonAbusiveCount >= 2;
  }

  for (const summary of riderSummariesMap.values()) {
    if (summary.isFrequentExploiter) {
      frequentExploitersCount++;
    }
  }

  // Load last upload metadata (check store-specific metadata first, fallback to global)
  let lastUpdated: string | null = null;
  let filename: string | null = null;
  try {
    const rawMeta =
      localStorage.getItem(`${LOCAL_STORAGE_DNR_LAST_UPLOAD_KEY}_${normSite}`) ||
      localStorage.getItem(LOCAL_STORAGE_DNR_LAST_UPLOAD_KEY);
    if (rawMeta) {
      const meta = JSON.parse(rawMeta);
      lastUpdated = meta.uploadedAt || null;
      filename = meta.filename || null;
    }
  } catch {
    // ignore
  }

  return {
    siteCode: normSite,
    totalRecords: storeRecords.length,
    totalNonAbusive,
    totalPotentialAbuse,
    totalRidersAffected: riderSummariesMap.size,
    frequentExploitersCount,
    lastUpdated,
    lastUpdatedFormatted: formatDnrTimestamp(lastUpdated),
    filename,
    riderSummariesMap,
    records: storeRecords,
  };
}

/**
 * Asynchronously synchronizes DNR records from Supabase and returns the up-to-date StoreDnrSummary.
 * Merges Supabase records into the local storage cache so analytics are persistent across all devices.
 */
export async function fetchDnrSummaryForStore(siteCode: string): Promise<StoreDnrSummary> {
  const normSite = siteCode.trim().toUpperCase();

  try {
    const { data: dbRecords, error: recErr } = await supabase
      .from('store_dnr_records')
      .select('*')
      .order('uploaded_at', { ascending: false });

    if (!recErr && dbRecords && dbRecords.length > 0) {
      const mapped: DnrRecord[] = dbRecords.map((r: Record<string, unknown>) => ({
        id: String(r.id ?? ''),
        week: r.week != null ? String(r.week) : undefined,
        orderDate: r.order_date != null ? String(r.order_date) : undefined,
        siteCode: String(r.site_code || '').toUpperCase(),
        dpId: r.dp_id != null ? String(r.dp_id) : undefined,
        orderId: String(r.order_id ?? ''),
        riderName: r.rider_name != null ? String(r.rider_name) : (r.dp_id ? `Rider (DP: ${r.dp_id})` : 'Unassigned Rider'),
        normalizedRiderName: r.normalized_name != null ? String(r.normalized_name) : normalizeRiderName(r.rider_name as string),
        markedDelFrom: r.marked_del_from != null ? String(r.marked_del_from) : undefined,
        abuseFlag: (r.abuse_flag === 'Potential_abuse' ? 'Potential_abuse' : 'Non_abusive') as DnrAbuseFlag,
        deliveryTime: r.delivery_time != null ? String(r.delivery_time) : undefined,
        scanDataDelivered: r.scan_data_delivered != null ? String(r.scan_data_delivered) : undefined,
        uploadedAt: r.uploaded_at != null ? String(r.uploaded_at) : undefined,
      }));

      // Merge into master records in localStorage
      const master = getAllMasterDnrRecords();
      const map = new Map<string, DnrRecord>();
      for (const m of master) map.set(m.orderId, m);
      for (const m of mapped) map.set(m.orderId, m);
      const merged = Array.from(map.values());
      localStorage.setItem(LOCAL_STORAGE_DNR_MASTER_KEY, JSON.stringify(merged));

      // Fetch latest upload metadata for this site or global 'ALL'
      const { data: uploadLog } = await supabase
        .from('store_dnr_uploads')
        .select('*')
        .or(`site_code.eq.${normSite},site_code.eq.ALL`)
        .order('uploaded_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (uploadLog) {
        localStorage.setItem(
          LOCAL_STORAGE_DNR_LAST_UPLOAD_KEY,
          JSON.stringify({
            filename: uploadLog.filename,
            uploadedAt: uploadLog.uploaded_at,
            totalRecords: uploadLog.total_records,
            nonAbusiveCount: uploadLog.non_abusive_count,
            potentialAbuseCount: uploadLog.potential_abuse_count,
            uploadedBy: uploadLog.uploaded_by,
            siteCode: uploadLog.site_code,
          })
        );
      }
    }
  } catch (err) {
    console.warn('Supabase store_dnr_records sync note (using local cache):', err);
  }

  return getDnrSummaryForStore(normSite);
}

