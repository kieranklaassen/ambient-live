import {
  CONTROL_TARGETS,
  type ControlTargetGroup,
  type ControlTargetId,
  type ControlTargetSpec,
} from '@/audio/control-targets'
import { describeSource, mappingFor, type LearnState, type MidiMapTable } from '@/audio/midi-map'

const GROUPS: readonly [ControlTargetGroup, readonly ControlTargetSpec[]][] = (() => {
  const byGroup = new Map<ControlTargetGroup, ControlTargetSpec[]>()
  for (const spec of CONTROL_TARGETS) {
    const list = byGroup.get(spec.group)
    if (list) list.push(spec)
    else byGroup.set(spec.group, [spec])
  }
  return [...byGroup.entries()]
})()

interface MidiMapPanelProps {
  enabled: boolean
  table: MidiMapTable
  learn: LearnState
  onLearn: (target: ControlTargetId) => void
  onCancelLearn: () => void
  onUnmap: (target: ControlTargetId) => void
  onClear: () => void
}

/** Learn-lite mapping table: arm a row, move a knob or hit a pad, done. */
export default function MidiMapPanel({
  enabled,
  table,
  learn,
  onLearn,
  onCancelLearn,
  onUnmap,
  onClear,
}: MidiMapPanelProps) {
  return (
    <details className="group text-xs text-al-muted" data-testid="midi-map">
      <summary className="cursor-pointer select-none text-[10px] uppercase tracking-[0.12em] text-al-dim hover:text-al-text">
        Map
        {table.length > 0 && <span className="ml-1 text-al-accent">· {table.length}</span>}
        {learn.target !== null && <span className="ml-1 text-al-accent">· learning…</span>}
      </summary>
      <div className="mt-1 max-h-40 overflow-y-auto">
        {GROUPS.map(([group, specs]) => (
          <section key={group} aria-label={`${group} mappings`}>
            <h4 className="mt-1 px-1 text-[9px] uppercase tracking-[0.12em] text-al-dim">{group}</h4>
            <ul className="space-y-px">
              {specs.map((spec) => {
                const mapping = mappingFor(table, spec.id)
                const learning = learn.target === spec.id
                return (
                  <li
                    key={spec.id}
                    className="flex items-center gap-1 rounded-[1px] px-1 py-0.5 hover:bg-al-sunken"
                    data-testid={`midi-map-${spec.id}`}
                    data-learning={learning || undefined}
                  >
                    <span className="min-w-0 flex-1 truncate">{spec.label}</span>
                    <span
                      className={`shrink-0 truncate text-right tabular-nums ${
                        mapping ? 'text-al-text' : 'text-al-dim'
                      }`}
                      data-testid={`midi-map-${spec.id}-source`}
                    >
                      {learning ? 'move a control' : mapping ? describeSource(mapping.source) : '—'}
                    </span>
                    <button
                      type="button"
                      disabled={!enabled}
                      aria-pressed={learning}
                      onClick={() => (learning ? onCancelLearn() : onLearn(spec.id))}
                      className={`shrink-0 rounded-[1px] border px-1.5 py-0.5 text-[10px] uppercase tracking-wide disabled:opacity-40 ${
                        learning
                          ? 'border-al-accent bg-al-accent text-al-chrome'
                          : 'border-al-hairline text-al-muted hover:border-zinc-500 hover:text-white'
                      }`}
                      data-testid={`midi-map-${spec.id}-learn`}
                    >
                      {learning ? 'Cancel' : 'Learn'}
                    </button>
                    <button
                      type="button"
                      disabled={!enabled || !mapping}
                      aria-label={`Unmap ${group} ${spec.label}`}
                      onClick={() => onUnmap(spec.id)}
                      className="shrink-0 rounded-[1px] px-1 text-al-dim hover:text-al-danger disabled:opacity-30"
                      data-testid={`midi-map-${spec.id}-unmap`}
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
      {table.length > 0 && (
        <button
          type="button"
          disabled={!enabled}
          onClick={onClear}
          className="mt-1 text-[10px] uppercase tracking-wide text-al-dim hover:text-al-danger disabled:opacity-40"
          data-testid="midi-map-clear"
        >
          Clear all
        </button>
      )}
    </details>
  )
}
