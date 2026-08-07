import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'

import {
  clamp,
  denormalizeValue,
  normalizeValue,
  pointerDeltaToNormDelta,
  quantize,
  stepBy,
  type ControlTaper,
} from './control-math'

export interface ParamControlOptions {
  value: number
  min: number
  max: number
  step: number
  defaultValue: number
  taper?: ControlTaper
  skew?: number
  disabled?: boolean
  sensitivityPx?: number
  onChange: (value: number) => void
}

/**
 * Shared pointer + keyboard interaction for knobs/faders.
 * The control keeps its own live value so it stays responsive mid-drag, and
 * `onChange` fires only when the quantized value actually moves.
 */
export function useParamControl({
  value,
  min,
  max,
  step,
  defaultValue,
  taper = 'linear',
  skew = 2,
  disabled = false,
  sensitivityPx = 120,
  onChange,
}: ParamControlOptions) {
  const [liveValue, setLiveValue] = useState(value)
  const [interacting, setInteracting] = useState(false)
  const draggingRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const lastYRef = useRef(0)
  const fineRef = useRef(false)
  const liveValueRef = useRef(value)
  const normRef = useRef(normalizeValue(value, min, max, taper, skew))

  const syncFromProps = useEffectEvent((next: number) => {
    if (draggingRef.current) return
    liveValueRef.current = next
    setLiveValue(next)
    normRef.current = normalizeValue(next, min, max, taper, skew)
  })

  useEffect(() => {
    syncFromProps(value)
  }, [value, syncFromProps])

  /**
   * A quantized value repeats across consecutive pointer frames, so bail out
   * when nothing changed: a redundant `onChange` re-renders the page and
   * re-sends the param to the audio thread on every move.
   */
  function commitQuantized(next: number) {
    if (next === liveValueRef.current) return
    liveValueRef.current = next
    setLiveValue(next)
    onChange(next)
  }

  function commitNorm(nextNorm: number) {
    // Store the accumulated pointer position rather than snapping back to the
    // quantized value, so sub-step travel (Shift = fine drag) still adds up.
    normRef.current = nextNorm
    const raw = denormalizeValue(nextNorm, min, max, taper, skew)
    commitQuantized(quantize(raw, step, min, max))
  }

  function commitValue(next: number) {
    const clamped = quantize(next, step, min, max)
    normRef.current = normalizeValue(clamped, min, max, taper, skew)
    commitQuantized(clamped)
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    draggingRef.current = true
    pointerIdRef.current = event.pointerId
    lastYRef.current = event.clientY
    fineRef.current = event.shiftKey
    setInteracting(true)
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!draggingRef.current || pointerIdRef.current !== event.pointerId) return
    // The control can be disabled mid-drag (e.g. reverb bypass); pointer
    // capture keeps delivering events, so end the drag instead of committing.
    if (disabled) {
      endPointer(event)
      return
    }
    fineRef.current = event.shiftKey
    const dy = event.clientY - lastYRef.current
    lastYRef.current = event.clientY
    if (dy === 0) return
    const nextNorm = clamp(
      normRef.current + pointerDeltaToNormDelta(dy, sensitivityPx, fineRef.current),
      0,
      1,
    )
    commitNorm(nextNorm)
  }

  function endPointer(event: PointerEvent<HTMLElement>) {
    if (pointerIdRef.current !== event.pointerId) return
    draggingRef.current = false
    pointerIdRef.current = null
    setInteracting(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function onDoubleClick(event: MouseEvent<HTMLElement>) {
    if (disabled) return
    event.preventDefault()
    commitNorm(normalizeValue(defaultValue, min, max, taper, skew))
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (disabled) return
    const fine = event.shiftKey
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        setInteracting(true)
        // Step from the ref, not `liveValue` state: the ref updates
        // synchronously on commit, while state lags until the next render and
        // would make held/repeated key events recompute the same target.
        commitValue(stepBy(liveValueRef.current, 1, step, min, max, fine))
        break
      case 'ArrowDown':
      case 'ArrowLeft':
        setInteracting(true)
        commitValue(stepBy(liveValueRef.current, -1, step, min, max, fine))
        break
      case 'Home':
        commitValue(min)
        break
      case 'End':
        commitValue(max)
        break
      default:
        // Everything else (Space transport, synth letters, Mod+F) belongs to
        // the page-level listeners — leave it alone.
        return
    }
    event.preventDefault()
    // A focused slider owns its own stepping keys; Home must not also seek
    // the transport behind it.
    event.stopPropagation()
  }

  function onBlur() {
    if (!draggingRef.current) setInteracting(false)
  }

  return {
    liveValue,
    normalized: normalizeValue(liveValue, min, max, taper, skew),
    interacting,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
      onDoubleClick,
      onKeyDown,
      onBlur,
    },
  }
}
