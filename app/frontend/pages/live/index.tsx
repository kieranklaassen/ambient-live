import { Head, router } from '@inertiajs/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { AudioEngine, type ParamId } from '@/audio/audio-engine'
import DeviceStrip from './device-strip'
import type { ShortcutAction } from './keymap'
import { revokeLocalSampleUrls } from './local-folder'
import { DEFAULT_REVERB_SETTINGS, type ReverbSettings } from './reverb-controls'
import SampleBrowser from './sample-browser'
import type { SampleDragPayload } from './sample-drag'
import type { SampleItem } from './sample-library'
import ShortcutOverlay from './shortcut-overlay'
import Timeline, { type TransportState } from './timeline'
import {
  LOOP_LENGTH_SEC,
  advancePlayhead,
  createSampleRegion,
  risingEdgeRegions,
  type SampleRegion,
} from './timeline-model'
import { useLiveShortcuts } from './use-live-shortcuts'

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
  const [loopEnabled, setLoopEnabled] = useState(true)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [localSamples, setLocalSamples] = useState<SampleItem[]>([])
  const [localFolderName, setLocalFolderName] = useState<string | null>(null)

  const loadedSampleIdRef = useRef<number | null>(null)
  const sampleLoadMutexRef = useRef(Promise.resolve())
  const sampleDurationsRef = useRef(new Map<number, number>())
  const regionTriggerSeqRef = useRef(0)
  const latestTriggerSampleIdRef = useRef<number | null>(null)
  const regionsRef = useRef(regions)
  const playheadRef = useRef(playheadSec)
  const transportRef = useRef(transport)
  const loopEnabledRef = useRef(loopEnabled)
  const localSamplesRef = useRef(localSamples)
  // Keep rAF / cleanup readers current without an extra effect tick.
  regionsRef.current = regions
  transportRef.current = transport
  loopEnabledRef.current = loopEnabled
  localSamplesRef.current = localSamples

  useEffect(() => () => {
    revokeLocalSampleUrls(localSamplesRef.current)
  }, [])

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

  useEffect(
    () => () => {
      void engineRef.current?.close()
      engineRef.current = null
    },
    [],
  )

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

    const previous = sampleLoadMutexRef.current
    let releaseMutex = () => {}
    sampleLoadMutexRef.current = new Promise<void>((resolve) => {
      releaseMutex = resolve
    })
    await previous

    try {
      if (loadedSampleIdRef.current === sampleId) {
        // Cached hit: still report the decoded duration so regions dropped
        // after an audition or earlier drop get their real width.
        return sampleDurationsRef.current.get(sampleId) ?? null
      }
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Sample fetch failed (${response.status})`)
      }
      const encoded = await response.arrayBuffer()
      const { durationSec } = await engine.decodeAndLoadSample(encoded)
      loadedSampleIdRef.current = sampleId
      sampleDurationsRef.current.set(sampleId, durationSec)
      return durationSec
    } finally {
      releaseMutex()
    }
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
      const triggerSeq = ++regionTriggerSeqRef.current
      latestTriggerSampleIdRef.current = region.sampleId
      try {
        const durationSec = await ensureSampleLoaded(region.sampleId, region.url)
        if (durationSec != null) setRegionDuration(region.id, durationSec)
        // Only the most recent trigger may start playback; a slow load must
        // not fire late after a newer trigger or after the transport stopped.
        if (triggerSeq !== regionTriggerSeqRef.current || transportRef.current !== 'playing') return
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
      let next: number
      if (loopEnabledRef.current) {
        next = advancePlayhead(previous, deltaSec, LOOP_LENGTH_SEC)
      } else {
        const unwrapped = previous + deltaSec
        if (unwrapped >= LOOP_LENGTH_SEC) {
          next = LOOP_LENGTH_SEC
          playheadRef.current = next
          setPlayheadSec(LOOP_LENGTH_SEC)
          for (const region of risingEdgeRegions(
            previous,
            next,
            regionsRef.current,
            LOOP_LENGTH_SEC,
          )) {
            void triggerRegion(region)
          }
          setTransport('paused')
          return
        }
        next = unwrapped
      }
      // Keep full-precision playhead in the ref for rising-edge detection;
      // quantize React state to the 0.01s readout so steady frames bail out.
      playheadRef.current = next
      const quantized = Math.round(next * 100) / 100
      setPlayheadSec((prev) => (prev === quantized ? prev : quantized))

      for (const region of risingEdgeRegions(previous, next, regionsRef.current, LOOP_LENGTH_SEC)) {
        void triggerRegion(region)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [transport, triggerRegion])

  function handleTransportChange(next: TransportState) {
    // Sync the ref before the re-render so in-flight triggerRegion loads see
    // Stop/Pause immediately instead of one frame late.
    transportRef.current = next
    if (next === 'stopped') {
      setTransport('stopped')
      setPlayheadSec(0)
      playheadRef.current = 0
      return
    }
    // Keep playhead where it is on play/pause so an in-region start does not
    // auto-fire (KTD9 rising-edge uses the current playhead as previous).
    setTransport(next)
  }

  function seekPlayhead(timeSec: number) {
    setPlayheadSec(timeSec)
    playheadRef.current = timeSec
  }

  function handleShortcut(action: ShortcutAction) {
    switch (action) {
      case 'transport.spaceStop':
        // Ableton Space: stop returns to start; play always starts from 0.
        if (transportRef.current === 'playing') {
          handleTransportChange('stopped')
          return
        }
        seekPlayhead(0)
        setTransport('playing')
        return
      case 'transport.continue':
        // Shift+Space: pause/resume without relocating the playhead.
        setTransport(transportRef.current === 'playing' ? 'paused' : 'playing')
        return
      case 'transport.home':
        seekPlayhead(0)
        return
      case 'loop.toggle':
        setLoopEnabled((previous) => !previous)
        return
      case 'browser.focusFilter':
        document.querySelector<HTMLInputElement>('[data-testid="sample-filter"]')?.focus()
        return
      case 'overlay.shortcuts':
        setShortcutsOpen(true)
        return
      case 'overlay.dismiss':
        if (shortcutsOpen) {
          setShortcutsOpen(false)
          return
        }
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur()
        }
        return
      default: {
        const _exhaustive: never = action
        return _exhaustive
      }
    }
  }

  useLiveShortcuts({ onAction: handleShortcut, overlayOpen: shortcutsOpen })

  function handleDropSample(sample: SampleDragPayload, startSec: number) {
    const region = createSampleRegion({
      sampleId: sample.sampleId,
      name: sample.name,
      url: sample.url,
      startSec,
    })
    setRegions((previous) => [...previous, region])
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
    <main className="workstation-shell sg-grid sg-compact">
      <Head title="Ambient Live" />
      <ShortcutOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <header className="workstation-region sg-col-1 sg-span-edge sg-row-1 sg-rows-2 half:sg-rows-1 full:sg-rows-1 flex items-center justify-between gap-3 border-b border-al-border bg-al-panel sg-p-1">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-medium uppercase tracking-[0.12em] text-al-text sg-leading-3">
            Ambient Live
          </h1>
          <span className="hidden text-[10px] uppercase tracking-wider text-al-dim sm:inline">
            Session
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!started ? (
            <div className="flex flex-col items-end gap-0.5">
              <button
                type="button"
                onClick={() => void startAudio()}
                disabled={starting}
                className="rounded-[1px] border border-al-accent bg-al-accent px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-al-chrome disabled:opacity-50"
              >
                {starting ? 'Starting…' : 'Start audio'}
              </button>
              {startError && (
                <p className="max-w-xs text-right text-[11px] text-al-danger">{startError}</p>
              )}
            </div>
          ) : (
            <span
              className="rounded-[1px] border border-al-hairline bg-al-sunken px-2 py-0.5 text-[10px] uppercase tracking-wide text-al-accent"
              data-testid="audio-started"
            >
              Audio live
            </span>
          )}
          <div className="flex items-center gap-1.5" aria-label="Output level">
            <span className="text-[10px] uppercase tracking-wide text-al-dim">Out</span>
            <div className="h-1.5 w-28 overflow-hidden rounded-[1px] border border-al-border bg-al-sunken sm:w-36">
              <div
                data-testid="output-meter"
                data-level={level.toFixed(3)}
                aria-hidden="true"
                className="h-full bg-al-accent transition-[width] duration-75"
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.delete('/session')}
            className="rounded-[1px] px-2 py-1 text-[11px] uppercase tracking-wide text-al-muted hover:text-al-text"
          >
            Sign out
          </button>
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
        onLocalSamplesChange={(next, folderName) => {
          const nextIds = new Set(next.map((sample) => sample.id))
          const removedIds = new Set(
            localSamples
              .filter((sample) => !nextIds.has(sample.id))
              .map((sample) => sample.id),
          )
          if (removedIds.size > 0) {
            // Invalidate the in-flight timeline trigger so a slow load for a
            // removed sample cannot start playback after clear/replace. Only
            // the latest trigger can play, so bump the sequence only when it
            // targets a removed sample — otherwise a surviving (e.g. library)
            // region's pending trigger would be cancelled too.
            if (
              latestTriggerSampleIdRef.current != null &&
              removedIds.has(latestTriggerSampleIdRef.current)
            ) {
              regionTriggerSeqRef.current++
            }
            setRegions((previous) =>
              previous.filter((region) => !removedIds.has(region.sampleId)),
            )
            if (playingSampleId != null && removedIds.has(playingSampleId)) {
              stopSample()
            }
            if (
              loadedSampleIdRef.current != null &&
              removedIds.has(loadedSampleIdRef.current)
            ) {
              loadedSampleIdRef.current = null
            }
            for (const id of removedIds) {
              sampleDurationsRef.current.delete(id)
            }
          }
          setLocalSamples(next)
          setLocalFolderName(folderName)
        }}
      />
      <Timeline
        className="sg-col-5 half:sg-col-4 full:sg-col-4 sg-span-edge sg-row-3 half:sg-row-2 full:sg-row-2 sg-rows-20 half:sg-rows-14 full:sg-rows-9"
        regions={regions}
        playheadSec={playheadSec}
        transport={transport}
        loopEnabled={loopEnabled}
        onLoopEnabledChange={setLoopEnabled}
        onTransportChange={handleTransportChange}
        onSeek={seekPlayhead}
        onDropSample={handleDropSample}
      />
      <DeviceStrip
        className="sg-col-1 sg-span-edge sg-row-23 half:sg-row-16 full:sg-row-11 sg-rows-5 half:sg-rows-3 full:sg-rows-2"
        enabled={started}
        settings={settings}
        onChange={changeSetting}
        onNoteOn={noteOn}
        onMidiNoteOn={acquireNote}
        onNoteOff={releaseNote}
      />
    </main>
  )
}
