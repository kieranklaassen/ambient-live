#pragma once

namespace ambient {

// WASM has no hardware flush-to-zero; snap denormal-range values to 0 in
// feedback paths so tails don't devolve into denormal-speed math.
constexpr float kDenormalThreshold = 1.0e-15f;

inline float flush_denormal(float x) {
  return (x > -kDenormalThreshold && x < kDenormalThreshold) ? 0.0f : x;
}

// One-pole lowpass in the form Dattorro uses: y = x*(1-a) + y1*a.
struct OnePoleLowpass {
  float state = 0.0f;

  float process(float x, float coefficient) {
    state = flush_denormal(x * (1.0f - coefficient) + state * coefficient);
    return state;
  }
};

}  // namespace ambient
