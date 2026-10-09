import { describe, expect, it } from 'vitest'
import { toDxfR12, validateDxf, type DxfEntity, type DxfStats } from './dxf.ts'
import { toSvg } from './svg.ts'
import { defaultSpec } from './involute.ts'
import { gearEntities, rackEntity } from './gearEntities.ts'

const square: DxfEntity = { type: 'polyline', points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true, layer: 'GEAR' }

describe('DXF R12', () => {
  it('writes the expected header and structure', () => {
    const t = toDxfR12([square, { type: 'circle', cx: 5, cy: 5, r: 2, layer: 'BORE' }, { type: 'line', a: [0, 0], b: [1, 1], layer: 'GEAR' }])
    expect(t.startsWith('  0\r\nSECTION\r\n  2\r\nHEADER')).toBe(true)
    expect(t).toContain('AC1009')
    expect(t.trimEnd().endsWith('EOF')).toBe(true)
    const stats = {} as DxfStats
    expect(validateDxf(t, stats)).toEqual([])
    expect(stats).toEqual({ polylines: 1, vertices: 4, circles: 1, lines: 1 })
  })
  it('defines each used layer', () => {
    const t = toDxfR12([square, { type: 'circle', cx: 0, cy: 0, r: 1, layer: 'BORE' }])
    expect(t).toMatch(/LAYER\r\n {2}2\r\nGEAR/)
    expect(t).toMatch(/LAYER\r\n {2}2\r\nBORE/)
  })
  it('a full gear exports as a valid DXF with the right vertex count', () => {
    const g = defaultSpec({ z: 24 })
    const ents = gearEntities({ spec: g, bore: { diameter: 10, keyWidth: 3, keyDepth: 1.4 }, cx: 0, cy: 0, rotation: 0, layer: 'GEAR1' }, { reference: true })
    const stats = {} as DxfStats
    const errors = validateDxf(toDxfR12(ents), stats)
    expect(errors).toEqual([])
    expect(stats.polylines).toBe(2)
    expect(stats.circles).toBe(1)
    expect(stats.vertices).toBeGreaterThan(24 * 20)
  })
  it('exports a rack', () => {
    const e = rackEntity(2, 0.349, 1, 0.25, 0, 0, -20, 60, 'RACK')
    expect(validateDxf(toDxfR12([e]))).toEqual([])
  })
  it('detects broken files', () => {
    const t = toDxfR12([square])
    expect(validateDxf(t.replace('SEQEND', 'FOO')).length).toBeGreaterThan(0)
    expect(validateDxf(t.replace('EOF', 'EOX')).length).toBeGreaterThan(0)
    expect(validateDxf('0\r\nSECTION\r\n').length).toBeGreaterThan(0)
  })
  it('never emits NaN', () => {
    const t = toDxfR12([{ type: 'polyline', points: [[0, 0], [NaN, 1]], closed: false, layer: 'X' }])
    expect(validateDxf(t).length).toBeGreaterThan(0)
  })
})

describe('SVG export', () => {
  it('produces a well-formed svg with a closed path', () => {
    const s = toSvg([square, { type: 'circle', cx: 5, cy: 5, r: 2, layer: 'BORE' }])
    expect(s).toContain('<svg')
    expect(s).toContain('viewBox=')
    expect(s).toMatch(/<path d="M[^"]*Z"/)
    expect(s).toContain('<circle')
    expect(s.trim().endsWith('</svg>')).toBe(true)
  })
})
