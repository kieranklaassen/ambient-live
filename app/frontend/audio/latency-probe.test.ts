// Drives measureRoundTrip against the library's recording mocks: the worklet
// is stood in for by hand-delivering the capture it would post back.

import { describe, expect, it, vi } from 'vitest'

import {
  asAudioContext,
  asAudioNode,
  createMockContext,
  type MockAudioContext,
  type MockAudioWorkletNode,
} from '@kieranklaassen/live-mix/testing'
import type { WorkletNodeFactory } from '@kieranklaassen/live-mix/dsp'

import { PROBE_PROCESSOR_NAME, buildProbe, type ProbeMessage } from './latency'
import { measureRoundTrip, type MeasureRoundTripOptions } from './latency-probe'

vi.mock('./latency-probe-processor?worker&url', () => ({ default: '/latency-probe.js' }))

const createNode: WorkletNodeFactory = (context, name, options) =>
  (context as unknown as MockAudioContext).createWorkletNode(name, options) as unknown as AudioWorkletNode

/** The processor load and each pass's teardown are awaited; let them settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function start(currentTime: number, options: Partial<MeasureRoundTripOptions> = {}) {
  const ctx = createMockContext({ sampleRate: 48000, currentTime })
  const input = ctx.createMediaStreamSource({ getAudioTracks: () => [] })
  const pending = measureRoundTrip({
    context: asAudioContext(ctx),
    input: asAudioNode(input),
    createNode,
    ...options,
  })
  return { ctx, input, pending }
}

/** What the processor posts back: `roundTripSec` of the probe heard again, plus noise. */
function deliverCapture(
  capture: MockAudioWorkletNode,
  ctx: MockAudioContext,
  probeStartTimeSec: number,
  roundTripSec: number | null,
) {
  const arm = capture.port.posted.calls[0]![0] as ProbeMessage
  const startFrame = Math.round((probeStartTimeSec - 0.1) * ctx.sampleRate)
  const samples = new Float32Array(arm.frames)
  for (let i = 0; i < samples.length; i += 1) samples[i] = 0.01 * Math.sin(i * 0.37)
  if (roundTripSec !== null) {
    const probe = buildProbe(ctx.sampleRate)
    const at = Math.round((probeStartTimeSec + roundTripSec) * ctx.sampleRate) - startFrame
    for (let i = 0; i < probe.length; i += 1) samples[at + i]! += 0.3 * probe[i]!
  }
  capture.port.receive({ type: 'captured', startFrame, samples })
}

/** Run every pass: each one's capture node appears after the previous pass settles. */
async function runPasses(ctx: MockAudioContext, roundTrips: (number | null)[]) {
  const probeStart = ctx.currentTime + 0.15
  for (let i = 0; i < roundTrips.length; i += 1) {
    await settle()
    deliverCapture(ctx.workletNodes[i]!, ctx, probeStart, roundTrips[i]!)
  }
}

describe('measureRoundTrip', () => {
  it('loads the processor once, taps the input and schedules the probe after the lead', async () => {
    const { ctx, input, pending } = start(2, { passes: 1 })
    await settle()
    const capture = ctx.workletNodes[0]!
    expect(ctx.audioWorklet.modules).toEqual(['/latency-probe.js'])
    expect(capture.name).toBe(PROBE_PROCESSOR_NAME)
    expect(input.isConnectedTo(capture)).toBe(true)
    expect(capture.isConnectedTo(ctx.destination)).toBe(true)
    expect(capture.port.posted.calls[0]![0]).toEqual({ type: 'arm', frames: 48000 })

    const source = ctx.sources[0]!
    expect(source.buffer?.length).toBe(1440)
    expect(source.isConnectedTo(ctx.destination)).toBe(true)
    expect(source.startCalls.calls[0]).toEqual([2.15])

    deliverCapture(capture, ctx, 2.15, 0.0225)
    const result = await pending
    expect(result.passes).toHaveLength(1)
    expect(result.passes[0]!.probeStartTimeSec).toBe(2.15)
    expect(result.roundTripSec).toBeCloseTo(0.0225, 4)
    expect(result.context).toEqual({ sampleRate: 48000, baseLatencySec: 0, outputLatencySec: 0 })
    // Tear-down leaves nothing hanging off the input.
    expect(input.isConnectedTo(capture)).toBe(false)
    expect(capture.disconnectCalls.count).toBeGreaterThan(0)
    expect(source.disconnectCalls.count).toBeGreaterThan(0)
  })

  it('plays the probe into a supplied output instead of the destination', async () => {
    const ctx = createMockContext({ sampleRate: 48000, currentTime: 1 })
    const loop = ctx.createMediaStreamDestination()
    const input = ctx.createMediaStreamSource(loop.stream)
    const pending = measureRoundTrip({
      context: asAudioContext(ctx),
      input: asAudioNode(input),
      output: asAudioNode(loop),
      createNode,
      passes: 1,
    })
    await settle()
    expect(ctx.sources[0]!.isConnectedTo(loop)).toBe(true)
    expect(ctx.sources[0]!.isConnectedTo(ctx.destination)).toBe(false)
    deliverCapture(ctx.workletNodes[0]!, ctx, 1.15, 0.02)
    expect((await pending).roundTripSec).toBeCloseTo(0.02, 4)
  })

  it('runs three passes by default and reports their agreed median', async () => {
    const { ctx, pending } = start(2)
    await runPasses(ctx, [0.0225, 0.0226, 0.0224])
    const result = await pending
    expect(result.passes.map((pass) => pass.roundTripSec)).toEqual([
      expect.closeTo(0.0225, 4),
      expect.closeTo(0.0226, 4),
      expect.closeTo(0.0224, 4),
    ])
    expect(result.roundTripSec).toBeCloseTo(0.0225, 4)
    expect(ctx.workletNodes).toHaveLength(3)
  })

  it('reports null when the passes disagree — the mic heard something, not the probe', async () => {
    const { ctx, pending } = start(2)
    await runPasses(ctx, [0.02, 0.36, 0.11])
    const result = await pending
    expect(result.passes.every((pass) => pass.roundTripSec !== null)).toBe(true)
    expect(result.roundTripSec).toBeNull()
  })

  it('reports null when a pass heard only noise', async () => {
    const { ctx, pending } = start(1, { passes: 2 })
    await runPasses(ctx, [0.02, null])
    const result = await pending
    expect(result.roundTripSec).toBeNull()
    expect(result.passes[1]!.confidence).toBeLessThan(8)
  })

  it('loads the processor once per context', async () => {
    const ctx = createMockContext({ sampleRate: 48000 })
    const input = asAudioNode(ctx.createMediaStreamSource({ getAudioTracks: () => [] }))
    const first = measureRoundTrip({ context: asAudioContext(ctx), input, createNode, passes: 1 })
    const second = measureRoundTrip({ context: asAudioContext(ctx), input, createNode, passes: 1 })
    await settle()
    deliverCapture(ctx.workletNodes[0]!, ctx, 0.15, 0.01)
    await first
    deliverCapture(ctx.workletNodes[1]!, ctx, 0.15, 0.01)
    await second
    expect(ctx.audioWorklet.modules).toEqual(['/latency-probe.js'])
  })
})
