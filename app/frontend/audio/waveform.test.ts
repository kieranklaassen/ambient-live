import { describe, expect, it } from 'vitest'

import { computePeaks, slicePeaks } from './waveform'

function ramp(length: number): Float32Array {
  return Float32Array.from({ length }, (_, i) => i / (length - 1))
}

describe('computePeaks', () => {
  it('returns one min/max pair per bucket', () => {
    const peaks = computePeaks([ramp(1000)], 1000, 10)
    expect(peaks.min).toHaveLength(10)
    expect(peaks.max).toHaveLength(10)
  })

  it('brackets the samples in each bucket', () => {
    const peaks = computePeaks([ramp(1000)], 1000, 10)
    for (let bucket = 0; bucket < 10; bucket++) {
      expect(peaks.min[bucket]).toBeLessThanOrEqual(peaks.max[bucket])
    }
    expect(peaks.min[0]).toBeCloseTo(0, 3)
    expect(peaks.max[9]).toBeCloseTo(1, 3)
  })

  it('folds both channels into one pair per bucket', () => {
    const left = new Float32Array([0.1, 0.1, 0.1, 0.1])
    const right = new Float32Array([-0.9, 0.9, -0.9, 0.9])
    const peaks = computePeaks([left, right], 4, 2)
    expect(peaks.min[0]).toBeCloseTo(-0.9, 5)
    expect(peaks.max[0]).toBeCloseTo(0.9, 5)
  })

  it('handles a source shorter than the bucket count', () => {
    const peaks = computePeaks([new Float32Array([0.5, -0.5])], 2, 8)
    expect(peaks.min).toHaveLength(8)
    expect(peaks.max.every((value) => Number.isFinite(value))).toBe(true)
  })

  it('returns flat peaks for an empty source', () => {
    const peaks = computePeaks([], 0, 4)
    expect(Array.from(peaks.min)).toEqual([0, 0, 0, 0])
    expect(Array.from(peaks.max)).toEqual([0, 0, 0, 0])
  })
})

describe('slicePeaks', () => {
  const peaks = computePeaks([ramp(1000)], 1000, 100)

  it('returns the full list for an untrimmed clip', () => {
    expect(slicePeaks(peaks, 0, 10, 10).min).toHaveLength(100)
  })

  it('returns the second half for a clip offset halfway in', () => {
    const sliced = slicePeaks(peaks, 5, 5, 10)
    expect(sliced.min).toHaveLength(50)
    expect(sliced.max[0]).toBeCloseTo(peaks.max[50], 5)
  })

  it('returns an empty slice when the source length is unknown', () => {
    expect(slicePeaks(peaks, 0, 5, 0).min).toHaveLength(0)
  })
})
