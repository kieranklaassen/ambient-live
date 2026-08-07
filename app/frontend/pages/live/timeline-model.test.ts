import { describe, expect, it } from 'vitest'

import {
  LOOP_LENGTH_SEC,
  advancePlayhead,
  createSampleRegion,
  risingEdgeRegionIds,
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

describe('risingEdgeRegionIds', () => {
  const region = createSampleRegion({
    id: 'r1',
    sampleId: 1,
    name: 'pad',
    url: '/u',
    startSec: 4,
    durationSec: 2,
  })

  it('fires once when the playhead crosses startSec', () => {
    expect(risingEdgeRegionIds(3.9, 4.05, [region])).toEqual(['r1'])
    expect(risingEdgeRegionIds(4.05, 4.2, [region])).toEqual([])
  })

  it('does not fire when playback starts already inside a region', () => {
    expect(risingEdgeRegionIds(4.5, 4.6, [region])).toEqual([])
  })

  it('fires again after a later loop crosses startSec', () => {
    const nearEnd = LOOP_LENGTH_SEC - 0.05
    const afterWrap = 0.05
    const atZero = createSampleRegion({
      id: 'r0',
      sampleId: 2,
      name: 'hit',
      url: '/u',
      startSec: 0,
      durationSec: 1,
    })
    expect(risingEdgeRegionIds(nearEnd, afterWrap, [atZero])).toEqual(['r0'])
  })
})

describe('advancePlayhead', () => {
  it('wraps within the loop length', () => {
    expect(advancePlayhead(LOOP_LENGTH_SEC - 0.25, 0.5)).toBeCloseTo(0.25, 5)
  })
})
