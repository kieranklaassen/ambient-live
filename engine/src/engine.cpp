#include "engine.h"

namespace ambient {

void Engine::init(float sample_rate) {
  sample_rate_ = sample_rate;
  reverb_mix_ = 0.35f;
  master_gain_ = 0.8f;
  for (SineVoice& voice : voices_) {
    voice = SineVoice();
    voice.init(sample_rate);
  }
  sample_.loaded(0, 1);
  reverb_.init(sample_rate);
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
    case Param::kReverbMix:
      if (value < 0.0f) value = 0.0f;
      if (value > 1.0f) value = 1.0f;
      reverb_mix_ = value;
      break;
    case Param::kReverbDecay:
      reverb_.set_decay(value);
      break;
    case Param::kReverbDamping:
      reverb_.set_damping(value);
      break;
    case Param::kReverbPredelayMs:
      reverb_.set_predelay_ms(value);
      break;
    case Param::kMasterGain:
      if (value < 0.0f) value = 0.0f;
      if (value > 2.0f) value = 2.0f;
      master_gain_ = value;
      break;
  }
}

void Engine::process(int frames) {
  if (frames > kMaxBlockFrames) frames = kMaxBlockFrames;
  const float dry_gain = 1.0f - reverb_mix_;

  for (int i = 0; i < frames; ++i) {
    float dry_left = 0.0f;
    float dry_right = 0.0f;

    for (SineVoice& voice : voices_) {
      const float value = voice.render();
      dry_left += value;
      dry_right += value;
    }
    sample_.render(&dry_left, &dry_right);

    float wet_left = 0.0f;
    float wet_right = 0.0f;
    reverb_.process((dry_left + dry_right) * 0.5f, &wet_left, &wet_right);

    out_left_[i] = master_gain_ * (dry_left * dry_gain + wet_left * reverb_mix_);
    out_right_[i] =
        master_gain_ * (dry_right * dry_gain + wet_right * reverb_mix_);
  }
}

}  // namespace ambient
