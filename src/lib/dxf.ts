// Minimal ASCII DXF writer (AutoCAD R12 / AC1009) and a structural validator.
import type { Pt } from './profile.ts'

export type DxfEntity =
  | { type: 'polyline'; points: Pt[]; closed: boolean; layer: string }
  | { type: 'circle'; cx: number; cy: number; r: number; layer: string }
  | { type: 'line'; a: Pt; b: Pt; layer: string }

const fmt = (n: number) => {
  const s = (Math.abs(n) < 1e-9 ? 0 : n).toFixed(5)
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '.0')
}

const LAYER_COLORS = [7, 1, 3, 5, 2, 6, 4]

export function toDxfR12(entities: DxfEntity[]): string {
  const rows: (string | number)[] = []
  const g = (code: number, value: string | number) => {
    rows.push(String(code).padStart(3, ' '), typeof value === 'number' ? fmt(value) : value)
  }
  const layers = [...new Set(['0', ...entities.map((e) => e.layer)])]

  g(0, 'SECTION')
  g(2, 'HEADER')
  g(9, '$ACADVER')
  g(1, 'AC1009')
  g(9, '$INSUNITS')
  g(70, '4')
  g(0, 'ENDSEC')

  g(0, 'SECTION')
  g(2, 'TABLES')
  g(0, 'TABLE')
  g(2, 'LTYPE')
  g(70, '1')
  g(0, 'LTYPE')
  g(2, 'CONTINUOUS')
  g(70, '0')
  g(3, 'Solid line')
  g(72, '65')
  g(73, '0')
  g(40, '0.0')
  g(0, 'ENDTAB')
  g(0, 'TABLE')
  g(2, 'LAYER')
  g(70, String(layers.length))
  layers.forEach((name, i) => {
    g(0, 'LAYER')
    g(2, name)
    g(70, '0')
    g(62, String(LAYER_COLORS[i % LAYER_COLORS.length]))
    g(6, 'CONTINUOUS')
  })
  g(0, 'ENDTAB')
  g(0, 'ENDSEC')

  g(0, 'SECTION')
  g(2, 'BLOCKS')
  g(0, 'ENDSEC')

  g(0, 'SECTION')
  g(2, 'ENTITIES')
  for (const e of entities) {
    if (e.type === 'polyline') {
      g(0, 'POLYLINE')
      g(8, e.layer)
      g(66, '1')
      g(10, 0)
      g(20, 0)
      g(30, 0)
      g(70, e.closed ? '1' : '0')
      for (const [x, y] of e.points) {
        g(0, 'VERTEX')
        g(8, e.layer)
        g(10, x)
        g(20, y)
        g(30, 0)
      }
      g(0, 'SEQEND')
      g(8, e.layer)
    } else if (e.type === 'circle') {
      g(0, 'CIRCLE')
      g(8, e.layer)
      g(10, e.cx)
      g(20, e.cy)
      g(30, 0)
      g(40, e.r)
    } else {
      g(0, 'LINE')
      g(8, e.layer)
      g(10, e.a[0])
      g(20, e.a[1])
      g(30, 0)
      g(11, e.b[0])
      g(21, e.b[1])
      g(31, 0)
    }
  }
  g(0, 'ENDSEC')
  g(0, 'EOF')
  return rows.join('\r\n') + '\r\n'
}

export interface DxfStats {
  polylines: number
  vertices: number
  circles: number
  lines: number
}

/** Structural validation of a DXF text produced by toDxfR12. Returns a list of problems (empty = valid). */
export function validateDxf(text: string, stats?: DxfStats): string[] {
  const errors: string[] = []
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  if (lines.length % 2 !== 0) {
    errors.push('odd number of lines (group code/value pairs broken)')
    return errors
  }
  const pairs: [number, string][] = []
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim())
    if (!Number.isInteger(code) || lines[i].trim() === '') {
      errors.push(`bad group code at line ${i + 1}: "${lines[i]}"`)
      return errors
    }
    pairs.push([code, lines[i + 1]])
  }
  const last = pairs[pairs.length - 1]
  if (!last || last[0] !== 0 || last[1] !== 'EOF') errors.push('missing EOF')
  let inSection = false
  let inPoly = false
  let polyVerts = 0
  const s: DxfStats = { polylines: 0, vertices: 0, circles: 0, lines: 0 }
  let section = ''
  for (let i = 0; i < pairs.length; i++) {
    const [code, val] = pairs[i]
    if (code !== 0) continue
    if (val === 'SECTION') {
      if (inSection) errors.push('nested SECTION')
      inSection = true
      section = pairs[i + 1]?.[1] ?? ''
    } else if (val === 'ENDSEC') {
      if (!inSection) errors.push('ENDSEC without SECTION')
      if (inPoly) errors.push('POLYLINE not closed by SEQEND')
      inSection = false
    } else if (val === 'POLYLINE') {
      if (section !== 'ENTITIES') errors.push('POLYLINE outside ENTITIES')
      if (inPoly) errors.push('nested POLYLINE')
      inPoly = true
      polyVerts = 0
      s.polylines++
    } else if (val === 'VERTEX') {
      if (!inPoly) errors.push('VERTEX outside POLYLINE')
      polyVerts++
      s.vertices++
      let x = false
      let y = false
      for (let j = i + 1; j < pairs.length && pairs[j][0] !== 0; j++) {
        if (pairs[j][0] === 10 && Number.isFinite(Number(pairs[j][1]))) x = true
        if (pairs[j][0] === 20 && Number.isFinite(Number(pairs[j][1]))) y = true
      }
      if (!x || !y) errors.push('VERTEX without finite coordinates')
    } else if (val === 'SEQEND') {
      if (!inPoly) errors.push('SEQEND without POLYLINE')
      if (polyVerts < 2) errors.push('POLYLINE with fewer than 2 vertices')
      inPoly = false
    } else if (val === 'CIRCLE') {
      s.circles++
      const r = pairs.slice(i + 1).find((p) => p[0] === 40 || p[0] === 0)
      if (!r || r[0] !== 40 || !(Number(r[1]) > 0)) errors.push('CIRCLE without positive radius')
    } else if (val === 'LINE') {
      s.lines++
    }
  }
  if (inSection) errors.push('unterminated SECTION')
  for (const v of pairs) {
    if (/NaN|Infinity/.test(v[1])) {
      errors.push('non-finite number in output')
      break
    }
  }
  if (stats) Object.assign(stats, s)
  return errors
}
