export interface Series {
  x: number[]
  y: number[]
  color: string
}

interface Props {
  title: string
  xLabel: string
  yLabel: string
  series: Series[]
  xDomain: [number, number]
  /** Fixed y domain; auto-fit when omitted. */
  yDomain?: [number, number]
  hLines?: { y: number; label?: string }[]
  vLines?: number[]
  /** Highlight band on the y axis. */
  band?: [number, number]
  cursor?: number
  /** Marker value at the cursor for the first series. */
  cursorY?: number
  /** Number format for tick labels. */
  xTicks?: number[]
}

const W = 640
const H = 190
const M = { l: 52, r: 12, t: 22, b: 30 }

function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo || 1
  const raw = span / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(10))
  return out
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : +v.toPrecision(3)).toString()

export default function Plot({ title, xLabel, yLabel, series, xDomain, yDomain, hLines, vLines, band, cursor, cursorY, xTicks }: Props) {
  let [y0, y1] = yDomain ?? [Infinity, -Infinity]
  if (!yDomain) {
    for (const s of series) for (const v of s.y) if (Number.isFinite(v)) {
      if (v < y0) y0 = v
      if (v > y1) y1 = v
    }
    if (!Number.isFinite(y0)) [y0, y1] = [0, 1]
    if (y0 === y1) [y0, y1] = [y0 - 1, y1 + 1]
    const pad = (y1 - y0) * 0.08
    y0 -= pad
    y1 += pad
  }
  const [x0, x1] = xDomain
  const sx = (v: number) => M.l + ((v - x0) / (x1 - x0 || 1)) * (W - M.l - M.r)
  const sy = (v: number) => H - M.b - ((v - y0) / (y1 - y0 || 1)) * (H - M.t - M.b)
  const yt = niceTicks(y0, y1, 4)
  const xt = xTicks ?? niceTicks(x0, x1, 6)
  const path = (s: Series) => {
    let d = ''
    let pen = false
    s.x.forEach((xv, i) => {
      const yv = s.y[i]
      if (!Number.isFinite(yv)) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${sx(xv).toFixed(1)} ${sy(Math.max(y0, Math.min(y1, yv))).toFixed(1)}`
      pen = true
    })
    return d
  }
  return (
    <svg className="plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
      <rect x="0" y="0" width={W} height={H} className="plot-bg" />
      <text x={M.l} y="14" className="plot-title">
        {title}
      </text>
      {band && <rect x={M.l} width={W - M.l - M.r} y={sy(Math.min(y1, band[1]))} height={Math.max(0, sy(Math.max(y0, band[0])) - sy(Math.min(y1, band[1])))} className="plot-band" />}
      {yt.map((v) => (
        <g key={'y' + v}>
          <line x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} className={v === 0 ? 'plot-axis' : 'plot-grid'} />
          <text x={M.l - 5} y={sy(v) + 3.5} textAnchor="end" className="plot-tick">
            {fmt(v)}
          </text>
        </g>
      ))}
      {xt.map((v) => (
        <g key={'x' + v}>
          <line x1={sx(v)} x2={sx(v)} y1={M.t} y2={H - M.b} className="plot-grid" />
          <text x={sx(v)} y={H - M.b + 13} textAnchor="middle" className="plot-tick">
            {fmt(v)}
          </text>
        </g>
      ))}
      {(vLines ?? []).map((v, i) => (
        <line key={'v' + i} x1={sx(v)} x2={sx(v)} y1={M.t} y2={H - M.b} className="plot-seg" />
      ))}
      {(hLines ?? []).map((h, i) => (
        <g key={'h' + i}>
          <line x1={M.l} x2={W - M.r} y1={sy(h.y)} y2={sy(h.y)} className="plot-ref" />
          {h.label && (
            <text x={W - M.r - 3} y={sy(h.y) - 3} textAnchor="end" className="plot-tick">
              {h.label}
            </text>
          )}
        </g>
      ))}
      <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} className="plot-frame" />
      {series.map((s, i) => (
        <path key={i} d={path(s)} fill="none" stroke={s.color} strokeWidth="1.8" />
      ))}
      {cursor !== undefined && cursor >= x0 && cursor <= x1 && (
        <g>
          <line x1={sx(cursor)} x2={sx(cursor)} y1={M.t} y2={H - M.b} className="plot-cursor" />
          {cursorY !== undefined && Number.isFinite(cursorY) && <circle cx={sx(cursor)} cy={sy(Math.max(y0, Math.min(y1, cursorY)))} r="4" fill={series[0]?.color ?? 'currentColor'} />}
        </g>
      )}
      <text x={(M.l + W - M.r) / 2} y={H - 3} textAnchor="middle" className="plot-label">
        {xLabel}
      </text>
      <text x="11" y={(M.t + H - M.b) / 2} textAnchor="middle" className="plot-label" transform={`rotate(-90 11 ${(M.t + H - M.b) / 2})`}>
        {yLabel}
      </text>
    </svg>
  )
}
