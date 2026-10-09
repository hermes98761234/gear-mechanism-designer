// Planar four-bar and slider-crank kinematics.

export type V = [number, number]

export const dist = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Intersections of circle (c0, r0) and circle (c1, r1); null when they do not meet. Sign picks the side (left of c0->c1 for +1). */
export function circleIntersection(c0: V, r0: number, c1: V, r1: number, sign: 1 | -1): V | null {
  const d = dist(c0, c1)
  if (d < 1e-12) return null
  if (d > r0 + r1 + 1e-9 || d < Math.abs(r0 - r1) - 1e-9) return null
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, r0 * r0 - a * a))
  const ux = (c1[0] - c0[0]) / d
  const uy = (c1[1] - c0[1]) / d
  return [c0[0] + a * ux - sign * h * uy, c0[1] + a * uy + sign * h * ux]
}

export interface FourBar {
  A: V // ground pivot of the crank
  D: V // ground pivot of the rocker
  crank: number // |AB|
  coupler: number // |BC|
  rocker: number // |DC|
  /** Coupler point P: distance along B->C and perpendicular offset (left of B->C positive). */
  px: number
  py: number
  /** Assembly circuit: +1 or -1. */
  branch: 1 | -1
}

export interface FourBarPose {
  theta: number
  B: V
  C: V
  P: V
  /** Angle between coupler and rocker (rad, 0..pi). */
  mu: number
}

export function solveFourBar(f: FourBar, theta: number): FourBarPose | null {
  const B: V = [f.A[0] + f.crank * Math.cos(theta), f.A[1] + f.crank * Math.sin(theta)]
  const C = circleIntersection(B, f.coupler, f.D, f.rocker, f.branch)
  if (!C) return null
  const ux = (C[0] - B[0]) / f.coupler
  const uy = (C[1] - B[1]) / f.coupler
  const P: V = [B[0] + f.px * ux - f.py * uy, B[1] + f.px * uy + f.py * ux]
  const dBD = dist(B, f.D)
  const cos = (f.coupler ** 2 + f.rocker ** 2 - dBD ** 2) / (2 * f.coupler * f.rocker)
  return { theta, B, C, P, mu: Math.acos(Math.max(-1, Math.min(1, cos))) }
}

export type GrashofClass = 'crank-rocker' | 'double-crank' | 'double-rocker' | 'change-point' | 'triple-rocker'

export interface Classification {
  grashof: boolean
  /** s + l - (p + q); negative means Grashof. */
  margin: number
  kind: GrashofClass
  /** Which link is shortest: 'ground' | 'crank' | 'coupler' | 'rocker'. */
  shortest: 'ground' | 'crank' | 'coupler' | 'rocker'
}

export function classifyFourBar(f: Pick<FourBar, 'A' | 'D' | 'crank' | 'coupler' | 'rocker'>): Classification {
  const g = dist(f.A, f.D)
  const links = [
    { n: 'ground', l: g },
    { n: 'crank', l: f.crank },
    { n: 'coupler', l: f.coupler },
    { n: 'rocker', l: f.rocker },
  ] as const
  const sorted = [...links].sort((a, b) => a.l - b.l)
  const s = sorted[0].l
  const l = sorted[3].l
  const margin = s + l - (sorted[1].l + sorted[2].l)
  const eps = 1e-9 * Math.max(1, l)
  const shortest = sorted[0].n
  if (Math.abs(margin) <= eps) return { grashof: true, margin, kind: 'change-point', shortest }
  if (margin > 0) return { grashof: false, margin, kind: 'triple-rocker', shortest }
  const kind: GrashofClass = shortest === 'ground' ? 'double-crank' : shortest === 'coupler' ? 'double-rocker' : 'crank-rocker'
  return { grashof: true, margin, kind, shortest }
}

export interface Range {
  /** True when the input link can make a full turn. */
  full: boolean
  /** Start/end angle (rad), end >= start, unwrapped. */
  start: number
  end: number
}

/** Contiguous range of input angles (containing theta0 if possible) for which the loop closes. */
export function inputRange(feasible: (theta: number) => boolean, theta0 = 0, n = 720): Range {
  const step = (2 * Math.PI) / n
  const ok: boolean[] = Array.from({ length: n }, (_, i) => feasible(i * step))
  if (ok.every(Boolean)) return { full: true, start: 0, end: 2 * Math.PI }
  if (!ok.some(Boolean)) return { full: false, start: theta0, end: theta0 }
  let i0 = Math.round((((theta0 % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / step) % n
  if (!ok[i0]) {
    // nearest feasible sample
    let best = -1
    for (let d = 1; d < n && best < 0; d++) {
      if (ok[(i0 + d) % n]) best = (i0 + d) % n
      else if (ok[(i0 - d + n) % n]) best = (i0 - d + n) % n
    }
    i0 = best
  }
  let up = 0
  while (up < n - 1 && ok[(i0 + up + 1) % n]) up++
  let down = 0
  while (down < n - 1 - up && ok[(i0 - down - 1 + n) % n]) down++
  const refine = (inside: number, outside: number) => {
    let lo = inside
    let hi = outside
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2
      if (feasible(mid)) lo = mid
      else hi = mid
    }
    return lo
  }
  const base = i0 * step
  const end = refine(base + up * step, base + (up + 1) * step)
  const start = refine(base - down * step, base - (down + 1) * step)
  return { full: false, start, end }
}

export function fourBarRange(f: FourBar, theta0 = 0): Range {
  return inputRange((t) => solveFourBar(f, t) !== null, theta0)
}

/** Sample the coupler curve and transmission angle over the range. */
export function sampleFourBar(f: FourBar, range: Range, n = 360): FourBarPose[] {
  const out: FourBarPose[] = []
  const span = range.end - range.start
  const count = range.full ? n : n + 1
  for (let i = 0; i < count; i++) {
    const t = range.start + (span * i) / n
    const p = solveFourBar(f, t)
    if (p) out.push(p)
  }
  return out
}

/** Triangle-wave animation: phase 0..1 maps to a full turn, or back and forth over a limited range. */
export function animatedAngle(range: Range, phase: number): number {
  const p = ((phase % 1) + 1) % 1
  if (range.full) return range.start + p * (range.end - range.start)
  const tri = p < 0.5 ? p * 2 : 2 - p * 2
  return range.start + tri * (range.end - range.start)
}

/* ---------- slider-crank ---------- */

export interface SliderCrank {
  A: V
  crank: number
  rod: number
  /** Offset of the slider line from A (positive up). */
  offset: number
  /** +1: slider on the +x side of the crank. */
  side: 1 | -1
  px: number
  py: number
}

export interface SliderPose {
  theta: number
  B: V
  C: V
  P: V
  /** Angle between the rod and the slider axis (rad, signed). */
  phi: number
  /** Transmission angle = 90deg - |phi| (rad). */
  mu: number
}

export function solveSliderCrank(s: SliderCrank, theta: number): SliderPose | null {
  const B: V = [s.A[0] + s.crank * Math.cos(theta), s.A[1] + s.crank * Math.sin(theta)]
  const dy = s.A[1] + s.offset - B[1]
  const q = s.rod * s.rod - dy * dy
  if (q < 0) return null
  const C: V = [B[0] + s.side * Math.sqrt(q), s.A[1] + s.offset]
  const ux = (C[0] - B[0]) / s.rod
  const uy = (C[1] - B[1]) / s.rod
  const P: V = [B[0] + s.px * ux - s.py * uy, B[1] + s.px * uy + s.py * ux]
  const phi = Math.asin(Math.max(-1, Math.min(1, (B[1] - C[1]) / s.rod)))
  return { theta, B, C, P, phi, mu: Math.PI / 2 - Math.abs(phi) }
}

export function sliderRange(s: SliderCrank, theta0 = 0): Range {
  return inputRange((t) => solveSliderCrank(s, t) !== null, theta0)
}

export function sampleSlider(s: SliderCrank, range: Range, n = 360): SliderPose[] {
  const out: SliderPose[] = []
  const count = range.full ? n : n + 1
  for (let i = 0; i < count; i++) {
    const p = solveSliderCrank(s, range.start + ((range.end - range.start) * i) / n)
    if (p) out.push(p)
  }
  return out
}

/** Stroke (max - min slider position) over the sampled poses. */
export function sliderStroke(poses: SliderPose[]): number {
  if (!poses.length) return 0
  const xs = poses.map((p) => p.C[0])
  return Math.max(...xs) - Math.min(...xs)
}

/** Sample bounds helper used for auto-fit. */
export function boundsOf(points: V[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}
