import { defaultSegments, LAWS, type FollowerKind, type Segment } from './cam.ts'
import type { FourBar, SliderCrank } from './linkage.ts'

export type Lang = 'en' | 'uk'
export type Theme = 'auto' | 'light' | 'dark'
export type Tab = 'gears' | 'linkage' | 'cam'
export type Mesh = 'external' | 'internal' | 'rack'

export interface BoreState {
  diameter: number
  keyWidth: number
  keyDepth: number
}

export interface GearState {
  pitchMode: 'module' | 'dp'
  module: number
  dp: number
  alphaDeg: number
  backlash: number
  /** Root fillet radius as a fraction of the module. */
  filletCoef: number
  mesh: Mesh
  z1: number
  z2: number
  x1: number
  x2: number
  bore1: BoreState
  bore2: BoreState
  rpm: number
  circles: boolean
  lineOfAction: boolean
  exportWhat: 'pair' | 'gear1' | 'gear2'
}

export interface LinkState {
  mode: 'fourbar' | 'slider'
  fb: FourBar
  sc: SliderCrank
  speed: number
  trace: boolean
}

export interface CamState {
  segments: Segment[]
  baseRadius: number
  follower: FollowerKind
  rollerRadius: number
  offset: number
  bore: BoreState
  speed: number
  showPitch: boolean
}

export interface AppState {
  lang: Lang
  theme: Theme
  tab: Tab
  gear: GearState
  link: LinkState
  cam: CamState
}

export const defaultState = (): AppState => ({
  lang: typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('uk') ? 'uk' : 'en',
  theme: 'auto',
  tab: 'gears',
  gear: {
    pitchMode: 'module',
    module: 2,
    dp: 12.7,
    alphaDeg: 20,
    backlash: 0.1,
    filletCoef: 0.3,
    mesh: 'external',
    z1: 17,
    z2: 31,
    x1: 0.1,
    x2: 0,
    bore1: { diameter: 8, keyWidth: 2, keyDepth: 1 },
    bore2: { diameter: 12, keyWidth: 4, keyDepth: 1.8 },
    rpm: 12,
    circles: true,
    lineOfAction: true,
    exportWhat: 'pair',
  },
  link: {
    mode: 'fourbar',
    fb: { A: [0, 0], D: [75, 0], crank: 25, coupler: 70, rocker: 55, px: 35, py: 25, branch: 1 },
    sc: { A: [0, 0], crank: 25, rod: 80, offset: 10, side: 1, px: 50, py: 12 },
    speed: 1,
    trace: true,
  },
  cam: {
    segments: defaultSegments(),
    baseRadius: 40,
    follower: 'roller',
    rollerRadius: 8,
    offset: 0,
    bore: { diameter: 12, keyWidth: 4, keyDepth: 1.8 },
    speed: 1,
    showPitch: true,
  },
})

const KEY = 'gear-mechanism-designer:v1'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Deep-merge saved data into defaults, keeping only values of the same primitive type. Arrays replace when their shape fits. */
export function mergeInto<T>(def: T, saved: unknown): T {
  if (typeof def === 'number') return (typeof saved === 'number' && Number.isFinite(saved) ? saved : def) as T
  if (typeof def === 'string' || typeof def === 'boolean') return (typeof saved === typeof def ? saved : def) as T
  if (Array.isArray(def)) {
    if (!Array.isArray(saved)) return def
    if (def.length && typeof def[0] === 'number') return (saved.length === def.length && saved.every((n) => typeof n === 'number' && Number.isFinite(n)) ? saved : def) as T
    return def
  }
  if (isObj(def)) {
    const s = isObj(saved) ? saved : {}
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(def)) out[k] = mergeInto((def as Record<string, unknown>)[k], s[k])
    return out as T
  }
  return def
}

function cleanSegments(v: unknown, fallback: Segment[]): Segment[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 24) return fallback
  const out: Segment[] = []
  for (const s of v) {
    if (!isObj(s) || !LAWS.includes(s.law as never) || typeof s.beta !== 'number' || typeof s.lift !== 'number' || !Number.isFinite(s.beta) || !Number.isFinite(s.lift) || s.beta < 0) return fallback
    out.push({ law: s.law as Segment['law'], beta: s.beta, lift: s.lift })
  }
  return out
}

export function sanitize(saved: unknown): AppState {
  const def = defaultState()
  const m = mergeInto(def, saved)
  const raw = isObj(saved) && isObj(saved.cam) ? saved.cam.segments : undefined
  m.cam.segments = cleanSegments(raw, def.cam.segments)
  if (!['en', 'uk'].includes(m.lang)) m.lang = def.lang
  if (!['auto', 'light', 'dark'].includes(m.theme)) m.theme = 'auto'
  if (!['gears', 'linkage', 'cam'].includes(m.tab)) m.tab = 'gears'
  if (!['external', 'internal', 'rack'].includes(m.gear.mesh)) m.gear.mesh = 'external'
  if (!['module', 'dp'].includes(m.gear.pitchMode)) m.gear.pitchMode = 'module'
  if (!['pair', 'gear1', 'gear2'].includes(m.gear.exportWhat)) m.gear.exportWhat = 'pair'
  if (!['fourbar', 'slider'].includes(m.link.mode)) m.link.mode = 'fourbar'
  if (!['roller', 'flat'].includes(m.cam.follower)) m.cam.follower = 'roller'
  m.link.fb.branch = m.link.fb.branch === -1 ? -1 : 1
  m.link.sc.side = m.link.sc.side === -1 ? -1 : 1
  m.gear.z1 = Math.round(m.gear.z1)
  m.gear.z2 = Math.round(m.gear.z2)
  return m
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? sanitize(JSON.parse(raw)) : defaultState()
  } catch {
    return defaultState()
  }
}

export function saveState(s: AppState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable: ignore */
  }
}
