import { describe, expect, it } from 'vitest'

import {
  clamp,
  denormalizeValue,
  formatControlValue,
  knobAngleToNorm,
  normalizeValue,
  normToKnobAngle,
  pointerDeltaToNormDelta,
  quantize,
  stepBy,
} from './control-math'

describe('clamp / quantize / stepBy', () => {
  it('clamps into range', () => {
    expect(clamp(-1, 0, 1)).toBe(0)
    expect(clamp(2, 0, 1)).toBe(1)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })

  it('quantizes to step grid', () => {
    expect(quantize(0.334, 0.01, 0, 1)).toBe(0.33)
    expect(quantize(21.4, 1, 0, 250)).toBe(21)
  })

  it('steps with fine mode', () => {
    expect(stepBy(0.5, 1, 0.01, 0, 1)).toBe(0.51)
    expect(stepBy(0.5, 1, 0.01, 0, 1, true)).toBe(0.501)
  })
})

describe('normalize / denormalize', () => {
  it('round-trips linear', () => {
    const n = normalizeValue(0.35, 0, 1, 'linear')
    expect(n).toBeCloseTo(0.35)
    expect(denormalizeValue(n, 0, 1, 'linear')).toBeCloseTo(0.35)
  })

  it('maps log taper for positive ranges', () => {
    const mid = denormalizeValue(0.5, 20, 20000, 'log')
    expect(mid).toBeGreaterThan(20)
    expect(mid).toBeLessThan(20000)
    expect(normalizeValue(mid, 20, 20000, 'log')).toBeCloseTo(0.5, 5)
  })

  it('applies skewed taper (more resolution near min when skew > 1)', () => {
    const linearHalf = denormalizeValue(0.5, 0, 1, 'linear')
    const skewedHalf = denormalizeValue(0.5, 0, 1, 'skewed', 2)
    expect(skewedHalf).toBeLessThan(linearHalf)
  })
})

describe('knob angle mapping', () => {
  it('maps 0 and 1 to sweep endpoints', () => {
    expect(normToKnobAngle(0)).toBe(-225)
    expect(normToKnobAngle(1)).toBe(45)
  })

  it('round-trips angle → norm for in-range angles', () => {
    expect(knobAngleToNorm(normToKnobAngle(0.25))).toBeCloseTo(0.25, 5)
    expect(knobAngleToNorm(normToKnobAngle(0.8))).toBeCloseTo(0.8, 5)
  })
})

describe('pointer delta', () => {
  it('drag up increases value; fine reduces sensitivity', () => {
    expect(pointerDeltaToNormDelta(-60, 120)).toBeCloseTo(0.5)
    expect(pointerDeltaToNormDelta(-60, 120, true)).toBeCloseTo(0.125)
  })
})

describe('drag accumulation', () => {
  /** Mirrors useParamControl.commitNorm: the pointer norm carries across frames. */
  function dragValues(deltas: number[], sensitivityPx: number, fine: boolean): number[] {
    let norm = normalizeValue(0.5, 0, 1)
    return deltas.map((dy) => {
      norm = clamp(norm + pointerDeltaToNormDelta(dy, sensitivityPx, fine), 0, 1)
      return quantize(denormalizeValue(norm, 0, 1), 0.01, 0, 1)
    })
  }

  it('accumulates sub-step fine drag across frames', () => {
    const values = dragValues(Array<number>(10).fill(-1), 110, true)
    expect(values[0]).toBe(0.5)
    expect(values.at(-1)).toBeGreaterThan(0.5)
  })

  it('lands in the same place for one jump or many small moves', () => {
    expect(dragValues(Array<number>(12).fill(-1), 110, true).at(-1)).toBe(
      dragValues([-12], 110, true).at(-1),
    )
  })
})

describe('formatControlValue', () => {
  it('formats common units', () => {
    expect(formatControlValue(0.35, 'ratio')).toBe('0.35')
    expect(formatControlValue(20, 'ms')).toBe('20ms')
    expect(formatControlValue(-6, 'dB')).toBe('-6.0dB')
    expect(formatControlValue(440, 'Hz')).toBe('440Hz')
    expect(formatControlValue(2400, 'Hz')).toBe('2.40kHz')
    expect(formatControlValue(80, '%')).toBe('80%')
  })
})
