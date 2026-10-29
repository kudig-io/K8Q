import { HBar, Sparkline, UtilBar } from '../components/charts'
import { relTime } from '../components/common'
import { current, useStore } from '../mock/store'

export default function Dashboard() {
  useStore(s => s.perCluster[s.clusters[s.activeCluster].id].events.length)
  const cluster = useStore(s => s.clusters[s.activeCluster])
  const { nodes, workloads, events, metrics } = current()

  const allPods = workloads.flatMap(w => w.pods)
  const running = allPods.filter(p => p.phase === 'Running' || p.phase === 'Succeeded').length
  const pending = allPods.filter(p => p.phase === 'Pending').length
  const crash = allPods.filter(p => p.phase === 'CrashLoopBackOff').length
  const failed = allPods.filter(p => p.phase === 'Failed').length

  const nodesReady = nodes.filter(n => n.ready).length
  const cpuTotal = nodes.reduce((a, n) => a + n.cpuCapacity, 0)
  const memTotal = nodes.reduce((a, n) => a + n.memCapacity, 0)
  const cpuUsed = nodes.reduce((a, n) => a + n.cpuCapacity * n.cpuUsed, 0)
  const memUsed = nodes.reduce((a, n) => a + n.memCapacity * n.memUsed, 0)
  const cpuPct = (cpuUsed / cpuTotal) * 100
  const memPct = (memUsed / memTotal) * 100
  const degraded = workloads.filter(w => w.status === 'Degraded').length
  const warnCount = events.filter(e => e.type === 'Warning').length
  const restartTotal = allPods.reduce((a, p) => a + p.restarts, 0)

  const nsPods = new Map<string, number>()
  workloads.forEach(w => nsPods.set(w.namespace, (nsPods.get(w.namespace) ?? 0) + w.pods.length))
  const nsTop = [...nsPods.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  const nsMax = nsTop[0]?.[1] ?? 1

  const phases = [
    { label: 'Running', count: running, cls: 'ok' as const },
    { label: 'Pending', count: pending, cls: 'warn' as const },
    { label: 'CrashLoopBackOff', count: crash, cls: 'err' as const },
    { label: 'Failed', count: failed, cls: 'err' as const },
  ]

  return (
    <div>
      <h1 className="page-title">集群总览 <span className="en">CLUSTER OVERVIEW</span></h1>
      <p className="page-desc">
        {cluster.name} · {cluster.provider} · {cluster.region} · Kubernetes {cluster.version} · 数据每 3.5s 刷新(mock)
      </p>

      <div className="metric-strip">
        <div className="metric-cell">
          <div className="metric-label">节点</div>
          <div className="metric-value">{nodesReady}<span className="unit">/ {nodes.length}</span></div>
          <div className="metric-sub">ready</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">工作负载</div>
          <div className="metric-value">{workloads.length}</div>
          <div className="metric-sub" style={{ color: degraded ? 'var(--err)' : undefined }}>{degraded} 异常</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">Pod 运行</div>
          <div className="metric-value">{running}<span className="unit">/ {allPods.length}</span></div>
          <div className="metric-sub" style={{ color: crash + failed ? 'var(--err)' : undefined }}>{crash + failed} 异常</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">CPU 分配</div>
          <div className="metric-value">{cpuPct.toFixed(1)}<span className="unit">%</span></div>
          <div className="metric-sub">{cpuUsed.toFixed(0)} / {cpuTotal} cores</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">内存分配</div>
          <div className="metric-value">{memPct.toFixed(1)}<span className="unit">%</span></div>
          <div className="metric-sub">{memUsed.toFixed(0)} / {memTotal} GiB</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">容器重启(累计)</div>
          <div className="metric-value">{restartTotal}</div>
          <div className="metric-sub">restarts</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">告警事件(4h)</div>
          <div className="metric-value" style={{ color: warnCount > 5 ? 'var(--warn)' : undefined }}>{warnCount}</div>
          <div className="metric-sub">Warning</div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="card">
          <h4 className="card-title">节点 <span className="sub">NODES · {nodes.length}</span></h4>
          <table className="data">
            <thead>
              <tr><th>节点</th><th>角色</th><th>CPU</th><th>内存</th><th>状态</th></tr>
            </thead>
            <tbody>
              {nodes.map(n => (
                <tr key={n.name}>
                  <td className="mono name-cell" style={{ fontSize: 11.5 }}>{n.name}</td>
                  <td className="dim">{n.roles.join(', ')}</td>
                  <td style={{ minWidth: 130 }}>
                    <UtilBar name="" pct={n.cpuUsed * 100} detail={`${(n.cpuUsed * 100).toFixed(0)}% / ${n.cpuCapacity}c`} />
                  </td>
                  <td style={{ minWidth: 130 }}>
                    <UtilBar name="" pct={n.memUsed * 100} detail={`${(n.memUsed * 100).toFixed(0)}% / ${n.memCapacity}G`} />
                  </td>
                  <td>
                    {n.ready
                      ? <span className="status-pill ok"><span className="dot" />Ready</span>
                      : <span className="status-pill err"><span className="dot red" />NotReady</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h4 className="card-title">事件流 <span className="sub">EVENTS · LIVE</span></h4>
          <div className="event-stream" style={{ maxHeight: 430 }}>
            {events.slice(0, 16).map(e => (
              <div className="event-row" key={e.id}>
                <span className="event-ts">{relTime(e.ts)}</span>
                <span className={`tag ${e.type === 'Warning' ? 'warn' : 'normal'}`}>{e.type}</span>
                <span className="event-msg" title={`${e.namespace} · ${e.object} · ${e.message}`}>
                  <b>{e.reason}</b> · {e.object}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="dash-row">
        <div className="card">
          <h4 className="card-title">容量趋势 <span className="sub">CPU / MEM · 48min</span></h4>
          <div className="kv-strip">
            <div className="kv"><span className="k" style={{ color: 'var(--brand)' }}>■ CPU</span><span className="v">{metrics[metrics.length - 1].cpu.toFixed(1)}%</span></div>
            <div className="kv"><span className="k" style={{ color: 'var(--ok)' }}>■ MEM</span><span className="v">{metrics[metrics.length - 1].mem.toFixed(1)}%</span></div>
          </div>
          <Sparkline data={metrics} k="cpu" color="#2f5fd0" />
          <Sparkline data={metrics} k="mem" color="#15803d" height={52} />
        </div>

        <div className="card">
          <h4 className="card-title">Pod 状态分布 <span className="sub">PHASES</span></h4>
          <table className="data">
            <thead>
              <tr><th>状态</th><th>数量</th><th>占比</th></tr>
            </thead>
            <tbody>
              {phases.map(p => (
                <tr key={p.label}>
                  <td>
                    <span className={`status-pill ${p.cls}`}>
                      <span className={`dot${p.cls === 'warn' ? ' amber' : p.cls === 'err' ? ' red' : ''}`} />
                      {p.label}
                    </span>
                  </td>
                  <td className="mono">{p.count}</td>
                  <td className="mono dim">{((p.count / (allPods.length || 1)) * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h4 className="card-title">命名空间负载 <span className="sub">TOP 6 · PODS</span></h4>
          {nsTop.map(([ns, n]) => (
            <HBar key={ns} name={ns} value={n} max={nsMax} label={`${n} pods`} />
          ))}
          <h4 className="card-title" style={{ marginTop: 14 }}>命名空间事件 <span className="sub">WARNINGS</span></h4>
          {[...new Set(events.filter(e => e.type === 'Warning').map(e => e.namespace))].slice(0, 4).map(ns => (
            <div key={ns} className="kv-strip" style={{ padding: '3px 0' }}>
              <div className="kv"><span className="k mono">{ns}</span><span className="v" style={{ color: 'var(--warn)' }}>
                {events.filter(e => e.type === 'Warning' && e.namespace === ns).length} 条
              </span></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
