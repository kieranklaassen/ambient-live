import { describe, expect, it } from 'vitest'

import {
  formatShortcutKeys,
  isTypingTarget,
  resolveShortcutAction,
  shouldPreventDefault,
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
    expect(resolveShortcutAction(event({ key: 'Escape', typing: true }))).toBe('overlay.dismiss')
  })

  it('suppresses shortcuts while overlay is open except Escape', () => {
    expect(resolveShortcutAction(event({ key: ' ', code: 'Space', overlayOpen: true }))).toBeNull()
    expect(resolveShortcutAction(event({ key: 'l', code: 'KeyL', overlayOpen: true }))).toBeNull()
    expect(resolveShortcutAction(event({ key: 'Home', code: 'Home', overlayOpen: true }))).toBeNull()
    expect(resolveShortcutAction(event({ key: '?', code: 'Slash', overlayOpen: true }))).toBeNull()
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
