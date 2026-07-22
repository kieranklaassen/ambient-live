// AudioWorklet processor hosting the WASM DSP core. The compiled
// WebAssembly.Module arrives via processorOptions (a Module transfers across
// threads; an Instance does not — plan KTD-3) and is instantiated
// synchronously here, before audio starts flowing.
//
// This file runs in the AudioWorkletGlobalScope: keep it free of runtime
// imports so it works both as a dev-served module and a bundled worker chunk.

import type { EngineExports, EngineMessage } from './messages'

class AmbientEngineProcessor extends AudioWorkletProcessor {
  private readonly engine: EngineExports
  private outLeft: Float32Array
  private outRight: Float32Array

  constructor(options?: AudioWorkletNodeOptions) {
    super()
    const module = options?.processorOptions?.module as WebAssembly.Module
    const instance = new WebAssembly.Instance(module, {})
    this.engine = instance.exports as unknown as EngineExports
    this.engine._initialize?.()
    this.engine.engine_init(sampleRate)

    // Memory is fixed-size (no growth), so heap views stay valid for the
    // processor's lifetime; process() itself never allocates.
    this.outLeft = new Float32Array(0)
    this.outRight = new Float32Array(0)

    this.port.onmessage = (event: MessageEvent<EngineMessage>) => {
      this.handleMessage(event.data)
    }
  }

  private handleMessage(message: EngineMessage): void {
    switch (message.type) {
      case 'note-on':
        this.engine.engine_note_on(message.noteId, message.frequency, message.gain)
        break
      case 'note-off':
        this.engine.engine_note_off(message.noteId)
        break
      case 'set-param':
        this.engine.engine_set_param(message.paramId, message.value)
        break
      case 'load-sample': {
        // Copying into the WASM heap allocates a view; this runs in the
        // message handler between render quanta, never inside process().
        const capacity = this.engine.engine_sample_capacity_frames()
        const frames = Math.min(message.frames, capacity)
        const floats = frames * message.channels
        const heap = new Float32Array(
          this.engine.memory.buffer,
          this.engine.engine_sample_buffer(),
          floats,
        )
        heap.set(message.pcm.subarray(0, floats))
        this.engine.engine_sample_loaded(frames, message.channels)
        break
      }
      case 'play-sample':
        this.engine.engine_sample_play()
        break
      case 'stop-sample':
        this.engine.engine_sample_stop()
        break
      default: {
        const unhandled: never = message
        throw new Error(`Unhandled engine message: ${JSON.stringify(unhandled)}`)
      }
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]
    const frames = output[0].length

    this.engine.engine_process(frames)

    if (this.outLeft.length !== frames) {
      this.outLeft = new Float32Array(this.engine.memory.buffer, this.engine.engine_out_left(), frames)
      this.outRight = new Float32Array(this.engine.memory.buffer, this.engine.engine_out_right(), frames)
    }
    output[0].set(this.outLeft)
    if (output.length > 1) output[1].set(this.outRight)

    return true
  }
}

registerProcessor('ambient-engine', AmbientEngineProcessor)
