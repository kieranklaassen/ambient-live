# Ambient Live

A browser-based ambient music instrument-DAW. The core interaction is **painting sound onto a slow-moving visual timeline** — painting is playing: parts sound in real time under the brush, persist on the timeline, and replay on every playhead pass. Built-in ambient-native devices (granular synth, sine synth, grain/echo delays, hall reverb), day-one live audio input, and a preset-and-sample library.

Personal project. Product requirements and decisions live in [docs/plans/2026-07-21-001-feat-ambient-live-plan.md](docs/plans/2026-07-21-001-feat-ambient-live-plan.md).

## Architecture at a glance

- **Rails 8 + Inertia + React (Vite, TypeScript, Tailwind)** — application chassis: auth, presets, and the sample library's server-side source of truth.
- **`engine/`** — the portable C++ DSP core, compiled to WASM/AudioWorklet for the browser. Strictly separated: no Rails or Inertia state ever threads into the engine, and the instrument must boot without the Rails server. This separation keeps a future native shell (desktop, iPad/AUv3) open without a rewrite.
- **`app/frontend/`** — the React UI, including the paint-timeline canvas.

## Development

```bash
bin/setup   # install dependencies
bin/dev     # run Rails + Vite dev servers
```
