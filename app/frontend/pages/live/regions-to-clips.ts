// Maps the timeline's SampleRegions (with their overlap-derived fades) to the
// engine's Clip records. Pure, so the scheduling contract is provable without
// audio: what the timeline draws is exactly what the track plays.

import type { Clip } from '@kieranklaassen/live-mix'

import type { ClipFades } from './timeline-clips'
import type { SampleRegion } from './timeline-model'

export function sampleSourceId(sampleId: number): string {
  return String(sampleId)
}

export function regionsToClips(
  regions: readonly SampleRegion[],
  clipFades: ReadonlyMap<string, ClipFades>,
): Clip[] {
  return regions.map((region) => {
    const fades = clipFades.get(region.id) ?? region
    return {
      id: region.id,
      sourceId: sampleSourceId(region.sampleId),
      startSec: region.startSec,
      offsetSec: region.offsetSec,
      durationSec: region.durationSec,
      fadeInSec: fades.fadeInSec,
      fadeOutSec: fades.fadeOutSec,
      fadeCurve: 'linear',
      gainDb: 0,
    }
  })
}
