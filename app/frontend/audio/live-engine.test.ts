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
  MockAudioBuffer,
  asAudioContext,
  createMockContext,
  type MockAudioContext,
} from '@kieranklaassen/live-mix/testing'
import { DATTORRO_PARAMS, type WorkletNodeFactory } from '@kieranklaassen/live-mix/dsp'

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
