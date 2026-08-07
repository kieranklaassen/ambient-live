import { type DragEvent, type MouseEvent } from 'react'

import { readSampleDragData, type SampleDragPayload } from './sample-drag'
import { LOOP_LENGTH_SEC, timeToX, xToTime, type SampleRegion } from './timeline-model'

export type TransportState = 'stopped' | 'playing' | 'paused'

interface TimelineProps {
  regions: SampleRegion[]
  playheadSec: number
  transport: TransportState
  onTransportChange: (next: TransportState) => void
  onSeek: (timeSec: number) => void
  onDropSample: (sample: SampleDragPayload, startSec: number) => void
  className?: string
}

export default function Timeline({
  regions,
  playheadSec,
  transport,
  onTransportChange,
  onSeek,
  onDropSample,
  className = '',
}: TimelineProps) {
  const playheadPercent = timeToX(playheadSec, 100, LOOP_LENGTH_SEC)

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const payload = readSampleDragData(event.dataTransfer)
    if (!payload) return
    const bounds = event.currentTarget.getBoundingClientRect()
    onDropSample(payload, xToTime(event.clientX - bounds.left, bounds.width, LOOP_LENGTH_SEC))
  }

  function handleSeekClick(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('[data-region]')) return
    const bounds = event.currentTarget.getBoundingClientRect()
    onSeek(xToTime(event.clientX - bounds.left, bounds.width, LOOP_LENGTH_SEC))
  }

  return (
    <section
      className={`workstation-region flex flex-col border-l border-al-border bg-al-chrome ${className}`}
      data-testid="paint-timeline"
      aria-label="Paint timeline"
    >
      <div className="flex items-center justify-between gap-3 border-b border-al-border bg-al-panel sg-p-1">
        <div>
          <h2 className="text-[10px] font-medium uppercase tracking-[0.14em] text-al-muted sg-leading-2">
            Arrangement
          </h2>
          <p className="text-[10px] text-al-dim sg-leading-2">Paint lane — drop samples onto the surface</p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Transport">
          <button
            type="button"
            onClick={() => onTransportChange(transport === 'playing' ? 'paused' : 'playing')}
            className={`rounded-[1px] border px-2.5 py-1 text-[11px] uppercase tracking-wide ${
              transport === 'playing'
                ? 'border-al-accent bg-al-accent text-al-chrome'
                : 'border-al-hairline bg-al-raised text-al-text'
            }`}
            data-testid="transport-play-pause"
          >
            {transport === 'playing' ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => onTransportChange('stopped')}
            className="rounded-[1px] border border-al-hairline bg-al-raised px-2.5 py-1 text-[11px] uppercase tracking-wide text-al-text"
            data-testid="transport-stop"
          >
            Stop
          </button>
          <span
            className="ml-1 border border-al-border bg-al-sunken px-1.5 py-0.5 font-mono text-[10px] text-al-muted"
            data-testid="playhead-readout"
          >
            {playheadSec.toFixed(2)}s / {LOOP_LENGTH_SEC}s
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
        <div className="absolute inset-x-sg-2 top-[20%] bottom-[24%]">
          {regions.map((region) => {
            const leftPercent = timeToX(region.startSec, 100, LOOP_LENGTH_SEC)
            const widthPercent = Math.max((region.durationSec / LOOP_LENGTH_SEC) * 100, 1.2)
            return (
              <div
                key={region.id}
                data-region={region.id}
                title={`${region.name} @ ${region.startSec.toFixed(2)}s`}
                className="absolute top-0 bottom-0 overflow-hidden rounded-[1px] border border-al-accent bg-al-accent-soft px-1.5 py-0.5"
                style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
              >
                <span className="block truncate text-[10px] uppercase tracking-wide text-al-text">
                  {region.name}
                </span>
              </div>
            )
          })}
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
