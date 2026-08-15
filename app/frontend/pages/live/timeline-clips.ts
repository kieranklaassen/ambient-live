// Every number a clip edit changes lives here, so the drawing and the audio
// can never disagree: the timeline renders from these helpers and the clip
// scheduler plays from them.

import { LOOP_LENGTH_SEC, type SampleRegion } from './timeline-model'

/** A clip can never be trimmed shorter than this — below it there is nothing to grab. */
export const MIN_CLIP_SEC = 0.05

export interface ClipFades {
  fadeInSec: number
  fadeOutSec: number
}

export function clipEndSec(clip: SampleRegion): number {
  return clip.startSec + clip.durationSec
}

/** True once the sample has decoded and the source bounds are known. */
export function isClipTrimmable(clip: SampleRegion): boolean {
  return clip.sourceDurationSec != null
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function withClampedFades(clip: SampleRegion): SampleRegion {
  const fadeInSec = clamp(clip.fadeInSec, 0, clip.durationSec)
  const fadeOutSec = clamp(clip.fadeOutSec, 0, clip.durationSec)
  if (fadeInSec === clip.fadeInSec && fadeOutSec === clip.fadeOutSec) return clip
  return { ...clip, fadeInSec, fadeOutSec }
}

/** Slides the clip along the timeline, keeping it whole and inside the loop. */
export function moveClip(
  clip: SampleRegion,
  deltaSec: number,
  loopLengthSec: number = LOOP_LENGTH_SEC,
): SampleRegion {
  const startSec = clamp(clip.startSec + deltaSec, 0, Math.max(0, loopLengthSec - clip.durationSec))
  if (startSec === clip.startSec) return clip
  return { ...clip, startSec }
}

/**
 * Drags the left edge: the clip's start moves and playback enters the source
 * later, while the right edge stays where it is.
 */
export function trimClipStart(clip: SampleRegion, deltaSec: number): SampleRegion {
  if (!isClipTrimmable(clip)) return clip
  // Inward is limited by the minimum length, outward by the source start and
  // the timeline origin — whichever runs out first.
  const maxInward = clip.durationSec - MIN_CLIP_SEC
  const maxOutward = Math.min(clip.offsetSec, clip.startSec)
  const applied = clamp(deltaSec, -maxOutward, maxInward)
  if (applied === 0) return clip
  return withClampedFades({
    ...clip,
    startSec: clip.startSec + applied,
    offsetSec: clip.offsetSec + applied,
    durationSec: clip.durationSec - applied,
  })
}

/** Drags the right edge: only the audible length changes. */
export function trimClipEnd(
  clip: SampleRegion,
  deltaSec: number,
  loopLengthSec: number = LOOP_LENGTH_SEC,
): SampleRegion {
  if (clip.sourceDurationSec == null) return clip
  const sourceRemaining = clip.sourceDurationSec - clip.offsetSec
  const loopRemaining = loopLengthSec - clip.startSec
  const maxDuration = Math.max(MIN_CLIP_SEC, Math.min(sourceRemaining, loopRemaining))
  const durationSec = clamp(clip.durationSec + deltaSec, MIN_CLIP_SEC, maxDuration)
  if (durationSec === clip.durationSec) return clip
  return withClampedFades({ ...clip, durationSec })
}

export function setFadeIn(clip: SampleRegion, fadeSec: number): SampleRegion {
  const fadeInSec = clamp(fadeSec, 0, clip.durationSec - clip.fadeOutSec)
  if (fadeInSec === clip.fadeInSec) return clip
  return { ...clip, fadeInSec }
}

export function setFadeOut(clip: SampleRegion, fadeSec: number): SampleRegion {
  const fadeOutSec = clamp(fadeSec, 0, clip.durationSec - clip.fadeInSec)
  if (fadeOutSec === clip.fadeOutSec) return clip
  return { ...clip, fadeOutSec }
}

/**
 * Adopts the decoded length. A clip that has never seen its source takes the
 * whole thing; one the user already trimmed keeps its slice.
 */
export function applySourceDuration(
  clip: SampleRegion,
  sourceDurationSec: number,
  loopLengthSec: number = LOOP_LENGTH_SEC,
): SampleRegion {
  if (clip.sourceDurationSec != null) {
    return withClampedFades({ ...clip, sourceDurationSec })
  }
  // A source longer than the room left in the loop lands trimmed to fit.
  const room = Math.max(MIN_CLIP_SEC, loopLengthSec - clip.startSec)
  return withClampedFades({
    ...clip,
    sourceDurationSec,
    offsetSec: 0,
    durationSec: Math.max(MIN_CLIP_SEC, Math.min(sourceDurationSec, room)),
  })
}

/**
 * Fades after overlap crossfades are folded in. Where two clips overlap, both
 * gain a fade covering the overlap; a longer explicit fade wins. Nothing is
 * stored, so moving or trimming a clip recomputes its crossfades for free.
 */
export function effectiveFades(clips: readonly SampleRegion[]): Map<string, ClipFades> {
  const fades = new Map<string, ClipFades>()
  for (const clip of clips) {
    fades.set(clip.id, { fadeInSec: clip.fadeInSec, fadeOutSec: clip.fadeOutSec })
  }

  const ordered = [...clips].sort((a, b) => a.startSec - b.startSec)
  for (let i = 0; i < ordered.length - 1; i++) {
    const earlier = ordered[i]
    const later = ordered[i + 1]
    const overlap = Math.min(
      clipEndSec(earlier) - later.startSec,
      earlier.durationSec,
      later.durationSec,
    )
    if (overlap <= 0) continue

    const earlierFades = fades.get(earlier.id)
    const laterFades = fades.get(later.id)
    if (!earlierFades || !laterFades) continue
    earlierFades.fadeOutSec = Math.max(earlierFades.fadeOutSec, overlap)
    laterFades.fadeInSec = Math.max(laterFades.fadeInSec, overlap)
  }

  return fades
}
