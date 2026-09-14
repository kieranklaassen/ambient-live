import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import {
  MidiInput,
  controlEventsFromMidi,
  isMapped,
  isWebMidiSupported,
  type ControlSurface,
  type MidiAccessLike,
  type MidiMessage,
} from '@kieranklaassen/live-mix'

import { midiToFrequency, velocityToGain } from '@/audio/midi'

interface MidiControlsProps {
  enabled: boolean
  /** Takes every control event from the selected port; a note it maps or learns never reaches the synth. */
  surface: ControlSurface
  onNoteOn: (noteId: number, frequency: number, gain: number) => void
  onNoteOff: (noteId: number) => void
  /** Rendered under the input picker once MIDI is connected (the mapping table). */
  children?: ReactNode
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

/** The port the library listens on, and how to let go of it. */
interface AttachedPort {
  id: string
  detach: () => void
}

function listInputs(access: MIDIAccess): MidiInputOption[] {
  return Array.from(access.inputs.values())
    .filter((input) => input.state === 'connected')
    .map((input) => ({
      id: input.id,
      name: input.name || input.id,
    }))
}

/**
 * The access as the library sees it. `MidiInput` owns `onstatechange` on the
 * object it is given, so the picker keeps the real one and forwards. The
 * library reads only `id`, `name`, `manufacturer`, `state` and
 * `onmidimessage` from a port, which the browser's objects provide.
 */
function bridgeAccess(access: MIDIAccess, onStateChange: () => void): MidiAccessLike {
  const bridge: MidiAccessLike = {
    inputs: access.inputs as unknown as MidiAccessLike['inputs'],
    onstatechange: null,
  }
  access.onstatechange = () => {
    onStateChange()
    bridge.onstatechange?.({})
  }
  return bridge
}

export default function MidiControls({
  enabled,
  surface,
  onNoteOn,
  onNoteOff,
  children,
}: MidiControlsProps) {
  const [status, setStatus] = useState<MidiStatus>(() =>
    isWebMidiSupported() ? { kind: 'idle' } : { kind: 'unsupported' },
  )
  const [inputs, setInputs] = useState<MidiInputOption[]>([])
  const [selectedId, setSelectedId] = useState('')
  const accessRef = useRef<MIDIAccess | null>(null)
  const bridgeRef = useRef<MidiAccessLike | null>(null)
  const portRef = useRef<AttachedPort | null>(null)
  const activeNotesRef = useRef<Set<number>>(new Set())
  const surfaceRef = useRef(surface)
  const onNoteOnRef = useRef(onNoteOn)
  const onNoteOffRef = useRef(onNoteOff)
  const mountedRef = useRef(true)
  const refreshInputsRef = useRef<(access: MIDIAccess) => void>(() => {})

  useEffect(() => {
    surfaceRef.current = surface
    onNoteOnRef.current = onNoteOn
    onNoteOffRef.current = onNoteOff
  }, [surface, onNoteOn, onNoteOff])

  const releaseAll = useCallback(() => {
    for (const note of activeNotesRef.current) {
      onNoteOffRef.current(note)
    }
    activeNotesRef.current.clear()
  }, [])

  // Notes for the synth. Control events reach the surface through
  // `surface.connect`, which fires after this for the same message.
  const handleMessage = useCallback((message: MidiMessage) => {
    switch (message.type) {
      case 'note-on': {
        // A mapped note — or one an armed learn is about to bind — is a control, not a key.
        const current = surfaceRef.current
        const taken =
          current.learning !== null ||
          controlEventsFromMidi(message).some((event) => isMapped(current.table, event))
        if (taken) return
        // Skip duplicate note-ons so the shared refcount only sees one hold per pitch.
        if (activeNotesRef.current.has(message.note)) return
        activeNotesRef.current.add(message.note)
        onNoteOnRef.current(
          message.note,
          midiToFrequency(message.note),
          velocityToGain(message.velocity),
        )
        return
      }
      case 'note-off':
        // A sounding note always releases, even if it was mapped mid-hold; only
        // release notes this MIDI path actually started (avoid silencing keyboard holds).
        if (activeNotesRef.current.delete(message.note)) onNoteOffRef.current(message.note)
        return
      case 'cc':
      case 'pitchbend':
      case 'aftertouch':
      case 'program':
        return
      default: {
        const _exhaustive: never = message
        return _exhaustive
      }
    }
  }, [])

  const detachInput = useCallback(() => {
    portRef.current?.detach()
    portRef.current = null
    releaseAll()
  }, [releaseAll])

  const attachInput = useCallback(
    (access: MIDIAccess, bridge: MidiAccessLike, id: string): boolean => {
      detachInput()
      if (!id) return false
      const port = access.inputs.get(id)
      if (!port || port.state !== 'connected') return false
      const input = new MidiInput({ requestAccess: () => Promise.resolve(bridge), ports: [id] })
      const disconnect = surfaceRef.current.connect(input)
      const unsubscribe = input.onMessage(handleMessage)
      const opened = input.open()
      portRef.current = {
        id,
        detach: () => {
          unsubscribe()
          disconnect()
          // `open` settles in a microtask; closing after it cannot leave a port attached.
          void opened.then(() => input.close())
        },
      }
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
      const attached = portRef.current
      if (attached && !next.some((entry) => entry.id === attached.id)) detachInput()
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
      bridgeRef.current = null
    }
  }, [detachInput])

  async function connectMidi() {
    if (!enabled || status.kind === 'unsupported' || status.kind === 'connecting') return
    if (!isWebMidiSupported()) {
      setStatus({ kind: 'unsupported' })
      return
    }

    setStatus({ kind: 'connecting' })
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false })
      if (!mountedRef.current) return
      accessRef.current = access
      bridgeRef.current = bridgeAccess(access, () => {
        if (!mountedRef.current || accessRef.current !== access) return
        refreshInputsRef.current(access)
      })
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
    const bridge = bridgeRef.current
    if (!access || !bridge) return
    if (!id) {
      detachInput()
      setSelectedId('')
      return
    }
    if (!attachInput(access, bridge, id)) {
      setSelectedId('')
      return
    }
    setSelectedId(id)
  }

  if (status.kind === 'unsupported') {
    return (
      <p className="text-xs text-al-dim" data-testid="midi-status">
        No MIDI in this browser.
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
            <span className="text-al-dim">None found.</span>
          )}
        </label>
      )}

      {status.kind === 'ready' && children}
    </div>
  )
}
