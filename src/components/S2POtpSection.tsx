import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StoreMaster } from '../domain/types';
import type { UserProfile } from '../services/authService';
import {
  formatDateToHeader,
  getDateRangeForDays,
  getTodayDateString,
} from '../services/analyticsService';
import { supabase } from '../config/supabaseClient';
import {
  type SnopForecastRecord,
  fetchStoreSnopForecast,
  getDefaultStoreDph,
  getStoredSnopRecords,
} from '../services/planningService';
import {
  type DailyPerformanceSummary,
  type DaySnopBreachMetrics,
  type S2POtpSummaryResult,
  buildBtoRcaSummary,
  buildOtpBreachRcaPivots,
  calculateDaySnopBreachMetrics,
  exportS2POtpToExcel,
  fetchDsrRtoOrders,
  fetchOtpBreachedOrders,
  fetchS2POtpAnalytics,
  getCurrentHourInTimeZone,
  getDayOfWeekName,
  getDphImpactedSlots,
} from '../services/s2pOtpService';
import {
  buildSnapshotHeader,
  buildSnapshotTableCard,
  createSnapshotEnvironment,
  renderAndDownloadSnapshot,
} from '../utils/snapshotExport';
import { S2PKpiCardsGrid } from './S2PKpiCardsGrid';
import { OtpBreachedRidersModal } from './OtpBreachedRidersModal';
import { OtpBreachRcaModal } from './OtpBreachRcaModal';
import { SnapshotButton, type SnapshotStatus } from './SnapshotButton';

interface S2POtpSectionProps {
  stores: StoreMaster[];
  selectedStoreId: string;
  onSelectStoreId: (id: string) => void;
  currentUser?: UserProfile | null;
}

type SlotViewType = 'all' | 's2p' | 'otp' | 'dph';

export type PresetValue = 'today' | 1 | 3 | 7 | 10 | 14 | 20 | 30;

interface PresetItem {
  id: PresetValue;
  label: string;
  tooltip: string;
}

const PRESET_ITEMS: PresetItem[] = [
  { id: 'today', label: 'Today (Ongoing)', tooltip: "View today's live ongoing & partial day metrics" },
  { id: 1, label: '1 Day (Yesterday)', tooltip: "Yesterday's completed day" },
  { id: 3, label: '3 Days', tooltip: 'Last 3 days' },
  { id: 7, label: '7 Days', tooltip: 'Last 7 days' },
  { id: 10, label: '10 Days', tooltip: 'Last 10 days' },
  { id: 14, label: '14 Days', tooltip: 'Last 14 days' },
  { id: 20, label: '20 Days', tooltip: 'Last 20 days' },
  { id: 30, label: '30 Days', tooltip: 'Last 30 days' },
];

export const S2POtpSection: React.FC<S2POtpSectionProps> = ({
  stores,
  selectedStoreId,
  onSelectStoreId,
  currentUser,
}) => {
  const selectedStore = stores.find((s) => s.id === selectedStoreId) ?? stores[0];
  const dphTarget = getDefaultStoreDph(selectedStore?.store_code);
  const timeZone = selectedStore?.timezone || 'Asia/Kolkata';
  const todayStr = getTodayDateString(timeZone);

  const [includeToday, setIncludeToday] = useState<boolean>(false);
  const [selectedPreset, setSelectedPreset] = useState<PresetValue | 'custom'>('today');

  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);

  const [showCustomRange, setShowCustomRange] = useState(false);
  const [customStart, setCustomStart] = useState(todayStr);
  const [customEnd, setCustomEnd] = useState(todayStr);

  const [summary, setSummary] = useState<S2POtpSummaryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadSource, setLoadSource] = useState<'cache' | 'rpc' | 'client' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestRequestIdRef = useRef<number>(0);
  const analyticsContainerRef = useRef<HTMLDivElement | null>(null);
  const kpiGridWrapperRef = useRef<HTMLDivElement | null>(null);
  const dailyTableContainerRef = useRef<HTMLDivElement | null>(null);
  const snopPortalHostRef = useRef<HTMLDivElement | null>(null);
  const [takingScreenshot, setTakingScreenshot] = useState<boolean>(false);
  const [screenshotStatus, setScreenshotStatus] = useState<SnapshotStatus>('idle');
  const [takingSnopScreenshot, setTakingSnopScreenshot] = useState<boolean>(false);
  const [snopSnapshotStatus, setSnopSnapshotStatus] = useState<SnapshotStatus>('idle');
  const [renderSnopPortal, setRenderSnopPortal] = useState<boolean>(false);
  const [takingRcaSnapshot, setTakingRcaSnapshot] = useState<boolean>(false);
  const [rcaSnapshotStatus, setRcaSnapshotStatus] = useState<SnapshotStatus>('idle');
  const [takingBtoSnapshot, setTakingBtoSnapshot] = useState<boolean>(false);
  const [btoSnapshotStatus, setBtoSnapshotStatus] = useState<SnapshotStatus>('idle');

  // Strictly ensure the displayed summary matches the currently selected store and [startDate, endDate] window
  const activeSummary = useMemo<S2POtpSummaryResult | null>(() => {
    if (!summary) return null;
    if (selectedStore && summary.storeId !== selectedStore.id) return null;
    if (summary.startDate !== startDate || summary.endDate !== endDate) return null;
    const filteredDays = summary.days.filter(
      (d) => d.dateStr >= startDate && d.dateStr <= endDate
    );
    if (filteredDays.length === summary.days.length) {
      return summary;
    }
    return {
      ...summary,
      days: filteredDays,
    };
  }, [summary, selectedStore, startDate, endDate]);

  // Tracks if orders have been uploaded for today in the selected store
  const [hasTodayOrders, setHasTodayOrders] = useState<boolean>(false);

  // Set of dates that are currently expanded to show slot breakdown
  const [expandedDates, setExpandedDates] = useState<Set<string>>(() => new Set([todayStr]));

  // Active slot sub-view per date (defaults to 'all', can switch to 's2p', 'otp', 'dph')
  const [slotViewModes, setSlotViewModes] = useState<Record<string, SlotViewType>>({});

  // Toggle for displaying SNOP Plan (left of Orders) and Breach (Orders - SNOP Plan, right of Orders)
  const [snopBreachVisible, setSnopBreachVisible] = useState<boolean>(false);
  const [otpBreachedModal, setOtpBreachedModal] = useState<{
    orderDate: string;
    formattedDate: string;
    slotHour: number | null;
  } | null>(null);
  const [rcaModal, setRcaModal] = useState<{
    mode: 'otp' | 'dsr';
    orderDate: string;
    formattedDate: string;
    slotHour: number;
  } | null>(null);
  const [snopRecords, setSnopRecords] = useState<SnopForecastRecord[]>(() =>
    getStoredSnopRecords(selectedStore?.store_code || 'TMK7')
  );

  const loadSnopData = useCallback(async () => {
    if (!selectedStore?.store_code) return;
    const code = selectedStore.store_code;
    const local = getStoredSnopRecords(code);
    if (local.length > 0) {
      setSnopRecords(local);
    }
    const remote = await fetchStoreSnopForecast(code);
    if (remote.length > 0) {
      setSnopRecords(remote);
    }
  }, [selectedStore?.store_code]);

  useEffect(() => {
    void loadSnopData();
    const handleSnopUpdate = () => {
      void loadSnopData();
    };
    window.addEventListener('snop_forecast_saved', handleSnopUpdate);
    window.addEventListener('storage', handleSnopUpdate);
    return () => {
      window.removeEventListener('snop_forecast_saved', handleSnopUpdate);
      window.removeEventListener('storage', handleSnopUpdate);
    };
  }, [loadSnopData]);

  // Pre-index recent SNOP plan by exact date, by day-of-week, and latest available date
  const snopLookup = useMemo(() => {
    const byDate = new Map<string, Map<number, number>>();
    for (const r of snopRecords) {
      let slotMap = byDate.get(r.dateStr);
      if (!slotMap) {
        slotMap = new Map<number, number>();
        byDate.set(r.dateStr, slotMap);
      }
      slotMap.set(r.hour, (slotMap.get(r.hour) || 0) + r.projectedOrders);
    }

    const sortedDatesDesc = Array.from(byDate.keys()).sort().reverse();
    const byDayOfWeek = new Map<string, Map<number, number>>();
    for (const d of sortedDatesDesc) {
      const dow = getDayOfWeekName(d);
      if (!byDayOfWeek.has(dow)) {
        const slotMap = byDate.get(d);
        if (slotMap) byDayOfWeek.set(dow, slotMap);
      }
    }

    const latestSlotMap = sortedDatesDesc.length > 0 ? byDate.get(sortedDatesDesc[0]) : undefined;

    return { byDate, byDayOfWeek, latestSlotMap };
  }, [snopRecords]);

  const getSlotSnopPlan = useCallback(
    (dateStr: string, dayOfWeek: string, slotHour: number): number => {
      const slotMap =
        snopLookup.byDate.get(dateStr) ??
        snopLookup.byDayOfWeek.get(dayOfWeek) ??
        snopLookup.latestSlotMap;
      if (!slotMap) return 0;
      return Math.round(slotMap.get(slotHour) ?? 0);
    },
    [snopLookup]
  );

  const getDaySnopMetrics = useCallback(
    (day: DailyPerformanceSummary): DaySnopBreachMetrics => {
      return calculateDaySnopBreachMetrics({
        day,
        todayStr,
        currentSlotHour: getCurrentHourInTimeZone(timeZone),
        getSlotSnopPlan,
      });
    },
    [getSlotSnopPlan, todayStr, timeZone]
  );

  const renderBreachCellContent = (breach: number, snopPlan: number, tooltip?: string) => {
    const isBreach = breach > 0;
    const formattedDiff = isBreach ? `+${breach.toLocaleString()}` : breach.toLocaleString();
    const pctStr =
      snopPlan > 0
        ? ` (${isBreach ? '+' : ''}${((breach / snopPlan) * 100).toFixed(1)}%)`
        : '';
    return (
      <span className={isBreach ? 'text-red font-bold' : 'text-green font-semibold'} title={tooltip}>
        {formattedDiff}
        {pctStr}
      </span>
    );
  };

  const checkTodayOrders = useCallback(async () => {
    if (!selectedStore) return;
    try {
      const { count, error: qErr } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', selectedStore.id)
        .eq('order_date', todayStr);
      if (!qErr) {
        setHasTodayOrders(Boolean(count && count > 0));
      }
    } catch {
      // Ignore background check failure
    }
  }, [selectedStore, todayStr]);

  useEffect(() => {
    void checkTodayOrders();
  }, [checkTodayOrders]);

  const loadData = useCallback(
    async (
      forceRefresh = false,
      overrideStart?: string,
      overrideEnd?: string,
      overridePreset?: PresetValue | 'custom'
    ) => {
      if (!selectedStore) return;
      const queryStart = overrideStart ?? startDate;
      const queryEnd = overrideEnd ?? endDate;
      const activePreset = overridePreset ?? selectedPreset;

      latestRequestIdRef.current += 1;
      const requestId = latestRequestIdRef.current;

      setLoading(true);
      setError(null);
      // Immediately reset summary so prior multi-day data is never displayed with the new date range
      setSummary(null);

      // Bypass in-memory cache if explicitly forced or if querying today's live ongoing data
      const isTodayQuery =
        queryStart === todayStr || queryEnd === todayStr || activePreset === 'today';
      const res = await fetchS2POtpAnalytics({
        storeId: selectedStore.id,
        startDate: queryStart,
        endDate: queryEnd,
        forceRefresh: forceRefresh || isTodayQuery,
      });

      // Discard stale responses from earlier in-flight requests (e.g. 7-day query resolving after Today query)
      if (requestId !== latestRequestIdRef.current) {
        return;
      }

      setLoading(false);
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        const filteredDays = res.data.days.filter(
          (d) => d.dateStr >= queryStart && d.dateStr <= queryEnd
        );
        const strictData: S2POtpSummaryResult = {
          ...res.data,
          startDate: queryStart,
          endDate: queryEnd,
          days: filteredDays,
        };
        setSummary(strictData);
        setLoadSource(res.source ?? null);
        // Safely auto-expand the date if there's at least 1 date (e.g. Today)
        if (
          strictData.days.length > 0 &&
          (strictData.days.length === 1 || activePreset === 'today')
        ) {
          setExpandedDates(new Set([strictData.days[0].dateStr]));
        } else {
          setExpandedDates(new Set());
        }
      }
    },
    [selectedStore, startDate, endDate, todayStr, selectedPreset]
  );

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  const handleSelectPreset = (preset: PresetValue, forceIncludeToday?: boolean) => {
    latestRequestIdRef.current += 1;
    setSelectedPreset(preset);
    setShowCustomRange(false);
    const shouldIncludeToday = forceIncludeToday !== undefined ? forceIncludeToday : includeToday;

    let newStart = startDate;
    let newEnd = endDate;

    if (preset === 'today') {
      newStart = todayStr;
      newEnd = todayStr;
    } else if (preset === 1) {
      const range = getDateRangeForDays(1, timeZone, false);
      newStart = range.startDate;
      newEnd = range.endDate;
    } else {
      const range = getDateRangeForDays(preset, timeZone, shouldIncludeToday);
      newStart = range.startDate;
      newEnd = range.endDate;
    }

    // Immediately clear previous summary so prior multi-day data is never displayed
    setSummary(null);
    setExpandedDates(preset === 'today' ? new Set([todayStr]) : new Set());
    setStartDate(newStart);
    setEndDate(newEnd);
    setCustomStart(newStart);
    setCustomEnd(newEnd);

    // If dates didn't change (e.g. clicking 'today' while already on 'today'), force refresh directly
    if (newStart === startDate && newEnd === endDate) {
      void loadData(preset === 'today', newStart, newEnd, preset);
    }
  };

  const handleToggleIncludeToday = (checked: boolean) => {
    latestRequestIdRef.current += 1;
    setIncludeToday(checked);
    if (typeof selectedPreset === 'number' && selectedPreset > 1) {
      const range = getDateRangeForDays(selectedPreset, timeZone, checked);
      setSummary(null);
      setStartDate(range.startDate);
      setEndDate(range.endDate);
      setCustomStart(range.startDate);
      setCustomEnd(range.endDate);
      if (range.startDate === startDate && range.endDate === endDate) {
        void loadData(checked, range.startDate, range.endDate, selectedPreset);
      }
    }
  };

  const handleApplyCustomDate = () => {
    if (customStart && customEnd) {
      latestRequestIdRef.current += 1;
      setSummary(null);
      setStartDate(customStart);
      setEndDate(customEnd);
      setSelectedPreset('custom');
      if (customStart === startDate && customEnd === endDate) {
        void loadData(false, customStart, customEnd, 'custom');
      }
    }
  };

  const toggleExpandDate = (dateStr: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) {
        next.delete(dateStr);
      } else {
        next.add(dateStr);
      }
      return next;
    });
  };

  const toggleAllDates = () => {
    if (!activeSummary) return;
    if (expandedDates.size === activeSummary.days.length) {
      setExpandedDates(new Set());
    } else {
      setExpandedDates(new Set(activeSummary.days.map((d) => d.dateStr)));
    }
  };

  const setDateSlotView = (dateStr: string, mode: SlotViewType) => {
    setSlotViewModes((prev) => ({
      ...prev,
      [dateStr]: mode,
    }));
  };

  const handleExport = () => {
    if (!activeSummary || !selectedStore) return;
    exportS2POtpToExcel(activeSummary, selectedStore.store_code);
  };

  const captureDailySummarySnapshot = async (mode: 'standard' | 'snop_breach') => {
    const isSnopMode = mode === 'snop_breach';
    const isBusy = isSnopMode ? takingSnopScreenshot : takingScreenshot;
    const setBusy = isSnopMode ? setTakingSnopScreenshot : setTakingScreenshot;
    const setStatus = isSnopMode ? setSnopSnapshotStatus : setScreenshotStatus;

    const analyticsRoot = analyticsContainerRef.current;
    const kpiEl = kpiGridWrapperRef.current?.querySelector('.kpi-grid') as HTMLElement | null;
    if (!analyticsRoot || !kpiEl || !activeSummary || !selectedStore || activeSummary.days.length === 0 || isBusy) {
      return;
    }

    setBusy(true);
    setStatus('idle');

    const hasExpandedNonSnopView = activeSummary.days.some(
      (d) =>
        expandedDates.has(d.dateStr) &&
        (slotViewModes[d.dateStr] === 's2p' || slotViewModes[d.dateStr] === 'otp')
    );
    const needsOffscreenPortal = isSnopMode && (!snopBreachVisible || hasExpandedNonSnopView);

    let offscreenHost: HTMLDivElement | null = null;
    try {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      if (needsOffscreenPortal) {
        setRenderSnopPortal(true);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      }

      const sourceTableEl = needsOffscreenPortal
        ? (snopPortalHostRef.current?.firstElementChild as HTMLElement | null)
        : dailyTableContainerRef.current;

      if (!sourceTableEl) {
        throw new Error('Daily summary table element not available for snapshot.');
      }

      const tableClone = sourceTableEl.cloneNode(true) as HTMLElement;
      const includeSnopColumns = isSnopMode || snopBreachVisible;
      const minWidth = Math.max(includeSnopColumns ? 1580 : 1480, sourceTableEl.scrollWidth + 48);

      if (needsOffscreenPortal) {
        setRenderSnopPortal(false);
      }

      const env = createSnapshotEnvironment(minWidth);
      offscreenHost = env.offscreenHost;
      const { captureTarget, bgColor, textColor, subTextColor, borderColor } = env;

      const rangeText = startDate === endDate ? startDate : `${startDate} → ${endDate}`;
      const headerTitle = isSnopMode
        ? `${selectedStore.store_code} (${selectedStore.store_name}) — S2P, OTP+3, DPH, DSR & SNOP Breach Summary`
        : `${selectedStore.store_code} (${selectedStore.store_name}) — S2P, OTP+3, DPH & DSR Summary`;

      captureTarget.appendChild(
        buildSnapshotHeader(
          headerTitle,
          `Period: ${rangeText} · ${activeSummary.days.length} ${
            activeSummary.days.length === 1 ? 'Day' : 'Days'
          } · ${activeSummary.overallTotalOrders.toLocaleString()} Orders`,
          timeZone,
          { textColor, subTextColor, borderColor }
        )
      );

      // Section 1: Clone top 5 KPI cards in a single balanced 5-column row
      const kpiClone = kpiEl.cloneNode(true) as HTMLElement;
      kpiClone.classList.remove('mt-md');
      kpiClone.style.marginTop = '0';
      kpiClone.style.width = '100%';
      kpiClone.style.display = 'grid';
      kpiClone.style.gridTemplateColumns = 'repeat(5, minmax(0, 1fr))';
      captureTarget.appendChild(kpiClone);

      // Section 2: Clone Daily Summary & Expanded Hourly Slot Breakdown without scroll clipping
      tableClone.classList.remove('opacity-70');
      tableClone.style.marginTop = '0';
      tableClone.style.overflowX = 'visible';
      tableClone.style.width = '100%';
      // Remove bottom Period Grand Total footer and interactive RCA buttons from screenshot
      tableClone.querySelectorAll('.s2p-daily-table > tfoot, .otp-rca-trigger').forEach((el) => el.remove());

      const expandedRows = tableClone.querySelectorAll('.s2p-expanded-row');
      if (expandedRows.length > 0) {
        const dayRows = Array.from(
          tableClone.querySelectorAll('.s2p-daily-table > tbody > tr.s2p-day-row')
        );
        for (const dayRow of dayRows) {
          const nextRow = dayRow.nextElementSibling;
          if (nextRow instanceof HTMLElement && nextRow.classList.contains('s2p-expanded-row')) {
            const impactedText = dayRow.querySelector('.dph-impacted-slots')?.textContent?.trim() || '';
            const slotHeader = nextRow.querySelector('.s2p-slot-header');
            if (slotHeader) {
              // Remove "9 Slots | 309 Orders | 27 Active Riders" pill
              slotHeader.querySelector('.badge-info')?.remove();

              // Place "DPH IMPACTED SLOTS - <slots>" between the title and pivot switcher
              const impactedPill = document.createElement('span');
              if (impactedText) {
                impactedPill.className = 'dph-impacted-slots';
                impactedPill.textContent = `DPH IMPACTED SLOTS - ${impactedText}`;
              } else {
                impactedPill.className = 'badge badge-success';
                impactedPill.textContent = 'DPH IMPACTED SLOTS - None';
              }
              impactedPill.style.whiteSpace = 'nowrap';

              const segmented = slotHeader.querySelector('.segmented-control');
              if (segmented) {
                slotHeader.insertBefore(impactedPill, segmented);
              } else {
                slotHeader.appendChild(impactedPill);
              }
            }
          }
          // Remove parent day row from snapshot when expanded breakdown is rendered
          dayRow.remove();
        }
        // Remove outer daily summary table header (DATE | DAY | ... | ACTION)
        tableClone.querySelectorAll('.s2p-daily-table > thead').forEach((el) => el.remove());
      }

      const lastMainRow = tableClone.querySelector('.s2p-daily-table > tbody > tr:last-child');
      if (lastMainRow instanceof HTMLElement && lastMainRow.classList.contains('s2p-expanded-row')) {
        const card = lastMainRow.querySelector('.s2p-slot-breakdown-card') as HTMLElement | null;
        if (card) card.style.borderBottom = 'none';
      }
      tableClone.querySelectorAll('.excel-pivot-table-container').forEach((el) => {
        (el as HTMLElement).style.overflowX = 'visible';
      });
      tableClone.querySelectorAll('.badge, .segmented-btn, .kpi-target-badge, .dph-impacted-slots').forEach((el) => {
        (el as HTMLElement).style.whiteSpace = 'nowrap';
      });
      tableClone.querySelectorAll('.s2p-slot-header').forEach((el) => {
        const hdr = el as HTMLElement;
        hdr.style.alignItems = 'center';
        hdr.style.flexWrap = 'nowrap';
        hdr.style.gap = '12px';
      });
      tableClone.querySelectorAll('.segmented-control').forEach((el) => {
        const seg = el as HTMLElement;
        seg.style.flexShrink = '0';
        seg.style.whiteSpace = 'nowrap';
      });
      captureTarget.appendChild(tableClone);

      const dateSlug = startDate === endDate ? startDate : `${startDate}_to_${endDate}`;
      const filePrefix = isSnopMode ? 'SNOP-Breach-Summary' : 'S2P-OTP-Summary';
      await renderAndDownloadSnapshot({
        rootContainer: analyticsRoot,
        offscreenHost,
        captureTarget,
        bgColor,
        minWidth,
        fileName: `${filePrefix}-${selectedStore.store_code}-${dateSlug}.png`,
      });

      setStatus('saved');
      window.setTimeout(() => setStatus('idle'), 2200);
    } catch (err) {
      console.error(`Failed to capture ${isSnopMode ? 'SNOP breach' : 'S2P & OTP'} screenshot:`, err);
      setStatus('error');
      window.setTimeout(() => setStatus('idle'), 3000);
    } finally {
      if (needsOffscreenPortal) {
        setRenderSnopPortal(false);
      }
      offscreenHost?.remove();
      setBusy(false);
    }
  };

  const handleTakeScreenshot = () => captureDailySummarySnapshot('standard');
  const handleTakeSnopScreenshot = () => captureDailySummarySnapshot('snop_breach');

  const handleDownloadRcaSnapshot = async () => {
    const analyticsRoot = analyticsContainerRef.current;
    if (!analyticsRoot || !activeSummary || !selectedStore || takingRcaSnapshot) {
      return;
    }

    setTakingRcaSnapshot(true);
    setRcaSnapshotStatus('idle');

    const minWidth = 1480;
    const { offscreenHost, captureTarget, bgColor, textColor, subTextColor, borderColor } =
      createSnapshotEnvironment(minWidth);

    try {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      const res = await fetchOtpBreachedOrders({
        storeId: selectedStore.id,
        startDate,
        endDate,
      });

      if (res.error) {
        throw new Error(res.error);
      }

      const pivots = buildOtpBreachRcaPivots(res.orders);
      const rangeText = startDate === endDate ? startDate : `${startDate} → ${endDate}`;
      const coveragePct =
        pivots.totalBreaches > 0
          ? Math.round((pivots.rcaTaggedCount / pivots.totalBreaches) * 100)
          : 100;

      captureTarget.appendChild(
        buildSnapshotHeader(
          `${selectedStore.store_code} (${selectedStore.store_name}) — OTP+3 Breach RCA Summary`,
          `Period: ${rangeText} · ${pivots.totalBreaches} Breached ${
            pivots.totalBreaches === 1 ? 'Order' : 'Orders'
          } · ${pivots.distinctRiders} ${pivots.distinctRiders === 1 ? 'Rider' : 'Riders'} · ${
            pivots.rcaTaggedCount
          }/${pivots.totalBreaches} RCA Tagged (${coveragePct}%)`,
          timeZone,
          { textColor, subTextColor, borderColor }
        )
      );

      const grid = document.createElement('div');
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
      grid.style.gap = '16px';
      grid.style.alignItems = 'start';
      grid.style.width = '100%';

      const buildPivotCard = (
        cardTitle: string,
        labelHeader: string,
        rows: Array<{ label: string; count: number; pct: number; isMuted?: boolean }>,
        emptyText: string
      ) =>
        buildSnapshotTableCard({
          cardTitle,
          borderColor,
          headers: [
            { label: labelHeader },
            { label: 'Breaches', className: 'text-center', width: '105px' },
            { label: 'Share %', className: 'text-center', width: '72px' },
          ],
          rows: rows.map((r) => [
            { text: r.label, className: r.isMuted ? 'text-muted' : 'font-semibold' },
            { text: String(r.count), className: 'text-center font-bold text-red' },
            { text: `${r.pct.toFixed(1)}%`, className: 'text-center font-mono text-xs' },
          ]),
          emptyText,
          footerCells: [
            { text: 'Grand Total', className: 'font-bold' },
            {
              text: String(pivots.totalBreaches),
              className: `text-center font-bold ${pivots.totalBreaches > 0 ? 'text-red' : 'text-green'}`,
            },
            {
              text: pivots.totalBreaches > 0 ? '100.0%' : '0.0%',
              className: 'text-center font-bold font-mono text-xs',
            },
          ],
        });

      grid.appendChild(
        buildPivotCard(
          '1. Rider vs Breaches',
          'Rider Name',
          pivots.byRider.map((r) => ({
            label: r.riderName,
            count: r.breachCount,
            pct: r.pct,
          })),
          'No OTP breaches in period'
        )
      );

      grid.appendChild(
        buildPivotCard(
          '2. RCA vs Breach Count',
          'RCA Category',
          pivots.byRca.map((r) => ({
            label: r.rca,
            count: r.breachCount,
            pct: r.pct,
            isMuted: r.isPending,
          })),
          'No OTP breaches in period'
        )
      );

      grid.appendChild(
        buildPivotCard(
          '3. Slot vs Breaches',
          'Slot',
          pivots.bySlot.map((s) => ({
            label: `Slot ${s.slotHour} (${s.slotLabel})`,
            count: s.breachCount,
            pct: s.pct,
          })),
          'No OTP breaches in period'
        )
      );

      captureTarget.appendChild(grid);

      const dateSlug = startDate === endDate ? startDate : `${startDate}_to_${endDate}`;
      await renderAndDownloadSnapshot({
        rootContainer: analyticsRoot,
        offscreenHost,
        captureTarget,
        bgColor,
        minWidth,
        fileName: `OTP-Breach-RCA-${selectedStore.store_code}-${dateSlug}.png`,
      });

      setRcaSnapshotStatus('saved');
      window.setTimeout(() => setRcaSnapshotStatus('idle'), 2200);
    } catch (err) {
      console.error('Failed to capture OTP Breach RCA snapshot:', err);
      setRcaSnapshotStatus('error');
      window.setTimeout(() => setRcaSnapshotStatus('idle'), 3000);
    } finally {
      offscreenHost.remove();
      setTakingRcaSnapshot(false);
    }
  };

  const handleDownloadBtoRcaSnapshot = async () => {
    const analyticsRoot = analyticsContainerRef.current;
    if (!analyticsRoot || !activeSummary || !selectedStore || takingBtoSnapshot) {
      return;
    }

    setTakingBtoSnapshot(true);
    setBtoSnapshotStatus('idle');

    const minWidth = 1480;
    const { offscreenHost, captureTarget, bgColor, textColor, subTextColor, borderColor } =
      createSnapshotEnvironment(minWidth);

    try {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      const res = await fetchDsrRtoOrders({
        storeId: selectedStore.id,
        startDate,
        endDate,
      });

      if (res.error) {
        throw new Error(res.error);
      }

      const btoSummary = buildBtoRcaSummary(res.orders);
      const isMultiDay = startDate !== endDate;
      const rangeText = isMultiDay ? `${startDate} → ${endDate}` : startDate;
      const coveragePct =
        btoSummary.totalBtoOrders > 0
          ? Math.round((btoSummary.rcaTaggedCount / btoSummary.totalBtoOrders) * 100)
          : 100;

      captureTarget.appendChild(
        buildSnapshotHeader(
          `${selectedStore.store_code} (${selectedStore.store_name}) — BTO RCA Summary`,
          `Period: ${rangeText} · ${btoSummary.totalBtoOrders} BTO ${
            btoSummary.totalBtoOrders === 1 ? 'Order' : 'Orders'
          } (RTO_DELIVERED) · ${btoSummary.distinctRiders} ${
            btoSummary.distinctRiders === 1 ? 'Rider' : 'Riders'
          } · ${btoSummary.rcaTaggedCount}/${btoSummary.totalBtoOrders} RCA Tagged (${coveragePct}%)`,
          timeZone,
          { textColor, subTextColor, borderColor }
        )
      );

      const grid = document.createElement('div');
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'minmax(360px, 0.85fr) minmax(680px, 1.45fr)';
      grid.style.gap = '16px';
      grid.style.alignItems = 'start';
      grid.style.width = '100%';

      grid.appendChild(
        buildSnapshotTableCard({
          cardTitle: '1. Rider Name vs Count of BTO',
          borderColor,
          headers: [
            { label: 'Rider Name' },
            { label: 'Count of BTO', className: 'text-center', width: '115px' },
            { label: 'Share %', className: 'text-center', width: '78px' },
          ],
          rows: btoSummary.byRider.map((r) => [
            { text: r.riderName, className: 'font-semibold' },
            { text: String(r.btoCount), className: 'text-center font-bold text-red' },
            { text: `${r.pct.toFixed(1)}%`, className: 'text-center font-mono text-xs' },
          ]),
          emptyText: 'No BTO (RTO_DELIVERED) orders in period',
          footerCells: [
            { text: 'Grand Total', className: 'font-bold' },
            {
              text: String(btoSummary.totalBtoOrders),
              className: `text-center font-bold ${btoSummary.totalBtoOrders > 0 ? 'text-red' : 'text-green'}`,
            },
            {
              text: btoSummary.totalBtoOrders > 0 ? '100.0%' : '0.0%',
              className: 'text-center font-bold font-mono text-xs',
            },
          ],
        })
      );

      const pendingCount = btoSummary.totalBtoOrders - btoSummary.rcaTaggedCount;
      grid.appendChild(
        buildSnapshotTableCard({
          cardTitle: '2. Riders with Order ID & BTO RCA',
          borderColor,
          headers: [
            { label: 'Rider Name' },
            { label: 'Order ID', width: '215px' },
            { label: 'Slot', className: 'text-center', width: isMultiDay ? '175px' : '150px' },
            { label: 'BTO RCA' },
          ],
          rows: btoSummary.orders.map((ord) => [
            { text: ord.riderName, className: 'font-semibold' },
            { text: ord.orderId, className: 'font-mono' },
            {
              text:
                isMultiDay && ord.orderDate
                  ? `${ord.orderDate} · Slot ${ord.slotHour}`
                  : `Slot ${ord.slotHour} (${ord.slotLabel})`,
              className: 'text-center',
            },
            {
              text: ord.dsrRca || 'Pending / Unassigned RCA',
              className: ord.dsrRca ? 'font-semibold' : 'text-muted',
            },
          ]),
          emptyText: 'No BTO (RTO_DELIVERED) orders in period',
          footerCells: [
            { text: 'Total BTO Orders', className: 'font-bold' },
            {
              text: `${btoSummary.totalBtoOrders} ${btoSummary.totalBtoOrders === 1 ? 'Order' : 'Orders'}`,
              className: 'text-center font-bold',
              colSpan: 2,
            },
            {
              text: `${btoSummary.rcaTaggedCount} Tagged / ${pendingCount} Pending`,
              className: `font-bold ${pendingCount === 0 && btoSummary.totalBtoOrders > 0 ? 'text-green' : 'text-red'}`,
            },
          ],
        })
      );

      captureTarget.appendChild(grid);

      const dateSlug = isMultiDay ? `${startDate}_to_${endDate}` : startDate;
      await renderAndDownloadSnapshot({
        rootContainer: analyticsRoot,
        offscreenHost,
        captureTarget,
        bgColor,
        minWidth,
        fileName: `BTO-RCA-${selectedStore.store_code}-${dateSlug}.png`,
      });

      setBtoSnapshotStatus('saved');
      window.setTimeout(() => setBtoSnapshotStatus('idle'), 2200);
    } catch (err) {
      console.error('Failed to capture BTO RCA snapshot:', err);
      setBtoSnapshotStatus('error');
      window.setTimeout(() => setBtoSnapshotStatus('idle'), 3000);
    } finally {
      offscreenHost.remove();
      setTakingBtoSnapshot(false);
    }
  };

  const isTodayInRange = startDate <= todayStr && todayStr <= endDate;

  // Helper to color-code DPH heatmap badge class
  const getDphHeatmapClass = (dph: number): string => {
    if (dph <= 0) return 'dph-heat-none';
    if (dph >= dphTarget + 0.5) return 'dph-heat-critical';
    if (dph >= dphTarget + 0.2) return 'dph-heat-high';
    if (dph > dphTarget) return 'dph-heat-elevated';
    return 'dph-heat-normal';
  };

  // Helper for S2P duration color badge (Target: <= 0.60 min)
  const getS2pBadgeClass = (s2p: number): string => {
    if (s2p <= 0.60) return 'text-green font-bold';
    return 'text-red font-bold';
  };

  return (
    <div ref={analyticsContainerRef} className="analytics-container s2p-otp-container">
      {/* 1. Filter & Controls Bar */}
      <div className="section-card">
        <div className="perf-controls-bar" style={{ marginTop: 0 }}>
          <div className="perf-controls-left flex-wrap items-center">
            {/* Store Selector */}
            <div className="store-selector-group mr-md">
              <span className="field-label">Store:</span>
              {currentUser?.role === 'store_user' ? (
                <div className="store-badge-locked flex-row items-center gap-xs">
                  <span className="badge badge-primary">{selectedStore?.store_code}</span>
                  <strong>{selectedStore?.store_name}</strong>
                </div>
              ) : (
                <select
                  id="s2p-store-select"
                  className="select-input"
                  value={selectedStoreId}
                  onChange={(e) => onSelectStoreId(e.target.value)}
                >
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.store_code} — {s.store_name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Period Dropdown */}
            <div className="perf-filter-group flex-wrap items-center">
              <label htmlFor="s2p-period-select" className="perf-control-label">
                Period:
              </label>
              <div className="custom-select-wrapper">
                <select
                  id="s2p-period-select"
                  className="perf-dropdown-select"
                  value={showCustomRange ? 'custom' : selectedPreset}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'custom') {
                      setShowCustomRange(true);
                      setSelectedPreset('custom');
                    } else if (val === 'today') {
                      handleSelectPreset('today');
                    } else {
                      handleSelectPreset(Number(val) as PresetValue);
                    }
                  }}
                >
                  {PRESET_ITEMS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                  <option value="custom">Custom Range...</option>
                </select>
                <span className="select-chevron" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </div>

              {/* Include Today Toggle for Multi-day Presets */}
              {typeof selectedPreset === 'number' && selectedPreset > 1 && (
                <label
                  className="flex-row items-center gap-xs ml-sm text-xs cursor-pointer select-none text-slate"
                  title="Include today's ongoing / partial day data in multi-day range"
                  style={{ fontWeight: 500 }}
                >
                  <input
                    type="checkbox"
                    checked={includeToday}
                    onChange={(e) => handleToggleIncludeToday(e.target.checked)}
                  />
                  <span>Include Today (Ongoing)</span>
                </label>
              )}
            </div>

            {showCustomRange && (
              <div className="custom-range-inline-picker">
                <div className="custom-range-field">
                  <span className="custom-range-label">From:</span>
                  <input
                    type="date"
                    value={customStart}
                    max={todayStr}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="custom-range-date-input"
                  />
                </div>
                <div className="custom-range-field">
                  <span className="custom-range-label">To:</span>
                  <input
                    type="date"
                    value={customEnd}
                    max={todayStr}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="custom-range-date-input"
                  />
                </div>
                <button
                  type="button"
                  className="btn-apply-custom"
                  onClick={handleApplyCustomDate}
                  disabled={loading || !customStart || !customEnd}
                >
                  Apply
                </button>
              </div>
            )}
          </div>

          <div className="perf-actions-right">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={toggleAllDates}
              disabled={!activeSummary || activeSummary.days.length === 0}
              title="Expand or collapse all date rows"
            >
              {expandedDates.size === (activeSummary?.days.length ?? 0)
                ? 'Collapse All Days'
                : 'Expand All Days'}
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm perf-btn-refresh"
              onClick={() => {
                void checkTodayOrders();
                void loadSnopData();
                void loadData(true);
              }}
              disabled={loading}
              title="Refresh S2P & OTP data"
            >
              <svg
                className={`btn-icon ${loading ? 'spin-icon' : ''}`}
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M23 4v6h-6M1 20v-6h6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
            </button>

            <button
              type="button"
              className="btn-export-excel"
              onClick={handleExport}
              disabled={!activeSummary || activeSummary.days.length === 0}
              title="Download full Excel workbook with S2P, OTP+3 & DPH pivots"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Export Excel</span>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert-box alert-box-warning mt-md" role="alert">
          <strong>Notice:</strong> {error}
        </div>
      )}

      {/* Ongoing Today Orders Notification Banner */}
      {hasTodayOrders && !isTodayInRange && (
        <div className="alert ongoing-orders-banner flex-row items-center justify-between mt-md">
          <div className="flex-row items-center gap-sm">
            <span style={{ fontSize: '1.2rem' }}>🟢</span>
            <div>
              <strong>Ongoing Orders Available:</strong> Uploaded partial data for{' '}
              <strong>Today ({formatDateToHeader(todayStr)})</strong> is ready to view.
            </div>
          </div>
          <div className="flex-row items-center gap-xs">
            <button
              type="button"
              className="btn btn-primary btn-xs"
              onClick={() => handleSelectPreset('today')}
            >
              View Today&apos;s Metrics (Ongoing) →
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => handleToggleIncludeToday(true)}
            >
              Include in Current Period
            </button>
          </div>
        </div>
      )}

      {/* 2. Top Summary KPI Cards */}
      <div ref={kpiGridWrapperRef}>
        <S2PKpiCardsGrid summary={activeSummary} loading={loading} dphTarget={dphTarget} />
      </div>

      {/* 3. Daily Summary Table with Expandable Slot Drill-Downs */}
      <div className="section-card perf-card mt-md">
        <div className="perf-section-header">
          <div className="flex-row items-center justify-between gap-sm s2p-summary-header-row">
            <div className="s2p-summary-header-title">
              <h3 className="section-title editorial-serif-heading">Daily S2P, OTP, DPH &amp; DSR Summary</h3>
            </div>
            <div className="flex-row items-center gap-sm flex-wrap s2p-summary-header-actions">
              <SnapshotButton
                icon="camera"
                loading={takingScreenshot}
                status={screenshotStatus}
                disabled={!activeSummary || activeSummary.days.length === 0 || loading}
                onClick={() => void handleTakeScreenshot()}
                title="Capture and download the top KPI cards and Daily/Hourly Slot Summary together in one PNG snapshot"
                labels={{
                  idle: 'Take Screenshot',
                  loading: 'Capturing...',
                  saved: 'Screenshot Saved',
                  error: 'Screenshot Failed',
                }}
              />
              <SnapshotButton
                icon="camera"
                loading={takingSnopScreenshot}
                status={snopSnapshotStatus}
                disabled={!activeSummary || activeSummary.days.length === 0 || loading}
                onClick={() => void handleTakeSnopScreenshot()}
                title="Capture and download a PNG snapshot including the SNOP Plan and Breach columns"
                labels={{
                  idle: 'SNOP Screenshot',
                  loading: 'Capturing...',
                  saved: 'SNOP Saved',
                  error: 'SNOP Failed',
                }}
              />
              <SnapshotButton
                icon="clipboard"
                loading={takingRcaSnapshot}
                status={rcaSnapshotStatus}
                disabled={!activeSummary || activeSummary.days.length === 0 || loading}
                onClick={() => void handleDownloadRcaSnapshot()}
                title="Download OTP Breach RCA summary snapshot with Rider, RCA, and Slot pivot tables"
                labels={{
                  idle: 'OTP Breach RCA',
                  loading: 'Capturing RCA...',
                  saved: 'RCA Saved',
                  error: 'RCA Failed',
                }}
              />
              <SnapshotButton
                icon="clipboard"
                loading={takingBtoSnapshot}
                status={btoSnapshotStatus}
                disabled={!activeSummary || activeSummary.days.length === 0 || loading}
                onClick={() => void handleDownloadBtoRcaSnapshot()}
                title="Download BTO RCA summary snapshot with Rider vs BTO Count pivot table and Rider / Order ID / RCA list"
                labels={{
                  idle: 'BTO RCA',
                  loading: 'Capturing BTO...',
                  saved: 'BTO Saved',
                  error: 'BTO Failed',
                }}
              />
              <button
                type="button"
                className={`snop-breach-toggle-btn ${snopBreachVisible ? 'active' : ''}`}
                onClick={() => setSnopBreachVisible((prev) => !prev)}
                aria-pressed={snopBreachVisible}
                title="Highlight SNOP Breach: adds SNOP Plan (left of Orders) and Breach = Orders − SNOP Plan (right of Orders)"
              >
                <span className="snop-breach-toggle-dot" aria-hidden="true" />
                <span>Highlight SNOP Breach</span>
              </button>
              <div className="badge badge-info">
                {activeSummary?.days.length ?? 0} active days detected ({startDate} to {endDate})
              </div>
            </div>
          </div>
        </div>

        {loading && (
          <div className="s2p-loading-bar">
            <span className="spinner-sm mr-xs" aria-hidden="true" />
            <span>
              {loadSource === 'client'
                ? 'Fetching order records in parallel chunks...'
                : 'Aggregating performance metrics...'}
            </span>
          </div>
        )}

        {loading && !activeSummary && (
          <div className="p-xl text-center text-slate">
            <span className="spinner-sm mr-xs" aria-hidden="true" />
            Loading S2P, OTP & DPH performance metrics...
          </div>
        )}

        {!loading && (!activeSummary || activeSummary.days.length === 0) && (
          <div className="p-xl text-center text-slate">
            No order records found for store {selectedStore?.store_code} between {startDate} and {endDate}.
          </div>
        )}

        {activeSummary && activeSummary.days.length > 0 && (() => {
          const renderDailySummaryTable = (
            showSnopBreach: boolean,
            forcedSlotView?: SlotViewType,
            attachRef = true
          ) => (
          <div
            ref={attachRef ? dailyTableContainerRef : undefined}
            className={`s2p-daily-table-container ${loading ? 'opacity-70' : ''}`}
          >
            <table className="s2p-daily-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }} aria-label="Expand toggle" />
                  <th>Date</th>
                  <th>Day</th>
                  {showSnopBreach && <th className="text-right">SNOP Plan</th>}
                  <th className="text-right">Orders</th>
                  {showSnopBreach && <th className="text-right">Breach</th>}
                  <th className="text-right">DSR %</th>
                  <th className="text-right">Actual Riders Turn-up</th>
                  <th className="text-right">DPH</th>
                  <th className="text-center">DPH Impacted Slots</th>
                  <th className="text-right">Avg S2P (min)</th>
                  <th className="text-right">OTP+3 Achieved %</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {activeSummary.days.map((day) => {
                  const isExpanded = expandedDates.has(day.dateStr);
                  const activeView = forcedSlotView ?? slotViewModes[day.dateStr] ?? 'all';
                  const impactedSlots = getDphImpactedSlots(day.slots, dphTarget);
                  const daySnopMetrics = getDaySnopMetrics(day);
                  const daySnopPlan = daySnopMetrics.totalSnopPlan;
                  const dayBreach = daySnopMetrics.completedBreach;
                  const dayBreachPlanDenom = daySnopMetrics.completedSnopPlan;
                  const dayBreachTooltip = daySnopMetrics.hasOngoingSlotExcluded
                    ? `Completed slots only (excludes ongoing slot): ${daySnopMetrics.completedOrders.toLocaleString()} orders vs ${daySnopMetrics.completedSnopPlan.toLocaleString()} SNOP plan`
                    : undefined;

                  return (
                    <React.Fragment key={day.dateStr}>
                      {/* Parent Day Row */}
                      <tr
                        className={`s2p-day-row ${isExpanded ? 's2p-day-row-expanded' : ''}`}
                        onClick={() => toggleExpandDate(day.dateStr)}
                        title="Click to expand/collapse hourly slot breakdown"
                      >
                        <td className="text-center font-bold">
                          <button
                            type="button"
                            className="s2p-expand-toggle-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpandDate(day.dateStr);
                            }}
                            aria-label={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            {isExpanded ? '−' : '+'}
                          </button>
                        </td>
                        <td className="font-bold text-slate">
                          <div className="flex-row items-center gap-xs">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                              <line x1="16" y1="2" x2="16" y2="6" />
                              <line x1="8" y1="2" x2="8" y2="6" />
                              <line x1="3" y1="10" x2="21" y2="10" />
                            </svg>
                            <span>{day.formattedDate}</span>
                            <span className="text-xs text-muted">({day.dateStr})</span>
                            {day.dateStr === todayStr && (
                              <span
                                className="badge badge-warning"
                                style={{ fontSize: '10px', padding: '1px 6px', lineHeight: '1.2' }}
                                title="Ongoing operational date with partial day orders"
                              >
                                Ongoing
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className="badge badge-secondary">{day.dayOfWeek}</span>
                        </td>
                        {showSnopBreach && (
                          <td className="text-right font-semibold">{daySnopPlan.toLocaleString()}</td>
                        )}
                        <td className="text-right font-bold">{day.totalOrders.toLocaleString()}</td>
                        {showSnopBreach && (
                          <td className="text-right">
                            {renderBreachCellContent(dayBreach, dayBreachPlanDenom, dayBreachTooltip)}
                          </td>
                        )}
                        <td className="text-right font-bold">
                          <span
                            className={(day.dsrPct ?? 0) > 99.0 ? 'text-green' : 'text-red'}
                            title={`Completed: ${(day.completedOrdersCount ?? 0).toLocaleString()} / ${(day.totalOrders ?? 0).toLocaleString()} orders`}
                          >
                            {(day.dsrPct ?? 0).toFixed(1)}%
                          </span>
                        </td>
                        <td className="text-right">{day.distinctRidersCount} riders</td>
                        <td className="text-right">
                          <span className={`dph-pill ${getDphHeatmapClass(day.avgDph)}`}>
                            {day.avgDph.toFixed(1)}
                          </span>
                        </td>
                        <td className="text-center">
                          {impactedSlots.length > 0 ? (
                            <span
                              className="dph-impacted-slots"
                              title={`Slots with DPH > ${dphTarget.toFixed(1)}: ${impactedSlots.join(', ')}`}
                            >
                              {impactedSlots.join(', ')}
                            </span>
                          ) : (
                            ''
                          )}
                        </td>
                        <td className={`text-right ${getS2pBadgeClass(day.avgS2p)}`}>
                          {day.avgS2p.toFixed(2)} min
                        </td>
                        <td className="text-right font-bold text-green">
                          {day.avgOtpAchievedPct.toFixed(2)}%
                        </td>
                        <td className="text-center">
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpandDate(day.dateStr);
                            }}
                          >
                            {isExpanded ? 'Hide Slots ↑' : 'View Slots ↓'}
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Child Accordion Row */}
                      {isExpanded && (
                        <tr className="s2p-expanded-row">
                          <td colSpan={showSnopBreach ? 13 : 11} className="s2p-expanded-cell">
                            <div className="s2p-slot-breakdown-card">
                              {/* Sub-Header & Pivot View Switcher */}
                              <div className="s2p-slot-header">
                                <div className="flex-row items-center gap-xs">
                                  <h4 className="s2p-slot-title">
                                    Hourly Slot Breakdown — {day.formattedDate} ({day.dateStr})
                                    {day.dateStr === todayStr && (
                                      <span
                                        className="badge badge-warning ml-xs"
                                        style={{ fontSize: '11px', verticalAlign: 'middle' }}
                                      >
                                        Ongoing Partial Day
                                      </span>
                                    )}
                                  </h4>
                                  <span className="badge badge-info">
                                    {day.slots.length} Slots | {day.totalOrders} Orders | {day.distinctRidersCount} Active Riders
                                  </span>
                                </div>

                                <div className="segmented-control">
                                  <button
                                    type="button"
                                    className={`segmented-btn ${activeView === 'all' ? 'segmented-btn-active' : ''}`}
                                    onClick={() => setDateSlotView(day.dateStr, 'all')}
                                    title="All metrics in one unified slot matrix"
                                  >
                                    All-in-One Matrix
                                  </button>
                                  <button
                                    type="button"
                                    className={`segmented-btn ${activeView === 's2p' ? 'segmented-btn-active' : ''}`}
                                    onClick={() => setDateSlotView(day.dateStr, 's2p')}
                                    title="Replicates Image 1: Slot and Average S2P"
                                  >
                                    S2P Pivot
                                  </button>
                                  <button
                                    type="button"
                                    className={`segmented-btn ${activeView === 'otp' ? 'segmented-btn-active' : ''}`}
                                    onClick={() => setDateSlotView(day.dateStr, 'otp')}
                                    title="Replicates Image 2: OTP+3 Performance (% Achieved vs % Breached)"
                                  >
                                    OTP+3 Pivot
                                  </button>
                                  <button
                                    type="button"
                                    className={`segmented-btn ${activeView === 'dph' ? 'segmented-btn-active' : ''}`}
                                    onClick={() => setDateSlotView(day.dateStr, 'dph')}
                                    title="Replicates Image 3: Orders, Actual Riders Turn-up, and DPH"
                                  >
                                    DPH Pivot
                                  </button>
                                </div>
                              </div>

                              {/* VIEW A: All-in-One Master Slot Matrix */}
                              {activeView === 'all' && (
                                <div className="excel-pivot-table-container">
                                  <table className="excel-pivot-table">
                                    <thead>
                                      <tr>
                                        <th className="text-center" style={{ width: '80px' }}>Slot</th>
                                        {showSnopBreach && <th className="text-center">SNOP Plan</th>}
                                        <th className="text-center">Orders</th>
                                        {showSnopBreach && <th className="text-center">Breach</th>}
                                        <th className="text-center">Riders Turn-up</th>
                                        <th className="text-center">DPH</th>
                                        <th className="text-center">AVERAGE of S2P (min)</th>
                                        <th className="text-center">OTP Achieved %</th>
                                        <th className="text-center">OTP Breached %</th>
                                        <th className="text-center">DSR %</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {day.slots.map((s) => {
                                        const slotSnop = getSlotSnopPlan(day.dateStr, day.dayOfWeek, s.slotHour);
                                        const slotBreach = s.ordersCount - slotSnop;
                                        return (
                                          <tr key={s.slotHour}>
                                            <td className="text-center font-bold text-slate" title={s.slotLabel}>{s.slotHour}</td>
                                            {showSnopBreach && (
                                              <td className="text-center font-semibold">{slotSnop.toLocaleString()}</td>
                                            )}
                                            <td className="text-center font-semibold">{s.ordersCount}</td>
                                            {showSnopBreach && (
                                              <td className="text-center">{renderBreachCellContent(slotBreach, slotSnop)}</td>
                                            )}
                                            <td className="text-center">{s.ridersCount}</td>
                                            <td className="text-center">
                                              <span className={`dph-pill ${getDphHeatmapClass(s.dph)}`}>
                                                {s.dph.toFixed(1)}
                                              </span>
                                            </td>
                                            <td className={`text-center ${getS2pBadgeClass(s.avgS2p)}`}>
                                              {s.avgS2p.toFixed(2)}
                                            </td>
                                            <td className="text-center font-semibold text-green">
                                              {s.otpAchievedPct.toFixed(2)}%
                                            </td>
                                            <td className={`text-center ${s.otpBreachedPct > 0 ? 'text-red' : 'text-green'}`}>
                                              {s.otpBreachedPct > 0 ? (
                                                <div className="otp-breach-cell-wrap">
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      setOtpBreachedModal({
                                                        orderDate: day.dateStr,
                                                        formattedDate: day.formattedDate,
                                                        slotHour: s.slotHour,
                                                      })
                                                    }
                                                    className="otp-breach-trigger text-red"
                                                    title={`Click to view ${s.otpBreachedCount} breached order(s) for Slot ${s.slotHour}`}
                                                  >
                                                    {s.otpBreachedPct.toFixed(2)}%
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      setRcaModal({
                                                        mode: 'otp',
                                                        orderDate: day.dateStr,
                                                        formattedDate: day.formattedDate,
                                                        slotHour: s.slotHour,
                                                      })
                                                    }
                                                    className="otp-rca-trigger"
                                                    title={`Submit RCA for Slot ${s.slotHour} breached order(s)`}
                                                  >
                                                    Submit RCA
                                                  </button>
                                                </div>
                                              ) : (
                                                '0.00%'
                                              )}
                                            </td>
                                            <td className="text-center font-semibold">
                                              {s.ordersCount > 0 && (s.dsrPct ?? 100) < 100 ? (
                                                <div className="otp-breach-cell-wrap">
                                                  <span
                                                    className={`otp-breach-center-val ${(s.dsrPct ?? 0) > 99.0 ? 'text-green' : 'text-red'}`}
                                                    title={`Completed: ${(s.completedOrdersCount ?? 0).toLocaleString()} / ${(s.dsrEligibleOrdersCount ?? s.ordersCount).toLocaleString()}`}
                                                  >
                                                    {(s.dsrPct ?? 0).toFixed(1)}%
                                                  </span>
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      setRcaModal({
                                                        mode: 'dsr',
                                                        orderDate: day.dateStr,
                                                        formattedDate: day.formattedDate,
                                                        slotHour: s.slotHour,
                                                      })
                                                    }
                                                    className="otp-rca-trigger"
                                                    title={`Submit DSR RCA for Slot ${s.slotHour} RTO_DELIVERED order(s)`}
                                                  >
                                                    Submit RCA
                                                  </button>
                                                </div>
                                              ) : (
                                                <span
                                                  className={(s.dsrPct ?? 0) > 99.0 ? 'text-green' : 'text-red'}
                                                  title={`Completed: ${(s.completedOrdersCount ?? 0).toLocaleString()} / ${(s.dsrEligibleOrdersCount ?? s.ordersCount).toLocaleString()}`}
                                                >
                                                  {(s.dsrPct ?? 0).toFixed(1)}%
                                                </span>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                    <tfoot>
                                      <tr className="excel-pivot-grand-total">
                                        <td className="text-center font-bold">Grand Total</td>
                                        {showSnopBreach && (
                                          <td className="text-center font-bold">{daySnopPlan.toLocaleString()}</td>
                                        )}
                                        <td className="text-center font-bold">{day.totalOrders}</td>
                                        {showSnopBreach && (
                                          <td className="text-center">{renderBreachCellContent(dayBreach, dayBreachPlanDenom, dayBreachTooltip)}</td>
                                        )}
                                        <td className="text-center font-bold">{day.distinctRidersCount}</td>
                                        <td className="text-center font-bold">
                                          <span className={`dph-pill ${getDphHeatmapClass(day.avgDph)}`}>
                                            {day.avgDph.toFixed(1)}
                                          </span>
                                        </td>
                                        <td className={`text-center font-bold ${getS2pBadgeClass(day.avgS2p)}`}>
                                          {day.avgS2p.toFixed(2)}
                                        </td>
                                        <td className="text-center font-bold text-green">
                                          {day.avgOtpAchievedPct.toFixed(2)}%
                                        </td>
                                        <td className={`text-center font-bold ${day.avgOtpBreachedPct > 0 ? 'text-red' : 'text-green'}`}>
                                          {day.avgOtpBreachedPct > 0 ? (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setOtpBreachedModal({
                                                  orderDate: day.dateStr,
                                                  formattedDate: day.formattedDate,
                                                  slotHour: null,
                                                })
                                              }
                                              className="otp-breach-trigger font-bold text-red"
                                              title={`Click to view all ${day.otpBreachedCount} breached order(s) on ${day.formattedDate}`}
                                            >
                                              {day.avgOtpBreachedPct.toFixed(2)}%
                                            </button>
                                          ) : (
                                            `${day.avgOtpBreachedPct.toFixed(2)}%`
                                          )}
                                        </td>
                                        <td className="text-center font-bold">
                                          <span className={(day.dsrPct ?? 0) > 99.0 ? 'text-green' : 'text-red'}>
                                            {(day.dsrPct ?? 0).toFixed(1)}%
                                          </span>
                                        </td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              )}

                              {/* VIEW B: S2P Pivot (Replicates User Image 1) */}
                              {activeView === 's2p' && (
                                <div className="excel-pivot-layout">
                                  <div className="excel-pivot-table-container max-w-sm">
                                    <table className="excel-pivot-table">
                                      <thead>
                                        <tr>
                                          <th className="text-center" style={{ width: '120px' }}><em>Slot</em></th>
                                          <th className="text-center">AVERAGE of S2P</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {day.slots.map((s) => (
                                          <tr key={s.slotHour}>
                                            <td className="text-center">{s.slotHour}</td>
                                            <td className="text-center font-semibold">{s.avgS2p.toFixed(2)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                      <tfoot>
                                        <tr className="excel-pivot-grand-total">
                                          <td className="text-center font-bold">Grand Total</td>
                                          <td className="text-center font-bold">{day.avgS2p.toFixed(2)}</td>
                                        </tr>
                                      </tfoot>
                                    </table>
                                  </div>
                                  <div className="excel-pivot-legend-note">
                                    <p className="text-xs text-muted">
                                      <strong>Pivot Configuration:</strong> Slot in Rows, S2P in Values (summarized by AVERAGE).
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* VIEW C: OTP+3 Pivot (Replicates User Image 2) */}
                              {activeView === 'otp' && (
                                <div className="excel-pivot-layout">
                                  <div className="excel-pivot-table-container max-w-lg">
                                    <table className="excel-pivot-table">
                                      <thead>
                                        <tr>
                                          <th rowSpan={2} className="text-center" style={{ width: '100px', verticalAlign: 'bottom' }}>
                                            <em>Slot</em>
                                          </th>
                                          <th colSpan={2} className="text-center border-b">
                                            OTP+3 Performance
                                          </th>
                                        </tr>
                                        <tr>
                                          <th className="text-center">OTP Achieved</th>
                                          <th className="text-center">OTP Breached</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {day.slots.map((s) => (
                                          <tr key={s.slotHour}>
                                            <td className="text-center">{s.slotHour}</td>
                                            <td className="text-center font-semibold text-green">
                                              {s.otpAchievedPct.toFixed(2)}%
                                            </td>
                                            <td className={`text-center ${s.otpBreachedPct > 0 ? 'text-red' : 'text-green'}`}>
                                              {s.otpBreachedPct > 0 ? (
                                                <div className="otp-breach-cell-wrap">
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      setOtpBreachedModal({
                                                        orderDate: day.dateStr,
                                                        formattedDate: day.formattedDate,
                                                        slotHour: s.slotHour,
                                                      })
                                                    }
                                                    className="otp-breach-trigger text-red"
                                                    title={`Click to view ${s.otpBreachedCount} breached order(s) for Slot ${s.slotHour}`}
                                                  >
                                                    {s.otpBreachedPct.toFixed(2)}%
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      setRcaModal({
                                                        mode: 'otp',
                                                        orderDate: day.dateStr,
                                                        formattedDate: day.formattedDate,
                                                        slotHour: s.slotHour,
                                                      })
                                                    }
                                                    className="otp-rca-trigger"
                                                    title={`Submit RCA for Slot ${s.slotHour} breached order(s)`}
                                                  >
                                                    Submit RCA
                                                  </button>
                                                </div>
                                              ) : (
                                                ''
                                              )}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                      <tfoot>
                                        <tr className="excel-pivot-grand-total">
                                          <td className="text-center font-bold">Grand Total</td>
                                          <td className="text-center font-bold text-green">
                                            {day.avgOtpAchievedPct.toFixed(2)}%
                                          </td>
                                          <td className={`text-center font-bold ${day.avgOtpBreachedPct > 0 ? 'text-red' : 'text-green'}`}>
                                            {day.avgOtpBreachedPct > 0 ? (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  setOtpBreachedModal({
                                                    orderDate: day.dateStr,
                                                    formattedDate: day.formattedDate,
                                                    slotHour: null,
                                                  })
                                                }
                                                className="otp-breach-trigger font-bold text-red"
                                                title={`Click to view all ${day.otpBreachedCount} breached order(s) on ${day.formattedDate}`}
                                              >
                                                {day.avgOtpBreachedPct.toFixed(2)}%
                                              </button>
                                            ) : (
                                              `${day.avgOtpBreachedPct.toFixed(2)}%`
                                            )}
                                          </td>
                                        </tr>
                                      </tfoot>
                                    </table>
                                  </div>
                                  <div className="excel-pivot-legend-note">
                                    <p className="text-xs text-muted">
                                      <strong>Pivot Configuration:</strong> Slot in Rows, OTP+3 Performance in Columns & Values (summarized by COUNTA and Show as % of Row).
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* VIEW D: DPH Pivot (Replicates User Image 3) */}
                              {activeView === 'dph' && (
                                <div className="excel-pivot-layout">
                                  <div className="excel-pivot-table-container max-w-md">
                                    <table className="excel-pivot-table">
                                      <thead>
                                        <tr>
                                          <th className="text-center" style={{ width: '80px' }}><em>Slot</em></th>
                                          {showSnopBreach && <th className="text-center">SNOP Plan</th>}
                                          <th className="text-center">Orders</th>
                                          {showSnopBreach && <th className="text-center">Breach</th>}
                                          <th className="text-center">Riders Turn-up</th>
                                          <th className="text-center">DPH</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {day.slots.map((s) => {
                                          const slotSnop = getSlotSnopPlan(day.dateStr, day.dayOfWeek, s.slotHour);
                                          const slotBreach = s.ordersCount - slotSnop;
                                          return (
                                            <tr key={s.slotHour}>
                                              <td className="text-center">{s.slotHour}</td>
                                              {showSnopBreach && (
                                                <td className="text-center font-semibold">{slotSnop.toLocaleString()}</td>
                                              )}
                                              <td className="text-center">{s.ordersCount}</td>
                                              {showSnopBreach && (
                                                <td className="text-center">{renderBreachCellContent(slotBreach, slotSnop)}</td>
                                              )}
                                              <td className="text-center">{s.ridersCount}</td>
                                              <td className={`text-center ${getDphHeatmapClass(s.dph)}`}>
                                                {s.dph.toFixed(1)}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                      <tfoot>
                                        <tr className="excel-pivot-grand-total">
                                          <td className="text-center font-bold">Grand Total</td>
                                          {showSnopBreach && (
                                            <td className="text-center font-bold">{daySnopPlan.toLocaleString()}</td>
                                          )}
                                          <td className="text-center font-bold">{day.totalOrders}</td>
                                          {showSnopBreach && (
                                            <td className="text-center">
                                              {renderBreachCellContent(dayBreach, dayBreachPlanDenom, dayBreachTooltip)}
                                            </td>
                                          )}
                                          <td className="text-center font-bold">{day.distinctRidersCount}</td>
                                          <td className={`text-center font-bold ${getDphHeatmapClass(day.avgDph)}`}>
                                            {day.avgDph.toFixed(1)}
                                          </td>
                                        </tr>
                                      </tfoot>
                                    </table>
                                  </div>
                                  <div className="excel-pivot-legend-note">
                                    <p className="text-xs text-muted">
                                      <strong>Pivot Configuration:</strong> Slot in Rows, Order ID (COUNTA), Rider Number (COUNTUNIQUE as Actual Riders Turn-Up), and DPH (Orders / Riders).
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                {(() => {
                  let periodSnopTotal = 0;
                  let periodCompletedSnopPlan = 0;
                  let periodCompletedBreach = 0;
                  let periodCompletedOrders = 0;
                  let periodHasOngoingExcluded = false;
                  for (const d of activeSummary.days) {
                    const m = getDaySnopMetrics(d);
                    periodSnopTotal += m.totalSnopPlan;
                    periodCompletedSnopPlan += m.completedSnopPlan;
                    periodCompletedBreach += m.completedBreach;
                    periodCompletedOrders += m.completedOrders;
                    if (m.hasOngoingSlotExcluded) {
                      periodHasOngoingExcluded = true;
                    }
                  }
                  const periodBreachTooltip = periodHasOngoingExcluded
                    ? `Completed slots only (excludes ongoing slot): ${periodCompletedOrders.toLocaleString()} orders vs ${periodCompletedSnopPlan.toLocaleString()} SNOP plan`
                    : undefined;
                  return (
                    <tr className="s2p-overall-grand-total">
                      <td colSpan={3} className="font-bold">
                        Period Grand Total ({activeSummary.periodDays} {activeSummary.periodDays === 1 ? 'Day' : 'Days'})
                      </td>
                      {showSnopBreach && (
                        <td className="text-right font-bold">{periodSnopTotal.toLocaleString()}</td>
                      )}
                      <td className="text-right font-bold">{activeSummary.overallTotalOrders.toLocaleString()}</td>
                      {showSnopBreach && (
                        <td className="text-right">
                          {renderBreachCellContent(
                            periodCompletedBreach,
                            periodCompletedSnopPlan,
                            periodBreachTooltip
                          )}
                        </td>
                      )}
                      <td className="text-right font-bold">
                        <span className={(activeSummary.overallDsrPct ?? 0) > 99.0 ? 'text-green' : 'text-red'}>
                          {(activeSummary.overallDsrPct ?? 0).toFixed(1)}%
                        </span>
                      </td>
                      <td className="text-right font-bold">{activeSummary.overallDistinctRiders} riders</td>
                      <td className="text-right font-bold">
                        <span className={`dph-pill ${getDphHeatmapClass(activeSummary.overallAvgDph)}`}>
                          {activeSummary.overallAvgDph.toFixed(1)}
                        </span>
                      </td>
                      <td className="text-center font-normal text-muted" />
                      <td className={`text-right font-bold ${getS2pBadgeClass(activeSummary.overallAvgS2p)}`}>
                        {activeSummary.overallAvgS2p.toFixed(2)} min
                      </td>
                      <td className="text-right font-bold text-green">
                        {activeSummary.overallOtpAchievedPct.toFixed(2)}%
                      </td>
                      <td />
                    </tr>
                  );
                })()}
              </tfoot>
            </table>
          </div>
          );

          return (
            <>
              {renderDailySummaryTable(snopBreachVisible, undefined, true)}
              <div
                ref={snopPortalHostRef}
                aria-hidden="true"
                style={{
                  position: 'fixed',
                  left: '-99999px',
                  top: 0,
                  width: 'max-content',
                  minWidth: '1580px',
                  pointerEvents: 'none',
                  zIndex: -1,
                }}
              />
              {renderSnopPortal &&
                snopPortalHostRef.current &&
                createPortal(renderDailySummaryTable(true, 'all', false), snopPortalHostRef.current)}
            </>
          );
        })()}
      </div>

      {selectedStore && otpBreachedModal && (
        <OtpBreachedRidersModal
          isOpen={Boolean(otpBreachedModal)}
          onClose={() => setOtpBreachedModal(null)}
          storeId={selectedStore.id}
          storeCode={selectedStore.store_code}
          orderDate={otpBreachedModal.orderDate}
          formattedDate={otpBreachedModal.formattedDate}
          slotHour={otpBreachedModal.slotHour}
        />
      )}

      {selectedStore && rcaModal && (
        <OtpBreachRcaModal
          isOpen={Boolean(rcaModal)}
          onClose={() => setRcaModal(null)}
          storeId={selectedStore.id}
          storeCode={selectedStore.store_code}
          orderDate={rcaModal.orderDate}
          formattedDate={rcaModal.formattedDate}
          slotHour={rcaModal.slotHour}
          mode={rcaModal.mode}
        />
      )}
    </div>
  );
};
