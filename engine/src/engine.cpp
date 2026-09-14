#include "engine.h"

namespace ambient {

void Engine::init(float sample_rate) {
  sample_rate_ = sample_rate;
  gain_ = 1.0f;
  for (SineVoice& voice : voices_) {
    voice = SineVoice();
    voice.init(sample_rate);
  }
  sample_.loaded(0, 1);
  for (int i = 0; i < kMaxBlockFrames; ++i) {
    in_left_[i] = 0.0f;
    in_right_[i] = 0.0f;
  }
}

SineVoice* Engine::find_voice(int note_id) {
  for (SineVoice& voice : voices_) {
    if (voice.note_id == note_id && voice.stage != SineVoice::Stage::kIdle) {
      return &voice;
    }
  }
  return nullptr;
}

void Engine::note_on(int note_id, float frequency, float gain) {
  SineVoice* voice = find_voice(note_id);
  if (voice == nullptr) {
    for (SineVoice& candidate : voices_) {
      if (candidate.stage == SineVoice::Stage::kIdle) {
        voice = &candidate;
        break;
      }
    }
  }
  if (voice == nullptr) {
    // Steal the quietest voice.
    voice = &voices_[0];
    for (SineVoice& candidate : voices_) {
      if (candidate.envelope * candidate.gain <
          voice->envelope * voice->gain) {
        voice = &candidate;
      }
    }
  }
  voice->note_on(note_id, frequency, gain, sample_rate_);
}

void Engine::note_off(int note_id) {
  if (SineVoice* voice = find_voice(note_id)) {
    voice->note_off();
  }
}

void Engine::set_param(Param param, float value) {
  switch (param) {
    case Param::kGain:
      if (value < 0.0f) value = 0.0f;
      if (value > 2.0f) value = 2.0f;
      gain_ = value;
      break;
  }
}

void Engine::process(int frames) {
  if (frames > kMaxBlockFrames) frames = kMaxBlockFrames;

  for (int i = 0; i < frames; ++i) {
    float left = in_left_[i];
    float right = in_right_[i];
    // Consumed once: the host writes the next block from scratch.
    in_left_[i] = 0.0f;
    in_right_[i] = 0.0f;

    for (SineVoice& voice : voices_) {
      const float value = voice.render();
      left += value;
      right += value;
    }
    sample_.render(&left, &right);

    out_left_[i] = gain_ * left;
    out_right_[i] = gain_ * right;
  }
}

}  // namespace ambient
