import { formatShortcutKeys, isMacPlatform, SHORTCUT_HELP } from './keymap'

interface ShortcutOverlayProps {
  open: boolean
  onClose: () => void
}

export default function ShortcutOverlay({ open, onClose }: ShortcutOverlayProps) {
  if (!open) return null

  const isMac = isMacPlatform()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-al-chrome/70 sg-p-2"
      role="presentation"
      data-testid="shortcut-overlay-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-overlay-title"
        data-testid="shortcut-overlay"
        className="max-h-[min(80dvh,32rem)] w-full max-w-md overflow-auto rounded-[1px] border border-al-border bg-al-panel shadow-none"
      >
        <div className="flex items-center justify-between border-b border-al-border bg-al-raised px-sg-2 py-sg-1">
          <h2
            id="shortcut-overlay-title"
            className="text-[10px] font-medium uppercase tracking-[0.14em] text-al-text"
          >
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[1px] border border-al-hairline bg-al-sunken px-2 py-0.5 text-[10px] uppercase tracking-wide text-al-muted"
            data-testid="shortcut-overlay-close"
          >
            Esc
          </button>
        </div>
        <ul className="divide-y divide-al-border">
          {SHORTCUT_HELP.map((entry) => (
            <li
              key={`${entry.keys}-${entry.description}`}
              className={`flex items-start justify-between gap-3 px-sg-2 py-sg-1 ${
                entry.deferred ? 'opacity-55' : ''
              }`}
            >
              <div className="min-w-0">
                <p className="text-xs text-al-text">{entry.description}</p>
                {entry.deferred && entry.deferredReason ? (
                  <p className="text-[10px] text-al-dim">{entry.deferredReason}</p>
                ) : null}
              </div>
              <kbd className="shrink-0 rounded-[1px] border border-al-hairline bg-al-sunken px-1.5 py-0.5 font-mono text-[10px] text-al-control-value">
                {formatShortcutKeys(entry.keys, isMac)}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="border-t border-al-border px-sg-2 py-sg-1 text-[10px] text-al-dim">
          Synth home-row keys (A–K) are unchanged. Press ? anytime to reopen.
        </p>
      </div>
    </div>
  )
}
