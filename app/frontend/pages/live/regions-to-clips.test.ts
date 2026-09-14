import { describe, expect, it } from 'vitest'

import { regionsToClips, sampleSourceId } from './regions-to-clips'
import { effectiveFades } from './timeline-clips'
import { createSampleRegion } from './timeline-model'

describe('regionsToClips', () => {
  it('maps a region one-to-one onto a linear clip with unity gain', () => {
    const region = {
      ...createSampleRegion({ sampleId: 7, name: 'a', url: '/a.wav', startSec: 3, sourceDurationSec: 10 }),
      id: 'r1',
      offsetSec: 1.5,
      durationSec: 4,
      fadeInSec: 0.25,
      fadeOutSec: 0.5,
    }
    expect(regionsToClips([region], new Map())).toEqual([
      {
        id: 'r1',
        sourceId: '7',
        startSec: 3,
        offsetSec: 1.5,
        durationSec: 4,
        fadeInSec: 0.25,
        fadeOutSec: 0.5,
        fadeCurve: 'linear',
        gainDb: 0,
      },
    ])
    expect(sampleSourceId(7)).toBe('7')
  })

  it('prefers the overlap-derived fades so the drawn crossfade is the played one', () => {
    const a = {
      ...createSampleRegion({ sampleId: 1, name: 'a', url: '/a.wav', startSec: 0, sourceDurationSec: 10 }),
      id: 'a',
      durationSec: 4,
    }
    const b = {
      ...createSampleRegion({ sampleId: 2, name: 'b', url: '/b.wav', startSec: 3, sourceDurationSec: 10 }),
      id: 'b',
      durationSec: 4,
    }
    const fades = effectiveFades([a, b])
    const clips = regionsToClips([a, b], fades)
    expect(clips[0].fadeOutSec).toBe(fades.get('a')?.fadeOutSec)
    expect(clips[1].fadeInSec).toBe(fades.get('b')?.fadeInSec)
    expect(clips[0].fadeOutSec).toBeGreaterThan(0)
  })
})
