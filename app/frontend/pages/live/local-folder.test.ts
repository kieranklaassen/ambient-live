import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  directoryPickerAbortReason,
  filesToLocalSamples,
  isAudioFileName,
  localFolderMode,
  nextLocalSampleId,
  pickLocalFolderSamples,
} from './local-folder'

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

describe('directory picker fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses file-input when the File System Access API is absent', () => {
    expect(localFolderMode()).toBe('file-input')
  })

  it('treats sub-250ms AbortError as a picker that never appeared', () => {
    expect(directoryPickerAbortReason(0.66)).toBe('unavailable')
    expect(directoryPickerAbortReason(249)).toBe('unavailable')
    expect(directoryPickerAbortReason(250)).toBe('cancelled')
  })

  it('maps an instant AbortError from showDirectoryPicker to unavailable', async () => {
    vi.stubGlobal('window', {
      showDirectoryPicker: async () => {
        throw new DOMException("Failed to execute 'showDirectoryPicker' on 'Window': The user aborted a request.", 'AbortError')
      },
    })
    await expect(pickLocalFolderSamples()).resolves.toEqual({ status: 'unavailable' })
  })

  it('maps SecurityError from showDirectoryPicker to unavailable', async () => {
    vi.stubGlobal('window', {
      showDirectoryPicker: async () => {
        throw new DOMException("Failed to execute 'showDirectoryPicker' on 'Window': Cross origin sub frames aren't allowed to show a file picker.", 'SecurityError')
      },
    })
    await expect(pickLocalFolderSamples()).resolves.toEqual({ status: 'unavailable' })
  })
})
