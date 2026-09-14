// The live-mix React kit is themed through `--lm-*` custom properties. The app
// declares every one on `.workstation-shell`, reading colours from its own
// `al-*` palette, so the kit's controls match the page. The kit's
// `ambientWater` preset is that same mapping as a JS object; both must agree.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { LM_TOKENS, ambientWater, type LiveMixToken } from '@kieranklaassen/live-mix/react'

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../entrypoints/application.css'),
  'utf8',
)

function block(selector: string): string {
  const match = new RegExp(`${selector.replace(/[.@]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)
  if (!match) throw new Error(`no ${selector} block in application.css`)
  return match[1]
}

function declarations(body: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const [, name, value] of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    found.set(name, value.trim())
  }
  return found
}

const palette = declarations(block('@theme'))
const tokens = declarations(block('.workstation-shell'))

describe('application.css live-mix theme', () => {
  it('imports the kit stylesheet', () => {
    expect(css).toMatch(/@import '@kieranklaassen\/live-mix\/react\/styles\.css';/)
  })

  it('declares every kit token on the workstation shell', () => {
    const missing = LM_TOKENS.filter((token) => !tokens.has(`--lm-${token}`))
    expect(missing).toEqual([])
    const extra = [...tokens.keys()].filter(
      (name) => !(LM_TOKENS as readonly string[]).includes(name.replace(/^--lm-/, '')),
    )
    expect(extra).toEqual([])
  })

  it('reads every colour from an al-* palette entry that matches the ambientWater preset', () => {
    const colourTokens = LM_TOKENS.filter((token) => /^#/.test(ambientWater[token]))
    expect(colourTokens.length).toBe(25)
    for (const token of colourTokens) {
      const value = tokens.get(`--lm-${token}`)!
      const source = /^var\((--color-al-[a-z-]+)\)$/.exec(value)?.[1]
      expect(source, `--lm-${token} should read an al-* colour, got ${value}`).toBeDefined()
      expect(palette.get(source!), `${source} referenced by --lm-${token}`).toBeDefined()
      expect(palette.get(source!)!.toLowerCase(), `--lm-${token} vs ambientWater`).toBe(
        ambientWater[token as LiveMixToken].toLowerCase(),
      )
    }
  })

  it('takes type and spacing from the app theme', () => {
    expect(tokens.get('--lm-font')).toBe('var(--font-ui)')
    expect(palette.has('--font-ui')).toBe(true)
    for (const [token, spacing] of [
      ['--lm-space-1', '--spacing-sg-1'],
      ['--lm-space-2', '--spacing-sg-2'],
      ['--lm-space-3', '--spacing-sg-3'],
    ] as const) {
      expect(tokens.get(token)).toBe(`var(${spacing})`)
      expect(palette.has(spacing)).toBe(true)
    }
  })
})
