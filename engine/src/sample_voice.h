#pragma once

namespace ambient {

// Plays the statically allocated PCM sample buffer. The UI decodes audio
// files with the browser's decoder and ships raw frames; the core stays
// codec-free (plan R17). Mono samples play to both channels.
struct SampleVoice {
  // 2^21 frames: ~43s at 48 kHz, ~21s at 96 kHz. Static allocation only.
  static constexpr int kMaxFrames = 1 << 21;

  float buffer[kMaxFrames * 2];
  int frames = 0;
  int channels = 0;
  int position = 0;
  bool playing = false;

  float* data() { return buffer; }

  void loaded(int frame_count, int channel_count) {
    if (frame_count < 0) frame_count = 0;
    if (frame_count > kMaxFrames) frame_count = kMaxFrames;
    frames = frame_count;
    channels = (channel_count == 2) ? 2 : 1;
    position = 0;
    playing = false;
  }

  void play() {
    if (frames == 0) return;
    position = 0;
    playing = true;
  }

  void stop() { playing = false; }

  void render(float* left, float* right) {
    if (!playing || position >= frames) {
      playing = false;
      return;
    }
    if (channels == 2) {
      *left += buffer[position * 2];
      *right += buffer[position * 2 + 1];
    } else {
      const float value = buffer[position];
      *left += value;
      *right += value;
    }
    ++position;
    if (position >= frames) playing = false;
  }
};

}  // namespace ambient
