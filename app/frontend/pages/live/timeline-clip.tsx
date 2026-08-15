import { type PointerEvent as ReactPointerEvent } from 'react'

import { slicePeaks, type WaveformPeaks } from '@/audio/waveform'
import { type ClipFades } from './timeline-clips'
import { LOOP_LENGTH_SEC, timeToX, type SampleRegion } from './timeline-model'

/** Below this the clip is a sliver and the waveform reads as noise. */
const MIN_CLIP_WIDTH_PERCENT = 1.2

interface TimelineClipProps {
  clip: SampleRegion
  /** Fades after overlap crossfades — what the clip actually plays. */
  fades: ClipFades
  peaks: WaveformPeaks | null
  dragging: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, clip: SampleRegion) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
}

export default function TimelineClip({
  clip,
  fades,
  peaks,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: TimelineClipProps) {
  const leftPercent = timeToX(clip.startSec, 100, LOOP_LENGTH_SEC)
  const widthPercent = Math.max(
    (clip.durationSec / LOOP_LENGTH_SEC) * 100,
    MIN_CLIP_WIDTH_PERCENT,
  )
  const fadeInPercent = percentOfClip(fades.fadeInSec, clip.durationSec)
  const fadeOutPercent = percentOfClip(fades.fadeOutSec, clip.durationSec)

  return (
    <div
      data-region={clip.id}
      data-testid="timeline-clip"
      title={`${clip.name} @ ${clip.startSec.toFixed(2)}s · ${clip.durationSec.toFixed(2)}s`}
      onPointerDown={(event) => onPointerDown(event, clip)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`absolute top-0 bottom-0 touch-none select-none overflow-hidden rounded-[1px] border bg-al-accent-soft ${
        dragging ? 'border-al-accent bg-al-accent-soft' : 'border-al-accent'
      }`}
      style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
    >
      {peaks && <ClipWaveform clip={clip} peaks={peaks} />}
      <ClipFadeShape fadeInPercent={fadeInPercent} fadeOutPercent={fadeOutPercent} />
      <span className="pointer-events-none relative block truncate px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-al-text">
        {clip.name}
      </span>
    </div>
  )
}

function ClipWaveform({ clip, peaks }: { clip: SampleRegion; peaks: WaveformPeaks }) {
  const sliced = slicePeaks(peaks, clip.offsetSec, clip.durationSec, clip.sourceDurationSec ?? 0)
  const count = sliced.min.length
  if (count === 0) return null

  // Outline down the maxima and back along the minima; the viewBox stretches
  // to the clip so a trim reveals a different part of the wave.
  const top: string[] = []
  const bottom: string[] = []
  for (let i = 0; i < count; i++) {
    top.push(`${i},${50 - sliced.max[i] * 48}`)
    bottom.push(`${count - 1 - i},${50 - sliced.min[count - 1 - i] * 48}`)
  }

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${Math.max(count - 1, 1)} 100`}
      preserveAspectRatio="none"
    >
      <polygon points={[...top, ...bottom].join(' ')} fill="var(--color-al-accent)" opacity="0.75" />
    </svg>
  )
}

function ClipFadeShape({
  fadeInPercent,
  fadeOutPercent,
}: {
  fadeInPercent: number
  fadeOutPercent: number
}) {
  if (fadeInPercent <= 0 && fadeOutPercent <= 0) return null

  // The shaded wedge is the attenuated part, so the drawn slope is the gain.
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {fadeInPercent > 0 && (
        <polygon points={`0,0 ${fadeInPercent},0 0,100`} fill="var(--color-al-sunken)" opacity="0.72" />
      )}
      {fadeOutPercent > 0 && (
        <polygon
          points={`100,0 ${100 - fadeOutPercent},0 100,100`}
          fill="var(--color-al-sunken)"
          opacity="0.72"
        />
      )}
    </svg>
  )
}

function percentOfClip(fadeSec: number, durationSec: number): number {
  if (durationSec <= 0) return 0
  return Math.min(100, Math.max(0, (fadeSec / durationSec) * 100))
}
