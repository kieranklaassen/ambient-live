#pragma once

#include "dsp_util.h"

namespace ambient {

// Dattorro (JAES 1997) plate reverb: pre-delay -> input bandwidth lowpass ->
// 4 series input-diffusion allpasses -> figure-8 cross-coupled tank with a
// modulated allpass, main delay, damping lowpass, decay scaling, second
// allpass, and output delay per half. Stereo output is tapped at the paper's
// published points. All delay lengths are the paper's values at its 29761 Hz
// reference rate, scaled to the running sample rate at init.
class DattorroReverb {
 public:
  static constexpr float kMaxSupportedSampleRate = 96000.0f;

  void init(float sample_rate);

  void set_decay(float decay);          // 0..1
  void set_damping(float damping);      // 0..1 (0 = bright, 1 = dark)
  void set_predelay_ms(float ms);       // 0..kMaxPredelayMs

  // Mono in, stereo wet out (100% wet; the caller owns dry/wet mixing).
  void process(float in, float* wet_left, float* wet_right);

  // Test hooks: full flush-to-zero, and the denormal-guard invariant that no
  // stored state value sits in the flush range (0 < |v| < kDenormalThreshold).
  bool is_silent_state() const;
  bool has_denormal_state() const;

 private:
  template <int N>
  struct DelayBuffer {
    float data[N];
    int write_index;
    static constexpr int mask = N - 1;
    static_assert((N & (N - 1)) == 0, "delay buffers are power-of-two sized");

    void write(float x) {
      data[write_index] = flush_denormal(x);
      write_index = (write_index + 1) & mask;
    }
    // Value written `delay` samples ago (delay >= 1).
    float read(int delay) const {
      return data[(write_index - delay) & mask];
    }
    float read_interpolated(float delay) const {
      const int whole = static_cast<int>(delay);
      const float frac = delay - static_cast<float>(whole);
      const float a = read(whole);
      const float b = read(whole + 1);
      return a + (b - a) * frac;
    }
  };

  template <int N>
  struct Allpass {
    DelayBuffer<N> buffer;
    int length;

    float process(float x, float gain) {
      const float delayed = buffer.read(length);
      const float feed = x + gain * delayed;
      buffer.write(feed);
      return delayed - gain * feed;
    }
  };

  template <int N>
  struct ModulatedAllpass {
    DelayBuffer<N> buffer;
    float base_length;
    float excursion;
    float lfo_phase;
    float lfo_increment;

    float process(float x, float gain);
  };

  float scale_ = 1.0f;
  float sample_rate_ = 48000.0f;
  float decay_ = 0.7f;
  float damping_coefficient_ = 0.3f;
  float bandwidth_coefficient_ = 0.0005f;  // paper bandwidth 0.9995 => 1 - bw
  int predelay_samples_ = 1;

  DelayBuffer<32768> predelay_;
  OnePoleLowpass input_lowpass_;

  Allpass<512> input_diffusion_1_;
  Allpass<512> input_diffusion_2_;
  Allpass<2048> input_diffusion_3_;
  Allpass<1024> input_diffusion_4_;

  // Left tank half (paper nodes 24-39).
  ModulatedAllpass<4096> left_decay_diffusion_1_;   // 672, gain -0.70
  DelayBuffer<16384> left_delay_1_;                 // 4453
  OnePoleLowpass left_damping_;
  Allpass<16384> left_decay_diffusion_2_;           // 1800, gain +0.50
  DelayBuffer<16384> left_delay_2_;                 // 3720

  // Right tank half (paper nodes 48-63).
  ModulatedAllpass<4096> right_decay_diffusion_1_;  // 908, gain -0.70
  DelayBuffer<16384> right_delay_1_;                // 4217
  OnePoleLowpass right_damping_;
  Allpass<16384> right_decay_diffusion_2_;          // 2656, gain +0.50
  DelayBuffer<16384> right_delay_2_;                // 3163

  int left_delay_1_length_ = 1;
  int left_ap_2_length_ = 1;
  int left_delay_2_length_ = 1;
  int right_delay_1_length_ = 1;
  int right_ap_2_length_ = 1;
  int right_delay_2_length_ = 1;

  // Output tap offsets (scaled at init), per the paper's Table 2.
  int tap_left_[7] = {};
  int tap_right_[7] = {};

  float left_feedback_ = 0.0f;
  float right_feedback_ = 0.0f;
};

}  // namespace ambient
