#pragma once

#include <cmath>

#include "dsp_util.h"

namespace ambient {

// One sine voice with a click-free linear attack and exponential release so
// releases decay into the reverb tail instead of cutting to silence.
struct SineVoice {
  enum class Stage { kIdle, kAttack, kSustain, kRelease };

  static constexpr float kTwoPi = 6.28318530717958647692f;
  static constexpr float kAttackSeconds = 0.008f;
  static constexpr float kReleaseSeconds = 0.4f;

  Stage stage = Stage::kIdle;
  int note_id = -1;
  float phase = 0.0f;
  float phase_increment = 0.0f;
  float gain = 0.0f;
  float envelope = 0.0f;
  float attack_increment = 0.0f;
  float release_coefficient = 0.0f;

  void init(float sample_rate) {
    attack_increment = 1.0f / (kAttackSeconds * sample_rate);
    // Exponential decay reaching -60 dB over the release time.
    release_coefficient =
        std::exp(-6.9077553f / (kReleaseSeconds * sample_rate));
  }

  void note_on(int id, float frequency, float note_gain, float sample_rate) {
    note_id = id;
    phase_increment = kTwoPi * frequency / sample_rate;
    gain = note_gain;
    stage = Stage::kAttack;
  }

  void note_off() {
    if (stage != Stage::kIdle) stage = Stage::kRelease;
  }

  float render() {
    switch (stage) {
      case Stage::kIdle:
        return 0.0f;
      case Stage::kAttack:
        envelope += attack_increment;
        if (envelope >= 1.0f) {
          envelope = 1.0f;
          stage = Stage::kSustain;
        }
        break;
      case Stage::kSustain:
        break;
      case Stage::kRelease:
        envelope = flush_denormal(envelope * release_coefficient);
        if (envelope == 0.0f) {
          stage = Stage::kIdle;
          note_id = -1;
          return 0.0f;
        }
        break;
    }

    phase += phase_increment;
    if (phase >= kTwoPi) phase -= kTwoPi;
    return std::sin(phase) * envelope * gain;
  }
};

}  // namespace ambient
