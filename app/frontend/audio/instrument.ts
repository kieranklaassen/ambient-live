// The app's synth as a live-mix WasmDevice: engine.wasm hosted by the
// app-local processor (sine voices, sample audition voice). Boundary rule
// (plan KTD-8 / R16): this module imports nothing from Inertia, pages, or
// server-derived state.

import {
  WasmDevice,
  defineWasmDevice,
  type ParamSpec,
  type WasmDeviceOptions,
} from '@kieranklaassen/live-mix/dsp'

import processorUrl from './instrument-processor?worker&url'
import wasmUrl from './engine.wasm?url'
import { INSTRUMENT_PROCESSOR_NAME, PARAM, type InstrumentMessage } from './messages'

export const INSTRUMENT_PARAMS = {
  gain: { id: PARAM.gain, name: 'Gain', min: 0, max: 2, default: 1, taper: 'linear', unit: '' },
} as const satisfies Record<string, ParamSpec>

export const INSTRUMENT_DEVICE = defineWasmDevice({
  id: 'ambient-instrument',
  wasm: () => wasmUrl,
  params: INSTRUMENT_PARAMS,
  processor: { name: INSTRUMENT_PROCESSOR_NAME, url: () => processorUrl },
})

export type InstrumentParams = typeof INSTRUMENT_PARAMS
export type InstrumentDevice = WasmDevice<InstrumentParams>

/** Ships decoded PCM to the core's single audition voice (codec-free core, plan KTD-6 / R17). */
export function loadSampleIntoInstrument(device: InstrumentDevice, audioBuffer: AudioBuffer): void {
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

  device.postMessage(
    { type: 'load-sample', frames, channels, pcm } satisfies InstrumentMessage,
    [pcm.buffer],
  )
}

export function playInstrumentSample(device: InstrumentDevice): void {
  device.postMessage({ type: 'play-sample' } satisfies InstrumentMessage)
}

export function stopInstrumentSample(device: InstrumentDevice): void {
  device.postMessage({ type: 'stop-sample' } satisfies InstrumentMessage)
}

export function createInstrument(
  context: BaseAudioContext,
  options: WasmDeviceOptions<InstrumentParams> = {},
): Promise<InstrumentDevice> {
  return WasmDevice.create(context, INSTRUMENT_DEVICE, options)
}
