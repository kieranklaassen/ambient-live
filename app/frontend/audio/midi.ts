// Pure MIDI helpers — no React, no AudioEngine. Safe for unit tests.

export type MidiNoteEvent =
  | { type: 'note-on'; note: number; velocity: number; gain: number }
  | { type: 'note-off'; note: number }

/** Every short message the workstation reacts to, with its 1-based channel. */
export type MidiEvent =
  | { type: 'note-on'; channel: number; note: number; velocity: number; gain: number }
  | { type: 'note-off'; channel: number; note: number }
  | { type: 'cc'; channel: number; controller: number; value: number }

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
 * Parse a short MIDI message into a note or control-change event, or null
 * when ignored. Note-on with velocity 0 is treated as note-off (MIDI
 * convention). Channel is the status byte's low nibble plus one (1–16).
 */
export function parseMidiEvent(data: Uint8Array): MidiEvent | null {
  if (data.length < 2) return null

  const status = data[0]!
  const command = status & 0xf0
  const channel = (status & 0x0f) + 1
  const first = data[1]! & 0x7f

  if (command === 0x80) {
    return { type: 'note-off', channel, note: first }
  }

  if (command === 0x90) {
    if (data.length < 3) return null
    const velocity = data[2]! & 0x7f
    if (velocity === 0) return { type: 'note-off', channel, note: first }
    return { type: 'note-on', channel, note: first, velocity, gain: velocityToGain(velocity) }
  }

  if (command === 0xb0) {
    if (data.length < 3) return null
    return { type: 'cc', channel, controller: first, value: data[2]! & 0x7f }
  }

  return null
}

/**
 * Parse a short MIDI message into a note event, or null when ignored
 * (control changes included). The channel-free shape the synth path uses.
 */
export function parseMidiMessage(data: Uint8Array): MidiNoteEvent | null {
  const event = parseMidiEvent(data)
  if (!event) return null
  switch (event.type) {
    case 'note-on':
      return { type: 'note-on', note: event.note, velocity: event.velocity, gain: event.gain }
    case 'note-off':
      return { type: 'note-off', note: event.note }
    case 'cc':
      return null
    default: {
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}
