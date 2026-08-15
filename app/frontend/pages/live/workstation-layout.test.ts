import { describe, expect, it } from 'vitest'

import {
  COMPACT_QUARTER_CELL,
  FALLBACK_LAYOUT,
  defaultBrowserCols,
  defaultDeviceRows,
  headerRowsForCell,
  layoutWorkstation,
  snapCount,
} from './workstation-layout'

describe('headerRowsForCell', () => {
  it('uses two rows at compact quarter, one otherwise', () => {
    expect(headerRowsForCell(COMPACT_QUARTER_CELL)).toBe(2)
    expect(headerRowsForCell(48)).toBe(1)
    expect(headerRowsForCell(72)).toBe(1)
  })
})

describe('defaults', () => {
  it('matches the previous breakpoint spans', () => {
    expect(defaultBrowserCols(24)).toBe(4)
    expect(defaultBrowserCols(48)).toBe(3)
    expect(defaultDeviceRows(24)).toBe(5)
    expect(defaultDeviceRows(48)).toBe(3)
    expect(defaultDeviceRows(72)).toBe(2)
  })
})

describe('snapCount', () => {
  it('rounds to the nearest cell', () => {
    expect(snapCount(36, 24)).toBe(2)
    expect(snapCount(35, 24)).toBe(1)
    expect(snapCount(0, 72)).toBe(1)
  })
})

describe('layoutWorkstation', () => {
  it('consumes every complete viewport row', () => {
    const layout = layoutWorkstation(
      { widthPx: 1440, heightPx: 1080, cellPx: 72 },
      { browserCols: 3, deviceRows: 2 },
    )
    expect(layout.rowCount).toBe(15)
    expect(layout.headerRows + layout.contentRows + layout.deviceRows).toBe(15)
    expect(layout.deviceStart + layout.deviceRows - 1).toBe(15)
    expect(layout.timelineCol).toBe(4)
  })

  it('clamps the browser so the timeline keeps a minimum span', () => {
    const layout = layoutWorkstation(
      { widthPx: 576, heightPx: 864, cellPx: 48 },
      { browserCols: 20, deviceRows: 3 },
    )
    expect(layout.colCount).toBe(12)
    expect(layout.browserCols).toBe(8)
    expect(layout.timelineCol).toBe(9)
  })

  it('clamps the device strip so the timeline keeps a minimum height', () => {
    const layout = layoutWorkstation(
      { widthPx: 1440, heightPx: 1080, cellPx: 72 },
      { browserCols: 3, deviceRows: 40 },
    )
    expect(layout.deviceRows).toBe(10)
    expect(layout.contentRows).toBe(4)
  })

  it('falls back when the shell has not been measured', () => {
    expect(layoutWorkstation({ widthPx: 0, heightPx: 0, cellPx: 72 }, { browserCols: 3, deviceRows: 2 })).toEqual(
      FALLBACK_LAYOUT,
    )
  })
})
