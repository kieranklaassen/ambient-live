import react from '@vitejs/plugin-react'
import inertia from '@inertiajs/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import RubyPlugin from 'vite-plugin-ruby'

export default defineConfig({
  plugins: [
    tailwindcss(),
    RubyPlugin(),
    inertia(),
    react(),
  ],
  // live-mix is pure ESM with no dependencies; pre-bundling it would break the
  // `new URL(..., import.meta.url)` resolution of its worklet and .wasm in dev.
  optimizeDeps: { exclude: ['@kieranklaassen/live-mix'] },
  // `npm link ../live-mix` puts the package outside the Vite root.
  server: { fs: { allow: ['..'] } },
})
