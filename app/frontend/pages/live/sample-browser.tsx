import { router, useForm } from '@inertiajs/react'
import { useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { filesToLocalSamples, localFolderMode, pickLocalFolderSamples, revokeLocalSampleUrls } from './local-folder'
import { setSampleDragData } from './sample-drag'
import type { SampleItem } from './sample-library'

type BrowserTab = 'library' | 'local'
interface SampleBrowserProps {
  samples: SampleItem[]
  localSamples: SampleItem[]
  localFolderName: string | null
  enabled: boolean
  playingSampleId: number | null
  onPlay: (sample: SampleItem) => void
  onStop: () => void
  onLocalSamplesChange: (samples: SampleItem[], folderName: string | null) => void
  className?: string
}

export default function SampleBrowser({ samples, localSamples, localFolderName, enabled, playingSampleId, onPlay, onStop, onLocalSamplesChange, className = '' }: SampleBrowserProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const localFileInput = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<BrowserTab>('library')
  const [filter, setFilter] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [loadingLocal, setLoadingLocal] = useState(false)
  const folderMode = localFolderMode()
  const { data, setData, post, processing, errors, reset } = useForm<{ name: string; audio_file: File | null }>({ name: '', audio_file: null })
  const activeList = tab === 'library' ? samples : localSamples
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? activeList.filter((s) => s.name.toLowerCase().includes(q)) : activeList
  }, [activeList, filter])

  function upload(e: FormEvent) {
    e.preventDefault()
    post('/samples', { forceFormData: true, onSuccess: () => { reset(); if (fileInput.current) fileInput.current.value = '' } })
  }
  function onDragStart(event: DragEvent<HTMLLIElement>, sample: SampleItem) {
    setSampleDragData(event.dataTransfer, { sampleId: sample.id, name: sample.name, url: sample.url })
  }
  async function openLocalFolder() {
    setLocalError(null)
    if (folderMode === 'file-input') { localFileInput.current?.click(); return }
    setLoadingLocal(true)
    try {
      const result = await pickLocalFolderSamples(localSamples)
      if (!result) return
      revokeLocalSampleUrls(localSamples)
      onLocalSamplesChange(result.samples, result.folderName)
      setTab('local')
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    } finally { setLoadingLocal(false) }
  }
  function onLocalFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const next = filesToLocalSamples(Array.from(fileList), localSamples)
    if (next.length === 0) { setLocalError('No audio files found in that selection.'); return }
    revokeLocalSampleUrls(localSamples)
    const first = fileList[0]
    const folderHint = first && 'webkitRelativePath' in first && typeof first.webkitRelativePath === 'string' && first.webkitRelativePath ? first.webkitRelativePath.split('/')[0] ?? 'Local files' : 'Local files'
    onLocalSamplesChange(next, folderHint)
    setTab('local')
  }
  function clearLocal() {
    revokeLocalSampleUrls(localSamples)
    onLocalSamplesChange([], null)
    setLocalError(null)
    if (localFileInput.current) localFileInput.current.value = ''
  }

  return (
    <aside className={`workstation-region flex flex-col border-r border-al-border bg-al-panel ${className}`} data-testid="sample-browser" aria-label="Sample browser">
      <div className="border-b border-al-border sg-p-1">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.14em] text-al-muted sg-leading-2">Places</h2>
        <div className="mt-sg-1 grid grid-cols-2 gap-px bg-al-border" role="tablist" aria-label="Browser source">
          <button type="button" role="tab" aria-selected={tab === 'library'} onClick={() => setTab('library')} className={`px-2 py-1 text-[11px] uppercase tracking-wide ${tab === 'library' ? 'bg-al-raised text-al-text' : 'bg-al-sunken text-al-muted'}`} data-testid="browser-tab-library">Library</button>
          <button type="button" role="tab" aria-selected={tab === 'local'} onClick={() => setTab('local')} className={`px-2 py-1 text-[11px] uppercase tracking-wide ${tab === 'local' ? 'bg-al-raised text-al-text' : 'bg-al-sunken text-al-muted'}`} data-testid="browser-tab-local">Local</button>
        </div>
      </div>
      {tab === 'library' ? (
        <form onSubmit={upload} className="space-y-sg-1 border-b border-al-border sg-p-1" data-testid="sample-upload-form">
          <p className="text-[10px] uppercase tracking-wide text-al-dim">Server library</p>
          <input type="text" placeholder="Name (optional)" value={data.name} onChange={(e) => setData('name', e.target.value)} className="w-full rounded-[1px] border border-al-hairline bg-al-sunken px-1.5 py-1 text-xs text-al-text focus:border-al-accent focus:ring-0" />
          <input ref={fileInput} type="file" accept="audio/*" required onChange={(e) => setData('audio_file', e.target.files?.[0] ?? null)} className="w-full text-[11px] text-al-muted file:mr-2 file:rounded-[1px] file:border-0 file:bg-al-raised file:px-2 file:py-1 file:text-al-text" />
          <button type="submit" disabled={processing || !data.audio_file} className="w-full rounded-[1px] border border-al-hairline bg-al-raised px-2 py-1 text-[11px] uppercase tracking-wide text-al-text disabled:opacity-40">Upload</button>
          {errors.audio_file && <p className="text-xs text-al-danger">{errors.audio_file}</p>}
        </form>
      ) : (
        <div className="space-y-sg-1 border-b border-al-border sg-p-1" data-testid="local-folder-controls">
          <p className="text-[10px] uppercase tracking-wide text-al-dim">Session browse — not uploaded</p>
          <button type="button" onClick={() => void openLocalFolder()} disabled={loadingLocal} className="w-full rounded-[1px] border border-al-hairline bg-al-raised px-2 py-1 text-[11px] uppercase tracking-wide text-al-text disabled:opacity-40" data-testid="open-local-folder">
            {loadingLocal ? 'Loading…' : folderMode === 'directory-picker' ? 'Open folder' : 'Choose audio files'}
          </button>
          <input ref={localFileInput} type="file" accept="audio/*" multiple className="hidden" data-testid="local-file-input" {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(e) => { onLocalFilesSelected(e.target.files); e.target.value = '' }} />
          {folderMode === 'file-input' && <p className="text-[10px] text-al-dim">Directory picker unavailable — use multi-file / folder selection.</p>}
          {localFolderName && (
            <div className="flex items-center justify-between gap-2 text-[11px] text-al-muted">
              <span className="truncate">{localFolderName}</span>
              <button type="button" onClick={clearLocal} className="uppercase tracking-wide text-al-dim hover:text-al-accent" data-testid="clear-local-folder">Clear</button>
            </div>
          )}
          {localError && <p className="text-xs text-al-danger">{localError}</p>}
        </div>
      )}
      <div className="border-b border-al-border px-sg-2 py-sg-1">
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" className="w-full rounded-[1px] border border-al-hairline bg-al-sunken px-1.5 py-1 text-xs text-al-text focus:border-al-accent focus:ring-0" aria-label="Filter samples" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-al-sunken">
        {visible.length === 0 ? (
          <p className="px-sg-2 py-sg-2 text-xs text-al-dim">{activeList.length === 0 ? (tab === 'library' ? 'No samples yet — upload or switch to Local.' : 'Open a folder to browse local audio.') : 'No samples match this filter.'}</p>
        ) : (
          <ul className="divide-y divide-al-border" data-testid="sample-list">
            {visible.map((sample) => {
              const playing = playingSampleId === sample.id
              return (
                <li key={`${tab}-${sample.id}`} draggable onDragStart={(event) => onDragStart(event, sample)} className={`flex cursor-grab items-center gap-1 px-sg-1 py-sg-1 ${playing ? 'bg-al-accent-soft' : 'hover:bg-al-raised'}`}>
                  <span className="min-w-0 flex-1 truncate text-xs text-al-text">{sample.name}</span>
                  <button type="button" disabled={!enabled} onClick={() => (playing ? onStop() : onPlay(sample))} className={`rounded-[1px] border px-1.5 py-0.5 text-[10px] uppercase tracking-wide disabled:opacity-40 ${playing ? 'border-al-accent bg-al-accent text-al-chrome' : 'border-al-hairline bg-al-panel text-al-muted'}`}>{playing ? 'Stop' : 'Play'}</button>
                  {tab === 'library' && <button type="button" onClick={() => router.delete(`/samples/${sample.id}`)} className="rounded-[1px] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-al-dim hover:text-al-danger">Del</button>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
