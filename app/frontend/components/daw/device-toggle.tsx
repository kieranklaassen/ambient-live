interface DeviceToggleProps {
  pressed: boolean
  disabled?: boolean
  label?: string
  onPressedChange: (pressed: boolean) => void
  'data-testid'?: string
}

/** Squared on/off power toggle for device title bars. */
export default function DeviceToggle({
  pressed,
  disabled = false,
  label = 'Power',
  onPressedChange,
  'data-testid': testId,
}: DeviceToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={pressed}
      aria-label={label}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onPressedChange(!pressed)}
      className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[1px] border disabled:opacity-40 ${
        pressed
          ? 'border-al-accent bg-al-accent text-al-chrome'
          : 'border-al-hairline bg-al-sunken text-al-dim'
      }`}
    >
      <span
        aria-hidden="true"
        className={`block h-1.5 w-1.5 rounded-[1px] ${pressed ? 'bg-al-chrome' : 'bg-al-dim'}`}
      />
    </button>
  )
}
