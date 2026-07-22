# Ambient Live DSP Engine

The portable audio core. Implemented so far (v0.1 slice): a sine voice pool with click-free envelopes, a PCM sample voice, and a Dattorro (1997) plate reverb — everything sums through the reverb. Written in portable C++17, compiled to WASM for the browser. Faust remains a candidate for later devices (granular engine, delays).

## Boundary rules

- No browser-only, Rails, or Inertia dependencies in this directory. The core must compile unchanged for a native shell (JUCE/AUv3 for the eventual iPad app).
- The UI talks to the engine through a thin message/parameter interface (`src/api.cpp` C ABI); the engine never reads application state directly.
- Audio-thread code is allocation-free; denormals are flushed to zero in software (WASM has no hardware FTZ) — see `src/dsp_util.h`.

## Layout

- `src/engine.{h,cpp}` — voice management, mixing, parameter routing.
- `src/sine_voice.h`, `src/sample_voice.h` — the two v0.1 voices.
- `src/dattorro_reverb.{h,cpp}` — the plate reverb (figure-8 tank, paper tap points).
- `src/api.cpp` — flat C ABI exported to WASM.
- `test/engine_test.cpp` — native test harness (pitch, envelope, tail, decay, stability, denormal guard, sample playback).

## Commands

- `script/test-engine` — compile with the system C++ compiler and run the native tests.
- `script/build-engine` — compile to `app/frontend/audio/engine.wasm` with Emscripten (no JS glue; the AudioWorklet instantiates the raw module). The artifact is committed so the app runs without Emscripten installed.
