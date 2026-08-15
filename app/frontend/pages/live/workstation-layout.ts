import type { CSSProperties } from 'react'

/** Compact swiss-grid quarter cell (24px). Header uses 2 rows at this scale. */
export const COMPACT_QUARTER_CELL = 24

export const MIN_BROWSER_COLS = 2
export const MIN_TIMELINE_COLS = 4
export const MIN_DEVICE_ROWS = 2
export const MIN_TIMELINE_ROWS = 4

export interface WorkstationSize {
  widthPx: number
  heightPx: number
  cellPx: number
}

export interface WorkstationPaneIntent {
  browserCols: number
  deviceRows: number
}

export interface WorkstationLayout {
  headerRows: number
  browserCols: number
  timelineCol: number
  contentStart: number
  contentRows: number
  deviceStart: number
  deviceRows: number
  colCount: number
  rowCount: number
}

/** Fallback used before the shell is measured (SSR / first layout). */
export const FALLBACK_LAYOUT: WorkstationLayout = {
  headerRows: 1,
  browserCols: 3,
  timelineCol: 4,
  contentStart: 2,
  contentRows: 9,
  deviceStart: 11,
  deviceRows: 2,
  colCount: 12,
  rowCount: 12,
}

export function headerRowsForCell(cellPx: number): number {
  return cellPx <= COMPACT_QUARTER_CELL ? 2 : 1
}

export function defaultBrowserCols(cellPx: number): number {
  return cellPx <= COMPACT_QUARTER_CELL ? 4 : 3
}

export function defaultDeviceRows(cellPx: number): number {
  if (cellPx <= COMPACT_QUARTER_CELL) return 5
  if (cellPx <= 48) return 3
  return 2
}

export function snapCount(px: number, cellPx: number): number {
  if (cellPx <= 0) return 1
  return Math.max(1, Math.round(px / cellPx))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Integer-cell placement for the three-region shell.
 * Header + content + devices always consume every complete row in the viewport.
 */
export function layoutWorkstation(
  size: WorkstationSize,
  intent: WorkstationPaneIntent,
): WorkstationLayout {
  const cellPx = size.cellPx
  if (cellPx <= 0 || size.widthPx <= 0 || size.heightPx <= 0) return FALLBACK_LAYOUT

  const colCount = Math.max(MIN_BROWSER_COLS + MIN_TIMELINE_COLS, Math.floor(size.widthPx / cellPx))
  const rowCount = Math.floor(size.heightPx / cellPx)
  const headerRows = headerRowsForCell(cellPx)
  const minBodyRows = MIN_TIMELINE_ROWS + MIN_DEVICE_ROWS
  if (rowCount < headerRows + minBodyRows) return FALLBACK_LAYOUT

  const maxBrowserCols = colCount - MIN_TIMELINE_COLS
  const browserCols = clamp(intent.browserCols, MIN_BROWSER_COLS, maxBrowserCols)

  const maxDeviceRows = rowCount - headerRows - MIN_TIMELINE_ROWS
  const deviceRows = clamp(intent.deviceRows, MIN_DEVICE_ROWS, maxDeviceRows)

  const contentStart = headerRows + 1
  const contentRows = rowCount - headerRows - deviceRows
  const deviceStart = contentStart + contentRows

  return {
    headerRows,
    browserCols,
    timelineCol: browserCols + 1,
    contentStart,
    contentRows,
    deviceStart,
    deviceRows,
    colCount,
    rowCount,
  }
}

export function paneVars(placement: {
  col?: number
  span?: number
  row: number
  rows: number
}): CSSProperties {
  const vars: CSSProperties & Record<string, number> = {
    '--sg-row': placement.row,
    '--sg-row-span': placement.rows,
  }
  if (placement.col != null) vars['--sg-col'] = placement.col
  if (placement.span != null) vars['--sg-span'] = placement.span
  return vars
}
