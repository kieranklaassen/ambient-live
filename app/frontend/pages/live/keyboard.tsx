import { useCallback, useEffect, useRef } from 'react'

import { midiToFrequency } from '@/audio/midi'

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
      if (event.repeat || event.metaKey || event.ctrlKey) return
      if (event.target instanceof HTMLInputElement) return
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
    <div className="flex items-end gap-1" role="group" aria-label="Playing surface">
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
          className={`flex flex-col items-center justify-end rounded-b-md pb-2 text-xs transition-colors select-none disabled:opacity-40 ${
            black
              ? compact
                ? 'h-16 w-7 bg-zinc-800 text-zinc-500 hover:bg-zinc-700 active:bg-teal-800'
                : 'h-24 w-9 bg-zinc-800 text-zinc-500 hover:bg-zinc-700 active:bg-teal-800'
              : compact
                ? 'h-24 w-9 bg-zinc-200 text-zinc-600 hover:bg-white active:bg-teal-200'
                : 'h-36 w-12 bg-zinc-200 text-zinc-600 hover:bg-white active:bg-teal-200'
          }`}
        >
          <span className="font-mono uppercase">{key}</span>
          {!compact && <span className="text-[10px] opacity-60">{label}</span>}
        </button>
      ))}
    </div>
  )
}
