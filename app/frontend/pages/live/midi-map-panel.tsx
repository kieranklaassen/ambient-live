import { CONTROL_TARGETS, type ControlTargetId } from '@/audio/control-targets'
import { describeSource, mappingFor, type LearnState, type MidiMapTable } from '@/audio/midi-map'

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
      <ul className="mt-1 max-h-40 space-y-px overflow-y-auto" aria-label="MIDI mappings">
        {CONTROL_TARGETS.map((spec) => {
          const mapping = mappingFor(table, spec.id)
          const learning = learn.target === spec.id
          return (
            <li
              key={spec.id}
              className="flex items-center gap-1 rounded-[1px] px-1 py-0.5 hover:bg-al-sunken"
              data-testid={`midi-map-${spec.id}`}
              data-learning={learning || undefined}
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="text-al-dim">{spec.group} · </span>
                {spec.label}
              </span>
              <span
                className={`w-[5.5rem] shrink-0 truncate text-right tabular-nums ${
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
                aria-label={`Unmap ${spec.group} ${spec.label}`}
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
