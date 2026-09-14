# MIDI pass-through and mapping

Notes keep playing the synth. Control changes — and notes you choose — drive
the workstation's controls through live-mix's `ControlSurface` (library unit
U36, requirement R15), which owns the mapping table, learn, resolution and
persistence. The app describes its controls as `ControlTarget`s and builds the
surface over its engine; the mapping code that U27 kept in the app
(`midi-map.ts`, `control-targets.ts`, `parseMidiEvent`) is gone.

## Flow

```
MIDIInput (the port picked in the MIDI panel)
  → MidiInput (live-mix): running status, 14-bit pairs, ControlEvents
      ├─ surface.connect(input)      learn armed? → bind, consume
      │                              mapped?      → resolve → binding.write (ramped)
      │                              → surface.onChange('applied') → the knobs follow
      └─ input.onMessage             notes: mapped or being learned → skipped
                                     otherwise → InstrumentTrack.noteOn/off
Knobs and faders → Live page changeControl → surface.set(target, unit)
```

Every write ramps as before: WASM parameters inside the device host, strip
and master moves through `setTargetAtTime` at 5 ms. There is one write path
for on-screen and hardware controls alike (`ControlSurface`), and one source
of truth for what the knobs show (`controls` on the Live page).

## Controls (`audio/live-controls.ts`)

`LIVE_CONTROLS` describes each control once: id, label, group, knob range,
default, the library `ControlTarget` it lands on, and `scale` — the control's
value at the target's normalised 0 and 1.

| Id | Target | Knob range | Notes |
|---|---|---|---|
| `reverb.mix` `reverb.decay` `reverb.damping` `reverb.predelayMs` | `{ device: 'reverb', param }` | plate spec (decay, damping capped at 0.99) | the plate is resolved as device `reverb` |
| `master.gain` | `{ master: 'level' }` | 0–1.5 | |
| `synth.level` `clips.level` `input.level` | `{ strip, control: 'level' }` | 0–1.5 | `STRIP_LEVEL_MAX` = the surface's `levelMax` |
| `synth.pan` `clips.pan` `input.pan` | `{ strip, control: 'pan' }` | −1–1 | |
| `input.monitor` | `{ strip: 'input', control: 'mute' }` | on/off | scale reversed: monitor on is mute off |

A mapping onto a control always carries the control's span as its `output`
(`liveControlOutput`): a CC at 127 lands on the knob's maximum (decay 0.99,
not the plate's 1.0) and a MIDI switch at ≥ 64 turns monitoring on. Its mode
follows its source as in U27 (`liveControlMode`: a pad toggles the monitor and
sets anything else from velocity; a CC sets) — the library would keep the old
mode across a re-learn. The surface enforces both on every table change
(`withLiveControlSemantics`), so learned and migrated bindings alike get it.

`createLiveControlSurface(() => engine, { storage })` builds the surface.
Targets resolve against whatever engine the callback returns at dispatch time,
so the surface exists — and holds the stored table — before audio starts;
nothing answers until then. Persistence is the library's `loadMappingTable` /
`saveMappingTable` (what `surface.persist` composes) placed around the
semantics pass, so what is saved is always the normalised table and a loaded
table is normalised in memory without being written back.

Adding a control: add a spec to `LIVE_CONTROLS` (and its id to
`LiveControlId`). The knobs, the map panel and the stored-table migration
read the same list.

## Semantics (U27's, now the library's)

- A CC sets its targets to `value / 127` of the knob range; on the monitor a
  MIDI switch (value ≥ 64) turns it on.
- A note-on on a continuous target sets `velocity / 127`; on the monitor it
  toggles. Note-off does nothing (a pad hit sets a value and leaves it).
- Channels are matched (1–16). One source may drive several targets; a target
  has one source.
- A mapped note never reaches the synth. A note that is already sounding
  always releases on note-off, even if it was mapped mid-hold.
- Learn: arm a target (**Learn**), move a control or hit a pad; the first CC or
  note-on binds and is consumed. A note-off while armed keeps waiting.

What the library adds without app work: 14-bit CCs, pitch bend and
aftertouch as sources, relative encoders, soft takeover, curves, OSC inputs
(`OscInput`), and lane override once automation lanes exist. See live-mix's
`docs/control-surface.md`.

## Persistence

Key `ambient-live:midi-map`, unchanged. Tables written by U27
(`{ format: 1, mappings: [{ source, target: '<id>' }] }`) load through
`ambientLiveMidiMapMigration(liveControlTargetFor)` with U27 semantics per
entry and are rewritten in the library's format 2 on the first edit. The key
is removed when the table is empty. Malformed entries, unknown ids and foreign
formats are dropped entry by entry, never thrown.

## UI

The MIDI device panel gains a collapsible **Map** section once MIDI is
connected: one row per control (`useLearn`) with its current binding
(`CC 74 · ch 1`), a **Learn** button (turns into **Cancel** while armed) and
**×** to unbind, plus **Clear all** (`useControlSurface`). Test ids:
`midi-map`, `midi-map-<id>`, `midi-map-<id>-source`, `midi-map-<id>-learn`,
`midi-map-<id>-unmap`, `midi-map-clear`.
