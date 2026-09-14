// The controls a MIDI controller (or anything else) can drive, described once
// so the mapping table, the engine and the UI agree on ids, ranges and
// defaults. Pure data — no React, no Web Audio.

export type ControlTargetId =
  | 'reverb.mix'
  | 'reverb.decay'
  | 'reverb.damping'
  | 'reverb.predelayMs'
  | 'master.gain'
  | 'synth.level'
  | 'synth.pan'
  | 'clips.level'
  | 'clips.pan'
  | 'input.level'
  | 'input.pan'
  | 'input.monitor'

export type ControlTargetGroup = 'Reverb' | 'Master' | 'Synth' | 'Clips' | 'Live input'

export interface ControlTargetSpec {
  id: ControlTargetId
  label: string
  group: ControlTargetGroup
  min: number
  max: number
  default: number
  /** Toggles are 0 or 1; a MIDI switch (value ≥ 64) or a note-on flips them. */
  kind: 'continuous' | 'toggle'
}

/** Fader range shared by every strip level control (unity = 1). */
export const STRIP_LEVEL_MAX = 1.5

const continuous = (
  id: ControlTargetId,
  label: string,
  group: ControlTargetGroup,
  min: number,
  max: number,
  defaultValue: number,
): ControlTargetSpec => ({ id, label, group, min, max, default: defaultValue, kind: 'continuous' })

export const CONTROL_TARGETS: readonly ControlTargetSpec[] = [
  continuous('reverb.mix', 'Mix', 'Reverb', 0, 1, 0.35),
  continuous('reverb.decay', 'Decay', 'Reverb', 0, 0.99, 0.7),
  continuous('reverb.damping', 'Damping', 'Reverb', 0, 0.99, 0.3),
  continuous('reverb.predelayMs', 'Predelay', 'Reverb', 0, 250, 20),
  continuous('master.gain', 'Gain', 'Master', 0, STRIP_LEVEL_MAX, 0.8),
  continuous('synth.level', 'Level', 'Synth', 0, STRIP_LEVEL_MAX, 1),
  continuous('synth.pan', 'Pan', 'Synth', -1, 1, 0),
  continuous('clips.level', 'Level', 'Clips', 0, STRIP_LEVEL_MAX, 1),
  continuous('clips.pan', 'Pan', 'Clips', -1, 1, 0),
  continuous('input.level', 'Level', 'Live input', 0, STRIP_LEVEL_MAX, 1),
  continuous('input.pan', 'Pan', 'Live input', -1, 1, 0),
  { id: 'input.monitor', label: 'Monitor', group: 'Live input', min: 0, max: 1, default: 1, kind: 'toggle' },
]

const BY_ID: ReadonlyMap<ControlTargetId, ControlTargetSpec> = new Map(
  CONTROL_TARGETS.map((spec) => [spec.id, spec]),
)

export function controlTarget(id: ControlTargetId): ControlTargetSpec {
  return BY_ID.get(id)!
}

export function isControlTargetId(value: unknown): value is ControlTargetId {
  return typeof value === 'string' && BY_ID.has(value as ControlTargetId)
}

export type ControlValues = Readonly<Record<ControlTargetId, number>>

export function defaultControlValues(): ControlValues {
  const values = {} as Record<ControlTargetId, number>
  for (const spec of CONTROL_TARGETS) values[spec.id] = spec.default
  return values
}

export function clampControlValue(spec: ControlTargetSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.default
  return Math.min(spec.max, Math.max(spec.min, value))
}

/** A 0..1 controller position → the target's value (toggles snap at 0.5). */
export function controlValueFromUnit(spec: ControlTargetSpec, unit: number): number {
  const u = Number.isFinite(unit) ? Math.min(1, Math.max(0, unit)) : 0
  if (spec.kind === 'toggle') return u >= 0.5 ? 1 : 0
  return spec.min + u * (spec.max - spec.min)
}

/** The target's value → a 0..1 controller position. */
export function unitFromControlValue(spec: ControlTargetSpec, value: number): number {
  const clamped = clampControlValue(spec, value)
  return (clamped - spec.min) / (spec.max - spec.min)
}
