import { Head, router } from '@inertiajs/react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { AudioEngine, type LoadedSample, type ParamId } from '@/audio/audio-engine'
import { ClipPlayer } from '@/audio/clip-player'
import type { WaveformPeaks } from '@/audio/waveform'
import DeviceStrip from './device-strip'
import type { ShortcutAction } from './keymap'
import { revokeLocalSampleUrls } from './local-folder'
import PaneSplitter from './pane-splitter'
import { DEFAULT_REVERB_SETTINGS, type ReverbSettings } from './reverb-controls'
import SampleBrowser from './sample-browser'
import { isAllowedSampleUrl, type SampleDragPayload } from './sample-drag'
import type { SampleItem } from './sample-library'
import ShortcutOverlay from './shortcut-overlay'
import Timeline from './timeline'
import { applySourceDuration, effectiveFades } from './timeline-clips'
import { createSampleRegion, type SampleRegion } from './timeline-model'
import { useClipTransport } from './use-clip-transport'
import { useLiveShortcuts } from './use-live-shortcuts'
import { useWorkstationPanes } from './use-workstation-panes'
import { paneVars } from './workstation-layout'

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
  const [loopEnabled, setLoopEnabled] = useState(true)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [localSamples, setLocalSamples] = useState<SampleItem[]>([])
  const [localFolderName, setLocalFolderName] = useState<string | null>(null)
  const [peaksBySampleId, setPeaksBySampleId] = useState<ReadonlyMap<number, WaveformPeaks>>(
    new Map(),
  )

  const {
    shellRef,
    layout,
    dragging,
    startBrowserDrag,
    moveBrowserDrag,
    startDeviceDrag,
    moveDeviceDrag,
    endDrag,
  } = useWorkstationPanes()

  const clipFades = useMemo(() => effectiveFades(regions), [regions])

  const sampleLoadMutexRef = useRef(Promise.resolve())
  const clipPlayerRef = useRef<ClipPlayer | null>(null)
  const regionsRef = useRef(regions)
  const localSamplesRef = useRef(localSamples)
  regionsRef.current = regions
  localSamplesRef.current = localSamples

  const { transport, transportRef, playheadSec, changeTransport, seek, resetSchedule } =
    useClipTransport({ engineRef, clipPlayerRef, clips: regions, clipFades, loopEnabled })

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
      clipPlayerRef.current = new ClipPlayer(engine)
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
      clipPlayerRef.current?.stopAll()
      clipPlayerRef.current = null
      void engineRef.current?.close()
      engineRef.current = null
    },
    [],
  )

  // Clips dropped before audio started have no decoded buffer. Load them once
  // the engine exists so they can play and draw their waveform; clips dropped
  // after that are loaded by the drop handler.
  useEffect(() => {
    if (!started) return
    for (const region of regionsRef.current) {
      void loadRegionSource(region)
    }
  }, [started])

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

  const setRegionDuration = useCallback((regionId: string, sourceDurationSec: number) => {
    setRegions((previous) =>
      previous.map((item) =>
        item.id === regionId ? applySourceDuration(item, sourceDurationSec) : item,
      ),
    )
  }, [])

  const changeClip = useCallback((clip: SampleRegion) => {
    setRegions((previous) => previous.map((item) => (item.id === clip.id ? clip : item)))
  }, [])

  async function ensureSampleLoaded(sampleId: number, url: string): Promise<LoadedSample | null> {
    const engine = engineRef.current
    if (!engine) return null
    if (!isAllowedSampleUrl(url)) return null

    const cached = engine.sample(sampleId)
    if (cached) return cached

    // Serialize fetch+decode so two drops of the same sample decode once.
    const previous = sampleLoadMutexRef.current
    let releaseMutex = () => {}
    sampleLoadMutexRef.current = new Promise<void>((resolve) => {
      releaseMutex = resolve
    })
    await previous

    try {
      const already = engine.sample(sampleId)
      if (already) return already
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Sample fetch failed (${response.status})`)
      }
      const loaded = await engine.loadSample(sampleId, await response.arrayBuffer())
      setPeaksBySampleId((previous) => new Map(previous).set(sampleId, loaded.peaks))
      return loaded
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
      engine.playSample(sample.id)
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

  /** Decodes a clip's sample and gives the clip its real length. */
  async function loadRegionSource(region: SampleRegion) {
    if (!engineRef.current) return
    try {
      const loaded = await ensureSampleLoaded(region.sampleId, region.url)
      if (loaded) setRegionDuration(region.id, loaded.durationSec)
    } catch {
      // Unreachable sample — the clip keeps its placeholder width.
    }
  }

  function handleShortcut(action: ShortcutAction) {
    switch (action) {
      case 'transport.spaceStop':
        // Ableton Space: stop returns to start; play always starts from 0.
        if (transportRef.current === 'playing') {
          changeTransport('stopped')
          return
        }
        seek(0)
        changeTransport('playing')
        return
      case 'transport.continue':
        // Shift+Space: pause/resume without relocating the playhead.
        changeTransport(transportRef.current === 'playing' ? 'paused' : 'playing')
        return
      case 'transport.home':
        seek(0)
        return
      case 'loop.toggle':
        setLoopEnabled((previous) => !previous)
        return
      case 'browser.focusFilter':
        document.querySelector<HTMLInputElement>('[data-testid="sample-filter"]')?.focus()
        return
      case 'keyboard.octaveDown':
      case 'keyboard.octaveUp':
        // Keyboard owns the octave offset; keymap still resolves these so the
        // cheat sheet and preventDefault stay centralized.
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
    void loadRegionSource(region)
  }

  return (
    <main
      ref={shellRef}
      className={`workstation-shell sg-grid sg-compact antialiased${dragging ? ' sg-guides-rhythm' : ''}`}
      style={{ '--al-row-count': layout.rowCount } as CSSProperties}
    >
      <Head title="Ambient Live" />
      <ShortcutOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <header
        className="workstation-region sg-col-1 sg-span-edge sg-row-1 sg-rows-1 flex items-center justify-between gap-3 border-b border-al-border bg-al-panel px-sg-2"
        style={paneVars({ row: 1, rows: layout.headerRows })}
      >
        <h1 className="text-[11px] font-medium uppercase tracking-[0.16em] text-al-text sg-leading-2">
          Ambient Live
        </h1>
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
              className="size-1.5 rounded-[1px] bg-al-accent"
              data-testid="audio-started"
              title="Audio live"
            />
          )}
          <div className="flex items-center gap-1.5" aria-label="Output level">
            <div className="h-1.5 w-24 overflow-hidden rounded-[1px] border border-al-border bg-al-sunken sm:w-32">
              <div
                data-testid="output-meter"
                data-level={level.toFixed(3)}
                aria-hidden="true"
                className="h-full bg-al-accent"
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.delete('/session')}
            className="rounded-[1px] px-2 py-1 text-[11px] uppercase tracking-wide text-al-dim hover:text-al-text"
          >
            Sign out
          </button>
        </div>
      </header>

      <SampleBrowser
        className="relative sg-col-1 sg-span-1 sg-row-1 sg-rows-1"
        style={paneVars({
          col: 1,
          span: layout.browserCols,
          row: layout.contentStart,
          rows: layout.contentRows,
        })}
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
            // Clips for a sample that just went away must not keep sounding,
            // and the queue is re-derived from what survives.
            setRegions((previous) =>
              previous.filter((region) => !removedIds.has(region.sampleId)),
            )
            if (playingSampleId != null && removedIds.has(playingSampleId)) {
              stopSample()
            }
            resetSchedule()
            for (const id of removedIds) {
              engineRef.current?.forgetSample(id)
            }
            setPeaksBySampleId((previous) => {
              const next = new Map(previous)
              for (const id of removedIds) next.delete(id)
              return next
            })
          }
          setLocalSamples(next)
          setLocalFolderName(folderName)
        }}
      >
        <PaneSplitter
          orientation="vertical"
          label="Resize browser"
          testId="pane-splitter-browser"
          onPointerDown={startBrowserDrag}
          onPointerMove={moveBrowserDrag}
          onPointerUp={endDrag}
        />
      </SampleBrowser>
      <Timeline
        className="sg-col-1 sg-span-edge sg-row-1 sg-rows-1"
        style={paneVars({
          col: layout.timelineCol,
          row: layout.contentStart,
          rows: layout.contentRows,
        })}
        regions={regions}
        clipFades={clipFades}
        peaksBySampleId={peaksBySampleId}
        playheadSec={playheadSec}
        transport={transport}
        loopEnabled={loopEnabled}
        onLoopEnabledChange={setLoopEnabled}
        onTransportChange={changeTransport}
        onSeek={seek}
        onDropSample={handleDropSample}
        onClipChange={changeClip}
      />
      <DeviceStrip
        className="relative sg-col-1 sg-span-edge sg-row-1 sg-rows-1"
        style={paneVars({
          row: layout.deviceStart,
          rows: layout.deviceRows,
        })}
        enabled={started}
        settings={settings}
        onChange={changeSetting}
        onNoteOn={noteOn}
        onMidiNoteOn={acquireNote}
        onNoteOff={releaseNote}
      >
        <PaneSplitter
          orientation="horizontal"
          label="Resize devices"
          testId="pane-splitter-devices"
          onPointerDown={startDeviceDrag}
          onPointerMove={moveDeviceDrag}
          onPointerUp={endDrag}
        />
      </DeviceStrip>
    </main>
  )
}
