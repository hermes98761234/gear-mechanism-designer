import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tr, UK } from './i18n.ts'

const placeholders = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort()

describe('i18n', () => {
  it('returns English untouched and interpolates', () => {
    expect(tr('en', 'Total {0}° (need 360°), net lift {1} mm', 360, 0)).toBe('Total 360° (need 360°), net lift 0 mm')
  })
  it('translates to Ukrainian with the same placeholders', () => {
    expect(tr('uk', 'Cams')).toBe('Кулачки')
    for (const [k, v] of Object.entries(UK)) {
      expect(v.trim().length, k).toBeGreaterThan(0)
      expect(placeholders(v), k).toEqual(placeholders(k))
    }
  })
  it('falls back to the English string when untranslated', () => {
    expect(tr('uk', 'No such string {0}', 5)).toBe('No such string 5')
  })
  it('every literal passed to t() in the UI has a Ukrainian translation', () => {
    const dir = join(import.meta.dirname, 'components')
    const files = readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => join(dir, f))
    files.push(join(import.meta.dirname, 'App.tsx'))
    const missing: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) {
        const key = m[1].replace(/\\'/g, "'")
        if (!(key in UK)) missing.push(key)
      }
    }
    expect(missing).toEqual([])
  })
})
