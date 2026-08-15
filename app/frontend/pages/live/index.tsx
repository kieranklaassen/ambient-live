import { Head, router } from '@inertiajs/react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { AudioEngine, type LoadedSample, type ParamId } from '@/audio/audio-engine'
import { ClipPlayer } from '@/audio/clip-player'
import type { WaveformPeaks } from '@/audio/waveform'
import { clipsInWindow } from './clip-schedule'
import DeviceStrip from './device-strip'
import type { ShortcutAction } from './keymap'
import { revokeLocalSampleUrls } from './local-folder'
import PaneSplitter from './pane-splitter'
import { DEFAULT_REVERB_SETTINGS, type ReverbSettings } from './reverb-controls'
import SampleBrowser from './sample-browser'
import { isAllowedSampleUrl, type SampleDragPayload } from './sample-drag'
import type { SampleItem } from './sample-library'
import ShortcutOverlay from './shortcut-overlay'
import Timeline, { type TransportState } from './timeline'
import { applySourceDuration, effectiveFades } from './timeline-clips'
import {
  LOOP_LENGTH_SEC,
  advancePlayhead,
  createSampleRegion,
  type SampleRegion,
} from './timeline-model'
import { useLiveShortcuts } from './use-live-shortcuts'
import { useWorkstationPanes } from './use-workstation-panes'
import { paneVars } from './workstation-layout'

interface LiveProps {
  samples: SampleItem[]
}

/** How far ahead of the audio clock clip starts are handed to the player. */
const SCHEDULE_LOOKAHEAD_SEC = 0.2
const SCHEDULE_TICK_MS = 40

interface TransportAnchor {
  /** Audio-clock time the transport was pinned at. */
  contextTime: number
  /** Playhead position at that moment. */
  playheadSec: number
  /** Loop pass the anchor started on. */
  iteration: number
}

interface TransportPosition {
  playheadSec: number
  iteration: number
  /** True when the loop is off and the playhead has run off the end. */
  finished: boolean
}

/** Where the playhead is now, derived from the audio clock rather than accumulated frames. */
function positionFromAnchor(
  anchor: TransportAnchor,
  contextTime: number,
  loopEnabled: boolean,
): TransportPosition {
  const raw = anchor.playheadSec + (contextTime - anchor.contextTime)
  if (!loopEnabled) {
    return {
      playheadSec: Math.min(raw, LOOP_LENGTH_SEC),
      iteration: anchor.iteration,
      finished: raw >= LOOP_LENGTH_SEC,
    }
  }
  const passes = Math.floor(raw / LOOP_LENGTH_SEC)
  return {
    playheadSec: raw - passes * LOOP_LENGTH_SEC,
    iteration: anchor.iteration + passes,
    finished: false,
  }
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
  // Where the transport was pinned to the audio clock, and which loop pass
  // that anchor started on. Null while the transport is not running on audio.
  const anchorRef = useRef<TransportAnchor | null>(null)
  // Clip starts already handed to the player, keyed by clip and loop pass.
  const scheduledRef = useRef(new Map<string, number>())
  const regionsRef = useRef(regions)
  const clipFadesRef = useRef(clipFades)
  const playheadRef = useRef(playheadSec)
  const transportRef = useRef(transport)
  const loopEnabledRef = useRef(loopEnabled)
  const localSamplesRef = useRef(localSamples)
  // Keep rAF / cleanup readers current without an extra effect tick.
  regionsRef.current = regions
  clipFadesRef.current = clipFades
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

  /** Drops every clip start still in the queue and re-pins the transport to now. */
  const resetSchedule = useCallback(() => {
    clipPlayerRef.current?.stopAll()
    scheduledRef.current.clear()
    const engine = engineRef.current
    if (!engine || transportRef.current !== 'playing') {
      anchorRef.current = null
      return
    }
    anchorRef.current = {
      contextTime: engine.currentTime,
      playheadSec: playheadRef.current,
      iteration: (anchorRef.current?.iteration ?? 0) + 1,
    }
  }, [])

  // Drawn playhead. The audio clock drives it whenever the engine is running,
  // so the line and the scheduled audio cannot drift apart; before audio has
  // started there is nothing to play and frame deltas are enough.
  useEffect(() => {
    if (transport !== 'playing') return
    let frame = 0
    let lastTs: number | null = null

    const draw = (next: number) => {
      playheadRef.current = next
      // Quantize to the 0.01s readout so steady frames skip the re-render.
      const quantized = Math.round(next * 100) / 100
      setPlayheadSec((previous) => (previous === quantized ? previous : quantized))
    }

    const tick = (ts: number) => {
      if (transportRef.current !== 'playing') return
      const engine = engineRef.current
      const anchor = anchorRef.current
      if (engine && anchor) {
        const position = positionFromAnchor(anchor, engine.currentTime, loopEnabledRef.current)
        draw(position.playheadSec)
        if (position.finished) {
          setTransport('paused')
          return
        }
      } else if (lastTs != null) {
        const deltaSec = Math.min((ts - lastTs) / 1000, 0.1)
        const unwrapped = playheadRef.current + deltaSec
        if (!loopEnabledRef.current && unwrapped >= LOOP_LENGTH_SEC) {
          draw(LOOP_LENGTH_SEC)
          setTransport('paused')
          return
        }
        draw(
          loopEnabledRef.current
            ? advancePlayhead(playheadRef.current, deltaSec, LOOP_LENGTH_SEC)
            : unwrapped,
        )
      }
      lastTs = ts
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [transport])

  // Hands clip starts to the player a fraction of a second before they are due.
  // Runs on a timer rather than a frame so a backgrounded tab keeps playing.
  useEffect(() => {
    if (transport !== 'playing') return

    const schedule = () => {
      const engine = engineRef.current
      const player = clipPlayerRef.current
      const anchor = anchorRef.current
      if (!engine || !player || !anchor) return

      const now = engine.currentTime
      const loop = loopEnabledRef.current
      const position = positionFromAnchor(anchor, now, loop)
      if (position.finished) return

      const due = clipsInWindow({
        clips: regionsRef.current,
        playheadSec: position.playheadSec,
        lookaheadSec: SCHEDULE_LOOKAHEAD_SEC,
        iteration: position.iteration,
        loopEnabled: loop,
      })

      for (const entry of due) {
        const key = `${entry.clipId}:${entry.iteration}`
        if (scheduledRef.current.has(key)) continue
        const clip = regionsRef.current.find((region) => region.id === entry.clipId)
        const loaded = clip ? engine.sample(clip.sampleId) : undefined
        if (!clip || !loaded) continue
        const fades = clipFadesRef.current.get(clip.id) ?? clip
        player.play(
          key,
          {
            buffer: loaded.audioBuffer,
            offsetSec: clip.offsetSec,
            durationSec: clip.durationSec,
            fadeInSec: fades.fadeInSec,
            fadeOutSec: fades.fadeOutSec,
          },
          now + entry.startsInSec,
        )
        scheduledRef.current.set(key, entry.iteration)
      }

      for (const [key, iteration] of scheduledRef.current) {
        if (iteration < position.iteration) scheduledRef.current.delete(key)
      }
    }

    schedule()
    const timer = window.setInterval(schedule, SCHEDULE_TICK_MS)
    return () => window.clearInterval(timer)
  }, [transport])

  // An edit re-derives the queue. Clips already sounding are left alone so
  // dragging one clip does not cut another off mid-note.
  useEffect(() => {
    const player = clipPlayerRef.current
    if (!player || transportRef.current !== 'playing') return
    for (const key of player.stopPending()) {
      scheduledRef.current.delete(key)
    }
  }, [regions, clipFades, loopEnabled])

  function handleTransportChange(next: TransportState) {
    // Sync the ref before the re-render so the scheduler sees Stop/Pause
    // immediately instead of one tick late.
    transportRef.current = next
    if (next === 'stopped') {
      setTransport('stopped')
      setPlayheadSec(0)
      playheadRef.current = 0
    } else {
      setTransport(next)
    }
    resetSchedule()
  }

  function seekPlayhead(timeSec: number) {
    setPlayheadSec(timeSec)
    playheadRef.current = timeSec
    resetSchedule()
  }

  function handleShortcut(action: ShortcutAction) {
    switch (action) {
      case 'transport.spaceStop':
        // Ableton Space: stop returns to start; play always starts from 0.
        if (transportRef.current === 'playing') {
          handleTransportChange('stopped')
          return
        }
        playheadRef.current = 0
        setPlayheadSec(0)
        handleTransportChange('playing')
        return
      case 'transport.continue':
        // Shift+Space: pause/resume without relocating the playhead.
        handleTransportChange(transportRef.current === 'playing' ? 'paused' : 'playing')
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
        onTransportChange={handleTransportChange}
        onSeek={seekPlayhead}
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
