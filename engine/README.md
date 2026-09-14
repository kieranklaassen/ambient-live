# Ambient Live instrument core

The portable instrument: a sine voice pool with click-free envelopes and a PCM sample voice, summed dry. Written in portable C++17, compiled to WASM for the browser, and hosted by the [live-mix](https://github.com/kieranklaassen/live-mix) engine as a `WasmDevice` on an `InstrumentTrack`.

Mixing lives in the library, not here: the Dattorro plate that used to sum everything in this core is live-mix's `createDattorroReverb` device on the master bus (same algorithm, same `dry·(1−mix) + wet·mix` law, same mono-sum feed), and master level is the library's master fader. Timeline clips play as library `AudioTrack` voices straight into the master, so the stereo input bus here is kept only for ABI completeness.

## Boundary rules

- No browser-only, Rails, or Inertia dependencies in this directory. The core must compile unchanged for a native shell (JUCE/AUv3 for the eventual iPad app).
- The UI talks to the instrument through the live-mix device ABI (`device_*`, see `node_modules/@kieranklaassen/live-mix/cpp/common/device_api.h`) plus the optional note exports (`device_note_on/off`) and this instrument's own sample-audition calls (`instrument_sample_*`), all in `src/api.cpp`; the engine never reads application state directly.
- Audio-thread code is allocation-free; denormals are flushed to zero in software (WASM has no hardware FTZ) — `dsp_util.h` is the library's copy.

## Layout

- `src/engine.{h,cpp}` — voice management, mixing, the `gain` parameter (id 0, default 1; the library master carries the 0.8).
- `src/sine_voice.h`, `src/sample_voice.h` — the two voices.
- `src/api.cpp` — flat C ABI exported to WASM.
- `test/engine_test.cpp` — native test harness (pitch, envelope, gain, stability, sample playback, input bus). Reverb tests moved to live-mix `cpp/test/dattorro_test.cpp`.

## Commands

- `script/test-engine` — compile with the system C++ compiler and run the native tests (needs `npm install` for the library headers).
- `script/build-engine` — compile to `app/frontend/audio/engine.wasm` with Emscripten 4.0.15 (no JS glue; the AudioWorklet instantiates the raw module). The artifact is committed so the app runs without Emscripten installed.
