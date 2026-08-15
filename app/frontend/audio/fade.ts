// The clip fade envelope. Linear, so the triangle the timeline draws over a
// clip corner is exactly the gain the clip player applies.

export function fadeGain(
  secondsIntoClip: number,
  durationSec: number,
  fadeInSec: number,
  fadeOutSec: number,
): number {
  if (durationSec <= 0) return 0
  if (secondsIntoClip <= 0) return fadeInSec > 0 ? 0 : 1
  if (secondsIntoClip >= durationSec) return fadeOutSec > 0 ? 0 : 1
  const rising = fadeInSec > 0 ? secondsIntoClip / fadeInSec : 1
  const falling = fadeOutSec > 0 ? (durationSec - secondsIntoClip) / fadeOutSec : 1
  return Math.min(Math.max(Math.min(rising, falling), 0), 1)
}
