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
  className?: string
}

export default function DeviceStrip({ enabled, settings, onChange, onNoteOn, onMidiNoteOn, onNoteOff, className = '' }: DeviceStripProps) {
  return (
    <section className={`workstation-region border-t border-al-border bg-al-panel ${className}`} data-testid="device-strip" aria-label="Devices">
      <div className="flex items-center justify-between border-b border-al-border px-sg-2 py-sg-1">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.14em] text-al-muted sg-leading-2">Devices</h2>
        <p className="text-[10px] uppercase tracking-wide text-al-dim sg-leading-2">Built-in — reverb + play surfaces</p>
      </div>
      <div className="grid h-[calc(100%-24px)] min-h-0 gap-px overflow-auto bg-al-border lg:grid-cols-[minmax(15rem,20rem)_1fr_minmax(11rem,15rem)]">
        <div className="min-w-0 bg-al-raised sg-p-1">
          <h3 className="mb-sg-1 text-[10px] font-medium uppercase tracking-[0.12em] text-al-muted">Reverb</h3>
          <ReverbControls enabled={enabled} settings={settings} onChange={onChange} compact />
        </div>
        <div className="min-w-0 overflow-x-auto bg-al-raised sg-p-1">
          <h3 className="mb-sg-1 text-[10px] font-medium uppercase tracking-[0.12em] text-al-muted">Keyboard</h3>
          <Keyboard enabled={enabled} onNoteOn={onNoteOn} onNoteOff={onNoteOff} compact />
        </div>
        <div className="min-w-0 bg-al-raised sg-p-1">
          <h3 className="mb-sg-1 text-[10px] font-medium uppercase tracking-[0.12em] text-al-muted">MIDI</h3>
          <MidiControls enabled={enabled} onNoteOn={onMidiNoteOn} onNoteOff={onNoteOff} />
        </div>
      </div>
    </section>
  )
}
