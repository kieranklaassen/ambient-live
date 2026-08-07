import { formatControlValue, type ControlTaper, type ControlUnit } from './control-math'
import { useParamControl } from './use-param-control'

export interface FaderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  defaultValue: number
  unit?: ControlUnit
  taper?: ControlTaper
  skew?: number
  orientation?: 'vertical' | 'horizontal'
  disabled?: boolean
  onChange: (value: number) => void
  'data-testid'?: string
}

export default function Fader({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  unit = 'ratio',
  taper = 'linear',
  skew = 2,
  orientation = 'vertical',
  disabled = false,
  onChange,
  'data-testid': testId,
}: FaderProps) {
  const { liveValue, normalized, interacting, handlers } = useParamControl({
    value,
    min,
    max,
    step,
    defaultValue,
    taper,
    skew,
    disabled,
    sensitivityPx: orientation === 'vertical' ? 100 : 140,
    onChange,
  })

  const valueText = formatControlValue(liveValue, unit)
  const vertical = orientation === 'vertical'

  return (
    <div
      className={`flex items-center gap-1 ${vertical ? 'h-full min-h-[5.5rem] flex-col' : 'w-full flex-row'} ${
        disabled ? 'opacity-40' : ''
      }`}
      data-testid={testId}
    >
      <span
        className={`shrink-0 text-[9px] font-medium uppercase tracking-[0.08em] text-al-muted ${
          vertical ? 'text-center' : 'w-14'
        }`}
      >
        {label}
      </span>
      <button
        type="button"
        role="slider"
        aria-label={label}
        aria-orientation={orientation}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={liveValue}
        aria-valuetext={valueText}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        className={`relative touch-none rounded-[1px] bg-al-sunken focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-al-accent ${
          vertical ? 'h-full w-5 flex-1' : 'h-5 w-full'
        }`}
        {...handlers}
      >
        <span
          aria-hidden="true"
          className="absolute bg-al-accent"
          style={
            vertical
              ? {
                  left: 2,
                  right: 2,
                  bottom: 2,
                  height: `calc(${normalized * 100}% - 2px)`,
                  minHeight: normalized > 0 ? 2 : 0,
                }
              : {
                  top: 2,
                  bottom: 2,
                  left: 2,
                  width: `calc(${normalized * 100}% - 2px)`,
                  minWidth: normalized > 0 ? 2 : 0,
                }
          }
        />
        <span
          aria-hidden="true"
          className="absolute border border-al-border bg-al-text"
          style={
            vertical
              ? {
                  left: 1,
                  right: 1,
                  height: 3,
                  bottom: `calc(${normalized * 100}% - 1px)`,
                }
              : {
                  top: 1,
                  bottom: 1,
                  width: 3,
                  left: `calc(${normalized * 100}% - 1px)`,
                }
          }
        />
      </button>
      <span
        className={`font-mono text-[10px] tabular-nums text-al-control-value ${
          interacting ? 'text-al-text' : ''
        } ${vertical ? '' : 'w-10 text-right'}`}
      >
        {valueText}
      </span>
    </div>
  )
}
