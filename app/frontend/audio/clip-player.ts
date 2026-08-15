// Plays timeline clips on the audio clock. Each clip becomes one buffer source
// with its own gain envelope, so the trim and the fades the UI draws are the
// trim and the fades that are heard. Output goes into the core's input bus, so
// clips share the plate reverb with everything else.

import type { AudioEngine } from './audio-engine'
import { fadeGain } from './fade'

export interface ClipPlayback {
  buffer: AudioBuffer
  /** Where playback enters the source. */
  offsetSec: number
  /** How much of the source is audible. */
  durationSec: number
  fadeInSec: number
  fadeOutSec: number
}

interface ActiveClip {
  key: string
  source: AudioBufferSourceNode
  gain: GainNode
  startTime: number
}

export class ClipPlayer {
  private readonly engine: AudioEngine
  private readonly active = new Set<ActiveClip>()

  constructor(engine: AudioEngine) {
    this.engine = engine
  }

  /** Starts a clip at `when` on the engine's clock, tagged with a caller key. */
  play(key: string, playback: ClipPlayback, when: number): void {
    if (playback.durationSec <= 0) return

    // A start that has already passed joins the clip partway in rather than
    // replaying it from the trim point and overrunning its end.
    const late = Math.max(0, this.engine.currentTime - when)
    if (late >= playback.durationSec) return
    const start = when + late
    const end = when + playback.durationSec

    const source = this.engine.createBufferSource()
    const gain = this.engine.createGain()
    source.buffer = playback.buffer
    source.connect(gain)
    gain.connect(this.engine.clipDestination)

    // Linear ramps against the clip's own timeline, so the drawn fade slope is
    // the applied gain even when the clip is joined late.
    const fadeInEnd = when + Math.min(playback.fadeInSec, playback.durationSec)
    const fadeOutStart = Math.max(fadeInEnd, end - playback.fadeOutSec)
    gain.gain.setValueAtTime(
      fadeGain(late, playback.durationSec, playback.fadeInSec, playback.fadeOutSec),
      start,
    )
    if (fadeInEnd > start) gain.gain.linearRampToValueAtTime(1, fadeInEnd)
    if (playback.fadeOutSec > 0) {
      if (fadeOutStart > start) gain.gain.setValueAtTime(1, fadeOutStart)
      gain.gain.linearRampToValueAtTime(0, end)
    }

    const entry: ActiveClip = { key, source, gain, startTime: start }
    source.onended = () => {
      this.active.delete(entry)
      source.disconnect()
      gain.disconnect()
    }
    this.active.add(entry)
    source.start(start, playback.offsetSec + late, playback.durationSec - late)
  }

  /**
   * Cancels clips that have not started yet and returns their keys, so an edit
   * can be rescheduled without cutting audio already in flight.
   */
  stopPending(): string[] {
    const now = this.engine.currentTime
    const cancelled: string[] = []
    for (const entry of [...this.active]) {
      if (entry.startTime <= now) continue
      this.silence(entry)
      cancelled.push(entry.key)
    }
    return cancelled
  }

  /** Silences the clip scheduled under `key`, whether or not it has started. */
  stop(key: string): void {
    for (const entry of [...this.active]) {
      if (entry.key === key) this.silence(entry)
    }
  }

  /** Silences everything scheduled, started or not. */
  stopAll(): void {
    for (const entry of [...this.active]) {
      this.silence(entry)
    }
  }

  private silence(entry: ActiveClip): void {
    entry.source.onended = null
    try {
      entry.source.stop()
    } catch {
      // Already stopped — nothing left to silence.
    }
    entry.source.disconnect()
    entry.gain.disconnect()
    this.active.delete(entry)
  }
}
