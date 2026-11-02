import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Drawer, Modal, relTime } from '../components/common'
import LogViewer from '../components/LogViewer'
import YamlEditor from '../components/YamlEditor'
import { exportCsv, ColumnSettings, useColumnVisibility, csvTimestamp } from '../components/listUtils'
import { activeProvider, fetchPodLogs, useSourceData } from '../data/dataSource'
import { useStore } from '../data/mock/store'
import { yamlForObject } from '../data/objects'
import { byId, entryGvkRef, entryId, registry, richWorkloadKinds, type GvkEntry } from '../data/registry'
import { matchesSelector, parseSelector } from '../data/selector'
import type { WorkloadKind } from '../types'
import WorkloadsPanel, { workloadKindMeta } from './Workloads'

type DrawerTab = 'overview' | 'yaml' | 'events' | 'logs'

interface SortKey {
  key: string
  dir: 1 | -1
}

function GenericList({ entry, ns }: { entry: GvkEntry; ns: string }) {
  const src = useSourceData()
  const id = entryId(entry)
  const [params] = useSearchParams()
  const qParam = params.get('q') ?? ''
  const [query, setQuery] = useState(qParam)
  const [labelExpr, setLabelExpr] = useState('')
  const [sorts, setSorts] = useState<SortKey[]>([{ key: 'name', dir: 1 }])
  const [selected, setSelected] = useState<{ name: string; namespace?: string } | null>(null)
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('overview')
  const [loading, setLoading] = useState(true)
  const [delTarget, setDelTarget] = useState<{ name: string; namespace?: string } | null>(null)
  const [forceDelete, setForceDelete] = useState(false)

  useEffect(() => {
    setQuery(qParam)
    setLabelExpr('')
    setSorts([{ key: 'name', dir: 1 }])
    setSelected(null)
    setLoading(true)
    const t = setTimeout(() => setLoading(false), 220)
    return () => clearTimeout(t)
  }, [id, qParam])

  const selector = useMemo(() => parseSelector(labelExpr), [labelExpr])
  const all = activeProvider().list(entryGvkRef(entry))
  const scoped = entry.namespaced && ns !== '全部' ? all.filter(o => o.metadata.namespace === ns) : all
  const filtered = scoped.filter(
    o =>
      (!query || o.metadata.name.includes(query)) &&
      (!selector.terms.length || matchesSelector(o.metadata.labels, selector.terms)),
  )
  const [visibleCols, toggleCol] = useColumnVisibility(`k8q.cols.${id}`, entry.columns.map(c => c.key))
  const cols = entry.columns.filter(c => visibleCols.has(c.key))

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      for (const s of sorts) {
        const col = entry.columns.find(c => c.key === s.key)
        if (!col) continue
        const va = col.value(a)
        const vb = col.value(b)
        const cmp = (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * s.dir
        if (cmp !== 0) return cmp
      }
      return 0
    })
    return arr
  }, [filtered, sorts, entry])

  const selLive = selected ? activeProvider().get(entryGvkRef(entry), selected.namespace, selected.name) : undefined
  const selEvents = selLive
    ? src.events.filter(e => e.object === `${entry.kind.toLowerCase()}/${selLive.metadata.name}`).slice(0, 8)
    : []
  const podInfo = selLive && entry.kind === 'Pod'
    ? src.workloads.flatMap(w => w.pods).find(p => p.name === selLive.metadata.name && p.namespace === selLive.metadata.namespace)
    : undefined

  const tabs: { key: DrawerTab; label: string }[] = [
    { key: 'overview', label: '概览' },
    { key: 'yaml', label: 'YAML' },
    { key: 'events', label: '事件' },
    ...(entry.kind === 'Pod' ? [{ key: 'logs' as DrawerTab, label: '日志' }] : []),
  ]

  function toggleSort(key: string, additive: boolean) {
    setSorts(prev => {
      const at = prev.findIndex(s => s.key === key)
      if (!additive) {
        if (at === 0 && prev.length === 1) return [{ key, dir: prev[0].dir === 1 ? -1 : 1 }]
        return [{ key, dir: 1 }]
      }
      if (at === -1) {
        if (prev.length >= 3) return prev
        return [...prev, { key, dir: 1 }]
      }
      return prev.map((s, i) => (i === at ? { key, dir: s.dir === 1 ? -1 : 1 } : s))
    })
  }

  return (
    <div>
      <div className="toolbar">
        <input className="toolbar-input" placeholder={`按名称过滤 ${entry.kind}…`} value={query} onChange={e => setQuery(e.target.value)} />
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
          {filtered.length} / {all.length} 项{entry.namespaced && ns !== '全部' ? ` · ${ns}` : ''}
        </span>
        <button className="btn" onClick={() => exportCsv(`${entry.plural}-${ns === '全部' ? 'all' : ns}-${csvTimestamp()}.csv`, cols, sorted)}>
          导出 CSV
        </button>
        <ColumnSettings cols={entry.columns} visible={visibleCols} onToggle={toggleCol} />
      </div>

      <div className="card table-card">
        {loading || (src.mode === 'cluster' && src.status !== 'ready' && all.length === 0) ? (
          <div className="dim table-empty">
            {src.mode === 'cluster' && src.status === 'error'
              ? `集群连接失败:${src.error ?? '未知错误'}`
              : `正在加载 ${entry.plural}…`}
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                {cols.map(c => {
                  const at = sorts.findIndex(s => s.key === c.key)
                  return (
                    <th
                      key={c.key}
                      className="sortable"
                      style={c.width ? { width: c.width } : undefined}
                      title="点击排序 · Shift+点击加入多列排序(最多 3 列)"
                      onClick={e => toggleSort(c.key, e.shiftKey)}
                    >
                      {c.title}
                      {at !== -1 && (
                        <span className="sort-ind">
                          {sorts[at].dir === 1 ? '↑' : '↓'}
                          {sorts.length > 1 ? ['₁', '₂', '₃'][at] : ''}
                        </span>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map(o => (
                <tr
                  key={`${o.metadata.namespace ?? ''}/${o.metadata.name}`}
                  className="clickable"
                  onClick={() => { setSelected({ name: o.metadata.name, namespace: o.metadata.namespace }); setDrawerTab('overview') }}
                >
                  {cols.map(c => (
                    <td key={c.key} style={c.width ? { maxWidth: Math.max(c.width * 2.2, 96) } : undefined} className={!c.render && c.mono ? 'mono dim' : undefined}>
                      {c.render ? c.render(o) : String(c.value(o))}
                    </td>
                  ))}
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={cols.length} className="dim table-empty">
                    没有匹配的 {entry.kind} — 调整过滤条件或切换命名空间
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {selLive && (
        <Drawer
          title={selLive.metadata.name}
          sub={`${entry.kind} · ${selLive.metadata.namespace ?? '集群范围'} · ${selLive.apiVersion}`}
          onClose={() => setSelected(null)}
          actions={
            <>
              {entry.kind === 'Pod' && (
                <button
                  className="btn"
                  title="驱逐:优雅终止并尊重 PodDisruptionBudget"
                  onClick={() => void activeProvider().evict(entryGvkRef(entry), selLive.metadata.namespace ?? 'default', selLive.metadata.name)}
                >
                  驱逐
                </button>
              )}
              <button className="btn danger" onClick={() => { setDelTarget({ name: selLive.metadata.name, namespace: selLive.metadata.namespace }); setForceDelete(false) }}>
                删除…
              </button>
            </>
          }
        >
          <div className="tabs">
            {tabs.map(t => (
              <button key={t.key} className={`tab${drawerTab === t.key ? ' active' : ''}`} onClick={() => setDrawerTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {drawerTab === 'overview' && (
            <div className="kv-grid">
              {entry.detailFields.map(f => (
                <div className="kv" key={f.k}>
                  <span className="k">{f.k}</span>
                  <span className="v">{f.v(selLive)}</span>
                </div>
              ))}
              <div className="kv">
                <span className="k">标签</span>
                <span className="v mono" style={{ fontSize: 11 }}>
                  {Object.keys(selLive.metadata.labels).length
                    ? Object.entries(selLive.metadata.labels).map(([k, v]) => `${k}=${v}`).join('  ')
                    : '—'}
                </span>
              </div>
              <div className="kv">
                <span className="k">注解</span>
                <span className="v mono" style={{ fontSize: 11 }}>
                  {Object.keys(selLive.metadata.annotations).length
                    ? Object.entries(selLive.metadata.annotations).map(([k, v]) => `${k}=${v}`).join('  ')
                    : '—'}
                </span>
              </div>
            </div>
          )}

          {drawerTab === 'yaml' && (
            <YamlEditor
              key={`${selLive.metadata.namespace ?? ''}/${selLive.metadata.name}`}
              original={yamlForObject(selLive)}
              onApply={text => activeProvider().apply(entryGvkRef(entry), selLive.metadata.namespace, selLive.metadata.name, text)}
            />
          )}

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

          {drawerTab === 'logs' &&
            (podInfo ? (
              <LogViewer pods={[podInfo]} fetchLog={src.mode === 'cluster' ? fetchPodLogs : undefined} />
            ) : (
              <div className="dim" style={{ padding: 20, textAlign: 'center' }}>该 Pod 已不在运行列表中,无法读取日志</div>
            ))}
        </Drawer>
      )}

      {delTarget && (
        <Modal title={`删除 ${entry.kind} · ${delTarget.name}`} onClose={() => setDelTarget(null)}>
          <p style={{ fontSize: 12, lineHeight: 1.7, margin: '0 0 10px' }}>
            即将删除 <b className="mono">{delTarget.name}</b>
            {delTarget.namespace ? <>(命名空间 <span className="mono">{delTarget.namespace}</span>)</> : '(集群级资源)'}。
            {entry.kind === 'Pod' && !forceDelete && '普通删除会先进入 Terminating 优雅终止,控制器随后重建替换副本。'}
            {entry.kind === 'Pod' && forceDelete && '强制删除立即移除对象(gracePeriod=0),可绕过 PodDisruptionBudget 对驱逐的阻塞。'}
          </p>
          <label className="force-check">
            <input type="checkbox" checked={forceDelete} onChange={e => setForceDelete(e.target.checked)} />
            强制删除(gracePeriod = 0,跳过优雅终止)
          </label>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDelTarget(null)}>取消</button>
            <button
              className="btn danger"
              onClick={() => {
                void activeProvider().delete(entryGvkRef(entry), delTarget.namespace, delTarget.name, { force: forceDelete })
                setDelTarget(null)
                setSelected(null)
              }}
            >
              确认删除
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default function Explorer() {
  const ns = useStore(s => s.namespace)
  const [params] = useSearchParams()

  const gvkParam = params.get('gvk')
  const entry = gvkParam ? byId.get(gvkParam) : undefined
  const groupParam = params.get('group')
  const kindParam = params.get('kind')

  const isRich = !!entry
    ? richWorkloadKinds.includes(entry.kind)
    : groupParam === 'workloads' || (!groupParam && !gvkParam)

  const richKind: WorkloadKind = richWorkloadKinds.includes(kindParam ?? '')
    ? (kindParam as WorkloadKind)
    : entry && richWorkloadKinds.includes(entry.kind)
      ? (entry.kind as WorkloadKind)
      : 'Deployment'

  const genericEntry = !isRich ? entry ?? registry.find(e => e.category === groupParam) : undefined

  const meta = isRich
    ? workloadKindMeta[richKind]
    : genericEntry
      ? {
          cn: genericEntry.cn,
          en: genericEntry.plural.toUpperCase(),
          desc: `${genericEntry.group ? `${genericEntry.group}/${genericEntry.version}` : genericEntry.version} · ${genericEntry.namespaced ? '命名空间级资源' : '集群级资源'}`,
        }
      : { cn: '资源浏览器', en: 'EXPLORER', desc: '从左侧导航选择一种资源开始浏览' }

  return (
    <div className="resource-page">
      <header className="page-head">
        <div>
          <h1 className="page-title">
            {meta.cn} <span className="en">{meta.en}</span>
          </h1>
          <p className={`page-desc${isRich ? '' : ' mono'}`}>{meta.desc}</p>
        </div>
      </header>

      {isRich ? (
        <WorkloadsPanel kind={richKind} />
      ) : genericEntry ? (
        <GenericList key={entryId(genericEntry)} entry={genericEntry} ns={ns} />
      ) : (
        <div className="card dim table-empty">从左侧导航选择一种资源开始浏览</div>
      )}
    </div>
  )
}