import { describe, expect, it } from 'vitest'
import {
  animatedAngle, circleIntersection, classifyFourBar, dist, fourBarRange, sampleFourBar, sampleSlider, sliderRange, sliderStroke,
  solveFourBar, solveSliderCrank, type FourBar, type SliderCrank,
} from './linkage.ts'

const base = (crank: number, coupler: number, rocker: number, ground: number, branch: 1 | -1 = 1): FourBar => ({
  A: [0, 0], D: [ground, 0], crank, coupler, rocker, px: coupler / 2, py: 1, branch,
})

describe('circle intersection', () => {
  it('3-4-5 triangle', () => {
    const p = circleIntersection([0, 0], 3, [5, 0], 4, 1)!
    expect(p[0]).toBeCloseTo(1.8, 9)
    expect(Math.abs(p[1])).toBeCloseTo(2.4, 9)
    const q = circleIntersection([0, 0], 3, [5, 0], 4, -1)!
    expect(q[1]).toBeCloseTo(-p[1], 9)
  })
  it('returns null when circles are apart or nested', () => {
    expect(circleIntersection([0, 0], 1, [5, 0], 1, 1)).toBeNull()
    expect(circleIntersection([0, 0], 5, [1, 0], 1, 1)).toBeNull()
  })
})

describe('four-bar closure', () => {
  const f = base(2, 6, 5, 7)
  it('keeps all link lengths for every crank angle', () => {
    for (let i = 0; i < 360; i += 5) {
      const p = solveFourBar(f, (i * Math.PI) / 180)!
      expect(p).not.toBeNull()
      expect(dist(f.A, p.B)).toBeCloseTo(2, 9)
      expect(dist(p.B, p.C)).toBeCloseTo(6, 9)
      expect(dist(f.D, p.C)).toBeCloseTo(5, 9)
    }
  })
  it('known configuration: square-ish parallelogram linkage', () => {
    // parallelogram: crank = rocker = 3, coupler = ground = 5; coupler stays parallel to ground
    const par = base(3, 5, 3, 5)
    const p = solveFourBar(par, 1)!
    expect(p.C[1] - p.B[1]).toBeCloseTo(0, 9)
    expect(p.C[0] - p.B[0]).toBeCloseTo(5, 9)
  })
  it('coupler point sits at the requested offset', () => {
    const p = solveFourBar({ ...f, px: 3, py: 0 }, 0.7)!
    expect(dist(p.B, p.P)).toBeCloseTo(3, 9)
    const q = solveFourBar({ ...f, px: 0, py: 2 }, 0.7)!
    expect(dist(q.B, q.P)).toBeCloseTo(2, 9)
  })
  it('transmission angle follows the law of cosines', () => {
    const p = solveFourBar(f, 0.4)!
    const d = dist(p.B, f.D)
    const mu = Math.acos((36 + 25 - d * d) / (2 * 6 * 5))
    expect(p.mu).toBeCloseTo(mu, 9)
    const v1 = [p.B[0] - p.C[0], p.B[1] - p.C[1]]
    const v2 = [f.D[0] - p.C[0], f.D[1] - p.C[1]]
    const ang = Math.acos((v1[0] * v2[0] + v1[1] * v2[1]) / (6 * 5))
    expect(p.mu).toBeCloseTo(ang, 9)
  })
  it('the two branches are mirror images about the line B-D', () => {
    const a = solveFourBar(base(2, 6, 5, 7, 1), 1)!
    const b = solveFourBar(base(2, 6, 5, 7, -1), 1)!
    expect(a.C[0]).not.toBeCloseTo(b.C[0], 3)
    expect(a.mu).toBeCloseTo(b.mu, 9)
  })
})

describe('Grashof classification', () => {
  it('crank-rocker: shortest is the crank', () => {
    const c = classifyFourBar(base(2, 6, 5, 7))
    expect(c.grashof).toBe(true)
    expect(c.kind).toBe('crank-rocker')
  })
  it('double crank: shortest is the ground link', () => {
    expect(classifyFourBar(base(5, 6, 5, 2)).kind).toBe('double-crank')
  })
  it('double rocker (Grashof): shortest is the coupler', () => {
    expect(classifyFourBar(base(5, 2, 6, 5)).kind).toBe('double-rocker')
  })
  it('non-Grashof is a triple rocker', () => {
    const c = classifyFourBar(base(4, 5, 6, 8))
    expect(c.grashof).toBe(false)
    expect(c.kind).toBe('triple-rocker')
    expect(c.margin).toBeGreaterThan(0)
  })
  it('change point when s + l = p + q', () => {
    expect(classifyFourBar(base(2, 5, 4, 7)).kind).toBe('change-point')
  })
})

describe('input range', () => {
  it('crank-rocker crank turns fully', () => {
    const r = fourBarRange(base(2, 6, 5, 7))
    expect(r.full).toBe(true)
  })
  it('non-Grashof linkage has a limited range with closure at the limits', () => {
    const f = base(4, 5, 6, 8)
    const r = fourBarRange(f, 0.2)
    expect(r.full).toBe(false)
    expect(r.end).toBeGreaterThan(r.start)
    expect(solveFourBar(f, r.start + 1e-6)).not.toBeNull()
    expect(solveFourBar(f, r.end + 1e-3)).toBeNull()
    const poses = sampleFourBar(f, r)
    expect(poses.length).toBeGreaterThan(300)
  })
  it('rocker oscillation limits satisfy the toggle condition', () => {
    // at the limit, B, C, D are collinear (|BD| = coupler + rocker or |coupler - rocker|)
    const f = base(2, 6, 5, 7)
    const lim = fourBarRange({ ...f, crank: 4 }, 0)
    if (!lim.full) {
      const p = solveFourBar({ ...f, crank: 4 }, lim.end)!
      const d = dist(p.B, f.D)
      expect([11, 1].some((t) => Math.abs(d - t) < 1e-4)).toBe(true)
    }
  })
  it('animatedAngle ping-pongs', () => {
    const r = { full: false, start: 1, end: 2 }
    expect(animatedAngle(r, 0)).toBeCloseTo(1, 12)
    expect(animatedAngle(r, 0.5)).toBeCloseTo(2, 12)
    expect(animatedAngle(r, 1)).toBeCloseTo(1, 12)
    expect(animatedAngle({ full: true, start: 0, end: 2 * Math.PI }, 0.25)).toBeCloseTo(Math.PI / 2, 12)
  })
})

describe('slider-crank', () => {
  const s: SliderCrank = { A: [0, 0], crank: 2, rod: 6, offset: 0, side: 1, px: 3, py: 0 }
  it('slider position matches x = r cos t + sqrt(l^2 - r^2 sin^2 t)', () => {
    for (const t of [0, 0.5, 1, 2, 3, 4.5]) {
      const p = solveSliderCrank(s, t)!
      expect(p.C[0]).toBeCloseTo(2 * Math.cos(t) + Math.sqrt(36 - 4 * Math.sin(t) ** 2), 9)
      expect(dist(p.B, p.C)).toBeCloseTo(6, 9)
    }
  })
  it('inline stroke is twice the crank', () => {
    const r = sliderRange(s)
    expect(r.full).toBe(true)
    expect(sliderStroke(sampleSlider(s, r, 720))).toBeCloseTo(4, 3)
  })
  it('transmission angle is 90 deg at the dead centres and smallest at 90 deg crank', () => {
    expect(solveSliderCrank(s, 0)!.mu).toBeCloseTo(Math.PI / 2, 9)
    const p = solveSliderCrank(s, Math.PI / 2)!
    expect(p.mu).toBeCloseTo(Math.PI / 2 - Math.asin(2 / 6), 9)
  })
  it('offset stroke is sqrt((l+r)^2 - e^2) - sqrt((l-r)^2 - e^2)', () => {
    const off = { ...s, offset: 1 }
    const expected = Math.sqrt(64 - 1) - Math.sqrt(16 - 1)
    expect(sliderStroke(sampleSlider(off, sliderRange(off), 720))).toBeCloseTo(expected, 3)
  })
  it('rod too short for the offset cannot rotate fully', () => {
    const bad = { ...s, rod: 2.5, offset: 1 }
    expect(sliderRange(bad).full).toBe(false)
    expect(solveSliderCrank({ ...s, rod: 1 }, 1.5)).toBeNull()
  })
})
