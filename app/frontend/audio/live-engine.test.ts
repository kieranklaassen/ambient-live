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
  type MockAudioNode,
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

describe('LiveEngine.applyControl', () => {
  it('routes reverb and master controls to the existing paths', async () => {
    const { ctx, live } = await build()
    const [, plateNode] = ctx.workletNodes
    live.applyControl('reverb.mix', 0.5)
    live.applyControl('reverb.decay', 0.8)
    live.applyControl('reverb.damping', 0.2)
    live.applyControl('reverb.predelayMs', 10)
    expect(plateNode.port.posted.calls.map((c) => c[0])).toEqual([
      { type: 'set-param', paramId: DATTORRO_PARAMS.mix.id, value: 0.5 },
      { type: 'set-param', paramId: DATTORRO_PARAMS.decay.id, value: 0.8 },
      { type: 'set-param', paramId: DATTORRO_PARAMS.damping.id, value: 0.2 },
      { type: 'set-param', paramId: DATTORRO_PARAMS.predelayMs.id, value: 10 },
    ])
    ctx.currentTime = 1
    live.applyControl('master.gain', 0.6)
    expect(ctx.gains[0].gain.lastEvent('setTargetAtTime')?.args).toEqual([0.6, 1, 0.005])
  })

  it('ramps strip levels and pans on the synth, clips and input strips', async () => {
    const { ctx, live } = await build()
    ctx.currentTime = 4
    live.applyControl('synth.level', 0.7)
    expect(live.synth.strip.level).toBe(0.7)
    expect(live.synth.strip.fader.gain.lastEvent('setTargetAtTime')?.args).toEqual([0.7, 4, 0.005])
    live.applyControl('synth.pan', -0.5)
    expect(live.synth.strip.pan).toBe(-0.5)
    expect(live.synth.strip.panner.pan.lastEvent('setTargetAtTime')?.args).toEqual([-0.5, 4, 0.005])
    live.applyControl('clips.level', 1.2)
    live.applyControl('clips.pan', 0.25)
    expect(live.clips.strip.level).toBe(1.2)
    expect(live.clips.strip.pan).toBe(0.25)
    live.applyControl('input.level', 0.3)
    live.applyControl('input.pan', 1)
    expect(live.input.strip.level).toBe(0.3)
    expect(live.input.strip.pan).toBe(1)
    // The synth still reaches the output through its materialised strip.
    expect(ctx.workletNodes[0].reaches(ctx.destination)).toBe(true)
  })

  it('treats input.monitor as a switch', async () => {
    const { live } = await build()
    live.applyControl('input.monitor', 0)
    expect(live.liveInputMonitor).toBe(false)
    live.applyControl('input.monitor', 1)
    expect(live.liveInputMonitor).toBe(true)
  })
})
