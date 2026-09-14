import { describe, expect, it } from 'vitest'

import {
  MIN_PROBE_CONFIDENCE,
  agreeingRoundTrip,
  buildProbe,
  describeContextLatency,
  findProbeOffset,
  formatMs,
  roundTripSeconds,
} from './latency'

/** Deterministic noise so the correlation tests never flake. */
function noise(length: number, amplitude: number, seed = 1): Float32Array {
  const out = new Float32Array(length)
  let state = seed >>> 0
  for (let i = 0; i < length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0
    out[i] = amplitude * ((state / 0xffffffff) * 2 - 1)
  }
  return out
}

describe('describeContextLatency', () => {
  it('reads the context figures and treats missing ones as zero', () => {
    expect(
      describeContextLatency({ sampleRate: 48000, baseLatency: 0.0027, outputLatency: 0.012 }),
    ).toEqual({ sampleRate: 48000, baseLatencySec: 0.0027, outputLatencySec: 0.012 })
    expect(describeContextLatency({ sampleRate: 44100 })).toEqual({
      sampleRate: 44100,
      baseLatencySec: 0,
      outputLatencySec: 0,
    })
    expect(describeContextLatency({ sampleRate: 44100, outputLatency: Number.NaN }).outputLatencySec).toBe(0)
  })

  it('formats seconds as milliseconds', () => {
    expect(formatMs(0.0234)).toBe('23.4 ms')
    expect(formatMs(0.0027, 2)).toBe('2.70 ms')
  })
})

describe('buildProbe', () => {
  it('is a windowed burst of the requested length, silent at both ends', () => {
    const probe = buildProbe(48000)
    expect(probe.length).toBe(1440)
    expect(probe[0]).toBe(0)
    expect(Math.abs(probe[probe.length - 1]!)).toBeLessThan(1e-6)
    expect(Math.max(...probe.map(Math.abs))).toBeLessThanOrEqual(0.5)
    expect(Math.max(...probe.map(Math.abs))).toBeGreaterThan(0.4)
  })

  it('has a sharp autocorrelation: the peak at zero lag dwarfs a small shift', () => {
    const probe = buildProbe(48000)
    const at = (lag: number) => {
      let acc = 0
      for (let i = 0; i + lag < probe.length; i += 1) acc += probe[i]! * probe[i + lag]!
      return acc
    }
    expect(at(0)).toBeGreaterThan(at(12) * 5)
  })
})

describe('findProbeOffset', () => {
  const sampleRate = 48000
  const probe = buildProbe(sampleRate)

  it('locates a delayed, attenuated probe under noise to the sample', () => {
    const captured = noise(sampleRate / 4, 0.02)
    const delay = 1234
    for (let i = 0; i < probe.length; i += 1) captured[delay + i]! += 0.2 * probe[i]!
    const peak = findProbeOffset(captured, probe)!
    expect(peak.lagFrames).toBe(delay)
    expect(peak.confidence).toBeGreaterThan(MIN_PROBE_CONFIDENCE)
  })

  it('reports low confidence when the capture holds only noise', () => {
    const peak = findProbeOffset(noise(sampleRate / 4, 0.1, 7), probe)!
    expect(peak.confidence).toBeLessThan(MIN_PROBE_CONFIDENCE)
  })

  it('returns null when the capture is shorter than the probe', () => {
    expect(findProbeOffset(new Float32Array(10), probe)).toBeNull()
    expect(findProbeOffset(new Float32Array(10), new Float32Array(0))).toBeNull()
  })
})

describe('agreeingRoundTrip', () => {
  it('is the median when every pass heard the probe within tolerance', () => {
    expect(agreeingRoundTrip([0.0225, 0.0231, 0.0219])).toBeCloseTo(0.0225, 9)
    expect(agreeingRoundTrip([0.02, 0.021])).toBeCloseTo(0.0205, 9)
    expect(agreeingRoundTrip([0.03])).toBe(0.03)
  })

  it('is null when a pass heard nothing, the passes spread too far, or there are none', () => {
    expect(agreeingRoundTrip([0.02, null, 0.02])).toBeNull()
    expect(agreeingRoundTrip([0.02, 0.36, 0.11])).toBeNull()
    expect(agreeingRoundTrip([0.02, 0.0221])).toBeNull()
    expect(agreeingRoundTrip([0.02, 0.0221], 0.005)).toBeCloseTo(0.02105, 9)
    expect(agreeingRoundTrip([])).toBeNull()
  })
})

describe('roundTripSeconds', () => {
  it('is the arrival time on the capture clock minus the scheduled probe start', () => {
    // Capture started at frame 96000 (2.000 s); probe scheduled at 2.150 s; found 8160 frames in.
    expect(
      roundTripSeconds({
        captureStartFrame: 96000,
        probeStartTimeSec: 2.15,
        lagFrames: 8160,
        sampleRate: 48000,
      }),
    ).toBeCloseTo(0.02, 9)
  })
})
