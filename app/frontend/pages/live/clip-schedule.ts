// Turns the timeline into a list of clip starts that fall inside the next
// slice of time. Pure, so the scheduling contract is provable without audio.

import { LOOP_LENGTH_SEC, type SampleRegion } from './timeline-model'

export interface ScheduledClip {
  clipId: string
  /** Loop pass this start belongs to — the key that stops a clip firing twice. */
  iteration: number
  /** Seconds from the window's start until the clip begins. */
  startsInSec: number
}

export interface ClipWindow {
  clips: readonly Pick<SampleRegion, 'id' | 'startSec'>[]
  playheadSec: number
  lookaheadSec: number
  iteration: number
  loopEnabled: boolean
  loopLengthSec?: number
}

/**
 * Clip starts in `[playheadSec, playheadSec + lookaheadSec)`, plus the ones
 * reached by wrapping when the window runs past the loop end. Half-open, so
 * consecutive windows never return the same start twice.
 */
export function clipsInWindow({
  clips,
  playheadSec,
  lookaheadSec,
  iteration,
  loopEnabled,
  loopLengthSec = LOOP_LENGTH_SEC,
}: ClipWindow): ScheduledClip[] {
  if (lookaheadSec <= 0) return []
  const scheduled: ScheduledClip[] = []
  const windowEnd = playheadSec + lookaheadSec

  for (const clip of clips) {
    if (clip.startSec >= playheadSec && clip.startSec < windowEnd) {
      scheduled.push({
        clipId: clip.id,
        iteration,
        startsInSec: clip.startSec - playheadSec,
      })
    }
  }

  const wrappedEnd = windowEnd - loopLengthSec
  if (loopEnabled && wrappedEnd > 0) {
    for (const clip of clips) {
      if (clip.startSec < wrappedEnd) {
        scheduled.push({
          clipId: clip.id,
          iteration: iteration + 1,
          startsInSec: loopLengthSec - playheadSec + clip.startSec,
        })
      }
    }
  }

  return scheduled.sort((a, b) => a.startsInSec - b.startsInSec)
}
