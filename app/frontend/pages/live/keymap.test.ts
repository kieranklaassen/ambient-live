import { describe, expect, it } from 'vitest'

import {
  applyKeyboardOctave,
  formatShortcutKeys,
  isTypingTarget,
  keyboardNoteLabel,
  KEYBOARD_OCTAVE_MAX,
  KEYBOARD_OCTAVE_MIN,
  resolveShortcutAction,
  shouldPreventDefault,
  shiftKeyboardOctave,
  type KeyEventDescriptor,
} from './keymap'

function event(partial: Partial<KeyEventDescriptor>): KeyEventDescriptor {
  return {
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    typing: false,
    overlayOpen: false,
    ...partial,
  }
}

describe('resolveShortcutAction', () => {
  it('maps Space / Shift+Space to Ableton transport actions', () => {
    expect(resolveShortcutAction(event({ key: ' ', code: 'Space' }))).toBe('transport.spaceStop')
    expect(resolveShortcutAction(event({ key: ' ', code: 'Space', shiftKey: true }))).toBe(
      'transport.continue',
    )
  })

  it('maps Home and period to transport.home', () => {
    expect(resolveShortcutAction(event({ key: 'Home', code: 'Home' }))).toBe('transport.home')
    expect(resolveShortcutAction(event({ key: '.', code: 'Period' }))).toBe('transport.home')
  })

  it('maps L to loop.toggle and ignores bare F (synth collision)', () => {
    expect(resolveShortcutAction(event({ key: 'l', code: 'KeyL' }))).toBe('loop.toggle')
    expect(resolveShortcutAction(event({ key: 'f', code: 'KeyF' }))).toBeNull()
  })

  it('maps Z/X to octave down/up and ignores Mod+Z (deferred undo)', () => {
    expect(resolveShortcutAction(event({ key: 'z', code: 'KeyZ' }))).toBe('keyboard.octaveDown')
    expect(resolveShortcutAction(event({ key: 'Z', code: 'KeyZ' }))).toBe('keyboard.octaveDown')
    expect(resolveShortcutAction(event({ key: 'x', code: 'KeyX' }))).toBe('keyboard.octaveUp')
    expect(resolveShortcutAction(event({ key: 'X', code: 'KeyX' }))).toBe('keyboard.octaveUp')
    expect(resolveShortcutAction(event({ key: 'z', code: 'KeyZ', metaKey: true }))).toBeNull()
    expect(resolveShortcutAction(event({ key: 'x', code: 'KeyX', ctrlKey: true }))).toBeNull()
    expect(resolveShortcutAction(event({ key: 'z', code: 'KeyZ', shiftKey: true }))).toBeNull()
  })

  it('maps Mod+F to browser.focusFilter on both Cmd and Ctrl', () => {
    expect(resolveShortcutAction(event({ key: 'f', code: 'KeyF', metaKey: true }))).toBe(
      'browser.focusFilter',
    )
    expect(resolveShortcutAction(event({ key: 'f', code: 'KeyF', ctrlKey: true }))).toBe(
      'browser.focusFilter',
    )
  })

  it('maps ? and Shift+/ to overlay.shortcuts', () => {
    expect(resolveShortcutAction(event({ key: '?', code: 'Slash', shiftKey: true }))).toBe(
      'overlay.shortcuts',
    )
    expect(resolveShortcutAction(event({ key: '?', code: 'Slash' }))).toBe('overlay.shortcuts')
  })

  it('suppresses shortcuts while typing except Escape', () => {
    expect(resolveShortcutAction(event({ key: ' ', code: 'Space', typing: true }))).toBeNull()
    expect(resolveShortcutAction(event({ key: 'l', code: 'KeyL', typing: true }))).toBeNull()
    expect(resolveShortcutAction(event({ key: 'z', code: 'KeyZ', typing: true }))).toBeNull()
    expect(resolveShortcutAction(event({ key: 'x', code: 'KeyX', typing: true }))).toBeNull()
    expect(resolveShortcutAction(event({ key: 'Escape', typing: true }))).toBe('overlay.dismiss')
  })

  it('suppresses shortcuts while overlay is open except Escape', () => {
    expect(resolveShortcutAction(event({ key: ' ', code: 'Space', overlayOpen: true }))).toBeNull()
    expect(resolveShortcutAction(event({ key: 'l', code: 'KeyL', overlayOpen: true }))).toBeNull()
    expect(resolveShortcutAction(event({ key: 'Home', code: 'Home', overlayOpen: true }))).toBeNull()
    expect(resolveShortcutAction(event({ key: '?', code: 'Slash', overlayOpen: true }))).toBeNull()
    expect(resolveShortcutAction(event({ key: 'z', code: 'KeyZ', overlayOpen: true }))).toBeNull()
    expect(resolveShortcutAction(event({ key: 'x', code: 'KeyX', overlayOpen: true }))).toBeNull()
    expect(resolveShortcutAction(event({ key: 'Escape', overlayOpen: true }))).toBe('overlay.dismiss')
  })

  it('ignores key repeat', () => {
    expect(resolveShortcutAction(event({ key: ' ', code: 'Space', repeat: true }))).toBeNull()
  })
})

describe('shouldPreventDefault', () => {
  it('prevents default for Space actions', () => {
    expect(shouldPreventDefault('transport.spaceStop')).toBe(true)
    expect(shouldPreventDefault('transport.continue')).toBe(true)
  })

  it('prevents default for octave actions', () => {
    expect(shouldPreventDefault('keyboard.octaveDown')).toBe(true)
    expect(shouldPreventDefault('keyboard.octaveUp')).toBe(true)
  })
})

describe('keyboard octave', () => {
  it('shifts offset by one octave and clamps to the MIDI-safe range', () => {
    expect(shiftKeyboardOctave(0, -1)).toBe(-1)
    expect(shiftKeyboardOctave(0, 1)).toBe(1)
    expect(shiftKeyboardOctave(KEYBOARD_OCTAVE_MIN, -1)).toBe(KEYBOARD_OCTAVE_MIN)
    expect(shiftKeyboardOctave(KEYBOARD_OCTAVE_MAX, 1)).toBe(KEYBOARD_OCTAVE_MAX)
  })

  it('transposes layout notes by 12 semitones per offset', () => {
    expect(applyKeyboardOctave(48, 0)).toBe(48)
    expect(applyKeyboardOctave(48, 1)).toBe(60)
    expect(applyKeyboardOctave(60, -1)).toBe(48)
    expect(applyKeyboardOctave(48, KEYBOARD_OCTAVE_MIN)).toBe(0)
    expect(applyKeyboardOctave(60, KEYBOARD_OCTAVE_MAX)).toBe(120)
  })

  it('labels MIDI notes with C4 = 60', () => {
    expect(keyboardNoteLabel(48)).toBe('C3')
    expect(keyboardNoteLabel(49)).toBe('C#3')
    expect(keyboardNoteLabel(60)).toBe('C4')
    expect(keyboardNoteLabel(applyKeyboardOctave(48, 1))).toBe('C4')
  })
})

describe('formatShortcutKeys / isTypingTarget', () => {
  it('substitutes Mod for the platform', () => {
    expect(formatShortcutKeys('Mod+F', true)).toBe('⌘+F')
    expect(formatShortcutKeys('Mod+F', false)).toBe('Ctrl+F')
  })

  it('treats null / non-elements as non-typing', () => {
    expect(isTypingTarget(null)).toBe(false)
  })
})
