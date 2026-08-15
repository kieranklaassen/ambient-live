import { describe, expect, it } from 'vitest'

import { applyClipDrag, resolveClipDragTarget, secondsPerPixel } from './use-clip-drag'
import { LOOP_LENGTH_SEC, createSampleRegion, type SampleRegion } from './timeline-model'

function hit(overrides: Partial<Parameters<typeof resolveClipDragTarget>[0]> = {}) {
  return {
    offsetXPx: 100,
    offsetYPx: 30,
    widthPx: 200,
    fadeInPx: 0,
    fadeOutPx: 0,
    trimmable: true,
    ...overrides,
  }
}

describe('resolveClipDragTarget', () => {
  it('resolves the edges to trims', () => {
    expect(resolveClipDragTarget(hit({ offsetXPx: 3 }))).toBe('trim-start')
    expect(resolveClipDragTarget(hit({ offsetXPx: 197 }))).toBe('trim-end')
  })

  it('resolves the interior to a move', () => {
    expect(resolveClipDragTarget(hit())).toBe('move')
  })

  it('lets a top-corner fade handle win over the trim strip', () => {
    expect(resolveClipDragTarget(hit({ offsetXPx: 3, offsetYPx: 4 }))).toBe('fade-in')
    expect(resolveClipDragTarget(hit({ offsetXPx: 197, offsetYPx: 4 }))).toBe('fade-out')
  })

  it('follows a fade handle that has been dragged inward', () => {
    expect(resolveClipDragTarget(hit({ offsetXPx: 60, offsetYPx: 4, fadeInPx: 60 }))).toBe('fade-in')
    expect(resolveClipDragTarget(hit({ offsetXPx: 60, offsetYPx: 30, fadeInPx: 60 }))).toBe('move')
  })

  it('keeps an interior grab on a clip narrower than the hit zones', () => {
    expect(resolveClipDragTarget(hit({ offsetXPx: 7.5, widthPx: 15 }))).toBe('move')
  })

  it('only moves a clip whose source length is still unknown', () => {
    expect(resolveClipDragTarget(hit({ offsetXPx: 3, trimmable: false }))).toBe('move')
    expect(resolveClipDragTarget(hit({ offsetXPx: 3, offsetYPx: 4, trimmable: false }))).toBe('move')
  })
})

describe('secondsPerPixel', () => {
  it('maps the surface width onto the loop length', () => {
    expect(secondsPerPixel(800, 32)).toBeCloseTo(0.04, 5)
    expect(secondsPerPixel(0, 32)).toBe(0)
  })
})

describe('applyClipDrag', () => {
  const clip: SampleRegion = {
    ...createSampleRegion({ sampleId: 1, name: 'pad', url: '/u', startSec: 4 }),
    durationSec: 6,
    sourceDurationSec: 6,
  }

  it('routes each target to its edit', () => {
    expect(applyClipDrag(clip, 'move', 2, LOOP_LENGTH_SEC).startSec).toBeCloseTo(6, 5)
    expect(applyClipDrag(clip, 'trim-start', 2, LOOP_LENGTH_SEC).offsetSec).toBeCloseTo(2, 5)
    expect(applyClipDrag(clip, 'trim-end', -2, LOOP_LENGTH_SEC).durationSec).toBeCloseTo(4, 5)
    expect(applyClipDrag(clip, 'fade-in', 1.5, LOOP_LENGTH_SEC).fadeInSec).toBeCloseTo(1.5, 5)
    expect(applyClipDrag(clip, 'fade-out', -1.5, LOOP_LENGTH_SEC).fadeOutSec).toBeCloseTo(1.5, 5)
  })

  it('re-applies from the origin so a clamped edge does not drift', () => {
    const pinned = applyClipDrag(clip, 'move', -100, LOOP_LENGTH_SEC)
    expect(pinned.startSec).toBe(0)
    expect(applyClipDrag(clip, 'move', 1, LOOP_LENGTH_SEC).startSec).toBeCloseTo(5, 5)
  })
})
