import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

import {
  isClipTrimmable,
  moveClip,
  setFadeIn,
  setFadeOut,
  trimClipEnd,
  trimClipStart,
} from './timeline-clips'
import { LOOP_LENGTH_SEC, type SampleRegion } from './timeline-model'

export type ClipDragTarget = 'move' | 'trim-start' | 'trim-end' | 'fade-in' | 'fade-out'

/** Width of the trim strip on each edge of a clip. */
export const EDGE_ZONE_PX = 6
/** Grab radius of a fade handle, and the height of the band it lives in. */
export const FADE_HANDLE_PX = 10

export interface ClipHit {
  offsetXPx: number
  offsetYPx: number
  widthPx: number
  fadeInPx: number
  fadeOutPx: number
  trimmable: boolean
}

/**
 * Which part of a clip a press landed on. Fade handles sit in the top band and
 * win over the trim strip they overlap, so a fade that has been dragged to zero
 * is still grabbable at the corner.
 */
export function resolveClipDragTarget(hit: ClipHit): ClipDragTarget {
  if (!hit.trimmable) return 'move'

  if (hit.offsetYPx <= FADE_HANDLE_PX) {
    if (Math.abs(hit.offsetXPx - hit.fadeInPx) <= FADE_HANDLE_PX) return 'fade-in'
    if (Math.abs(hit.offsetXPx - (hit.widthPx - hit.fadeOutPx)) <= FADE_HANDLE_PX) return 'fade-out'
  }

  // A narrow clip shrinks its trim strips so there is always an interior to grab.
  const edge = Math.min(EDGE_ZONE_PX, hit.widthPx / 3)
  if (hit.offsetXPx <= edge) return 'trim-start'
  if (hit.offsetXPx >= hit.widthPx - edge) return 'trim-end'
  return 'move'
}

export function secondsPerPixel(widthPx: number, loopLengthSec: number = LOOP_LENGTH_SEC): number {
  if (widthPx <= 0) return 0
  return loopLengthSec / widthPx
}

/** Applies a drag of `deltaSec` from where the clip stood when the press landed. */
export function applyClipDrag(
  origin: SampleRegion,
  target: ClipDragTarget,
  deltaSec: number,
  loopLengthSec: number = LOOP_LENGTH_SEC,
): SampleRegion {
  switch (target) {
    case 'move':
      return moveClip(origin, deltaSec, loopLengthSec)
    case 'trim-start':
      return trimClipStart(origin, deltaSec)
    case 'trim-end':
      return trimClipEnd(origin, deltaSec, loopLengthSec)
    case 'fade-in':
      return setFadeIn(origin, origin.fadeInSec + deltaSec)
    case 'fade-out':
      return setFadeOut(origin, origin.fadeOutSec - deltaSec)
    default: {
      const _exhaustive: never = target
      return _exhaustive
    }
  }
}

interface ClipDragSession {
  pointerId: number
  target: ClipDragTarget
  origin: SampleRegion
  originClientX: number
  secondsPerPixel: number
}

interface UseClipDragOptions {
  laneRef: RefObject<HTMLDivElement | null>
  loopLengthSec?: number
  onClipChange: (clip: SampleRegion) => void
}

/**
 * Pointer-captured clip editing. Every move re-applies the total drag to the
 * clip as it stood at press time, so a clamped edge does not drift.
 */
export function useClipDrag({
  laneRef,
  loopLengthSec = LOOP_LENGTH_SEC,
  onClipChange,
}: UseClipDragOptions) {
  const sessionRef = useRef<ClipDragSession | null>(null)
  const draggedRef = useRef(false)
  const [dragTarget, setDragTarget] = useState<ClipDragTarget | null>(null)

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, clip: SampleRegion) => {
      const laneWidth = laneRef.current?.getBoundingClientRect().width ?? 0
      const bounds = event.currentTarget.getBoundingClientRect()
      if (laneWidth <= 0 || bounds.width <= 0) return

      const perPixel = secondsPerPixel(laneWidth, loopLengthSec)
      const target = resolveClipDragTarget({
        offsetXPx: event.clientX - bounds.left,
        offsetYPx: event.clientY - bounds.top,
        widthPx: bounds.width,
        fadeInPx: clip.fadeInSec / perPixel,
        fadeOutPx: clip.fadeOutSec / perPixel,
        trimmable: isClipTrimmable(clip),
      })

      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // No capture available for this pointer; the drag still tracks moves
        // over the clip itself.
      }
      event.preventDefault()
      sessionRef.current = {
        pointerId: event.pointerId,
        target,
        origin: clip,
        originClientX: event.clientX,
        secondsPerPixel: perPixel,
      }
      draggedRef.current = false
      setDragTarget(target)
    },
    [laneRef, loopLengthSec],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const session = sessionRef.current
      if (!session || session.pointerId !== event.pointerId) return
      const deltaSec = (event.clientX - session.originClientX) * session.secondsPerPixel
      if (deltaSec !== 0) draggedRef.current = true
      onClipChange(applyClipDrag(session.origin, session.target, deltaSec, loopLengthSec))
    },
    [loopLengthSec, onClipChange],
  )

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const session = sessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    sessionRef.current = null
    setDragTarget(null)
  }, [])

  /** True while a drag is in flight or just ended, so the surface skips its seek click. */
  const consumeDragClick = useCallback(() => {
    if (!draggedRef.current) return false
    draggedRef.current = false
    return true
  }, [])

  return { dragTarget, onPointerDown, onPointerMove, onPointerUp, consumeDragClick }
}
