// Main-thread wrapper around the live-mix engine for the workstation page.
//
// Boundary rule (plan KTD-8 / R16): this module owns the whole audio stack
// and imports nothing from Inertia, pages, or server-derived state. The UI
// calls methods; nothing here reads props.
//
// Signal flow (same sound as the former in-app engine, restructured):
//   synth (InstrumentTrack) ─┐
//   timeline clips (AudioTrack) ─┼→ master fader (0.8) → Dattorro plate → meter → destination
//   live input (LiveInputTrack) ─┘  (getUserMedia, monitoring through the same mix)

import {
  createEngine,
  type AudioTrack,
  type Engine,
  type InstrumentTrack,
  type LiveInputTrack,
  type LoadedSample,
} from '@kieranklaassen/live-mix'
import {
  createDattorroReverb,
  type DattorroReverb,
  type WasmDeviceOptions,
} from '@kieranklaassen/live-mix/dsp'

import { controlTarget, type ControlTargetId } from './control-targets'
import {
  createInstrument,
  loadSampleIntoInstrument,
  playInstrumentSample,
  stopInstrumentSample,
  type InstrumentDevice,
  type InstrumentParams,
} from './instrument'
import { describeContextLatency, type ContextLatency } from './latency'
import {
  measureRoundTrip,
  type MeasureRoundTripOptions,
  type RoundTripMeasurement,
} from './latency-probe'

export type { LoadedSample }

/** The loop the timeline paints onto, in seconds. */
export const LOOP_LENGTH_SEC = 32
/** How far ahead of the audio clock clip starts are handed to the graph. */
export const SCHEDULE_LOOKAHEAD_SEC = 0.2
export const SCHEDULE_TICK_MS = 40
export const DEFAULT_MASTER_GAIN = controlTarget('master.gain').default

/**
 * Microphone/instrument capture for monitoring: the browser's voice processing
 * would colour and delay an instrument, so it is off; the context's
 * `interactive` hint asks for the smallest output buffer the device allows.
 */
export const LIVE_INPUT_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  video: false,
}

export type ReverbParam = 'mix' | 'decay' | 'damping' | 'predelayMs'

/** Device-loading overrides (tests pass compiled modules and a mock node factory). */
export interface LiveEngineDeviceOptions {
  instrument?: WasmDeviceOptions<InstrumentParams>
  plate?: Parameters<typeof createDattorroReverb>[1]
}

export class LiveEngine {
  readonly context: AudioContext
  readonly engine: Engine
  readonly synth: InstrumentTrack
  readonly clips: AudioTrack
  /** Live input (mic/instrument); node-free until a stream is attached. */
  readonly input: LiveInputTrack
  readonly plate: DattorroReverb
  private readonly instrument: InstrumentDevice
  // Which sample currently occupies the core's single audition voice.
  private voiceSampleId: number | null = null
  private inputStream: MediaStream | null = null

  private constructor(
    context: AudioContext,
    engine: Engine,
    synth: InstrumentTrack,
    clips: AudioTrack,
    input: LiveInputTrack,
    plate: DattorroReverb,
    instrument: InstrumentDevice,
  ) {
    this.context = context
    this.engine = engine
    this.synth = synth
    this.clips = clips
    this.input = input
    this.plate = plate
    this.instrument = instrument
  }

  // Must be called from a user gesture so the AudioContext can start.
  static async start(): Promise<LiveEngine> {
    const context = new AudioContext({ latencyHint: 'interactive' })
    await context.resume()
    return LiveEngine.create(context)
  }

  /** Builds the graph on an existing context (what `start` does after creating one). */
  static async create(
    context: AudioContext,
    devices: LiveEngineDeviceOptions = {},
  ): Promise<LiveEngine> {
    const engine = createEngine({
      context,
      master: { gain: DEFAULT_MASTER_GAIN, meter: true },
      samples: { peaks: true },
      loop: { enabled: true, lengthSec: LOOP_LENGTH_SEC },
      tickMs: SCHEDULE_TICK_MS,
    })
    const [instrument, plate] = await Promise.all([
      createInstrument(context, devices.instrument),
      createDattorroReverb(context, devices.plate),
    ])
    const synth = engine.addInstrumentTrack('synth', { device: instrument })
    engine.master.addInsert(plate)
    const clips = engine.addAudioTrack('clips', { lookaheadSec: SCHEDULE_LOOKAHEAD_SEC })
    const input = engine.addLiveInputTrack('input')

    return new LiveEngine(context, engine, synth, clips, input, plate, instrument)
  }

  noteOn(noteId: number, frequency: number, gain = 0.5): void {
    this.synth.noteOn(noteId, frequency, gain)
  }

  noteOff(noteId: number): void {
    this.synth.noteOff(noteId)
  }

  setReverbParam(param: ReverbParam, value: number): void {
    this.plate.setParam(param, value)
  }

  setMasterGain(value: number): void {
    this.engine.master.setLevel(value)
  }

  /**
   * Apply a mapped control (MIDI or otherwise). Every path ramps: WASM params
   * ramp inside the device host, strip moves are `setTargetAtTime` at 5 ms.
   */
  applyControl(id: ControlTargetId, value: number): void {
    switch (id) {
      case 'reverb.mix':
        this.setReverbParam('mix', value)
        return
      case 'reverb.decay':
        this.setReverbParam('decay', value)
        return
      case 'reverb.damping':
        this.setReverbParam('damping', value)
        return
      case 'reverb.predelayMs':
        this.setReverbParam('predelayMs', value)
        return
      case 'master.gain':
        this.setMasterGain(value)
        return
      case 'synth.level':
        this.synth.strip.setLevel(value)
        return
      case 'synth.pan':
        this.synth.strip.setPan(value)
        return
      case 'clips.level':
        this.clips.strip.setLevel(value)
        return
      case 'clips.pan':
        this.clips.strip.setPan(value)
        return
      case 'input.level':
        this.input.strip.setLevel(value)
        return
      case 'input.pan':
        this.input.strip.setPan(value)
        return
      case 'input.monitor':
        this.setLiveInputMonitor(value >= 0.5)
        return
      default: {
        const _exhaustive: never = id
        return _exhaustive
      }
    }
  }

  // Live input ---------------------------------------------------------------

  /** Route a captured stream into the mix; a second call replaces the first. */
  enableLiveInput(stream: MediaStream): void {
    this.stopInputStream()
    this.inputStream = stream
    this.input.attach(stream)
  }

  /** Unwire the live input and release the capture device. */
  disableLiveInput(): void {
    this.input.detach()
    this.stopInputStream()
  }

  get liveInputEnabled(): boolean {
    return this.input.source !== null
  }

  /** Hear the input or not; the strip's gate ramps, so no clicks. */
  setLiveInputMonitor(enabled: boolean): void {
    this.input.strip.setMute(!enabled)
  }

  get liveInputMonitor(): boolean {
    return !this.input.strip.mute
  }

  /** What the context reports about its own buffering. */
  latency(): ContextLatency {
    return describeContextLatency(this.context)
  }

  /**
   * Play a chirp and time its return through the live input (speakers → mic
   * or a loopback cable). Requires an enabled input.
   */
  measureRoundTripLatency(
    options: Omit<MeasureRoundTripOptions, 'context' | 'input'> = {},
  ): Promise<RoundTripMeasurement> {
    const source = this.input.source
    if (!source) return Promise.reject(new Error('Enable the live input before measuring'))
    return measureRoundTrip({ context: this.context, input: source, ...options })
  }

  private stopInputStream(): void {
    const stream = this.inputStream
    if (!stream) return
    this.inputStream = null
    for (const track of stream.getTracks()) track.stop()
  }

  // Decodes an audio file with the browser's decoder and keeps the result:
  // the peaks draw the clip, the buffer feeds clip playback, and the raw PCM
  // is what the codec-free core receives when auditioned. Decoding runs on
  // the engine's context so the PCM is already at the core's sample rate.
  loadSample(sampleId: number, encoded: ArrayBuffer): Promise<LoadedSample> {
    return this.engine.samples.load(String(sampleId), encoded)
  }

  sample(sampleId: number): LoadedSample | undefined {
    return this.engine.samples.get(String(sampleId))
  }

  forgetSample(sampleId: number): void {
    this.engine.samples.forget(String(sampleId))
    if (this.voiceSampleId === sampleId) this.voiceSampleId = null
  }

  /** Auditions a loaded sample through the core's single sample voice. */
  playSample(sampleId: number): void {
    const loaded = this.sample(sampleId)
    if (!loaded) return
    if (this.voiceSampleId !== sampleId) {
      loadSampleIntoInstrument(this.instrument, loaded.buffer)
      this.voiceSampleId = sampleId
    }
    playInstrumentSample(this.instrument)
  }

  stopSample(): void {
    stopInstrumentSample(this.instrument)
  }

  /** Clock the timeline schedules against. */
  get currentTime(): number {
    return this.context.currentTime
  }

  /** Peak level of the current output window, 0..1 — the UI meter's signal. */
  outputLevel(): number {
    return this.engine.master.level()
  }

  async close(): Promise<void> {
    this.stopInputStream()
    this.engine.dispose()
    await this.context.close()
  }
}

