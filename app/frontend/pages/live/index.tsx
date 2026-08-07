import { Head, router } from '@inertiajs/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { AudioEngine, type ParamId } from '@/audio/audio-engine'
import DeviceStrip from './device-strip'
import { DEFAULT_REVERB_SETTINGS, type ReverbSettings } from './reverb-controls'
import type { SampleDragPayload } from './sample-drag'
import SampleBrowser from './sample-browser'
import type { SampleItem } from './sample-library'
import Timeline, { type TransportState } from './timeline'
import {
  LOOP_LENGTH_SEC,
  advancePlayhead,
  createSampleRegion,
  risingEdgeRegionIds,
  type SampleRegion,
} from './timeline-model'

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
  const [regions, setRegions] = useState<SampleRegion[]>([])
  const [playheadSec, setPlayheadSec] = useState(0)
  const [transport, setTransport] = useState<TransportState>('stopped')

  const loadedSampleIdRef = useRef<number | null>(null)
  const regionsRef = useRef(regions)
  const playheadRef = useRef(playheadSec)
  const transportRef = useRef(transport)
  regionsRef.current = regions
  playheadRef.current = playheadSec
  transportRef.current = transport

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

  function changeSetting(field: keyof ReverbSettings, param: ParamId, value: number) {
    setSettings((previous) => ({ ...previous, [field]: value }))
    engineRef.current?.setParam(param, value)
  }

  const setRegionDuration = useCallback((regionId: string, durationSec: number) => {
    setRegions((previous) =>
      previous.map((item) => (item.id === regionId ? { ...item, durationSec } : item)),
    )
  }, [])

  async function ensureSampleLoaded(sampleId: number, url: string): Promise<number | null> {
    const engine = engineRef.current
    if (!engine) return null

    if (loadedSampleIdRef.current === sampleId) {
      return null
    }

    const response = await fetch(url)
    const encoded = await response.arrayBuffer()
    const { durationSec } = await engine.decodeAndLoadSample(encoded)
    loadedSampleIdRef.current = sampleId
    return durationSec
  }

  async function playSample(sample: SampleItem) {
    const engine = engineRef.current
    if (!engine || loadingSampleId !== null) return
    setLoadingSampleId(sample.id)
    try {
      await ensureSampleLoaded(sample.id, sample.url)
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

  const triggerRegion = useCallback(
    async (region: SampleRegion) => {
      const engine = engineRef.current
      if (!engine) return
      try {
        const durationSec = await ensureSampleLoaded(region.sampleId, region.url)
        if (durationSec != null) setRegionDuration(region.id, durationSec)
        engine.playSample()
        setPlayingSampleId(region.sampleId)
      } catch {
        // Unknown/unreachable sample — skip without throwing (U3 edge).
      }
    },
    [setRegionDuration],
  )

  useEffect(() => {
    if (transport !== 'playing') return

    let frame = 0
    let lastTs: number | null = null

    const tick = (ts: number) => {
      if (transportRef.current !== 'playing') return

      if (lastTs == null) {
        lastTs = ts
        frame = requestAnimationFrame(tick)
        return
      }

      const deltaSec = Math.min((ts - lastTs) / 1000, 0.1)
      lastTs = ts

      const previous = playheadRef.current
      const next = advancePlayhead(previous, deltaSec, LOOP_LENGTH_SEC)
      playheadRef.current = next
      setPlayheadSec(next)

      const hitIds = risingEdgeRegionIds(previous, next, regionsRef.current, LOOP_LENGTH_SEC)
      for (const id of hitIds) {
        const region = regionsRef.current.find((entry) => entry.id === id)
        if (region) void triggerRegion(region)
      }

      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [transport, triggerRegion])

  function handleTransportChange(next: TransportState) {
    if (next === 'stopped') {
      setTransport('stopped')
      setPlayheadSec(0)
      playheadRef.current = 0
      engineRef.current?.stopSample()
      setPlayingSampleId(null)
      return
    }
    // Keep playhead where it is on play/pause so an in-region start does not
    // auto-fire (KTD9 rising-edge uses the current playhead as previous).
    setTransport(next)
  }

  function handleDropSample(sample: SampleDragPayload, startSec: number) {
    const region = createSampleRegion({
      sampleId: sample.sampleId,
      name: sample.name,
      url: sample.url,
      startSec,
    })
    setRegions((previous) => [...previous, region])

    // Eager decode to replace placeholder duration when audio is already started.
    if (!engineRef.current) return
    void (async () => {
      try {
        const durationSec = await ensureSampleLoaded(sample.sampleId, sample.url)
        if (durationSec == null) return
        setRegionDuration(region.id, durationSec)
      } catch {
        // Keep placeholder duration if decode fails.
      }
    })()
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <Head title="Ambient Live" />

      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-zinc-900 px-4 py-3">
        <h1 className="text-lg font-medium tracking-wide">Ambient Live</h1>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {!started ? (
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                onClick={() => void startAudio()}
                disabled={starting}
                className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-500 disabled:opacity-50"
              >
                {starting ? 'Starting…' : 'Start audio'}
              </button>
              {startError && <p className="max-w-xs text-right text-xs text-red-400">{startError}</p>}
            </div>
          ) : (
            <span className="text-xs text-teal-500/80" data-testid="audio-started">
              Audio live
            </span>
          )}
          <div className="flex items-center gap-2" aria-label="Output level">
            <span className="text-xs text-zinc-500">out</span>
            <div className="h-2 w-32 overflow-hidden rounded-full bg-zinc-900 sm:w-40">
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

      <div className="flex min-h-0 flex-1">
        <SampleBrowser
          samples={samples}
          enabled={started && loadingSampleId === null}
          playingSampleId={playingSampleId}
          onPlay={(sample) => void playSample(sample)}
          onStop={stopSample}
        />
        <Timeline
          regions={regions}
          playheadSec={playheadSec}
          transport={transport}
          onTransportChange={handleTransportChange}
          onSeek={(timeSec) => {
            setPlayheadSec(timeSec)
            playheadRef.current = timeSec
          }}
          onDropSample={handleDropSample}
        />
      </div>

      <DeviceStrip
        enabled={started}
        settings={settings}
        onChange={changeSetting}
        onNoteOn={noteOn}
        onMidiNoteOn={acquireNote}
        onNoteOff={releaseNote}
      />
    </div>
  )
}
