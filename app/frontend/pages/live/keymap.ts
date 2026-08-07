/**
 * Central live-page shortcut map — single source of truth for the handler
 * and the `?` cheat sheet.
 *
 * Synth collision policy (see `keyboard.tsx` KEYS):
 * bare letter keys a/w/s/e/d/f/t/g/y/h/u/j/k drive the sine keyboard.
 * Transport shortcuts therefore never bind those bare letters.
 * Focus-filter uses Mod+F (not bare F) so F3 remains playable.
 */

export type ShortcutAction =
  | 'transport.spaceStop'
  | 'transport.continue'
  | 'transport.home'
  | 'loop.toggle'
  | 'browser.focusFilter'
  | 'overlay.shortcuts'
  | 'overlay.dismiss'

export interface KeyEventDescriptor {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  repeat: boolean
  /** True when the event target is an editable field. */
  typing: boolean
  /** Whether a dismissible overlay (e.g. shortcuts sheet) is open. */
  overlayOpen: boolean
}

export interface ShortcutHelpEntry {
  keys: string
  description: string
  deferred?: boolean
  deferredReason?: string
}

/** Active bindings shown in the cheat sheet and handled by resolveShortcutAction. */
export const SHORTCUT_HELP: readonly ShortcutHelpEntry[] = [
  {
    keys: 'Space',
    description: 'Play from start / stop and return to start',
  },
  {
    keys: 'Shift+Space',
    description: 'Continue play / pause at current playhead',
  },
  {
    keys: 'Home or .',
    description: 'Return playhead to start',
  },
  {
    keys: 'L',
    description: 'Toggle arrangement loop',
  },
  {
    keys: 'Mod+F',
    description: 'Focus sample browser filter (bare F is synth F3)',
  },
  {
    keys: '?',
    description: 'Show keyboard shortcuts',
  },
  {
    keys: 'Esc',
    description: 'Dismiss overlays / blur active control',
  },
  {
    keys: 'Mod+Z',
    description: 'Undo',
    deferred: true,
    deferredReason: 'No session undo stack yet',
  },
  {
    keys: 'Mod+Shift+Z',
    description: 'Redo',
    deferred: true,
    deferredReason: 'No session undo stack yet',
  },
  {
    keys: 'Mod+S',
    description: 'Save session',
    deferred: true,
    deferredReason: 'No session persistence path yet',
  },
] as const

export function isMacPlatform(
  userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(userAgent)
}

/** Platform modifier glyph/label for cheat-sheet display. */
export function modLabel(isMac: boolean): string {
  return isMac ? '⌘' : 'Ctrl'
}

export function formatShortcutKeys(keys: string, isMac: boolean): string {
  return keys.split('Mod').join(modLabel(isMac))
}

export function isTypingTarget(target: EventTarget | null): boolean {
  // Node/unit tests may lack DOM globals — treat as non-typing.
  if (typeof Element === 'undefined' || typeof HTMLElement === 'undefined') return false
  if (!(target instanceof Element)) return false
  if (typeof HTMLInputElement !== 'undefined' && target instanceof HTMLInputElement) {
    const type = target.type
    // Non-text inputs should not suppress transport shortcuts.
    if (
      type === 'button' ||
      type === 'checkbox' ||
      type === 'radio' ||
      type === 'range' ||
      type === 'file' ||
      type === 'submit' ||
      type === 'reset' ||
      type === 'image' ||
      type === 'color'
    ) {
      return false
    }
    return true
  }
  if (
    (typeof HTMLTextAreaElement !== 'undefined' && target instanceof HTMLTextAreaElement) ||
    (typeof HTMLSelectElement !== 'undefined' && target instanceof HTMLSelectElement)
  ) {
    return true
  }
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return Boolean(target.closest('[contenteditable=""], [contenteditable="true"]'))
}

function hasMod(event: KeyEventDescriptor): boolean {
  return event.metaKey || event.ctrlKey
}

function bareKey(event: KeyEventDescriptor): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey
}

/**
 * Resolve a key event descriptor to a shortcut action, or null if ignored.
 * Pure: no DOM, no side effects — unit-tested.
 */
export function resolveShortcutAction(event: KeyEventDescriptor): ShortcutAction | null {
  if (event.repeat) return null

  // Esc dismisses even from typing contexts (leave a field / close sheet).
  if (event.key === 'Escape') {
    return 'overlay.dismiss'
  }

  if (event.typing) return null

  // While a dismissible overlay is open, only Escape acts — avoid transport /
  // loop / seek firing while the user reads the cheat sheet.
  if (event.overlayOpen) return null

  // "?" can arrive as Shift+/ depending on layout — accept both key and code.
  if (bareKey(event) && (event.key === '?' || (event.code === 'Slash' && event.shiftKey))) {
    return 'overlay.shortcuts'
  }

  if (event.code === 'Space' || event.key === ' ') {
    if (event.altKey || hasMod(event)) return null
    return event.shiftKey ? 'transport.continue' : 'transport.spaceStop'
  }

  if (bareKey(event) && !event.shiftKey && (event.key === 'Home' || event.code === 'Home')) {
    return 'transport.home'
  }

  // Period as Home alternative on compact keyboards.
  if (bareKey(event) && !event.shiftKey && (event.key === '.' || event.code === 'Period')) {
    return 'transport.home'
  }

  if (
    bareKey(event) &&
    !event.shiftKey &&
    (event.key === 'l' || event.key === 'L' || event.code === 'KeyL')
  ) {
    return 'loop.toggle'
  }

  // Mod+F only — bare F is the synth F3 key.
  if (
    hasMod(event) &&
    !event.altKey &&
    !event.shiftKey &&
    (event.key === 'f' || event.key === 'F' || event.code === 'KeyF')
  ) {
    return 'browser.focusFilter'
  }

  return null
}

/** Whether the resolved action should call preventDefault (Space scroll, etc.). */
export function shouldPreventDefault(action: ShortcutAction): boolean {
  switch (action) {
    case 'transport.spaceStop':
    case 'transport.continue':
    case 'transport.home':
    case 'loop.toggle':
    case 'browser.focusFilter':
    case 'overlay.shortcuts':
    case 'overlay.dismiss':
      return true
    default: {
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}
