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
import { measureRoundTrip } from './latency-probe'

vi.mock('./latency-probe-processor?worker&url', () => ({ default: '/latency-probe.js' }))

const createNode: WorkletNodeFactory = (context, name, options) =>
  (context as unknown as MockAudioContext).createWorkletNode(name, options) as unknown as AudioWorkletNode

/** The processor load is awaited before the node exists; let that settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function setUp(currentTime = 2) {
  const ctx = createMockContext({ sampleRate: 48000, currentTime })
  const input = ctx.createMediaStreamSource({ getAudioTracks: () => [] })
  const pending = measureRoundTrip({
    context: asAudioContext(ctx),
    input: asAudioNode(input),
    createNode,
  })
  await settle()
  const capture = ctx.workletNodes[0]!
  return { ctx, input, capture, pending }
}

/** What the processor posts back: `roundTripSec` of the probe heard again, plus noise. */
function captureWith(
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

describe('measureRoundTrip', () => {
  it('loads the processor once, taps the input and schedules the probe after the lead', async () => {
    const { ctx, input, capture, pending } = await setUp(2)
    expect(ctx.audioWorklet.modules).toEqual(['/latency-probe.js'])
    expect(capture.name).toBe(PROBE_PROCESSOR_NAME)
    expect(input.isConnectedTo(capture)).toBe(true)
    expect(capture.isConnectedTo(ctx.destination)).toBe(true)
    expect(capture.port.posted.calls[0]![0]).toEqual({ type: 'arm', frames: 48000 })

    const source = ctx.sources[0]!
    expect(source.buffer?.length).toBe(1440)
    expect(source.isConnectedTo(ctx.destination)).toBe(true)
    expect(source.startCalls.calls[0]).toEqual([2.15])

    captureWith(capture, ctx, 2.15, 0.0225)
    const result = await pending
    expect(result.probeStartTimeSec).toBe(2.15)
    expect(result.roundTripSec).toBeCloseTo(0.0225, 4)
    expect(result.context).toEqual({ sampleRate: 48000, baseLatencySec: 0, outputLatencySec: 0 })
    // Tear-down leaves nothing hanging off the input.
    expect(input.isConnectedTo(capture)).toBe(false)
    expect(capture.disconnectCalls.count).toBeGreaterThan(0)
    expect(source.disconnectCalls.count).toBeGreaterThan(0)
  })

  it('reports null when nothing but noise came back', async () => {
    const { ctx, capture, pending } = await setUp(1)
    captureWith(capture, ctx, 1.15, null)
    const result = await pending
    expect(result.roundTripSec).toBeNull()
    expect(result.confidence).toBeLessThan(8)
  })

  it('loads the processor once per context', async () => {
    const ctx = createMockContext({ sampleRate: 48000 })
    const input = asAudioNode(ctx.createMediaStreamSource({ getAudioTracks: () => [] }))
    const first = measureRoundTrip({ context: asAudioContext(ctx), input, createNode })
    const second = measureRoundTrip({ context: asAudioContext(ctx), input, createNode })
    await settle()
    captureWith(ctx.workletNodes[0]!, ctx, 0.15, 0.01)
    await first
    captureWith(ctx.workletNodes[1]!, ctx, 0.15, 0.01)
    await second
    expect(ctx.audioWorklet.modules).toEqual(['/latency-probe.js'])
  })
})
