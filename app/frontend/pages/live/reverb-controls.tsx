import { useRef, useState } from 'react'

import { DevicePanel, Fader, Knob, type ControlUnit } from '@/components/daw'

export interface ReverbSettings {
  mix: number
  decay: number
  damping: number
  predelayMs: number
  masterGain: number
}

export const DEFAULT_REVERB_SETTINGS: ReverbSettings = {
  mix: 0.35,
  decay: 0.7,
  damping: 0.3,
  predelayMs: 20,
  masterGain: 0.8,
}

const REVERB_KNOBS: {
  field: Exclude<keyof ReverbSettings, 'masterGain'>
  label: string
  min: number
  max: number
  step: number
  unit: ControlUnit
}[] = [
  { field: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, unit: 'ratio' },
  {
    field: 'decay',
    label: 'Decay',
    min: 0,
    max: 0.99,
    step: 0.01,
    unit: 'ratio',
  },
  {
    field: 'damping',
    label: 'Damping',
    min: 0,
    max: 0.99,
    step: 0.01,
    unit: 'ratio',
  },
  // "Predelay" (no hyphen) so the 9px caps label cannot break across lines.
  {
    field: 'predelayMs',
    label: 'Predelay',
    min: 0,
    max: 250,
    step: 1,
    unit: 'ms',
  },
]

interface DeviceControlsProps {
  enabled: boolean
  settings: ReverbSettings
  onChange: (field: keyof ReverbSettings, value: number) => void
}

export default function ReverbControls({ enabled, settings, onChange }: DeviceControlsProps) {
  const [powered, setPowered] = useState(true)
  // Bypass drives the existing wet-mix param to 0; the pre-bypass mix is
  // restored on power-on. Knobs are locked while bypassed so the remembered
  // value cannot go stale.
  const bypassedMixRef = useRef(settings.mix)

  function handlePowerChange(next: boolean) {
    setPowered(next)
    if (next) {
      onChange('mix', bypassedMixRef.current)
      return
    }
    bypassedMixRef.current = settings.mix
    onChange('mix', 0)
  }

  return (
    <DevicePanel
      title="Reverb"
      powered={powered}
      disabled={!enabled}
      onPowerChange={handlePowerChange}
      data-testid="device-reverb"
    >
      <div className="grid grid-cols-4 justify-items-center gap-x-1 gap-y-sg-1">
        {REVERB_KNOBS.map(({ field, label, min, max, step, unit }) => (
          <Knob
            key={field}
            label={label}
            value={settings[field]}
            min={min}
            max={max}
            step={step}
            defaultValue={DEFAULT_REVERB_SETTINGS[field]}
            unit={unit}
            size={40}
            disabled={!enabled || !powered}
            onChange={(value) => onChange(field, value)}
            data-testid={`reverb-${field}`}
          />
        ))}
      </div>
    </DevicePanel>
  )
}

export function MasterControls({ enabled, settings, onChange }: DeviceControlsProps) {
  return (
    <DevicePanel title="Master" data-testid="device-master">
      <Fader
        label="Gain"
        orientation="horizontal"
        value={settings.masterGain}
        min={0}
        max={1.5}
        step={0.01}
        defaultValue={DEFAULT_REVERB_SETTINGS.masterGain}
        disabled={!enabled}
        onChange={(value) => onChange('masterGain', value)}
        data-testid="master-gain"
      />
    </DevicePanel>
  )
}
