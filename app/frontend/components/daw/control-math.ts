/** Pure value mapping for DAW-style knobs/faders. */

export type ControlTaper = 'linear' | 'log' | 'skewed'
export type ControlUnit = 'ratio' | 'ms' | 'dB' | 'Hz' | '%' | 'raw'

/** Full knob sweep in degrees (Ableton-style bottom gap). */
export const KNOB_SWEEP_DEG = 270
/** Start angle with 0° at east, clockwise-positive SVG angles. */
export const KNOB_START_DEG = -225

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

function assertRange(min: number, max: number): void {
  if (!(max > min)) {
    throw new RangeError(`control range requires max > min (got min=${min}, max=${max})`)
  }
}

/** Map a value in [min, max] to normalized [0, 1] with optional taper. */
export function normalizeValue(
  value: number,
  min: number,
  max: number,
  taper: ControlTaper = 'linear',
  skew = 2,
): number {
  assertRange(min, max)
  const clamped = clamp(value, min, max)
  const linear = (clamped - min) / (max - min)

  switch (taper) {
    case 'linear':
      return linear
    case 'log': {
      if (min <= 0) {
        throw new RangeError('log taper requires min > 0')
      }
      const logMin = Math.log(min)
      const logMax = Math.log(max)
      return (Math.log(clamped) - logMin) / (logMax - logMin)
    }
    case 'skewed': {
      const safeSkew = skew <= 0 ? 1 : skew
      return Math.pow(linear, 1 / safeSkew)
    }
    default: {
      const _exhaustive: never = taper
      return _exhaustive
    }
  }
}

/** Map normalized [0, 1] back to [min, max] with optional taper. */
export function denormalizeValue(
  normalized: number,
  min: number,
  max: number,
  taper: ControlTaper = 'linear',
  skew = 2,
): number {
  assertRange(min, max)
  const t = clamp01(normalized)

  switch (taper) {
    case 'linear':
      return min + t * (max - min)
    case 'log': {
      if (min <= 0) {
        throw new RangeError('log taper requires min > 0')
      }
      const logMin = Math.log(min)
      const logMax = Math.log(max)
      return Math.exp(logMin + t * (logMax - logMin))
    }
    case 'skewed': {
      const safeSkew = skew <= 0 ? 1 : skew
      const linear = Math.pow(t, safeSkew)
      return min + linear * (max - min)
    }
    default: {
      const _exhaustive: never = taper
      return _exhaustive
    }
  }
}

export function quantize(value: number, step: number, min: number, max: number): number {
  if (!(step > 0)) return clamp(value, min, max)
  const stepped = min + Math.round((value - min) / step) * step
  const decimals = Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))))
  const rounded = Number(stepped.toFixed(decimals))
  return clamp(rounded, min, max)
}

export function stepBy(
  value: number,
  steps: number,
  step: number,
  min: number,
  max: number,
  fine = false,
): number {
  const amount = fine ? step * 0.1 : step
  return quantize(value + steps * amount, amount < step ? amount : step, min, max)
}

/** Pointer pixels → normalized delta. Positive dy decreases (drag up = louder). */
export function pointerDeltaToNormDelta(
  deltaY: number,
  sensitivityPx = 120,
  fine = false,
): number {
  const scale = fine ? sensitivityPx * 4 : sensitivityPx
  return -deltaY / scale
}

export function normToKnobAngle(normalized: number): number {
  return KNOB_START_DEG + clamp01(normalized) * KNOB_SWEEP_DEG
}

export function knobAngleToNorm(angleDeg: number): number {
  const swept = ((angleDeg - KNOB_START_DEG) % 360 + 360) % 360
  return clamp01(swept / KNOB_SWEEP_DEG)
}

/** SVG arc path for a circular indicator from startNorm to endNorm (0–1). */
export function knobArcPath(
  cx: number,
  cy: number,
  radius: number,
  startNorm: number,
  endNorm: number,
): string {
  const start = normToKnobAngle(startNorm)
  const end = normToKnobAngle(endNorm)
  const startRad = (start * Math.PI) / 180
  const endRad = (end * Math.PI) / 180
  const x1 = cx + radius * Math.cos(startRad)
  const y1 = cy + radius * Math.sin(startRad)
  const x2 = cx + radius * Math.cos(endRad)
  const y2 = cy + radius * Math.sin(endRad)
  const sweep = endNorm >= startNorm ? endNorm - startNorm : 0
  const largeArc = sweep * KNOB_SWEEP_DEG > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`
}

export function formatControlValue(
  value: number,
  unit: ControlUnit = 'ratio',
  digits?: number,
): string {
  switch (unit) {
    case 'ratio':
      return value.toFixed(digits ?? 2)
    case 'ms':
      return `${Math.round(value)}ms`
    case 'dB': {
      const d = digits ?? 1
      const sign = value > 0 ? '+' : ''
      return `${sign}${value.toFixed(d)}dB`
    }
    case 'Hz': {
      if (value >= 1000) return `${(value / 1000).toFixed(digits ?? 2)}kHz`
      return `${value.toFixed(digits ?? (value < 100 ? 1 : 0))}Hz`
    }
    case '%':
      return `${Math.round(value)}%`
    case 'raw':
      return String(value)
    default: {
      const _exhaustive: never = unit
      return _exhaustive
    }
  }
}
