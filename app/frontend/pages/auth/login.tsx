import { Head, useForm } from '@inertiajs/react'
import type { FormEvent } from 'react'

export default function Login() {
  const { data, setData, post, processing, errors } = useForm({
    email_address: '',
    password: '',
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    post('/session')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <Head title="Sign in - Ambient Live" />
      <form onSubmit={submit} className="w-full max-w-sm space-y-6 rounded-xl border border-zinc-800 bg-zinc-900 p-8">
        <div>
          <h1 className="text-xl font-medium tracking-wide">Ambient Live</h1>
          <p className="mt-1 text-sm text-zinc-400">Sign in to play.</p>
        </div>

        {errors.email_address && (
          <p className="rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
            {errors.email_address}
          </p>
        )}

        <label className="block">
          <span className="mb-1 block text-sm text-zinc-400">Email</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={data.email_address}
            onChange={(e) => setData('email_address', e.target.value)}
            className="w-full rounded-md border-zinc-700 bg-zinc-800 text-zinc-100 focus:border-teal-500 focus:ring-teal-500"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-zinc-400">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={data.password}
            onChange={(e) => setData('password', e.target.value)}
            className="w-full rounded-md border-zinc-700 bg-zinc-800 text-zinc-100 focus:border-teal-500 focus:ring-teal-500"
          />
        </label>

        <button
          type="submit"
          disabled={processing}
          className="w-full rounded-md bg-teal-600 px-4 py-2 font-medium text-white transition hover:bg-teal-500 disabled:opacity-50"
        >
          Sign in
        </button>
      </form>
    </div>
  )
}
