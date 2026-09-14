import type { CSSProperties, ReactNode } from 'react'

import type { ControlSurface } from '@kieranklaassen/live-mix'
import { DeviceFrame } from '@kieranklaassen/live-mix/react'

import type { ContextLatency } from '@/audio/latency'
import type { RoundTripMeasurement } from '@/audio/latency-probe'
import Keyboard from './keyboard'
import LiveInputControls, { type LiveInputState } from './live-input-controls'
import MidiControls from './midi-controls'
import MidiMapPanel from './midi-map-panel'
import ReverbControls, { MasterControls, type ReverbSettings } from './reverb-controls'

export interface LiveInputPanelProps {
  input: LiveInputState
  latency: ContextLatency | null
  measurement: RoundTripMeasurement | null
  measuring: boolean
  measureError: string | null
  onInputEnabledChange: (enabled: boolean) => void
  onMonitorChange: (monitor: boolean) => void
  onLevelChange: (level: number) => void
  onPanChange: (pan: number) => void
  onMeasure: () => void
}

interface DeviceStripProps {
  enabled: boolean
  settings: ReverbSettings
  onChange: (field: keyof ReverbSettings, value: number) => void
  onNoteOn: (noteId: number, frequency: number) => void
  onMidiNoteOn: (noteId: number, frequency: number, gain: number) => void
  onNoteOff: (noteId: number) => void
  /** Where MIDI control events land; the map panel edits its table. */
  surface: ControlSurface
  liveInput: LiveInputPanelProps
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

export default function DeviceStrip({
  enabled,
  settings,
  onChange,
  onNoteOn,
  onMidiNoteOn,
  onNoteOff,
  surface,
  liveInput,
  className = '',
  style,
  children,
}: DeviceStripProps) {
  return (
    <section
      className={`workstation-region border-t border-al-border bg-al-panel ${className}`}
      style={style}
      data-testid="device-strip"
      data-fill-block-end=""
      aria-label="Devices"
    >
      {children}
      <div className="grid h-full min-h-0 gap-px overflow-auto bg-al-border lg:grid-cols-[minmax(18rem,21rem)_1fr_minmax(12rem,17rem)_minmax(11rem,14rem)_minmax(9rem,12rem)]">
        <div className="min-w-0 bg-al-raised sg-p-1">
          <ReverbControls enabled={enabled} settings={settings} onChange={onChange} />
        </div>
        <div className="min-w-0 overflow-x-auto bg-al-raised sg-p-1">
          <DeviceFrame title="Keyboard" data-testid="device-keyboard">
            <Keyboard enabled={enabled} onNoteOn={onNoteOn} onNoteOff={onNoteOff} compact />
          </DeviceFrame>
        </div>
        <div className="min-w-0 bg-al-raised sg-p-1">
          <DeviceFrame title="MIDI" data-testid="device-midi">
            <MidiControls
              enabled={enabled}
              surface={surface}
              onNoteOn={onMidiNoteOn}
              onNoteOff={onNoteOff}
            >
              <MidiMapPanel enabled={enabled} surface={surface} />
            </MidiControls>
          </DeviceFrame>
        </div>
        <div className="min-w-0 bg-al-raised sg-p-1">
          <LiveInputControls enabled={enabled} {...liveInput} />
        </div>
        <div className="min-w-0 bg-al-raised sg-p-1">
          <MasterControls enabled={enabled} settings={settings} onChange={onChange} />
        </div>
      </div>
    </section>
  )
}
