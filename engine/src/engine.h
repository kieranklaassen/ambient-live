#pragma once

#include "dattorro_reverb.h"
#include "sample_voice.h"
#include "sine_voice.h"

namespace ambient {

// Parameter ids shared with the TypeScript wrapper (app/frontend/audio).
enum class Param : int {
  kReverbMix = 0,
  kReverbDecay = 1,
  kReverbDamping = 2,
  kReverbPredelayMs = 3,
  kMasterGain = 4,
};

// The whole instrument: a sine voice pool and one sample voice summed into a
// Dattorro plate. Statically allocated; process() is allocation-free.
class Engine {
 public:
  static constexpr int kVoiceCount = 8;
  static constexpr int kMaxBlockFrames = 2048;

  void init(float sample_rate);

  void note_on(int note_id, float frequency, float gain);
  void note_off(int note_id);
  void set_param(Param param, float value);

  float* sample_data() { return sample_.data(); }
  int sample_capacity_frames() const { return SampleVoice::kMaxFrames; }
  void sample_loaded(int frames, int channels) {
    sample_.loaded(frames, channels);
  }
  void sample_play() { sample_.play(); }
  void sample_stop() { sample_.stop(); }
  bool sample_playing() const { return sample_.playing; }

  // Renders `frames` (<= kMaxBlockFrames) into the internal output buffers.
  void process(int frames);

  const float* out_left() const { return out_left_; }
  const float* out_right() const { return out_right_; }

  DattorroReverb& reverb() { return reverb_; }

 private:
  SineVoice* find_voice(int note_id);

  float sample_rate_ = 48000.0f;
  float reverb_mix_ = 0.35f;
  float master_gain_ = 0.8f;

  SineVoice voices_[kVoiceCount];
  SampleVoice sample_;
  DattorroReverb reverb_;

  float out_left_[kMaxBlockFrames];
  float out_right_[kMaxBlockFrames];
};

}  // namespace ambient
