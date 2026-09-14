// Latency bookkeeping and the round-trip probe's pure parts: what the context
// reports, the chirp we play, and the correlation that finds it again in the
// live input. No Web Audio calls — `latency-probe.ts` drives the graph.

export interface ContextLatency {
  sampleRate: number
  /** Render quantum → output buffer: `AudioContext.baseLatency`. */
  baseLatencySec: number
  /** Output buffer → the DAC: `AudioContext.outputLatency` (0 when the browser withholds it). */
  outputLatencySec: number
}

/** Reads the context's own latency figures; missing ones read as 0 (Safari). */
export function describeContextLatency(context: {
  sampleRate: number
  baseLatency?: number
  outputLatency?: number
}): ContextLatency {
  return {
    sampleRate: context.sampleRate,
    baseLatencySec: finiteOrZero(context.baseLatency),
    outputLatencySec: finiteOrZero(context.outputLatency),
  }
}

function finiteOrZero(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function formatMs(seconds: number, digits = 1): string {
  return `${(seconds * 1000).toFixed(digits)} ms`
}

export interface ProbeOptions {
  durationSec?: number
  fromHz?: number
  toHz?: number
  amplitude?: number
}

export const PROBE_DURATION_SEC = 0.03
export const PROBE_FROM_HZ = 400
export const PROBE_TO_HZ = 4000
export const PROBE_AMPLITUDE = 0.5

/**
 * A Hann-windowed linear chirp. Its autocorrelation is a single sharp peak, so
 * the correlation against the captured input locates it to the sample even
 * through a speaker → microphone path; a bare click would be lost in noise.
 */
export function buildProbe(
  sampleRate: number,
  options: ProbeOptions = {},
): Float32Array<ArrayBuffer> {
  const durationSec = options.durationSec ?? PROBE_DURATION_SEC
  const fromHz = options.fromHz ?? PROBE_FROM_HZ
  const toHz = options.toHz ?? PROBE_TO_HZ
  const amplitude = options.amplitude ?? PROBE_AMPLITUDE
  const frames = Math.max(1, Math.round(durationSec * sampleRate))
  const probe = new Float32Array(new ArrayBuffer(frames * Float32Array.BYTES_PER_ELEMENT))
  const sweep = (toHz - fromHz) / durationSec
  for (let i = 0; i < frames; i += 1) {
    const t = i / sampleRate
    const phase = 2 * Math.PI * (fromHz * t + 0.5 * sweep * t * t)
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frames - 1 || 1))
    probe[i] = amplitude * window * Math.sin(phase)
  }
  return probe
}

export interface CorrelationPeak {
  /** Offset into `captured` where the probe starts. */
  lagFrames: number
  /** Correlation value at the peak. */
  peak: number
  /** Peak over the RMS of every lag — how much the match stands out of the noise. */
  confidence: number
}

/** Below this peak-to-RMS ratio a match is treated as noise (no loopback path). */
export const MIN_PROBE_CONFIDENCE = 8

/** Cross-correlates `captured` against `probe` and returns the strongest lag. */
export function findProbeOffset(
  captured: Float32Array,
  probe: Float32Array,
): CorrelationPeak | null {
  const lags = captured.length - probe.length + 1
  if (lags <= 0 || probe.length === 0) return null
  let bestLag = 0
  let best = -Infinity
  let sumSquares = 0
  for (let lag = 0; lag < lags; lag += 1) {
    let acc = 0
    for (let i = 0; i < probe.length; i += 1) acc += captured[lag + i]! * probe[i]!
    sumSquares += acc * acc
    if (acc > best) {
      best = acc
      bestLag = lag
    }
  }
  const rms = Math.sqrt(sumSquares / lags)
  const confidence = rms > 0 ? best / rms : 0
  return { lagFrames: bestLag, peak: best, confidence }
}

export interface RoundTripTiming {
  /** Render frame the capture buffer starts on (the processor's `currentFrame`). */
  captureStartFrame: number
  /** Audio-clock time the probe was scheduled to start playing. */
  probeStartTimeSec: number
  /** Where the probe was found in the capture. */
  lagFrames: number
  sampleRate: number
}

/**
 * Time from the probe leaving the graph to the same sound re-entering it
 * through the live input: output latency + the acoustic or cable path + input
 * latency, on one audio clock.
 */
export function roundTripSeconds(timing: RoundTripTiming): number {
  const arrivalSec = (timing.captureStartFrame + timing.lagFrames) / timing.sampleRate
  return arrivalSec - timing.probeStartTimeSec
}

/** Messages between `latency-probe.ts` and its capture processor. */
export type ProbeMessage = { type: 'arm'; frames: number }
export type ProbeHostMessage = {
  type: 'captured'
  startFrame: number
  samples: Float32Array
}

/** Registered name of the capture processor (latency-probe-processor.ts). */
export const PROBE_PROCESSOR_NAME = 'ambient-latency-probe'
