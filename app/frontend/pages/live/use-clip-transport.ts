import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import type { AudioEngine } from '@/audio/audio-engine'
import type { ClipPlayer } from '@/audio/clip-player'
import { clipsInWindow } from './clip-schedule'
import type { TransportState } from './timeline'
import type { ClipFades } from './timeline-clips'
import { LOOP_LENGTH_SEC, advancePlayhead, type SampleRegion } from './timeline-model'

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

/** A clip start already handed to the player. */
interface ScheduledStart {
  clipId: string
  /** Loop pass the start belongs to. */
  iteration: number
  /** Where on the timeline the clip stood when it was scheduled. */
  startSec: number
}

/**
 * Dedupe key for a clip start. The timeline position is part of it, so moving
 * a clip schedules its new position even within the same loop pass.
 */
function scheduleKey(start: ScheduledStart): string {
  return `${start.clipId}:${start.iteration}:${start.startSec.toFixed(3)}`
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

interface UseClipTransportOptions {
  engineRef: RefObject<AudioEngine | null>
  clipPlayerRef: RefObject<ClipPlayer | null>
  clips: readonly SampleRegion[]
  clipFades: ReadonlyMap<string, ClipFades>
  loopEnabled: boolean
}

/**
 * Runs the timeline: moves the playhead and hands clips to the player before
 * they are due. While the engine exists the audio clock is authoritative, so
 * the drawn playhead and the scheduled audio cannot drift apart.
 */
export function useClipTransport({
  engineRef,
  clipPlayerRef,
  clips,
  clipFades,
  loopEnabled,
}: UseClipTransportOptions) {
  const [transport, setTransport] = useState<TransportState>('stopped')
  const [playheadSec, setPlayheadSec] = useState(0)

  // Where the transport was pinned to the audio clock. Null until it runs.
  const anchorRef = useRef<TransportAnchor | null>(null)
  // Loop passes are numbered across anchors so a re-pin cannot reuse a number.
  const nextIterationRef = useRef(0)
  // Clip starts already handed to the player, by their schedule key.
  const scheduledRef = useRef(new Map<string, ScheduledStart>())
  const clipsRef = useRef(clips)
  const clipFadesRef = useRef(clipFades)
  const playheadRef = useRef(playheadSec)
  const transportRef = useRef(transport)
  const loopEnabledRef = useRef(loopEnabled)
  // Keep the frame and timer readers current without an extra effect tick.
  clipsRef.current = clips
  clipFadesRef.current = clipFades
  transportRef.current = transport
  loopEnabledRef.current = loopEnabled

  /**
   * The anchor is created on demand rather than at transport change, so audio
   * started after Play still picks the timeline up from where it is.
   */
  const anchorAt = useCallback((engine: AudioEngine): TransportAnchor => {
    const existing = anchorRef.current
    if (existing) return existing
    const created: TransportAnchor = {
      contextTime: engine.currentTime,
      playheadSec: playheadRef.current,
      iteration: nextIterationRef.current++,
    }
    anchorRef.current = created
    return created
  }, [])

  /** Drops every clip start still in the queue and re-pins the transport to now. */
  const resetSchedule = useCallback(() => {
    clipPlayerRef.current?.stopAll()
    scheduledRef.current.clear()
    anchorRef.current = null
  }, [clipPlayerRef])

  // Drawn playhead. Before audio has started there is nothing to play, so
  // frame deltas are enough to keep the line moving.
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

    // Running off the end with loop off pauses where it stopped, and drops the
    // anchor so resuming picks up from there rather than from the old pin.
    const pauseAtEnd = () => {
      transportRef.current = 'paused'
      setTransport('paused')
      resetSchedule()
    }

    const tick = (ts: number) => {
      if (transportRef.current !== 'playing') return
      const engine = engineRef.current
      if (engine) {
        const position = positionFromAnchor(
          anchorAt(engine),
          engine.currentTime,
          loopEnabledRef.current,
        )
        draw(position.playheadSec)
        if (position.finished) {
          pauseAtEnd()
          return
        }
      } else if (lastTs != null) {
        const deltaSec = Math.min((ts - lastTs) / 1000, 0.1)
        const unwrapped = playheadRef.current + deltaSec
        if (!loopEnabledRef.current && unwrapped >= LOOP_LENGTH_SEC) {
          draw(LOOP_LENGTH_SEC)
          pauseAtEnd()
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
  }, [anchorAt, engineRef, resetSchedule, transport])

  /** Hands the player every clip start due within the lookahead window. */
  const schedule = useCallback(() => {
    const engine = engineRef.current
    const player = clipPlayerRef.current
    if (!engine || !player) return

    const now = engine.currentTime
    const loop = loopEnabledRef.current
    const position = positionFromAnchor(anchorAt(engine), now, loop)
    if (position.finished) return

    const due = clipsInWindow({
      clips: clipsRef.current,
      playheadSec: position.playheadSec,
      lookaheadSec: SCHEDULE_LOOKAHEAD_SEC,
      iteration: position.iteration,
      loopEnabled: loop,
    })

    for (const entry of due) {
      const clip = clipsRef.current.find((candidate) => candidate.id === entry.clipId)
      const loaded = clip ? engine.sample(clip.sampleId) : undefined
      if (!clip || !loaded) continue
      const start: ScheduledStart = {
        clipId: entry.clipId,
        iteration: entry.iteration,
        startSec: clip.startSec,
      }
      const key = scheduleKey(start)
      if (scheduledRef.current.has(key)) continue
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
      scheduledRef.current.set(key, start)
    }

    for (const [key, start] of scheduledRef.current) {
      if (start.iteration < position.iteration) scheduledRef.current.delete(key)
    }
  }, [anchorAt, clipPlayerRef, engineRef])

  // Runs on a timer rather than a frame so a backgrounded tab keeps playing.
  useEffect(() => {
    if (transport !== 'playing') return
    schedule()
    const timer = window.setInterval(schedule, SCHEDULE_TICK_MS)
    return () => window.clearInterval(timer)
  }, [schedule, transport])

  // An edit re-derives the queue in the same turn, so a start that falls due
  // before the next tick is not lost. Clips still sounding where they are
  // drawn are left alone, so dragging one clip does not cut another off
  // mid-note; a clip that moved gives up the audio it started at its old
  // position rather than playing twice.
  useEffect(() => {
    const player = clipPlayerRef.current
    if (!player || transportRef.current !== 'playing') return
    for (const key of player.stopPending()) {
      scheduledRef.current.delete(key)
    }
    for (const [key, start] of scheduledRef.current) {
      const clip = clips.find((candidate) => candidate.id === start.clipId)
      if (clip && scheduleKey({ ...start, startSec: clip.startSec }) === key) continue
      player.stop(key)
      scheduledRef.current.delete(key)
    }
    schedule()
  }, [clipPlayerRef, clipFades, clips, loopEnabled, schedule])

  const changeTransport = useCallback(
    (next: TransportState) => {
      // Sync the ref before the re-render so the scheduler sees Stop/Pause
      // immediately instead of one tick late.
      transportRef.current = next
      if (next === 'stopped') {
        setPlayheadSec(0)
        playheadRef.current = 0
      }
      setTransport(next)
      resetSchedule()
    },
    [resetSchedule],
  )

  const seek = useCallback(
    (timeSec: number) => {
      setPlayheadSec(timeSec)
      playheadRef.current = timeSec
      resetSchedule()
    },
    [resetSchedule],
  )

  return { transport, transportRef, playheadSec, changeTransport, seek, resetSchedule }
}
