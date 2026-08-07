// Main-thread wrapper around the AudioWorklet-hosted WASM core.
//
// Boundary rule (plan KTD-8 / R16): this module owns the whole audio stack
// and imports nothing from Inertia, pages, or server-derived state. The UI
// calls methods; nothing here reads props.

import type { EngineMessage, ParamId } from './messages'
import processorUrl from './engine-processor?worker&url'
import wasmUrl from './engine.wasm?url'

export class AudioEngine {
  private readonly context: AudioContext
  private readonly node: AudioWorkletNode
  private readonly analyser: AnalyserNode
  private readonly meterBuffer: Float32Array<ArrayBuffer>

  private constructor(context: AudioContext, node: AudioWorkletNode, analyser: AnalyserNode) {
    this.context = context
    this.node = node
    this.analyser = analyser
    this.meterBuffer = new Float32Array(analyser.fftSize)
  }

  // Must be called from a user gesture so the AudioContext can start.
  static async start(): Promise<AudioEngine> {
    const context = new AudioContext()
    await context.resume()

    const [module] = await Promise.all([
      WebAssembly.compileStreaming(fetch(wasmUrl)),
      context.audioWorklet.addModule(processorUrl),
    ])

    const node = new AudioWorkletNode(context, 'ambient-engine', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { module },
    })

    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    node.connect(analyser)
    analyser.connect(context.destination)

    return new AudioEngine(context, node, analyser)
  }

  noteOn(noteId: number, frequency: number, gain = 0.5): void {
    this.post({ type: 'note-on', noteId, frequency, gain })
  }

  noteOff(noteId: number): void {
    this.post({ type: 'note-off', noteId })
  }

  setParam(paramId: ParamId, value: number): void {
    this.post({ type: 'set-param', paramId, value })
  }

  // Decodes an audio file with the browser's decoder and ships raw PCM to the
  // core, which stays codec-free (plan KTD-6 / R17).
  async decodeAndLoadSample(encoded: ArrayBuffer): Promise<{ durationSec: number }> {
    const audioBuffer = await this.context.decodeAudioData(encoded)
    const frames = audioBuffer.length
    const channels: 1 | 2 = audioBuffer.numberOfChannels >= 2 ? 2 : 1

    let pcm: Float32Array
    if (channels === 2) {
      const left = audioBuffer.getChannelData(0)
      const right = audioBuffer.getChannelData(1)
      pcm = new Float32Array(frames * 2)
      for (let i = 0; i < frames; i++) {
        pcm[i * 2] = left[i]
        pcm[i * 2 + 1] = right[i]
      }
    } else {
      pcm = new Float32Array(audioBuffer.getChannelData(0))
    }

    this.node.port.postMessage(
      { type: 'load-sample', frames, channels, pcm } satisfies EngineMessage,
      [pcm.buffer],
    )

    return { durationSec: audioBuffer.duration }
  }

  playSample(): void {
    this.post({ type: 'play-sample' })
  }

  stopSample(): void {
    this.post({ type: 'stop-sample' })
  }

  // Peak level of the current output window, 0..1 — the UI meter's signal.
  outputLevel(): number {
    this.analyser.getFloatTimeDomainData(this.meterBuffer)
    let peak = 0
    for (const value of this.meterBuffer) {
      const magnitude = Math.abs(value)
      if (magnitude > peak) peak = magnitude
    }
    return Math.min(peak, 1)
  }

  async close(): Promise<void> {
    this.node.disconnect()
    this.analyser.disconnect()
    await this.context.close()
  }

  private post(message: EngineMessage): void {
    this.node.port.postMessage(message)
  }
}

export { PARAM } from './messages'
export type { ParamId } from './messages'
