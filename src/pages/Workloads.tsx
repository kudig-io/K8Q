import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Drawer, Modal, age, relTime } from '../components/common'
import LogViewer from '../components/LogViewer'
import YamlEditor from '../components/YamlEditor'
import { yamlFor } from '../mock/data'
import { current, deleteWorkload, restartWorkload, scaleWorkload, useStore } from '../mock/store'
import type { Workload, WorkloadKind } from '../types'

const kinds: WorkloadKind[] = ['Deployment', 'StatefulSet', 'DaemonSet', 'CronJob']
const kindCn: Record<WorkloadKind, string> = {
  Deployment: '无状态 Deployment',
  StatefulSet: '有状态 StatefulSet',
  DaemonSet: '守护集 DaemonSet',
  CronJob: '定时任务 CronJob',
}

function statusPill(w: Workload) {
  if (w.status === 'Healthy')
    return <span className="status-pill ok"><span className="dot" />健康</span>
  if (w.status === 'Progressing')
    return <span className="status-pill info"><span className="dot blue" />变更中</span>
  return <span className="status-pill err"><span className="dot red" />异常</span>
}

export default function Workloads() {
  useStore(s => s)
  const { workloads, events } = current()
  const [params] = useSearchParams()
  const [kind, setKind] = useState<WorkloadKind>('Deployment')
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [ns, setNs] = useState('全部')
  const [selected, setSelected] = useState<Workload | null>(null)
  const [drawerTab, setDrawerTab] = useState<'overview' | 'pods' | 'logs' | 'events' | 'yaml'>('overview')
  const [scaleFor, setScaleFor] = useState<Workload | null>(null)
  const [scaleVal, setScaleVal] = useState(3)

  const namespaces = useMemo(() => ['全部', ...new Set(workloads.map(w => w.namespace))], [workloads])
  const filtered = useMemo(
    () =>
      workloads.filter(
        w =>
          w.kind === kind &&
          (ns === '全部' || w.namespace === ns) &&
          (!query || w.name.includes(query) || w.image.includes(query)),
      ),
    [workloads, kind, ns, query],
  )
  const selLive = selected ? workloads.find(w => w.id === selected.id) ?? null : null
  const selEvents = selLive ? events.filter(e => e.object.endsWith(`/${selLive.name}`)).slice(0, 8) : []

  const stats = (w: Workload) => ({
    restarts: w.pods.reduce((a, p) => a + p.restarts, 0),
    cpu: w.pods.reduce((a, p) => a + p.cpu, 0),
    mem: w.pods.reduce((a, p) => a + Number(p.mem), 0),
  })

  return (
    <div>
      <h1 className="page-title">工作负载 <span className="en">WORKLOADS</span></h1>
      <p className="page-desc">点击任意行查看详情,支持扩缩容、滚动重启、日志流与 YAML 在线编辑(mock)</p>

      <div className="tabs">
        {kinds.map(k => (
          <button key={k} className={`tab${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
            {kindCn[k]}
            <span className="count">{workloads.filter(w => w.kind === k).length}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input className="toolbar-input" placeholder="按名称 / 镜像过滤…" value={query} onChange={e => setQuery(e.target.value)} />
        <select className="toolbar-select" value={ns} onChange={e => setNs(e.target.value)}>
          {namespaces.map(n => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <span className="spacer" />
        <span className="toolbar-meta">
          {filtered.length} / {workloads.filter(w => w.kind === kind).length} 项 · {filtered.reduce((a, w) => a + w.replicas, 0)} 副本
        </span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data">
          <thead>
            <tr>
              <th>名称</th>
              <th>命名空间</th>
              <th>就绪</th>
              <th>副本</th>
              <th>重启</th>
              <th>CPU(cores)</th>
              <th>内存(Mi)</th>
              <th>镜像</th>
              <th>年龄</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(w => {
              const s = stats(w)
              return (
                <tr key={w.id} className="clickable" onClick={() => { setSelected(w); setDrawerTab('overview') }}>
                  <td className="name-cell">{w.name}</td>
                  <td className="mono dim">{w.namespace}</td>
                  <td className="mono">
                    <span style={{ color: w.readyReplicas === w.replicas ? 'var(--ok)' : 'var(--warn)' }}>
                      {w.readyReplicas}/{w.replicas}
                    </span>
                  </td>
                  <td className="mono dim">{w.replicas}</td>
                  <td className="mono" style={{ color: s.restarts > 10 ? 'var(--err)' : undefined }}>{s.restarts}</td>
                  <td className="mono dim">{s.cpu.toFixed(2)}</td>
                  <td className="mono dim">{s.mem.toFixed(0)}</td>
                  <td className="mono dim" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{w.image}</td>
                  <td className="mono dim">{age(w.ageMin)}</td>
                  <td>{statusPill(w)}</td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="dim" style={{ textAlign: 'center', padding: 28 }}>没有匹配的工作负载 — 调整过滤条件或切换资源类型</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selLive && (
        <Drawer
          title={selLive.name}
          sub={`${selLive.kind} · ${selLive.namespace} · ${selLive.image}`}
          onClose={() => setSelected(null)}
          actions={
            <>
              <button className="btn primary" onClick={() => { setScaleFor(selLive); setScaleVal(selLive.replicas) }}>扩缩容</button>
              <button className="btn" onClick={() => restartWorkload(selLive.id)}>滚动重启</button>
              <button className="btn danger" onClick={() => { deleteWorkload(selLive.id); setSelected(null) }}>删除</button>
            </>
          }
        >
          <div className="tabs">
            {(['overview', 'pods', 'logs', 'events', 'yaml'] as const).map(t => (
              <button key={t} className={`tab${drawerTab === t ? ' active' : ''}`} onClick={() => setDrawerTab(t)}>
                {{ overview: '概览', pods: `Pods (${selLive.pods.length})`, logs: '日志', events: '事件', yaml: 'YAML' }[t]}
              </button>
            ))}
          </div>

          {drawerTab === 'overview' && (
            <div className="kv-grid">
              <div className="kv"><span className="k">状态</span><span className="v">{statusPill(selLive)}</span></div>
              <div className="kv"><span className="k">就绪副本</span><span className="v mono">{selLive.readyReplicas} / {selLive.replicas}</span></div>
              <div className="kv"><span className="k">命名空间</span><span className="v mono">{selLive.namespace}</span></div>
              <div className="kv"><span className="k">运行时长</span><span className="v mono">{age(selLive.ageMin)}</span></div>
              <div className="kv"><span className="k">累计重启</span><span className="v mono">{stats(selLive).restarts}</span></div>
              <div className="kv"><span className="k">资源占用</span><span className="v mono">{stats(selLive).cpu.toFixed(2)}c · {stats(selLive).mem.toFixed(0)}Mi</span></div>
              <div className="kv"><span className="k">镜像</span><span className="v mono" style={{ fontSize: 11 }}>{selLive.image}</span></div>
              <div className="kv"><span className="k">团队</span><span className="v mono">{selLive.annotations['k8q.io/team']}</span></div>
              {selLive.annotations['kubectl.kubernetes.io/restartedAt'] && (
                <div className="kv"><span className="k">最近重启</span><span className="v mono" style={{ fontSize: 11 }}>{selLive.annotations['kubectl.kubernetes.io/restartedAt']}</span></div>
              )}
            </div>
          )}

          {drawerTab === 'pods' && (
            <table className="data">
              <thead>
                <tr><th>Pod</th><th>节点</th><th>状态</th><th>重启</th><th>CPU</th><th>内存(Mi)</th><th>年龄</th></tr>
              </thead>
              <tbody>
                {selLive.pods.map(p => (
                  <tr key={p.name}>
                    <td className="mono name-cell" style={{ fontSize: 11 }}>{p.name}</td>
                    <td className="mono dim" style={{ fontSize: 11 }}>{p.node}</td>
                    <td>
                      <span className={`status-pill ${p.phase === 'Running' || p.phase === 'Succeeded' ? 'ok' : p.phase === 'Pending' ? 'warn' : 'err'}`}>
                        <span className={`dot${p.phase === 'Pending' ? ' amber' : p.phase === 'Running' || p.phase === 'Succeeded' ? '' : ' red'}`} />
                        {p.phase}
                      </span>
                    </td>
                    <td className="mono dim">{p.restarts}</td>
                    <td className="mono dim">{p.cpu.toFixed(2)}</td>
                    <td className="mono dim">{p.mem}</td>
                    <td className="mono dim">{age(p.ageMin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {drawerTab === 'logs' && <LogViewer pods={selLive.pods} />}

          {drawerTab === 'events' && (
            <div className="event-stream" style={{ maxHeight: 'none' }}>
              {selEvents.length === 0 && <div className="dim" style={{ padding: 20, textAlign: 'center' }}>暂无关联事件</div>}
              {selEvents.map(e => (
                <div className="event-row" key={e.id} style={{ gridTemplateColumns: '58px 58px 1fr' }}>
                  <span className="event-ts">{relTime(e.ts)}</span>
                  <span className={`tag ${e.type === 'Warning' ? 'warn' : 'normal'}`}>{e.type}</span>
                  <span className="event-msg" style={{ whiteSpace: 'normal' }}><b>{e.reason}</b> — {e.message}</span>
                </div>
              ))}
            </div>
          )}

          {drawerTab === 'yaml' && <YamlEditor workload={selLive} original={yamlFor(selLive)} />}
        </Drawer>
      )}

      {scaleFor && (
        <Modal title={`扩缩容 · ${scaleFor.name}`} onClose={() => setScaleFor(null)}>
          <div className="field">
            <label>目标副本数: <b className="mono" style={{ color: 'var(--brand)', fontSize: 14 }}>{scaleVal}</b></label>
            <input type="range" min={0} max={20} value={scaleVal} onChange={e => setScaleVal(Number(e.target.value))} />
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setScaleFor(null)}>取消</button>
            <button className="btn primary" onClick={() => { scaleWorkload(scaleFor.id, scaleVal); setScaleFor(null) }}>应用变更</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
