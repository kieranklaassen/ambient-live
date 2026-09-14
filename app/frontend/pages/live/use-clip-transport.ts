import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import { Transport, type TransportChange } from '@kieranklaassen/live-mix'

import { LOOP_LENGTH_SEC, type LiveEngine } from '@/audio/live-engine'
import { regionsToClips } from './regions-to-clips'
import type { TransportState } from './timeline'
import type { ClipFades } from './timeline-clips'
import type { SampleRegion } from './timeline-model'

interface UseClipTransportOptions {
  engineRef: RefObject<LiveEngine | null>
  /** Flips when the engine exists; refs do not re-render, this does. */
  started: boolean
  clips: readonly SampleRegion[]
  clipFades: ReadonlyMap<string, ClipFades>
  loopEnabled: boolean
}

/**
 * Runs the timeline over the engine's transport: moves the drawn playhead and
 * keeps the clip track in step with the regions. Transport logic (anchor,
 * loop passes, lookahead scheduling, catch-up, re-derive on edit) lives in
 * the library; this hook is a subscription plus the React state around it.
 *
 * Before audio has started there is nothing to play, so a wall-clock
 * transport keeps the playhead moving; when the engine starts, the audio-clock
 * transport picks the timeline up from where that one is.
 */
export function useClipTransport({
  engineRef,
  started,
  clips,
  clipFades,
  loopEnabled,
}: UseClipTransportOptions) {
  const [transport, setTransport] = useState<TransportState>('stopped')
  const [playheadSec, setPlayheadSec] = useState(0)

  // Wall-clock transport for the pre-audio playhead; the engine's replaces it.
  const wallTransportRef = useRef<Transport | null>(null)
  if (wallTransportRef.current === null) {
    wallTransportRef.current = new Transport({
      now: () => performance.now() / 1000,
      loop: { enabled: loopEnabled, lengthSec: LOOP_LENGTH_SEC },
    })
  }
  const transportRef = useRef(transport)
  transportRef.current = transport

  const activeTransport = useCallback((): Transport => {
    const engine = engineRef.current
    return engine ? engine.engine.transport : (wallTransportRef.current as Transport)
  }, [engineRef])

  // Mirror transport state changes (including the scheduler's pause-at-end)
  // into React. Subscribes to whichever transport is active.
  useEffect(() => {
    const target = activeTransport()
    const onChange = (change: TransportChange) => {
      transportRef.current = change.state
      setTransport(change.state)
      if (change.reason === 'stop' || change.reason === 'seek' || change.reason === 'end') {
        setPlayheadSec(Math.round(change.position.positionSec * 100) / 100)
      }
    }
    return target.onChange(onChange)
  }, [activeTransport, started])

  // Hand the engine the timeline: regions (with overlap-derived fades) become
  // clips on the clip track; the library re-derives its queue in the same turn.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.clips.clips.set(regionsToClips(clips, clipFades))
  }, [engineRef, started, clips, clipFades])

  useEffect(() => {
    activeTransport().setLoop({ enabled: loopEnabled, lengthSec: LOOP_LENGTH_SEC })
  }, [activeTransport, loopEnabled, started])

  // Drawn playhead: read the position off the active transport each frame.
  useEffect(() => {
    if (transport !== 'playing') return
    let frame = 0
    const tick = () => {
      if (transportRef.current !== 'playing') return
      const position = activeTransport().position()
      // Quantize to the 0.01s readout so steady frames skip the re-render.
      const quantized = Math.round(position.positionSec * 100) / 100
      setPlayheadSec((previous) => (previous === quantized ? previous : quantized))
      if (position.finished) {
        // Loop off and the wall-clock transport ran off the end: pause where
        // it stopped (the engine's scheduler does this itself).
        if (!engineRef.current) activeTransport().pause()
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [activeTransport, engineRef, transport])

  /**
   * When audio starts, carry the wall-clock transport's state over to the
   * engine's transport so audio started after Play picks the timeline up
   * from where it is.
   */
  const adoptEngine = useCallback(
    (engine: LiveEngine) => {
      const wall = wallTransportRef.current as Transport
      const position = wall.position()
      const wasPlaying = wall.state === 'playing'
      wall.stop()
      const target = engine.engine.transport
      target.setLoop({ enabled: loopEnabled, lengthSec: LOOP_LENGTH_SEC })
      target.seek(position.positionSec)
      engine.clips.clips.set(regionsToClips(clips, clipFades))
      if (wasPlaying) target.start()
      else if (transportRef.current === 'paused') target.pause()
    },
    [clipFades, clips, loopEnabled],
  )

  /** Drops every clip start still in the queue and re-derives it from the anchor. */
  const resetSchedule = useCallback(() => {
    engineRef.current?.engine.scheduler.refresh()
  }, [engineRef])

  const changeTransport = useCallback(
    (next: TransportState) => {
      const target = activeTransport()
      // Sync the ref before the re-render so shortcut handlers see Stop/Pause
      // immediately instead of one tick late.
      transportRef.current = next
      switch (next) {
        case 'playing':
          target.start()
          break
        case 'paused':
          target.pause()
          break
        case 'stopped':
          // Ableton Stop: the transport returns to 0 itself.
          target.stop()
          setPlayheadSec(0)
          break
        default: {
          const _exhaustive: never = next
          return _exhaustive
        }
      }
      setTransport(next)
    },
    [activeTransport],
  )

  const seek = useCallback(
    (timeSec: number) => {
      activeTransport().seek(timeSec)
      setPlayheadSec(timeSec)
    },
    [activeTransport],
  )

  return { transport, transportRef, playheadSec, changeTransport, seek, resetSchedule, adoptEngine }
}
