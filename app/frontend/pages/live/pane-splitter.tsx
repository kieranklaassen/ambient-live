import type { PointerEvent } from 'react'

interface PaneSplitterProps {
  orientation: 'vertical' | 'horizontal'
  label: string
  testId: string
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void
}

export default function PaneSplitter({
  orientation,
  label,
  testId,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: PaneSplitterProps) {
  const vertical = orientation === 'vertical'
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={testId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={
        vertical
          ? 'absolute top-0 right-0 z-20 h-full w-1.5 cursor-col-resize touch-none border-0 bg-transparent p-0 hover:bg-al-accent'
          : 'absolute top-0 right-0 left-0 z-20 h-1.5 w-full cursor-row-resize touch-none border-0 bg-transparent p-0 hover:bg-al-accent'
      }
    />
  )
}
