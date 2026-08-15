import { describe, expect, it } from 'vitest'

import { fadeGain } from './fade'

describe('fadeGain', () => {
  it('rises linearly across the fade in', () => {
    expect(fadeGain(0, 6, 2, 0)).toBe(0)
    expect(fadeGain(1, 6, 2, 0)).toBeCloseTo(0.5, 5)
    expect(fadeGain(2, 6, 2, 0)).toBeCloseTo(1, 5)
  })

  it('falls linearly across the fade out', () => {
    expect(fadeGain(4, 6, 0, 2)).toBeCloseTo(1, 5)
    expect(fadeGain(5, 6, 0, 2)).toBeCloseTo(0.5, 5)
    expect(fadeGain(6, 6, 0, 2)).toBe(0)
  })

  it('stays open across a clip with no fades', () => {
    expect(fadeGain(0, 6, 0, 0)).toBe(1)
    expect(fadeGain(3, 6, 0, 0)).toBe(1)
    expect(fadeGain(6, 6, 0, 0)).toBe(1)
  })

  it('takes the lower of two overlapping fades', () => {
    expect(fadeGain(2, 4, 4, 4)).toBeCloseTo(0.5, 5)
  })

  it('is silent for a clip with no length', () => {
    expect(fadeGain(0, 0, 0, 0)).toBe(0)
  })
})
