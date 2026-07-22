import { describe, expect, it } from 'vitest'

import { midiToFrequency, parseMidiMessage, velocityToGain } from './midi'

describe('midiToFrequency', () => {
  it('maps MIDI note 69 to A440', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 5)
  })
})

describe('velocityToGain', () => {
  it('maps mid velocity near the on-screen keyboard gain', () => {
    expect(velocityToGain(64)).toBeCloseTo(0.4, 1)
  })
})

describe('parseMidiMessage', () => {
  it('parses note-on with velocity into gain', () => {
    const event = parseMidiMessage(Uint8Array.of(0x90, 60, 100))
    expect(event).toEqual({
      type: 'note-on',
      note: 60,
      velocity: 100,
      gain: velocityToGain(100),
    })
  })

  it('treats note-on velocity 0 as note-off', () => {
    expect(parseMidiMessage(Uint8Array.of(0x90, 60, 0))).toEqual({
      type: 'note-off',
      note: 60,
    })
  })

  it('parses note-off status', () => {
    expect(parseMidiMessage(Uint8Array.of(0x80, 48, 64))).toEqual({
      type: 'note-off',
      note: 48,
    })
  })

  it('accepts channel nibble variants for note-on', () => {
    const event = parseMidiMessage(Uint8Array.of(0x91, 60, 80))
    expect(event?.type).toBe('note-on')
    if (event?.type === 'note-on') expect(event.note).toBe(60)
  })

  it('ignores empty, short, and CC messages', () => {
    expect(parseMidiMessage(new Uint8Array())).toBeNull()
    expect(parseMidiMessage(Uint8Array.of(0x90))).toBeNull()
    expect(parseMidiMessage(Uint8Array.of(0xb0, 64, 127))).toBeNull()
  })
})
