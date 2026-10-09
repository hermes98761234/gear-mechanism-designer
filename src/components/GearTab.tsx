import { useMemo, useState } from 'react'
import { assemble } from '../lib/assembly.ts'
import { toDxfR12, type DxfEntity } from '../lib/dxf.ts'
import { gearEntities, rackEntity } from '../lib/gearEntities.ts'
import {
  boreFits, borePolyline, DEG, defaultSpec, dpFromModule, gearWarnings, moduleFromDP, pairWarnings, radii, toothThicknessAt, toothThicknessPitch,
  type GearSpec, type Warning,
} from '../lib/involute.ts'
import type { GearState } from '../lib/model.ts'
import { gearOutline, rackOutline, type Pt } from '../lib/profile.ts'
import { toSvg } from '../lib/svg.ts'
import type { T } from '../i18n.ts'
import NumberField from './NumberField.tsx'
import { download, prefersReducedMotion, toPath, useFrame } from './util.ts'

interface Props {
  g: GearState
  t: T
  onChange: (g: GearState) => void
}

const f2 = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '-')

function warnText(w: Warning, who: string, t: T): string {
  switch (w.id) {
    case 'undercut': return t('{0}: undercut, add profile shift of at least {1}', who, f2(w.xMin, 2))
    case 'pointed': return t('{0}: pointed tooth (tip thickness {1} mm), reduce the profile shift', who, f2(w.thickness, 2))
    case 'fewTeeth': return t('{0}: too few teeth', who)
    case 'boreTooLarge': return t('{0}: bore and keyway are too large for the root circle', who)
    case 'smallRing': return t('Ring gear: tip interference is likely when the tooth difference is below {0}', f2(w.zDiff, 0))
    case 'ringTipInterference': return t('Ring gear: the pinion tips may interfere with the ring')
    case 'lowContact': return t('Contact ratio {0} is low (aim for 1.2 or more)', f2(w.eps, 2))
    case 'noMesh': return t('Contact ratio below 1: the gears will not mesh continuously')
  }
}

export default function GearTab({ g, t, onChange }: Props) {
  const [playing, setPlaying] = useState(() => !prefersReducedMotion())
  const [theta, setTheta] = useState(0)
  const set = (patch: Partial<GearState>) => onChange({ ...g, ...patch })

  const m = g.pitchMode === 'dp' ? moduleFromDP(g.dp) : g.module
  const alpha = g.alphaDeg * DEG
  const internal = g.mesh === 'internal'
  const rack = g.mesh === 'rack'
  const fillet = g.filletCoef * m
  const spec1: GearSpec = useMemo(() => defaultSpec({ m, z: g.z1, alpha, x: g.x1, backlash: g.backlash, fillet }), [m, g.z1, alpha, g.x1, g.backlash, fillet])
  const spec2: GearSpec = useMemo(
    () => defaultSpec({ m, z: g.z2, alpha, x: g.x2, backlash: g.backlash, fillet, kind: internal ? 'internal' : 'external' }),
    [m, g.z2, alpha, g.x2, g.backlash, fillet, internal],
  )
  const ringOk = !internal || g.z2 >= g.z1 + 4
  const outline1 = useMemo(() => gearOutline(spec1), [spec1])
  const outline2 = useMemo(() => (rack || !ringOk ? [] : gearOutline(spec2)), [spec2, rack, ringOk])

  const asm = useMemo(() => (ringOk ? assemble(g.mesh, spec1, spec2, g.bore1, g.bore2, theta) : null), [g.mesh, spec1, spec2, g.bore1, g.bore2, theta, ringOk])
  const asm0 = useMemo(() => (ringOk ? assemble(g.mesh, spec1, spec2, g.bore1, g.bore2, 0) : null), [g.mesh, spec1, spec2, g.bore1, g.bore2, ringOk])

  useFrame(playing && ringOk, (dt) => setTheta((th) => (th + dt * g.rpm * 2 * Math.PI / 60) % (2 * Math.PI * 360)))

  const r1 = radii(spec1)
  const r2 = radii(spec2)
  const warnings: string[] = []
  warnings.push(...gearWarnings(spec1).map((w) => warnText(w, t('Gear 1'), t)))
  if (!rack) warnings.push(...gearWarnings(spec2).map((w) => warnText(w, internal ? t('Ring gear') : t('Gear 2'), t)))
  if (!boreFits(spec1, g.bore1)) warnings.push(warnText({ id: 'boreTooLarge' }, t('Gear 1'), t))
  if (!rack && !internal && !boreFits(spec2, g.bore2)) warnings.push(warnText({ id: 'boreTooLarge' }, t('Gear 2'), t))
  if (internal && ringOk) {
    const dz = g.z2 - g.z1
    if (dz < 8) warnings.push(warnText({ id: 'smallRing', zDiff: 8 }, '', t))
  }
  if (asm) warnings.push(...pairWarnings(asm.pair).map((w) => warnText(w, '', t)))
  if (!ringOk) warnings.unshift(t('The ring gear needs at least 4 more teeth than the pinion.'))

  // View box
  const view = useMemo(() => {
    if (!asm0) return { x: -30, y: -30, w: 60, h: 60 }
    const pts: Pt[] = []
    const add = (cx: number, cy: number, r: number) => pts.push([cx - r, cy - r], [cx + r, cy + r])
    add(0, 0, r1.addendum)
    if (asm0.gear2) {
      if (internal) add(asm0.gear2.cx, 0, r2.root + Math.max(3 * m, 4))
      else add(asm0.gear2.cx, 0, r2.addendum)
    }
    if (asm0.rack) {
      const half = r1.addendum * 1.15
      pts.push([-half, asm0.rack.y0 - (1.25 + 2.5) * m], [half, asm0.rack.y0 + m])
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
    const pad = Math.max(maxX - minX, maxY - minY) * 0.04 + m
    return { x: minX - pad, y: -maxY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad }
  }, [asm0, r1.addendum, r2.addendum, r2.root, internal, m])

  const path1 = useMemo(() => toPath(outline1, true), [outline1])
  const path2 = useMemo(() => toPath(outline2, true), [outline2])
  const bore1 = useMemo(() => toPath(borePolyline(g.bore1), true), [g.bore1])
  const bore2 = useMemo(() => toPath(borePolyline(g.bore2), true), [g.bore2])
  const rackPath = useMemo(() => {
    if (!asm0?.rack) return ''
    const half = r1.addendum * 1.6 + m * 2
    const p = Math.PI * m
    const off = ((asm?.rack?.offset ?? 0) % p + p) % p
    const teeth = rackOutline({ m, alpha, ha: 1, c: 0.25, backlash: g.backlash }, -half, half, off)
    const bottom = -(1.25 + 2.5) * m
    const pts: Pt[] = [[teeth[0][0], bottom], ...teeth, [teeth[teeth.length - 1][0], bottom]]
    return toPath(pts.map((q): Pt => [q[0], q[1] + asm0.rack!.y0]), true)
  }, [asm0, asm, r1.addendum, m, alpha, g.backlash])

  const pair = asm?.pair
  const deg = (rad: number) => (-rad / DEG).toFixed(3)

  const loa = useMemo(() => {
    if (!pair || !asm0) return null
    const aw = pair.alphaW
    const rb1 = r1.base
    if (rack) {
      const T1: Pt = [rb1 * Math.cos(aw - Math.PI / 2), rb1 * Math.sin(aw - Math.PI / 2)]
      const len = ((1 - spec1.x) * m) / Math.sin(aw) * 1.0
      const Pp: Pt = [0, -r1.pitch]
      const d: Pt = [-Math.cos(aw), -Math.sin(aw)]
      return [T1, [Pp[0] + d[0] * len, Pp[1] + d[1] * len]] as [Pt, Pt]
    }
    const T1: Pt = [rb1 * Math.cos(aw), rb1 * Math.sin(aw)]
    const T2: Pt = internal ? [-pair.a + r2.base * Math.cos(aw), r2.base * Math.sin(aw)] : [pair.a - r2.base * Math.cos(aw), -r2.base * Math.sin(aw)]
    return [T1, T2] as [Pt, Pt]
  }, [pair, asm0, r1.base, r1.pitch, r2.base, rack, internal, spec1.x, m])

  const entitiesFor = (what: GearState['exportWhat']): DxfEntity[] => {
    if (!asm0) return []
    const out: DxfEntity[] = []
    const single = (p: typeof asm0.gear1, ring: boolean): DxfEntity[] => {
      const e = gearEntities({ ...p, cx: what === 'pair' ? p.cx : 0, cy: what === 'pair' ? p.cy : 0, rotation: what === 'pair' ? p.rotation : 0 }, { reference: true })
      if (ring) e.push({ type: 'circle', cx: what === 'pair' ? p.cx : 0, cy: 0, r: radii(p.spec).root + Math.max(3 * m, 4), layer: p.layer })
      return e
    }
    if (what !== 'gear2') out.push(...single(asm0.gear1, false))
    if (asm0.gear2 && what !== 'gear1') out.push(...single(asm0.gear2, internal))
    if (what === 'pair' && asm0.rack) {
      out.push(rackEntity(m, alpha, 1, 0.25, g.backlash, asm0.rack.offset, asm0.rack.y0, r1.addendum * 3, 'RACK'))
    }
    return out
  }
  const nameFor = (what: GearState['exportWhat']) => `gear-${what}-m${+m.toFixed(3)}-z${what === 'gear2' ? g.z2 : g.z1}`
  const exportDxf = () => download(nameFor(g.exportWhat) + '.dxf', toDxfR12(entitiesFor(g.exportWhat)), 'application/dxf')
  const exportSvg = () => download(nameFor(g.exportWhat) + '.svg', toSvg(entitiesFor(g.exportWhat)), 'image/svg+xml')

  const boreFields = (b: GearState['bore1'], key: 'bore1' | 'bore2') => (
    <div className="grid3">
      <NumberField label={t('Bore Ø')} suffix="mm" value={b.diameter} min={0} max={2000} onChange={(v) => set({ [key]: { ...b, diameter: v } })} />
      <NumberField label={t('Keyway width')} suffix="mm" value={b.keyWidth} min={0} max={500} onChange={(v) => set({ [key]: { ...b, keyWidth: v } })} />
      <NumberField label={t('Keyway depth')} suffix="mm" value={b.keyDepth} min={0} max={200} onChange={(v) => set({ [key]: { ...b, keyDepth: v } })} />
    </div>
  )

  const gearRows = (s: GearSpec, label: string) => {
    const r = radii(s)
    const tipR = Math.max(r.addendum, r.base)
    return (
      <tr key={label}>
        <td>{label}</td>
        <td>{f2(2 * r.pitch, 2)}</td>
        <td>{f2(2 * r.base, 2)}</td>
        <td>{f2(2 * r.addendum, 2)}</td>
        <td>{f2(2 * r.root, 2)}</td>
        <td>{f2(toothThicknessPitch(s), 3)}</td>
        <td>{f2(toothThicknessAt(s, tipR), 3)}</td>
      </tr>
    )
  }

  const circles = (cx: number, r: ReturnType<typeof radii>, rw?: number) => (
    <g transform={`translate(${cx} 0)`} fill="none">
      <circle r={r.pitch} className="c-pitch" />
      <circle r={r.base} className="c-base" />
      <circle r={r.addendum} className="c-tip" />
      <circle r={r.root} className="c-root" />
      {rw !== undefined && Math.abs(rw - r.pitch) > 1e-6 && <circle r={rw} className="c-work" />}
    </g>
  )

  return (
    <div className="tab">
      <aside className="side">
        <div className="panel">
          <div className="section">
            <h3>{t('Mesh type')}</h3>
            <select aria-label={t('Mesh type')} value={g.mesh} onChange={(e) => set({ mesh: e.target.value as GearState['mesh'] })} style={{ width: '100%' }}>
              <option value="external">{t('External gear pair')}</option>
              <option value="internal">{t('Internal (ring) gear and pinion')}</option>
              <option value="rack">{t('Rack and pinion')}</option>
            </select>
          </div>
          <div className="section">
            <h3>{t('Tooth form')}</h3>
            <div className="row">
              <button className={g.pitchMode === 'module' ? 'active' : ''} aria-pressed={g.pitchMode === 'module'} onClick={() => set({ pitchMode: 'module' })}>{t('Module')}</button>
              <button className={g.pitchMode === 'dp' ? 'active' : ''} aria-pressed={g.pitchMode === 'dp'} onClick={() => set({ pitchMode: 'dp' })}>{t('Diametral pitch')}</button>
            </div>
            <div className="grid2">
              {g.pitchMode === 'module' ? (
                <NumberField label={t('Module')} suffix="mm" value={g.module} min={0.1} max={50} onChange={(v) => set({ module: v })} />
              ) : (
                <NumberField label={t('Diametral pitch')} suffix={t('teeth/in')} value={g.dp} min={0.5} max={250} onChange={(v) => set({ dp: v })} />
              )}
              <NumberField label={t('Pressure angle')} suffix="°" value={g.alphaDeg} min={10} max={30} onChange={(v) => set({ alphaDeg: v })} />
              <NumberField label={t('Backlash')} suffix="mm" value={g.backlash} min={0} max={Math.max(0.01, m * 1.5)} title={t('Total circumferential backlash, removed half from each gear')} onChange={(v) => set({ backlash: v })} />
              <NumberField label={t('Root fillet')} suffix={t('× module')} value={g.filletCoef} min={0} max={0.6} onChange={(v) => set({ filletCoef: v })} />
            </div>
            <p className="hint">
              {g.pitchMode === 'module' ? `P = ${f2(dpFromModule(m), 3)} ${t('teeth/in')}` : `m = ${f2(m, 4)} mm`}
            </p>
          </div>
          <div className="section">
            <h3>{t(rack ? 'Pinion' : 'Gear 1 (driver)')}</h3>
            <div className="grid2">
              <NumberField label={t('Teeth')} value={g.z1} min={4} max={300} step={1} onChange={(v) => set({ z1: Math.round(v) })} />
              <NumberField label={t('Profile shift x')} value={g.x1} min={-1.5} max={1.5} step={0.05} onChange={(v) => set({ x1: v })} />
            </div>
            {boreFields(g.bore1, 'bore1')}
          </div>
          {!rack && (
            <div className="section">
              <h3>{t(internal ? 'Ring gear' : 'Gear 2')}</h3>
              <div className="grid2">
                <NumberField label={t('Teeth')} value={g.z2} min={4} max={400} step={1} onChange={(v) => set({ z2: Math.round(v) })} />
                <NumberField label={t('Profile shift x')} value={g.x2} min={-1.5} max={1.5} step={0.05} onChange={(v) => set({ x2: v })} />
              </div>
              {!internal && boreFields(g.bore2, 'bore2')}
            </div>
          )}
          <div className="section">
            <h3>{t('Display')}</h3>
            <label className="check"><input type="checkbox" checked={g.circles} onChange={(e) => set({ circles: e.target.checked })} /> {t('Construction circles')}</label>
            <label className="check"><input type="checkbox" checked={g.lineOfAction} onChange={(e) => set({ lineOfAction: e.target.checked })} /> {t('Line of action')}</label>
          </div>
          <div className="section">
            <h3>{t('Export')}</h3>
            <select aria-label={t('Export')} value={g.exportWhat} onChange={(e) => set({ exportWhat: e.target.value as GearState['exportWhat'] })} style={{ width: '100%', marginBottom: 6 }}>
              <option value="pair">{t('Assembled pair')}</option>
              <option value="gear1">{t(rack ? 'Pinion only' : 'Gear 1 only')}</option>
              {!rack && <option value="gear2">{t(internal ? 'Ring gear only' : 'Gear 2 only')}</option>}
            </select>
            <div className="row">
              <button onClick={exportDxf} disabled={!ringOk}>{t('Download DXF (R12)')}</button>
              <button onClick={exportSvg} disabled={!ringOk}>{t('Download SVG')}</button>
            </div>
            <p className="hint">{t('Millimetres, closed polylines. Gears are drawn at the mesh position.')}</p>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="box">
          <div className="row">
            <button onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>{playing ? t('Pause') : t('Play')}</button>
            <label className="inline">
              {t('Speed')} <input type="range" min={1} max={60} value={g.rpm} onChange={(e) => set({ rpm: +e.target.value })} aria-label={t('Speed')} /> {g.rpm} {t('rpm')}
            </label>
            <label className="inline">
              {t('Angle')} <input type="range" min={0} max={360} step={0.5} value={((theta / DEG) % 360 + 360) % 360} onChange={(e) => { setPlaying(false); setTheta(+e.target.value * DEG) }} aria-label={t('Angle')} />
            </label>
          </div>
          <svg className="stage gear-svg" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} role="img" aria-label={t('Gear meshing animation')}>
            {asm && (
              <>
                {internal && asm.gear2 && (
                  <g transform={`translate(${asm.gear2.cx} 0) rotate(${deg(asm.gear2.rotation)})`}>
                    <path
                      className="gear g2"
                      fillRule="evenodd"
                      d={`M${-(r2.root + Math.max(3 * m, 4))} 0a${r2.root + Math.max(3 * m, 4)} ${r2.root + Math.max(3 * m, 4)} 0 1 0 ${2 * (r2.root + Math.max(3 * m, 4))} 0a${r2.root + Math.max(3 * m, 4)} ${r2.root + Math.max(3 * m, 4)} 0 1 0 ${-2 * (r2.root + Math.max(3 * m, 4))} 0Z${path2}`}
                    />
                  </g>
                )}
                {!internal && asm.gear2 && (
                  <g transform={`translate(${asm.gear2.cx} 0) rotate(${deg(asm.gear2.rotation)})`}>
                    <path className="gear g2" fillRule="evenodd" d={path2 + (g.bore2.diameter > 0 ? bore2 : '')} />
                  </g>
                )}
                {rack && asm.rack && <path className="gear g2" d={rackPath} />}
                <g transform={`rotate(${deg(asm.gear1.rotation)})`}>
                  <path className="gear g1" fillRule="evenodd" d={path1 + (g.bore1.diameter > 0 ? bore1 : '')} />
                </g>
                {g.circles && (
                  <g>
                    {circles(0, r1, pair?.rw1)}
                    {asm.gear2 && circles(asm.gear2.cx, r2, pair?.rw2)}
                    {rack && <line x1={-r1.addendum * 1.5} x2={r1.addendum * 1.5} y1={r1.pitch + spec1.x * m} y2={r1.pitch + spec1.x * m} className="c-pitch" />}
                  </g>
                )}
                {g.lineOfAction && loa && <line x1={loa[0][0]} y1={-loa[0][1]} x2={loa[1][0]} y2={-loa[1][1]} className="c-loa" />}
              </>
            )}
          </svg>
          <p className="hint legend">
            <span className="sw sw-pitch" /> {t('pitch')} <span className="sw sw-base" /> {t('base')} <span className="sw sw-tip" /> {t('tip')} <span className="sw sw-root" /> {t('root')} <span className="sw sw-loa" /> {t('line of action')}
          </p>
        </div>
        {warnings.length > 0 && (
          <div className="box" role="status">
            <h3>{t('Warnings')}</h3>
            <ul className="warns">{warnings.map((w, i) => <li key={i} className="warn-text">{w}</li>)}</ul>
          </div>
        )}
        <div className="box">
          <h3>{t('Results')}</h3>
          <div className="scroll">
            <table className="data">
              <thead>
                <tr>
                  <th />
                  <th>{t('Pitch Ø')}</th>
                  <th>{t('Base Ø')}</th>
                  <th>{t('Tip Ø')}</th>
                  <th>{t('Root Ø')}</th>
                  <th>{t('Thickness at pitch circle')}</th>
                  <th>{t('Thickness at tip')}</th>
                </tr>
              </thead>
              <tbody>
                {gearRows(spec1, rack ? t('Pinion') : t('Gear 1'))}
                {!rack && gearRows(spec2, internal ? t('Ring gear') : t('Gear 2'))}
              </tbody>
            </table>
          </div>
          {pair && ringOk && (
            <div className="stats">
              <div><span>{t('Centre distance')}</span><b>{f2(pair.a, 3)} mm</b></div>
              <div><span>{t('Standard centre distance')}</span><b>{f2(pair.a0, 3)} mm</b></div>
              <div><span>{t('Working pressure angle')}</span><b>{f2(pair.alphaW / DEG, 3)}°</b></div>
              <div><span>{t('Contact ratio')}</span><b className={pair.eps < 1.2 ? 'warn-text' : 'ok-text'}>{f2(pair.eps, 3)}</b></div>
              <div><span>{t('Ratio')}</span><b>{rack ? '-' : f2(pair.ratio, 4)}</b></div>
              <div><span>{t('Circular pitch')}</span><b>{f2(Math.PI * m, 3)} mm</b></div>
              <div><span>{t('Module')}</span><b>{f2(m, 4)} mm</b></div>
              <div><span>{t('Diametral pitch')}</span><b>{f2(dpFromModule(m), 3)}</b></div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
