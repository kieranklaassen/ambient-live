// Main-thread wrapper around the live-mix engine for the workstation page.
//
// Boundary rule (plan KTD-8 / R16): this module owns the whole audio stack
// and imports nothing from Inertia, pages, or server-derived state. The UI
// calls methods; nothing here reads props.
//
// Signal flow (same sound as the former in-app engine, restructured):
//   synth (InstrumentTrack) ─┐
//   timeline clips (AudioTrack) ─┴→ master fader (0.8) → Dattorro plate → meter → destination

import {
  createEngine,
  type AudioTrack,
  type Engine,
  type InstrumentTrack,
  type LoadedSample,
} from '@kieranklaassen/live-mix'
import {
  createDattorroReverb,
  type DattorroReverb,
  type WasmDeviceOptions,
} from '@kieranklaassen/live-mix/dsp'

import {
  createInstrument,
  loadSampleIntoInstrument,
  playInstrumentSample,
  stopInstrumentSample,
  type InstrumentDevice,
  type InstrumentParams,
} from './instrument'

export type { LoadedSample }

/** The loop the timeline paints onto, in seconds. */
export const LOOP_LENGTH_SEC = 32
/** How far ahead of the audio clock clip starts are handed to the graph. */
export const SCHEDULE_LOOKAHEAD_SEC = 0.2
export const SCHEDULE_TICK_MS = 40
export const DEFAULT_MASTER_GAIN = 0.8

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
  readonly plate: DattorroReverb
  private readonly instrument: InstrumentDevice
  // Which sample currently occupies the core's single audition voice.
  private voiceSampleId: number | null = null

  private constructor(
    context: AudioContext,
    engine: Engine,
    synth: InstrumentTrack,
    clips: AudioTrack,
    plate: DattorroReverb,
    instrument: InstrumentDevice,
  ) {
    this.context = context
    this.engine = engine
    this.synth = synth
    this.clips = clips
    this.plate = plate
    this.instrument = instrument
  }

  // Must be called from a user gesture so the AudioContext can start.
  static async start(): Promise<LiveEngine> {
    const context = new AudioContext()
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

    return new LiveEngine(context, engine, synth, clips, plate, instrument)
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
    this.engine.dispose()
    await this.context.close()
  }
}

