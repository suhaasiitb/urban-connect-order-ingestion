export interface SnapshotThemeColors {
  bgColor: string;
  textColor: string;
  subTextColor: string;
  borderColor: string;
}

export interface SnapshotTableHeader {
  label: string;
  className?: string;
  width?: string;
}

export interface SnapshotTableCell {
  text: string;
  className?: string;
  colSpan?: number;
}

export function formatCapturedTimestamp(timeZone: string): string {
  return `Captured ${new Date().toLocaleString('en-IN', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function createSnapshotEnvironment(
  minWidth: number,
  rootClassName = 'analytics-container s2p-otp-container'
): SnapshotThemeColors & { offscreenHost: HTMLDivElement; captureTarget: HTMLDivElement } {
  const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark';
  const bgColor = isDarkTheme ? '#0b0d12' : '#f8fafc';
  const textColor = isDarkTheme ? '#f1f5f9' : '#0f172a';
  const subTextColor = isDarkTheme ? '#94a3b8' : '#475569';
  const borderColor = isDarkTheme ? '#1e293b' : '#e2e8f0';

  const offscreenHost = document.createElement('div');
  offscreenHost.style.position = 'fixed';
  offscreenHost.style.left = '-99999px';
  offscreenHost.style.top = '0';
  offscreenHost.style.pointerEvents = 'none';
  offscreenHost.style.zIndex = '-1';

  const captureTarget = document.createElement('div');
  captureTarget.dataset.screenshotRoot = 'true';
  captureTarget.className = rootClassName;
  captureTarget.style.width = `${minWidth}px`;
  captureTarget.style.padding = '20px 24px 24px';
  captureTarget.style.backgroundColor = bgColor;
  captureTarget.style.display = 'flex';
  captureTarget.style.flexDirection = 'column';
  captureTarget.style.gap = '16px';
  captureTarget.style.boxSizing = 'border-box';
  captureTarget.style.margin = '0';

  return { offscreenHost, captureTarget, bgColor, textColor, subTextColor, borderColor };
}

export function buildSnapshotHeader(
  titleText: string,
  subtitleText: string,
  timeZone: string,
  colors: Pick<SnapshotThemeColors, 'textColor' | 'subTextColor' | 'borderColor'>
): HTMLDivElement {
  const headerBar = document.createElement('div');
  headerBar.style.display = 'flex';
  headerBar.style.alignItems = 'center';
  headerBar.style.justifyContent = 'space-between';
  headerBar.style.gap = '12px';
  headerBar.style.paddingBottom = '10px';
  headerBar.style.borderBottom = `1px solid ${colors.borderColor}`;

  const leftMeta = document.createElement('div');
  const titleEl = document.createElement('div');
  titleEl.textContent = titleText;
  titleEl.style.fontSize = '16px';
  titleEl.style.fontWeight = '700';
  titleEl.style.color = colors.textColor;

  const subEl = document.createElement('div');
  subEl.textContent = subtitleText;
  subEl.style.fontSize = '12px';
  subEl.style.color = colors.subTextColor;
  subEl.style.marginTop = '2px';
  leftMeta.append(titleEl, subEl);

  const rightMeta = document.createElement('div');
  rightMeta.textContent = formatCapturedTimestamp(timeZone);
  rightMeta.style.fontSize = '11px';
  rightMeta.style.color = colors.subTextColor;
  rightMeta.style.whiteSpace = 'nowrap';

  headerBar.append(leftMeta, rightMeta);
  return headerBar;
}

export function buildSnapshotTableCard(params: {
  cardTitle: string;
  borderColor: string;
  headers: SnapshotTableHeader[];
  rows: SnapshotTableCell[][];
  emptyText: string;
  footerCells?: SnapshotTableCell[];
}): HTMLDivElement {
  const { cardTitle, borderColor, headers, rows, emptyText, footerCells } = params;
  const card = document.createElement('div');
  card.className = 's2p-slot-breakdown-card';
  card.style.border = `1px solid ${borderColor}`;
  card.style.borderRadius = '10px';
  card.style.padding = '14px';

  const heading = document.createElement('h4');
  heading.className = 's2p-slot-title';
  heading.textContent = cardTitle;
  heading.style.marginBottom = '10px';
  card.appendChild(heading);

  const tableWrap = document.createElement('div');
  tableWrap.className = 'excel-pivot-table-container';
  tableWrap.style.overflowX = 'visible';

  const table = document.createElement('table');
  table.className = 'excel-pivot-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const h of headers) {
    const th = document.createElement('th');
    if (h.className) th.className = h.className;
    if (h.width) th.style.width = h.width;
    th.textContent = h.label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  if (rows.length === 0) {
    const emptyRow = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = headers.length;
    emptyCell.className = 'text-center text-green font-semibold';
    emptyCell.textContent = emptyText;
    emptyRow.appendChild(emptyCell);
    tbody.appendChild(emptyRow);
  } else {
    for (const cells of rows) {
      const tr = document.createElement('tr');
      for (const cell of cells) {
        const td = document.createElement('td');
        if (cell.className) td.className = cell.className;
        td.textContent = cell.text;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }
  table.appendChild(tbody);

  if (footerCells && footerCells.length > 0) {
    const tfoot = document.createElement('tfoot');
    const footRow = document.createElement('tr');
    footRow.className = 'excel-pivot-grand-total';
    for (const fc of footerCells) {
      const td = document.createElement('td');
      if (fc.colSpan && fc.colSpan > 1) td.colSpan = fc.colSpan;
      if (fc.className) td.className = fc.className;
      td.textContent = fc.text;
      footRow.appendChild(td);
    }
    tfoot.appendChild(footRow);
    table.appendChild(tfoot);
  }

  tableWrap.appendChild(table);
  card.appendChild(tableWrap);
  return card;
}

export async function renderAndDownloadSnapshot(params: {
  rootContainer: HTMLElement;
  offscreenHost: HTMLElement;
  captureTarget: HTMLElement;
  bgColor: string;
  minWidth: number;
  fileName: string;
}): Promise<void> {
  const { rootContainer, offscreenHost, captureTarget, bgColor, minWidth, fileName } = params;
  offscreenHost.appendChild(captureTarget);
  rootContainer.appendChild(offscreenHost);

  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );

  const finalWidth = Math.max(minWidth, captureTarget.scrollWidth);
  captureTarget.style.width = `${finalWidth}px`;
  const finalHeight = captureTarget.scrollHeight;

  const onCloneEachNode = (cloned: Node) => {
    if (!(cloned instanceof HTMLElement)) return;
    if (cloned.dataset.screenshotRoot === 'true') return;

    const isFixedIcon =
      cloned.classList.contains('s2p-expand-toggle-btn') ||
      cloned.classList.contains('snop-breach-toggle-dot');

    if (!isFixedIcon) {
      // Clear frozen pixel height / logical box sizes computed in source font
      // so text & flex containers flow naturally inside SVG <foreignObject> without overlapping.
      cloned.style.removeProperty('height');
      cloned.style.removeProperty('block-size');
      cloned.style.removeProperty('inline-size');

      const tag = cloned.tagName;
      const isFlexOrText =
        tag === 'SPAN' ||
        tag === 'STRONG' ||
        tag === 'H2' ||
        tag === 'H3' ||
        tag === 'H4' ||
        tag === 'P' ||
        tag === 'BUTTON' ||
        cloned.classList.contains('segmented-control') ||
        cloned.classList.contains('flex-row');

      if (isFlexOrText) {
        cloned.style.removeProperty('width');
      }
      if (
        cloned.classList.contains('kpi-header-row') ||
        cloned.classList.contains('s2p-slot-header') ||
        cloned.classList.contains('justify-between')
      ) {
        cloned.style.width = '100%';
      }
      if (
        cloned.classList.contains('badge') ||
        cloned.classList.contains('segmented-btn') ||
        cloned.classList.contains('dph-impacted-slots') ||
        cloned.classList.contains('admin-summary-pill')
      ) {
        cloned.style.whiteSpace = 'nowrap';
      }
    }
  };

  const { domToPng } = await import('modern-screenshot');
  let dataUrl: string;
  try {
    dataUrl = await domToPng(captureTarget, {
      scale: 2,
      backgroundColor: bgColor,
      width: finalWidth,
      height: finalHeight,
      onCloneEachNode,
    });
  } catch {
    dataUrl = await domToPng(captureTarget, {
      scale: 2,
      backgroundColor: bgColor,
      width: finalWidth,
      height: finalHeight,
      font: false,
      onCloneEachNode,
    });
  }

  const link = document.createElement('a');
  link.download = fileName;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export interface Under6HoursReportExportRow {
  riderName: string;
  loginTimeLabel: string;
  totalOrders: number;
}

export interface DelayedOrdersReportExportRow {
  riderName: string;
  delayedOrders: number;
  delayedDays: number;
}

async function runStandaloneReportDownload(params: {
  rootContainer: HTMLElement;
  minWidth: number;
  bgColor: string;
  padding: string;
  gap: string;
  fileName: string;
  buildContent: (captureTarget: HTMLDivElement) => void;
}): Promise<void> {
  const { rootContainer, minWidth, bgColor, padding, gap, fileName, buildContent } = params;
  const { offscreenHost, captureTarget } = createSnapshotEnvironment(minWidth, '');

  captureTarget.style.backgroundColor = bgColor;
  captureTarget.style.color = '#1e293b';
  captureTarget.style.padding = padding;
  captureTarget.style.gap = gap;
  captureTarget.style.fontFamily = "'Inter', 'DejaVu Sans', 'Segoe UI', Arial, sans-serif";

  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    buildContent(captureTarget);

    await renderAndDownloadSnapshot({
      rootContainer,
      offscreenHost,
      captureTarget,
      bgColor,
      minWidth,
      fileName,
    });
  } finally {
    offscreenHost.remove();
  }
}

function appendEmptyReportRow(tbody: HTMLElement, colSpan: number, message: string, borderBottom?: string): void {
  const emptyTr = document.createElement('tr');
  emptyTr.style.backgroundColor = '#ffffff';
  const emptyTd = document.createElement('td');
  emptyTd.colSpan = colSpan;
  emptyTd.textContent = message;
  emptyTd.style.padding = '16px';
  emptyTd.style.textAlign = 'center';
  emptyTd.style.fontSize = '14px';
  emptyTd.style.color = '#64748b';
  if (borderBottom) {
    emptyTd.style.border = borderBottom;
  }
  emptyTr.appendChild(emptyTd);
  tbody.appendChild(emptyTr);
}

/**
 * Renders and downloads the "AMAZON NOW – RIDER PERFORMANCE LIST" PNG image report
 * showing riders with <= 6 hrs login time (Rider Name, Login Time, Orders).
 */
export async function downloadUnder6HoursPerformanceReport(params: {
  rootContainer: HTMLElement;
  rows: Under6HoursReportExportRow[];
  storeCode: string;
  startDate: string;
  endDate: string;
}): Promise<void> {
  const { rootContainer, rows, storeCode, startDate, endDate } = params;
  const borderColor = '#cbd5e1';
  const dateSlug = startDate === endDate ? startDate : `${startDate}_to_${endDate}`;

  await runStandaloneReportDownload({
    rootContainer,
    minWidth: 860,
    bgColor: '#ffffff',
    padding: '28px 20px 26px',
    gap: '24px',
    fileName: `Rider-Performance-Under6h-${storeCode}-${dateSlug}.png`,
    buildContent: (captureTarget) => {
      const titleEl = document.createElement('div');
      titleEl.textContent = 'AMAZON NOW – RIDER PERFORMANCE LIST';
      titleEl.style.width = '100%';
      titleEl.style.textAlign = 'center';
      titleEl.style.fontSize = '21px';
      titleEl.style.fontWeight = '800';
      titleEl.style.letterSpacing = '0.015em';
      titleEl.style.color = '#0f172a';
      titleEl.style.lineHeight = '1.25';
      captureTarget.appendChild(titleEl);

      const table = document.createElement('table');
      table.style.width = '100%';
      table.style.tableLayout = 'fixed';
      table.style.borderCollapse = 'collapse';
      table.style.border = `1px solid ${borderColor}`;
      table.style.backgroundColor = '#ffffff';

      const colGroup = document.createElement('colgroup');
      for (const widthPct of ['62%', '21%', '17%']) {
        const col = document.createElement('col');
        col.style.width = widthPct;
        colGroup.appendChild(col);
      }
      table.appendChild(colGroup);

      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      headRow.style.backgroundColor = '#14284b';

      const headers: Array<{ label: string; paddingLeft: string }> = [
        { label: 'Rider Name', paddingLeft: '48px' },
        { label: 'Login Time', paddingLeft: '14px' },
        { label: 'Orders', paddingLeft: '14px' },
      ];
      for (const col of headers) {
        const th = document.createElement('th');
        th.textContent = col.label;
        th.style.padding = `9px 14px 9px ${col.paddingLeft}`;
        th.style.color = '#ffffff';
        th.style.fontSize = '14px';
        th.style.fontWeight = '700';
        th.style.textAlign = 'left';
        th.style.border = `1px solid ${borderColor}`;
        th.style.backgroundColor = '#14284b';
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      if (rows.length === 0) {
        appendEmptyReportRow(tbody, 3, 'No riders with <= 6 hrs login time in selected period.', `1px solid ${borderColor}`);
      } else {
        rows.forEach((row, idx) => {
          const tr = document.createElement('tr');
          const rowBg = idx % 2 === 0 ? '#ffffff' : '#f2f6fb';
          tr.style.backgroundColor = rowBg;

          const cells: Array<{ text: string; paddingLeft: string }> = [
            { text: row.riderName, paddingLeft: '48px' },
            { text: row.loginTimeLabel, paddingLeft: '14px' },
            { text: String(row.totalOrders), paddingLeft: '14px' },
          ];
          for (const cell of cells) {
            const td = document.createElement('td');
            td.textContent = cell.text;
            td.style.padding = `8px 14px 8px ${cell.paddingLeft}`;
            td.style.fontSize = '14px';
            td.style.fontWeight = '400';
            td.style.color = '#1e293b';
            td.style.textAlign = 'left';
            td.style.border = `1px solid ${borderColor}`;
            td.style.backgroundColor = rowBg;
            td.style.whiteSpace = 'nowrap';
            td.style.overflow = 'hidden';
            td.style.textOverflow = 'ellipsis';
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        });
      }
      table.appendChild(tbody);
      captureTarget.appendChild(table);
    },
  });
}

/**
 * Renders and downloads the "AMAZON NOW — DELAYED ORDERS REPORT" PNG image report
 * showing OTP breached order counts and breached days per rider.
 */
export async function downloadDelayedOrdersReport(params: {
  rootContainer: HTMLElement;
  rows: DelayedOrdersReportExportRow[];
  storeCode: string;
  startDate: string;
  endDate: string;
  periodLabel: string;
}): Promise<void> {
  const { rootContainer, rows, storeCode, startDate, endDate, periodLabel } = params;
  const dateSlug = startDate === endDate ? startDate : `${startDate}_to_${endDate}`;

  await runStandaloneReportDownload({
    rootContainer,
    minWidth: 860,
    bgColor: '#f8fafc',
    padding: '24px 24px 22px',
    gap: '16px',
    fileName: `Delayed-Orders-Report-${storeCode}-${dateSlug}.png`,
    buildContent: (captureTarget) => {
      const banner = document.createElement('div');
      banner.style.width = '100%';
      banner.style.boxSizing = 'border-box';
      banner.style.backgroundColor = '#14284b';
      banner.style.borderRadius = '12px';
      banner.style.padding = '20px 26px';
      banner.style.display = 'flex';
      banner.style.flexDirection = 'column';
      banner.style.gap = '4px';

      const kicker = document.createElement('div');
      kicker.textContent = 'AMAZON NOW';
      kicker.style.fontSize = '12px';
      kicker.style.fontWeight = '700';
      kicker.style.letterSpacing = '0.07em';
      kicker.style.color = '#cbd5e1';

      const heading = document.createElement('div');
      heading.textContent = 'DELAYED ORDERS REPORT';
      heading.style.fontSize = '25px';
      heading.style.fontWeight = '800';
      heading.style.letterSpacing = '0.015em';
      heading.style.color = '#ffffff';
      heading.style.lineHeight = '1.15';

      const periodEl = document.createElement('div');
      periodEl.textContent = `Report period: ${periodLabel}`;
      periodEl.style.fontSize = '13px';
      periodEl.style.fontWeight = '500';
      periodEl.style.color = '#cbd5e1';
      periodEl.style.marginTop = '2px';

      banner.append(kicker, heading, periodEl);
      captureTarget.appendChild(banner);

      const card = document.createElement('div');
      card.style.width = '100%';
      card.style.boxSizing = 'border-box';
      card.style.backgroundColor = '#ffffff';
      card.style.border = '1px solid #e2e8f0';
      card.style.borderRadius = '10px';
      card.style.overflow = 'hidden';

      const table = document.createElement('table');
      table.style.width = '100%';
      table.style.tableLayout = 'fixed';
      table.style.borderCollapse = 'collapse';
      table.style.backgroundColor = '#ffffff';

      const colGroup = document.createElement('colgroup');
      for (const widthPct of ['62%', '22%', '16%']) {
        const col = document.createElement('col');
        col.style.width = widthPct;
        colGroup.appendChild(col);
      }
      table.appendChild(colGroup);

      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      headRow.style.backgroundColor = '#eaf0fa';

      const headers: Array<{ label: string; align: 'left' | 'center' }> = [
        { label: 'RIDER NAME', align: 'left' },
        { label: 'DELAYED ORDERS', align: 'center' },
        { label: 'DAYS', align: 'center' },
      ];
      for (const col of headers) {
        const th = document.createElement('th');
        th.textContent = col.label;
        th.style.padding = '12px 22px';
        th.style.fontSize = '12.5px';
        th.style.fontWeight = '700';
        th.style.letterSpacing = '0.04em';
        th.style.color = '#0f2744';
        th.style.textAlign = col.align;
        th.style.backgroundColor = '#eaf0fa';
        th.style.borderBottom = '1px solid #dce5f2';
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      if (rows.length === 0) {
        appendEmptyReportRow(tbody, 3, 'No riders with > 1 delayed (OTP breached) orders in selected period.');
      } else {
        rows.forEach((row, idx) => {
          const tr = document.createElement('tr');
          const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
          const isLast = idx === rows.length - 1;
          tr.style.backgroundColor = rowBg;

          const cells: Array<{
            text: string;
            align: 'left' | 'center';
            color: string;
            fontWeight: string;
            fontSize: string;
          }> = [
            { text: row.riderName, align: 'left', color: '#1e293b', fontWeight: '500', fontSize: '13.5px' },
            { text: String(row.delayedOrders), align: 'center', color: '#b91c1c', fontWeight: '700', fontSize: '14px' },
            { text: String(row.delayedDays), align: 'center', color: '#0f172a', fontWeight: '700', fontSize: '14px' },
          ];
          for (const cell of cells) {
            const td = document.createElement('td');
            td.textContent = cell.text;
            td.style.padding = '11px 22px';
            td.style.textAlign = cell.align;
            td.style.color = cell.color;
            td.style.fontWeight = cell.fontWeight;
            td.style.fontSize = cell.fontSize;
            td.style.backgroundColor = rowBg;
            td.style.borderBottom = isLast ? 'none' : '1px solid #f1f5f9';
            td.style.whiteSpace = 'nowrap';
            td.style.overflow = 'hidden';
            td.style.textOverflow = 'ellipsis';
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        });
      }
      table.appendChild(tbody);
      card.appendChild(table);
      captureTarget.appendChild(card);

      const warningBox = document.createElement('div');
      warningBox.style.width = '100%';
      warningBox.style.boxSizing = 'border-box';
      warningBox.style.padding = '4px 6px 2px';

      const warningTitle = document.createElement('div');
      warningTitle.textContent = 'STRICT PERFORMANCE WARNING';
      warningTitle.style.fontSize = '12px';
      warningTitle.style.fontWeight = '700';
      warningTitle.style.letterSpacing = '0.03em';
      warningTitle.style.color = '#b91c1c';

      const warningText = document.createElement('div');
      warningText.textContent = 'All riders must improve delivery performance and avoid repeated delays.';
      warningText.style.fontSize = '12px';
      warningText.style.fontWeight = '400';
      warningText.style.color = '#334155';
      warningText.style.marginTop = '3px';

      warningBox.append(warningTitle, warningText);
      captureTarget.appendChild(warningBox);
    },
  });
}
