import { describe, expect, it } from 'vitest'

import {
  SAMPLE_DRAG_MIME,
  isAllowedSampleUrl,
  parseSampleDrag,
  readSampleDragData,
  serializeSampleDrag,
} from './sample-drag'

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

  it('rejects cross-origin and unsafe sample urls', () => {
    const evil = serializeSampleDrag({
      sampleId: 1,
      name: 'x',
      url: 'http://127.0.0.1:8080/secret',
    })
    expect(parseSampleDrag(evil)).toBeNull()
    expect(
      parseSampleDrag(
        serializeSampleDrag({ sampleId: 1, name: 'x', url: 'https://evil.example/a.wav' }),
      ),
    ).toBeNull()
    expect(
      parseSampleDrag(serializeSampleDrag({ sampleId: 1, name: 'x', url: '//evil.example/a.wav' })),
    ).toBeNull()
  })

  it('allows blob urls and same-origin absolute urls', () => {
    expect(isAllowedSampleUrl('blob:https://app.example/uuid-1')).toBe(true)
    expect(isAllowedSampleUrl('https://app.example/rails/blob', 'https://app.example')).toBe(true)
    expect(isAllowedSampleUrl('https://other.example/rails/blob', 'https://app.example')).toBe(false)
  })
})

function fakeDataTransfer(entries: Record<string, string>): DataTransfer {
  return {
    getData: (type: string) => entries[type] ?? '',
    setData: () => {},
  } as unknown as DataTransfer
}

describe('readSampleDragData', () => {
  it('accepts only the typed MIME type, not text/plain', () => {
    const payload = { sampleId: 7, name: 'kick', url: '/samples/kick.wav' }
    const serialized = serializeSampleDrag(payload)
    expect(readSampleDragData(fakeDataTransfer({ 'text/plain': serialized }))).toBeNull()
    expect(readSampleDragData(fakeDataTransfer({ [SAMPLE_DRAG_MIME]: serialized }))).toEqual(payload)
  })
})
