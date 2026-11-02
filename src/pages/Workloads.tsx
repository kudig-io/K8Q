import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Drawer, Modal, age, relTime } from '../components/common'
import LogViewer from '../components/LogViewer'
import YamlEditor from '../components/YamlEditor'
import { exportCsv, ColumnSettings, useColumnVisibility, csvTimestamp, type ListColumn } from '../components/listUtils'
import { yamlFor } from '../data/mock/data'
import { useStore } from '../data/mock/store'
import { fetchClusterRevisions, fetchPodLogs, useSourceData, workloadOps } from '../data/dataSource'
import { matchesSelector, parseSelector } from '../data/selector'
import type { Revision, Workload, WorkloadKind } from '../types'

export const workloadKindMeta: Record<WorkloadKind, { cn: string; en: string; desc: string }> = {
  Deployment: {
    cn: '无状态应用',
    en: 'DEPLOYMENTS',
    desc: '声明式副本管理 · 扩缩容、滚动重启、回滚、日志与 YAML 在线编辑',
  },
  StatefulSet: {
    cn: '有状态应用',
    en: 'STATEFULSETS',
    desc: '稳定网络标识与顺序滚动 · 扩缩容、滚动重启、回滚、日志与 YAML 在线编辑',
  },
  DaemonSet: {
    cn: '守护集',
    en: 'DAEMONSETS',
    desc: '每个节点一份守护进程 · 就绪副本随节点规模变化',
  },
  CronJob: {
    cn: '定时任务',
    en: 'CRONJOBS',
    desc: '按调度表达式周期执行 · 支持立即触发、挂起与恢复调度',
  },
}

function statusPill(w: Workload) {
  if (w.status === 'Healthy')
    return <span className="status-pill ok"><span className="dot" />健康</span>
  if (w.status === 'Progressing')
    return <span className="status-pill info"><span className="dot blue" />变更中</span>
  return <span className="status-pill err"><span className="dot red" />异常</span>
}

function podPill(p: Workload['pods'][number]) {
  const tone = p.phase === 'Running' || p.phase === 'Succeeded' ? 'ok' : p.phase === 'Pending' || p.phase === 'Terminating' ? 'warn' : 'err'
  const dot = tone === 'ok' ? '' : ' amber'
  return (
    <span className={`status-pill ${tone}`}>
      <span className={`dot${dot}`} />
      {p.phase}
    </span>
  )
}

const WL_COLUMNS: ListColumn<Workload>[] = [
  { title: '名称', key: 'name', value: w => w.name, render: w => <span className="name-cell">{w.name}</span> },
  { title: '命名空间', key: 'namespace', value: w => w.namespace, render: w => <span className="mono dim">{w.namespace}</span> },
  {
    title: '就绪', key: 'ready', value: w => w.readyReplicas,
    render: w => (
      <span className="mono" style={{ color: w.readyReplicas === w.replicas ? 'var(--ok)' : 'var(--warn)' }}>
        {w.readyReplicas}/{w.replicas}
      </span>
    ),
  },
  { title: '副本', key: 'replicas', value: w => w.replicas, render: w => <span className="mono dim">{w.replicas}</span> },
  {
    title: '重启', key: 'restarts', value: w => w.pods.reduce((a, p) => a + p.restarts, 0),
    render: w => {
      const r = w.pods.reduce((a, p) => a + p.restarts, 0)
      return <span className="mono" style={{ color: r > 10 ? 'var(--err)' : undefined }}>{r}</span>
    },
  },
  { title: 'CPU(cores)', key: 'cpu', value: w => w.pods.reduce((a, p) => a + p.cpu, 0), render: w => <span className="mono dim">{w.pods.reduce((a, p) => a + p.cpu, 0).toFixed(2)}</span> },
  { title: '内存(Mi)', key: 'mem', value: w => w.pods.reduce((a, p) => a + Number(p.mem), 0), render: w => <span className="mono dim">{w.pods.reduce((a, p) => a + Number(p.mem), 0).toFixed(0)}</span> },
  {
    title: '镜像', key: 'image', value: w => w.image,
    render: w => <span className="mono dim" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{w.image}</span>,
  },
  { title: '年龄', key: 'age', value: w => w.ageMin, render: w => <span className="mono dim">{age(w.ageMin)}</span> },
  { title: '状态', key: 'status', value: w => w.status, render: w => statusPill(w) },
]

export default function WorkloadsPanel({ kind }: { kind: WorkloadKind }) {
  const ns = useStore(s => s.namespace)
  const src = useSourceData()
  const { workloads, events } = src
  const [params] = useSearchParams()
  const qParam = params.get('q') ?? ''
  const [query, setQuery] = useState(qParam)
  const [labelExpr, setLabelExpr] = useState('')
  const [selected, setSelected] = useState<Workload | null>(null)
  const [drawerTab, setDrawerTab] = useState<'overview' | 'pods' | 'logs' | 'events' | 'yaml'>('overview')
  const [scaleFor, setScaleFor] = useState<Workload | null>(null)
  const [scaleVal, setScaleVal] = useState(3)
  const [rollbackFor, setRollbackFor] = useState<Workload | null>(null)
  const [rollbackTarget, setRollbackTarget] = useState<number | null>(null)
  const [clusterRevisions, setClusterRevisions] = useState<Revision[] | null>(null)

  // 侧栏切换资源类型或全局搜索跳转时,同步过滤词并收起旧详情
  useEffect(() => {
    setQuery(qParam)
    setSelected(null)
  }, [kind, qParam])

  const selector = useMemo(() => parseSelector(labelExpr), [labelExpr])
  const ofKind = useMemo(() => workloads.filter(w => w.kind === kind), [workloads, kind])
  const filtered = useMemo(
    () =>
      ofKind.filter(
        w =>
          (ns === '全部' || w.namespace === ns) &&
          (!query || w.name.includes(query) || w.image.includes(query)) &&
          (!selector.terms.length || matchesSelector(w.labels, selector.terms)),
      ),
    [ofKind, ns, query, selector],
  )
  const [visibleCols, toggleCol] = useColumnVisibility(`k8q.cols.wl.${kind}`, WL_COLUMNS.map(c => c.key))
  const cols = WL_COLUMNS.filter(c => visibleCols.has(c.key))
  const selLive = selected ? workloads.find(w => w.id === selected.id) ?? null : null
  const selEvents = selLive ? events.filter(e => e.object.endsWith(`/${selLive.name}`)).slice(0, 8) : []

  // 回滚弹窗打开时,集群模式从 ReplicaSet 拉取 revision 历史
  useEffect(() => {
    if (!rollbackFor || src.mode !== 'cluster') return
    setClusterRevisions(null)
    let alive = true
    void fetchClusterRevisions(rollbackFor).then(revs => {
      if (alive) setClusterRevisions(revs)
    })
    return () => {
      alive = false
    }
  }, [rollbackFor, src.mode])

  const rollbackList = rollbackFor ? (src.mode === 'cluster' ? clusterRevisions : rollbackFor.revisions ?? null) : null

  const stats = (w: Workload) => ({
    restarts: w.pods.reduce((a, p) => a + p.restarts, 0),
    cpu: w.pods.reduce((a, p) => a + p.cpu, 0),
    mem: w.pods.reduce((a, p) => a + Number(p.mem), 0),
  })

  return (
    <div>
      <div className="toolbar">
        <input className="toolbar-input" placeholder="按名称 / 镜像过滤…" value={query} onChange={e => setQuery(e.target.value)} />
        <input
          className="toolbar-input"
          style={{ width: 190 }}
          placeholder="label 过滤 app=x,tier!=y"
          value={labelExpr}
          onChange={e => setLabelExpr(e.target.value)}
        />
        {selector.error && <span className="selector-error">{selector.error}</span>}
        <span className="spacer" />
        <span className="toolbar-meta">
          {filtered.length} / {ofKind.length} 项 · {filtered.reduce((a, w) => a + w.replicas, 0)} 副本
          {ns !== '全部' ? ` · ${ns}` : ''}
        </span>
        <button className="btn" onClick={() => exportCsv(`workloads-${ns === '全部' ? 'all' : ns}-${csvTimestamp()}.csv`, cols, filtered)}>
          导出 CSV
        </button>
        <ColumnSettings cols={WL_COLUMNS} visible={visibleCols} onToggle={toggleCol} />
      </div>

      <div className="card table-card">
        <table className="data">
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c.key}>{c.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(w => (
              <tr key={w.id} className="clickable" onClick={() => { setSelected(w); setDrawerTab('overview') }}>
                {cols.map(c => (
                  <td key={c.key}>{c.render ? c.render(w) : String(c.value(w))}</td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={cols.length} className="dim table-empty">没有匹配的工作负载 — 调整过滤条件或切换命名空间</td></tr>
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
            selLive.kind === 'CronJob' ? (
              <>
                <button className="btn primary" onClick={() => workloadOps.triggerCron(selLive)}>立即触发</button>
                <button className="btn" onClick={() => workloadOps.setSuspend(selLive, !selLive.suspend)}>
                  {selLive.suspend ? '恢复调度' : '挂起调度'}
                </button>
                <button className="btn danger" onClick={() => { workloadOps.delete(selLive); setSelected(null) }}>删除</button>
              </>
            ) : (
              <>
                <button className="btn primary" onClick={() => { setScaleFor(selLive); setScaleVal(selLive.replicas) }}>扩缩容</button>
                <button className="btn" onClick={() => workloadOps.restart(selLive)}>滚动重启</button>
                <button className="btn" onClick={() => { setRollbackFor(selLive); setRollbackTarget(null) }}>回滚…</button>
                <button className="btn danger" onClick={() => { workloadOps.delete(selLive); setSelected(null) }}>删除</button>
              </>
            )
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
              {selLive.kind === 'CronJob' ? (
                <>
                  <div className="kv"><span className="k">调度表达式</span><span className="v mono">{selLive.schedule ?? '—'}</span></div>
                  <div className="kv">
                    <span className="k">挂起状态</span>
                    <span className="v">
                      {selLive.suspend
                        ? <span className="status-pill warn"><span className="dot amber" />已挂起</span>
                        : <span className="status-pill ok"><span className="dot" />调度中</span>}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="kv">
                    <span className="k">当前 Revision</span>
                    <span className="v mono">
                      {selLive.revisions?.[0] ? `rev ${selLive.revisions[0].revision} · ${selLive.revisions[0].imageTag}` : '—'}
                    </span>
                  </div>
                  <div className="kv"><span className="k">历史 Revision</span><span className="v mono">{selLive.revisions?.length ?? 0} 条</span></div>
                </>
              )}
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
                <tr><th>Pod</th><th>节点</th><th>状态</th><th>重启</th><th>CPU</th><th>内存(Mi)</th><th>年龄</th><th style={{ width: 132 }}>操作</th></tr>
              </thead>
              <tbody>
                {selLive.pods.map(p => (
                  <tr key={p.name}>
                    <td className="mono name-cell" style={{ fontSize: 11 }}>{p.name}</td>
                    <td className="mono dim" style={{ fontSize: 11 }}>{p.node}</td>
                    <td>{podPill(p)}</td>
                    <td className="mono dim">{p.restarts}</td>
                    <td className="mono dim">{p.cpu ? p.cpu.toFixed(2) : '—'}</td>
                    <td className="mono dim">{p.mem || '—'}</td>
                    <td className="mono dim">{age(p.ageMin)}</td>
                    <td className="ops-cell">
                      <button className="btn btn-sm" title="驱逐:优雅终止,尊重 PodDisruptionBudget" onClick={() => workloadOps.evictPod(p.namespace, p.name)}>驱逐</button>
                      <button className="btn btn-sm danger" title="强制删除:gracePeriod=0,立即移除" onClick={() => workloadOps.forceDeletePod(p.namespace, p.name)}>强删</button>
                    </td>
                  </tr>
                ))}
                {selLive.pods.length === 0 && (
                  <tr><td colSpan={8} className="dim" style={{ textAlign: 'center', padding: 20 }}>该工作负载没有 Pod</td></tr>
                )}
              </tbody>
            </table>
          )}

          {drawerTab === 'logs' && <LogViewer pods={selLive.pods} fetchLog={src.mode === 'cluster' ? fetchPodLogs : undefined} />}

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

          {drawerTab === 'yaml' && (
            <YamlEditor key={selLive.id} original={yamlFor(selLive)} onApply={text => workloadOps.applyWorkloadYaml(selLive, text)} />
          )}
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
            <button className="btn primary" onClick={() => { workloadOps.scale(scaleFor, scaleVal); setScaleFor(null) }}>应用变更</button>
          </div>
        </Modal>
      )}

      {rollbackFor && (
        <Modal title={`回滚 · ${rollbackFor.name}`} onClose={() => setRollbackFor(null)}>
          {rollbackList === null && src.mode === 'cluster' ? (
            <>
              <div className="dim" style={{ padding: '8px 2px' }}>正在从集群获取 revision 历史(ReplicaSet 注解推导)…</div>
              <div className="modal-actions">
                <button className="btn" onClick={() => setRollbackFor(null)}>关闭</button>
              </div>
            </>
          ) : (rollbackList?.length ?? 0) > 1 ? (
            <>
              <div className="rollback-list">
                {rollbackList!.map((v, i) => (
                  <label key={v.revision} className={`rollback-item${rollbackTarget === v.revision ? ' active' : ''}`}>
                    <input
                      type="radio"
                      name="rollback-rev"
                      disabled={i === 0}
                      checked={rollbackTarget === v.revision}
                      onChange={() => setRollbackTarget(v.revision)}
                    />
                    <span className="mono">rev {v.revision}</span>
                    <span className="mono">{v.imageTag}</span>
                    <span className="dim rollback-note">{v.note} · {relTime(v.deployedAt)}{v.operator && v.operator !== '—' ? ` · ${v.operator}` : ''}{i === 0 ? ' · 当前' : ''}</span>
                  </label>
                ))}
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={() => setRollbackFor(null)}>取消</button>
                <button
                  className="btn primary"
                  disabled={rollbackTarget === null}
                  onClick={() => {
                    if (rollbackTarget !== null) workloadOps.rollback(rollbackFor, rollbackTarget)
                    setRollbackFor(null)
                  }}
                >
                  执行回滚
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="dim" style={{ padding: '8px 2px' }}>
                {src.mode === 'cluster' ? '该 Deployment 没有可回滚的 ReplicaSet 历史。' : '该工作负载没有可回滚的历史 revision。'}
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={() => setRollbackFor(null)}>关闭</button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  )
}
