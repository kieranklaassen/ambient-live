import { PARAM, type ParamId } from '@/audio/audio-engine'

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

const SLIDERS: {
  field: keyof ReverbSettings
  param: ParamId
  label: string
  min: number
  max: number
  step: number
}[] = [
  { field: 'mix', param: PARAM.reverbMix, label: 'Mix', min: 0, max: 1, step: 0.01 },
  { field: 'decay', param: PARAM.reverbDecay, label: 'Decay', min: 0, max: 0.99, step: 0.01 },
  { field: 'damping', param: PARAM.reverbDamping, label: 'Damping', min: 0, max: 0.99, step: 0.01 },
  { field: 'predelayMs', param: PARAM.reverbPredelayMs, label: 'Pre-delay', min: 0, max: 250, step: 1 },
  { field: 'masterGain', param: PARAM.masterGain, label: 'Master', min: 0, max: 1.5, step: 0.01 },
]

interface ReverbControlsProps {
  enabled: boolean
  settings: ReverbSettings
  onChange: (field: keyof ReverbSettings, param: ParamId, value: number) => void
  compact?: boolean
}

export default function ReverbControls({
  enabled,
  settings,
  onChange,
  compact = false,
}: ReverbControlsProps) {
  return (
    <div className={compact ? 'grid grid-cols-2 gap-x-3 gap-y-2' : 'grid gap-4'}>
      {SLIDERS.map(({ field, param, label, min, max, step }) => (
        <label
          key={field}
          className={
            compact
              ? 'grid grid-cols-[3.5rem_1fr_2.75rem] items-center gap-2 text-xs'
              : 'grid grid-cols-[6rem_1fr_3.5rem] items-center gap-3 text-sm'
          }
        >
          <span className="uppercase tracking-wide text-al-muted">{label}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            disabled={!enabled}
            value={settings[field]}
            onChange={(e) => onChange(field, param, Number(e.target.value))}
            className="accent-al-accent disabled:opacity-40"
          />
          <span className="text-right font-mono text-[10px] text-al-dim">
            {field === 'predelayMs' ? `${settings[field]}ms` : settings[field].toFixed(2)}
          </span>
        </label>
      ))}
    </div>
  )
}
