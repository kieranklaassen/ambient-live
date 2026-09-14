import { useCallback, useEffect, useRef, useState } from 'react'

import type { ControlTargetId } from '@/audio/control-targets'
import type { MidiEvent } from '@/audio/midi'
import {
  IDLE_LEARN,
  isMapped,
  learnFromEvent,
  loadMidiMap,
  resolveMidiEvent,
  saveMidiMap,
  unmapControl,
  type ControlChange,
  type LearnState,
  type MidiMapTable,
  type StorageLike,
} from '@/audio/midi-map'

interface UseMidiMapOptions {
  onChange: (change: ControlChange) => void
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    // Storage access can throw in sandboxed frames; the map then lives for the session only.
    return null
  }
}

/**
 * The MIDI mapping table with learn-lite and localStorage persistence.
 * `dispatch` is stable and returns true when the map consumed the event.
 */
export function useMidiMap({ onChange }: UseMidiMapOptions) {
  const storageRef = useRef<StorageLike | null>(null)
  const [table, setTable] = useState<MidiMapTable>(() => {
    storageRef.current = browserStorage()
    return loadMidiMap(storageRef.current)
  })
  const [learn, setLearn] = useState<LearnState>(IDLE_LEARN)
  const tableRef = useRef(table)
  const learnRef = useRef(learn)
  const onChangeRef = useRef(onChange)
  tableRef.current = table
  learnRef.current = learn
  onChangeRef.current = onChange

  useEffect(() => {
    saveMidiMap(storageRef.current, table)
  }, [table])

  const dispatch = useCallback((event: MidiEvent): boolean => {
    const learned = learnFromEvent(learnRef.current, tableRef.current, event)
    if (learned.consumed) {
      // Refs update now so a second message in the same tick sees the new binding.
      tableRef.current = learned.table
      learnRef.current = learned.learn
      setTable(learned.table)
      setLearn(learned.learn)
      return true
    }
    const current = tableRef.current
    if (!isMapped(current, event)) return false
    for (const change of resolveMidiEvent(current, event)) onChangeRef.current(change)
    return true
  }, [])

  const startLearn = useCallback((target: ControlTargetId) => setLearn({ target }), [])
  const cancelLearn = useCallback(() => setLearn(IDLE_LEARN), [])
  const unmap = useCallback(
    (target: ControlTargetId) => setTable((previous) => unmapControl(previous, target)),
    [],
  )
  const clear = useCallback(() => {
    setTable([])
    setLearn(IDLE_LEARN)
  }, [])

  return { table, learn, dispatch, startLearn, cancelLearn, unmap, clear }
}

export type MidiMapController = ReturnType<typeof useMidiMap>
