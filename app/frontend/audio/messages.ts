// Port protocol between the main-thread Instrument wrapper and the app-local
// AudioWorklet processor, on top of live-mix's device messages (set-param,
// bypass, note-on, note-off). Keep this file dependency-free at runtime: the
// processor imports it type-only so the worklet script stays self-contained.

import type { DeviceExports, DeviceMessage } from '@kieranklaassen/live-mix/dsp'

export const PARAM = {
  gain: 0,
} as const

/** Registered name of the app-local worklet processor (instrument-processor.ts). */
export const INSTRUMENT_PROCESSOR_NAME = 'ambient-instrument'

export type ParamId = (typeof PARAM)[keyof typeof PARAM]

/** The instrument's own messages, beside the library's DeviceMessage set. */
export type InstrumentMessage =
  | { type: 'load-sample'; frames: number; channels: 1 | 2; pcm: Float32Array }
  | { type: 'play-sample' }
  | { type: 'stop-sample' }

export type ProcessorMessage = DeviceMessage | InstrumentMessage

// The flat C ABI exported by engine.wasm (see engine/src/api.cpp): the
// live-mix device ABI plus the sample-audition extras.
export interface InstrumentExports extends DeviceExports {
  device_note_on: (noteId: number, frequency: number, gain: number) => void
  device_note_off: (noteId: number) => void
  instrument_sample_buffer: () => number
  instrument_sample_capacity_frames: () => number
  instrument_sample_loaded: (frames: number, channels: number) => void
  instrument_sample_play: () => void
  instrument_sample_stop: () => void
  instrument_sample_playing: () => number
}
