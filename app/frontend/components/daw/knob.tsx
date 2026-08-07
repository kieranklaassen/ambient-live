import {
  formatControlValue,
  knobArcPath,
  normToKnobAngle,
  type ControlTaper,
  type ControlUnit,
} from './control-math'
import { useParamControl } from './use-param-control'

export interface KnobProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  defaultValue: number
  unit?: ControlUnit
  taper?: ControlTaper
  skew?: number
  /** Fill arc from center (0.5) instead of from min — pan-style. */
  bipolar?: boolean
  disabled?: boolean
  size?: number
  onChange: (value: number) => void
  'data-testid'?: string
}

export default function Knob({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  unit = 'ratio',
  taper = 'linear',
  skew = 2,
  bipolar = false,
  disabled = false,
  size = 44,
  onChange,
  'data-testid': testId,
}: KnobProps) {
  const { liveValue, normalized, interacting, handlers } = useParamControl({
    value,
    min,
    max,
    step,
    defaultValue,
    taper,
    skew,
    disabled,
    sensitivityPx: 110,
    onChange,
  })

  const cx = size / 2
  const cy = size / 2
  const radius = size * 0.36
  const pointerAngle = (normToKnobAngle(normalized) * Math.PI) / 180
  const pointerLen = radius - 2
  const trackPath = knobArcPath(cx, cy, radius, 0, 1)
  const fillStart = bipolar ? 0.5 : 0
  const fillEnd = normalized
  const fillPath =
    Math.abs(fillEnd - fillStart) < 0.001
      ? ''
      : knobArcPath(
          cx,
          cy,
          radius,
          Math.min(fillStart, fillEnd),
          Math.max(fillStart, fillEnd),
        )
  const valueText = formatControlValue(liveValue, unit)

  return (
    <div
      className={`flex w-[3.75rem] flex-col items-center gap-0.5 ${disabled ? 'opacity-40' : ''}`}
      data-testid={testId}
    >
      <span className="w-full whitespace-nowrap text-center text-[9px] font-medium uppercase tracking-[0.06em] text-al-muted">
        {label}
      </span>
      <button
        type="button"
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={liveValue}
        aria-valuetext={valueText}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        className="relative touch-none rounded-[1px] bg-transparent p-0 select-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-al-accent"
        style={{ width: size, height: size }}
        {...handlers}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <path
            d={trackPath}
            fill="none"
            stroke="var(--color-al-hairline)"
            strokeWidth={2}
            strokeLinecap="butt"
          />
          {fillPath ? (
            <path
              d={fillPath}
              fill="none"
              stroke="var(--color-al-accent)"
              strokeWidth={2}
              strokeLinecap="butt"
            />
          ) : null}
          <circle
            cx={cx}
            cy={cy}
            r={radius * 0.55}
            fill="var(--color-al-sunken)"
            stroke="var(--color-al-border)"
            strokeWidth={1}
          />
          <line
            x1={cx}
            y1={cy}
            x2={cx + pointerLen * Math.cos(pointerAngle)}
            y2={cy + pointerLen * Math.sin(pointerAngle)}
            stroke="var(--color-al-text)"
            strokeWidth={1.5}
            strokeLinecap="square"
          />
        </svg>
      </button>
      <span
        className={`font-mono text-[10px] tabular-nums text-al-control-value ${
          interacting ? 'text-al-text' : ''
        }`}
      >
        {valueText}
      </span>
    </div>
  )
}
