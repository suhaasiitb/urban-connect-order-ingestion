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
