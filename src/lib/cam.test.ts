import { describe, expect, it } from 'vitest'
import { analyzeCam, closedProfile, defaultSegments, evalCam, LAW_FN, LAWS, normalizeSegments, pressureAngle, totalBeta, type CamSpec, type LawId } from './cam.ts'
import { toDxfR12, validateDxf } from './dxf.ts'

const near = (a: number, b: number, p = 9) => expect(a).toBeCloseTo(b, p)

describe('motion-law boundary conditions', () => {
  const rises: LawId[] = ['cycloidal', 'harmonic', 'constant', 'poly345']
  it('every rise law goes from 0 to 1', () => {
    for (const id of rises) {
      near(LAW_FN[id].s(0), 0)
      near(LAW_FN[id].s(1), 1)
    }
  })
  it('cycloidal and 3-4-5: zero velocity and acceleration at both ends', () => {
    for (const id of ['cycloidal', 'poly345'] as const) {
      near(LAW_FN[id].v(0), 0)
      near(LAW_FN[id].v(1), 0)
      near(LAW_FN[id].a(0), 0)
      near(LAW_FN[id].a(1), 0)
    }
  })
  it('harmonic: zero velocity at the ends but non-zero acceleration', () => {
    near(LAW_FN.harmonic.v(0), 0)
    near(LAW_FN.harmonic.v(1), 0)
    near(LAW_FN.harmonic.a(0), (Math.PI * Math.PI) / 2)
    near(LAW_FN.harmonic.a(1), -(Math.PI * Math.PI) / 2)
  })
  it('constant velocity: unit slope', () => {
    near(LAW_FN.constant.v(0.37), 1)
    near(LAW_FN.constant.a(0.37), 0)
  })
  it('peak values match the textbook coefficients', () => {
    near(Math.max(...Array.from({ length: 2001 }, (_, i) => LAW_FN.cycloidal.v(i / 2000))), 2, 6)
    near(Math.max(...Array.from({ length: 2001 }, (_, i) => LAW_FN.cycloidal.a(i / 2000))), 2 * Math.PI, 3)
    near(LAW_FN.harmonic.v(0.5), Math.PI / 2)
    near(LAW_FN.poly345.v(0.5), 1.875)
    near(Math.max(...Array.from({ length: 2001 }, (_, i) => LAW_FN.poly345.a(i / 2000))), 5.7735, 3)
  })
  it('symmetric: s(t) + s(1-t) = 1', () => {
    for (const id of rises) for (const t of [0.1, 0.3, 0.45]) near(LAW_FN[id].s(t) + LAW_FN[id].s(1 - t), 1)
  })
  it('velocity is the derivative of displacement, acceleration of velocity', () => {
    const h = 1e-6
    for (const id of LAWS) {
      for (const t of [0.2, 0.5, 0.8]) {
        near((LAW_FN[id].s(t + h) - LAW_FN[id].s(t - h)) / (2 * h), LAW_FN[id].v(t), 5)
        near((LAW_FN[id].v(t + h) - LAW_FN[id].v(t - h)) / (2 * h), LAW_FN[id].a(t), 4)
      }
    }
  })
})

describe('segment evaluation', () => {
  const segs = defaultSegments()
  it('total is 360 and the net lift is zero', () => {
    near(totalBeta(segs), 360)
    near(evalCam(segs, 0).y, 0)
  })
  it('hits the lift at the end of the rise and holds it over the dwell', () => {
    near(evalCam(segs, 120).y, 25)
    near(evalCam(segs, 150).y, 25)
    near(evalCam(segs, 180).y, 25)
    near(evalCam(segs, 300).y, 0)
    near(evalCam(segs, 359.9999).y, 0, 3)
  })
  it('is continuous in displacement and (for cycloidal/3-4-5) velocity across joints', () => {
    for (const j of [120, 180, 300]) {
      const a = evalCam(segs, j - 1e-7)
      const b = evalCam(segs, j + 1e-7)
      near(a.y, b.y, 5)
      near(a.v, b.v, 5)
    }
  })
  it('velocity scale: cycloidal peak is 2 h / beta (per radian)', () => {
    let peak = 0
    for (let t = 0; t <= 120; t += 0.05) peak = Math.max(peak, evalCam(segs, t).v)
    near(peak, (2 * 25) / ((120 * Math.PI) / 180), 2)
  })
  it('wraps angles', () => {
    near(evalCam(segs, 480).y, evalCam(segs, 120).y)
  })
  it('normalizes durations and net lift', () => {
    const n = normalizeSegments([
      { law: 'harmonic', beta: 100, lift: 20 },
      { law: 'dwell', beta: 50, lift: 0 },
      { law: 'harmonic', beta: 50, lift: -15 },
    ])
    near(totalBeta(n), 360)
    near(n[0].lift + n[2].lift, 0)
  })
})

const spec = (over: Partial<CamSpec> = {}): CamSpec => ({ segments: defaultSegments(), baseRadius: 40, followerKind: 'roller', rollerRadius: 8, offset: 0, ...over })

describe('cam analysis', () => {
  it('a pure dwell cam is a circle of the base radius', () => {
    const a = analyzeCam(spec({ segments: [{ law: 'dwell', beta: 360, lift: 0 }] }))
    for (const p of a.profile) near(Math.hypot(p[0], p[1]), 40, 6)
    expect(a.maxPressureDeg).toBeCloseTo(0, 6)
  })
  it('flat follower dwell is also the base circle, and the profile reaches Rb + h', () => {
    const a = analyzeCam(spec({ followerKind: 'flat' }))
    const rs = a.profile.map((p) => Math.hypot(p[0], p[1]))
    near(Math.min(...rs), 40, 3)
    expect(Math.max(...rs)).toBeGreaterThan(64.9)
    expect(Math.max(...rs)).toBeLessThan(65.6)
  })
  it('roller profile is one roller radius inside the pitch curve', () => {
    const a = analyzeCam(spec({ offset: 5 }))
    // distance from each profile point to the nearest pitch point is >= ~Rr and equals Rr at contact
    a.profile.forEach((p, i) => near(Math.hypot(p[0] - a.pitch[i][0], p[1] - a.pitch[i][1]), 8, 8))
  })
  it('pressure angle formula tan(phi) = (v - e) / (y + s0)', () => {
    near(Math.tan(pressureAngle(30, 10, 48, 0)), 30 / 58)
    near(Math.tan(pressureAngle(30, 10, 48, 6)), 24 / 58)
    const a = analyzeCam(spec())
    const i = 60 // 60 degrees into the cycloidal rise (360/720 = 0.5 deg per sample -> index 120)
    const smp = a.samples[i * 2]
    near(a.pressure[i * 2], Math.atan2(smp.v, a.s0 + smp.y))
  })
  it('positive offset reduces the rise pressure angle', () => {
    const a0 = analyzeCam(spec({ offset: 0 }))
    const a1 = analyzeCam(spec({ offset: 10 }))
    const rise = (a: ReturnType<typeof analyzeCam>) => Math.max(...a.pressure.slice(0, 240).map(Math.abs))
    expect(rise(a1)).toBeLessThan(rise(a0))
  })
  it('a larger base circle reduces the pressure angle', () => {
    expect(analyzeCam(spec({ baseRadius: 60 })).maxPressureDeg).toBeLessThan(analyzeCam(spec({ baseRadius: 30 })).maxPressureDeg)
  })
  it('flags problems', () => {
    expect(analyzeCam(spec({ baseRadius: 10 })).warnings).toContain('highPressure')
    const sharp = [
      { law: 'harmonic', beta: 30, lift: 40 },
      { law: 'dwell', beta: 150, lift: 0 },
      { law: 'harmonic', beta: 30, lift: -40 },
      { law: 'dwell', beta: 150, lift: 0 },
    ] as const
    expect(analyzeCam(spec({ segments: [...sharp], baseRadius: 15, rollerRadius: 15 })).warnings).toContain('rollerLarge')
    expect(analyzeCam(spec({ segments: [{ law: 'harmonic', beta: 300, lift: 10 }] })).warnings).toEqual(expect.arrayContaining(['badTotal', 'netLift']))
    expect(analyzeCam(spec()).warnings).toEqual([])
  })
  it('the profile is closed (first sample equals last) and exports to valid DXF', () => {
    const a = analyzeCam(spec())
    near(a.profile[0][0], a.profile[a.profile.length - 1][0], 6)
    near(a.profile[0][1], a.profile[a.profile.length - 1][1], 6)
    const pts = closedProfile(a)
    const dxf = toDxfR12([{ type: 'polyline', points: pts, closed: true, layer: 'CAM' }, { type: 'circle', cx: 0, cy: 0, r: 8, layer: 'BORE' }])
    expect(validateDxf(dxf)).toEqual([])
  })
})
