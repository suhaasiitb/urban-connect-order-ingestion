// ==============================================================================
// Canonical Domain & Ingestion Types (Shared between Frontend, Tests & Backend)
// ==============================================================================

export const EXPECTED_RAW_HEADERS = [
  'Rider Number',
  'Arrived Pickup At',
  'LM Distance',
  'Resting Point Name',
  'Total ETA',
  'Completed At',
  'Resting Point ID',
  'Store Name',
  'Pickup At',
  'Order ETA Status',
  'Staged At',
  'Pickup ETA',
  'Arrive at Pickup ETA',
  'Status Text',
  'Created At',
  'Status',
  'Rider Name',
  'Order ID',
  'Store ID',
  'Total Time',
  'Arrive at Delivery ETA',
  'Arrived Delivery At',
  'Tracking URL',
  'Customer ID',
  'RTO At',
  'FM Distance',
  'Assigned At',
  'Delivery ETA',
  'Batch ID',
] as const;

export type RawHeaderName = (typeof EXPECTED_RAW_HEADERS)[number];

export type RawCellValue = string | number | boolean | null | undefined;

export type RawOrderRow = Record<RawHeaderName, RawCellValue>;

export interface StoreMaster {
  id: string;
  store_code: string;
  store_name: string;
  external_store_id: string | null;
  timezone: string;
  is_active: boolean;
}

/**
 * All 29 normalized source fields matching public.orders columns 1-to-1.
 * Timestamps are ISO-8601 strings with explicit Asia/Kolkata (+05:30) offset.
 */
export interface NormalizedOrderSource {
  rider_number: string | null;
  arrived_pickup_at: string | null;
  lm_distance: number | null;
  resting_point_name: string | null;
  total_eta: number | null;
  completed_at: string | null;
  resting_point_id: string | null;
  source_store_name: string;
  pickup_at: string | null;
  order_eta_status: string | null;
  staged_at: string | null;
  pickup_eta: number | null;
  arrive_at_pickup_eta: string | null;
  status_text: string | null;
  order_created_at: string;
  status: string;
  rider_name: string | null;
  order_id: string;
  external_store_id: string;
  total_time: number | null;
  arrive_at_delivery_eta: string | null;
  arrived_delivery_at: string | null;
  tracking_url: string | null;
  customer_id: string | null;
  rto_at: string | null;
  fm_distance: number | null;
  assigned_at: string | null;
  delivery_eta: number | null;
  source_batch_id: string | null;
}

export type OrderType = 'Actual' | 'Dummy';

export type OtpStatus = 'OTP Achieved' | 'OTP Breached' | 'Not Applicable';

/**
 * All 11 derived business columns (AD through AN) matching public.orders.
 */
export interface DerivedOrderFields {
  order_type: OrderType;                      // AD: Order Type
  store_code: string;                         // AE: Store Code
  slot_hour: number;                          // AF: Slot (0-23)
  order_date: string;                         // AG: Date (YYYY-MM-DD)
  staging_to_pickup_minutes: number;          // AH: Time ((Pickup At - Staged At) in minutes)
  s2p_minutes: number;                        // AI: S2P (MAX(AH, 0))
  distance_meters: number;                    // AJ: Distance (LM Distance in meters)
  actual_arrival_minutes: number;             // AK: Actual Arrival Time
  arrival_eta_minutes: number;                // AL: Arrival Time ETA
  otp_performance: OtpStatus;                 // AM: OTP Performance
  otp_plus_3_performance: OtpStatus;          // AN: OTP+3 Performance
}

export interface FieldValidationIssue {
  field: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ProcessedOrderRow {
  source_row_number: number;
  raw_source_snapshot: Record<string, string | number | boolean | null>;
  normalized_source: NormalizedOrderSource;
  derived_fields: DerivedOrderFields;
  source_row_hash: string;
  issues: FieldValidationIssue[];
  is_valid: boolean;
}

export interface DuplicateOrderIdEntry {
  order_id: string;
  rows: number[];
}

export interface WorkbookValidationResult {
  filename: string;
  file_size_bytes: number;
  file_checksum_sha256: string;
  worksheet_found: boolean;
  detected_sheet_name?: string | null;
  missing_headers: string[];
  unexpected_headers: string[];
  file_errors: string[];
  file_warnings: string[];
  total_rows_detected: number;
  valid_rows_count: number;
  invalid_rows_count: number;
  duplicate_order_ids: DuplicateOrderIdEntry[];
  status_distribution: Record<string, number>;
  min_order_date: string | null;
  max_order_date: string | null;
  is_valid: boolean;
  rows: ProcessedOrderRow[];
}
