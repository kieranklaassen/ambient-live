import { Head, router } from '@inertiajs/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { AudioEngine, type ParamId } from '@/audio/audio-engine'
import DeviceStrip from './device-strip'
import { revokeLocalSampleUrls } from './local-folder'
import { DEFAULT_REVERB_SETTINGS, type ReverbSettings } from './reverb-controls'
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
  const [localSamples, setLocalSamples] = useState<SampleItem[]>([])
  const [localFolderName, setLocalFolderName] = useState<string | null>(null)

  const loadedSampleIdRef = useRef<number | null>(null)
  const regionsRef = useRef(regions)
  const playheadRef = useRef(playheadSec)
  const transportRef = useRef(transport)
  const localSamplesRef = useRef(localSamples)
  useEffect(() => { regionsRef.current = regions }, [regions])
  useEffect(() => { playheadRef.current = playheadSec }, [playheadSec])
  useEffect(() => { transportRef.current = transport }, [transport])
  useEffect(() => { localSamplesRef.current = localSamples }, [localSamples])
  useEffect(() => () => { revokeLocalSampleUrls(localSamplesRef.current) }, [])

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
      if (engine) setLevel(Math.round(engine.outputLevel() * 200) / 200)
      frame = requestAnimationFrame(poll)
    }
    frame = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(frame)
  }, [started])

  useEffect(() => () => { void engineRef.current?.close(); engineRef.current = null }, [])

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
  const noteOn = useCallback((noteId: number, frequency: number) => { acquireNote(noteId, frequency, 0.4) }, [acquireNote])
  const midiNoteOn = useCallback((noteId: number, frequency: number, gain: number) => { acquireNote(noteId, frequency, gain) }, [acquireNote])
  const noteOff = useCallback((noteId: number) => { releaseNote(noteId) }, [releaseNote])

  function changeSetting(field: keyof ReverbSettings, param: ParamId, value: number) {
    setSettings((previous) => ({ ...previous, [field]: value }))
    engineRef.current?.setParam(param, value)
  }

  async function ensureSampleLoaded(sampleId: number, url: string): Promise<number | null> {
    const engine = engineRef.current
    if (!engine) return null
    if (loadedSampleIdRef.current === sampleId) return null
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

  const triggerRegion = useCallback(async (region: SampleRegion) => {
    const engine = engineRef.current
    if (!engine) return
    try {
      const durationSec = await ensureSampleLoaded(region.sampleId, region.url)
      if (durationSec != null) {
        setRegions((previous) => previous.map((item) => (item.id === region.id ? { ...item, durationSec } : item)))
      }
      engine.playSample()
      setPlayingSampleId(region.sampleId)
    } catch {
      // skip
    }
  }, [])

  useEffect(() => {
    if (transport !== 'playing') return
    let frame = 0
    let lastTs: number | null = null
    const tick = (ts: number) => {
      if (transportRef.current !== 'playing') return
      if (lastTs == null) { lastTs = ts; frame = requestAnimationFrame(tick); return }
      const deltaSec = Math.min((ts - lastTs) / 1000, 0.1)
      lastTs = ts
      const previous = playheadRef.current
      const next = advancePlayhead(previous, deltaSec, LOOP_LENGTH_SEC)
      playheadRef.current = next
      setPlayheadSec(next)
      const hitIds = risingEdgeRegionIds(previous, next, regionsRef.current, LOOP_LENGTH_SEC)
      if (hitIds.length > 0) {
        const byId = new Map(regionsRef.current.map((region) => [region.id, region]))
        for (const id of hitIds) {
          const region = byId.get(id)
          if (region) void triggerRegion(region)
        }
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
      return
    }
    setTransport(next)
  }

  function handleDropSample(sample: { sampleId: number; name: string; url: string }, startSec: number) {
    const region = createSampleRegion({ sampleId: sample.sampleId, name: sample.name, url: sample.url, startSec })
    setRegions((previous) => [...previous, region])
    if (!engineRef.current) return
    void (async () => {
      try {
        const durationSec = await ensureSampleLoaded(sample.sampleId, sample.url)
        if (durationSec == null) return
        setRegions((previous) => previous.map((item) => (item.id === region.id ? { ...item, durationSec } : item)))
      } catch {
        // keep placeholder
      }
    })()
  }

  return (
    <main className="workstation-shell sg-grid sg-compact">
      <Head title="Ambient Live" />
      <header className="workstation-region sg-col-1 sg-span-edge sg-row-1 sg-rows-2 half:sg-rows-1 full:sg-rows-1 flex items-center justify-between gap-3 border-b border-al-border bg-al-panel sg-p-1">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-medium uppercase tracking-[0.12em] text-al-text sg-leading-3">Ambient Live</h1>
          <span className="hidden text-[10px] uppercase tracking-wider text-al-dim sm:inline">Session</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!started ? (
            <div className="flex flex-col items-end gap-0.5">
              <button type="button" onClick={() => void startAudio()} disabled={starting} className="rounded-[1px] border border-al-accent bg-al-accent px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-al-chrome disabled:opacity-50">
                {starting ? 'Starting…' : 'Start audio'}
              </button>
              {startError && <p className="max-w-xs text-right text-[11px] text-al-danger">{startError}</p>}
            </div>
          ) : (
            <span className="rounded-[1px] border border-al-hairline bg-al-sunken px-2 py-0.5 text-[10px] uppercase tracking-wide text-al-accent" data-testid="audio-started">Audio live</span>
          )}
          <div className="flex items-center gap-1.5" aria-label="Output level">
            <span className="text-[10px] uppercase tracking-wide text-al-dim">Out</span>
            <div className="h-1.5 w-28 overflow-hidden rounded-[1px] border border-al-border bg-al-sunken sm:w-36">
              <div data-testid="output-meter" data-level={level.toFixed(3)} aria-hidden="true" className="h-full bg-al-accent transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
          </div>
          <button type="button" onClick={() => router.delete('/session')} className="rounded-[1px] px-2 py-1 text-[11px] uppercase tracking-wide text-al-muted hover:text-al-text">Sign out</button>
        </div>
      </header>

      <SampleBrowser
        className="sg-col-1 sg-span-4 half:sg-span-3 full:sg-span-3 sg-row-3 half:sg-row-2 full:sg-row-2 sg-rows-20 half:sg-rows-14 full:sg-rows-9"
        samples={samples}
        localSamples={localSamples}
        localFolderName={localFolderName}
        enabled={started && loadingSampleId === null}
        playingSampleId={playingSampleId}
        onPlay={(sample) => void playSample(sample)}
        onStop={stopSample}
        onLocalSamplesChange={(next, folderName) => { setLocalSamples(next); setLocalFolderName(folderName) }}
      />
      <Timeline
        className="sg-col-5 half:sg-col-4 full:sg-col-4 sg-span-edge sg-row-3 half:sg-row-2 full:sg-row-2 sg-rows-20 half:sg-rows-14 full:sg-rows-9"
        regions={regions}
        playheadSec={playheadSec}
        transport={transport}
        onTransportChange={handleTransportChange}
        onSeek={(timeSec) => { setPlayheadSec(timeSec); playheadRef.current = timeSec }}
        onDropSample={handleDropSample}
      />
      <DeviceStrip
        className="sg-col-1 sg-span-edge sg-row-23 half:sg-row-16 full:sg-row-11 sg-rows-5 half:sg-rows-3 full:sg-rows-2"
        enabled={started}
        settings={settings}
        onChange={changeSetting}
        onNoteOn={noteOn}
        onMidiNoteOn={midiNoteOn}
        onNoteOff={noteOff}
      />
    </main>
  )
}
