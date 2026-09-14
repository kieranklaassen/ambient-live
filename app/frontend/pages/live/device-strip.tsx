import type { CSSProperties, ReactNode } from 'react'

import { DevicePanel } from '@/components/daw'
import type { ContextLatency } from '@/audio/latency'
import type { RoundTripMeasurement } from '@/audio/latency-probe'
import type { MidiEvent } from '@/audio/midi'
import Keyboard from './keyboard'
import LiveInputControls, { type LiveInputState } from './live-input-controls'
import MidiControls from './midi-controls'
import MidiMapPanel from './midi-map-panel'
import ReverbControls, { MasterControls, type ReverbSettings } from './reverb-controls'
import type { MidiMapController } from './use-midi-map'

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
  onMidiEvent: (event: MidiEvent) => boolean
  midiMap: MidiMapController
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
  onMidiEvent,
  midiMap,
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
          <DevicePanel title="Keyboard" data-testid="device-keyboard">
            <Keyboard enabled={enabled} onNoteOn={onNoteOn} onNoteOff={onNoteOff} compact />
          </DevicePanel>
        </div>
        <div className="min-w-0 bg-al-raised sg-p-1">
          <DevicePanel title="MIDI" data-testid="device-midi">
            <MidiControls
              enabled={enabled}
              onNoteOn={onMidiNoteOn}
              onNoteOff={onNoteOff}
              onMidiEvent={onMidiEvent}
            >
              <MidiMapPanel
                enabled={enabled}
                table={midiMap.table}
                learn={midiMap.learn}
                onLearn={midiMap.startLearn}
                onCancelLearn={midiMap.cancelLearn}
                onUnmap={midiMap.unmap}
                onClear={midiMap.clear}
              />
            </MidiControls>
          </DevicePanel>
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
