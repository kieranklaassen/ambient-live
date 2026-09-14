import { describe, expect, it } from 'vitest'

import {
  CONTROL_TARGETS,
  clampControlValue,
  controlTarget,
  controlValueFromUnit,
  defaultControlValues,
  isControlTargetId,
  unitFromControlValue,
} from './control-targets'

describe('control targets', () => {
  it('has unique ids, sane ranges and in-range defaults', () => {
    const ids = CONTROL_TARGETS.map((spec) => spec.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const spec of CONTROL_TARGETS) {
      expect(spec.max, spec.id).toBeGreaterThan(spec.min)
      expect(spec.default, spec.id).toBeGreaterThanOrEqual(spec.min)
      expect(spec.default, spec.id).toBeLessThanOrEqual(spec.max)
    }
  })

  it('recognises ids and rejects anything else', () => {
    expect(isControlTargetId('reverb.mix')).toBe(true)
    expect(isControlTargetId('reverb.size')).toBe(false)
    expect(isControlTargetId(42)).toBe(false)
  })

  it('defaults match the workstation start-up settings', () => {
    const values = defaultControlValues()
    expect(values['reverb.mix']).toBe(0.35)
    expect(values['master.gain']).toBe(0.8)
    expect(values['synth.level']).toBe(1)
    expect(values['input.monitor']).toBe(1)
  })

  it('maps 0..1 controller positions across a range and back', () => {
    const pan = controlTarget('synth.pan')
    expect(controlValueFromUnit(pan, 0)).toBe(-1)
    expect(controlValueFromUnit(pan, 0.5)).toBe(0)
    expect(controlValueFromUnit(pan, 1)).toBe(1)
    expect(unitFromControlValue(pan, 0.5)).toBeCloseTo(0.75)
    const predelay = controlTarget('reverb.predelayMs')
    expect(controlValueFromUnit(predelay, 0.2)).toBeCloseTo(50)
    expect(controlValueFromUnit(predelay, 2)).toBe(250)
    expect(controlValueFromUnit(predelay, Number.NaN)).toBe(0)
  })

  it('snaps toggles at the MIDI switch threshold', () => {
    const monitor = controlTarget('input.monitor')
    expect(controlValueFromUnit(monitor, 63 / 127)).toBe(0)
    expect(controlValueFromUnit(monitor, 64 / 127)).toBe(1)
  })

  it('clamps values into the range and falls back to the default for NaN', () => {
    const level = controlTarget('input.level')
    expect(clampControlValue(level, 9)).toBe(1.5)
    expect(clampControlValue(level, -1)).toBe(0)
    expect(clampControlValue(level, Number.NaN)).toBe(1)
  })
})
