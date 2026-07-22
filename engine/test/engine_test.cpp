// Native proof for the DSP core (plan U3). Compiled with the system C++
// compiler by script/test-engine; no WASM or browser involved.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>

#include "../src/engine.h"

namespace {

int g_failures = 0;

#define EXPECT(condition, message)                                     \
  do {                                                                 \
    if (!(condition)) {                                                \
      std::printf("FAIL: %s (%s:%d)\n", message, __FILE__, __LINE__);  \
      ++g_failures;                                                    \
    }                                                                  \
  } while (0)

constexpr float kSampleRate = 48000.0f;
constexpr int kBlock = 128;

ambient::Engine g_test_engine;

// Renders `seconds` of audio, returning peak absolute value across channels.
float render_seconds(ambient::Engine& engine, float seconds,
                     float* rms_out = nullptr) {
  const int total_frames = static_cast<int>(seconds * kSampleRate);
  float peak = 0.0f;
  double sum_squares = 0.0;
  int rendered = 0;
  while (rendered < total_frames) {
    const int frames = std::min(kBlock, total_frames - rendered);
    engine.process(frames);
    const float* left = engine.out_left();
    const float* right = engine.out_right();
    for (int i = 0; i < frames; ++i) {
      const float al = std::fabs(left[i]);
      const float ar = std::fabs(right[i]);
      if (al > peak) peak = al;
      if (ar > peak) peak = ar;
      sum_squares += static_cast<double>(left[i]) * left[i];
      if (std::isnan(left[i]) || std::isinf(left[i]) || std::isnan(right[i]) ||
          std::isinf(right[i])) {
        return 1.0e9f;  // poison value; asserted against below
      }
    }
    rendered += frames;
  }
  if (rms_out != nullptr) {
    *rms_out = static_cast<float>(std::sqrt(sum_squares / total_frames));
  }
  return peak;
}

void test_sine_pitch_and_silence() {
  ambient::Engine& engine = g_test_engine;
  engine.init(kSampleRate);
  engine.set_param(ambient::Param::kReverbMix, 0.0f);
  engine.note_on(1, 440.0f, 0.5f);

  // Skip the attack, then count positive-going zero crossings over 1s.
  render_seconds(engine, 0.05f);
  const int frames = static_cast<int>(kSampleRate);
  int crossings = 0;
  float previous = 0.0f;
  int rendered = 0;
  while (rendered < frames) {
    engine.process(kBlock);
    const float* left = engine.out_left();
    for (int i = 0; i < kBlock; ++i) {
      if (previous <= 0.0f && left[i] > 0.0f) ++crossings;
      previous = left[i];
    }
    rendered += kBlock;
  }
  EXPECT(crossings > 430 && crossings < 450,
         "440Hz sine should cross zero upward ~440 times per second");

  // Release: after note_off plus release time, dry output returns to silence.
  engine.note_off(1);
  render_seconds(engine, 2.0f);
  const float peak = render_seconds(engine, 0.5f);
  EXPECT(peak == 0.0f, "dry output should be exactly silent after release");
}

void test_attack_has_no_click() {
  ambient::Engine& engine = g_test_engine;
  engine.init(kSampleRate);
  engine.set_param(ambient::Param::kReverbMix, 0.0f);
  engine.note_on(1, 440.0f, 1.0f);
  engine.process(8);
  const float* left = engine.out_left();
  EXPECT(std::fabs(left[0]) < 0.01f,
         "first sample after note_on should ramp from near zero");
  EXPECT(std::fabs(left[7]) < 0.2f, "early attack should still be quiet");
}

void test_reverb_tail_exists_and_decays() {
  ambient::Engine& engine = g_test_engine;
  engine.init(kSampleRate);
  engine.set_param(ambient::Param::kReverbMix, 1.0f);
  engine.set_param(ambient::Param::kReverbDecay, 0.7f);
  engine.set_param(ambient::Param::kReverbPredelayMs, 1.0f);

  // Impulse via a very short note burst.
  engine.note_on(1, 880.0f, 1.0f);
  render_seconds(engine, 0.05f);
  engine.note_off(1);

  float rms_early = 0.0f;
  render_seconds(engine, 0.5f, &rms_early);
  float rms_mid = 0.0f;
  render_seconds(engine, 0.5f, &rms_mid);
  render_seconds(engine, 1.5f);
  float rms_late = 0.0f;
  render_seconds(engine, 0.5f, &rms_late);

  EXPECT(rms_early > 1.0e-5f, "reverb tail should carry energy at 0.5s");
  EXPECT(rms_mid > 0.0f, "reverb tail should still be audible after 1s");
  EXPECT(rms_late < rms_early, "reverb tail should decay over time");
}

void test_decay_parameter_lengthens_tail() {
  const auto tail_rms_at_2s = [](float decay) {
    ambient::Engine& engine = g_test_engine;
    engine.init(kSampleRate);
    engine.set_param(ambient::Param::kReverbMix, 1.0f);
    engine.set_param(ambient::Param::kReverbDecay, decay);
    engine.set_param(ambient::Param::kReverbPredelayMs, 1.0f);
    engine.note_on(1, 440.0f, 1.0f);
    render_seconds(engine, 0.05f);
    engine.note_off(1);
    render_seconds(engine, 2.0f);
    float rms = 0.0f;
    render_seconds(engine, 0.25f, &rms);
    return rms;
  };

  const float long_tail = tail_rms_at_2s(0.9f);
  const float short_tail = tail_rms_at_2s(0.3f);
  EXPECT(long_tail > short_tail * 4.0f,
         "decay=0.9 should leave much more tail at 2s than decay=0.3");
}

void test_stability_under_load() {
  ambient::Engine& engine = g_test_engine;
  engine.init(kSampleRate);
  engine.set_param(ambient::Param::kReverbMix, 0.5f);
  engine.set_param(ambient::Param::kReverbDecay, 0.95f);

  for (int i = 0; i < 8; ++i) {
    engine.note_on(i, 110.0f * (i + 1), 0.4f);
  }
  float peak = render_seconds(engine, 10.0f);
  for (int i = 0; i < 8; ++i) engine.note_off(i);
  const float peak_tail = render_seconds(engine, 20.0f);
  if (peak_tail > peak) peak = peak_tail;

  EXPECT(peak < 4.0f, "30s of processing should stay bounded (no blowup)");
  EXPECT(peak < 1.0e8f, "no NaN/inf during sustained processing");
}

void test_denormals_flush_to_silence() {
  ambient::Engine& engine = g_test_engine;
  engine.init(kSampleRate);
  engine.set_param(ambient::Param::kReverbMix, 1.0f);
  engine.set_param(ambient::Param::kReverbDecay, 0.5f);
  engine.note_on(1, 440.0f, 1.0f);
  render_seconds(engine, 0.05f);
  engine.note_off(1);

  // After 10s of silence, no state may sit in the denormal range (the guard
  // invariant: values are exactly 0 or above the flush threshold) ...
  render_seconds(engine, 10.0f);
  EXPECT(!engine.reverb().has_denormal_state(),
         "no reverb state should linger in the denormal range");
  // ... and shortly after, everything has flushed to exact zero.
  render_seconds(engine, 2.0f);
  EXPECT(engine.reverb().is_silent_state(),
         "reverb state should flush to exact zero after a long silence");
}

void test_sample_playback() {
  ambient::Engine& engine = g_test_engine;
  engine.init(kSampleRate);
  engine.set_param(ambient::Param::kReverbMix, 0.0f);
  engine.set_param(ambient::Param::kMasterGain, 1.0f);

  const int frames = 1000;
  float* buffer = engine.sample_data();
  for (int i = 0; i < frames; ++i) {
    buffer[i] = static_cast<float>(i) / frames;  // mono ramp
  }
  engine.sample_loaded(frames, 1);
  engine.sample_play();
  EXPECT(engine.sample_playing(), "sample should report playing after play()");

  engine.process(kBlock);
  const float* left = engine.out_left();
  const float* right = engine.out_right();
  bool matches = true;
  for (int i = 0; i < kBlock; ++i) {
    const float expected = static_cast<float>(i) / frames;
    if (std::fabs(left[i] - expected) > 1.0e-6f ||
        std::fabs(right[i] - expected) > 1.0e-6f) {
      matches = false;
      break;
    }
  }
  EXPECT(matches, "mono sample should play back verbatim on both channels");

  // Drain past the end: playback stops and output returns to silence.
  engine.process(frames);
  EXPECT(!engine.sample_playing(), "sample should stop at end of buffer");
  engine.process(kBlock);
  float residual = 0.0f;
  for (int i = 0; i < kBlock; ++i) {
    residual += std::fabs(engine.out_left()[i]);
  }
  EXPECT(residual == 0.0f, "output should be silent after sample ends");
}

}  // namespace

int main() {
  test_sine_pitch_and_silence();
  test_attack_has_no_click();
  test_reverb_tail_exists_and_decays();
  test_decay_parameter_lengthens_tail();
  test_stability_under_load();
  test_denormals_flush_to_silence();
  test_sample_playback();

  if (g_failures == 0) {
    std::printf("engine tests: all passed\n");
    return 0;
  }
  std::printf("engine tests: %d failure(s)\n", g_failures);
  return 1;
}
