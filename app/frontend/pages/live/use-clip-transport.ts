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
  // Clip starts already handed to the player, keyed by clip and loop pass.
  const scheduledRef = useRef(new Map<string, number>())
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
  }, [clipPlayerRef, engineRef])

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
  }, [engineRef, transport])

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
        clips: clipsRef.current,
        playheadSec: position.playheadSec,
        lookaheadSec: SCHEDULE_LOOKAHEAD_SEC,
        iteration: position.iteration,
        loopEnabled: loop,
      })

      for (const entry of due) {
        const key = `${entry.clipId}:${entry.iteration}`
        if (scheduledRef.current.has(key)) continue
        const clip = clipsRef.current.find((candidate) => candidate.id === entry.clipId)
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
  }, [clipPlayerRef, engineRef, transport])

  // An edit re-derives the queue. Clips already sounding are left alone so
  // dragging one clip does not cut another off mid-note.
  useEffect(() => {
    const player = clipPlayerRef.current
    if (!player || transportRef.current !== 'playing') return
    for (const key of player.stopPending()) {
      scheduledRef.current.delete(key)
    }
  }, [clipPlayerRef, clips, clipFades, loopEnabled])

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
