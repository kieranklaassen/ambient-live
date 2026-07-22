// Port protocol between the main-thread AudioEngine wrapper and the
// AudioWorklet processor. Keep this file dependency-free: the processor
// imports it type-only so the worklet script stays self-contained.

export const PARAM = {
  reverbMix: 0,
  reverbDecay: 1,
  reverbDamping: 2,
  reverbPredelayMs: 3,
  masterGain: 4,
} as const

export type ParamId = (typeof PARAM)[keyof typeof PARAM]

export type EngineMessage =
  | { type: 'note-on'; noteId: number; frequency: number; gain: number }
  | { type: 'note-off'; noteId: number }
  | { type: 'set-param'; paramId: ParamId; value: number }
  | { type: 'load-sample'; frames: number; channels: 1 | 2; pcm: Float32Array }
  | { type: 'play-sample' }
  | { type: 'stop-sample' }

// The flat C ABI exported by engine.wasm (see engine/src/api.cpp).
export interface EngineExports {
  memory: WebAssembly.Memory
  _initialize?: () => void
  engine_init: (sampleRate: number) => void
  engine_note_on: (noteId: number, frequency: number, gain: number) => void
  engine_note_off: (noteId: number) => void
  engine_set_param: (paramId: number, value: number) => void
  engine_sample_buffer: () => number
  engine_sample_capacity_frames: () => number
  engine_sample_loaded: (frames: number, channels: number) => void
  engine_sample_play: () => void
  engine_sample_stop: () => void
  engine_sample_playing: () => number
  engine_process: (frames: number) => void
  engine_out_left: () => number
  engine_out_right: () => number
}
