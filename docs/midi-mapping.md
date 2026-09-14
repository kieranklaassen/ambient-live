# MIDI pass-through and mapping (U27)

Notes keep playing the synth. Control changes — and notes you choose — drive
the workstation's controls through a small learn-lite mapping table that is
persisted in `localStorage`. Part of the live-mix unified plan, unit U27
(requirement R15, partial).

## Flow

```
MIDIInput.onmidimessage
  → parseMidiEvent (audio/midi.ts): note-on | note-off | cc, with channel
  → useMidiMap.dispatch (pages/live/use-midi-map.ts)
      learn armed?  → bind the armed target to this CC / note, consume
      mapped?       → resolveMidiEvent → ControlChange[] → page handler, consume
      otherwise     → notes fall through to the synth (InstrumentTrack.noteOn/off)
  → Live page: controlValueFromUnit → LiveEngine.applyControl (ramped)
```

`parseMidiMessage` (the note-only parser the synth path used) is unchanged in
behaviour and now derives from `parseMidiEvent`.

## Control targets (`audio/control-targets.ts`)

One table describes every target: id, label, group, range, default and kind.
The knobs and the mapping layer share it, so a CC at 127 lands exactly where
the knob's maximum is.

| Id | Range | Applied as |
|---|---|---|
| `reverb.mix` `reverb.decay` `reverb.damping` `reverb.predelayMs` | knob ranges | `plate.setParam` (WASM host ramps 5 ms) |
| `master.gain` | 0–1.5 | `engine.master.setLevel` (5 ms `setTargetAtTime`) |
| `synth.level` `clips.level` `input.level` | 0–1.5 | `track.strip.setLevel` |
| `synth.pan` `clips.pan` `input.pan` | −1–1 | `track.strip.setPan` |
| `input.monitor` | toggle | `setLiveInputMonitor` (strip mute gate) |

Adding a target: extend the `ControlTargetId` union, add its spec to
`CONTROL_TARGETS`, add a case to `LiveEngine.applyControl`. The exhaustive
`switch` fails to compile until the case exists.

## Mapping layer (`audio/midi-map.ts`, pure)

```ts
type MidiSource = { kind: 'cc'; channel; controller } | { kind: 'note'; channel; note }
interface MidiMapping { source: MidiSource; target: ControlTargetId }
type MidiMapTable = readonly MidiMapping[]      // one entry per target

mapControl(table, target, source)  // bind (replaces the target's previous source)
unmapControl(table, target)
mappingFor(table, target)
isMapped(table, event)             // does the map consume this event?
resolveMidiEvent(table, event)     // → ControlChange[]
learnFromEvent(learn, table, event) // { learn, table, consumed }
serializeMidiMap / parseMidiMap    // versioned JSON, malformed entries dropped
loadMidiMap(storage) / saveMidiMap(storage, table)  // any Storage-like object
```

Semantics:

- A CC sets its targets to `value / 127` of the range; on a toggle target a
  MIDI switch (value ≥ 64) turns it on.
- A note-on on a continuous target sets `velocity / 127`; on a toggle it
  flips. Note-off does nothing (a pad hit sets a value and leaves it).
- Channels are matched (1–16). One source may drive several targets; a target
  has one source.
- A mapped note never reaches the synth. A note that is already sounding
  always releases on note-off, even if it was mapped mid-hold.
- Learn: arm a target (`Learn`), move a control or hit a pad; the first CC or
  note-on binds and is consumed. A note-off while armed keeps waiting.

Persistence: key `ambient-live:midi-map`, `{ format: 1, mappings: [...] }`.
The key is removed when the table is empty. Unknown targets, out-of-range
channels or bytes and foreign formats are dropped entry by entry, never thrown.

## UI

The MIDI device panel gains a collapsible **Map** section once MIDI is
connected: one row per target with its current binding (`CC 74 · ch 1`), a
**Learn** button (turns into **Cancel** while armed) and **×** to unbind, plus
**Clear all**. Test ids: `midi-map`, `midi-map-<id>`, `midi-map-<id>-learn`,
`midi-map-<id>-unmap`, `midi-map-clear`.

## Why direct ramped writes and not `ModMatrix`

U19's `Macro` → `ModMatrix` model adds an offset on top of a parameter's base
at control rate; a hardware knob wants absolute control and the on-screen knob
should follow it. Every path `applyControl` takes already ramps (WASM host
parameter smoothing, `ChannelStrip` `setTargetAtTime`), so a direct write is
click-free and keeps one source of truth (`controls` on the Live page).
Modulation routes stay available for automation lanes and LFOs later.
