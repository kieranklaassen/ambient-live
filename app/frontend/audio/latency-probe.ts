// Round-trip latency measurement: play a chirp out of the context, capture the
// live input through a worklet, and correlate the two on the audio clock.
// Works with any loopback — speakers into the microphone, an interface's
// loopback cable, or a MediaStreamDestination fed back into the graph.
// Boundary rule (plan KTD-8 / R16): no Inertia, pages, or server state here.

import { ensureProcessor, type WorkletNodeFactory } from '@kieranklaassen/live-mix/dsp'

import {
  MIN_PROBE_CONFIDENCE,
  PROBE_PROCESSOR_NAME,
  ROUND_TRIP_AGREEMENT_SEC,
  agreeingRoundTrip,
  buildProbe,
  describeContextLatency,
  findProbeOffset,
  roundTripSeconds,
  type ContextLatency,
  type ProbeHostMessage,
  type ProbeMessage,
  type ProbeOptions,
} from './latency'
import processorUrl from './latency-probe-processor?worker&url'

/** How long the input is recorded per pass; the probe must come back within it. */
export const PROBE_CAPTURE_SEC = 1
/** Head start between arming the capture and the probe playing, so the arm lands first. */
export const PROBE_LEAD_SEC = 0.15
/** Passes per measurement; they must agree (see `agreeingRoundTrip`). */
export const PROBE_PASSES = 3

export interface MeasureRoundTripOptions {
  context: BaseAudioContext
  /** The node carrying the live input (a `LiveInputTrack`'s `source`). */
  input: AudioNode
  /** Where the probe plays; defaults to the context's destination, bypassing the mix. */
  output?: AudioNode
  passes?: number
  agreementSec?: number
  captureSec?: number
  leadSec?: number
  probe?: ProbeOptions
  /** Test seams: build worklet nodes elsewhere, load the processor from elsewhere. */
  createNode?: WorkletNodeFactory
  processorUrl?: string
}

export interface RoundTripPass {
  /** Output → input on one audio clock, or null when this pass heard no probe. */
  roundTripSec: number | null
  /** Peak-to-RMS ratio of the correlation; below `MIN_PROBE_CONFIDENCE` reads as null above. */
  confidence: number
  probeStartTimeSec: number
  captureStartFrame: number
}

export interface RoundTripMeasurement {
  /** The round trip every pass agreed on, or null when there was no consistent loopback. */
  roundTripSec: number | null
  passes: RoundTripPass[]
  context: ContextLatency
}

const defaultCreateNode: WorkletNodeFactory = (context, name, options) =>
  new AudioWorkletNode(context, name, options)

interface ProbeRun {
  context: BaseAudioContext
  input: AudioNode
  output: AudioNode
  captureSec: number
  leadSec: number
  probe: Float32Array<ArrayBuffer>
  createNode: WorkletNodeFactory
}

async function probeOnce(run: ProbeRun): Promise<RoundTripPass> {
  const { context, input, output, captureSec, leadSec, probe, createNode } = run
  const capture = createNode(context, PROBE_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  })
  const frames = Math.round(captureSec * context.sampleRate)
  const captured = new Promise<ProbeHostMessage>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Latency probe: no capture came back from the worklet')),
      (captureSec + leadSec + 2) * 1000,
    )
    capture.port.onmessage = (event: MessageEvent<ProbeHostMessage>) => {
      if (event.data.type !== 'captured') return
      clearTimeout(timer)
      resolve(event.data)
    }
  })

  // The capture node's output is silence; connecting it keeps the node rendering.
  input.connect(capture)
  capture.connect(output)
  capture.port.postMessage({ type: 'arm', frames } satisfies ProbeMessage)

  const buffer = context.createBuffer(1, probe.length, context.sampleRate)
  buffer.copyToChannel(probe, 0)
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(output)
  const probeStartTimeSec = context.currentTime + leadSec
  source.start(probeStartTimeSec)

  try {
    const result = await captured
    const peak = findProbeOffset(result.samples, probe)
    const confidence = peak?.confidence ?? 0
    const roundTripSec =
      peak && confidence >= MIN_PROBE_CONFIDENCE
        ? roundTripSeconds({
            captureStartFrame: result.startFrame,
            probeStartTimeSec,
            lagFrames: peak.lagFrames,
            sampleRate: context.sampleRate,
          })
        : null
    return {
      roundTripSec: roundTripSec !== null && roundTripSec >= 0 ? roundTripSec : null,
      confidence,
      probeStartTimeSec,
      captureStartFrame: result.startFrame,
    }
  } finally {
    capture.port.onmessage = null
    input.disconnect(capture)
    capture.disconnect()
    source.disconnect()
  }
}

/**
 * Several probe passes in a row; the measurement is the round trip they agree
 * on. Each pass is audible: a 30 ms chirp at −6 dBFS out of `output`.
 */
export async function measureRoundTrip(options: MeasureRoundTripOptions): Promise<RoundTripMeasurement> {
  const { context, input } = options
  const passCount = Math.max(1, options.passes ?? PROBE_PASSES)
  await ensureProcessor(context, options.processorUrl ?? processorUrl)
  const run: ProbeRun = {
    context,
    input,
    output: options.output ?? context.destination,
    captureSec: options.captureSec ?? PROBE_CAPTURE_SEC,
    leadSec: options.leadSec ?? PROBE_LEAD_SEC,
    probe: buildProbe(context.sampleRate, options.probe),
    createNode: options.createNode ?? defaultCreateNode,
  }
  const passes: RoundTripPass[] = []
  for (let i = 0; i < passCount; i += 1) passes.push(await probeOnce(run))
  return {
    roundTripSec: agreeingRoundTrip(
      passes.map((pass) => pass.roundTripSec),
      options.agreementSec ?? ROUND_TRIP_AGREEMENT_SEC,
    ),
    passes,
    context: describeContextLatency(context),
  }
}
