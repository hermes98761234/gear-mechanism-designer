import { useEffect, useMemo, useRef, useState } from 'react'
import {
  animatedAngle, boundsOf, classifyFourBar, dist, fourBarRange, sampleFourBar, sampleSlider, sliderRange, solveFourBar, solveSliderCrank,
  type FourBar, type Range, type SliderCrank, type V,
} from '../lib/linkage.ts'
import type { LinkState } from '../lib/model.ts'
import type { T } from '../i18n.ts'
import NumberField from './NumberField.tsx'
import Plot from './Plot.tsx'
import { prefersReducedMotion, useFrame } from './util.ts'

interface Props {
  l: LinkState
  t: T
  onChange: (l: LinkState) => void
}

const DEGR = Math.PI / 180
type View = { cx: number; cy: number; w: number }
const ASPECT = 0.62
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '-')

interface Geo {
  A: V
  D?: V
  B: V
  C: V
  P: V
  mu: number
}

export default function LinkageTab({ l, t, onChange }: Props) {
  const [theta, setTheta] = useState(0.6)
  const [playing, setPlaying] = useState(() => !prefersReducedMotion())
  const [userView, setUserView] = useState<View | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const phase = useRef(0)
  const panRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const four = l.mode === 'fourbar'
  const fb = l.fb
  const sc = l.sc
  const set = (patch: Partial<LinkState>) => onChange({ ...l, ...patch })
  const setFb = (patch: Partial<FourBar>) => set({ fb: { ...fb, ...patch } })
  const setSc = (patch: Partial<SliderCrank>) => set({ sc: { ...sc, ...patch } })

  const rangeRaw: Range = four ? fourBarRange(fb, theta) : sliderRange(sc, theta)
  const range: Range = useMemo(() => ({ full: rangeRaw.full, start: rangeRaw.start, end: rangeRaw.end }), [rangeRaw.full, rangeRaw.start, rangeRaw.end])
  const samples = useMemo(() => (four ? sampleFourBar(fb, range) : sampleSlider(sc, range)), [four, fb, sc, range])
  const assembled = range.full || range.end > range.start

  // clamp theta into the feasible range
  const thetaC = useMemo(() => {
    if (range.full) return theta
    const tau = 2 * Math.PI
    let th = theta
    while (th < range.start - 1e-9) th += tau
    while (th > range.start + tau) th -= tau
    if (th > range.end) {
      const dEnd = th - range.end
      const dStart = range.start + tau - th
      return dEnd < dStart ? range.end : range.start
    }
    return th
  }, [theta, range])

  const geo: Geo | null = useMemo(() => {
    if (four) {
      const p = solveFourBar(fb, thetaC)
      return p ? { A: fb.A, D: fb.D, B: p.B, C: p.C, P: p.P, mu: p.mu } : null
    }
    const p = solveSliderCrank(sc, thetaC)
    return p ? { A: sc.A, B: p.B, C: p.C, P: p.P, mu: p.mu } : null
  }, [four, fb, sc, thetaC])

  const cls = useMemo(() => classifyFourBar(fb), [fb])
  const mus = samples.map((p) => p.mu)
  const muMin = mus.length ? Math.min(...mus) : NaN
  const muMax = mus.length ? Math.max(...mus) : NaN
  const effMin = four ? Math.min(...mus.map((m) => Math.min(m, Math.PI - m))) : muMin

  const autoView: View = useMemo(() => {
    const pts: V[] = []
    if (four) pts.push(fb.A, fb.D)
    else pts.push(sc.A)
    for (const p of samples) pts.push(p.B, p.C, p.P)
    if (!pts.length) return { cx: 40, cy: 10, w: 160 }
    const b = boundsOf(pts)
    const w = Math.max((b.maxX - b.minX) * 1.3, ((b.maxY - b.minY) * 1.3) / ASPECT, 40)
    return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, w }
  }, [four, fb, sc, samples])
  const view = userView ?? autoView
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  })

  // animation
  const speedRef = useRef(l.speed)
  useEffect(() => {
    speedRef.current = l.speed
  })
  const startPlay = () => {
    const span = range.end - range.start
    phase.current = range.full ? (((thetaC - range.start) / (2 * Math.PI)) % 1 + 1) % 1 : span > 0 ? (thetaC - range.start) / span / 2 : 0
    setPlaying(true)
  }
  useFrame(playing && !drag && assembled, (dt) => {
    phase.current = (phase.current + (dt * speedRef.current) / (range.full ? 5 : 3)) % 1
    setTheta(animatedAngle(range, phase.current))
  })

  const toWorld = (e: { clientX: number; clientY: number }): V | null => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return null
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const q = pt.matrixTransform(ctm.inverse())
    return [q.x, -q.y]
  }

  const onMove = (e: React.PointerEvent) => {
    if (panRef.current) {
      const svg = svgRef.current!
      const r = svg.getBoundingClientRect()
      const k = view.w / r.width
      setUserView({ ...view, cx: panRef.current.cx - (e.clientX - panRef.current.x) * k, cy: panRef.current.cy + (e.clientY - panRef.current.y) * k })
      return
    }
    if (!drag) return
    const p = toWorld(e)
    if (!p || !geo) return
    const q: V = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]
    const minL = 2
    if (four) {
      if (drag === 'A') setFb({ A: q })
      else if (drag === 'D') setFb({ D: q })
      else if (drag === 'B') {
        setFb({ crank: Math.max(minL, dist(fb.A, q)) })
        setTheta(Math.atan2(q[1] - fb.A[1], q[0] - fb.A[0]))
      } else if (drag === 'C') {
        const cross = (fb.D[0] - geo.B[0]) * (q[1] - geo.B[1]) - (fb.D[1] - geo.B[1]) * (q[0] - geo.B[0])
        setFb({ coupler: Math.max(minL, dist(geo.B, q)), rocker: Math.max(minL, dist(fb.D, q)), branch: cross >= 0 ? 1 : -1 })
      } else if (drag === 'P') {
        const len = dist(geo.B, geo.C) || 1
        const ux = (geo.C[0] - geo.B[0]) / len
        const uy = (geo.C[1] - geo.B[1]) / len
        const dx = q[0] - geo.B[0]
        const dy = q[1] - geo.B[1]
        setFb({ px: dx * ux + dy * uy, py: -dx * uy + dy * ux })
      }
    } else {
      if (drag === 'A') setSc({ A: q })
      else if (drag === 'B') {
        setSc({ crank: Math.max(minL, dist(sc.A, q)) })
        setTheta(Math.atan2(q[1] - sc.A[1], q[0] - sc.A[0]))
      } else if (drag === 'C') {
        setSc({ rod: Math.max(minL, dist(geo.B, q)), offset: q[1] - sc.A[1], side: q[0] >= geo.B[0] ? 1 : -1 })
      } else if (drag === 'P') {
        const len = dist(geo.B, geo.C) || 1
        const ux = (geo.C[0] - geo.B[0]) / len
        const uy = (geo.C[1] - geo.B[1]) / len
        const dx = q[0] - geo.B[0]
        const dy = q[1] - geo.B[1]
        setSc({ px: dx * ux + dy * uy, py: -dx * uy + dy * ux })
      }
    }
  }
  const onUp = () => {
    setDrag(null)
    panRef.current = null
  }

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = toWorld(e)
      if (!p) return
      const k = Math.exp(e.deltaY * 0.0012)
      const v = viewRef.current
      setUserView({ cx: p[0] + (v.cx - p[0]) * k, cy: p[1] + (v.cy - p[1]) * k, w: Math.min(5000, Math.max(8, v.w * k)) })
    }
    svg.addEventListener('wheel', wheel, { passive: false })
    return () => svg.removeEventListener('wheel', wheel)
  }, [])

  const H = view.w * ASPECT
  const vb = `${view.cx - view.w / 2} ${-view.cy - H / 2} ${view.w} ${H}`
  const hr = view.w / 70
  const S = (p: V) => ({ x: p[0], y: -p[1] })
  const curve = samples.map((p, i) => `${i ? 'L' : 'M'}${p.P[0].toFixed(2)} ${(-p.P[1]).toFixed(2)}`).join('') + (range.full ? 'Z' : '')

  const handle = (id: string, p: V, cls2: string, label: string) => (
    <circle
      key={id}
      cx={p[0]}
      cy={-p[1]}
      r={hr}
      className={`handle ${cls2}`}
      tabIndex={0}
      role="button"
      aria-label={label}
      onPointerDown={(e) => {
        e.stopPropagation()
        try {
          ;(e.target as Element).setPointerCapture(e.pointerId)
        } catch {
          /* synthetic pointer */
        }
        setUserView(view)
        setDrag(id)
        setPlaying(false)
      }}
    />
  )

  const ground = (p: V) => {
    const q = S(p)
    return <path d={`M${q.x} ${q.y}l${-hr * 1.6} ${hr * 2.6}h${hr * 3.2}Z`} className="ground-sym" />
  }

  const deg = thetaC / DEGR
  const xs = samples.map((p) => p.theta / DEGR)
  const x0 = range.full ? 0 : range.start / DEGR
  const x1 = range.full ? 360 : range.end / DEGR
  const curDeg = range.full ? ((deg % 360) + 360) % 360 : deg

  // slider-crank quick-return
  const qr = useMemo(() => {
    if (four || !range.full || samples.length < 4) return null
    let iMax = 0
    let iMin = 0
    samples.forEach((p, i) => {
      if (p.C[0] > samples[iMax].C[0]) iMax = i
      if (p.C[0] < samples[iMin].C[0]) iMin = i
    })
    const n = samples.length
    const a = ((iMax - iMin + n) % n) / n
    const b = 1 - a
    return a > 0 && b > 0 ? Math.max(a, b) / Math.min(a, b) : null
  }, [four, range.full, samples])
  const stroke = four || !samples.length ? 0 : Math.max(...samples.map((p) => p.C[0])) - Math.min(...samples.map((p) => p.C[0]))

  const kindLabel = {
    'crank-rocker': t('Crank-rocker'),
    'double-crank': t('Double-crank (drag-link)'),
    'double-rocker': t('Double-rocker (Grashof)'),
    'change-point': t('Change-point (s + l = p + q)'),
    'triple-rocker': t('Triple-rocker (non-Grashof)'),
  }[cls.kind]
  const ground0 = dist(fb.A, fb.D)

  const setGround = (len: number) => {
    const d = dist(fb.A, fb.D) || 1
    setFb({ D: [fb.A[0] + ((fb.D[0] - fb.A[0]) * len) / d, fb.A[1] + ((fb.D[1] - fb.A[1]) * len) / d] })
  }

  return (
    <div className="tab">
      <aside className="side">
        <div className="panel">
          <div className="section">
            <h3>{t('Mechanism')}</h3>
            <div className="row">
              <button className={four ? 'active' : ''} aria-pressed={four} onClick={() => { setUserView(null); set({ mode: 'fourbar' }) }}>{t('Four-bar')}</button>
              <button className={!four ? 'active' : ''} aria-pressed={!four} onClick={() => { setUserView(null); set({ mode: 'slider' }) }}>{t('Slider-crank')}</button>
            </div>
          </div>
          {four ? (
            <div className="section">
              <h3>{t('Links')}</h3>
              <div className="grid2">
                <NumberField label={t('Crank AB')} value={+fb.crank.toFixed(3)} min={1} max={2000} onChange={(v) => setFb({ crank: v })} />
                <NumberField label={t('Coupler BC')} value={+fb.coupler.toFixed(3)} min={1} max={2000} onChange={(v) => setFb({ coupler: v })} />
                <NumberField label={t('Rocker DC')} value={+fb.rocker.toFixed(3)} min={1} max={2000} onChange={(v) => setFb({ rocker: v })} />
                <NumberField label={t('Ground AD')} value={+ground0.toFixed(3)} min={1} max={2000} onChange={setGround} />
                <NumberField label={t('Coupler point: along')} value={+fb.px.toFixed(3)} min={-2000} max={2000} onChange={(v) => setFb({ px: v })} />
                <NumberField label={t('Coupler point: offset')} value={+fb.py.toFixed(3)} min={-2000} max={2000} onChange={(v) => setFb({ py: v })} />
              </div>
              <div className="row">
                <button onClick={() => setFb({ branch: fb.branch === 1 ? -1 : 1 })}>{t('Flip assembly')}</button>
              </div>
            </div>
          ) : (
            <div className="section">
              <h3>{t('Links')}</h3>
              <div className="grid2">
                <NumberField label={t('Crank r')} value={+sc.crank.toFixed(3)} min={1} max={2000} onChange={(v) => setSc({ crank: v })} />
                <NumberField label={t('Connecting rod l')} value={+sc.rod.toFixed(3)} min={1} max={2000} onChange={(v) => setSc({ rod: v })} />
                <NumberField label={t('Slider offset e')} value={+sc.offset.toFixed(3)} min={-2000} max={2000} onChange={(v) => setSc({ offset: v })} />
                <NumberField label={t('Rod point: along')} value={+sc.px.toFixed(3)} min={-2000} max={2000} onChange={(v) => setSc({ px: v })} />
                <NumberField label={t('Rod point: offset')} value={+sc.py.toFixed(3)} min={-2000} max={2000} onChange={(v) => setSc({ py: v })} />
              </div>
              <div className="row">
                <button onClick={() => setSc({ side: sc.side === 1 ? -1 : 1 })}>{t('Flip assembly')}</button>
              </div>
            </div>
          )}
          <div className="section">
            <h3>{t('Display')}</h3>
            <label className="check"><input type="checkbox" checked={l.trace} onChange={(e) => set({ trace: e.target.checked })} /> {t('Trace the coupler curve')}</label>
            <div className="row">
              <button onClick={() => setUserView(null)}>{t('Fit view')}</button>
            </div>
            <p className="hint">{t('Drag the pivots (A, B, C, D) and the coupler point P. Scroll to zoom, drag the background to pan.')}</p>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="box">
          <div className="row">
            <button onClick={() => (playing ? setPlaying(false) : startPlay())} aria-pressed={playing}>{playing ? t('Pause') : t('Play')}</button>
            <label className="inline">
              {t('Speed')} <input type="range" min={0.2} max={4} step={0.1} value={l.speed} onChange={(e) => set({ speed: +e.target.value })} aria-label={t('Speed')} /> ×{l.speed.toFixed(1)}
            </label>
            <label className="inline">
              {t('Crank angle')}
              <input
                type="range"
                min={x0}
                max={x1}
                step={0.5}
                value={Math.min(x1, Math.max(x0, curDeg))}
                aria-label={t('Crank angle')}
                onChange={(e) => {
                  setPlaying(false)
                  setTheta(+e.target.value * DEGR)
                }}
              />
              {f1(curDeg)}°
            </label>
          </div>
          <svg
            ref={svgRef}
            className="stage link-svg"
            viewBox={vb}
            role="img"
            aria-label={t('Linkage animation')}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerDown={(e) => {
              setUserView(view)
              panRef.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy }
              try {
                ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
              } catch {
                /* synthetic pointer */
              }
            }}
          >
            {l.trace && samples.length > 1 && <path d={curve} className="trace" vectorEffect="non-scaling-stroke" />}
            {!four && <line x1={view.cx - view.w} x2={view.cx + view.w} y1={-(sc.A[1] + sc.offset)} y2={-(sc.A[1] + sc.offset)} className="slide-axis" vectorEffect="non-scaling-stroke" />}
            {four && <line x1={S(fb.A).x} y1={S(fb.A).y} x2={S(fb.D).x} y2={S(fb.D).y} className="link ground-link" vectorEffect="non-scaling-stroke" />}
            {geo && (
              <>
                <line x1={S(geo.A).x} y1={S(geo.A).y} x2={S(geo.B).x} y2={S(geo.B).y} className="link crank" vectorEffect="non-scaling-stroke" />
                <path d={`M${S(geo.B).x} ${S(geo.B).y}L${S(geo.P).x} ${S(geo.P).y}L${S(geo.C).x} ${S(geo.C).y}`} className="link coupler" vectorEffect="non-scaling-stroke" fill="none" />
                {four && geo.D && <line x1={S(geo.D).x} y1={S(geo.D).y} x2={S(geo.C).x} y2={S(geo.C).y} className="link rocker" vectorEffect="non-scaling-stroke" />}
                {!four && <rect x={geo.C[0] - hr * 2.2} y={-geo.C[1] - hr * 1.3} width={hr * 4.4} height={hr * 2.6} className="slider-block" />}
              </>
            )}
            {ground(four ? fb.A : sc.A)}
            {four && ground(fb.D)}
            {geo && (
              <>
                {handle('P', geo.P, 'hp', t('Coupler point P'))}
                {handle('B', geo.B, 'hb', t('Pivot B'))}
                {handle('C', geo.C, 'hc', t('Pivot C'))}
                <text x={geo.B[0] + hr * 1.4} y={-geo.B[1] - hr * 1.4} className="lbl" fontSize={hr * 2}>B</text>
                <text x={geo.C[0] + hr * 1.4} y={-geo.C[1] - hr * 1.4} className="lbl" fontSize={hr * 2}>C</text>
                <text x={geo.P[0] + hr * 1.4} y={-geo.P[1] - hr * 1.4} className="lbl" fontSize={hr * 2}>P</text>
              </>
            )}
            {handle('A', four ? fb.A : sc.A, 'hg', t('Pivot A'))}
            {four && handle('D', fb.D, 'hg', t('Pivot D'))}
            <text x={(four ? fb.A[0] : sc.A[0]) - hr * 3} y={-(four ? fb.A[1] : sc.A[1]) - hr * 1.4} className="lbl" fontSize={hr * 2}>A</text>
            {four && <text x={fb.D[0] + hr * 1.4} y={-fb.D[1] - hr * 1.4} className="lbl" fontSize={hr * 2}>D</text>}
          </svg>
          {!geo && <p className="err-text" role="alert">{t('The linkage cannot close in this position. Change a link length or the pivots.')}</p>}
        </div>
        <div className="box">
          <h3>{t('Analysis')}</h3>
          <div className="stats">
            {four && (
              <>
                <div><span>{t('Type')}</span><b className={cls.grashof ? 'ok-text' : 'warn-text'}>{kindLabel}</b></div>
                <div><span>{t('Grashof')}</span><b>{cls.grashof ? t('Yes') : t('No')} (s + l {cls.margin <= 0 ? '≤' : '>'} p + q)</b></div>
                <div><span>{t('Shortest link')}</span><b>{t({ ground: 'Ground', crank: 'Crank', coupler: 'Coupler', rocker: 'Rocker' }[cls.shortest])}</b></div>
              </>
            )}
            {!four && (
              <>
                <div><span>{t('Crank rotates fully')}</span><b className={range.full ? 'ok-text' : 'warn-text'}>{range.full ? t('Yes') : t('No')}</b></div>
                <div><span>{t('Stroke')}</span><b>{f1(stroke)}</b></div>
                <div><span>{t('Quick-return ratio')}</span><b>{qr ? qr.toFixed(3) : '-'}</b></div>
              </>
            )}
            <div><span>{t('Input range')}</span><b>{range.full ? t('360° (full turn)') : `${f1(range.start / DEGR)}° … ${f1(range.end / DEGR)}°`}</b></div>
            <div><span>{t('Transmission angle now')}</span><b>{geo ? f1(geo.mu / DEGR) + '°' : '-'}</b></div>
            <div><span>{t('Transmission angle min / max')}</span><b>{f1(muMin / DEGR)}° / {f1(muMax / DEGR)}°</b></div>
            <div><span>{t('Smallest effective transmission angle')}</span><b className={effMin / DEGR < 40 ? 'warn-text' : 'ok-text'}>{f1(effMin / DEGR)}°</b></div>
          </div>
        </div>
        <div className="box">
          <Plot
            title={t('Transmission angle')}
            xLabel={t('Crank angle (°)')}
            yLabel={t('μ (°)')}
            series={[{ x: xs, y: mus.map((m) => m / DEGR), color: 'var(--accent)' }]}
            xDomain={[x0, x1]}
            yDomain={four ? [0, 180] : [0, 90]}
            band={four ? [40, 140] : [40, 90]}
            hLines={four ? [{ y: 90, label: '90°' }] : [{ y: 40, label: '40°' }]}
            cursor={range.full ? curDeg : deg}
            cursorY={geo ? geo.mu / DEGR : undefined}
          />
          <p className="hint">{t('Shaded band: transmission angle between 40° and 140° (four-bar) or above 40° (slider-crank) is considered good.')}</p>
        </div>
      </main>
    </div>
  )
}
