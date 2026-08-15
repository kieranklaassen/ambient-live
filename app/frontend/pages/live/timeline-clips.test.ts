import { describe, expect, it } from 'vitest'

import {
  MIN_CLIP_SEC,
  applySourceDuration,
  effectiveFades,
  moveClip,
  setFadeIn,
  setFadeOut,
  trimClipEnd,
  trimClipStart,
} from './timeline-clips'
import { LOOP_LENGTH_SEC, createSampleRegion, type SampleRegion } from './timeline-model'

function clip(overrides: Partial<SampleRegion> = {}): SampleRegion {
  return {
    ...createSampleRegion({ sampleId: 1, name: 'pad', url: '/u', startSec: 4 }),
    durationSec: 6,
    sourceDurationSec: 6,
    ...overrides,
  }
}

describe('moveClip', () => {
  it('shifts startSec and leaves the source slice untouched', () => {
    const moved = moveClip(clip(), 2)
    expect(moved.startSec).toBeCloseTo(6, 5)
    expect(moved.offsetSec).toBe(0)
    expect(moved.durationSec).toBe(6)
  })

  it('clamps so the clip stays inside the loop', () => {
    const moved = moveClip(clip(), LOOP_LENGTH_SEC)
    expect(moved.startSec).toBeCloseTo(LOOP_LENGTH_SEC - 6, 5)
  })

  it('clamps at the timeline origin', () => {
    expect(moveClip(clip(), -10).startSec).toBe(0)
  })
})

describe('trimClipStart', () => {
  it('moves the start into the source and shortens the clip', () => {
    const trimmed = trimClipStart(clip(), 2)
    expect(trimmed.startSec).toBeCloseTo(6, 5)
    expect(trimmed.offsetSec).toBeCloseTo(2, 5)
    expect(trimmed.durationSec).toBeCloseTo(4, 5)
  })

  it('stops at the source start when dragged out past it', () => {
    const trimmed = trimClipStart(clip({ startSec: 4, offsetSec: 1, durationSec: 5 }), -3)
    expect(trimmed.offsetSec).toBe(0)
    expect(trimmed.durationSec).toBeCloseTo(6, 5)
    expect(trimmed.startSec).toBeCloseTo(3, 5)
  })

  it('stops at the minimum clip length when dragged inward', () => {
    const trimmed = trimClipStart(clip(), 100)
    expect(trimmed.durationSec).toBeCloseTo(MIN_CLIP_SEC, 5)
  })

  it('does nothing while the source duration is unknown', () => {
    const pending = clip({ sourceDurationSec: null })
    expect(trimClipStart(pending, 2)).toBe(pending)
  })
})

describe('trimClipEnd', () => {
  it('extends only as far as the source allows', () => {
    const trimmed = trimClipEnd(clip({ durationSec: 4, offsetSec: 1, sourceDurationSec: 6 }), 100)
    expect(trimmed.durationSec).toBeCloseTo(5, 5)
  })

  it('stops at the minimum clip length', () => {
    expect(trimClipEnd(clip(), -100).durationSec).toBeCloseTo(MIN_CLIP_SEC, 5)
  })

  it('does not run past the end of the loop', () => {
    const late = clip({ startSec: LOOP_LENGTH_SEC - 3, sourceDurationSec: 30, durationSec: 3 })
    expect(trimClipEnd(late, 10).durationSec).toBeCloseTo(3, 5)
  })

  it('keeps the fade pair inside a shortened clip', () => {
    const trimmed = trimClipEnd(clip({ fadeInSec: 3, fadeOutSec: 3 }), -2)
    expect(trimmed.durationSec).toBeCloseTo(4, 5)
    expect(trimmed.fadeInSec).toBeCloseTo(3, 5)
    expect(trimmed.fadeOutSec).toBeCloseTo(1, 5)
  })
})

describe('fades', () => {
  it('clamps a fade to the clip length', () => {
    expect(setFadeIn(clip(), 100).fadeInSec).toBeCloseTo(6, 5)
  })

  it('clamps the edited fade so the pair fits the clip', () => {
    const faded = setFadeOut(setFadeIn(clip({ durationSec: 4 }), 3), 3)
    expect(faded.fadeInSec).toBeCloseTo(3, 5)
    expect(faded.fadeOutSec).toBeCloseTo(1, 5)
  })

})

describe('effectiveFades', () => {
  const first = clip({ id: 'a', startSec: 4, durationSec: 6 })
  const second = clip({ id: 'b', startSec: 12, durationSec: 6 })

  it('leaves explicit fades alone when clips do not overlap', () => {
    const fades = effectiveFades([setFadeIn(first, 1), second])
    expect(fades.get('a')).toEqual({ fadeInSec: 1, fadeOutSec: 0 })
    expect(fades.get('b')).toEqual({ fadeInSec: 0, fadeOutSec: 0 })
  })

  it('crossfades across the overlap', () => {
    const overlapping = clip({ id: 'b', startSec: 9, durationSec: 6 })
    const fades = effectiveFades([first, overlapping])
    expect(fades.get('a')?.fadeOutSec).toBeCloseTo(1, 5)
    expect(fades.get('b')?.fadeInSec).toBeCloseTo(1, 5)
  })

  it('keeps a longer explicit fade over a shorter overlap', () => {
    const overlapping = clip({ id: 'b', startSec: 9, durationSec: 6 })
    const fades = effectiveFades([setFadeOut(first, 2), overlapping])
    expect(fades.get('a')?.fadeOutSec).toBeCloseTo(2, 5)
  })

  it('orders by start time regardless of array order', () => {
    const overlapping = clip({ id: 'b', startSec: 9, durationSec: 6 })
    const fades = effectiveFades([overlapping, first])
    expect(fades.get('a')?.fadeOutSec).toBeCloseTo(1, 5)
    expect(fades.get('b')?.fadeInSec).toBeCloseTo(1, 5)
  })
})

describe('applySourceDuration', () => {
  it('takes the whole source the first time it is known', () => {
    const pending = clip({ sourceDurationSec: null, durationSec: 2 })
    const resolved = applySourceDuration(pending, 7.5)
    expect(resolved.sourceDurationSec).toBe(7.5)
    expect(resolved.durationSec).toBeCloseTo(7.5, 5)
    expect(resolved.offsetSec).toBe(0)
  })

  it('trims a source longer than the room left in the loop', () => {
    const late = clip({ sourceDurationSec: null, durationSec: 2, startSec: LOOP_LENGTH_SEC - 5 })
    const resolved = applySourceDuration(late, 60)
    expect(resolved.durationSec).toBeCloseTo(5, 5)
    expect(resolved.startSec + resolved.durationSec).toBeCloseTo(LOOP_LENGTH_SEC, 5)
  })

  it('keeps an existing trim', () => {
    const trimmed = clip({ offsetSec: 1, durationSec: 3 })
    const resolved = applySourceDuration(trimmed, 6)
    expect(resolved.durationSec).toBe(3)
    expect(resolved.offsetSec).toBe(1)
  })
})
