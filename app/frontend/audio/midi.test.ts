import { describe, expect, it } from 'vitest'

import { midiToFrequency, velocityToGain } from './midi'

describe('midiToFrequency', () => {
  it('maps MIDI note 69 to A440', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 5)
  })
})

describe('velocityToGain', () => {
  it('maps mid velocity near the on-screen keyboard gain', () => {
    expect(velocityToGain(64)).toBeCloseTo(0.4, 1)
  })

  it('never drops below the audible floor', () => {
    expect(velocityToGain(1)).toBe(0.05)
    expect(velocityToGain(127)).toBeCloseTo(0.8)
  })
})
