import { useMemo, useState } from 'react'
import { relTime } from '../components/common'
import { current, useStore } from '../mock/store'
import type { KEvent } from '../types'

function absTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export default function Events() {
  useStore(s => s)
  const live = current().events
  const [paused, setPaused] = useState(false)
  const [frozen, setFrozen] = useState<KEvent[]>([])
  const [type, setType] = useState<'全部' | 'Warning' | 'Normal'>('全部')
  const [ns, setNs] = useState('全部')
  const [reason, setReason] = useState('全部')
  const [query, setQuery] = useState('')

  const events = paused ? frozen : live

  const namespaces = useMemo(() => ['全部', ...new Set(events.map(e => e.namespace))], [events])
  const reasons = useMemo(
    () =>
      ['全部', ...Object.entries(
        events.reduce<Record<string, number>>((acc, e) => {
          acc[e.reason] = (acc[e.reason] ?? 0) + 1
          return acc
        }, {}),
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([r]) => r)],
    [events],
  )

  const filtered = useMemo(
    () =>
      events.filter(
        e =>
          (type === '全部' || e.type === type) &&
          (ns === '全部' || e.namespace === ns) &&
          (reason === '全部' || e.reason === reason) &&
          (!query ||
            e.message.toLowerCase().includes(query.toLowerCase()) ||
            e.object.includes(query) ||
            e.reason.toLowerCase().includes(query.toLowerCase())),
      ),
    [events, type, ns, reason, query],
  )

  const warnCount = events.filter(e => e.type === 'Warning').length
  const objCount = new Set(events.map(e => e.object)).size
  const lastHour = events.filter(e => Date.now() - e.ts < 3600_000).length
  const latest = events[0]

  return (
    <div>
      <h1 className="page-title">事件流 <span className="en">EVENT STREAM</span></h1>
      <p className="page-desc">全集群 Kubernetes 事件实时聚合(mock),支持类型 / 命名空间 / 原因多维过滤</p>

      <div className="metric-strip">
        <div className="metric-cell">
          <div className="metric-label">窗口内事件</div>
          <div className="metric-value">{events.length}</div>
          <div className="metric-sub">保留最近 60 条</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">Warning</div>
          <div className="metric-value" style={{ color: warnCount > 0 ? 'var(--warn)' : undefined }}>{warnCount}</div>
          <div className="metric-sub">占比 {events.length ? Math.round((warnCount / events.length) * 100) : 0}%</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">涉及对象</div>
          <div className="metric-value">{objCount}</div>
          <div className="metric-sub">deployment / pod / node</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">近 1 小时</div>
          <div className="metric-value">{lastHour}</div>
          <div className="metric-sub">约 {(lastHour / 60).toFixed(1)} 条/分钟</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">流状态</div>
          <div className="metric-value" style={{ fontSize: 14, paddingTop: 4 }}>
            <span className={`status-pill ${paused ? 'warn' : 'ok'}`}>
              <span className={`dot${paused ? ' amber' : ''}`} />
              {paused ? '已暂停' : '直播中'}
            </span>
          </div>
          <div className="metric-sub">最近 {latest ? relTime(latest.ts) : '—'}</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg">
          {(['全部', 'Warning', 'Normal'] as const).map(t => (
            <button key={t} className={`seg-btn${type === t ? ' active' : ''}`} onClick={() => setType(t)}>
              {t}
            </button>
          ))}
        </div>
        <select className="toolbar-select" value={ns} onChange={e => setNs(e.target.value)}>
          {namespaces.map(n => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <select className="toolbar-select" value={reason} onChange={e => setReason(e.target.value)}>
          {reasons.map(r => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <input
          className="toolbar-input"
          placeholder="搜索消息 / 对象 / 原因…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <span className="spacer" />
        <span className="toolbar-meta">{filtered.length} 条匹配</span>
        <button
          className={`btn${paused ? ' primary' : ''}`}
          onClick={() => {
            if (paused) setPaused(false)
            else {
              setFrozen(live)
              setPaused(true)
            }
          }}
        >
          {paused ? '恢复直播' : '暂停'}
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 86 }}>时间</th>
              <th style={{ width: 72 }}>类型</th>
              <th style={{ width: 110 }}>命名空间</th>
              <th style={{ width: 220 }}>对象</th>
              <th style={{ width: 150 }}>原因</th>
              <th>消息</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(e => (
              <tr key={e.id}>
                <td className="mono dim" title={new Date(e.ts).toLocaleString('zh-CN')}>
                  {absTime(e.ts)}
                </td>
                <td>
                  <span className={`tag ${e.type === 'Warning' ? 'warn' : 'normal'}`}>{e.type}</span>
                </td>
                <td className="mono dim">{e.namespace}</td>
                <td className="mono name-cell" style={{ fontSize: 11.5 }}>{e.object}</td>
                <td className="mono" style={{ fontSize: 11.5, color: e.type === 'Warning' ? 'var(--warn)' : undefined }}>
                  {e.reason}
                </td>
                <td className="dim" style={{ fontSize: 12 }}>{e.message}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="dim" style={{ textAlign: 'center', padding: 28 }}>
                  没有匹配的事件 — 调整过滤条件
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
