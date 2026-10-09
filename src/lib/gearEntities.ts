import type { DxfEntity } from './dxf.ts'
import { borePolyline, type BoreSpec, type GearSpec } from './involute.ts'
import { gearOutline, rackOutline, transformPts, type Pt } from './profile.ts'

export interface PlacedGear {
  spec: GearSpec
  bore: BoreSpec
  cx: number
  cy: number
  rotation: number
  layer: string
}

/** Outline (+ bore, keyway, pitch circle reference) of one gear as drawing entities. */
export function gearEntities(p: PlacedGear, opts: { reference?: boolean } = {}): DxfEntity[] {
  const out: DxfEntity[] = []
  const outline = transformPts(gearOutline(p.spec), p.rotation, p.cx, p.cy)
  out.push({ type: 'polyline', points: outline, closed: true, layer: p.layer })
  const bore = borePolyline(p.bore)
  if (bore.length) {
    const plain = p.bore.keyWidth <= 0 || p.bore.keyDepth <= 0
    if (plain) out.push({ type: 'circle', cx: p.cx, cy: p.cy, r: p.bore.diameter / 2, layer: p.layer })
    else out.push({ type: 'polyline', points: transformPts(bore, p.rotation, p.cx, p.cy), closed: true, layer: p.layer })
  }
  if (opts.reference) {
    out.push({ type: 'circle', cx: p.cx, cy: p.cy, r: (p.spec.m * p.spec.z) / 2, layer: p.layer + '_PITCH' })
  }
  return out
}

export function rackEntity(m: number, alpha: number, ha: number, c: number, backlash: number, offset: number, y0: number, width: number, layer: string): DxfEntity {
  const teeth: Pt[] = rackOutline({ m, alpha, ha, c, backlash }, -width / 2, width / 2, offset)
  const xs = teeth.filter((p) => p[0] >= -width / 2 && p[0] <= width / 2)
  const first = xs[0]?.[0] ?? -width / 2
  const last = xs[xs.length - 1]?.[0] ?? width / 2
  const bottom = y0 - (ha + c) * m - 1.5 * m
  const pts: Pt[] = [[first, bottom], ...xs.map((p): Pt => [p[0], p[1] + y0]), [last, bottom]]
  return { type: 'polyline', points: pts, closed: true, layer }
}
