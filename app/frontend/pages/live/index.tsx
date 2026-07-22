import { Head, router } from '@inertiajs/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { AudioEngine, type ParamId } from '@/audio/audio-engine'
import Keyboard from './keyboard'
import MidiControls from './midi-controls'
import ReverbControls, { DEFAULT_REVERB_SETTINGS, type ReverbSettings } from './reverb-controls'
import SampleLibrary, { type SampleItem } from './sample-library'

interface LiveProps {
  samples: SampleItem[]
}

export default function Live({ samples }: LiveProps) {
  const engineRef = useRef<AudioEngine | null>(null)
  const [started, setStarted] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const [settings, setSettings] = useState<ReverbSettings>(DEFAULT_REVERB_SETTINGS)
  const [playingSampleId, setPlayingSampleId] = useState<number | null>(null)
  const [loadingSampleId, setLoadingSampleId] = useState<number | null>(null)

  // Engine state never comes from Inertia props (plan R16): the engine boots
  // from a user gesture and owns its own state; props carry the sample list.
  async function startAudio() {
    if (engineRef.current || starting) return
    setStarting(true)
    setStartError(null)
    try {
      const engine = await AudioEngine.start()
      engineRef.current = engine
      setStarted(true)
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error))
    } finally {
      setStarting(false)
    }
  }

  useEffect(() => {
    if (!started) return
    let frame = 0
    const poll = () => {
      const engine = engineRef.current
      // Quantize so idle/steady frames set an identical value and React
      // skips the re-render instead of updating at 60fps.
      if (engine) setLevel(Math.round(engine.outputLevel() * 200) / 200)
      frame = requestAnimationFrame(poll)
    }
    frame = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(frame)
  }, [started])

  useEffect(() => {
    return () => {
      void engineRef.current?.close()
      engineRef.current = null
    }
  }, [])

  // Refcount overlapping keyboard + MIDI holds so one input releasing a
  // shared noteId does not cut a voice the other input still owns.
  const noteHoldCounts = useRef(new Map<number, number>())

  const acquireNote = useCallback((noteId: number, frequency: number, gain: number) => {
    const next = (noteHoldCounts.current.get(noteId) ?? 0) + 1
    noteHoldCounts.current.set(noteId, next)
    if (next === 1) engineRef.current?.noteOn(noteId, frequency, gain)
  }, [])

  const releaseNote = useCallback((noteId: number) => {
    const current = noteHoldCounts.current.get(noteId) ?? 0
    if (current <= 1) {
      noteHoldCounts.current.delete(noteId)
      engineRef.current?.noteOff(noteId)
      return
    }
    noteHoldCounts.current.set(noteId, current - 1)
  }, [])

  const noteOn = useCallback(
    (noteId: number, frequency: number) => {
      acquireNote(noteId, frequency, 0.4)
    },
    [acquireNote],
  )
  const midiNoteOn = useCallback(
    (noteId: number, frequency: number, gain: number) => {
      acquireNote(noteId, frequency, gain)
    },
    [acquireNote],
  )
  const noteOff = useCallback(
    (noteId: number) => {
      releaseNote(noteId)
    },
    [releaseNote],
  )

  function changeSetting(field: keyof ReverbSettings, param: ParamId, value: number) {
    setSettings((previous) => ({ ...previous, [field]: value }))
    engineRef.current?.setParam(param, value)
  }

  async function playSample(sample: SampleItem) {
    const engine = engineRef.current
    if (!engine || loadingSampleId !== null) return
    setLoadingSampleId(sample.id)
    try {
      const response = await fetch(sample.url)
      const encoded = await response.arrayBuffer()
      await engine.decodeAndLoadSample(encoded)
      engine.playSample()
      setPlayingSampleId(sample.id)
    } catch {
      setPlayingSampleId(null)
    } finally {
      setLoadingSampleId(null)
    }
  }

  function stopSample() {
    engineRef.current?.stopSample()
    setPlayingSampleId(null)
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Head title="Ambient Live" />

      <header className="flex items-center justify-between border-b border-zinc-900 px-6 py-4">
        <h1 className="text-lg font-medium tracking-wide">Ambient Live</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2" aria-label="Output level">
            <span className="text-xs text-zinc-500">out</span>
            <div className="h-2 w-40 overflow-hidden rounded-full bg-zinc-900">
              <div
                data-testid="output-meter"
                data-level={level.toFixed(3)}
                aria-hidden="true"
                className="h-full rounded-full bg-teal-500 transition-[width] duration-75"
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.delete('/session')}
            className="text-sm text-zinc-500 transition hover:text-zinc-300"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-10 px-6 py-10">
        {!started && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
            <p className="mb-4 text-zinc-400">
              The engine boots on a gesture — browsers require one to start audio.
            </p>
            <button
              type="button"
              onClick={() => void startAudio()}
              disabled={starting}
              className="rounded-md bg-teal-600 px-6 py-3 font-medium text-white transition hover:bg-teal-500 disabled:opacity-50"
            >
              {starting ? 'Starting…' : 'Start audio'}
            </button>
            {startError && <p className="mt-3 text-sm text-red-400">{startError}</p>}
          </section>
        )}

        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-widest text-zinc-500">Play</h2>
          <Keyboard enabled={started} onNoteOn={noteOn} onNoteOff={noteOff} />
          <p className="mt-2 text-xs text-zinc-600">
            Hold keys (pointer or the marked computer keys) — releases fade into the reverb tail.
          </p>
          <MidiControls enabled={started} onNoteOn={midiNoteOn} onNoteOff={noteOff} />
        </section>

        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-widest text-zinc-500">Reverb</h2>
          <ReverbControls enabled={started} settings={settings} onChange={changeSetting} />
        </section>

        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-widest text-zinc-500">
            Samples
          </h2>
          <SampleLibrary
            samples={samples}
            enabled={started && loadingSampleId === null}
            playingSampleId={playingSampleId}
            onPlay={(sample) => void playSample(sample)}
            onStop={stopSample}
          />
        </section>
      </main>
    </div>
  )
}
