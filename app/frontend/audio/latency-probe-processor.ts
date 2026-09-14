// AudioWorklet capture for the round-trip latency probe: on `arm`, records
// the next N frames of its input together with the render frame the capture
// started on, then posts the buffer back. The main thread correlates the
// probe it played against this capture (see latency.ts).
//
// Runs in the AudioWorkletGlobalScope: keep it free of runtime imports so it
// works both as a dev-served module and a bundled worker chunk. The buffer is
// allocated in the message handler, never inside process().

import type { ProbeHostMessage, ProbeMessage } from './latency'

// Duplicated from latency.ts on purpose: a value import would pull that module
// into the worklet bundle.
const PROBE_PROCESSOR_NAME = 'ambient-latency-probe'

class LatencyProbeProcessor extends AudioWorkletProcessor {
  private buffer: Float32Array | null = null
  private written = 0
  private startFrame = -1

  constructor(options?: AudioWorkletNodeOptions) {
    super(options)
    this.port.onmessage = (event: MessageEvent<ProbeMessage>) => {
      switch (event.data.type) {
        case 'arm':
          this.buffer = new Float32Array(event.data.frames)
          this.written = 0
          this.startFrame = -1
          break
        default: {
          const unhandled: never = event.data.type
          throw new Error(`Unhandled probe message: ${String(unhandled)}`)
        }
      }
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const buffer = this.buffer
    if (!buffer) return true
    if (this.startFrame < 0) this.startFrame = currentFrame

    // A disconnected input arrives as an empty array; time still advances by
    // one render quantum (the output's length) so the capture stays aligned.
    const block = outputs[0]?.[0]?.length ?? 128
    const input = inputs[0]?.[0]
    const frames = Math.min(block, buffer.length - this.written)
    if (input) buffer.set(input.subarray(0, frames), this.written)
    this.written += frames

    if (this.written >= buffer.length) {
      this.buffer = null
      const message: ProbeHostMessage = {
        type: 'captured',
        startFrame: this.startFrame,
        samples: buffer,
      }
      this.port.postMessage(message, [buffer.buffer])
    }
    return true
  }
}

registerProcessor(PROBE_PROCESSOR_NAME, LatencyProbeProcessor)
