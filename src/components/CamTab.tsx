import { useMemo, useState } from 'react'
import { analyzeCam, closedProfile, LAWS, netLift, normalizeSegments, totalBeta, type CamSpec, type CamWarning, type LawId, type Segment } from '../lib/cam.ts'
import { toDxfR12, type DxfEntity } from '../lib/dxf.ts'
import { borePolyline } from '../lib/involute.ts'
import type { CamState } from '../lib/model.ts'
import { toSvg } from '../lib/svg.ts'
import type { T } from '../i18n.ts'
import NumberField from './NumberField.tsx'
import Plot from './Plot.tsx'
import { download, prefersReducedMotion, toPath, useFrame } from './util.ts'

interface Props {
  c: CamState
  t: T
  onChange: (c: CamState) => void
}

const DEGR = Math.PI / 180
const LAW_NAME: Record<LawId, string> = {
  dwell: 'Dwell',
  cycloidal: 'Cycloidal',
  harmonic: 'Harmonic',
  constant: 'Constant velocity',
  poly345: '3-4-5 polynomial',
}

function warnText(w: CamWarning, t: T): string {
  switch (w) {
    case 'badTotal': return t('Segment durations must add up to 360°.')
    case 'netLift': return t('The follower does not return to its start: the net lift is not zero.')
    case 'highPressure': return t('Pressure angle above 30°: enlarge the base circle, add offset or soften the motion.')
    case 'rollerLarge': return t('The roller is larger than the smallest convex radius of the pitch curve: the profile will be undercut.')
    case 'flatConcave': return t('The flat-faced profile turns concave: enlarge the base circle or soften the motion.')
    case 'offsetLarge': return t('The offset is larger than the prime circle.')
  }
}

export default function CamTab({ c, t, onChange }: Props) {
  const [theta, setTheta] = useState(0)
  const [playing, setPlaying] = useState(() => !prefersReducedMotion())
  const set = (patch: Partial<CamState>) => onChange({ ...c, ...patch })
  const roller = c.follower === 'roller'

  const spec: CamSpec = useMemo(
    () => ({ segments: c.segments, baseRadius: c.baseRadius, followerKind: c.follower, rollerRadius: c.rollerRadius, offset: c.offset }),
    [c.segments, c.baseRadius, c.follower, c.rollerRadius, c.offset],
  )
  const total = totalBeta(c.segments)
  const valid = c.segments.length > 0 && total > 0 && c.baseRadius > 0 && (!roller || c.rollerRadius >= 0)
  const an = useMemo(() => (valid ? analyzeCam(spec, 720) : null), [spec, valid])

  useFrame(playing && valid, (dt) => setTheta((th) => (th + dt * 60 * c.speed) % 360))

  const setSeg = (i: number, patch: Partial<Segment>) => set({ segments: c.segments.map((s, k) => (k === i ? { ...s, ...patch } : s)) })
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= c.segments.length) return
    const next = [...c.segments]
    ;[next[i], next[j]] = [next[j], next[i]]
    set({ segments: next })
  }

  const profilePath = useMemo(() => (an ? toPath(an.profile, true) : ''), [an])
  const pitchPath = useMemo(() => (an && roller ? toPath(an.pitch, true) : ''), [an, roller])
  const borePath = useMemo(() => toPath(borePolyline(c.bore), true), [c.bore])

  const idx = an ? Math.min(an.samples.length - 1, Math.round(((((theta / 360) * total) % total) / total) * (an.samples.length - 1))) : 0
  const cur = an?.samples[idx]
  const curPressure = an ? (an.pressure[idx] ?? 0) / DEGR : 0

  const view = useMemo(() => {
    if (!an) return { x: -50, y: -50, w: 100, h: 100 }
    const rmax = Math.max(...an.profile.map((p) => Math.hypot(p[0], p[1])), ...an.pitch.map((p) => Math.hypot(p[0], p[1])))
    const top = an.s0 + Math.max(...an.samples.map((s) => s.y)) + (roller ? c.rollerRadius : 0) + 0.25 * rmax
    const flat = c.follower === 'flat' ? an.flatHalfWidth * 1.2 + 4 : 0
    const half = Math.max(rmax * 1.08, c.offset + c.rollerRadius * 2, flat)
    const bottom = -rmax * 1.08
    const h = top - bottom
    const w = Math.max(2 * half, h * 1.25)
    return { x: -w / 2, y: -top, w, h }
  }, [an, roller, c.rollerRadius, c.offset, c.follower])

  const entities = (): DxfEntity[] => {
    if (!an) return []
    const out: DxfEntity[] = [{ type: 'polyline', points: closedProfile(an), closed: true, layer: 'CAM_PROFILE' }]
    if (c.bore.diameter > 0) {
      if (c.bore.keyWidth > 0 && c.bore.keyDepth > 0) out.push({ type: 'polyline', points: borePolyline(c.bore), closed: true, layer: 'CAM_BORE' })
      else out.push({ type: 'circle', cx: 0, cy: 0, r: c.bore.diameter / 2, layer: 'CAM_BORE' })
    }
    out.push({ type: 'circle', cx: 0, cy: 0, r: c.baseRadius, layer: 'CAM_BASE' })
    if (roller) out.push({ type: 'polyline', points: an.pitch.slice(0, -1), closed: true, layer: 'CAM_PITCH' })
    return out
  }
  const exportDxf = () => download(`cam-${c.follower}-Rb${+c.baseRadius.toFixed(2)}.dxf`, toDxfR12(entities()), 'application/dxf')
  const exportSvg = () => download(`cam-${c.follower}-Rb${+c.baseRadius.toFixed(2)}.svg`, toSvg(entities()), 'image/svg+xml')

  // follower geometry (world, y up)
  const e = roller ? c.offset : 0
  const fy = an && cur ? an.s0 + cur.y : 0
  const bounds: number[] = []
  {
    let acc = 0
    for (const s of c.segments.slice(0, -1)) {
      acc += s.beta
      bounds.push(acc * (360 / (total || 360)))
    }
  }
  const xs = an ? an.samples.map((s) => s.theta * (360 / total)) : []
  const vK = an ? 360 / total : 1
  const curDeg = ((theta % 360) + 360) % 360

  const seriesOf = (pick: (s: { y: number; v: number; a: number }) => number, color: string) => ({ x: xs, y: an ? an.samples.map((s) => pick({ y: s.y, v: s.v / vK, a: s.a / (vK * vK) })) : [], color })
  const yNow = cur?.y ?? 0
  const vNow = (cur?.v ?? 0) / vK
  const aNow = (cur?.a ?? 0) / (vK * vK)

  const warnings = an ? an.warnings.map((w) => warnText(w, t)) : []

  return (
    <div className="tab">
      <aside className="side">
        <div className="panel">
          <div className="section">
            <h3>{t('Follower')}</h3>
            <div className="row">
              <button className={roller ? 'active' : ''} aria-pressed={roller} onClick={() => set({ follower: 'roller' })}>{t('Roller')}</button>
              <button className={!roller ? 'active' : ''} aria-pressed={!roller} onClick={() => set({ follower: 'flat' })}>{t('Flat face')}</button>
            </div>
            <div className="grid2">
              <NumberField label={t('Base circle radius')} suffix="mm" value={c.baseRadius} min={1} max={2000} onChange={(v) => set({ baseRadius: v })} />
              {roller && <NumberField label={t('Roller radius')} suffix="mm" value={c.rollerRadius} min={0} max={500} onChange={(v) => set({ rollerRadius: v })} />}
              {roller && <NumberField label={t('Follower offset')} suffix="mm" value={c.offset} min={-1000} max={1000} title={t('Positive offset reduces the pressure angle on the rise (cam turning counter-clockwise)')} onChange={(v) => set({ offset: v })} />}
            </div>
          </div>
          <div className="section">
            <h3>{t('Motion segments')}</h3>
            {c.segments.map((s, i) => (
              <div className="seg" key={i}>
                <span className="seg-n">{i + 1}</span>
                <select aria-label={t('Motion law')} value={s.law} onChange={(e) => setSeg(i, { law: e.target.value as LawId })}>
                  {LAWS.map((l) => <option key={l} value={l}>{t(LAW_NAME[l])}</option>)}
                </select>
                <NumberField compact label={t('Duration (°)')} suffix="°" value={s.beta} min={0.1} max={720} onChange={(v) => setSeg(i, { beta: v })} />
                <NumberField compact label={t('Lift (mm)')} value={s.law === 'dwell' ? 0 : s.lift} min={-2000} max={2000} onChange={(v) => setSeg(i, { lift: v })} />
                <button className="small" aria-label={t('Move up')} onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button className="small" aria-label={t('Move down')} onClick={() => move(i, 1)} disabled={i === c.segments.length - 1}>↓</button>
                <button className="small danger" aria-label={t('Remove')} onClick={() => set({ segments: c.segments.filter((_, k) => k !== i) })} disabled={c.segments.length <= 1}>✕</button>
              </div>
            ))}
            <p className="seg-head">{t('Each row: law, duration in degrees, lift in mm (negative = return).')}</p>
            <div className="row">
              <button onClick={() => set({ segments: [...c.segments, { law: 'cycloidal', beta: 30, lift: 10 }] })}>{t('Add segment')}</button>
              <button onClick={() => set({ segments: normalizeSegments(c.segments) })}>{t('Fix totals')}</button>
            </div>
            <p className={`hint ${Math.abs(total - 360) > 1e-6 || Math.abs(netLift(c.segments)) > 1e-6 ? 'warn-text' : ''}`}>
              {t('Total {0}° (need 360°), net lift {1} mm', +total.toFixed(2), +netLift(c.segments).toFixed(3))}
            </p>
          </div>
          <div className="section">
            <h3>{t('Hub')}</h3>
            <div className="grid3">
              <NumberField label={t('Bore Ø')} suffix="mm" value={c.bore.diameter} min={0} max={2000} onChange={(v) => set({ bore: { ...c.bore, diameter: v } })} />
              <NumberField label={t('Keyway width')} suffix="mm" value={c.bore.keyWidth} min={0} max={500} onChange={(v) => set({ bore: { ...c.bore, keyWidth: v } })} />
              <NumberField label={t('Keyway depth')} suffix="mm" value={c.bore.keyDepth} min={0} max={200} onChange={(v) => set({ bore: { ...c.bore, keyDepth: v } })} />
            </div>
          </div>
          <div className="section">
            <h3>{t('Export')}</h3>
            <div className="row">
              <button onClick={exportDxf} disabled={!an}>{t('Download DXF (R12)')}</button>
              <button onClick={exportSvg} disabled={!an}>{t('Download SVG')}</button>
            </div>
            <p className="hint">{t('Cam profile as a closed polyline in millimetres, with bore, base circle and pitch curve on separate layers.')}</p>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="box">
          <div className="row">
            <button onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>{playing ? t('Pause') : t('Play')}</button>
            <label className="inline">
              {t('Speed')} <input type="range" min={0.1} max={4} step={0.1} value={c.speed} onChange={(e) => set({ speed: +e.target.value })} aria-label={t('Speed')} /> ×{c.speed.toFixed(1)}
            </label>
            <label className="inline">
              {t('Cam angle')}
              <input type="range" min={0} max={360} step={0.5} value={curDeg} aria-label={t('Cam angle')} onChange={(ev) => { setPlaying(false); setTheta(+ev.target.value) }} />
              {curDeg.toFixed(1)}°
            </label>
            <label className="check"><input type="checkbox" checked={c.showPitch} onChange={(ev) => set({ showPitch: ev.target.checked })} /> {t('Pitch curve')}</label>
          </div>
          <svg className="stage cam-svg" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} role="img" aria-label={t('Cam and follower animation')}>
            {an && (
              <>
                <g transform={`rotate(${-theta})`}>
                  <path d={profilePath + (c.bore.diameter > 0 ? borePath : '')} fillRule="evenodd" className="gear g1" />
                  {roller && c.showPitch && <path d={pitchPath} className="c-pitch" fill="none" />}
                  <circle r={c.baseRadius} className="c-base" fill="none" />
                  <line x1="-4" x2="4" y1="0" y2="0" className="c-pitch" />
                  <line y1="-4" y2="4" x1="0" x2="0" className="c-pitch" />
                </g>
                {/* follower */}
                {roller ? (
                  <g>
                    <line x1={e} x2={e} y1={-fy} y2={-(fy + view.h)} className="stem" />
                    <circle cx={e} cy={-fy} r={c.rollerRadius} className="roller" />
                    <circle cx={e} cy={-fy} r={Math.max(0.6, view.w / 200)} className="pin" />
                    <line
                      x1={e}
                      y1={-fy}
                      x2={e - (c.rollerRadius + view.w * 0.06) * ((e - vNow) / Math.hypot(vNow - e, an.s0 + yNow || 1))}
                      y2={-fy + (c.rollerRadius + view.w * 0.06) * ((an.s0 + yNow) / Math.hypot(vNow - e, an.s0 + yNow || 1))}
                      className="c-loa"
                    />
                  </g>
                ) : (
                  <g>
                    <line x1={0} x2={0} y1={-fy} y2={-(fy + view.h)} className="stem" />
                    <line x1={-an.flatHalfWidth * 1.2 - 4} x2={an.flatHalfWidth * 1.2 + 4} y1={-fy} y2={-fy} className="stem flat-face" />
                    <circle cx={vNow} cy={-fy} r={Math.max(0.8, view.w / 150)} className="pin" />
                  </g>
                )}
                <line x1={roller ? e : 0} x2={roller ? e : 0} y1={view.y} y2={0} className="c-root" />
              </>
            )}
          </svg>
          {an && (
            <div className="stats">
              <div><span>{t('Displacement')}</span><b>{yNow.toFixed(2)} mm</b></div>
              <div><span>{t('Velocity')}</span><b>{vNow.toFixed(2)} mm/rad</b></div>
              <div><span>{t('Acceleration')}</span><b>{aNow.toFixed(1)} mm/rad²</b></div>
              {roller && <div><span>{t('Pressure angle now')}</span><b>{curPressure.toFixed(1)}°</b></div>}
              {roller && <div><span>{t('Max pressure angle')}</span><b className={an.maxPressureDeg > 30 ? 'warn-text' : 'ok-text'}>{an.maxPressureDeg.toFixed(1)}°</b></div>}
              {!roller && <div><span>{t('Minimum face half-width')}</span><b>{an.flatHalfWidth.toFixed(2)} mm</b></div>}
              <div><span>{t('Min. convex radius')}</span><b>{Number.isFinite(an.minCurvatureRadius) ? an.minCurvatureRadius.toFixed(1) + ' mm' : '-'}</b></div>
              <div><span>{t('Total lift')}</span><b>{(Math.max(...an.samples.map((s) => s.y)) - Math.min(...an.samples.map((s) => s.y))).toFixed(2)} mm</b></div>
            </div>
          )}
          {warnings.length > 0 && (
            <ul className="warns" role="status">{warnings.map((w, i) => <li key={i} className="warn-text">{w}</li>)}</ul>
          )}
        </div>
        {an && (
          <div className="box plots">
            <Plot title={t('Displacement (mm)')} xLabel={t('Cam angle (°)')} yLabel="y" series={[seriesOf((s) => s.y, 'var(--accent)')]} xDomain={[0, 360]} xTicks={[0, 60, 120, 180, 240, 300, 360]} vLines={bounds} cursor={curDeg} cursorY={yNow} />
            <Plot title={t('Velocity (mm/rad)')} xLabel={t('Cam angle (°)')} yLabel="dy/dθ" series={[seriesOf((s) => s.v, 'var(--ok)')]} xDomain={[0, 360]} xTicks={[0, 60, 120, 180, 240, 300, 360]} vLines={bounds} cursor={curDeg} cursorY={vNow} />
            <Plot title={t('Acceleration (mm/rad²)')} xLabel={t('Cam angle (°)')} yLabel="d²y/dθ²" series={[seriesOf((s) => s.a, 'var(--err)')]} xDomain={[0, 360]} xTicks={[0, 60, 120, 180, 240, 300, 360]} vLines={bounds} cursor={curDeg} cursorY={aNow} />
            {roller ? (
              <Plot
                title={t('Pressure angle (°)')}
                xLabel={t('Cam angle (°)')}
                yLabel="φ"
                series={[{ x: xs, y: an.pressure.map((p) => p / DEGR), color: 'var(--warn)' }]}
                xDomain={[0, 360]}
                xTicks={[0, 60, 120, 180, 240, 300, 360]}
                hLines={[{ y: 30, label: '30°' }, { y: -30 }]}
                vLines={bounds}
                cursor={curDeg}
                cursorY={curPressure}
              />
            ) : (
              <p className="hint">{t('A flat-faced follower has a pressure angle of 0° at every position.')}</p>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
