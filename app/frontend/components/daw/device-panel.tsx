import type { ReactNode } from 'react'

import DeviceToggle from './device-toggle'

interface DevicePanelProps {
  title: string
  powered?: boolean
  onPowerChange?: (powered: boolean) => void
  disabled?: boolean
  children: ReactNode
  className?: string
  'data-testid'?: string
}

/** Ableton-style device chrome: title bar, optional power, dense body. */
export default function DevicePanel({
  title,
  powered = true,
  onPowerChange,
  disabled = false,
  children,
  className = '',
  'data-testid': testId,
}: DevicePanelProps) {
  return (
    <div
      className={`flex min-w-0 flex-col rounded-[1px] border border-al-border bg-al-panel ${className}`}
      data-testid={testId}
      data-powered={powered ? 'true' : 'false'}
    >
      <div className="flex items-center gap-1.5 border-b border-al-border bg-al-raised px-sg-1 py-0.5">
        {onPowerChange ? (
          <DeviceToggle
            pressed={powered}
            disabled={disabled}
            label={`${title} power`}
            onPressedChange={onPowerChange}
            data-testid={testId ? `${testId}-power` : undefined}
          />
        ) : null}
        <h3 className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase tracking-[0.12em] text-al-text">
          {title}
        </h3>
      </div>
      <div
        className={`min-w-0 flex-1 sg-p-1 ${powered ? '' : 'opacity-45'}`}
        aria-disabled={!powered || undefined}
      >
        {children}
      </div>
    </div>
  )
}
