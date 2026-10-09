import type { DxfEntity } from './dxf.ts'
import { polylineBounds, type Pt } from './profile.ts'

const n = (v: number) => (Math.round(v * 1000) / 1000).toString()

/** Standalone SVG (millimetres, y flipped so +y is up as in the CAD file) from the same entities as the DXF export. */
export function toSvg(entities: DxfEntity[]): string {
  const all: Pt[] = []
  for (const e of entities) {
    if (e.type === 'polyline') all.push(...e.points)
    else if (e.type === 'circle') all.push([e.cx - e.r, e.cy - e.r], [e.cx + e.r, e.cy + e.r])
    else all.push(e.a, e.b)
  }
  const b = all.length ? polylineBounds(all) : { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.03 + 1
  const w = b.maxX - b.minX + 2 * pad
  const h = b.maxY - b.minY + 2 * pad
  const fy = (y: number) => b.maxY - y + pad // flip
  const fx = (x: number) => x - b.minX + pad
  const body = entities
    .map((e) => {
      const common = `fill="none" stroke="#000" stroke-width="${n(Math.max(w, h) / 1000)}" data-layer="${e.layer}"`
      if (e.type === 'polyline') {
        const d = e.points.map((p, i) => `${i ? 'L' : 'M'}${n(fx(p[0]))} ${n(fy(p[1]))}`).join('') + (e.closed ? 'Z' : '')
        return `<path d="${d}" ${common}/>`
      }
      if (e.type === 'circle') return `<circle cx="${n(fx(e.cx))}" cy="${n(fy(e.cy))}" r="${n(e.r)}" ${common}/>`
      return `<line x1="${n(fx(e.a[0]))}" y1="${n(fy(e.a[1]))}" x2="${n(fx(e.b[0]))}" y2="${n(fy(e.b[1]))}" ${common}/>`
    })
    .join('\n  ')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}mm" height="${n(h)}mm" viewBox="0 0 ${n(w)} ${n(h)}">\n  ${body}\n</svg>\n`
}
