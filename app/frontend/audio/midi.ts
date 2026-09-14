// Pure MIDI helpers for the synth path — no React, no AudioEngine. Parsing
// and control mapping are the library's (`parseMidiMessage`, `ControlSurface`).

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
