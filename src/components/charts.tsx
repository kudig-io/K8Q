import type { MetricPoint } from '../types'

export function Sparkline({ data, k, color, height = 72 }: { data: MetricPoint[]; k: 'cpu' | 'mem'; color: string; height?: number }) {
  const w = 520
  const values = data.map(d => d[k])
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * w},${height - 6 - ((d[k] - min) / range) * (height - 14)}`)
  const area = `0,${height} ${pts.join(' ')} ${w},${height}`
  const lastY = pts[pts.length - 1].split(',')[1]
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }}>
      <polygon points={area} fill={color} opacity="0.08" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={w - 1} cy={lastY} r="2.5" fill={color} />
    </svg>
  )
}

export function UtilBar({ name, pct, detail }: { name?: string; pct: number; detail: string }) {
  const cls = pct >= 85 ? 'err' : pct >= 70 ? 'warn' : 'ok'
  return (
    <div className="util-row" style={name ? undefined : { gridTemplateColumns: '1fr 96px' }}>
      {name && <span className="util-name" title={name}>{name}</span>}
      <span className="util-track">
        <span className={`util-fill ${cls}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className="util-val">{detail}</span>
    </div>
  )
}

export function HBar({ name, value, max, label }: { name: string; value: number; max: number; label: string }) {
  return (
    <div className="hbar-row">
      <span className="hbar-name" title={name}>{name}</span>
      <span className="hbar-track">
        <span className="hbar-fill" style={{ width: `${(value / max) * 100}%` }} />
      </span>
      <span className="hbar-val">{label}</span>
    </div>
  )
}
