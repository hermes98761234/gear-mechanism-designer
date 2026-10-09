// Disc-cam design: motion laws, displacement diagrams, pressure angle and profile generation.

export type LawId = 'dwell' | 'cycloidal' | 'harmonic' | 'constant' | 'poly345'

export const LAWS: LawId[] = ['dwell', 'cycloidal', 'harmonic', 'constant', 'poly345']

export interface Law {
  s: (t: number) => number
  v: (t: number) => number
  a: (t: number) => number
}

const TAU = 2 * Math.PI

/** Normalised rise laws on t in [0,1]: s from 0 to 1, with ds/dt and d2s/dt2. */
export const LAW_FN: Record<LawId, Law> = {
  dwell: { s: () => 0, v: () => 0, a: () => 0 },
  cycloidal: {
    s: (t) => t - Math.sin(TAU * t) / TAU,
    v: (t) => 1 - Math.cos(TAU * t),
    a: (t) => TAU * Math.sin(TAU * t),
  },
  harmonic: {
    s: (t) => (1 - Math.cos(Math.PI * t)) / 2,
    v: (t) => (Math.PI / 2) * Math.sin(Math.PI * t),
    a: (t) => ((Math.PI * Math.PI) / 2) * Math.cos(Math.PI * t),
  },
  constant: { s: (t) => t, v: () => 1, a: () => 0 },
  poly345: {
    s: (t) => 10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5,
    v: (t) => 30 * t ** 2 - 60 * t ** 3 + 30 * t ** 4,
    a: (t) => 60 * t - 180 * t ** 2 + 120 * t ** 3,
  },
}

export interface Segment {
  law: LawId
  /** Duration in degrees of cam rotation. */
  beta: number
  /** Follower displacement change over the segment (mm). Positive = rise, negative = return. Ignored for dwell. */
  lift: number
}

export interface Sample {
  /** Cam angle (deg), displacement y (mm), dy/dtheta (mm/rad), d2y/dtheta2 (mm/rad^2). */
  theta: number
  y: number
  v: number
  a: number
}

export const totalBeta = (segs: Segment[]) => segs.reduce((s, x) => s + x.beta, 0)
export const netLift = (segs: Segment[]) => segs.reduce((s, x) => s + (x.law === 'dwell' ? 0 : x.lift), 0)

/** Displacement, velocity and acceleration at cam angle thetaDeg (wrapped to 0..360 through the segment list). */
export function evalCam(segs: Segment[], thetaDeg: number): Sample {
  const total = totalBeta(segs)
  if (!segs.length || total <= 0) return { theta: thetaDeg, y: 0, v: 0, a: 0 }
  let th = ((thetaDeg % total) + total) % total
  let y0 = 0
  for (let i = 0; i < segs.length; i++) {
    const sg = segs[i]
    const lift = sg.law === 'dwell' ? 0 : sg.lift
    if (th <= sg.beta || i === segs.length - 1) {
      const t = sg.beta > 0 ? Math.min(1, th / sg.beta) : 1
      const f = LAW_FN[sg.law]
      const betaRad = (sg.beta * Math.PI) / 180
      return { theta: thetaDeg, y: y0 + lift * f.s(t), v: (lift * f.v(t)) / betaRad, a: (lift * f.a(t)) / (betaRad * betaRad) }
    }
    th -= sg.beta
    y0 += lift
  }
  return { theta: thetaDeg, y: y0, v: 0, a: 0 }
}

export function sampleCam(segs: Segment[], n = 720): Sample[] {
  const total = totalBeta(segs) || 360
  return Array.from({ length: n + 1 }, (_, i) => evalCam(segs, (total * i) / n))
}

/** Scale durations to sum to 360 and make the net lift zero by adjusting the last non-dwell segment. */
export function normalizeSegments(segs: Segment[]): Segment[] {
  const total = totalBeta(segs)
  if (total <= 0) return segs
  const out = segs.map((s) => ({ ...s, beta: (s.beta * 360) / total }))
  const net = netLift(out)
  if (Math.abs(net) > 1e-9) {
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].law !== 'dwell') {
        out[i] = { ...out[i], lift: out[i].lift - net }
        break
      }
    }
  }
  return out
}

export type FollowerKind = 'roller' | 'flat'

export interface CamSpec {
  segments: Segment[]
  /** Base circle radius (mm). */
  baseRadius: number
  followerKind: FollowerKind
  /** Roller radius (mm), roller follower only. */
  rollerRadius: number
  /** Offset of the follower axis from the cam centre (mm), roller only. */
  offset: number
}

export interface CamAnalysis {
  /** Pitch-curve start radius s0 = sqrt((Rb + Rr)^2 - e^2) for roller followers, Rb for flat. */
  s0: number
  profile: [number, number][]
  /** Prime (pitch) curve for roller followers; the same as the profile for flat. */
  pitch: [number, number][]
  samples: Sample[]
  /** Pressure angle per sample (rad, signed). */
  pressure: number[]
  maxPressureDeg: number
  /** Minimum radius of curvature (mm) of the convex part of the pitch curve (roller) or of the profile (flat). Infinity if none. */
  minCurvatureRadius: number
  /** Minimum half-width the flat face needs. */
  flatHalfWidth: number
  warnings: CamWarning[]
}

export type CamWarning = 'badTotal' | 'netLift' | 'highPressure' | 'rollerLarge' | 'flatConcave' | 'offsetLarge'

/** Pressure angle of a translating roller follower: tan(phi) = (dy/dtheta - e) / (y + sqrt(Rp^2 - e^2)). */
export function pressureAngle(v: number, y: number, s0: number, e: number): number {
  return Math.atan2(v - e, s0 + y)
}

export function analyzeCam(spec: CamSpec, n = 720): CamAnalysis {
  const { baseRadius: Rb, rollerRadius: Rr, offset: e, followerKind } = spec
  const roller = followerKind === 'roller'
  const Rp = Rb + (roller ? Rr : 0)
  const eff = roller ? e : 0
  const s0 = roller ? Math.sqrt(Math.max(0, Rp * Rp - eff * eff)) : Rb
  const samples = sampleCam(spec.segments, n)
  const total = totalBeta(spec.segments) || 360
  const profile: [number, number][] = []
  const pitch: [number, number][] = []
  const pressure: number[] = []
  let minCurv = Infinity
  let flatHalf = 0
  for (const smp of samples) {
    const th = ((smp.theta / total) * 360 * Math.PI) / 180 // cam angle in radians, scaled to 360 deg
    const k = 360 / total
    const y = smp.y
    const v = smp.v / k // per radian of true cam angle
    const a = smp.a / (k * k)
    const c = Math.cos(th)
    const s = Math.sin(th)
    const rot = (x: number, yy: number): [number, number] => [x * c + yy * s, -x * s + yy * c]
    if (roller) {
      const S = s0 + y
      const L = Math.hypot(v - eff, S) || 1
      const F: [number, number] = [eff, S]
      const C: [number, number] = [F[0] - (Rr * (eff - v)) / L, F[1] - (Rr * S) / L]
      pitch.push(rot(F[0], F[1]))
      profile.push(rot(C[0], C[1]))
      pressure.push(pressureAngle(v, y, s0, eff))
    } else {
      const S = Rb + y
      const p = rot(v, S)
      profile.push(p)
      pitch.push(p)
      pressure.push(0)
      flatHalf = Math.max(flatHalf, Math.abs(v - e))
      minCurv = Math.min(minCurv, S + a)
    }
  }
  if (roller) {
    // radius of curvature of the pitch curve by finite differences on the sampled prime curve (closed curve)
    const m = pitch.length - 1
    const dth = (2 * Math.PI) / m
    const rho: number[] = []
    for (let i = 0; i < m; i++) {
      const p0 = pitch[(i - 1 + m) % m]
      const p1 = pitch[i]
      const p2 = pitch[(i + 1) % m]
      const dx = (p2[0] - p0[0]) / (2 * dth)
      const dy = (p2[1] - p0[1]) / (2 * dth)
      const ddx = (p2[0] - 2 * p1[0] + p0[0]) / (dth * dth)
      const ddy = (p2[1] - 2 * p1[1] + p0[1]) / (dth * dth)
      const cross = dx * ddy - dy * ddx
      // traversal is clockwise, so convex parts have negative cross
      const r = Math.pow(dx * dx + dy * dy, 1.5) / -cross
      rho.push(r)
    }
    // Only convex parts of the pitch curve can undercut; concave parts are harmless for a roller.
    minCurv = Math.min(Infinity, ...rho.filter((r) => r > 0))
  }
  const maxP = Math.max(...pressure.map((p) => Math.abs(p))) * (180 / Math.PI)
  const warnings: CamWarning[] = []
  if (Math.abs(totalBeta(spec.segments) - 360) > 1e-6) warnings.push('badTotal')
  if (Math.abs(netLift(spec.segments)) > 1e-6) warnings.push('netLift')
  if (roller && maxP > 30) warnings.push('highPressure')
  if (roller && minCurv > 0 && minCurv < Rr) warnings.push('rollerLarge')
  if (!roller && minCurv <= 0) warnings.push('flatConcave')
  if (roller && Math.abs(e) >= Rp) warnings.push('offsetLarge')
  return { s0, profile, pitch, samples, pressure, maxPressureDeg: maxP, minCurvatureRadius: minCurv, flatHalfWidth: flatHalf, warnings }
}

/** Outline as a closed polyline (drops the duplicated end point). */
export const closedProfile = (a: CamAnalysis): [number, number][] => (a.profile.length > 1 ? a.profile.slice(0, -1) : a.profile)

/** Default demonstration cam: rise 25 mm, dwell, return, dwell. */
export const defaultSegments = (): Segment[] => [
  { law: 'cycloidal', beta: 120, lift: 25 },
  { law: 'dwell', beta: 60, lift: 0 },
  { law: 'poly345', beta: 120, lift: -25 },
  { law: 'dwell', beta: 60, lift: 0 },
]
