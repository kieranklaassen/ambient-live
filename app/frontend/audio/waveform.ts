// Min/max peak extraction for drawing sample waveforms. Computed once per
// sample at decode time so the UI never has to decode audio a second time.

export interface WaveformPeaks {
  min: Float32Array
  max: Float32Array
}

export const DEFAULT_PEAK_BUCKETS = 512

export const EMPTY_PEAKS: WaveformPeaks = {
  min: new Float32Array(0),
  max: new Float32Array(0),
}

/**
 * Buckets `frameCount` frames into min/max pairs, folding every channel into
 * one pair per bucket. Takes raw channel arrays rather than an AudioBuffer so
 * it stays testable outside the browser.
 */
export function computePeaks(
  channels: readonly Float32Array[],
  frameCount: number,
  bucketCount: number = DEFAULT_PEAK_BUCKETS,
): WaveformPeaks {
  const buckets = Math.max(1, Math.floor(bucketCount))
  const min = new Float32Array(buckets)
  const max = new Float32Array(buckets)
  if (frameCount <= 0 || channels.length === 0) return { min, max }

  for (let bucket = 0; bucket < buckets; bucket++) {
    // A source shorter than the bucket count still gets one frame per bucket.
    const start = Math.min(Math.floor((bucket * frameCount) / buckets), frameCount - 1)
    const end = Math.max(
      start + 1,
      Math.min(Math.floor(((bucket + 1) * frameCount) / buckets), frameCount),
    )

    let low = Infinity
    let high = -Infinity
    for (const channel of channels) {
      for (let frame = start; frame < end; frame++) {
        const value = channel[frame] ?? 0
        if (value < low) low = value
        if (value > high) high = value
      }
    }
    min[bucket] = Number.isFinite(low) ? low : 0
    max[bucket] = Number.isFinite(high) ? high : 0
  }

  return { min, max }
}

/** The peaks covering a clip's audible slice, so a trimmed clip draws what it plays. */
export function slicePeaks(
  peaks: WaveformPeaks,
  offsetSec: number,
  durationSec: number,
  sourceDurationSec: number,
): WaveformPeaks {
  const total = peaks.min.length
  if (total === 0 || sourceDurationSec <= 0 || durationSec <= 0) return EMPTY_PEAKS

  const start = clampIndex(Math.floor((offsetSec / sourceDurationSec) * total), total - 1)
  const end = Math.max(
    start + 1,
    clampIndex(Math.ceil(((offsetSec + durationSec) / sourceDurationSec) * total), total),
  )
  return { min: peaks.min.subarray(start, end), max: peaks.max.subarray(start, end) }
}

function clampIndex(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(value, max)
}
