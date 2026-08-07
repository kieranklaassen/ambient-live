import { useCallback, useEffect, useRef } from 'react'

import { midiToFrequency } from '@/audio/midi'

import { isTypingTarget } from './keymap'

// One octave plus the top C, C3-C4 by default — low enough to sit in
// ambient-pad territory. Home-row keys mirror the classic DAW layout.
const KEYS: { note: number; label: string; key: string; black: boolean }[] = [
  { note: 48, label: 'C3', key: 'a', black: false },
  { note: 49, label: 'C#3', key: 'w', black: true },
  { note: 50, label: 'D3', key: 's', black: false },
  { note: 51, label: 'D#3', key: 'e', black: true },
  { note: 52, label: 'E3', key: 'd', black: false },
  { note: 53, label: 'F3', key: 'f', black: false },
  { note: 54, label: 'F#3', key: 't', black: true },
  { note: 55, label: 'G3', key: 'g', black: false },
  { note: 56, label: 'G#3', key: 'y', black: true },
  { note: 57, label: 'A3', key: 'h', black: false },
  { note: 58, label: 'A#3', key: 'u', black: true },
  { note: 59, label: 'B3', key: 'j', black: false },
  { note: 60, label: 'C4', key: 'k', black: false },
]

interface KeyboardProps {
  enabled: boolean
  onNoteOn: (noteId: number, frequency: number) => void
  onNoteOff: (noteId: number) => void
  compact?: boolean
}

function keySizeClass(black: boolean, compact: boolean): string {
  if (black) {
    return compact
      ? 'h-12 w-6 bg-al-key-black text-al-dim hover:bg-al-chrome active:bg-al-accent active:text-al-chrome'
      : 'h-20 w-8 bg-al-key-black text-al-dim hover:bg-al-chrome active:bg-al-accent active:text-al-chrome'
  }
  return compact
    ? 'h-18 w-8 bg-al-key-white text-al-chrome hover:brightness-110 active:bg-al-accent'
    : 'h-28 w-10 bg-al-key-white text-al-chrome hover:brightness-110 active:bg-al-accent'
}

export default function Keyboard({ enabled, onNoteOn, onNoteOff, compact = false }: KeyboardProps) {
  const heldNotes = useRef<Set<number>>(new Set())

  const press = useCallback(
    (note: number) => {
      if (!enabled || heldNotes.current.has(note)) return
      heldNotes.current.add(note)
      onNoteOn(note, midiToFrequency(note))
    },
    [enabled, onNoteOn],
  )

  const release = useCallback(
    (note: number) => {
      if (!heldNotes.current.delete(note)) return
      onNoteOff(note)
    },
    [onNoteOff],
  )

  useEffect(() => {
    if (!enabled) return

    const byKey = new Map(KEYS.map((k) => [k.key, k.note]))
    const handleDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      // Same typing-context gate as transport shortcuts (search/filter, etc.).
      if (isTypingTarget(event.target)) return
      const note = byKey.get(event.key.toLowerCase())
      if (note !== undefined) press(note)
    }
    const handleUp = (event: KeyboardEvent) => {
      const note = byKey.get(event.key.toLowerCase())
      if (note !== undefined) release(note)
    }

    window.addEventListener('keydown', handleDown)
    window.addEventListener('keyup', handleUp)
    return () => {
      window.removeEventListener('keydown', handleDown)
      window.removeEventListener('keyup', handleUp)
    }
  }, [enabled, press, release])

  return (
    <div className="flex items-end gap-px" role="group" aria-label="Playing surface">
      {KEYS.map(({ note, label, key, black }) => (
        <button
          key={note}
          type="button"
          disabled={!enabled}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            press(note)
          }}
          onPointerUp={() => release(note)}
          onPointerCancel={() => release(note)}
          onPointerLeave={() => release(note)}
          className={`flex flex-col items-center justify-end rounded-[1px] border border-al-border pb-1.5 text-[10px] uppercase tracking-wide transition-colors select-none disabled:opacity-40 ${keySizeClass(black, compact)}`}
        >
          <span>{key}</span>
          {!compact && <span className="text-[10px] opacity-60">{label}</span>}
        </button>
      ))}
    </div>
  )
}
