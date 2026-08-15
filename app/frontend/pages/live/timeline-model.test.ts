import { describe, expect, it } from 'vitest'

import {
  LOOP_LENGTH_SEC,
  PLACEHOLDER_DURATION_SEC,
  advancePlayhead,
  createSampleRegion,
  timeToX,
  xToTime,
} from './timeline-model'

describe('xToTime / timeToX', () => {
  it('round-trips within tolerance on a fixed width', () => {
    const width = 800
    const loop = LOOP_LENGTH_SEC
    for (const x of [0, 200, 400, 799]) {
      const t = xToTime(x, width, loop)
      expect(timeToX(t, width, loop)).toBeCloseTo(x, 5)
    }
  })
})

describe('createSampleRegion', () => {
  it('waits at the placeholder length until the source is decoded', () => {
    const region = createSampleRegion({ sampleId: 1, name: 'pad', url: '/u', startSec: 4 })
    expect(region.durationSec).toBe(PLACEHOLDER_DURATION_SEC)
    expect(region.sourceDurationSec).toBeNull()
    expect(region.offsetSec).toBe(0)
  })

  it('takes the decoded length when it is already known', () => {
    const region = createSampleRegion({
      sampleId: 1,
      name: 'pad',
      url: '/u',
      startSec: 4,
      sourceDurationSec: 7.5,
    })
    expect(region.durationSec).toBe(7.5)
  })

  it('never starts before the timeline origin', () => {
    expect(createSampleRegion({ sampleId: 1, name: 'p', url: '/u', startSec: -3 }).startSec).toBe(0)
  })
})

describe('advancePlayhead', () => {
  it('wraps within the loop length', () => {
    expect(advancePlayhead(LOOP_LENGTH_SEC - 0.25, 0.5)).toBeCloseTo(0.25, 5)
  })
})
