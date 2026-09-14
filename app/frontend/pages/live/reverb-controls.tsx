import { useRef, useState } from 'react'

import { DeviceFrame, Fader, Knob, type ControlUnit } from '@kieranklaassen/live-mix/react'

import { liveControl, type LiveControlId, type LiveControlValues } from '@/audio/live-controls'

export interface ReverbSettings {
  mix: number
  decay: number
  damping: number
  predelayMs: number
  masterGain: number
}

/** Which control each setting is: the mapping layer and the knobs share one range. */
export const REVERB_SETTING_TARGETS: Record<keyof ReverbSettings, LiveControlId> = {
  mix: 'reverb.mix',
  decay: 'reverb.decay',
  damping: 'reverb.damping',
  predelayMs: 'reverb.predelayMs',
  masterGain: 'master.gain',
}

export function reverbSettingsFrom(controls: LiveControlValues): ReverbSettings {
  return {
    mix: controls['reverb.mix'],
    decay: controls['reverb.decay'],
    damping: controls['reverb.damping'],
    predelayMs: controls['reverb.predelayMs'],
    masterGain: controls['master.gain'],
  }
}

export const DEFAULT_REVERB_SETTINGS: ReverbSettings = {
  mix: liveControl('reverb.mix').default,
  decay: liveControl('reverb.decay').default,
  damping: liveControl('reverb.damping').default,
  predelayMs: liveControl('reverb.predelayMs').default,
  masterGain: liveControl('master.gain').default,
}

const MASTER_GAIN = liveControl('master.gain')

const reverbKnob = (
  field: Exclude<keyof ReverbSettings, 'masterGain'>,
  step: number,
  unit: ControlUnit,
) => {
  const spec = liveControl(REVERB_SETTING_TARGETS[field])
  return { field, label: spec.label, min: spec.min, max: spec.max, step, unit }
}

const REVERB_KNOBS: {
  field: Exclude<keyof ReverbSettings, 'masterGain'>
  label: string
  min: number
  max: number
  step: number
  unit: ControlUnit
}[] = [
  reverbKnob('mix', 0.01, 'ratio'),
  reverbKnob('decay', 0.01, 'ratio'),
  reverbKnob('damping', 0.01, 'ratio'),
  reverbKnob('predelayMs', 1, 'ms'),
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
    <DeviceFrame
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
    </DeviceFrame>
  )
}

export function MasterControls({ enabled, settings, onChange }: DeviceControlsProps) {
  return (
    <DeviceFrame title="Master" data-testid="device-master">
      <Fader
        label={MASTER_GAIN.label}
        orientation="horizontal"
        value={settings.masterGain}
        min={MASTER_GAIN.min}
        max={MASTER_GAIN.max}
        step={0.01}
        defaultValue={DEFAULT_REVERB_SETTINGS.masterGain}
        disabled={!enabled}
        onChange={(value) => onChange('masterGain', value)}
        data-testid="master-gain"
      />
    </DeviceFrame>
  )
}
