// The graph the workstation runs on, built on the library's recording mocks
// with the real committed engine.wasm and dattorro.wasm: proves the wiring
// (synth + clips → master 0.8 → plate → meter → destination), the parameter
// routing, and that engine.wasm implements the device ABI plus the
// instrument's extras.

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import {
  AMBIENT_LIVE_MIDI_MAP_FORMAT,
  MAPPING_TABLE_FORMAT,
  MidiDecoder,
  controlTargetKey,
  parseMappingTable,
  type ControlEvent,
  type ControlTarget,
  type StorageLike,
} from '@kieranklaassen/live-mix'
import {
  MockAudioBuffer,
  asAudioContext,
  createMockContext,
  type MockAudioContext,
  type MockAudioNode,
  type MockAudioWorkletNode,
} from '@kieranklaassen/live-mix/testing'
import { DATTORRO_PARAMS, type WorkletNodeFactory } from '@kieranklaassen/live-mix/dsp'

import {
  MIDI_MAP_STORAGE_KEY,
  createLiveControlSurface,
  liveControl,
  liveControlFor,
  liveControlFromUnit,
  unitFromLiveControl,
  type LiveControlId,
} from './live-controls'
import type { LiveEngine } from './live-engine'

vi.mock('./instrument-processor?worker&url', () => ({ default: '/instrument-processor.js' }))
vi.mock('./engine.wasm?url', () => ({ default: '/engine.wasm' }))

const here = dirname(fileURLToPath(import.meta.url))
let engineModule: WebAssembly.Module
let dattorroModule: WebAssembly.Module

const mockNodeFactory: WorkletNodeFactory = (context, name, options) =>
  (context as unknown as MockAudioContext).createWorkletNode(
    name,
    options,
  ) as unknown as AudioWorkletNode

beforeAll(async () => {
  engineModule = await WebAssembly.compile(await readFile(join(here, 'engine.wasm')))
  dattorroModule = await WebAssembly.compile(
    await readFile(
      join(here, '../../../node_modules/@kieranklaassen/live-mix/dist/wasm/dattorro.wasm'),
    ),
  )
})

async function build() {
  const { LiveEngine } = await import('./live-engine')
  const ctx = createMockContext({ sampleRate: 48000 })
  const live = await LiveEngine.create(asAudioContext(ctx) as AudioContext, {
    instrument: { wasm: engineModule, createNode: mockNodeFactory },
    plate: { wasm: dattorroModule, createNode: mockNodeFactory, processorUrl: '/wasm-device.js' },
  })
  return { ctx, live }
}

describe('engine.wasm', () => {
  it('implements the device ABI plus note and sample-audition exports', async () => {
    const instance = await WebAssembly.instantiate(engineModule, {})
    const exports = instance.exports as Record<string, unknown>
    for (const name of [
      'device_init',
      'device_set_param',
      'device_in_left',
      'device_in_right',
      'device_out_left',
      'device_out_right',
      'device_max_block_frames',
      'device_process',
      'device_note_on',
      'device_note_off',
      'instrument_sample_buffer',
      'instrument_sample_capacity_frames',
      'instrument_sample_loaded',
      'instrument_sample_play',
      'instrument_sample_stop',
      'instrument_sample_playing',
    ]) {
      expect(typeof exports[name], name).toBe('function')
    }
    const e = exports as {
      _initialize?: () => void
      device_init: (sr: number, n: number) => void
      device_note_on: (id: number, hz: number, gain: number) => void
      device_process: (n: number) => void
      device_out_left: () => number
      memory: WebAssembly.Memory
    }
    e._initialize?.()
    e.device_init(48000, 128)
    e.device_note_on(1, 440, 0.5)
    for (let i = 0; i < 40; i += 1) e.device_process(128)
    const out = new Float32Array(e.memory.buffer, e.device_out_left(), 128)
    expect(Math.max(...out.map(Math.abs))).toBeGreaterThan(0.1)
  })
})

describe('LiveEngine graph', () => {
  it('wires synth and clips into a 0.8 master, then the plate, the meter and the destination', async () => {
    const { ctx, live } = await build()
    const master = ctx.gains[0]
    expect(master.gain.value).toBe(0.8)
    const [synthNode, plateNode] = ctx.workletNodes
    expect(synthNode.name).toBe('ambient-instrument')
    expect(plateNode.name).toBe('live-mix-wasm-device')
    expect(ctx.audioWorklet.modules).toEqual(['/instrument-processor.js', '/wasm-device.js'])
    expect(synthNode.isConnectedTo(master)).toBe(true)
    // master fader → plate (post-fader insert) → analyser meter → destination
    const meter = ctx.analysers[0]
    expect(meter.fftSize).toBe(2048)
    expect(master.isConnectedTo(plateNode)).toBe(true)
    expect(plateNode.isConnectedTo(meter)).toBe(true)
    expect(meter.isConnectedTo(ctx.destination)).toBe(true)
    expect(master.reaches(ctx.destination)).toBe(true)
    expect(live.clips.name).toBe('clips')
    expect(live.clips.lookaheadSec).toBe(0.2)
    expect(live.engine.transport.loop).toEqual({ enabled: true, lengthSec: 32 })
    expect(live.engine.scheduler.tickMs).toBe(40)
  })

  it('routes reverb params to the plate, master gain to the fader, notes to the synth', async () => {
    const { ctx, live } = await build()
    const [synthNode, plateNode] = ctx.workletNodes
    live.setReverbParam('decay', 0.9)
    live.setReverbParam('predelayMs', 40)
    expect(plateNode.port.posted.calls.map((c) => c[0])).toEqual([
      { type: 'set-param', paramId: DATTORRO_PARAMS.decay.id, value: 0.9 },
      { type: 'set-param', paramId: DATTORRO_PARAMS.predelayMs.id, value: 40 },
    ])
    ctx.currentTime = 2
    live.setMasterGain(0.5)
    expect(ctx.gains[0].gain.lastEvent('setTargetAtTime')?.args).toEqual([0.5, 2, 0.005])

    live.noteOn(60, 440, 0.4)
    live.noteOff(60)
    expect(synthNode.port.posted.calls.map((c) => c[0])).toEqual([
      { type: 'note-on', noteId: 60, frequency: 440, gain: 0.4 },
      { type: 'note-off', noteId: 60 },
    ])
  })

  it('decodes samples with peaks and auditions them through the synth once per sample', async () => {
    const { ctx, live } = await build()
    const [synthNode] = ctx.workletNodes
    const loaded = await live.loadSample(7, new ArrayBuffer(2))
    expect(loaded.durationSec).toBe(2)
    expect(loaded.peaks?.min).toHaveLength(512)
    expect(live.sample(7)).toBe(loaded)
    expect(live.sample(8)).toBeUndefined()
    expect(loaded.buffer).toBeInstanceOf(MockAudioBuffer)

    live.playSample(7)
    live.playSample(7)
    live.stopSample()
    const types = synthNode.port.posted.calls.map((c) => (c[0] as { type: string }).type)
    expect(types).toEqual(['load-sample', 'play-sample', 'play-sample', 'stop-sample'])
    const load = synthNode.port.posted.calls[0][0] as { frames: number; channels: number }
    expect(load.frames).toBe(2 * 48000)
    expect(load.channels).toBe(2)

    live.forgetSample(7)
    expect(live.sample(7)).toBeUndefined()
    live.playSample(7)
    expect(synthNode.port.posted.count).toBe(4)
  })

  it('outputLevel reads the master meter and close disposes the engine', async () => {
    const { ctx, live } = await build()
    ctx.analysers[0].level = 0.3
    expect(live.outputLevel()).toBeCloseTo(0.3)
    await live.close()
    expect(ctx.state).toBe('closed')
    expect(ctx.workletNodes[0].disconnectCalls.count).toBeGreaterThanOrEqual(1)
  })
})

function mockStream() {
  const stopped: string[] = []
  const track = (id: string) => ({ id, stop: () => void stopped.push(id) })
  const tracks = [track('mic')]
  const stream = {
    getAudioTracks: () => tracks,
    getTracks: () => tracks,
  } as unknown as MediaStream
  return { stream, stopped }
}

describe('LiveEngine live input', () => {
  it('creates no nodes until a stream is attached, then routes it into the master mix', async () => {
    const { ctx, live } = await build()
    const nodesBefore = ctx.allNodes().length
    expect(live.liveInputEnabled).toBe(false)
    expect(live.input.name).toBe('input')

    const { stream } = mockStream()
    live.enableLiveInput(stream)
    expect(live.liveInputEnabled).toBe(true)
    const source = ctx.streamSources[0]
    expect(source.mediaStream).toBe(stream)
    const master = ctx.gains[0]
    expect(source.isConnectedTo(live.input.gainNode as unknown as MockAudioNode)).toBe(true)
    expect(source.reaches(master)).toBe(true)
    expect(source.reaches(ctx.destination)).toBe(true)
    expect(ctx.allNodes().length).toBeGreaterThan(nodesBefore)
  })

  it('monitoring mutes and unmutes the input strip gate without touching the source', async () => {
    const { ctx, live } = await build()
    live.enableLiveInput(mockStream().stream)
    expect(live.liveInputMonitor).toBe(true)
    ctx.currentTime = 3
    live.setLiveInputMonitor(false)
    expect(live.liveInputMonitor).toBe(false)
    expect(live.input.strip.gate.gain.lastEvent('setTargetAtTime')?.args).toEqual([0, 3, 0.005])
    live.setLiveInputMonitor(true)
    expect(live.input.strip.gate.gain.lastEvent('setTargetAtTime')?.args).toEqual([1, 3, 0.005])
    expect(ctx.streamSources[0].reaches(ctx.gains[0])).toBe(true)
  })

  it('replacing or disabling the input stops the previous capture tracks', async () => {
    const { ctx, live } = await build()
    const first = mockStream()
    const second = mockStream()
    live.enableLiveInput(first.stream)
    live.enableLiveInput(second.stream)
    expect(first.stopped).toEqual(['mic'])
    expect(ctx.streamSources).toHaveLength(2)
    live.disableLiveInput()
    expect(second.stopped).toEqual(['mic'])
    expect(live.liveInputEnabled).toBe(false)
    expect(ctx.streamSources[1].disconnectCalls.count).toBeGreaterThan(0)
  })

  it('close releases the capture device', async () => {
    const { live } = await build()
    const { stream, stopped } = mockStream()
    live.enableLiveInput(stream)
    await live.close()
    expect(stopped).toEqual(['mic'])
  })

  it('reports the context latency figures and refuses to measure without an input', async () => {
    const { live } = await build()
    expect(live.latency()).toEqual({ sampleRate: 48000, baseLatencySec: 0, outputLatencySec: 0 })
    await expect(live.measureRoundTripLatency()).rejects.toThrow(/Enable the live input/)
  })
})

// The workstation's controls through the library's `ControlSurface` (U36):
// what `LiveEngine.applyControl` did in U27, now written by the surface's
// bindings — and a stored U27 table keeps driving the same targets.

const decoder = new MidiDecoder({ pair14Bit: false })
const midi = (...bytes: number[]): ControlEvent => decoder.decode(Uint8Array.from(bytes))[0]
const cc = (controller: number, value: number, channel = 1): ControlEvent =>
  midi(0xb0 | (channel - 1), controller, value)
const noteOn = (note: number, velocity = 100, channel = 1): ControlEvent =>
  midi(0x90 | (channel - 1), note, velocity)
const noteOff = (note: number, channel = 1): ControlEvent => midi(0x80 | (channel - 1), note, 0)

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const storage: StorageLike = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
  return { storage, data }
}

/** Exactly what U27's `serializeMidiMap` wrote under `ambient-live:midi-map`. */
const U27_STORED_TABLE = JSON.stringify({
  format: AMBIENT_LIVE_MIDI_MAP_FORMAT,
  mappings: [
    { source: { kind: 'cc', channel: 1, controller: 74 }, target: 'reverb.mix' },
    { source: { kind: 'cc', channel: 1, controller: 74 }, target: 'reverb.decay' },
    { source: { kind: 'cc', channel: 1, controller: 20 }, target: 'input.monitor' },
    { source: { kind: 'note', channel: 1, note: 37 }, target: 'synth.level' },
    { source: { kind: 'cc', channel: 2, controller: 7 }, target: 'master.gain' },
  ],
})

const setParams = (node: MockAudioWorkletNode) =>
  node.port.posted.calls
    .map((c) => c[0] as { type: string; paramId: number; value: number })
    .filter((message) => message.type === 'set-param')
    .map(({ paramId, value }) => ({ paramId, value }))

async function buildWithSurface(stored = U27_STORED_TABLE) {
  const { ctx, live } = await build()
  const { storage, data } = memoryStorage({ [MIDI_MAP_STORAGE_KEY]: stored })
  const surface = createLiveControlSurface(() => live)
  const stopPersisting = surface.persist(storage, { key: MIDI_MAP_STORAGE_KEY })
  return { ctx, live, surface, storage, data, stopPersisting }
}

describe('ControlSurface over the LiveEngine', () => {
  it('loads a stored U27 table (format 1) and drives the same targets with the same values', async () => {
    const { ctx, live, surface, data } = await buildWithSurface()
    const [, plateNode] = ctx.workletNodes
    expect(surface.table).toHaveLength(5)

    // CC 74 sets mix to 1 and decay to the knob's 0.99, as U27's ranges did.
    expect(surface.handle(cc(74, 127))).toMatchObject({ consumed: true })
    expect(setParams(plateNode)).toEqual([
      { paramId: DATTORRO_PARAMS.mix.id, value: 1 },
      { paramId: DATTORRO_PARAMS.decay.id, value: 0.99 },
    ])
    expect(live.plate.getParam('decay')).toBe(0.99)
    surface.handle(cc(74, 64))
    expect(live.plate.getParam('mix')).toBeCloseTo(64 / 127)
    expect(live.plate.getParam('decay')).toBeCloseTo(0.99 * (64 / 127))

    // A MIDI switch on the monitor: ≥ 64 is on (mute off), below is off.
    surface.handle(cc(20, 63))
    expect(live.liveInputMonitor).toBe(false)
    surface.handle(cc(20, 64))
    expect(live.liveInputMonitor).toBe(true)

    // A pad on a continuous target sets from velocity; the release does nothing.
    surface.handle(noteOn(37, 127))
    expect(live.synth.strip.level).toBe(1.5)
    surface.handle(noteOn(37, 64))
    expect(live.synth.strip.level).toBeCloseTo((64 / 127) * 1.5)
    expect(surface.handle(noteOff(37))).toMatchObject({ consumed: true, applied: [] })
    expect(live.synth.strip.level).toBeCloseTo((64 / 127) * 1.5)

    // Channels match: CC 7 on channel 2 is the master, on channel 1 nothing.
    ctx.currentTime = 2
    surface.handle(cc(7, 127, 2))
    expect(ctx.gains[0].gain.lastEvent('setTargetAtTime')?.args).toEqual([1.5, 2, 0.005])
    expect(surface.handle(cc(7, 0, 1))).toMatchObject({ consumed: false, applied: [] })

    // Nothing was edited, so the stored key is still U27's format 1.
    expect(JSON.parse(data.get(MIDI_MAP_STORAGE_KEY)!).format).toBe(AMBIENT_LIVE_MIDI_MAP_FORMAT)
  })

  it('rewrites the stored table as format 2 with the knobs\u2019 spans on the first edit', async () => {
    const { surface, data } = await buildWithSurface()
    surface.unmap(liveControl('master.gain').target)
    const saved = JSON.parse(data.get(MIDI_MAP_STORAGE_KEY)!)
    expect(saved.format).toBe(MAPPING_TABLE_FORMAT)
    expect(saved.mappings).toHaveLength(4)
    const byId = (id: LiveControlId) =>
      saved.mappings.find(
        (mapping: { target: ControlTarget }) =>
          controlTargetKey(mapping.target) === controlTargetKey(liveControl(id).target),
      )
    expect(byId('reverb.decay')).toMatchObject({
      source: { kind: 'cc', channel: 1, controller: 74 },
      mode: 'set',
      output: { min: 0, max: 0.99 },
    })
    expect(byId('input.monitor')).toMatchObject({ mode: 'set', output: { min: 1, max: 0 } })
    expect(byId('reverb.mix')).toMatchObject({ output: { min: 0, max: 1 } })
    // Reloading the saved table needs no migration and drives the same targets.
    expect(parseMappingTable(data.get(MIDI_MAP_STORAGE_KEY))).toEqual(surface.table)
    surface.clear()
    expect(data.has(MIDI_MAP_STORAGE_KEY)).toBe(false)
  })

  it('learns with U27 semantics: a pad on the monitor toggles it, a knob covers the knob range', async () => {
    const { live, surface } = await buildWithSurface('')
    expect(surface.table).toEqual([])
    const monitor = liveControl('input.monitor').target
    const decay = liveControl('reverb.decay').target

    surface.beginLearn(monitor)
    expect(surface.handle(noteOff(36))).toMatchObject({ consumed: false })
    expect(surface.handle(noteOn(36))).toMatchObject({ consumed: true })
    expect(surface.mappingFor(monitor)).toMatchObject({
      source: { kind: 'note', channel: 1, note: 36 },
      mode: 'toggle',
      output: { min: 1, max: 0 },
    })
    expect(live.liveInputMonitor).toBe(true)
    surface.handle(noteOn(36))
    expect(live.liveInputMonitor).toBe(false)
    expect(surface.handle(noteOff(36))).toMatchObject({ consumed: true, applied: [] })
    surface.handle(noteOn(36))
    expect(live.liveInputMonitor).toBe(true)

    surface.beginLearn(decay)
    surface.handle(cc(71, 5))
    expect(surface.mappingFor(decay)).toMatchObject({
      source: { kind: 'cc', channel: 1, controller: 71 },
      mode: 'set',
      output: { min: 0, max: 0.99 },
    })
    surface.handle(cc(71, 127))
    expect(live.plate.getParam('decay')).toBe(0.99)

    // Learn replaces the binding and keeps the span.
    surface.beginLearn(decay)
    surface.handle(cc(72, 0))
    expect(surface.table).toHaveLength(2)
    expect(surface.mappingFor(decay)).toMatchObject({
      source: { kind: 'cc', channel: 1, controller: 72 },
      output: { min: 0, max: 0.99 },
    })

    // Re-learning the monitor's pad onto a CC switch sets again (U27), not toggles.
    surface.beginLearn(monitor)
    surface.handle(cc(20, 127))
    expect(surface.mappingFor(monitor)).toMatchObject({
      source: { kind: 'cc', channel: 1, controller: 20 },
      mode: 'set',
      output: { min: 1, max: 0 },
    })
    surface.handle(cc(20, 63))
    expect(live.liveInputMonitor).toBe(false)
    surface.handle(cc(20, 64))
    expect(live.liveInputMonitor).toBe(true)
    surface.handle(cc(20, 127))
    expect(live.liveInputMonitor).toBe(true)

    // `Clear all` empties the table.
    surface.clear()
    expect(surface.table).toEqual([])
  })

  it('takes the on-screen controls through the same ramped setters as before', async () => {
    const { ctx, live, surface } = await buildWithSurface('')
    const [, plateNode] = ctx.workletNodes
    const set = (id: LiveControlId, value: number) => {
      const spec = liveControl(id)
      return surface.set(spec.target, unitFromLiveControl(spec, value))
    }
    expect(set('reverb.mix', 0.5)).toBe(true)
    set('reverb.decay', 0.8)
    set('reverb.damping', 0.2)
    set('reverb.predelayMs', 10)
    expect(setParams(plateNode)).toEqual([
      { paramId: DATTORRO_PARAMS.mix.id, value: 0.5 },
      { paramId: DATTORRO_PARAMS.decay.id, value: 0.8 },
      { paramId: DATTORRO_PARAMS.damping.id, value: 0.2 },
      { paramId: DATTORRO_PARAMS.predelayMs.id, value: 10 },
    ])
    ctx.currentTime = 1
    set('master.gain', 0.6)
    expect(ctx.gains[0].gain.lastEvent('setTargetAtTime')?.args).toEqual([0.6, 1, 0.005])

    ctx.currentTime = 4
    set('synth.level', 0.7)
    expect(live.synth.strip.level).toBe(0.7)
    expect(live.synth.strip.fader.gain.lastEvent('setTargetAtTime')?.args).toEqual([0.7, 4, 0.005])
    set('synth.pan', -0.5)
    expect(live.synth.strip.pan).toBe(-0.5)
    expect(live.synth.strip.panner.pan.lastEvent('setTargetAtTime')?.args).toEqual([-0.5, 4, 0.005])
    set('clips.level', 1.2)
    set('clips.pan', 0.25)
    expect(live.clips.strip.level).toBe(1.2)
    expect(live.clips.strip.pan).toBe(0.25)
    set('input.level', 0.3)
    set('input.pan', 1)
    expect(live.input.strip.level).toBe(0.3)
    expect(live.input.strip.pan).toBe(1)
    set('input.monitor', 0)
    expect(live.liveInputMonitor).toBe(false)
    expect(live.input.strip.gate.gain.lastEvent('setTargetAtTime')?.args).toEqual([0, 4, 0.005])
    set('input.monitor', 1)
    expect(live.liveInputMonitor).toBe(true)
    // The synth still reaches the output through its materialised strip.
    expect(ctx.workletNodes[0].reaches(ctx.destination)).toBe(true)
  })

  it('reports what a controller wrote so the knobs can follow', async () => {
    const { live, surface } = await buildWithSurface()
    const applied: [LiveControlId, number][] = []
    surface.onChange((change) => {
      if (change.type !== 'applied' || change.unit === null) return
      const spec = liveControlFor(change.change.target)!
      applied.push([spec.id, liveControlFromUnit(spec, change.unit)])
    })
    surface.handle(cc(74, 127))
    surface.handle(cc(20, 0))
    surface.handle(noteOn(37, 127))
    expect(applied).toEqual([
      ['reverb.mix', 1],
      ['reverb.decay', 0.99],
      ['input.monitor', 0],
      ['synth.level', 1.5],
    ])
    expect(live.liveInputMonitor).toBe(false)
  })

  it('holds the table before audio starts; nothing answers until an engine exists', async () => {
    const { storage } = memoryStorage({ [MIDI_MAP_STORAGE_KEY]: U27_STORED_TABLE })
    let live: LiveEngine | null = null
    const surface = createLiveControlSurface(() => live)
    surface.persist(storage, { key: MIDI_MAP_STORAGE_KEY })
    expect(surface.table).toHaveLength(5)
    expect(surface.set(liveControl('reverb.mix').target, 1)).toBe(false)
    expect(surface.handle(cc(74, 127))).toMatchObject({ consumed: true, applied: [] })

    const built = await build()
    live = built.live
    surface.handle(cc(74, 127))
    expect(live.plate.getParam('mix')).toBe(1)
  })
})
