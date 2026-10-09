// Involute spur-gear geometry (ISO 53 / DIN 867 style rack, full-depth by default).
// All lengths in millimetres, angles in radians unless a name ends in Deg.

export const DEG = Math.PI / 180

export const inv = (a: number) => Math.tan(a) - a

/** Inverse of the involute function (Newton iteration). */
export function invInverse(v: number): number {
  if (v <= 0) return 0
  let a = Math.cbrt(3 * v) // good starting guess for small angles
  if (a > 1.4) a = 1.4
  for (let i = 0; i < 60; i++) {
    const f = Math.tan(a) - a - v
    const d = Math.tan(a) ** 2
    if (d < 1e-14) break
    const na = a - f / d
    if (Math.abs(na - a) < 1e-14) return na
    a = Math.min(Math.max(na, 1e-9), 1.5)
  }
  return a
}

export type GearKind = 'external' | 'internal'

export interface GearSpec {
  /** Module in mm. */
  m: number
  z: number
  /** Pressure angle, radians. */
  alpha: number
  /** Profile shift coefficient x (so the shift is x*m). */
  x: number
  /** Total circumferential backlash allowance (mm) removed from the tooth thickness of this gear. */
  backlash: number
  /** Addendum coefficient h_a*, root clearance coefficient c*. */
  ha: number
  c: number
  /** Root fillet radius in mm (0 = sharp). */
  fillet: number
  kind: GearKind
}

export const defaultSpec = (over: Partial<GearSpec> = {}): GearSpec => ({
  m: 2, z: 20, alpha: 20 * DEG, x: 0, backlash: 0, ha: 1, c: 0.25, fillet: 0.38 * 2, kind: 'external', ...over,
})

/** Diametral pitch (teeth per inch) -> module (mm). */
export const moduleFromDP = (dp: number) => 25.4 / dp
export const dpFromModule = (m: number) => 25.4 / m

export interface GearRadii {
  pitch: number
  base: number
  /** Tip circle (for an internal gear: the inner, tip radius). */
  addendum: number
  /** Root circle (for an internal gear: the outer, root radius). */
  root: number
}

/** Tooth thickness on the pitch circle (arc length), after backlash. */
export function toothThicknessPitch(g: GearSpec): number {
  const sgn = g.kind === 'external' ? 1 : -1
  return g.m * (Math.PI / 2 + sgn * 2 * g.x * Math.tan(g.alpha)) - g.backlash / 2
}

export function radii(g: GearSpec): GearRadii {
  const r = (g.m * g.z) / 2
  const base = r * Math.cos(g.alpha)
  if (g.kind === 'external') {
    return { pitch: r, base, addendum: r + (g.ha + g.x) * g.m, root: r - (g.ha + g.c - g.x) * g.m }
  }
  return { pitch: r, base, addendum: r - (g.ha - g.x) * g.m, root: r + (g.ha + g.c + g.x) * g.m }
}

/** Half tooth angle (from the tooth centre line) of the flank at radius rho. */
export function halfToothAngle(g: GearSpec, rho: number): number {
  const r = (g.m * g.z) / 2
  const rb = r * Math.cos(g.alpha)
  const s = toothThicknessPitch(g)
  const aRho = Math.acos(Math.min(1, rb / rho))
  const sgn = g.kind === 'external' ? 1 : -1
  return s / (2 * r) + sgn * (inv(g.alpha) - inv(aRho))
}

/** Tooth thickness (arc length) at an arbitrary radius rho >= base radius. */
export function toothThicknessAt(g: GearSpec, rho: number): number {
  return 2 * rho * halfToothAngle(g, rho)
}

/** Minimum number of teeth before undercut with a rack of addendum ha* (x = 0). */
export function minTeethNoUndercut(alpha: number, ha = 1): number {
  return (2 * ha) / Math.sin(alpha) ** 2
}

/** Smallest profile shift coefficient that avoids undercut for z teeth. */
export function minShiftNoUndercut(z: number, alpha: number, ha = 1): number {
  return (ha * (minTeethNoUndercut(alpha, ha) - z)) / minTeethNoUndercut(alpha, ha)
}

export type Warning =
  | { id: 'undercut'; xMin: number }
  | { id: 'pointed'; thickness: number }
  | { id: 'boreTooLarge' }
  | { id: 'smallRing'; zDiff: number }
  | { id: 'ringTipInterference' }
  | { id: 'fewTeeth' }
  | { id: 'lowContact'; eps: number }
  | { id: 'noMesh' }

/** Tooth-form checks for one gear. */
export function gearWarnings(g: GearSpec): Warning[] {
  const out: Warning[] = []
  if (g.z < 3) out.push({ id: 'fewTeeth' })
  if (g.kind === 'external') {
    const xMin = minShiftNoUndercut(g.z, g.alpha, g.ha)
    if (g.x < xMin - 1e-9) out.push({ id: 'undercut', xMin })
  }
  const rd = radii(g)
  const rTip = Math.max(rd.addendum, rd.base)
  const sTip = toothThicknessAt(g, rTip)
  if (sTip < 0.2 * g.m) out.push({ id: 'pointed', thickness: Math.max(0, sTip) })
  return out
}

export interface PairResult {
  /** Working pressure angle (rad). */
  alphaW: number
  /** Centre distance (mm). */
  a: number
  /** Standard (zero-shift) centre distance. */
  a0: number
  /** Transverse contact ratio. */
  eps: number
  ratio: number
  /** Operating pitch radii. */
  rw1: number
  rw2: number
}

/** External pair: working pressure angle, centre distance and contact ratio (no centre-distance increase for backlash). */
export function externalPair(g1: GearSpec, g2: GearSpec): PairResult {
  const { m, alpha } = g1
  const sum = g1.z + g2.z
  const alphaW = invInverse(inv(alpha) + (2 * (g1.x + g2.x) * Math.tan(alpha)) / sum)
  const a0 = (m * sum) / 2
  const a = (a0 * Math.cos(alpha)) / Math.cos(alphaW)
  const r1 = radii(g1)
  const r2 = radii(g2)
  const l1 = Math.sqrt(Math.max(0, r1.addendum ** 2 - r1.base ** 2))
  const l2 = Math.sqrt(Math.max(0, r2.addendum ** 2 - r2.base ** 2))
  const eps = (l1 + l2 - a * Math.sin(alphaW)) / (Math.PI * m * Math.cos(alpha))
  const k = Math.cos(alpha) / Math.cos(alphaW)
  return { alphaW, a, a0, eps, ratio: g2.z / g1.z, rw1: r1.pitch * k, rw2: r2.pitch * k }
}

/** Internal pair: g1 external pinion inside ring g2 (kind 'internal'). */
export function internalPair(g1: GearSpec, g2: GearSpec): PairResult {
  const { m, alpha } = g1
  const dz = g2.z - g1.z
  const alphaW = invInverse(inv(alpha) + (2 * (g2.x - g1.x) * Math.tan(alpha)) / dz)
  const a0 = (m * dz) / 2
  const a = (a0 * Math.cos(alpha)) / Math.cos(alphaW)
  const r1 = radii(g1)
  const r2 = radii(g2)
  const l1 = Math.sqrt(Math.max(0, r1.addendum ** 2 - r1.base ** 2))
  const l2 = Math.sqrt(Math.max(0, r2.addendum ** 2 - r2.base ** 2))
  const eps = (l1 - l2 + a * Math.sin(alphaW)) / (Math.PI * m * Math.cos(alpha))
  const k = Math.cos(alpha) / Math.cos(alphaW)
  return { alphaW, a, a0, eps, ratio: g2.z / g1.z, rw1: r1.pitch * k, rw2: r2.pitch * k }
}

/** Pinion with a standard rack; the rack pitch line sits x*m from the pinion pitch circle. */
export function rackPair(g1: GearSpec): PairResult & { rackLineDistance: number } {
  const { m, alpha } = g1
  const r1 = radii(g1)
  const l1 = Math.sqrt(Math.max(0, r1.addendum ** 2 - r1.base ** 2))
  const g = l1 - r1.pitch * Math.sin(alpha) + ((g1.ha - g1.x) * m) / Math.sin(alpha)
  const eps = g / (Math.PI * m * Math.cos(alpha))
  return { alphaW: alpha, a: r1.pitch + g1.x * m, a0: r1.pitch, eps, ratio: Infinity, rw1: r1.pitch, rw2: Infinity, rackLineDistance: r1.pitch + g1.x * m }
}

/** Pair-level warnings from contact ratio. */
export function pairWarnings(p: PairResult): Warning[] {
  const out: Warning[] = []
  if (!Number.isFinite(p.eps) || p.eps < 1) out.push({ id: 'noMesh' })
  else if (p.eps < 1.2) out.push({ id: 'lowContact', eps: p.eps })
  return out
}

export interface BoreSpec {
  /** Bore diameter (0 = none). */
  diameter: number
  /** Keyway width (0 = none) and depth measured from the bore edge outward. */
  keyWidth: number
  keyDepth: number
}

/** Bore + keyway outline as a closed polyline (centred on the origin, keyway toward +x). */
export function borePolyline(b: BoreSpec, steps = 72): [number, number][] {
  const R = b.diameter / 2
  if (R <= 0) return []
  const w = Math.min(b.keyWidth / 2, R * 0.95)
  if (b.keyWidth <= 0 || b.keyDepth <= 0) {
    return Array.from({ length: steps }, (_, i) => [R * Math.cos((2 * Math.PI * i) / steps), R * Math.sin((2 * Math.PI * i) / steps)])
  }
  const beta = Math.asin(w / R)
  const pts: [number, number][] = []
  const n = Math.max(8, steps)
  for (let i = 0; i <= n; i++) {
    const t = beta + ((2 * Math.PI - 2 * beta) * i) / n
    pts.push([R * Math.cos(t), R * Math.sin(t)])
  }
  // pts ends at (xc, -w); finish the slot (the closing edge returns to the first vertex).
  pts.push([R + b.keyDepth, -w], [R + b.keyDepth, w])
  return pts
}

/** Validate that bore + keyway fit inside the root circle of an external gear. */
export function boreFits(g: GearSpec, b: BoreSpec): boolean {
  if (b.diameter <= 0) return true
  const reach = b.diameter / 2 + (b.keyWidth > 0 ? b.keyDepth : 0)
  return reach < radii(g).root - 0.5 * g.m
}
