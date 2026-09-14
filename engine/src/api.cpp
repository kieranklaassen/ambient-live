// Flat C ABI over the instrument for the WASM/AudioWorklet boundary: the
// live-mix device ABI (device_api.h, including the optional note exports) plus
// the instrument's own sample-audition calls. The single static Engine
// instance is the only global state.

#include <device_api.h>

#include "engine.h"

namespace {
ambient::Engine g_engine;
}

extern "C" {

// --- live-mix device ABI -----------------------------------------------------

void device_init(float sample_rate, int /*max_block_frames*/) {
  g_engine.init(sample_rate);
}

void device_set_param(int param_id, float value) {
  g_engine.set_param(static_cast<ambient::Param>(param_id), value);
}

float* device_in_left(void) { return g_engine.in_left(); }

float* device_in_right(void) { return g_engine.in_right(); }

float* device_out_left(void) {
  return const_cast<float*>(g_engine.out_left());
}

float* device_out_right(void) {
  return const_cast<float*>(g_engine.out_right());
}

int device_max_block_frames(void) { return ambient::Engine::kMaxBlockFrames; }

void device_process(int frames) { g_engine.process(frames); }

void device_note_on(int note_id, float frequency, float gain) {
  g_engine.note_on(note_id, frequency, gain);
}

void device_note_off(int note_id) { g_engine.note_off(note_id); }

// --- instrument extras (app-local processor messages) -----------------------

float* instrument_sample_buffer(void) { return g_engine.sample_data(); }

int instrument_sample_capacity_frames(void) {
  return g_engine.sample_capacity_frames();
}

void instrument_sample_loaded(int frames, int channels) {
  g_engine.sample_loaded(frames, channels);
}

void instrument_sample_play(void) { g_engine.sample_play(); }

void instrument_sample_stop(void) { g_engine.sample_stop(); }

int instrument_sample_playing(void) {
  return g_engine.sample_playing() ? 1 : 0;
}

}  // extern "C"
