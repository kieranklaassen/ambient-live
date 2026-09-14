import { useRef, useState } from 'react'

import { controlTarget, type ControlTargetId, type ControlValues } from '@/audio/control-targets'
import { DevicePanel, Fader, Knob, type ControlUnit } from '@/components/daw'

export interface ReverbSettings {
  mix: number
  decay: number
  damping: number
  predelayMs: number
  masterGain: number
}

/** Which control target each setting is: the mapping layer and the knobs share one range. */
export const REVERB_SETTING_TARGETS: Record<keyof ReverbSettings, ControlTargetId> = {
  mix: 'reverb.mix',
  decay: 'reverb.decay',
  damping: 'reverb.damping',
  predelayMs: 'reverb.predelayMs',
  masterGain: 'master.gain',
}

export function reverbSettingsFrom(controls: ControlValues): ReverbSettings {
  return {
    mix: controls['reverb.mix'],
    decay: controls['reverb.decay'],
    damping: controls['reverb.damping'],
    predelayMs: controls['reverb.predelayMs'],
    masterGain: controls['master.gain'],
  }
}

export const DEFAULT_REVERB_SETTINGS: ReverbSettings = {
  mix: controlTarget('reverb.mix').default,
  decay: controlTarget('reverb.decay').default,
  damping: controlTarget('reverb.damping').default,
  predelayMs: controlTarget('reverb.predelayMs').default,
  masterGain: controlTarget('master.gain').default,
}

const MASTER_GAIN = controlTarget('master.gain')

const reverbKnob = (
  field: Exclude<keyof ReverbSettings, 'masterGain'>,
  step: number,
  unit: ControlUnit,
) => {
  const target = controlTarget(REVERB_SETTING_TARGETS[field])
  return { field, label: target.label, min: target.min, max: target.max, step, unit }
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
  // "Predelay" (no hyphen) so the 9px caps label cannot break across lines.
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
    </DevicePanel>
  )
}
