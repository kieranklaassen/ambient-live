#include "dattorro_reverb.h"

#include <cmath>

namespace ambient {
namespace {

// Delay lengths from Dattorro 1997, Table 1, at the 29761 Hz reference rate.
constexpr float kReferenceRate = 29761.0f;

constexpr float kInputDiffusion1 = 0.750f;
constexpr float kInputDiffusion2 = 0.625f;
constexpr float kDecayDiffusion1 = -0.700f;  // "note sign" in the paper
constexpr float kDecayDiffusion2 = 0.500f;

constexpr int kInputAp1 = 142;
constexpr int kInputAp2 = 107;
constexpr int kInputAp3 = 379;
constexpr int kInputAp4 = 277;

constexpr int kLeftModAp = 672;
constexpr int kLeftDelay1 = 4453;
constexpr int kLeftAp2 = 1800;
constexpr int kLeftDelay2 = 3720;

constexpr int kRightModAp = 908;
constexpr int kRightDelay1 = 4217;
constexpr int kRightAp2 = 2656;
constexpr int kRightDelay2 = 3163;

constexpr float kExcursion = 12.0f;  // modulation depth, reference samples
constexpr float kLeftLfoHz = 1.00f;
constexpr float kRightLfoHz = 0.95f;

// Output taps, paper Table 2 (reference samples). Left reads mostly from the
// right half and vice versa, which is what decorrelates the stereo field.
constexpr int kTapLeft[7] = {266, 2974, 1913, 1996, 1990, 187, 1066};
constexpr int kTapRight[7] = {353, 3627, 1228, 2673, 2111, 335, 121};

constexpr float kTwoPi = 6.28318530717958647692f;
constexpr float kMaxPredelayMs = 250.0f;

}  // namespace

template <int N>
float DattorroReverb::ModulatedAllpass<N>::process(float x, float gain) {
  lfo_phase += lfo_increment;
  if (lfo_phase >= kTwoPi) lfo_phase -= kTwoPi;
  const float delay = base_length + excursion * (1.0f + std::sin(lfo_phase)) * 0.5f;

  const float delayed = buffer.read_interpolated(delay);
  const float feed = x + gain * delayed;
  buffer.write(feed);
  return delayed - gain * feed;
}

void DattorroReverb::init(float sample_rate) {
  *this = DattorroReverb();
  sample_rate_ = sample_rate;
  scale_ = sample_rate / kReferenceRate;

  const auto scaled = [this](int reference_samples) {
    const int value = static_cast<int>(reference_samples * scale_ + 0.5f);
    return value < 1 ? 1 : value;
  };

  input_diffusion_1_.length = scaled(kInputAp1);
  input_diffusion_2_.length = scaled(kInputAp2);
  input_diffusion_3_.length = scaled(kInputAp3);
  input_diffusion_4_.length = scaled(kInputAp4);

  left_decay_diffusion_1_.base_length = kLeftModAp * scale_;
  left_decay_diffusion_1_.excursion = kExcursion * scale_;
  left_decay_diffusion_1_.lfo_increment = kTwoPi * kLeftLfoHz / sample_rate;
  left_delay_1_length_ = scaled(kLeftDelay1);
  left_ap_2_length_ = scaled(kLeftAp2);
  left_decay_diffusion_2_.length = left_ap_2_length_;
  left_delay_2_length_ = scaled(kLeftDelay2);

  right_decay_diffusion_1_.base_length = kRightModAp * scale_;
  right_decay_diffusion_1_.excursion = kExcursion * scale_;
  right_decay_diffusion_1_.lfo_increment = kTwoPi * kRightLfoHz / sample_rate;
  // Quadrature start so the two modulators decorrelate.
  right_decay_diffusion_1_.lfo_phase = kTwoPi * 0.25f;
  right_delay_1_length_ = scaled(kRightDelay1);
  right_ap_2_length_ = scaled(kRightAp2);
  right_decay_diffusion_2_.length = right_ap_2_length_;
  right_delay_2_length_ = scaled(kRightDelay2);

  for (int i = 0; i < 7; ++i) {
    tap_left_[i] = scaled(kTapLeft[i]);
    tap_right_[i] = scaled(kTapRight[i]);
  }

  set_decay(0.7f);
  set_damping(0.3f);
  set_predelay_ms(20.0f);
}

void DattorroReverb::set_decay(float decay) {
  if (decay < 0.0f) decay = 0.0f;
  if (decay > 0.9999f) decay = 0.9999f;
  decay_ = decay;
}

void DattorroReverb::set_damping(float damping) {
  if (damping < 0.0f) damping = 0.0f;
  if (damping > 0.9999f) damping = 0.9999f;
  damping_coefficient_ = damping;
}

void DattorroReverb::set_predelay_ms(float ms) {
  if (ms < 0.0f) ms = 0.0f;
  if (ms > kMaxPredelayMs) ms = kMaxPredelayMs;
  int samples = static_cast<int>(ms * 0.001f * sample_rate_ + 0.5f);
  if (samples < 1) samples = 1;
  predelay_samples_ = samples;
}

void DattorroReverb::process(float in, float* wet_left, float* wet_right) {
  predelay_.write(in);
  float x = input_lowpass_.process(predelay_.read(predelay_samples_),
                                   bandwidth_coefficient_);

  x = input_diffusion_1_.process(x, kInputDiffusion1);
  x = input_diffusion_2_.process(x, kInputDiffusion1);
  x = input_diffusion_3_.process(x, kInputDiffusion2);
  x = input_diffusion_4_.process(x, kInputDiffusion2);

  // Figure-8: each half consumes the other half's delayed output.
  float left = x + decay_ * right_feedback_;
  left = left_decay_diffusion_1_.process(left, kDecayDiffusion1);
  left_delay_1_.write(left);
  left = left_damping_.process(left_delay_1_.read(left_delay_1_length_),
                               damping_coefficient_);
  left *= decay_;
  left = left_decay_diffusion_2_.process(left, kDecayDiffusion2);
  left_delay_2_.write(left);
  left_feedback_ = left_delay_2_.read(left_delay_2_length_);

  float right = x + decay_ * left_feedback_;
  right = right_decay_diffusion_1_.process(right, kDecayDiffusion1);
  right_delay_1_.write(right);
  right = right_damping_.process(right_delay_1_.read(right_delay_1_length_),
                                 damping_coefficient_);
  right *= decay_;
  right = right_decay_diffusion_2_.process(right, kDecayDiffusion2);
  right_delay_2_.write(right);
  right_feedback_ = right_delay_2_.read(right_delay_2_length_);

  // Paper Table 2 output taps.
  float out_l = 0.6f * right_delay_1_.read(tap_left_[0]);
  out_l += 0.6f * right_delay_1_.read(tap_left_[1]);
  out_l -= 0.6f * right_decay_diffusion_2_.buffer.read(tap_left_[2]);
  out_l += 0.6f * right_delay_2_.read(tap_left_[3]);
  out_l -= 0.6f * left_delay_1_.read(tap_left_[4]);
  out_l -= 0.6f * left_decay_diffusion_2_.buffer.read(tap_left_[5]);
  out_l -= 0.6f * left_delay_2_.read(tap_left_[6]);

  float out_r = 0.6f * left_delay_1_.read(tap_right_[0]);
  out_r += 0.6f * left_delay_1_.read(tap_right_[1]);
  out_r -= 0.6f * left_decay_diffusion_2_.buffer.read(tap_right_[2]);
  out_r += 0.6f * left_delay_2_.read(tap_right_[3]);
  out_r -= 0.6f * right_delay_1_.read(tap_right_[4]);
  out_r -= 0.6f * right_decay_diffusion_2_.buffer.read(tap_right_[5]);
  out_r -= 0.6f * right_delay_2_.read(tap_right_[6]);

  *wet_left = out_l;
  *wet_right = out_r;
}

bool DattorroReverb::is_silent_state() const {
  const auto buffer_silent = [](const float* data, int n) {
    for (int i = 0; i < n; ++i) {
      if (data[i] != 0.0f) return false;
    }
    return true;
  };
  return buffer_silent(left_delay_1_.data, 16384) &&
         buffer_silent(left_delay_2_.data, 16384) &&
         buffer_silent(right_delay_1_.data, 16384) &&
         buffer_silent(right_delay_2_.data, 16384) &&
         buffer_silent(left_decay_diffusion_2_.buffer.data, 16384) &&
         buffer_silent(right_decay_diffusion_2_.buffer.data, 16384) &&
         buffer_silent(left_decay_diffusion_1_.buffer.data, 4096) &&
         buffer_silent(right_decay_diffusion_1_.buffer.data, 4096) &&
         left_damping_.state == 0.0f && right_damping_.state == 0.0f &&
         left_feedback_ == 0.0f && right_feedback_ == 0.0f;
}

bool DattorroReverb::has_denormal_state() const {
  const auto buffer_has_denormal = [](const float* data, int n) {
    for (int i = 0; i < n; ++i) {
      const float magnitude = data[i] < 0.0f ? -data[i] : data[i];
      if (magnitude != 0.0f && magnitude < kDenormalThreshold) return true;
    }
    return false;
  };
  return buffer_has_denormal(left_delay_1_.data, 16384) ||
         buffer_has_denormal(left_delay_2_.data, 16384) ||
         buffer_has_denormal(right_delay_1_.data, 16384) ||
         buffer_has_denormal(right_delay_2_.data, 16384) ||
         buffer_has_denormal(left_decay_diffusion_2_.buffer.data, 16384) ||
         buffer_has_denormal(right_decay_diffusion_2_.buffer.data, 16384) ||
         buffer_has_denormal(left_decay_diffusion_1_.buffer.data, 4096) ||
         buffer_has_denormal(right_decay_diffusion_1_.buffer.data, 4096);
}

}  // namespace ambient
