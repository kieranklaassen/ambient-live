// AudioWorklet processor hosting the instrument's WASM core. The compiled
// WebAssembly.Module arrives via processorOptions from live-mix's WasmDevice
// (a Module transfers across threads; an Instance does not — plan KTD-3) and
// is instantiated synchronously here, before audio starts flowing.
//
// This is an app-local processor on the library's device ABI: it handles the
// library's messages (set-param, bypass, note-on, note-off) exactly like the
// generic processor would, plus the sample-audition messages the generic one
// does not know about. Runs in the AudioWorkletGlobalScope: keep it free of
// runtime imports so it works both as a dev-served module and a bundled
// worker chunk.

import type { WasmDeviceProcessorOptions } from '@kieranklaassen/live-mix/dsp'
import type { InstrumentExports, ProcessorMessage } from './messages'

// Duplicated from messages.ts on purpose: a value import would pull that
// module into the worklet bundle, and the main thread must never import this
// file for its values (registerProcessor only exists in the worklet scope).
const INSTRUMENT_PROCESSOR_NAME = 'ambient-instrument'

class AmbientInstrumentProcessor extends AudioWorkletProcessor {
  private readonly engine: InstrumentExports
  private readonly maxBlockFrames: number
  private outLeft: Float32Array
  private outRight: Float32Array
  private inLeft: Float32Array
  private inRight: Float32Array
  private dryLeft = new Float32Array(0)
  private dryRight = new Float32Array(0)
  private bypassMix = 0
  private bypassTarget = 0
  private readonly bypassStep: number

  constructor(options?: AudioWorkletNodeOptions) {
    super()
    const processorOptions = options?.processorOptions as WasmDeviceProcessorOptions | undefined
    if (!processorOptions?.module) {
      throw new Error('ambient-instrument: processorOptions.module is required')
    }
    const instance = new WebAssembly.Instance(processorOptions.module, {})
    this.engine = instance.exports as unknown as InstrumentExports
    this.engine._initialize?.()
    this.maxBlockFrames = this.engine.device_max_block_frames()
    this.engine.device_init(sampleRate, this.maxBlockFrames)
    for (const [paramId, value] of processorOptions.params ?? []) {
      this.engine.device_set_param(paramId, value)
    }
    this.bypassStep = 1 / Math.max(1, 0.005 * sampleRate)

    // Memory is fixed-size (no growth), so heap views stay valid for the
    // processor's lifetime; process() itself never allocates.
    this.outLeft = new Float32Array(0)
    this.outRight = new Float32Array(0)
    this.inLeft = new Float32Array(0)
    this.inRight = new Float32Array(0)

    this.port.onmessage = (event: MessageEvent<ProcessorMessage>) => {
      this.handleMessage(event.data)
    }
    this.port.postMessage({
      type: 'ready',
      deviceId: processorOptions.deviceId ?? 'ambient-instrument',
      maxBlockFrames: this.maxBlockFrames,
    })
  }

  private handleMessage(message: ProcessorMessage): void {
    switch (message.type) {
      case 'set-param':
        this.engine.device_set_param(message.paramId, message.value)
        break
      case 'bypass':
        this.bypassTarget = message.enabled ? 1 : 0
        break
      case 'note-on':
        this.engine.device_note_on(message.noteId, message.frequency, message.gain)
        break
      case 'note-off':
        this.engine.device_note_off(message.noteId)
        break
      case 'load-sample': {
        // Copying into the WASM heap allocates a view; this runs in the
        // message handler between render quanta, never inside process().
        const capacity = this.engine.instrument_sample_capacity_frames()
        const frames = Math.min(message.frames, capacity)
        const floats = frames * message.channels
        const heap = new Float32Array(
          this.engine.memory.buffer,
          this.engine.instrument_sample_buffer(),
          floats,
        )
        heap.set(message.pcm.subarray(0, floats))
        this.engine.instrument_sample_loaded(frames, message.channels)
        break
      }
      case 'play-sample':
        this.engine.instrument_sample_play()
        break
      case 'stop-sample':
        this.engine.instrument_sample_stop()
        break
      default: {
        const unhandled: never = message
        throw new Error(`Unhandled instrument message: ${JSON.stringify(unhandled)}`)
      }
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]
    if (!output || output.length === 0) return true
    const frames = Math.min(output[0].length, this.maxBlockFrames)

    if (this.outLeft.length !== frames) {
      const memory = this.engine.memory.buffer
      this.outLeft = new Float32Array(memory, this.engine.device_out_left(), frames)
      this.outRight = new Float32Array(memory, this.engine.device_out_right(), frames)
      this.inLeft = new Float32Array(memory, this.engine.device_in_left(), frames)
      this.inRight = new Float32Array(memory, this.engine.device_in_right(), frames)
      this.dryLeft = new Float32Array(frames)
      this.dryRight = new Float32Array(frames)
    }

    // A disconnected input is an empty array; the core clears the bus each
    // block, so silence needs no work here.
    const input = inputs[0]
    if (input !== undefined && input.length > 0) {
      const left = input[0].subarray(0, frames)
      const right = (input.length > 1 ? input[1] : input[0]).subarray(0, frames)
      this.inLeft.set(left)
      this.inRight.set(right)
      this.dryLeft.set(left)
      this.dryRight.set(right)
    } else {
      this.dryLeft.fill(0)
      this.dryRight.fill(0)
    }

    this.engine.device_process(frames)

    const outLeft = output[0]
    const outRight = output.length > 1 ? output[1] : null
    if (this.bypassMix === this.bypassTarget && this.bypassMix === 0) {
      outLeft.set(this.outLeft)
      outRight?.set(this.outRight)
      return true
    }
    for (let i = 0; i < frames; i += 1) {
      if (this.bypassMix < this.bypassTarget) {
        this.bypassMix = Math.min(this.bypassTarget, this.bypassMix + this.bypassStep)
      } else if (this.bypassMix > this.bypassTarget) {
        this.bypassMix = Math.max(this.bypassTarget, this.bypassMix - this.bypassStep)
      }
      const wet = 1 - this.bypassMix
      outLeft[i] = this.outLeft[i] * wet + this.dryLeft[i] * this.bypassMix
      if (outRight) outRight[i] = this.outRight[i] * wet + this.dryRight[i] * this.bypassMix
    }
    return true
  }
}

registerProcessor(INSTRUMENT_PROCESSOR_NAME, AmbientInstrumentProcessor)
