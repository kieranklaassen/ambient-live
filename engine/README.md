# Ambient Live DSP Engine

The portable audio core: granular synthesis, sine synthesis, grain/echo delays, and the hall reverb. Written in portable C++ (Faust is a candidate for the hard DSP — see the plan's outstanding questions), compiled to WASM for the browser via Emscripten's Wasm Audio Worklets.

## Boundary rules

- No browser-only, Rails, or Inertia dependencies in this directory. The core must compile unchanged for a native shell (JUCE/AUv3 for the eventual iPad app).
- The UI talks to the engine through a thin message/parameter interface; the engine never reads application state directly.
- Audio-thread code is allocation-free; denormals are flushed to zero in software (WASM has no hardware FTZ).

Nothing is implemented yet — structure and toolchain are planning decisions. See `docs/plans/2026-07-21-001-feat-ambient-live-plan.md`.
