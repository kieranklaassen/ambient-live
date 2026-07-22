// Flat C ABI over the engine for the WASM/AudioWorklet boundary.
// The single static Engine instance is the only global state.

#include "engine.h"

namespace {
ambient::Engine g_engine;
}

extern "C" {

void engine_init(float sample_rate) { g_engine.init(sample_rate); }

void engine_note_on(int note_id, float frequency, float gain) {
  g_engine.note_on(note_id, frequency, gain);
}

void engine_note_off(int note_id) { g_engine.note_off(note_id); }

void engine_set_param(int param_id, float value) {
  g_engine.set_param(static_cast<ambient::Param>(param_id), value);
}

float* engine_sample_buffer() { return g_engine.sample_data(); }

int engine_sample_capacity_frames() {
  return g_engine.sample_capacity_frames();
}

void engine_sample_loaded(int frames, int channels) {
  g_engine.sample_loaded(frames, channels);
}

void engine_sample_play() { g_engine.sample_play(); }

void engine_sample_stop() { g_engine.sample_stop(); }

int engine_sample_playing() { return g_engine.sample_playing() ? 1 : 0; }

void engine_process(int frames) { g_engine.process(frames); }

const float* engine_out_left() { return g_engine.out_left(); }

const float* engine_out_right() { return g_engine.out_right(); }

}  // extern "C"
