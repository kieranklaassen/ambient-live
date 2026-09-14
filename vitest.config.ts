import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const frontend = fileURLToPath(new URL('./app/frontend', import.meta.url))

export default defineConfig({
  // Same aliases as tsconfig.app.json, for the page modules component tests pull in.
  resolve: { alias: { '@': frontend, '~': frontend } },
  esbuild: { jsx: 'automatic' },
  test: {
    // Component tests (`*.test.tsx`) opt into jsdom per file with
    // `// @vitest-environment jsdom`; everything else runs in node.
    include: ['app/frontend/**/*.test.{ts,tsx}'],
  },
})
