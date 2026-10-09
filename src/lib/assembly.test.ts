import { describe, expect, it } from 'vitest'
import { assemble } from './assembly.ts'
import { DEG, defaultSpec, radii, type GearSpec } from './involute.ts'
import { gearOutline, rackOutline, transformPts, type Pt } from './profile.ts'

const NOB = { diameter: 0, keyWidth: 0, keyDepth: 0 }

function inside(p: Pt, poly: Pt[]): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

function distToPoly(p: Pt, poly: Pt[]): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy))
  }
  return best
}

/** Deepest penetration of poly B's vertices into solid A (A is a solid polygon). */
const penetration = (a: Pt[], b: Pt[]) => Math.max(0, ...b.filter((p) => inside(p, a)).map((p) => distToPoly(p, a)))

const spec = (z: number, over: Partial<GearSpec> = {}) => defaultSpec({ m: 2, z, ...over })
const thetas = [0, 0.13, 0.4, 0.77, 1.3, 2.0, 3.1]

describe('meshing geometry (no interpenetration at any phase)', () => {
  it('standard external pair', () => {
    const g1 = spec(16)
    const g2 = spec(24)
    for (const th of thetas) {
      const a = assemble('external', g1, g2, NOB, NOB, th)
      const p1 = transformPts(gearOutline(g1), a.gear1.rotation, a.gear1.cx, a.gear1.cy)
      const p2 = transformPts(gearOutline(g2), a.gear2!.rotation, a.gear2!.cx, a.gear2!.cy)
      expect(penetration(p1, p2)).toBeLessThan(0.03)
      expect(penetration(p2, p1)).toBeLessThan(0.03)
    }
  })
  it('profile-shifted pair with backlash', () => {
    const g1 = spec(14, { x: 0.4, backlash: 0.1 })
    const g2 = spec(30, { x: 0.1, backlash: 0.1 })
    for (const th of thetas) {
      const a = assemble('external', g1, g2, NOB, NOB, th)
      expect(a.pair.a).toBeGreaterThan(44)
      const p1 = transformPts(gearOutline(g1), a.gear1.rotation, 0, 0)
      const p2 = transformPts(gearOutline(g2), a.gear2!.rotation, a.gear2!.cx, 0)
      expect(penetration(p1, p2)).toBeLessThan(0.03)
      expect(penetration(p2, p1)).toBeLessThan(0.03)
    }
  })
  it('the teeth really touch at zero backlash (gap smaller than 0.05 mm somewhere)', () => {
    const g1 = spec(20)
    const g2 = spec(20)
    const a = assemble('external', g1, g2, NOB, NOB, 0.3)
    const p1 = transformPts(gearOutline(g1), a.gear1.rotation, 0, 0)
    const p2 = transformPts(gearOutline(g2), a.gear2!.rotation, a.gear2!.cx, 0)
    expect(Math.min(...p2.map((p) => distToPoly(p, p1)))).toBeLessThan(0.05)
  })
  it('internal pair (pinion inside a ring)', () => {
    const g1 = spec(16, { backlash: 0.05 })
    const g2 = spec(40, { kind: 'internal', backlash: 0.05 })
    for (const th of thetas) {
      const a = assemble('internal', g1, g2, NOB, NOB, th)
      expect(a.pair.a).toBeCloseTo(24, 6)
      const p1 = transformPts(gearOutline(g1), a.gear1.rotation, 0, 0)
      const ring = transformPts(gearOutline(g2), a.gear2!.rotation, a.gear2!.cx, 0)
      // the ring's material is OUTSIDE its inner outline: pinion vertices must be inside the hole
      const bad = p1.filter((p) => !inside(p, ring))
      expect(bad.length).toBe(0)
      // and ring vertices must not be inside the pinion
      expect(penetration(p1, ring)).toBeLessThan(0.03)
      // pinion vertices stay inside the hole (penetration into ring material = distance to boundary when outside)
    }
  })
  it('rack and pinion', () => {
    const g1 = spec(18, { x: 0.2, backlash: 0.05 })
    for (const th of thetas) {
      const a = assemble('rack', g1, g1, NOB, NOB, th)
      const p1 = transformPts(gearOutline(g1), a.gear1.rotation, 0, 0)
      const teeth = rackOutline({ m: 2, alpha: 20 * DEG, ha: 1, c: 0.25, backlash: 0.05 }, -60, 60, a.rack!.offset)
      const rack: Pt[] = [[teeth[0][0], -30], ...teeth, [teeth[teeth.length - 1][0], -30]].map((p) => [p[0], p[1] + (p[1] === -30 ? 0 : a.rack!.y0)] as Pt)
      expect(penetration(p1, rack)).toBeLessThan(0.03)
      expect(penetration(rack, p1)).toBeLessThan(0.03)
    }
  })
  it('radii sanity for the assembled shifted pair (tip clears the mate root)', () => {
    const g1 = spec(14, { x: 0.4 })
    const g2 = spec(30, { x: 0.1 })
    const a = assemble('external', g1, g2, NOB, NOB, 0)
    expect(a.pair.a - radii(g1).addendum).toBeGreaterThan(radii(g2).root)
  })
})
