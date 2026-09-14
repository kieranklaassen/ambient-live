import { DevicePanel, Knob } from '@/components/daw'
import { controlTarget } from '@/audio/control-targets'
import { formatMs, type ContextLatency } from '@/audio/latency'
import type { RoundTripMeasurement } from '@/audio/latency-probe'

export interface LiveInputState {
  /** A capture stream is attached to the input track. */
  enabled: boolean
  /** `getUserMedia` is in flight. */
  busy: boolean
  error: string | null
  monitor: boolean
  level: number
  pan: number
  deviceLabel: string | null
  /** `MediaTrackSettings.latency` when the browser reports it (Chrome does). */
  trackLatencySec: number | null
}

interface LiveInputControlsProps {
  /** Audio has started. */
  enabled: boolean
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

const LEVEL = controlTarget('input.level')
const PAN = controlTarget('input.pan')

function roundTripText(measurement: RoundTripMeasurement | null): string {
  if (!measurement) return 'not measured'
  if (measurement.roundTripSec === null) return 'no loopback heard'
  return formatMs(measurement.roundTripSec)
}

/** Mic/instrument input with monitoring, a level and pan, and the latency readout. */
export default function LiveInputControls({
  enabled,
  input,
  latency,
  measurement,
  measuring,
  measureError,
  onInputEnabledChange,
  onMonitorChange,
  onLevelChange,
  onPanChange,
  onMeasure,
}: LiveInputControlsProps) {
  const active = enabled && input.enabled
  return (
    <DevicePanel
      title="Live input"
      powered={input.enabled}
      disabled={!enabled || input.busy}
      onPowerChange={onInputEnabledChange}
      data-testid="device-live-input"
    >
      <div className="flex flex-col gap-sg-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={input.monitor}
            disabled={!active}
            onClick={() => onMonitorChange(!input.monitor)}
            className={`rounded-[1px] border px-2 py-0.5 text-[10px] uppercase tracking-wide disabled:opacity-40 ${
              input.monitor
                ? 'border-al-accent bg-al-accent text-al-chrome'
                : 'border-al-hairline text-al-muted hover:border-zinc-500 hover:text-white'
            }`}
            data-testid="live-input-monitor"
          >
            Monitor
          </button>
          <span className="min-w-0 flex-1 truncate text-[10px] text-al-dim" data-testid="live-input-device">
            {input.busy ? 'Requesting input…' : input.deviceLabel ?? (input.enabled ? 'Input' : 'Off')}
          </span>
        </div>

        <div className="grid grid-cols-2 justify-items-center gap-x-1">
          <Knob
            label={LEVEL.label}
            value={input.level}
            min={LEVEL.min}
            max={LEVEL.max}
            step={0.01}
            defaultValue={LEVEL.default}
            unit="ratio"
            size={40}
            disabled={!active}
            onChange={onLevelChange}
            data-testid="live-input-level"
          />
          <Knob
            label={PAN.label}
            value={input.pan}
            min={PAN.min}
            max={PAN.max}
            step={0.01}
            defaultValue={PAN.default}
            unit="raw"
            bipolar
            size={40}
            disabled={!active}
            onChange={onPanChange}
            data-testid="live-input-pan"
          />
        </div>

        <dl
          className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-px text-[10px] tabular-nums text-al-muted"
          data-testid="latency-readout"
        >
          <dt className="text-al-dim">Base</dt>
          <dd data-testid="latency-base">{latency ? formatMs(latency.baseLatencySec) : '—'}</dd>
          <dt className="text-al-dim">Output</dt>
          <dd data-testid="latency-output">
            {latency && latency.outputLatencySec > 0 ? formatMs(latency.outputLatencySec) : '—'}
          </dd>
          <dt className="text-al-dim">Input</dt>
          <dd data-testid="latency-input">
            {input.trackLatencySec !== null ? formatMs(input.trackLatencySec) : '—'}
          </dd>
          <dt className="text-al-dim">Round trip</dt>
          <dd
            className={measurement?.roundTripSec != null ? 'text-al-text' : undefined}
            data-testid="latency-round-trip"
            data-seconds={measurement?.roundTripSec ?? undefined}
          >
            {measuring ? 'measuring…' : roundTripText(measurement)}
          </dd>
        </dl>

        <button
          type="button"
          disabled={!active || measuring}
          onClick={onMeasure}
          title="Plays a short chirp through the output and times its return through the input (speakers → mic, or a loopback cable)."
          className="self-start rounded-[1px] border border-al-hairline px-2 py-0.5 text-[10px] uppercase tracking-wide text-al-muted hover:border-zinc-500 hover:text-white disabled:opacity-40"
          data-testid="live-input-measure"
        >
          Measure round trip
        </button>

        {(input.error || measureError) && (
          <p className="text-[10px] text-al-danger" data-testid="live-input-error">
            {input.error ?? measureError}
          </p>
        )}
      </div>
    </DevicePanel>
  )
}
