import { useCallback, useEffect, useRef, useState } from 'react'

import { midiToFrequency } from '@/audio/midi'

import {
  applyKeyboardOctave,
  isTypingTarget,
  keyboardNoteLabel,
  resolveShortcutAction,
  shiftKeyboardOctave,
} from './keymap'

// One octave plus the top C, C3-C4 at offset 0 — low enough to sit in
// ambient-pad territory. Home-row keys mirror the classic DAW layout;
// Z/X are reserved for octave (Ableton computer-keyboard convention).
const KEYS: { note: number; key: string; black: boolean }[] = [
  { note: 48, key: 'a', black: false },
  { note: 49, key: 'w', black: true },
  { note: 50, key: 's', black: false },
  { note: 51, key: 'e', black: true },
  { note: 52, key: 'd', black: false },
  { note: 53, key: 'f', black: false },
  { note: 54, key: 't', black: true },
  { note: 55, key: 'g', black: false },
  { note: 56, key: 'y', black: true },
  { note: 57, key: 'h', black: false },
  { note: 58, key: 'u', black: true },
  { note: 59, key: 'j', black: false },
  { note: 60, key: 'k', black: false },
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
  const heldBySource = useRef<Map<string, number>>(new Map())
  const [octaveOffset, setOctaveOffset] = useState(0)
  const octaveOffsetRef = useRef(octaveOffset)
  octaveOffsetRef.current = octaveOffset

  const press = useCallback(
    (sourceId: string, note: number) => {
      if (!enabled || heldBySource.current.has(sourceId)) return
      heldBySource.current.set(sourceId, note)
      onNoteOn(note, midiToFrequency(note))
    },
    [enabled, onNoteOn],
  )

  const release = useCallback(
    (sourceId: string) => {
      const note = heldBySource.current.get(sourceId)
      if (note === undefined) return
      heldBySource.current.delete(sourceId)
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

      const action = resolveShortcutAction({
        key: event.key,
        code: event.code,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        repeat: event.repeat,
        typing: false,
        overlayOpen: false,
      })
      if (action === 'keyboard.octaveDown') {
        setOctaveOffset((current) => shiftKeyboardOctave(current, -1))
        return
      }
      if (action === 'keyboard.octaveUp') {
        setOctaveOffset((current) => shiftKeyboardOctave(current, 1))
        return
      }

      const baseNote = byKey.get(event.key.toLowerCase())
      if (baseNote === undefined) return
      press(`key:${event.key.toLowerCase()}`, applyKeyboardOctave(baseNote, octaveOffsetRef.current))
    }
    const handleUp = (event: KeyboardEvent) => {
      release(`key:${event.key.toLowerCase()}`)
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
      {KEYS.map(({ note, key, black }) => {
        const sounding = applyKeyboardOctave(note, octaveOffset)
        const sourceId = `pointer:${key}`
        return (
          <button
            key={key}
            type="button"
            disabled={!enabled}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              press(sourceId, sounding)
            }}
            onPointerUp={() => release(sourceId)}
            onPointerCancel={() => release(sourceId)}
            onPointerLeave={() => release(sourceId)}
            className={`flex flex-col items-center justify-end rounded-[1px] border border-al-border pb-1.5 text-[10px] uppercase tracking-wide transition-colors select-none disabled:opacity-40 ${keySizeClass(black, compact)}`}
          >
            <span>{key}</span>
            {!compact && <span className="text-[10px] opacity-60">{keyboardNoteLabel(sounding)}</span>}
          </button>
        )
      })}
    </div>
  )
}
