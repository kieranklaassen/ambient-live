// The workstation's controllable parameters, described once as live-mix
// `ControlTarget`s with what the knobs need (label, group, range, default).
// The mapping layer — table, learn, resolution, persistence — is the library's
// `ControlSurface` (U36); this module maps U27's control ids onto targets so
// stored format-1 tables keep working, and builds the surface over the engine.
// Pure apart from the surface factory — no React, no Web Audio, no window.

import {
  ControlSurface,
  DEFAULT_LEVEL_MAX,
  ambientLiveMidiMapMigration,
  controlTargetKey,
  isBooleanTarget,
  resolveStripHost,
  type ControlSource,
  type ControlTarget,
  type MappingMode,
  type MappingRange,
  type MappingTable,
} from '@kieranklaassen/live-mix'
import { DATTORRO_PARAMS, type DattorroParamName } from '@kieranklaassen/live-mix/dsp'

import { DEFAULT_MASTER_GAIN, type LiveEngine } from './live-engine'

export type LiveControlId =
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

export type LiveControlGroup = 'Reverb' | 'Master' | 'Synth' | 'Clips' | 'Live input'

export interface LiveControlSpec {
  id: LiveControlId
  label: string
  group: LiveControlGroup
  /** Where the control lands in the engine; what a mapping binds to. */
  target: ControlTarget
  /** The knob's range and default, in the control's own units. */
  min: number
  max: number
  default: number
  /**
   * The control's value at the target's normalised 0 and 1. Reversed when the
   * knob runs against the target: monitor on is mute off.
   */
  scale: MappingRange
}

/** Fader range shared by every strip level control (unity = 1). */
export const STRIP_LEVEL_MAX = DEFAULT_LEVEL_MAX
/** The plate's instance id on the surface: `{ kind: 'device', device: 'reverb', param }`. */
export const REVERB_DEVICE_ID = 'reverb'
/** Where U27 stored its table; the surface keeps the key and migrates format 1. */
export const MIDI_MAP_STORAGE_KEY = 'ambient-live:midi-map'

/** Dattorro decay and damping stop short of 1 (an endless tail); the plate's own spec allows it. */
const PLATE_FEEDBACK_MAX = 0.99

const plate = (
  id: LiveControlId,
  label: string,
  param: DattorroParamName,
  max?: number,
): LiveControlSpec => {
  const spec = DATTORRO_PARAMS[param]
  return {
    id,
    label,
    group: 'Reverb',
    target: { kind: 'device', device: REVERB_DEVICE_ID, param },
    min: spec.min,
    max: max ?? spec.max,
    default: spec.default,
    scale: { min: spec.min, max: spec.max },
  }
}

const level = (id: LiveControlId, group: LiveControlGroup, track: string): LiveControlSpec => ({
  id,
  label: 'Level',
  group,
  target: { kind: 'strip', track, control: 'level' },
  min: 0,
  max: STRIP_LEVEL_MAX,
  default: 1,
  scale: { min: 0, max: STRIP_LEVEL_MAX },
})

const pan = (id: LiveControlId, group: LiveControlGroup, track: string): LiveControlSpec => ({
  id,
  label: 'Pan',
  group,
  target: { kind: 'strip', track, control: 'pan' },
  min: -1,
  max: 1,
  default: 0,
  scale: { min: -1, max: 1 },
})

export const LIVE_CONTROLS: readonly LiveControlSpec[] = [
  plate('reverb.mix', 'Mix', 'mix'),
  plate('reverb.decay', 'Decay', 'decay', PLATE_FEEDBACK_MAX),
  plate('reverb.damping', 'Damping', 'damping', PLATE_FEEDBACK_MAX),
  // "Predelay" (no hyphen) so the 9px caps label cannot break across lines.
  plate('reverb.predelayMs', 'Predelay', 'predelayMs'),
  {
    id: 'master.gain',
    label: 'Gain',
    group: 'Master',
    target: { kind: 'master', control: 'level' },
    min: 0,
    max: STRIP_LEVEL_MAX,
    default: DEFAULT_MASTER_GAIN,
    scale: { min: 0, max: STRIP_LEVEL_MAX },
  },
  level('synth.level', 'Synth', 'synth'),
  pan('synth.pan', 'Synth', 'synth'),
  level('clips.level', 'Clips', 'clips'),
  pan('clips.pan', 'Clips', 'clips'),
  level('input.level', 'Live input', 'input'),
  pan('input.pan', 'Live input', 'input'),
  {
    id: 'input.monitor',
    label: 'Monitor',
    group: 'Live input',
    target: { kind: 'strip', track: 'input', control: 'mute' },
    min: 0,
    max: 1,
    default: 1,
    scale: { min: 1, max: 0 },
  },
]

const BY_ID: ReadonlyMap<LiveControlId, LiveControlSpec> = new Map(
  LIVE_CONTROLS.map((spec) => [spec.id, spec]),
)
const BY_TARGET: ReadonlyMap<string, LiveControlSpec> = new Map(
  LIVE_CONTROLS.map((spec) => [controlTargetKey(spec.target), spec]),
)

export function liveControl(id: LiveControlId): LiveControlSpec {
  return BY_ID.get(id)!
}

/** The control behind a target, if the workstation has one. */
export function liveControlFor(target: ControlTarget): LiveControlSpec | undefined {
  return BY_TARGET.get(controlTargetKey(target))
}

/** U27's string ids → targets, for the stored-table migration; unknown ids drop out. */
export function liveControlTargetFor(id: string): ControlTarget | null {
  return BY_ID.get(id as LiveControlId)?.target ?? null
}

/** Loads `{ format: 1 }` tables written by U27 as the library's format 2. */
export const liveMidiMapMigration = ambientLiveMidiMapMigration(liveControlTargetFor)

export type LiveControlValues = Readonly<Record<LiveControlId, number>>

export function defaultLiveControls(): LiveControlValues {
  const values = {} as Record<LiveControlId, number>
  for (const spec of LIVE_CONTROLS) values[spec.id] = spec.default
  return values
}

export function clampLiveControl(spec: LiveControlSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.default
  return Math.min(spec.max, Math.max(spec.min, value))
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** The control's value → the target's normalised position (what `surface.set` takes). */
export function unitFromLiveControl(spec: LiveControlSpec, value: number): number {
  const clamped = clampLiveControl(spec, value)
  return clampUnit((clamped - spec.scale.min) / (spec.scale.max - spec.scale.min))
}

/** The target's normalised position → the control's value; on/off targets snap at 0.5 as the strip does. */
export function liveControlFromUnit(spec: LiveControlSpec, unit: number): number {
  let u = clampUnit(unit)
  if (isBooleanTarget(spec.target)) u = u >= 0.5 ? 1 : 0
  return clampLiveControl(spec, spec.scale.min + u * (spec.scale.max - spec.scale.min))
}

/** The span of the target a controller covers — the knob's range, as a mapping's `output`. */
export function liveControlOutput(spec: LiveControlSpec): MappingRange {
  return { min: unitFromLiveControl(spec, spec.min), max: unitFromLiveControl(spec, spec.max) }
}

/** U27's rule: a pad toggles an on/off control and sets anything else from velocity; a CC sets. */
export function liveControlMode(spec: LiveControlSpec, source: ControlSource): MappingMode {
  return source.kind === 'note' && isBooleanTarget(spec.target) ? 'toggle' : 'set'
}

/**
 * Give every mapping onto a workstation control the workstation's semantics:
 * the knob's range as its span (decay stops at 0.99, monitor on is mute off)
 * and the mode its source implies. The library keeps a mapping's options
 * across a re-learn; U27 inferred them from the new source every time, so a
 * pad re-learned onto a CC switch sets again. Returns the same table when
 * nothing changed.
 */
export function withLiveControlSemantics(table: MappingTable): MappingTable {
  let changed = false
  const next = table.map((mapping) => {
    const spec = liveControlFor(mapping.target)
    if (!spec) return mapping
    const output = liveControlOutput(spec)
    const mode = liveControlMode(spec, mapping.source)
    if (
      mapping.mode === mode &&
      mapping.output.min === output.min &&
      mapping.output.max === output.max
    ) {
      return mapping
    }
    changed = true
    return { ...mapping, mode, output }
  })
  return changed ? next : table
}

/**
 * The surface every controller writes through. It resolves targets against
 * whatever engine `live()` returns at dispatch time, so it can exist — and
 * hold a loaded table — before audio starts; nothing answers until then.
 */
export function createLiveControlSurface(live: () => LiveEngine | null): ControlSurface {
  const surface = new ControlSurface({
    resolve: {
      strip: (track) => {
        const engine = live()?.engine
        return engine ? resolveStripHost(engine, track)?.strip : undefined
      },
      master: () => live()?.engine.master,
      device: (id) => (id === REVERB_DEVICE_ID ? live()?.plate : undefined),
    },
    now: () => live()?.currentTime ?? 0,
    migrations: [liveMidiMapMigration],
  })
  surface.onChange((change) => {
    if (change.type !== 'table') return
    const normalized = withLiveControlSemantics(change.table)
    if (normalized !== change.table) surface.replace(normalized)
  })
  return surface
}
