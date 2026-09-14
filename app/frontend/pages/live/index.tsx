import { Head, router } from '@inertiajs/react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import type { StorageLike, WaveformPeaks } from '@kieranklaassen/live-mix'
import { LiveMixProvider, Meter, type MeterSnapshot } from '@kieranklaassen/live-mix/react'

import type { ContextLatency } from '@/audio/latency'
import type { RoundTripMeasurement } from '@/audio/latency-probe'
import {
  clampLiveControl,
  createLiveControlSurface,
  defaultLiveControls,
  liveControl,
  liveControlFor,
  liveControlFromUnit,
  unitFromLiveControl,
  type LiveControlId,
  type LiveControlValues,
} from '@/audio/live-controls'
import { LIVE_INPUT_CONSTRAINTS, LiveEngine, type LoadedSample } from '@/audio/live-engine'
import DeviceStrip from './device-strip'
import type { ShortcutAction } from './keymap'
import { type LiveInputState } from './live-input-controls'
import { revokeLocalSampleUrls } from './local-folder'
import PaneSplitter from './pane-splitter'
import { REVERB_SETTING_TARGETS, reverbSettingsFrom, type ReverbSettings } from './reverb-controls'
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

/** The capture side of the live input; its level, pan and monitor live in `controls`. */
interface CaptureState {
  enabled: boolean
  busy: boolean
  error: string | null
  deviceLabel: string | null
  trackLatencySec: number | null
}

const IDLE_CAPTURE: CaptureState = {
  enabled: false,
  busy: false,
  error: null,
  deviceLabel: null,
  trackLatencySec: null,
}

/** Chrome reports the capture buffer as `latency`; the DOM typings do not know it yet. */
function trackLatencySec(track: MediaStreamTrack): number | null {
  const settings = track.getSettings() as MediaTrackSettings & { latency?: number }
  return typeof settings.latency === 'number' && Number.isFinite(settings.latency)
    ? settings.latency
    : null
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    // Storage access can throw in sandboxed frames; the map then lives for the session only.
    return null
  }
}

const SILENT_READING: MeterSnapshot = {
  peak: 0,
  rms: 0,
  peakDb: -Infinity,
  lufs: null,
  lufsShortTerm: -Infinity,
  truePeakDb: -Infinity,
  hasMeter: false,
  hasLufs: false,
}

/** Master peak off the provided engine; an empty bar until audio has started. */
function OutputMeter({ live }: { live: boolean }) {
  const shared = {
    orientation: 'horizontal',
    bars: ['peak'],
    showReadout: false,
    label: 'Output level',
    'data-testid': 'output-meter',
  } as const
  return (
    <div className="w-24 sm:w-32">
      {live ? <Meter {...shared} /> : <Meter {...shared} reading={SILENT_READING} />}
    </div>
  )
}

export default function Live({ samples }: LiveProps) {
  const engineRef = useRef<LiveEngine | null>(null)
  // One surface for the page's life: it holds the stored mapping table (U27's
  // format-1 table included) before audio starts and binds to the engine once
  // there is one; every edit saves.
  const [surface] = useState(() =>
    createLiveControlSurface(() => engineRef.current, { storage: browserStorage() }),
  )
  const [started, setStarted] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [controls, setControls] = useState<LiveControlValues>(defaultLiveControls)
  const controlsRef = useRef(controls)
  controlsRef.current = controls
  const settings = useMemo(() => reverbSettingsFrom(controls), [controls])
  const [capture, setCapture] = useState<CaptureState>(IDLE_CAPTURE)
  const [latency, setLatency] = useState<ContextLatency | null>(null)
  const [measurement, setMeasurement] = useState<RoundTripMeasurement | null>(null)
  const [measuring, setMeasuring] = useState(false)
  const [measureError, setMeasureError] = useState<string | null>(null)
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
  const regionsRef = useRef(regions)
  const localSamplesRef = useRef(localSamples)
  regionsRef.current = regions
  localSamplesRef.current = localSamples

  const { transport, transportRef, playheadSec, changeTransport, seek, resetSchedule, adoptEngine } =
    useClipTransport({ engineRef, started, clips: regions, clipFades, loopEnabled })

  useEffect(() => () => {
    revokeLocalSampleUrls(localSamplesRef.current)
  }, [])

  async function startAudio() {
    if (engineRef.current || starting) return
    setStarting(true)
    setStartError(null)
    try {
      const engine = await LiveEngine.start()
      engineRef.current = engine
      adoptEngine(engine)
      setLatency(engine.latency())
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
      if (engine) {
        // Chrome fills `outputLatency` in only once audio is flowing; keep the
        // previous object while nothing changed so React skips the re-render.
        const next = engine.latency()
        setLatency((previous) =>
          previous &&
          previous.baseLatencySec === next.baseLatencySec &&
          previous.outputLatencySec === next.outputLatencySec
            ? previous
            : next,
        )
      }
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

  /** The one path every on-screen control takes — knobs, faders — into state and, through the surface, the engine. */
  const changeControl = useCallback(
    (id: LiveControlId, value: number) => {
      const spec = liveControl(id)
      const clamped = clampLiveControl(spec, value)
      controlsRef.current = { ...controlsRef.current, [id]: clamped }
      setControls(controlsRef.current)
      surface.set(spec.target, unitFromLiveControl(spec, clamped))
    },
    [surface],
  )

  function changeSetting(field: keyof ReverbSettings, value: number) {
    changeControl(REVERB_SETTING_TARGETS[field], value)
  }

  // A controller writes to the engine through the surface; the knobs follow.
  useEffect(
    () =>
      surface.onChange((change) => {
        if (change.type !== 'applied' || change.unit === null) return
        const spec = liveControlFor(change.change.target)
        if (!spec) return
        controlsRef.current = {
          ...controlsRef.current,
          [spec.id]: liveControlFromUnit(spec, change.unit),
        }
        setControls(controlsRef.current)
      }),
    [surface],
  )

  // Live input -----------------------------------------------------------------

  const liveInput: LiveInputState = useMemo(
    () => ({
      ...capture,
      monitor: controls['input.monitor'] >= 0.5,
      level: controls['input.level'],
      pan: controls['input.pan'],
    }),
    [capture, controls],
  )

  async function enableLiveInput() {
    const engine = engineRef.current
    if (!engine || capture.busy) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setCapture({ ...IDLE_CAPTURE, error: 'No audio input in this browser.' })
      return
    }
    setCapture((previous) => ({ ...previous, busy: true, error: null }))
    try {
      const stream = await navigator.mediaDevices.getUserMedia(LIVE_INPUT_CONSTRAINTS)
      const current = engineRef.current
      if (!current) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      current.enableLiveInput(stream)
      const [track] = stream.getAudioTracks()
      track?.addEventListener('ended', () => {
        // The device went away (unplugged, revoked): mirror that in the UI.
        engineRef.current?.disableLiveInput()
        setCapture(IDLE_CAPTURE)
      })
      setCapture({
        enabled: true,
        busy: false,
        error: null,
        deviceLabel: track?.label || 'Input',
        trackLatencySec: track ? trackLatencySec(track) : null,
      })
      setLatency(current.latency())
    } catch (error) {
      setCapture({
        ...IDLE_CAPTURE,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function disableLiveInput() {
    engineRef.current?.disableLiveInput()
    setCapture(IDLE_CAPTURE)
    setMeasurement(null)
  }

  async function measureLatency() {
    const engine = engineRef.current
    if (!engine || measuring) return
    setMeasuring(true)
    setMeasureError(null)
    try {
      const result = await engine.measureRoundTripLatency()
      setMeasurement(result)
      setLatency(result.context)
    } catch (error) {
      setMeasureError(error instanceof Error ? error.message : String(error))
    } finally {
      setMeasuring(false)
    }
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
      if (loaded.peaks) {
        const peaks = loaded.peaks
        setPeaksBySampleId((previous) => new Map(previous).set(sampleId, peaks))
      }
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

  // The ref does not re-render; `started` flips once the engine exists.
  const engine = started ? engineRef.current?.engine ?? null : null

  return (
    <LiveMixProvider engine={engine}>
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
            <OutputMeter live={started} />
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
          surface={surface}
          liveInput={{
            input: liveInput,
            latency,
            measurement,
            measuring,
            measureError,
            onInputEnabledChange: (enabled) => {
              if (enabled) void enableLiveInput()
              else disableLiveInput()
            },
            onMonitorChange: (monitor) => changeControl('input.monitor', monitor ? 1 : 0),
            onLevelChange: (value) => changeControl('input.level', value),
            onPanChange: (value) => changeControl('input.pan', value),
            onMeasure: () => void measureLatency(),
          }}
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
    </LiveMixProvider>
  )
}
