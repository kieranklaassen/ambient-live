import type { SampleItem } from './sample-library'

const AUDIO_EXTENSIONS = new Set(['.wav','.wave','.mp3','.aif','.aiff','.flac','.ogg','.m4a','.aac'])

export type LocalFolderMode = 'directory-picker' | 'file-input'
export type PickLocalFolderResult =
  | { status: 'picked'; samples: SampleItem[]; folderName: string }
  | { status: 'cancelled' }
  | { status: 'unavailable' }

/** Chromium aborts a picker that never appeared in well under this; a real cancel takes longer. */
export const DIRECTORY_PICKER_INSTANT_ABORT_MS = 250

export function directoryPickerAbortReason(elapsedMs: number): 'unavailable' | 'cancelled' {
  return elapsedMs < DIRECTORY_PICKER_INSTANT_ABORT_MS ? 'unavailable' : 'cancelled'
}

function isTopLevelWindow(): boolean {
  try {
    return window.top === window.self
  } catch {
    return false
  }
}

export function canUseDirectoryPicker(): boolean {
  if (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function') return false
  if (!isTopLevelWindow()) return false
  if (typeof navigator !== 'undefined' && (navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent))) return false
  return true
}

export function localFolderMode(): LocalFolderMode {
  return canUseDirectoryPicker() ? 'directory-picker' : 'file-input'
}

export function isAudioFileName(name: string): boolean {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return false
  return AUDIO_EXTENSIONS.has(lower.slice(dot))
}

export function isAudioFile(file: File): boolean {
  if (file.type.startsWith('audio/')) return true
  return isAudioFileName(file.name)
}

export function nextLocalSampleId(existing: readonly Pick<SampleItem, 'id'>[]): number {
  let min = 0
  for (const sample of existing) {
    if (sample.id < min) min = sample.id
  }
  return min - 1
}

export function filesToLocalSamples(files: readonly File[], existing: readonly Pick<SampleItem, 'id'>[] = []): SampleItem[] {
  let nextId = nextLocalSampleId(existing)
  const samples: SampleItem[] = []
  for (const file of files) {
    if (!isAudioFile(file)) continue
    samples.push({ id: nextId, name: file.name, url: URL.createObjectURL(file) })
    nextId -= 1
  }
  return samples
}

export function revokeLocalSampleUrls(samples: readonly Pick<SampleItem, 'url'>[]): void {
  for (const sample of samples) {
    if (sample.url.startsWith('blob:')) URL.revokeObjectURL(sample.url)
  }
}

async function collectAudioFilesFromDirectory(
  handle: FileSystemDirectoryHandle,
  prefix = '',
  files: File[] = [],
): Promise<File[]> {
  for await (const entry of handle.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.kind === 'file') {
      if (!isAudioFileName(entry.name)) continue
      const file = await entry.getFile()
      files.push(new File([file], path, { type: file.type, lastModified: file.lastModified }))
      continue
    }
    if (entry.kind === 'directory') {
      await collectAudioFilesFromDirectory(entry, path, files)
    }
  }
  return files
}

export async function pickLocalFolderSamples(existing: readonly Pick<SampleItem, 'id'>[] = []): Promise<PickLocalFolderResult> {
  if (typeof window.showDirectoryPicker !== 'function') return { status: 'unavailable' }
  const started = performance.now()
  try {
    const handle = await window.showDirectoryPicker({ mode: 'read' })
    const files = await collectAudioFilesFromDirectory(handle)
    return { status: 'picked', folderName: handle.name, samples: filesToLocalSamples(files, existing) }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { status: directoryPickerAbortReason(performance.now() - started) }
    }
    if (error instanceof DOMException && (error.name === 'SecurityError' || error.name === 'NotAllowedError')) {
      return { status: 'unavailable' }
    }
    throw error
  }
}
