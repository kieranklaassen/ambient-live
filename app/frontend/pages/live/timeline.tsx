import { useMemo, useRef, type CSSProperties, type DragEvent, type MouseEvent } from 'react'

import type { WaveformPeaks } from '@/audio/waveform'
import { readSampleDragData, type SampleDragPayload } from './sample-drag'
import TimelineClip from './timeline-clip'
import { effectiveFades } from './timeline-clips'
import { LOOP_LENGTH_SEC, timeToX, xToTime, type SampleRegion } from './timeline-model'
import { useClipDrag } from './use-clip-drag'

export type TransportState = 'stopped' | 'playing' | 'paused'

interface TimelineProps {
  regions: SampleRegion[]
  peaksBySampleId: ReadonlyMap<number, WaveformPeaks>
  playheadSec: number
  transport: TransportState
  loopEnabled: boolean
  onLoopEnabledChange: (enabled: boolean) => void
  onTransportChange: (next: TransportState) => void
  onSeek: (timeSec: number) => void
  onDropSample: (sample: SampleDragPayload, startSec: number) => void
  onClipChange: (clip: SampleRegion) => void
  className?: string
  style?: CSSProperties
}

export default function Timeline({
  regions,
  peaksBySampleId,
  playheadSec,
  transport,
  loopEnabled,
  onLoopEnabledChange,
  onTransportChange,
  onSeek,
  onDropSample,
  onClipChange,
  className = '',
  style,
}: TimelineProps) {
  const playheadPercent = timeToX(playheadSec, 100, LOOP_LENGTH_SEC)
  const laneRef = useRef<HTMLDivElement>(null)
  const clipDrag = useClipDrag({ laneRef, onClipChange })
  const fades = useMemo(() => effectiveFades(regions), [regions])

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const payload = readSampleDragData(event.dataTransfer)
    if (!payload) return
    const bounds = event.currentTarget.getBoundingClientRect()
    onDropSample(payload, xToTime(event.clientX - bounds.left, bounds.width, LOOP_LENGTH_SEC))
  }

  function handleSeekClick(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('[data-region]')) return
    // A clip drag that ended over open canvas must not also move the playhead.
    if (clipDrag.consumeDragClick()) return
    const bounds = event.currentTarget.getBoundingClientRect()
    onSeek(xToTime(event.clientX - bounds.left, bounds.width, LOOP_LENGTH_SEC))
  }

  return (
    <section
      className={`workstation-region flex flex-col border-l border-al-border bg-al-chrome ${className}`}
      style={style}
      data-testid="paint-timeline"
      aria-label="Paint timeline"
    >
      <div className="flex items-center justify-end gap-1 border-b border-al-border bg-al-panel px-sg-2 py-sg-1">
        <div className="flex items-center gap-px" role="group" aria-label="Transport">
          <button
            type="button"
            onClick={() => onTransportChange(transport === 'playing' ? 'paused' : 'playing')}
            className={`rounded-[1px] border px-2 py-1 text-[11px] uppercase tracking-wide ${
              transport === 'playing'
                ? 'border-al-accent bg-al-accent text-al-chrome'
                : 'border-al-hairline bg-al-raised text-al-text'
            }`}
            data-testid="transport-play-pause"
            aria-label={transport === 'playing' ? 'Pause' : 'Play'}
            title={transport === 'playing' ? 'Pause' : 'Play'}
          >
            {transport === 'playing' ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => onTransportChange('stopped')}
            className="rounded-[1px] border border-al-hairline bg-al-raised px-2 py-1 text-[11px] uppercase tracking-wide text-al-text"
            data-testid="transport-stop"
            aria-label="Stop"
            title="Stop"
          >
            Stop
          </button>
          <button
            type="button"
            onClick={() => onLoopEnabledChange(!loopEnabled)}
            className={`rounded-[1px] border px-2 py-1 text-[11px] uppercase tracking-wide ${
              loopEnabled
                ? 'border-al-accent bg-al-accent-soft text-al-text'
                : 'border-al-hairline bg-al-raised text-al-muted'
            }`}
            aria-pressed={loopEnabled}
            data-testid="transport-loop"
            title="Loop (L)"
          >
            Loop
          </button>
          <span
            className="ml-1 border border-al-border bg-al-sunken px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-al-muted"
            data-testid="playhead-readout"
          >
            {playheadSec.toFixed(2)} / {LOOP_LENGTH_SEC}
          </span>
        </div>
      </div>
      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-al-sunken"
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={handleDrop}
        onClick={handleSeekClick}
        data-testid="timeline-surface"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, transparent 0, transparent calc(12.5% - 1px), var(--color-al-hairline) calc(12.5% - 1px), var(--color-al-hairline) 12.5%)',
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-al-hairline"
        />
        <div ref={laneRef} className="absolute inset-x-sg-2 top-[20%] bottom-[24%]">
          {regions.map((region) => (
            <TimelineClip
              key={region.id}
              clip={region}
              fades={fades.get(region.id) ?? region}
              peaks={peaksBySampleId.get(region.sampleId) ?? null}
              dragging={clipDrag.dragTarget !== null}
              onPointerDown={clipDrag.onPointerDown}
              onPointerMove={clipDrag.onPointerMove}
              onPointerUp={clipDrag.onPointerUp}
            />
          ))}
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-px bg-al-accent"
          style={{ left: `${playheadPercent}%` }}
          data-testid="playhead"
        />
      </div>
    </section>
  )
}
