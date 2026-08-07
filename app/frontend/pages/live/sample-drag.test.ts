import { describe, expect, it } from 'vitest'

import { parseSampleDrag, serializeSampleDrag } from './sample-drag'

describe('serializeSampleDrag / parseSampleDrag', () => {
  it('round-trips a sample id payload', () => {
    const payload = { sampleId: 42, name: 'pad', url: '/rails/active_storage/blobs/xyz' }
    expect(parseSampleDrag(serializeSampleDrag(payload))).toEqual(payload)
  })

  it('returns null for empty or malformed drop data', () => {
    expect(parseSampleDrag(null)).toBeNull()
    expect(parseSampleDrag('')).toBeNull()
    expect(parseSampleDrag('not-json')).toBeNull()
    expect(parseSampleDrag('{"sampleId":"x","name":"a","url":"/u"}')).toBeNull()
    expect(parseSampleDrag('{"sampleId":1,"name":1,"url":"/u"}')).toBeNull()
  })
})
