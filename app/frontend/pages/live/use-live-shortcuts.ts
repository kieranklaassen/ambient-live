import { useEffect, useEffectEvent } from 'react'

import {
  isTypingTarget,
  resolveShortcutAction,
  shouldPreventDefault,
  type ShortcutAction,
} from './keymap'

export interface LiveShortcutHandlers {
  onAction: (action: ShortcutAction) => void
  overlayOpen: boolean
}

/**
 * Single window keydown listener for the live page.
 * Cleans up on unmount; uses the latest handlers via useEffectEvent.
 */
export function useLiveShortcuts({ onAction, overlayOpen }: LiveShortcutHandlers): void {
  const handleAction = useEffectEvent((action: ShortcutAction) => {
    onAction(action)
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveShortcutAction({
        key: event.key,
        code: event.code,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        repeat: event.repeat,
        typing: isTypingTarget(event.target),
        overlayOpen,
      })
      if (!action) return
      if (shouldPreventDefault(action)) event.preventDefault()
      handleAction(action)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [overlayOpen, handleAction])
}
