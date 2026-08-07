import { type DragEvent, type MouseEvent } from 'react'

import { readSampleDragData, type SampleDragPayload } from './sample-drag'
import { LOOP_LENGTH_SEC, xToTime, type SampleRegion } from './timeline-model'

export type TransportState = 'stopped' | 'playing' | 'paused'

interface TimelineProps {
  regions: SampleRegion[]
  playheadSec: number
  transport: TransportState
  onTransportChange: (next: TransportState) => void
  onSeek: (timeSec: number) => void
  onDropSample: (sample: SampleDragPayload, startSec: number) => void
}

export default function Timeline({
  regions,
  playheadSec,
  transport,
  onTransportChange,
  onSeek,
  onDropSample,
}: TimelineProps) {
  const playheadPercent = LOOP_LENGTH_SEC > 0 ? (playheadSec / LOOP_LENGTH_SEC) * 100 : 0

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const payload = readSampleDragData(event.dataTransfer)
    if (!payload) return

    const bounds = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - bounds.left
    const startSec = xToTime(x, bounds.width, LOOP_LENGTH_SEC)
    onDropSample(payload, startSec)
  }

  function handleSeekClick(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('[data-region]')) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - bounds.left
    onSeek(xToTime(x, bounds.width, LOOP_LENGTH_SEC))
  }

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-zinc-950"
      data-testid="paint-timeline"
      aria-label="Paint timeline"
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-900 px-4 py-2">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">Timeline</h2>
          <p className="text-[11px] text-zinc-600">Paint surface — drop samples onto the lane</p>
        </div>
        <div className="flex items-center gap-2" role="group" aria-label="Transport">
          <button
            type="button"
            onClick={() => onTransportChange(transport === 'playing' ? 'paused' : 'playing')}
            className="rounded-md bg-teal-700 px-3 py-1.5 text-sm text-white transition hover:bg-teal-600"
            data-testid="transport-play-pause"
          >
            {transport === 'playing' ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => onTransportChange('stopped')}
            className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 transition hover:bg-zinc-700"
            data-testid="transport-stop"
          >
            Stop
          </button>
          <span className="font-mono text-xs text-zinc-500" data-testid="playhead-readout">
            {playheadSec.toFixed(2)}s / {LOOP_LENGTH_SEC}s
          </span>
        </div>
      </div>

      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={handleDrop}
        onClick={handleSeekClick}
        data-testid="timeline-surface"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at 20% 40%, rgba(45, 212, 191, 0.08), transparent 55%), radial-gradient(ellipse at 80% 70%, rgba(113, 113, 122, 0.12), transparent 50%), linear-gradient(180deg, #09090b 0%, #18181b 55%, #09090b 100%)',
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-zinc-800/80"
        />

        <div className="absolute inset-x-3 top-[18%] bottom-[22%]">
          {regions.map((region) => {
            const leftPercent = (region.startSec / LOOP_LENGTH_SEC) * 100
            const widthPercent = Math.max((region.durationSec / LOOP_LENGTH_SEC) * 100, 1.2)
            return (
              <div
                key={region.id}
                data-region={region.id}
                title={`${region.name} @ ${region.startSec.toFixed(2)}s`}
                className="absolute top-0 bottom-0 overflow-hidden rounded-md border border-teal-500/30 bg-teal-500/15 px-2 py-1 shadow-[inset_0_0_24px_rgba(45,212,191,0.12)]"
                style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
              >
                <span className="block truncate text-[11px] text-teal-100/90">{region.name}</span>
              </div>
            )
          })}
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-teal-300 shadow-[0_0_12px_rgba(94,234,212,0.7)]"
          style={{ left: `${playheadPercent}%` }}
          data-testid="playhead"
        />
      </div>
    </section>
  )
}
