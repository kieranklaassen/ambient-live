// MIDI → control mapping: a small learn-lite table that turns incoming CCs and
// notes into control changes on the workstation's targets (device params and
// strip controls). Pure — no React, no Web Audio, no window — so the whole
// layer is unit-testable; persistence takes any Storage-like object.

import {
  controlTarget,
  isControlTargetId,
  type ControlTargetId,
  type ControlTargetSpec,
} from './control-targets'
import type { MidiEvent } from './midi'

/** What a mapping listens to. Channels are 1–16 as MIDI numbers them. */
export type MidiSource =
  | { kind: 'cc'; channel: number; controller: number }
  | { kind: 'note'; channel: number; note: number }

export interface MidiMapping {
  source: MidiSource
  target: ControlTargetId
}

/** One entry per target; a source may drive several targets. */
export type MidiMapTable = readonly MidiMapping[]

/** A resolved control change: set a 0..1 position, or flip a toggle. */
export type ControlChange =
  | { target: ControlTargetId; action: 'set'; unit: number }
  | { target: ControlTargetId; action: 'toggle' }

export const MIDI_MAP_FORMAT = 1
export const MIDI_MAP_STORAGE_KEY = 'ambient-live:midi-map'

/** The source a learn gesture would record for this event, if it is one. */
export function sourceFromEvent(event: MidiEvent): MidiSource | null {
  switch (event.type) {
    case 'cc':
      return { kind: 'cc', channel: event.channel, controller: event.controller }
    case 'note-on':
      return { kind: 'note', channel: event.channel, note: event.note }
    case 'note-off':
      // A release cannot start a mapping; the press already did.
      return null
    default: {
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}

export function sourceKey(source: MidiSource): string {
  switch (source.kind) {
    case 'cc':
      return `cc:${source.channel}:${source.controller}`
    case 'note':
      return `note:${source.channel}:${source.note}`
    default: {
      const _exhaustive: never = source
      return _exhaustive
    }
  }
}

export function describeSource(source: MidiSource): string {
  switch (source.kind) {
    case 'cc':
      return `CC ${source.controller} · ch ${source.channel}`
    case 'note':
      return `Note ${source.note} · ch ${source.channel}`
    default: {
      const _exhaustive: never = source
      return _exhaustive
    }
  }
}

export function sameSource(a: MidiSource, b: MidiSource): boolean {
  return sourceKey(a) === sourceKey(b)
}

/** Does this event come from the mapping's source? */
export function eventMatches(source: MidiSource, event: MidiEvent): boolean {
  switch (source.kind) {
    case 'cc':
      return (
        event.type === 'cc' &&
        event.channel === source.channel &&
        event.controller === source.controller
      )
    case 'note':
      return event.type !== 'cc' && event.channel === source.channel && event.note === source.note
    default: {
      const _exhaustive: never = source
      return _exhaustive
    }
  }
}

/** Bind `target` to `source`, replacing whatever the target was bound to. */
export function mapControl(
  table: MidiMapTable,
  target: ControlTargetId,
  source: MidiSource,
): MidiMapTable {
  return [...table.filter((mapping) => mapping.target !== target), { source, target }]
}

export function unmapControl(table: MidiMapTable, target: ControlTargetId): MidiMapTable {
  return table.filter((mapping) => mapping.target !== target)
}

export function mappingFor(table: MidiMapTable, target: ControlTargetId): MidiMapping | undefined {
  return table.find((mapping) => mapping.target === target)
}

/** A mapped event is consumed by the map; unmapped notes still play the synth. */
export function isMapped(table: MidiMapTable, event: MidiEvent): boolean {
  return table.some((mapping) => eventMatches(mapping.source, event))
}

function changeFor(spec: ControlTargetSpec, event: MidiEvent): ControlChange | null {
  switch (event.type) {
    case 'cc':
      // A MIDI switch on a toggle is value ≥ 64; `controlValueFromUnit` snaps at 0.5.
      return { target: spec.id, action: 'set', unit: event.value / 127 }
    case 'note-on':
      if (spec.kind === 'toggle') return { target: spec.id, action: 'toggle' }
      return { target: spec.id, action: 'set', unit: event.velocity / 127 }
    case 'note-off':
      // Pads set a value on the hit and leave it there on release.
      return null
    default: {
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}

/** The control changes an incoming event produces under this table. */
export function resolveMidiEvent(table: MidiMapTable, event: MidiEvent): ControlChange[] {
  const changes: ControlChange[] = []
  for (const mapping of table) {
    if (!eventMatches(mapping.source, event)) continue
    const change = changeFor(controlTarget(mapping.target), event)
    if (change) changes.push(change)
  }
  return changes
}

// Learn-lite: arm one target, and the next CC or note-on binds it.

export interface LearnState {
  target: ControlTargetId | null
}

export const IDLE_LEARN: LearnState = { target: null }

export interface LearnOutcome {
  learn: LearnState
  table: MidiMapTable
  /** True when the event completed a learn and must not reach the synth or the map. */
  consumed: boolean
}

/** Feed an event through learn mode; returns the new learn state and table. */
export function learnFromEvent(
  learn: LearnState,
  table: MidiMapTable,
  event: MidiEvent,
): LearnOutcome {
  if (learn.target === null) return { learn, table, consumed: false }
  const source = sourceFromEvent(event)
  if (!source) return { learn, table, consumed: false }
  return { learn: IDLE_LEARN, table: mapControl(table, learn.target, source), consumed: true }
}

// Persistence: a versioned JSON blob; anything malformed is dropped entry by
// entry so a stale table never blocks the page.

interface SerializedMidiMap {
  format: typeof MIDI_MAP_FORMAT
  mappings: MidiMapping[]
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function serializeMidiMap(table: MidiMapTable): string {
  const payload: SerializedMidiMap = { format: MIDI_MAP_FORMAT, mappings: [...table] }
  return JSON.stringify(payload)
}

function isMidiChannel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 16
}

function isDataByte(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 127
}

function parseSource(value: unknown): MidiSource | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (!isMidiChannel(record.channel)) return null
  if (record.kind === 'cc' && isDataByte(record.controller)) {
    return { kind: 'cc', channel: record.channel, controller: record.controller }
  }
  if (record.kind === 'note' && isDataByte(record.note)) {
    return { kind: 'note', channel: record.channel, note: record.note }
  }
  return null
}

function parseMapping(value: unknown): MidiMapping | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (!isControlTargetId(record.target)) return null
  const source = parseSource(record.source)
  if (!source) return null
  return { source, target: record.target }
}

/** Parse `serializeMidiMap` output (string or already-parsed); never throws. */
export function parseMidiMap(input: unknown): MidiMapTable {
  let value = input
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  if (record.format !== MIDI_MAP_FORMAT || !Array.isArray(record.mappings)) return []
  let table: MidiMapTable = []
  for (const entry of record.mappings) {
    const mapping = parseMapping(entry)
    if (mapping) table = mapControl(table, mapping.target, mapping.source)
  }
  return table
}

export function loadMidiMap(storage: StorageLike | null, key = MIDI_MAP_STORAGE_KEY): MidiMapTable {
  if (!storage) return []
  try {
    return parseMidiMap(storage.getItem(key))
  } catch {
    return []
  }
}

export function saveMidiMap(
  storage: StorageLike | null,
  table: MidiMapTable,
  key = MIDI_MAP_STORAGE_KEY,
): void {
  if (!storage) return
  try {
    if (table.length === 0) storage.removeItem(key)
    else storage.setItem(key, serializeMidiMap(table))
  } catch {
    // Quota or private mode: the table still works for this session.
  }
}
