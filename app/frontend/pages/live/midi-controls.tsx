import { useCallback, useEffect, useRef, useState } from 'react'

import { midiToFrequency, parseMidiMessage } from '@/audio/midi'

interface MidiControlsProps {
  enabled: boolean
  onNoteOn: (noteId: number, frequency: number, gain: number) => void
  onNoteOff: (noteId: number) => void
}

type MidiStatus =
  | { kind: 'idle' }
  | { kind: 'unsupported' }
  | { kind: 'connecting' }
  | { kind: 'denied'; message: string }
  | { kind: 'ready' }

interface MidiInputOption {
  id: string
  name: string
}

function listInputs(access: MIDIAccess): MidiInputOption[] {
  return Array.from(access.inputs.values())
    .filter((input) => input.state === 'connected')
    .map((input) => ({
      id: input.id,
      name: input.name || input.id,
    }))
}

function isActiveConnected(input: MIDIInput | null): boolean {
  return input !== null && input.state === 'connected'
}

export default function MidiControls({ enabled, onNoteOn, onNoteOff }: MidiControlsProps) {
  const [status, setStatus] = useState<MidiStatus>(() =>
    typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
      ? { kind: 'idle' }
      : { kind: 'unsupported' },
  )
  const [inputs, setInputs] = useState<MidiInputOption[]>([])
  const [selectedId, setSelectedId] = useState('')
  const accessRef = useRef<MIDIAccess | null>(null)
  const activeInputRef = useRef<MIDIInput | null>(null)
  const activeNotesRef = useRef<Set<number>>(new Set())
  const onNoteOnRef = useRef(onNoteOn)
  const onNoteOffRef = useRef(onNoteOff)
  const mountedRef = useRef(true)
  const refreshInputsRef = useRef<(access: MIDIAccess) => void>(() => {})

  useEffect(() => {
    onNoteOnRef.current = onNoteOn
    onNoteOffRef.current = onNoteOff
  }, [onNoteOn, onNoteOff])

  const releaseAll = useCallback(() => {
    for (const note of activeNotesRef.current) {
      onNoteOffRef.current(note)
    }
    activeNotesRef.current.clear()
  }, [])

  const handleMessage = useCallback((event: MIDIMessageEvent) => {
    if (!event.data) return
    const parsed = parseMidiMessage(event.data)
    if (!parsed) return

    if (parsed.type === 'note-on') {
      // Skip duplicate note-ons so the shared refcount only sees one hold per pitch.
      if (activeNotesRef.current.has(parsed.note)) return
      activeNotesRef.current.add(parsed.note)
      onNoteOnRef.current(parsed.note, midiToFrequency(parsed.note), parsed.gain)
      return
    }

    // Only release notes this MIDI path actually started (avoid silencing keyboard holds).
    if (!activeNotesRef.current.delete(parsed.note)) return
    onNoteOffRef.current(parsed.note)
  }, [])

  const detachInput = useCallback(() => {
    const input = activeInputRef.current
    if (input) {
      input.onmidimessage = null
      activeInputRef.current = null
    }
    releaseAll()
  }, [releaseAll])

  const attachInput = useCallback(
    (access: MIDIAccess, id: string): boolean => {
      detachInput()
      if (!id) return false
      const input = access.inputs.get(id)
      if (!input || input.state !== 'connected') return false
      input.onmidimessage = handleMessage
      activeInputRef.current = input
      return true
    },
    [detachInput, handleMessage],
  )

  const refreshInputs = useCallback(
    (access: MIDIAccess) => {
      const next = listInputs(access)
      setInputs(next)
      setSelectedId((current) => {
        if (current && next.some((entry) => entry.id === current)) return current
        return ''
      })
      if (!isActiveConnected(activeInputRef.current)) detachInput()
    },
    [detachInput],
  )

  useEffect(() => {
    refreshInputsRef.current = refreshInputs
  }, [refreshInputs])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const access = accessRef.current
      if (access) access.onstatechange = null
      detachInput()
      accessRef.current = null
    }
  }, [detachInput])

  async function connectMidi() {
    if (!enabled || status.kind === 'unsupported' || status.kind === 'connecting') return
    if (!('requestMIDIAccess' in navigator)) {
      setStatus({ kind: 'unsupported' })
      return
    }

    setStatus({ kind: 'connecting' })
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false })
      if (!mountedRef.current) return
      accessRef.current = access
      access.onstatechange = () => {
        if (!mountedRef.current || accessRef.current !== access) return
        refreshInputsRef.current(access)
      }
      refreshInputs(access)
      setStatus({ kind: 'ready' })
    } catch (error) {
      if (!mountedRef.current) return
      const message = error instanceof Error ? error.message : String(error)
      setStatus({ kind: 'denied', message })
    }
  }

  function selectInput(id: string) {
    const access = accessRef.current
    if (!access) return
    if (!id) {
      detachInput()
      setSelectedId('')
      return
    }
    if (!attachInput(access, id)) {
      setSelectedId('')
      return
    }
    setSelectedId(id)
  }

  if (status.kind === 'unsupported') {
    return (
      <p className="mt-3 text-xs text-al-dim" data-testid="midi-status">
        MIDI not available in this browser.
      </p>
    )
  }

  return (
    <div className="space-y-2" data-testid="midi-controls">
      {status.kind !== 'ready' && (
        <button
          type="button"
          disabled={!enabled || status.kind === 'connecting'}
          onClick={() => void connectMidi()}
          className="rounded-[1px] border border-al-hairline px-3 py-1.5 text-sm text-al-text transition hover:border-zinc-500 hover:text-white disabled:opacity-40"
        >
          {status.kind === 'connecting' ? 'Connecting…' : 'Connect MIDI'}
        </button>
      )}

      {status.kind === 'denied' && (
        <p className="text-xs text-al-danger" data-testid="midi-status">
          MIDI permission denied — {status.message}. Pointer and computer keys still work.
        </p>
      )}

      {status.kind === 'ready' && (
        <label className="flex flex-col gap-1 text-xs text-al-muted">
          MIDI input
          <select
            value={selectedId}
            disabled={!enabled}
            onChange={(event) => selectInput(event.target.value)}
            className="rounded-[1px] border border-al-hairline bg-al-sunken px-2 py-1.5 text-sm text-al-text disabled:opacity-40"
            data-testid="midi-input-select"
          >
            <option value="">Select a device…</option>
            {inputs.map((input) => (
              <option key={input.id} value={input.id}>
                {input.name}
              </option>
            ))}
          </select>
          {inputs.length === 0 && (
            <span className="text-al-dim">No MIDI inputs found — plug in a controller.</span>
          )}
        </label>
      )}
    </div>
  )
}
