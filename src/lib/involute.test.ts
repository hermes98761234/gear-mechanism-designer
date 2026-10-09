import { describe, expect, it } from 'vitest'
import {
  DEG, borePolyline, boreFits, defaultSpec, externalPair, gearWarnings, halfToothAngle, internalPair, inv, invInverse, minShiftNoUndercut,
  minTeethNoUndercut, moduleFromDP, dpFromModule, pairWarnings, rackPair, radii, toothThicknessAt, toothThicknessPitch,
} from './involute.ts'
import { gearOutline } from './profile.ts'

const spur = (z: number, over = {}) => defaultSpec({ m: 2, z, ...over })

describe('involute function', () => {
  it('matches the tabulated value for 20 degrees', () => {
    expect(inv(20 * DEG)).toBeCloseTo(0.014904, 6)
  })
  it('inverts', () => {
    for (const a of [5, 14.5, 20, 25, 35, 50]) expect(invInverse(inv(a * DEG))).toBeCloseTo(a * DEG, 9)
  })
})

describe('spur gear radii', () => {
  const g = spur(20)
  const r = radii(g)
  it('pitch, base, addendum, root', () => {
    expect(r.pitch).toBeCloseTo(20, 10) // m z / 2
    expect(r.base).toBeCloseTo(20 * Math.cos(20 * DEG), 10) // 18.7939
    expect(r.base).toBeCloseTo(18.7939, 4)
    expect(r.addendum).toBeCloseTo(22, 10)
    expect(r.root).toBeCloseTo(20 - 2.5, 10)
  })
  it('profile shift moves tip and root together', () => {
    const s = radii(spur(20, { x: 0.5 }))
    expect(s.addendum).toBeCloseTo(23, 10)
    expect(s.root).toBeCloseTo(18.5, 10)
    expect(s.base).toBeCloseTo(r.base, 10)
  })
  it('diametral pitch conversion', () => {
    expect(moduleFromDP(12.7)).toBeCloseTo(2, 10)
    expect(dpFromModule(25.4)).toBeCloseTo(1, 10)
  })
})

describe('tooth thickness', () => {
  it('is half the circular pitch on the pitch circle for x = 0, no backlash', () => {
    expect(toothThicknessPitch(spur(20))).toBeCloseTo(Math.PI, 10)
    expect(toothThicknessAt(spur(20), 20)).toBeCloseTo(Math.PI, 9)
  })
  it('grows with positive profile shift: m(pi/2 + 2 x tan a)', () => {
    const g = spur(20, { x: 0.4 })
    expect(toothThicknessPitch(g)).toBeCloseTo(2 * (Math.PI / 2 + 0.8 * Math.tan(20 * DEG)), 10)
  })
  it('backlash thins the tooth', () => {
    expect(toothThicknessPitch(spur(20, { backlash: 0.1 }))).toBeCloseTo(Math.PI - 0.05, 10)
  })
  it('matches the textbook tip thickness for z=20, m=1 (about 0.6 mm)', () => {
    // s_a = 2 ra (s/(2r) + inv a - inv aa)
    const g = defaultSpec({ m: 1, z: 20 })
    const ra = radii(g).addendum
    const aa = Math.acos(radii(g).base / ra)
    const expected = 2 * ra * (Math.PI / 2 / 20 + inv(20 * DEG) - inv(aa))
    expect(toothThicknessAt(g, ra)).toBeCloseTo(expected, 10)
    expect(expected).toBeGreaterThan(0.5)
    expect(expected).toBeLessThan(0.75)
  })
  it('is zero at the base-radius half angle limit for an ideal pointed tooth', () => {
    const g = spur(10, { x: 1.5 })
    expect(halfToothAngle(g, radii(g).addendum)).toBeLessThan(0.05)
  })
})

describe('undercut', () => {
  it('minimum teeth is 17.1 at 20 degrees', () => {
    expect(minTeethNoUndercut(20 * DEG)).toBeCloseTo(17.097, 3)
  })
  it('warns below the limit and not above', () => {
    expect(gearWarnings(spur(12)).some((w) => w.id === 'undercut')).toBe(true)
    expect(gearWarnings(spur(18)).some((w) => w.id === 'undercut')).toBe(false)
  })
  it('profile shift cures it', () => {
    const x = minShiftNoUndercut(12, 20 * DEG)
    expect(x).toBeCloseTo((17.097 - 12) / 17.097, 3)
    expect(gearWarnings(spur(12, { x: x + 0.01 })).some((w) => w.id === 'undercut')).toBe(false)
  })
  it('warns about a pointed tooth', () => {
    expect(gearWarnings(spur(12, { x: 1.2 })).some((w) => w.id === 'pointed')).toBe(true)
  })
})

describe('gear pairs', () => {
  it('standard 20/20 pair: centre distance and contact ratio', () => {
    const p = externalPair(spur(20), spur(20))
    expect(p.a).toBeCloseTo(40, 9)
    expect(p.alphaW).toBeCloseTo(20 * DEG, 9)
    expect(p.eps).toBeCloseTo(1.5568, 3)
    expect(p.ratio).toBe(1)
  })
  it('profit-shifted pair increases centre distance and working pressure angle', () => {
    const p = externalPair(spur(20, { x: 0.5 }), spur(20, { x: 0.5 }))
    expect(p.alphaW).toBeGreaterThan(20 * DEG)
    expect(p.a).toBeGreaterThan(40)
    // inv aw = inv a + 2 (x1+x2) tan a / (z1+z2)
    expect(inv(p.alphaW)).toBeCloseTo(inv(20 * DEG) + (2 * 1 * Math.tan(20 * DEG)) / 40, 9)
  })
  it('zero sum of shifts keeps the standard centre distance', () => {
    const p = externalPair(spur(12, { x: 0.3 }), spur(30, { x: -0.3 }))
    expect(p.a).toBeCloseTo(42, 9)
  })
  it('internal pair: centre distance (z2-z1) m / 2', () => {
    const p = internalPair(spur(20), spur(40, { kind: 'internal' }))
    expect(p.a).toBeCloseTo(20, 9)
    expect(p.eps).toBeGreaterThan(1.7)
    expect(p.eps).toBeLessThan(2.2)
  })
  it('rack pair: contact ratio of a 20 tooth pinion is about 1.77', () => {
    const p = rackPair(defaultSpec({ m: 1, z: 20 }))
    expect(p.eps).toBeCloseTo(1.77, 2)
  })
  it('flags a non-meshing pair', () => {
    expect(pairWarnings({ eps: 0.8 } as never).some((w) => w.id === 'noMesh')).toBe(true)
    expect(pairWarnings({ eps: 1.1 } as never).some((w) => w.id === 'lowContact')).toBe(true)
    expect(pairWarnings({ eps: 1.6 } as never)).toEqual([])
  })
})

describe('outline', () => {
  it('has radii within root and tip circles and is symmetric', () => {
    const g = spur(20)
    const pts = gearOutline(g)
    const r = radii(g)
    const rs = pts.map((p) => Math.hypot(p[0], p[1]))
    expect(Math.min(...rs)).toBeGreaterThanOrEqual(r.root - 1e-6)
    expect(Math.max(...rs)).toBeLessThanOrEqual(r.addendum + 1e-6)
    expect(Math.max(...rs)).toBeCloseTo(r.addendum, 6)
    expect(Math.min(...rs)).toBeCloseTo(r.root, 6)
  })
  it('flank points lie on the involute (angle vs radius)', () => {
    const g = spur(24, { fillet: 0 })
    const rb = radii(g).base
    const pts = gearOutline(g)
    for (const p of pts) {
      const rho = Math.hypot(p[0], p[1])
      if (rho < rb + 0.01 || rho > radii(g).addendum - 0.01) continue
      const ang = Math.atan2(p[1], p[0])
      // reduce into [-pitch/2, pitch/2]
      const pitch = (2 * Math.PI) / g.z
      const a = ((((ang + pitch / 2) % pitch) + pitch) % pitch) - pitch / 2
      expect(Math.abs(a)).toBeCloseTo(halfToothAngle(g, rho), 5)
    }
  })
  it('fillet keeps the outline inside the root circle ring and the polygon area positive', () => {
    for (const z of [8, 12, 20, 60]) {
      const pts = gearOutline(spur(z, { x: z < 17 ? 0.4 : 0 }))
      let area = 0
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i]
        const [x2, y2] = pts[(i + 1) % pts.length]
        area += x1 * y2 - x2 * y1
      }
      expect(area).toBeGreaterThan(0)
      expect(pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))).toBe(true)
    }
  })
  it('internal gear outline stays between tip and root radii', () => {
    const g = spur(40, { kind: 'internal' })
    const r = radii(g)
    const rs = gearOutline(g).map((p) => Math.hypot(p[0], p[1]))
    expect(Math.min(...rs)).toBeCloseTo(r.addendum, 6)
    expect(Math.max(...rs)).toBeCloseTo(r.root, 6)
  })
})

describe('bore', () => {
  it('plain bore is a circle of the right radius', () => {
    const pts = borePolyline({ diameter: 10, keyWidth: 0, keyDepth: 0 })
    expect(pts.every((p) => Math.abs(Math.hypot(p[0], p[1]) - 5) < 1e-9)).toBe(true)
  })
  it('keyway reaches R + depth with the requested width', () => {
    const pts = borePolyline({ diameter: 10, keyWidth: 3, keyDepth: 1.4 })
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(6.4, 9)
    const slot = pts.filter((p) => p[0] > 5.5)
    expect(Math.max(...slot.map((p) => p[1])) - Math.min(...slot.map((p) => p[1]))).toBeCloseTo(3, 9)
  })
  it('bore must fit the root circle', () => {
    expect(boreFits(spur(20), { diameter: 10, keyWidth: 3, keyDepth: 1.4 })).toBe(true)
    expect(boreFits(spur(20), { diameter: 35, keyWidth: 0, keyDepth: 0 })).toBe(false)
  })
})
