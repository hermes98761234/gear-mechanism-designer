import { halfToothAngle, radii, type GearSpec } from './involute.ts'

export type Pt = [number, number]

const TAU = Math.PI * 2

interface Flank {
  /** Points of the left flank of a tooth centred on angle 0, from the tip down to the fillet start. */
  left: Pt[]
  /** Points of the fillet arc from the flank down to the root circle. */
  fillet: Pt[]
  /** Angle where the left fillet meets the root circle. */
  rootAngle: number
  tipAngle: number
  tipR: number
  rootR: number
}

const polar = (r: number, a: number): Pt => [r * Math.cos(a), r * Math.sin(a)]

function flankPoint(g: GearSpec, rho: number): Pt {
  return polar(rho, halfToothAngle(g, rho))
}

/** Unit normal of the left flank pointing into the tooth space (towards larger polar angle). */
function flankNormal(g: GearSpec, rho: number, dr: number): Pt {
  const p0 = flankPoint(g, rho - dr)
  const p1 = flankPoint(g, rho + dr)
  const tx = p1[0] - p0[0]
  const ty = p1[1] - p0[1]
  const l = Math.hypot(tx, ty) || 1
  return [-ty / l, tx / l]
}

/** Find the fillet circle (tangent to the flank and the root circle). Returns the centre and tangent point on the flank, or null. */
function solveFillet(g: GearSpec, rb: number, rootR: number, tipR: number, rf: number): { center: Pt; tangent: Pt } | null {
  const sgn = g.kind === 'external' ? 1 : -1
  const centreR = rootR + sgn * rf
  if (centreR <= 0) return null
  const start = g.kind === 'external' ? Math.max(rootR, rb * 1.0000001) : rootR
  const end = tipR
  const N = 240
  const dr = Math.abs(end - start) * 1e-5 + 1e-9
  const gfun = (rho: number) => {
    const p = flankPoint(g, rho)
    const n = flankNormal(g, rho, dr)
    // The tooth space lies on the +angle side only for the left flank when n is rotated +90deg from d/drho.
    const c: Pt = [p[0] + rf * n[0], p[1] + rf * n[1]]
    return { v: Math.hypot(c[0], c[1]) - centreR, c, p }
  }
  let prev = gfun(start)
  let prevRho = start
  for (let i = 1; i <= N; i++) {
    const rho = start + ((end - start) * i) / N
    const cur = gfun(rho)
    if (prev.v * cur.v <= 0 && prev.v !== cur.v) {
      let lo = prevRho
      let hi = rho
      let flo = prev.v
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2
        const fm = gfun(mid).v
        if (flo * fm <= 0) hi = mid
        else {
          lo = mid
          flo = fm
        }
      }
      const r = gfun((lo + hi) / 2)
      return { center: r.c, tangent: r.p }
    }
    prev = cur
    prevRho = rho
  }
  return null
}

function buildFlank(g: GearSpec, flankSteps: number, filletSteps: number): Flank {
  const rd = radii(g)
  const rb = rd.base
  const rootR = rd.root
  const sgn = g.kind === 'external' ? 1 : -1
  let tipR = rd.addendum
  if (g.kind === 'external') {
    tipR = Math.max(tipR, rb * 1.001)
    // Do not go past the radius where the tooth gets pointed.
    if (halfToothAngle(g, tipR) < 0) {
      let lo = rb
      let hi = tipR
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2
        if (halfToothAngle(g, mid) > 0) lo = mid
        else hi = mid
      }
      tipR = lo
    }
  } else {
    tipR = Math.max(tipR, rb * 1.001)
  }
  const tipAngle = Math.max(0, halfToothAngle(g, tipR))

  // Fillet
  let sol: ReturnType<typeof solveFillet> = null
  let rf = Math.max(0, g.fillet)
  const maxAngle = Math.PI / g.z
  for (let attempt = 0; attempt < 8 && rf > 1e-6; attempt++) {
    sol = solveFillet(g, rb, rootR, tipR, rf)
    if (sol && Math.atan2(sol.center[1], sol.center[0]) < maxAngle * 0.98 && Math.atan2(sol.center[1], sol.center[0]) > 0) break
    sol = null
    rf *= 0.6
  }

  const left: Pt[] = []
  const fillet: Pt[] = []
  let startRho: number
  let rootAngle: number
  if (sol) {
    startRho = Math.hypot(sol.tangent[0], sol.tangent[1])
    const cA = sol.center
    const a1 = Math.atan2(sol.tangent[1] - cA[1], sol.tangent[0] - cA[0])
    const a2 = Math.atan2(-sgn * cA[1], -sgn * cA[0]) // from the centre to the root-circle tangent point
    let d = a2 - a1
    while (d > Math.PI) d -= TAU
    while (d < -Math.PI) d += TAU
    for (let i = 1; i <= filletSteps; i++) {
      const a = a1 + (d * i) / filletSteps
      fillet.push([cA[0] + rf * Math.cos(a), cA[1] + rf * Math.sin(a)])
    }
    rootAngle = Math.atan2(cA[1], cA[0])
  } else if (g.kind === 'external' && rootR < rb) {
    startRho = rb
    rootAngle = halfToothAngle(g, rb)
    fillet.push(polar(rootR, rootAngle))
  } else {
    startRho = g.kind === 'external' ? Math.max(rootR, rb) : rootR
    rootAngle = halfToothAngle(g, startRho)
    if (g.kind === 'internal' && rootR < rb) {
      startRho = rb
    }
  }
  // Flank from tip down to start.
  for (let i = 0; i <= flankSteps; i++) {
    const rho = tipR + ((startRho - tipR) * i) / flankSteps
    left.push(flankPoint(g, rho))
  }
  return { left, fillet, rootAngle, tipAngle, tipR, rootR }
}

/**
 * Closed outline of a gear centred on the origin with tooth 0 centred on +x.
 * Counter-clockwise. For an internal gear this is the inner (toothed) boundary of the ring.
 */
export function gearOutline(g: GearSpec, opts: { flankSteps?: number; filletSteps?: number; tipSteps?: number; rootSteps?: number } = {}): Pt[] {
  const { flankSteps = 10, filletSteps = 6, tipSteps = 3, rootSteps = 3 } = opts
  const f = buildFlank(g, flankSteps, filletSteps)
  const lseq: Pt[] = [...f.left, ...f.fillet]
  const rseq: Pt[] = lseq.map((p): Pt => [p[0], -p[1]]).reverse()
  const tip: Pt[] = []
  for (let i = 1; i < tipSteps; i++) {
    const a = -f.tipAngle + (2 * f.tipAngle * i) / tipSteps
    tip.push(polar(f.tipR, a))
  }
  const tooth: Pt[] = [...rseq, ...tip, ...lseq]
  const pts: Pt[] = []
  const pitchA = TAU / g.z
  for (let k = 0; k < g.z; k++) {
    const c = k * pitchA
    const cos = Math.cos(c)
    const sin = Math.sin(c)
    for (const p of tooth) pts.push([p[0] * cos - p[1] * sin, p[0] * sin + p[1] * cos])
    // root arc to the next tooth
    const a0 = c + f.rootAngle
    const a1 = c + pitchA - f.rootAngle
    for (let i = 1; i < rootSteps; i++) {
      const a = a0 + ((a1 - a0) * i) / rootSteps
      if (a1 > a0) pts.push(polar(f.rootR, a))
    }
  }
  return pts
}

export interface RackSpec {
  m: number
  alpha: number
  ha: number
  c: number
  backlash: number
}

/** Rack tooth outline along +x for teeth whose space centres sit at x = k*p + offset (k integer), pitch line at y = 0, teeth toward +y. */
export function rackOutline(r: RackSpec, xMin: number, xMax: number, offset: number): Pt[] {
  const p = Math.PI * r.m
  const s = p / 2 - r.backlash / 2
  const tan = Math.tan(r.alpha)
  const up = r.ha * r.m
  const down = (r.ha + r.c) * r.m
  const halfTip = s / 2 - up * tan
  const halfRoot = s / 2 + down * tan
  const pts: Pt[] = []
  const k0 = Math.floor((xMin - offset) / p) - 1
  const k1 = Math.ceil((xMax - offset) / p) + 1
  for (let k = k0; k <= k1; k++) {
    const c = offset + k * p + p / 2
    pts.push([c - halfRoot, -down], [c - Math.max(0, halfTip), up], [c + Math.max(0, halfTip), up], [c + halfRoot, -down])
  }
  return pts
}

export function polylineBounds(pts: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

export const transformPts = (pts: Pt[], angle: number, dx: number, dy: number): Pt[] => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return pts.map((p): Pt => [p[0] * c - p[1] * s + dx, p[0] * s + p[1] * c + dy])
}
