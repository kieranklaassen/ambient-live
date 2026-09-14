import { describe, expect, it } from 'vitest'

import { parseMidiEvent, type MidiEvent } from './midi'
import {
  IDLE_LEARN,
  MIDI_MAP_FORMAT,
  MIDI_MAP_STORAGE_KEY,
  describeSource,
  eventMatches,
  isMapped,
  learnFromEvent,
  loadMidiMap,
  mapControl,
  mappingFor,
  parseMidiMap,
  resolveMidiEvent,
  saveMidiMap,
  serializeMidiMap,
  sourceFromEvent,
  sourceKey,
  unmapControl,
  type MidiMapTable,
  type StorageLike,
} from './midi-map'

const cc = (controller: number, value: number, channel = 1): MidiEvent => ({
  type: 'cc',
  channel,
  controller,
  value,
})
const noteOn = (note: number, velocity = 100, channel = 1): MidiEvent => ({
  type: 'note-on',
  channel,
  note,
  velocity,
  gain: 0.5,
})
const noteOff = (note: number, channel = 1): MidiEvent => ({ type: 'note-off', channel, note })

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
}

describe('sources', () => {
  it('derives a source from CCs and note presses, never from releases', () => {
    expect(sourceFromEvent(cc(74, 10, 2))).toEqual({ kind: 'cc', channel: 2, controller: 74 })
    expect(sourceFromEvent(noteOn(36))).toEqual({ kind: 'note', channel: 1, note: 36 })
    expect(sourceFromEvent(noteOff(36))).toBeNull()
  })

  it('keys and describes sources by kind, channel and number', () => {
    expect(sourceKey({ kind: 'cc', channel: 1, controller: 74 })).toBe('cc:1:74')
    expect(describeSource({ kind: 'cc', channel: 1, controller: 74 })).toBe('CC 74 · ch 1')
    expect(describeSource({ kind: 'note', channel: 10, note: 36 })).toBe('Note 36 · ch 10')
  })

  it('matches events to sources on channel and number, notes on both edges', () => {
    const source = { kind: 'note', channel: 1, note: 36 } as const
    expect(eventMatches(source, noteOn(36))).toBe(true)
    expect(eventMatches(source, noteOff(36))).toBe(true)
    expect(eventMatches(source, noteOn(36, 100, 2))).toBe(false)
    expect(eventMatches(source, cc(36, 1))).toBe(false)
    expect(eventMatches({ kind: 'cc', channel: 1, controller: 1 }, cc(1, 5, 1))).toBe(true)
    expect(eventMatches({ kind: 'cc', channel: 1, controller: 1 }, cc(1, 5, 3))).toBe(false)
  })
})

describe('table edits', () => {
  it('binds one source per target and replaces on rebind', () => {
    let table: MidiMapTable = []
    table = mapControl(table, 'reverb.mix', { kind: 'cc', channel: 1, controller: 74 })
    table = mapControl(table, 'reverb.mix', { kind: 'cc', channel: 1, controller: 71 })
    expect(table).toHaveLength(1)
    expect(mappingFor(table, 'reverb.mix')?.source).toEqual({ kind: 'cc', channel: 1, controller: 71 })
  })

  it('lets one source drive several targets and unbinds per target', () => {
    const source = { kind: 'cc', channel: 1, controller: 1 } as const
    let table: MidiMapTable = mapControl([], 'synth.level', source)
    table = mapControl(table, 'clips.level', source)
    expect(table).toHaveLength(2)
    table = unmapControl(table, 'synth.level')
    expect(table.map((mapping) => mapping.target)).toEqual(['clips.level'])
  })
})

describe('resolveMidiEvent', () => {
  const table: MidiMapTable = [
    { source: { kind: 'cc', channel: 1, controller: 74 }, target: 'reverb.mix' },
    { source: { kind: 'cc', channel: 1, controller: 74 }, target: 'reverb.decay' },
    { source: { kind: 'cc', channel: 1, controller: 20 }, target: 'input.monitor' },
    { source: { kind: 'note', channel: 1, note: 36 }, target: 'input.monitor' },
    { source: { kind: 'note', channel: 1, note: 37 }, target: 'synth.level' },
  ]

  it('turns a CC into a 0..1 set on every target bound to it', () => {
    expect(resolveMidiEvent(table, cc(74, 127))).toEqual([
      { target: 'reverb.mix', action: 'set', unit: 1 },
      { target: 'reverb.decay', action: 'set', unit: 1 },
    ])
    expect(resolveMidiEvent(table, cc(74, 0, 2))).toEqual([])
  })

  it('sets toggles from a CC switch and flips them from a note press', () => {
    expect(resolveMidiEvent(table, cc(20, 127))).toEqual([
      { target: 'input.monitor', action: 'set', unit: 1 },
    ])
    expect(resolveMidiEvent(table, noteOn(36))).toEqual([{ target: 'input.monitor', action: 'toggle' }])
    expect(resolveMidiEvent(table, noteOff(36))).toEqual([])
  })

  it('sets a continuous target from note velocity and ignores the release', () => {
    expect(resolveMidiEvent(table, noteOn(37, 127))).toEqual([
      { target: 'synth.level', action: 'set', unit: 1 },
    ])
    expect(resolveMidiEvent(table, noteOff(37))).toEqual([])
  })

  it('reports which events the map consumes', () => {
    expect(isMapped(table, noteOn(36))).toBe(true)
    expect(isMapped(table, noteOff(37))).toBe(true)
    expect(isMapped(table, noteOn(60))).toBe(false)
    expect(isMapped(table, cc(1, 1))).toBe(false)
  })

  it('works end to end from raw bytes', () => {
    const event = parseMidiEvent(Uint8Array.of(0xb0, 74, 64))!
    expect(resolveMidiEvent(table, event)[0]).toEqual({
      target: 'reverb.mix',
      action: 'set',
      unit: 64 / 127,
    })
  })
})

describe('learn', () => {
  it('is a no-op while idle', () => {
    const outcome = learnFromEvent(IDLE_LEARN, [], cc(74, 1))
    expect(outcome).toEqual({ learn: IDLE_LEARN, table: [], consumed: false })
  })

  it('binds the armed target to the next CC and returns to idle, consuming the event', () => {
    const outcome = learnFromEvent({ target: 'reverb.mix' }, [], cc(74, 1, 3))
    expect(outcome.consumed).toBe(true)
    expect(outcome.learn).toEqual(IDLE_LEARN)
    expect(outcome.table).toEqual([
      { source: { kind: 'cc', channel: 3, controller: 74 }, target: 'reverb.mix' },
    ])
  })

  it('binds to a note press but keeps waiting through a release', () => {
    const waiting = learnFromEvent({ target: 'input.monitor' }, [], noteOff(36))
    expect(waiting.consumed).toBe(false)
    expect(waiting.learn).toEqual({ target: 'input.monitor' })
    const bound = learnFromEvent(waiting.learn, waiting.table, noteOn(36))
    expect(bound.table[0]).toEqual({
      source: { kind: 'note', channel: 1, note: 36 },
      target: 'input.monitor',
    })
  })
})

describe('persistence', () => {
  const table: MidiMapTable = [
    { source: { kind: 'cc', channel: 1, controller: 74 }, target: 'reverb.mix' },
    { source: { kind: 'note', channel: 10, note: 36 }, target: 'input.monitor' },
  ]

  it('round-trips through JSON', () => {
    const json = serializeMidiMap(table)
    expect(JSON.parse(json).format).toBe(MIDI_MAP_FORMAT)
    expect(parseMidiMap(json)).toEqual(table)
    expect(parseMidiMap(JSON.parse(json))).toEqual(table)
  })

  it('drops malformed entries, unknown targets and foreign formats without throwing', () => {
    expect(parseMidiMap('not json')).toEqual([])
    expect(parseMidiMap(null)).toEqual([])
    expect(parseMidiMap({ format: 99, mappings: [] })).toEqual([])
    const mixed = {
      format: MIDI_MAP_FORMAT,
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
    // The later entry for reverb.mix wins, as a rebind would.
    expect(parseMidiMap(mixed)).toEqual([
      { source: { kind: 'cc', channel: 1, controller: 2 }, target: 'reverb.mix' },
    ])
  })

  it('loads and saves through a Storage-like object, clearing the key when empty', () => {
    const storage = memoryStorage()
    saveMidiMap(storage, table)
    expect(storage.data.has(MIDI_MAP_STORAGE_KEY)).toBe(true)
    expect(loadMidiMap(storage)).toEqual(table)
    saveMidiMap(storage, [])
    expect(storage.data.has(MIDI_MAP_STORAGE_KEY)).toBe(false)
    expect(loadMidiMap(null)).toEqual([])
    expect(loadMidiMap(memoryStorage({ [MIDI_MAP_STORAGE_KEY]: '{oops' }))).toEqual([])
  })

  it('survives a storage that throws', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadMidiMap(broken)).toEqual([])
    expect(() => saveMidiMap(broken, table)).not.toThrow()
    expect(() => saveMidiMap(broken, [])).not.toThrow()
  })
})
