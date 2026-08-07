import { router, useForm } from '@inertiajs/react'
import { useRef, type FormEvent } from 'react'

export interface SampleItem {
  id: number
  name: string
  url: string
}

interface SampleLibraryProps {
  samples: SampleItem[]
  enabled: boolean
  playingSampleId: number | null
  onPlay: (sample: SampleItem) => void
  onStop: () => void
}

export default function SampleLibrary({ samples, enabled, playingSampleId, onPlay, onStop }: SampleLibraryProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const { data, setData, post, processing, errors, reset } = useForm<{
    name: string
    audio_file: File | null
  }>({ name: '', audio_file: null })

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

  return (
    <div className="space-y-4">
      <form onSubmit={upload} className="space-y-3" data-testid="sample-upload-form">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Name (optional)"
            value={data.name}
            onChange={(e) => setData('name', e.target.value)}
            className="w-40 rounded-md border-zinc-700 bg-zinc-800 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-teal-500 focus:ring-teal-500"
          />
          <input
            ref={fileInput}
            type="file"
            accept="audio/*"
            required
            onChange={(e) => setData('audio_file', e.target.files?.[0] ?? null)}
            className="flex-1 text-sm text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-700 file:px-3 file:py-1.5 file:text-zinc-200 hover:file:bg-zinc-600"
          />
          <button
            type="submit"
            disabled={processing || !data.audio_file}
            className="rounded-md bg-zinc-700 px-4 py-1.5 text-sm text-zinc-100 transition hover:bg-zinc-600 disabled:opacity-40"
          >
            Upload
          </button>
        </div>
        {errors.audio_file && <p className="text-sm text-red-400">{errors.audio_file}</p>}
      </form>

      {samples.length === 0 ? (
        <p className="text-sm text-zinc-600">No samples yet — upload one to play it through the reverb.</p>
      ) : (
        <ul className="divide-y divide-zinc-800" data-testid="sample-list">
          {samples.map((sample) => {
            const playing = playingSampleId === sample.id
            return (
              <li key={sample.id} className="flex items-center justify-between gap-3 py-2">
                <span className="truncate text-sm text-zinc-300">{sample.name}</span>
                <span className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={!enabled}
                    onClick={() => (playing ? onStop() : onPlay(sample))}
                    className={`rounded-md px-3 py-1 text-sm transition disabled:opacity-40 ${
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
                    className="rounded-md bg-zinc-900 px-3 py-1 text-sm text-zinc-500 transition hover:bg-red-950 hover:text-red-300"
                  >
                    Delete
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
