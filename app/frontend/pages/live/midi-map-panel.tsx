import type { ControlSurface } from '@kieranklaassen/live-mix'
import { useControlSurface, useLearn } from '@kieranklaassen/live-mix/react'

import { LIVE_CONTROLS, type LiveControlGroup, type LiveControlSpec } from '@/audio/live-controls'

const GROUPS: readonly [LiveControlGroup, readonly LiveControlSpec[]][] = (() => {
  const byGroup = new Map<LiveControlGroup, LiveControlSpec[]>()
  for (const spec of LIVE_CONTROLS) {
    const list = byGroup.get(spec.group)
    if (list) list.push(spec)
    else byGroup.set(spec.group, [spec])
  }
  return [...byGroup.entries()]
})()

interface MidiMapPanelProps {
  enabled: boolean
  surface: ControlSurface
}

/** Learn-lite mapping table: arm a row, move a knob or hit a pad, done. */
export default function MidiMapPanel({ enabled, surface }: MidiMapPanelProps) {
  const { mappings, learning, clear } = useControlSurface(surface)
  return (
    <details className="group text-xs text-al-muted" data-testid="midi-map">
      <summary className="cursor-pointer select-none text-[10px] uppercase tracking-[0.12em] text-al-dim hover:text-al-text">
        Map
        {mappings.length > 0 && <span className="ml-1 text-al-accent">· {mappings.length}</span>}
        {learning !== null && <span className="ml-1 text-al-accent">· learning…</span>}
      </summary>
      <div className="mt-1 max-h-40 overflow-y-auto">
        {GROUPS.map(([group, specs]) => (
          <section key={group} aria-label={`${group} mappings`}>
            <h4 className="mt-1 px-1 text-[9px] uppercase tracking-[0.12em] text-al-dim">{group}</h4>
            <ul className="space-y-px">
              {specs.map((spec) => (
                <MapRow key={spec.id} enabled={enabled} surface={surface} spec={spec} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {mappings.length > 0 && (
        <button
          type="button"
          disabled={!enabled}
          onClick={clear}
          className="mt-1 text-[10px] uppercase tracking-wide text-al-dim hover:text-al-danger disabled:opacity-40"
          data-testid="midi-map-clear"
        >
          Clear all
        </button>
      )}
    </details>
  )
}

interface MapRowProps {
  enabled: boolean
  surface: ControlSurface
  spec: LiveControlSpec
}

function MapRow({ enabled, surface, spec }: MapRowProps) {
  const learn = useLearn(surface, spec.target)
  return (
    <li
      className="flex items-center gap-1 rounded-[1px] px-1 py-0.5 hover:bg-al-sunken"
      data-testid={`midi-map-${spec.id}`}
      data-learning={learn.armed || undefined}
    >
      <span className="min-w-0 flex-1 truncate">{spec.label}</span>
      <span
        className={`shrink-0 truncate text-right tabular-nums ${
          learn.mapping ? 'text-al-text' : 'text-al-dim'
        }`}
        data-testid={`midi-map-${spec.id}-source`}
      >
        {learn.armed ? 'move a control' : (learn.label ?? '—')}
      </span>
      <button
        type="button"
        disabled={!enabled}
        aria-pressed={learn.armed}
        onClick={() => learn.toggle()}
        className={`shrink-0 rounded-[1px] border px-1.5 py-0.5 text-[10px] uppercase tracking-wide disabled:opacity-40 ${
          learn.armed
            ? 'border-al-accent bg-al-accent text-al-chrome'
            : 'border-al-hairline text-al-muted hover:border-zinc-500 hover:text-white'
        }`}
        data-testid={`midi-map-${spec.id}-learn`}
      >
        {learn.armed ? 'Cancel' : 'Learn'}
      </button>
      <button
        type="button"
        disabled={!enabled || !learn.mapping}
        aria-label={`Unmap ${spec.group} ${spec.label}`}
        onClick={learn.unmap}
        className="shrink-0 rounded-[1px] px-1 text-al-dim hover:text-al-danger disabled:opacity-30"
        data-testid={`midi-map-${spec.id}-unmap`}
      >
        ×
      </button>
    </li>
  )
}
