import { describe, expect, it } from 'vitest'
import { filesToLocalSamples, isAudioFileName, nextLocalSampleId } from './local-folder'

describe('local-folder helpers', () => {
  it('recognizes common audio extensions', () => {
    expect(isAudioFileName('pad.wav')).toBe(true)
    expect(isAudioFileName('hit.MP3')).toBe(true)
    expect(isAudioFileName('readme.txt')).toBe(false)
  })
  it('allocates descending negative ids away from server ids', () => {
    expect(nextLocalSampleId([{ id: 1 }, { id: 9 }])).toBe(-1)
    expect(nextLocalSampleId([{ id: -3 }, { id: 2 }])).toBe(-4)
  })
  it('maps audio files to local SampleItem rows with blob urls', () => {
    const wav = new File([new Uint8Array([1, 2, 3])], 'drone.wav', { type: 'audio/wav' })
    const txt = new File(['hi'], 'notes.txt', { type: 'text/plain' })
    const samples = filesToLocalSamples([wav, txt], [{ id: 12 }])
    expect(samples).toHaveLength(1)
    expect(samples[0]?.id).toBe(-1)
    expect(samples[0]?.name).toBe('drone.wav')
    expect(samples[0]?.url.startsWith('blob:')).toBe(true)
    for (const sample of samples) URL.revokeObjectURL(sample.url)
  })
})
