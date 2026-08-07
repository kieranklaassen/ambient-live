import type { SampleItem } from './sample-library'

const AUDIO_EXTENSIONS = new Set(['.wav','.wave','.mp3','.aif','.aiff','.flac','.ogg','.m4a','.aac'])

export type LocalFolderMode = 'directory-picker' | 'file-input'

export function localFolderMode(): LocalFolderMode {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window ? 'directory-picker' : 'file-input'
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

async function collectAudioFilesFromDirectory(handle: FileSystemDirectoryHandle, prefix = ''): Promise<File[]> {
  const files: File[] = []
  for await (const entry of handle.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.kind === 'file') {
      if (!isAudioFileName(entry.name)) continue
      const file = await entry.getFile()
      files.push(new File([file], path, { type: file.type, lastModified: file.lastModified }))
      continue
    }
    if (entry.kind === 'directory') {
      files.push(...(await collectAudioFilesFromDirectory(entry, path)))
    }
  }
  return files
}

export async function pickLocalFolderSamples(existing: readonly Pick<SampleItem, 'id'>[] = []): Promise<{ samples: SampleItem[]; folderName: string } | null> {
  if (!('showDirectoryPicker' in window) || typeof window.showDirectoryPicker !== 'function') return null
  try {
    const handle = await window.showDirectoryPicker({ mode: 'read' })
    const files = await collectAudioFilesFromDirectory(handle)
    return { folderName: handle.name, samples: filesToLocalSamples(files, existing) }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
}
