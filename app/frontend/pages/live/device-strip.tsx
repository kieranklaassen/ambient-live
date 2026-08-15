import type { CSSProperties, ReactNode } from 'react'

import type { ParamId } from '@/audio/audio-engine'
import { DevicePanel } from '@/components/daw'
import Keyboard from './keyboard'
import MidiControls from './midi-controls'
import ReverbControls, { MasterControls, type ReverbSettings } from './reverb-controls'

interface DeviceStripProps {
  enabled: boolean
  settings: ReverbSettings
  onChange: (field: keyof ReverbSettings, param: ParamId, value: number) => void
  onNoteOn: (noteId: number, frequency: number) => void
  onMidiNoteOn: (noteId: number, frequency: number, gain: number) => void
  onNoteOff: (noteId: number) => void
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

export default function DeviceStrip({ enabled, settings, onChange, onNoteOn, onMidiNoteOn, onNoteOff, className = '', style, children }: DeviceStripProps) {
  return (
    <section
      className={`workstation-region border-t border-al-border bg-al-panel ${className}`}
      style={style}
      data-testid="device-strip"
      data-fill-block-end=""
      aria-label="Devices"
    >
      {children}
      <div className="grid h-full min-h-0 gap-px overflow-auto bg-al-border lg:grid-cols-[minmax(18rem,21rem)_1fr_minmax(9rem,13rem)_minmax(9rem,12rem)]">
        <div className="min-w-0 bg-al-raised sg-p-1">
          <ReverbControls enabled={enabled} settings={settings} onChange={onChange} />
        </div>
        <div className="min-w-0 overflow-x-auto bg-al-raised sg-p-1">
          <DevicePanel title="Keyboard" data-testid="device-keyboard">
            <Keyboard enabled={enabled} onNoteOn={onNoteOn} onNoteOff={onNoteOff} compact />
          </DevicePanel>
        </div>
        <div className="min-w-0 bg-al-raised sg-p-1">
          <DevicePanel title="MIDI" data-testid="device-midi">
            <MidiControls enabled={enabled} onNoteOn={onMidiNoteOn} onNoteOff={onNoteOff} />
          </DevicePanel>
        </div>
        <div className="min-w-0 bg-al-raised sg-p-1">
          <MasterControls enabled={enabled} settings={settings} onChange={onChange} />
        </div>
      </div>
    </section>
  )
}
