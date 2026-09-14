import { describe, expect, it } from 'vitest'

import {
  AMBIENT_LIVE_MIDI_MAP_FORMAT,
  MidiDecoder,
  controlTargetKey,
  isMapped,
  parseMappingTable,
  resolveControlEvent,
  type ControlChange,
  type ControlEvent,
  type MappingTable,
} from '@kieranklaassen/live-mix'

import {
  LIVE_CONTROLS,
  STRIP_LEVEL_MAX,
  clampLiveControl,
  defaultLiveControls,
  liveControl,
  liveControlFor,
  liveControlFromUnit,
  liveControlOutput,
  liveControlTargetFor,
  liveMidiMapMigration,
  unitFromLiveControl,
  withLiveControlSpans,
} from './live-controls'

const decoder = new MidiDecoder({ pair14Bit: false })
const midi = (...bytes: number[]): ControlEvent => decoder.decode(Uint8Array.from(bytes))[0]
const cc = (controller: number, value: number, channel = 1): ControlEvent =>
  midi(0xb0 | (channel - 1), controller, value)
const noteOn = (note: number, velocity = 100, channel = 1): ControlEvent =>
  midi(0x90 | (channel - 1), note, velocity)
const noteOff = (note: number, channel = 1): ControlEvent => midi(0x80 | (channel - 1), note, 0)

/** U27's `ControlChange` shape — `{ target id, action, unit }` — from the library's. */
function u27(changes: ControlChange[]): unknown[] {
  return changes.map((change) => {
    const id = liveControlFor(change.target)?.id
    switch (change.kind) {
      case 'set':
        return { target: id, action: 'set', unit: change.unit }
      case 'toggle':
        return { target: id, action: 'toggle' }
      case 'nudge':
      case 'trigger':
        return { target: id, action: change.kind }
      default: {
        const _exhaustive: never = change
        return _exhaustive
      }
    }
  })
}

describe('live controls', () => {
  it('has unique ids and targets, sane ranges and in-range defaults', () => {
    const ids = LIVE_CONTROLS.map((spec) => spec.id)
    expect(new Set(ids).size).toBe(ids.length)
    const keys = LIVE_CONTROLS.map((spec) => controlTargetKey(spec.target))
    expect(new Set(keys).size).toBe(keys.length)
    for (const spec of LIVE_CONTROLS) {
      expect(spec.max, spec.id).toBeGreaterThan(spec.min)
      expect(spec.default, spec.id).toBeGreaterThanOrEqual(spec.min)
      expect(spec.default, spec.id).toBeLessThanOrEqual(spec.max)
      expect(liveControl(spec.id)).toBe(spec)
      expect(liveControlFor(spec.target)).toBe(spec)
      expect(liveControlTargetFor(spec.id)).toBe(spec.target)
    }
  })

  it('lands where U27 did: the plate, the master, the strips, the input gate', () => {
    expect(liveControlTargetFor('reverb.mix')).toEqual({
      kind: 'device',
      device: 'reverb',
      param: 'mix',
    })
    expect(liveControlTargetFor('master.gain')).toEqual({ kind: 'master', control: 'level' })
    expect(liveControlTargetFor('clips.pan')).toEqual({
      kind: 'strip',
      track: 'clips',
      control: 'pan',
    })
    expect(liveControlTargetFor('input.monitor')).toEqual({
      kind: 'strip',
      track: 'input',
      control: 'mute',
    })
    expect(liveControlTargetFor('reverb.size')).toBeNull()
    expect(liveControlFor({ kind: 'strip', track: 'input', control: 'solo' })).toBeUndefined()
  })

  it('defaults match the workstation start-up settings', () => {
    const values = defaultLiveControls()
    expect(values['reverb.mix']).toBe(0.35)
    expect(values['reverb.decay']).toBe(0.7)
    expect(values['reverb.predelayMs']).toBe(20)
    expect(values['master.gain']).toBe(0.8)
    expect(values['synth.level']).toBe(1)
    expect(values['input.monitor']).toBe(1)
    expect(liveControl('synth.level').max).toBe(STRIP_LEVEL_MAX)
    // Decay and damping stop short of an endless tail, as U27's knobs did.
    expect(liveControl('reverb.decay').max).toBe(0.99)
    expect(liveControl('reverb.damping').max).toBe(0.99)
  })

  it('clamps values into the range and falls back to the default for NaN', () => {
    const level = liveControl('input.level')
    expect(clampLiveControl(level, 9)).toBe(1.5)
    expect(clampLiveControl(level, -1)).toBe(0)
    expect(clampLiveControl(level, Number.NaN)).toBe(1)
  })

  it('converts between a control\u2019s value and its target\u2019s normalised position', () => {
    const pan = liveControl('synth.pan')
    expect(unitFromLiveControl(pan, -1)).toBe(0)
    expect(unitFromLiveControl(pan, 0)).toBe(0.5)
    expect(liveControlFromUnit(pan, 0.75)).toBe(0.5)
    const predelay = liveControl('reverb.predelayMs')
    expect(unitFromLiveControl(predelay, 50)).toBeCloseTo(0.2)
    expect(liveControlFromUnit(predelay, 0.2)).toBeCloseTo(50)
    expect(liveControlFromUnit(predelay, 2)).toBe(250)
    expect(liveControlFromUnit(predelay, Number.NaN)).toBe(0)
    const level = liveControl('clips.level')
    expect(unitFromLiveControl(level, 1.5)).toBe(1)
    expect(unitFromLiveControl(level, 3)).toBe(1)
    expect(liveControlFromUnit(level, 1)).toBe(1.5)
    // The decay knob covers 0..0.99 of a plate parameter that itself spans 0..1.
    const decay = liveControl('reverb.decay')
    expect(unitFromLiveControl(decay, 0.99)).toBe(0.99)
    expect(unitFromLiveControl(decay, 1)).toBe(0.99)
    expect(liveControlFromUnit(decay, 1)).toBe(0.99)
  })

  it('runs the monitor against the mute gate: on is unit 0, off is unit 1, snapping at the switch threshold', () => {
    const monitor = liveControl('input.monitor')
    expect(unitFromLiveControl(monitor, 1)).toBe(0)
    expect(unitFromLiveControl(monitor, 0)).toBe(1)
    expect(liveControlFromUnit(monitor, 0)).toBe(1)
    expect(liveControlFromUnit(monitor, 1)).toBe(0)
    expect(liveControlFromUnit(monitor, 0.49)).toBe(1)
    expect(liveControlFromUnit(monitor, 0.5)).toBe(0)
  })

  it('spans a mapping over the knob\u2019s range', () => {
    expect(liveControlOutput(liveControl('reverb.mix'))).toEqual({ min: 0, max: 1 })
    expect(liveControlOutput(liveControl('reverb.decay'))).toEqual({ min: 0, max: 0.99 })
    expect(liveControlOutput(liveControl('reverb.damping'))).toEqual({ min: 0, max: 0.99 })
    expect(liveControlOutput(liveControl('synth.pan'))).toEqual({ min: 0, max: 1 })
    expect(liveControlOutput(liveControl('master.gain'))).toEqual({ min: 0, max: 1 })
    expect(liveControlOutput(liveControl('input.monitor'))).toEqual({ min: 1, max: 0 })
  })
})

describe('a stored U27 table (format 1)', () => {
  // Exactly what U27's `serializeMidiMap` wrote under `ambient-live:midi-map`.
  const stored = JSON.stringify({
    format: AMBIENT_LIVE_MIDI_MAP_FORMAT,
    mappings: [
      { source: { kind: 'cc', channel: 1, controller: 74 }, target: 'reverb.mix' },
      { source: { kind: 'cc', channel: 1, controller: 74 }, target: 'reverb.decay' },
      { source: { kind: 'cc', channel: 1, controller: 20 }, target: 'input.monitor' },
      { source: { kind: 'note', channel: 10, note: 36 }, target: 'input.monitor' },
      { source: { kind: 'note', channel: 1, note: 37 }, target: 'synth.level' },
    ],
  })
  const table: MappingTable = withLiveControlSpans(
    parseMappingTable(stored, { migrations: [liveMidiMapMigration] }),
  )

  it('is refused without the migration and converted with it, entry by entry', () => {
    expect(parseMappingTable(stored)).toEqual([])
    expect(
      table.map((mapping) => [liveControlFor(mapping.target)?.id, mapping.source, mapping.mode]),
    ).toEqual([
      ['reverb.mix', { kind: 'cc', channel: 1, controller: 74 }, 'set'],
      ['reverb.decay', { kind: 'cc', channel: 1, controller: 74 }, 'set'],
      // Two U27 entries for one target collapse to the later one, as a rebind did.
      ['input.monitor', { kind: 'note', channel: 10, note: 36 }, 'toggle'],
      ['synth.level', { kind: 'note', channel: 1, note: 37 }, 'set'],
    ])
    expect(table[1].output).toEqual({ min: 0, max: 0.99 })
    expect(table[2].output).toEqual({ min: 1, max: 0 })
  })

  it('drops the malformed entries U27 dropped, plus ids the workstation never had', () => {
    const mixed = {
      format: AMBIENT_LIVE_MIDI_MAP_FORMAT,
      mappings: [
        { source: { kind: 'cc', channel: 1, controller: 74 }, target: 'reverb.mix' },
        { source: { kind: 'cc', channel: 17, controller: 74 }, target: 'reverb.decay' },
        { source: { kind: 'cc', channel: 1, controller: 200 }, target: 'reverb.decay' },
        { source: { kind: 'pitch', channel: 1 }, target: 'reverb.decay' },
        { source: { kind: 'cc', channel: 1, controller: 1 }, target: 'reverb.size' },
        'garbage',
        { source: { kind: 'cc', channel: 1, controller: 2 }, target: 'reverb.mix' },
      ],
    }
    const parsed = parseMappingTable(mixed, { migrations: [liveMidiMapMigration] })
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({
      source: { kind: 'cc', channel: 1, controller: 2 },
      target: liveControl('reverb.mix').target,
    })
    expect(parseMappingTable('not json', { migrations: [liveMidiMapMigration] })).toEqual([])
  })

  it('resolves the way U27 did: CCs set, a pad toggles the monitor, velocity sets a level', () => {
    expect(u27(resolveControlEvent(table, cc(74, 127)))).toEqual([
      { target: 'reverb.mix', action: 'set', unit: 1 },
      { target: 'reverb.decay', action: 'set', unit: 0.99 },
    ])
    expect(u27(resolveControlEvent(table, cc(74, 64)))[0]).toEqual({
      target: 'reverb.mix',
      action: 'set',
      unit: 64 / 127,
    })
    expect(resolveControlEvent(table, cc(74, 0, 2))).toEqual([])
    expect(u27(resolveControlEvent(table, noteOn(36, 100, 10)))).toEqual([
      { target: 'input.monitor', action: 'toggle' },
    ])
    expect(resolveControlEvent(table, noteOff(36, 10))).toEqual([])
    expect(u27(resolveControlEvent(table, noteOn(37, 127)))).toEqual([
      { target: 'synth.level', action: 'set', unit: 1 },
    ])
    expect(resolveControlEvent(table, noteOff(37))).toEqual([])
  })

  it('turns a MIDI switch into monitor on (mute off) through the reversed span', () => {
    const switched = withLiveControlSpans(
      parseMappingTable(
        {
          format: AMBIENT_LIVE_MIDI_MAP_FORMAT,
          mappings: [{ source: { kind: 'cc', channel: 1, controller: 20 }, target: 'input.monitor' }],
        },
        { migrations: [liveMidiMapMigration] },
      ),
    )
    const monitor = liveControl('input.monitor')
    const on = resolveControlEvent(switched, cc(20, 64))[0]
    const off = resolveControlEvent(switched, cc(20, 63))[0]
    expect(on.kind === 'set' && liveControlFromUnit(monitor, on.unit)).toBe(1)
    expect(off.kind === 'set' && liveControlFromUnit(monitor, off.unit)).toBe(0)
  })

  it('reports which events the map consumes, so a mapped pad never reaches the synth', () => {
    expect(isMapped(table, noteOn(36, 100, 10))).toBe(true)
    expect(isMapped(table, noteOff(37))).toBe(true)
    expect(isMapped(table, noteOn(36))).toBe(false)
    expect(isMapped(table, noteOn(60))).toBe(false)
    expect(isMapped(table, cc(1, 1))).toBe(false)
  })

  it('leaves a table alone once every workstation mapping carries its span', () => {
    expect(withLiveControlSpans(table)).toBe(table)
    const foreign: MappingTable = [
      {
        ...table[0],
        target: { kind: 'strip', track: 'returns', control: 'level' },
        output: { min: 0.2, max: 0.8 },
      },
    ]
    expect(withLiveControlSpans(foreign)).toBe(foreign)
  })
})
