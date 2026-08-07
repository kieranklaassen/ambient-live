import type { ParamId } from '@/audio/audio-engine'

import Keyboard from './keyboard'
import MidiControls from './midi-controls'
import ReverbControls, { type ReverbSettings } from './reverb-controls'

interface DeviceStripProps {
  enabled: boolean
  settings: ReverbSettings
  onChange: (field: keyof ReverbSettings, param: ParamId, value: number) => void
  onNoteOn: (noteId: number, frequency: number) => void
  onMidiNoteOn: (noteId: number, frequency: number, gain: number) => void
  onNoteOff: (noteId: number) => void
}

export default function DeviceStrip({
  enabled,
  settings,
  onChange,
  onNoteOn,
  onMidiNoteOn,
  onNoteOff,
}: DeviceStripProps) {
  return (
    <section
      className="shrink-0 border-t border-zinc-800 bg-zinc-950"
      data-testid="device-strip"
      aria-label="Devices"
    >
      <div className="flex items-center justify-between border-b border-zinc-900 px-4 py-2">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">Devices</h2>
        <p className="text-[11px] text-zinc-600">Built-in only — reverb + play surfaces</p>
      </div>

      <div className="grid gap-4 px-4 py-3 lg:grid-cols-[minmax(16rem,22rem)_1fr_minmax(12rem,16rem)] lg:items-end">
        <div className="min-w-0">
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
            Reverb
          </h3>
          <ReverbControls enabled={enabled} settings={settings} onChange={onChange} compact />
        </div>

        <div className="min-w-0 overflow-x-auto">
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
            Keyboard
          </h3>
          <Keyboard enabled={enabled} onNoteOn={onNoteOn} onNoteOff={onNoteOff} compact />
          <p className="mt-1 text-[11px] text-zinc-600">
            Hold keys (pointer or marked computer keys) — releases fade into the reverb tail.
          </p>
        </div>

        <div className="min-w-0">
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
            MIDI
          </h3>
          <MidiControls enabled={enabled} onNoteOn={onMidiNoteOn} onNoteOff={onNoteOff} />
        </div>
      </div>
    </section>
  )
}
