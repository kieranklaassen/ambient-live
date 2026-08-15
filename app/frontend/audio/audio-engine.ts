// Main-thread wrapper around the AudioWorklet-hosted WASM core.
//
// Boundary rule (plan KTD-8 / R16): this module owns the whole audio stack
// and imports nothing from Inertia, pages, or server-derived state. The UI
// calls methods; nothing here reads props.

import type { EngineMessage, ParamId } from './messages'
import processorUrl from './engine-processor?worker&url'
import wasmUrl from './engine.wasm?url'
import { computePeaks, type WaveformPeaks } from './waveform'

/** A decoded sample, kept for waveform drawing and clip playback. */
export interface LoadedSample {
  audioBuffer: AudioBuffer
  durationSec: number
  peaks: WaveformPeaks
}

export class AudioEngine {
  private readonly context: AudioContext
  private readonly node: AudioWorkletNode
  private readonly analyser: AnalyserNode
  private readonly meterBuffer: Float32Array<ArrayBuffer>
  private readonly samples = new Map<number, LoadedSample>()
  // Which sample currently occupies the core's single audition voice.
  private voiceSampleId: number | null = null

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

  // Decodes an audio file with the browser's decoder and keeps the result:
  // the peaks draw the clip, the buffer feeds clip playback, and the raw PCM
  // is what the codec-free core receives (plan KTD-6 / R17). Decoding runs on
  // the engine's context so the PCM is already at the core's sample rate.
  async loadSample(sampleId: number, encoded: ArrayBuffer): Promise<LoadedSample> {
    const cached = this.samples.get(sampleId)
    if (cached) return cached

    const audioBuffer = await this.context.decodeAudioData(encoded)
    const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) =>
      audioBuffer.getChannelData(index),
    )
    const loaded: LoadedSample = {
      audioBuffer,
      durationSec: audioBuffer.duration,
      peaks: computePeaks(channels, audioBuffer.length),
    }
    this.samples.set(sampleId, loaded)
    return loaded
  }

  sample(sampleId: number): LoadedSample | undefined {
    return this.samples.get(sampleId)
  }

  forgetSample(sampleId: number): void {
    this.samples.delete(sampleId)
    if (this.voiceSampleId === sampleId) this.voiceSampleId = null
  }

  /** Auditions a loaded sample through the core's single sample voice. */
  playSample(sampleId: number): void {
    const loaded = this.samples.get(sampleId)
    if (!loaded) return
    if (this.voiceSampleId !== sampleId) {
      this.sendSampleToVoice(loaded.audioBuffer)
      this.voiceSampleId = sampleId
    }
    this.post({ type: 'play-sample' })
  }

  stopSample(): void {
    this.post({ type: 'stop-sample' })
  }

  private sendSampleToVoice(audioBuffer: AudioBuffer): void {
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
    this.samples.clear()
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
