import { router, useForm } from '@inertiajs/react'
import { useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'

import { setSampleDragData } from './sample-drag'
import type { SampleItem } from './sample-library'

interface SampleBrowserProps {
  samples: SampleItem[]
  enabled: boolean
  playingSampleId: number | null
  onPlay: (sample: SampleItem) => void
  onStop: () => void
}

export default function SampleBrowser({
  samples,
  enabled,
  playingSampleId,
  onPlay,
  onStop,
}: SampleBrowserProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState('')
  const { data, setData, post, processing, errors, reset } = useForm<{
    name: string
    audio_file: File | null
  }>({ name: '', audio_file: null })

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return samples
    return samples.filter((sample) => sample.name.toLowerCase().includes(q))
  }, [filter, samples])

  function upload(e: FormEvent) {
    e.preventDefault()
    post('/samples', {
      forceFormData: true,
      onSuccess: () => {
        reset()
        if (fileInput.current) fileInput.current.value = ''
      },
    })
  }

  function onDragStart(event: DragEvent<HTMLLIElement>, sample: SampleItem) {
    setSampleDragData(event.dataTransfer, {
      sampleId: sample.id,
      name: sample.name,
      url: sample.url,
    })
  }

  return (
    <aside
      className="flex h-full min-h-0 w-72 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/80"
      data-testid="sample-browser"
      aria-label="Sample browser"
    >
      <div className="border-b border-zinc-900 px-3 py-3">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">Browser</h2>
        <p className="mt-1 text-[11px] text-zinc-600">Active Storage library</p>
      </div>

      <form
        onSubmit={upload}
        className="space-y-2 border-b border-zinc-900 px-3 py-3"
        data-testid="sample-upload-form"
      >
        <input
          type="text"
          placeholder="Name (optional)"
          value={data.name}
          onChange={(e) => setData('name', e.target.value)}
          className="w-full rounded-md border-zinc-700 bg-zinc-900 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-teal-500 focus:ring-teal-500"
        />
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          required
          onChange={(e) => setData('audio_file', e.target.files?.[0] ?? null)}
          className="w-full text-xs text-zinc-400 file:mr-2 file:rounded-md file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-zinc-200 hover:file:bg-zinc-700"
        />
        <button
          type="submit"
          disabled={processing || !data.audio_file}
          className="w-full rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 transition hover:bg-zinc-700 disabled:opacity-40"
        >
          Upload
        </button>
        {errors.audio_file && <p className="text-sm text-red-400">{errors.audio_file}</p>}
      </form>

      <div className="border-b border-zinc-900 px-3 py-2">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="w-full rounded-md border-zinc-800 bg-zinc-900/80 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-teal-500 focus:ring-teal-500"
          aria-label="Filter samples"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {visible.length === 0 ? (
          <p className="px-1 text-sm text-zinc-600">
            {samples.length === 0
              ? 'No samples yet — upload one to audition or drop on the timeline.'
              : 'No samples match this filter.'}
          </p>
        ) : (
          <ul className="space-y-1" data-testid="sample-list">
            {visible.map((sample) => {
              const playing = playingSampleId === sample.id
              return (
                <li
                  key={sample.id}
                  draggable
                  onDragStart={(event) => onDragStart(event, sample)}
                  className="group flex cursor-grab items-center gap-2 rounded-md border border-transparent bg-zinc-900/50 px-2 py-2 active:cursor-grabbing hover:border-zinc-700"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-300" title={sample.name}>
                    {sample.name}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      disabled={!enabled}
                      onClick={() => (playing ? onStop() : onPlay(sample))}
                      className={`rounded px-2 py-0.5 text-xs transition disabled:opacity-40 ${
                        playing
                          ? 'bg-teal-700 text-white hover:bg-teal-600'
                          : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                      }`}
                    >
                      {playing ? 'Stop' : 'Play'}
                    </button>
                    <button
                      type="button"
                      onClick={() => router.delete(`/samples/${sample.id}`)}
                      className="rounded px-2 py-0.5 text-xs text-zinc-500 transition hover:bg-red-950 hover:text-red-300"
                    >
                      Del
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
