// Pure MIDI helpers — no React, no AudioEngine. Safe for unit tests.

export type MidiNoteEvent =
  | { type: 'note-on'; note: number; velocity: number; gain: number }
  | { type: 'note-off'; note: number }

/** MIDI note number → Hz (A4 = 440 at note 69). */
export function midiToFrequency(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

/**
 * Map MIDI velocity (1–127) into the same gain ballpark as the on-screen
 * keyboard's fixed 0.4 — mid velocities land near that value.
 */
export function velocityToGain(velocity: number): number {
  return Math.max(0.05, (velocity / 127) * 0.8)
}

/**
 * Parse a short MIDI message into a note event, or null when ignored.
 * Note-on with velocity 0 is treated as note-off (MIDI convention).
 */
export function parseMidiMessage(data: Uint8Array): MidiNoteEvent | null {
  if (data.length < 2) return null

  const status = data[0]!
  const command = status & 0xf0
  const note = data[1]! & 0x7f

  if (command === 0x80) {
    return { type: 'note-off', note }
  }

  if (command === 0x90) {
    if (data.length < 3) return null
    const velocity = data[2]! & 0x7f
    if (velocity === 0) return { type: 'note-off', note }
    return { type: 'note-on', note, velocity, gain: velocityToGain(velocity) }
  }

  return null
}
