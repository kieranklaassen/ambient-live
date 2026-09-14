# Live input latency spike (U27)

Guitar/mic monitoring through the mix, with a number attached. Part of the
live-mix unified plan, unit U27 (requirements R15 partial, R16).

## What is wired

- `LiveEngine.start()` opens the context with `latencyHint: 'interactive'`,
  the smallest output buffer the device allows.
- `LiveEngine.input` is a library `LiveInputTrack` named `input`, feeding the
  master like the synth and the clips do (so it goes through the plate and the
  master fader). It creates no nodes until a stream is attached.
- `enableLiveInput(stream)` attaches a `getUserMedia` stream captured with
  `LIVE_INPUT_CONSTRAINTS`: `echoCancellation`, `noiseSuppression` and
  `autoGainControl` off. Voice processing colours an instrument and adds its
  own buffering; without echo cancellation, monitor on headphones or expect
  feedback from speakers.
- Monitoring is the input strip's mute gate (`setLiveInputMonitor`), a 5 ms
  `setTargetAtTime` ramp, so toggling is click-free and the stream stays
  attached. Level and pan are the strip fader and panner.
- The "Live input" device panel (`pages/live/live-input-controls.tsx`) holds
  the power (enable/disable capture), monitor, level, pan, the latency readout
  and the measure button. Its controls are also MIDI targets
  (`input.level`, `input.pan`, `input.monitor`, see `midi-mapping.md`).

## The readout

| Row | Source | Meaning |
|---|---|---|
| Base | `AudioContext.baseLatency` | Render quantum → output buffer hand-off. |
| Output | `AudioContext.outputLatency` | Output buffer → DAC. Chrome fills it in once audio flows (polled with the meter); Safari reports nothing, shown as `—`. |
| Input | `MediaStreamTrack.getSettings().latency` | The capture buffer Chrome reports for the input device; `—` elsewhere. |
| Round trip | measured | Output → input on the audio clock, see below. |

`Base + Output` is what a synth note pays on the way out. The round trip is
what a player hears when monitoring: input path + graph + output path, plus
whatever the sound travelled through between the speaker and the microphone.

## Measurement method

`audio/latency.ts` (pure) and `audio/latency-probe.ts` (graph):

1. A capture `AudioWorkletNode` (`latency-probe-processor.ts`) is connected to
   the live input's source node. On `arm` it records the next second of input
   and notes the render frame it started on (`currentFrame`).
2. A 30 ms Hann-windowed linear chirp (400 → 4000 Hz, −6 dBFS) is scheduled on
   an `AudioBufferSourceNode` at `t₀ = currentTime + 0.15 s`, connected straight
   to `context.destination`, bypassing the mix so the plate does not smear it.
3. When the capture comes back, it is cross-correlated against the chirp. The
   lag of the peak gives the arrival time on the same clock:
   `roundTrip = (captureStartFrame + lag) / sampleRate − t₀`.
4. Two gates reject false readings:
   - the peak must stand at least 8× above the RMS of the correlation
     (`MIN_PROBE_CONFIDENCE`), which rejects plain noise;
   - the measurement runs three passes and reports their median only when the
     passes agree within 2 ms (`agreeingRoundTrip`). A real loopback repeats to
     the sample; a microphone hearing something else (a beep, a voice)
     correlates somewhere different each time and reads as
     "no loopback heard".

Every pass is audible. The probe never touches the reverb or the master fader.

## Results

### This VM (headless Chrome 148, Linux, no audio hardware)

Run from `/tmp` with a Vite-built harness importing the same modules, driven
over the DevTools protocol. Chrome ran with its fake audio output and
`--use-fake-device-for-media-stream`.

| Figure | Value |
|---|---|
| `sampleRate` | 44 100 Hz |
| `baseLatency` | 10.0 ms (441 frames) |
| `outputLatency` | 0 at start, 30.0 ms once audio flowed |
| Fake input track `latency` | 10.0 ms |
| **In-graph MediaStream loopback** (`MediaStreamDestination` → `MediaStreamSource`), 3 runs × 3 passes | **21.61 ms** (953 frames) on 9 of 9 passes, confidence 59.9 |
| Fake microphone (a beep, no loopback) | passes 354 / 294 / 226 ms disagree → `null`, as intended |

The loopback number isolates Chrome's own MediaStream plumbing with no device
in the path: output side (`MediaStreamDestination`) plus input side
(`MediaStreamSource`) add about 21.6 ms between the graph and itself. A
microphone path pays the input half of that plus the device's capture buffer
plus the output buffer.

### On a real machine (to be recorded by Kieran)

The acceptance line for U27 is "monitoring playable, ~50 ms or better".
Steps:

1. `bin/dev`, open the workstation, **Start audio**.
2. Power on **Live input**, allow the microphone (pick the interface, not a
   webcam mic, in the browser's picker). The readout shows Base / Output / Input.
3. Either put the speakers within reach of the microphone, or on an audio
   interface run a loopback cable (output → input). Press **Measure round
   trip** and note the number. If the passes disagree the readout says "no
   loopback heard": turn the output up, or move closer.
4. Speak or play with **Monitor** on and judge.

Expected ballpark for Chrome on macOS: built-in mic and speakers, 20–40 ms
round trip (`baseLatency` ≈ 2.7 ms at 48 kHz, `outputLatency` 10–20 ms); a
class-compliant interface at a 128-frame buffer, 10–20 ms. Safari cannot show
`outputLatency` and its capture is demo-grade by the app's own assumptions.

## Limits and follow-ups

- No plugin-delay compensation on the live path; the plate reports
  `latencySec = 0` and the strip adds none, so the graph contributes one
  render quantum.
- The probe is mono and plays through the default output even when the
  engine's output router is in element mode (not used by ambient-live).
- Library note (no change needed for this unit): a `LiveInputTrack` that
  exposed the `MediaStreamTrack` settings, or an engine-level
  `latency()` helper, would let consumers drop the small adapters here.
