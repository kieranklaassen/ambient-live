export const LOOP_LENGTH_SEC = 32
export const PLACEHOLDER_DURATION_SEC = 2

/**
 * A slice of a decoded sample placed on the timeline — an Ableton-style clip.
 *
 * `startSec` is where it sits on the timeline, `offsetSec` is where playback
 * enters the source, and `durationSec` is the audible length (not the source
 * length). `sourceDurationSec` stays null until the sample has been decoded,
 * which is what tells the edit helpers whether the source bounds are known.
 */
export interface SampleRegion {
  id: string
  sampleId: number
  name: string
  url: string
  startSec: number
  durationSec: number
  offsetSec: number
  sourceDurationSec: number | null
  fadeInSec: number
  fadeOutSec: number
}

export function clampTime(sec: number, loopLengthSec: number): number {
  if (loopLengthSec <= 0) return 0
  const wrapped = sec % loopLengthSec
  return wrapped < 0 ? wrapped + loopLengthSec : wrapped
}

export function xToTime(x: number, width: number, loopLengthSec: number): number {
  if (width <= 0) return 0
  const ratio = Math.min(Math.max(x / width, 0), 1)
  return ratio * loopLengthSec
}

export function timeToX(timeSec: number, width: number, loopLengthSec: number): number {
  if (loopLengthSec <= 0 || width <= 0) return 0
  return (clampTime(timeSec, loopLengthSec) / loopLengthSec) * width
}

export function createRegionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `region-${crypto.randomUUID()}`
  }
  return `region-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createSampleRegion(input: {
  sampleId: number
  name: string
  url: string
  startSec: number
  durationSec?: number
  sourceDurationSec?: number
  id?: string
}): SampleRegion {
  const sourceDurationSec = input.sourceDurationSec ?? null
  return {
    id: input.id ?? createRegionId(),
    sampleId: input.sampleId,
    name: input.name,
    url: input.url,
    startSec: Math.max(0, input.startSec),
    durationSec: input.durationSec ?? sourceDurationSec ?? PLACEHOLDER_DURATION_SEC,
    offsetSec: 0,
    sourceDurationSec,
    fadeInSec: 0,
    fadeOutSec: 0,
  }
}

export function advancePlayhead(
  playheadSec: number,
  deltaSec: number,
  loopLengthSec: number = LOOP_LENGTH_SEC,
): number {
  return clampTime(playheadSec + deltaSec, loopLengthSec)
}
