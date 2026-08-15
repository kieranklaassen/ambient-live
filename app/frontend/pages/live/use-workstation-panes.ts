import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'

import {
  defaultBrowserCols,
  defaultDeviceRows,
  layoutWorkstation,
  snapCount,
  type WorkstationLayout,
} from './workstation-layout'

interface DragState {
  axis: 'x' | 'y'
  pointerId: number
}

export interface WorkstationPanes {
  shellRef: RefObject<HTMLElement | null>
  layout: WorkstationLayout
  dragging: boolean
  startBrowserDrag: (event: PointerEvent<HTMLButtonElement>) => void
  moveBrowserDrag: (event: PointerEvent<HTMLButtonElement>) => void
  startDeviceDrag: (event: PointerEvent<HTMLButtonElement>) => void
  moveDeviceDrag: (event: PointerEvent<HTMLButtonElement>) => void
  endDrag: (event: PointerEvent<HTMLButtonElement>) => void
}

function readCellPx(el: HTMLElement): number {
  const raw = getComputedStyle(el).getPropertyValue('--sg-cell')
  const cellPx = Number.parseFloat(raw)
  return Number.isFinite(cellPx) && cellPx > 0 ? cellPx : 24
}

export function useWorkstationPanes(): WorkstationPanes {
  const shellRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const [cellPx, setCellPx] = useState(24)
  const [shellSize, setShellSize] = useState({ widthPx: 0, heightPx: 0 })
  const [browserCols, setBrowserCols] = useState(() => defaultBrowserCols(24))
  const [deviceRows, setDeviceRows] = useState(() => defaultDeviceRows(24))
  const [dragging, setDragging] = useState(false)
  const defaultsReadyRef = useRef(false)

  const measure = useCallback(() => {
    const el = shellRef.current
    if (!el) return
    const nextCell = readCellPx(el)
    setCellPx(nextCell)
    setShellSize({ widthPx: el.clientWidth, heightPx: el.clientHeight })
    if (!defaultsReadyRef.current) {
      defaultsReadyRef.current = true
      setBrowserCols(defaultBrowserCols(nextCell))
      setDeviceRows(defaultDeviceRows(nextCell))
    }
  }, [])

  useLayoutEffect(() => {
    const el = shellRef.current
    if (!el) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])

  const layout = layoutWorkstation(
    { widthPx: shellSize.widthPx, heightPx: shellSize.heightPx, cellPx },
    { browserCols, deviceRows },
  )

  const beginDrag = useCallback((event: PointerEvent<HTMLButtonElement>, axis: 'x' | 'y') => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { axis, pointerId: event.pointerId }
    setDragging(true)
  }, [])

  const startBrowserDrag = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => beginDrag(event, 'x'),
    [beginDrag],
  )

  const startDeviceDrag = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => beginDrag(event, 'y'),
    [beginDrag],
  )

  const moveBrowserDrag = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current
      const shell = shellRef.current
      if (!drag || drag.axis !== 'x' || drag.pointerId !== event.pointerId || !shell) return
      const next = snapCount(event.clientX - shell.getBoundingClientRect().left, cellPx)
      setBrowserCols((current) => (current === next ? current : next))
    },
    [cellPx],
  )

  const moveDeviceDrag = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current
      const shell = shellRef.current
      if (!drag || drag.axis !== 'y' || drag.pointerId !== event.pointerId || !shell) return
      const next = snapCount(shell.getBoundingClientRect().bottom - event.clientY, cellPx)
      setDeviceRows((current) => (current === next ? current : next))
    },
    [cellPx],
  )

  const endDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDragging(false)
  }, [])

  return {
    shellRef,
    layout,
    dragging,
    startBrowserDrag,
    moveBrowserDrag,
    startDeviceDrag,
    moveDeviceDrag,
    endDrag,
  }
}
