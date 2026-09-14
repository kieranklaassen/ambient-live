// @vitest-environment jsdom
//
// The device panels render the live-mix React kit (Knob, Fader, DeviceFrame)
// where the app's own `components/daw` primitives used to be. These pin the
// behaviour the page relies on: the control targets' ranges and defaults reach
// the controls, the readouts, keyboard and pointer semantics, the reverb
// bypass gesture and the live-input gating.
//
// Lives outside `pages/`: the Inertia page glob bundles every `.tsx` there as
// a page, and `entrypoints/` files are Vite entries.

import { cleanup, fireEvent, render, screen, type RenderResult } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultLiveControls, liveControl } from '@/audio/live-controls'
import LiveInputControls, { type LiveInputState } from '@/pages/live/live-input-controls'
import ReverbControls, {
  DEFAULT_REVERB_SETTINGS,
  MasterControls,
  REVERB_SETTING_TARGETS,
  reverbSettingsFrom,
  type ReverbSettings,
} from '@/pages/live/reverb-controls'

afterEach(cleanup)

const slider = (testId: string): HTMLButtonElement =>
  screen.getByTestId(testId).querySelector<HTMLButtonElement>('[role="slider"]')!

const valueOf = (testId: string): number => Number(slider(testId).getAttribute('aria-valuenow'))

/**
 * The page feeds every `onChange` back into the settings it renders (the
 * `changeControl` path), so the controls are controlled; mirror that here.
 */
function Harness({
  enabled = true,
  initial = DEFAULT_REVERB_SETTINGS,
  onChange,
  master = false,
}: {
  enabled?: boolean
  initial?: ReverbSettings
  onChange?: (field: keyof ReverbSettings, value: number) => void
  master?: boolean
}) {
  const [settings, setSettings] = useState(initial)
  const change = (field: keyof ReverbSettings, value: number) => {
    onChange?.(field, value)
    setSettings((previous) => ({ ...previous, [field]: value }))
  }
  return master ? (
    <MasterControls enabled={enabled} settings={settings} onChange={change} />
  ) : (
    <ReverbControls enabled={enabled} settings={settings} onChange={change} />
  )
}

function drag(target: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.pointerDown(target, { pointerId: 1, button: 0, clientX: from.x, clientY: from.y })
  fireEvent.pointerMove(target, { pointerId: 1, clientX: to.x, clientY: to.y })
  fireEvent.pointerUp(target, { pointerId: 1, clientX: to.x, clientY: to.y })
}

describe('ReverbControls (kit Knob + DeviceFrame)', () => {
  it('renders one knob per reverb target with its range, default and readout', () => {
    render(<Harness />)
    for (const field of ['mix', 'decay', 'damping', 'predelayMs'] as const) {
      const spec = liveControl(REVERB_SETTING_TARGETS[field])
      const knob = slider(`reverb-${field}`)
      expect(knob.getAttribute('aria-label')).toBe(spec.label)
      expect(Number(knob.getAttribute('aria-valuemin'))).toBe(spec.min)
      expect(Number(knob.getAttribute('aria-valuemax'))).toBe(spec.max)
      expect(Number(knob.getAttribute('aria-valuenow'))).toBe(spec.default)
    }
    expect(screen.getByTestId('reverb-mix').textContent).toBe('Mix0.35')
    expect(screen.getByTestId('reverb-predelayMs').textContent).toBe('Predelay20 ms')
    expect(screen.getByTestId('device-reverb').getAttribute('data-powered')).toBe('true')
  })

  it('steps with the arrow keys by the knob step, tenth-steps with Shift, jumps with Home/End/PageUp', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const mix = slider('reverb-mix')

    fireEvent.keyDown(mix, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith('mix', 0.36)
    fireEvent.keyDown(mix, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('mix', 0.35)
    fireEvent.keyDown(mix, { key: 'ArrowRight', shiftKey: true })
    expect(onChange).toHaveBeenLastCalledWith('mix', 0.351)
    fireEvent.keyDown(mix, { key: 'PageUp' })
    expect(onChange).toHaveBeenLastCalledWith('mix', 0.45)
    fireEvent.keyDown(mix, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('mix', 1)
    fireEvent.keyDown(mix, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('mix', 0)
    expect(valueOf('reverb-mix')).toBe(0)

    // Space and letters belong to the page (transport, synth keys).
    onChange.mockClear()
    fireEvent.keyDown(mix, { key: ' ' })
    fireEvent.keyDown(mix, { key: 'a' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not let a stepping key reach the page-level shortcuts', () => {
    const outer = vi.fn()
    render(<Harness />)
    document.addEventListener('keydown', outer)
    try {
      fireEvent.keyDown(slider('reverb-decay'), { key: 'Home' })
      expect(outer).not.toHaveBeenCalled()
      fireEvent.keyDown(slider('reverb-decay'), { key: ' ' })
      expect(outer).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('keydown', outer)
    }
  })

  it('drags up to raise, accumulates fine (Shift) travel, and double-clicks back to the default', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const damping = slider('reverb-damping')

    drag(damping, { x: 20, y: 100 }, { x: 20, y: 45 })
    const raised = valueOf('reverb-damping')
    expect(raised).toBeGreaterThan(0.3)
    expect(raised).toBeCloseTo(0.3 + 0.99 * (55 / 110), 1)
    expect(onChange).toHaveBeenLastCalledWith('damping', raised)

    // Ten 1 px fine moves land where one 10 px fine move does.
    fireEvent.pointerDown(damping, { pointerId: 2, button: 0, clientX: 20, clientY: 100 })
    for (let step = 1; step <= 10; step++) {
      fireEvent.pointerMove(damping, { pointerId: 2, clientX: 20, clientY: 100 - step, shiftKey: true })
    }
    fireEvent.pointerUp(damping, { pointerId: 2 })
    const fine = valueOf('reverb-damping')
    expect(fine).toBeGreaterThan(raised)
    expect(fine - raised).toBeLessThan(0.05)

    fireEvent.doubleClick(damping)
    expect(valueOf('reverb-damping')).toBe(0.3)
    expect(onChange).toHaveBeenLastCalledWith('damping', 0.3)
  })

  it('ignores every input while audio has not started', () => {
    const onChange = vi.fn()
    render(<Harness enabled={false} onChange={onChange} />)
    const mix = slider('reverb-mix')
    expect(mix.disabled).toBe(true)
    fireEvent.keyDown(mix, { key: 'ArrowUp' })
    drag(mix, { x: 0, y: 100 }, { x: 0, y: 0 })
    fireEvent.doubleClick(mix)
    expect(onChange).not.toHaveBeenCalled()
    expect((screen.getByTestId('device-reverb-power') as HTMLButtonElement).disabled).toBe(true)
  })

  it('bypass drives the mix to 0, locks the knobs, and power-on restores the remembered mix', () => {
    const onChange = vi.fn()
    render(<Harness initial={{ ...DEFAULT_REVERB_SETTINGS, mix: 0.6 }} onChange={onChange} />)
    const power = screen.getByTestId('device-reverb-power')
    expect(power).toHaveProperty('ariaChecked', 'true')

    fireEvent.click(power)
    expect(onChange).toHaveBeenLastCalledWith('mix', 0)
    expect(screen.getByTestId('device-reverb').getAttribute('data-powered')).toBe('false')
    expect(slider('reverb-mix').disabled).toBe(true)
    expect(slider('reverb-decay').disabled).toBe(true)
    expect(valueOf('reverb-mix')).toBe(0)

    fireEvent.click(power)
    expect(onChange).toHaveBeenLastCalledWith('mix', 0.6)
    expect(slider('reverb-mix').disabled).toBe(false)
    expect(valueOf('reverb-mix')).toBe(0.6)
  })
})

describe('MasterControls (kit Fader)', () => {
  it('is a horizontal fader over the master.gain target that steps and drags along its axis', () => {
    const onChange = vi.fn()
    render(<Harness master onChange={onChange} />)
    const spec = liveControl('master.gain')
    const fader = slider('master-gain')
    expect(fader.getAttribute('aria-orientation')).toBe('horizontal')
    expect(fader.getAttribute('aria-label')).toBe(spec.label)
    expect(Number(fader.getAttribute('aria-valuemax'))).toBe(spec.max)
    expect(valueOf('master-gain')).toBe(spec.default)
    expect(screen.getByTestId('master-gain').textContent).toBe('Gain0.80')

    fireEvent.keyDown(fader, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('masterGain', 0.81)
    fireEvent.keyDown(fader, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith('masterGain', 0.8)

    // 140 px of horizontal travel spans the range; a vertical move does nothing.
    drag(fader, { x: 100, y: 10 }, { x: 135, y: 10 })
    const dragged = valueOf('master-gain')
    expect(dragged).toBeCloseTo(0.8 + spec.max * (35 / 140), 1)
    expect(onChange).toHaveBeenLastCalledWith('masterGain', dragged)
    drag(fader, { x: 100, y: 10 }, { x: 100, y: 60 })
    expect(valueOf('master-gain')).toBe(dragged)

    fireEvent.doubleClick(fader)
    expect(valueOf('master-gain')).toBe(0.8)
  })
})

describe('LiveInputControls (kit Knob + DeviceFrame)', () => {
  const idle: LiveInputState = {
    enabled: false,
    busy: false,
    error: null,
    monitor: true,
    level: 1,
    pan: 0,
    deviceLabel: null,
    trackLatencySec: null,
  }

  function renderInput(input: Partial<LiveInputState>, handlers: Record<string, ReturnType<typeof vi.fn>> = {}): RenderResult {
    return render(
      <LiveInputControls
        enabled
        input={{ ...idle, ...input }}
        latency={null}
        measurement={null}
        measuring={false}
        measureError={null}
        onInputEnabledChange={handlers.onInputEnabledChange ?? vi.fn()}
        onMonitorChange={vi.fn()}
        onLevelChange={handlers.onLevelChange ?? vi.fn()}
        onPanChange={handlers.onPanChange ?? vi.fn()}
        onMeasure={vi.fn()}
      />,
    )
  }

  it('keeps level and pan locked until the input is on, and the power switch enables it', () => {
    const onInputEnabledChange = vi.fn()
    renderInput({}, { onInputEnabledChange })
    expect(slider('live-input-level').disabled).toBe(true)
    expect(slider('live-input-pan').disabled).toBe(true)
    expect(screen.getByTestId('device-live-input').getAttribute('data-powered')).toBe('false')
    fireEvent.click(screen.getByTestId('device-live-input-power'))
    expect(onInputEnabledChange).toHaveBeenCalledWith(true)
  })

  it('exposes level and pan with the control targets and a centred bipolar pan readout', () => {
    const onLevelChange = vi.fn()
    const onPanChange = vi.fn()
    renderInput({ enabled: true, deviceLabel: 'USB Interface' }, { onLevelChange, onPanChange })
    const level = liveControl('input.level')
    const pan = liveControl('input.pan')
    expect(Number(slider('live-input-level').getAttribute('aria-valuemax'))).toBe(level.max)
    expect(Number(slider('live-input-pan').getAttribute('aria-valuemin'))).toBe(pan.min)
    expect(screen.getByTestId('live-input-level').textContent).toBe('Level1.00')
    expect(screen.getByTestId('live-input-pan').textContent).toBe('Pan0')
    fireEvent.keyDown(slider('live-input-level'), { key: 'ArrowDown' })
    expect(onLevelChange).toHaveBeenLastCalledWith(0.99)
    fireEvent.keyDown(slider('live-input-pan'), { key: 'ArrowUp' })
    expect(onPanChange).toHaveBeenLastCalledWith(0.01)
  })
})

describe('reverbSettingsFrom', () => {
  it('projects the control values the page keeps onto the panel settings', () => {
    const values = { ...defaultLiveControls(), 'reverb.mix': 0.5, 'master.gain': 1.2 }
    expect(reverbSettingsFrom(values)).toEqual({ ...DEFAULT_REVERB_SETTINGS, mix: 0.5, masterGain: 1.2 })
  })
})
