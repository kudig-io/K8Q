import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { activeProvider, initSource, setSourceContext, setSourceMode, sourceState, subscribeSource, useSourceData } from '../data/dataSource'
import { setCluster, setNamespace, useStore } from '../data/mock/store'
import { byId, entryGvkRef, entryId, registry, richWorkloadKinds, type GvkEntry } from '../data/registry'
import { relTime } from './common'
import CreateResource from './CreateResource'

const APP_VERSION = 'v0.8.0'

function HelmIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8.4" strokeDasharray="3.2 2.4" />
      {Array.from({ length: 7 }, (_, i) => {
        const a = (i * (360 / 7) * Math.PI) / 180
        return (
          <line
            key={i}
            x1={12 + Math.cos(a) * 3}
            y1={12 + Math.sin(a) * 3}
            x2={12 + Math.cos(a) * 8.4}
            y2={12 + Math.sin(a) * 8.4}
          />
        )
      })}
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

const stroke = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const groupIcons: Record<string, JSX.Element> = {
  overview: (
    <svg {...stroke}>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="3" width="8" height="5" rx="1" />
      <rect x="13" y="10" width="8" height="11" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" />
    </svg>
  ),
  workloads: (
    <svg {...stroke}>
      <path d="M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5Z" />
      <path d="M12 12 20 7M12 12v9.5M12 12 4 7" />
    </svg>
  ),
  network: (
    <svg {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.6 2.5 4 5.7 4 9s-1.4 6.5-4 9c-2.6-2.5-4-5.7-4-9s1.4-6.5 4-9Z" />
    </svg>
  ),
  config: (
    <svg {...stroke}>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  ),
  storage: (
    <svg {...stroke}>
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
      <path d="M4 11.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </svg>
  ),
  cluster: (
    <svg {...stroke}>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <path d="M7 7h.01M7 17h.01" />
    </svg>
  ),
  security: (
    <svg {...stroke}>
      <path d="M12 3 20 6v6c0 5-3.4 7.8-8 9-4.6-1.2-8-4-8-9V6l8-3Z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  crd: (
    <svg {...stroke}>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  delivery: (
    <svg {...stroke}>
      <path d="M5 12h14M13 6l6 6-6 6" />
      <path d="M4 4v16" strokeDasharray="3 2" />
    </svg>
  ),
}

const chevron = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 5l8 7-8 7" />
  </svg>
)

interface NavPage {
  key: string
  label: string
  to: string
}

const pageItems: Record<string, NavPage[]> = {
  overview: [
    { key: 'page:dashboard', label: '集群总览', to: '/dashboard' },
    { key: 'page:events', label: '事件流', to: '/events' },
  ],
  delivery: [
    { key: 'page:releases', label: '发布生命周期', to: '/releases' },
    { key: 'page:assistant', label: 'AI 运维助手', to: '/assistant' },
  ],
}

const groups: { key: string; label: string; en: string }[] = [
  { key: 'overview', label: '概览', en: 'OVERVIEW' },
  { key: 'workloads', label: '工作负载', en: 'WORKLOADS' },
  { key: 'network', label: '网络', en: 'NETWORK' },
  { key: 'config', label: '配置', en: 'CONFIG' },
  { key: 'storage', label: '存储', en: 'STORAGE' },
  { key: 'cluster', label: '集群', en: 'CLUSTER' },
  { key: 'rbac', label: '安全与 RBAC', en: 'SECURITY' },
  { key: 'crd', label: '自定义资源', en: 'CUSTOM' },
  { key: 'delivery', label: '交付', en: 'DELIVERY' },
]

/** 资源组内的阅读顺序:与 kubectl 使用习惯一致,而非注册表声明顺序 */
const kindOrder: Record<string, string[]> = {
  workloads: ['Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob'],
  network: ['Service', 'Endpoints', 'EndpointSlice', 'Ingress', 'IngressClass', 'NetworkPolicy'],
  storage: ['PersistentVolume', 'PersistentVolumeClaim', 'StorageClass'],
  config: ['ConfigMap', 'Secret', 'ServiceAccount', 'ResourceQuota', 'LimitRange', 'HorizontalPodAutoscaler', 'PodDisruptionBudget'],
  cluster: ['Node', 'Namespace', 'PriorityClass', 'RuntimeClass'],
  rbac: ['Role', 'ClusterRole', 'RoleBinding', 'ClusterRoleBinding'],
  crd: ['Certificate', 'Rollout', 'Application'],
}

function entriesOf(group: string): GvkEntry[] {
  const order = kindOrder[group] ?? []
  const rank = (kind: string) => {
    const i = order.indexOf(kind)
    return i === -1 ? 999 : i
  }
  return registry.filter(e => e.category === group).sort((a, b) => rank(a.kind) - rank(b.kind))
}

function targetOf(entry: GvkEntry): string {
  return richWorkloadKinds.includes(entry.kind)
    ? `/explorer?group=workloads&kind=${entry.kind}`
    : `/explorer?gvk=${encodeURIComponent(entryId(entry))}`
}

function navKeyOf(entry: GvkEntry): string {
  return richWorkloadKinds.includes(entry.kind) ? `kind:${entry.kind}` : `gvk:${entryId(entry)}`
}

function activeKeyOf(pathname: string, search: string): string {
  if (pathname === '/explorer' || pathname === '/workloads') {
    if (pathname === '/workloads') return 'kind:Deployment'
    const p = new URLSearchParams(search)
    const gvk = p.get('gvk')
    if (gvk) return `gvk:${gvk}`
    const kind = p.get('kind')
    if (kind && (richWorkloadKinds as string[]).includes(kind)) return `kind:${kind}`
    return 'kind:Deployment'
  }
  return (
    {
      '/dashboard': 'page:dashboard',
      '/events': 'page:events',
      '/releases': 'page:releases',
      '/assistant': 'page:assistant',
    }[pathname] ?? ''
  )
}

function readExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem('k8q.nav.expanded')
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {
    /* ignore corrupted state */
  }
  return new Set(['overview', 'workloads'])
}

function ThemeIcon({ dark }: { dark: boolean }) {
  return dark ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
    </svg>
  )
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className="mono topbar-clock" style={{ fontVariantNumeric: 'tabular-nums' }}>
      {now.toLocaleTimeString('zh-CN', { hour12: false })}
    </span>
  )
}

interface Hit {
  key: string
  name: string
  kind: string
  namespace?: string
  to: string
  score: number
}

export default function Layout() {
  const clusters = useStore(s => s.clusters)
  const active = useStore(s => s.activeCluster)
  const ns = useStore(s => s.namespace)
  const cluster = clusters[active]
  const src = useSourceData()
  const srcState = useSyncExternalStore(subscribeSource, sourceState)
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark')
  const [q, setQ] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [hitIdx, setHitIdx] = useState(0)
  const [navOpen, setNavOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(readExpanded)
  const searchRef = useRef<HTMLInputElement>(null)
  const activeGroupRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  const activeKey = activeKeyOf(location.pathname, location.search)
  const activeGroup = groups.find(g => {
    if (pageItems[g.key]) return pageItems[g.key].some(i => i.key === activeKey)
    return entriesOf(g.key).some(e => navKeyOf(e) === activeKey)
  })?.key

  useEffect(() => {
    localStorage.setItem('k8q.nav.expanded', JSON.stringify([...expanded]))
  }, [expanded])

  // 当前页所在分组始终展开,保证刷新后能立刻看到自己的位置
  useEffect(() => {
    if (!activeGroup) return
    setExpanded(prev => (prev.has(activeGroup) ? prev : new Set(prev).add(activeGroup)))
  }, [activeGroup])

  useEffect(() => {
    setNavOpen(false)
  }, [location.pathname, location.search])

  // 当前分组始终可见:分组展开后把分组头滚入视口,激活项随之可见
  useEffect(() => {
    activeGroupRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeKey, activeGroup])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        setSearchOpen(true)
      }
      if (e.key === 'Escape') {
        setSearchOpen(false)
        setNavOpen(false)
        setQ('')
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    void initSource()
  }, [])

  const term = q.trim().toLowerCase()
  const hits: Hit[] = []
  const rank = (name: string, image?: string): number => {
    const n = name.toLowerCase()
    if (n === term) return 0
    if (n.startsWith(term)) return 1
    if (n.includes(term)) return 2
    if (image && image.toLowerCase().includes(term)) return 3
    return -1
  }
  if (term) {
    for (const w of src.workloads) {
      if (ns !== '全部' && w.namespace !== ns) continue
      const score = rank(w.name, w.image)
      if (score === -1) continue
      hits.push({
        key: `wl:${w.id}`,
        name: w.name,
        kind: w.kind,
        namespace: w.namespace,
        to: `/explorer?group=workloads&kind=${w.kind}&q=${encodeURIComponent(w.name)}`,
        score,
      })
    }
    for (const entry of registry) {
      if (richWorkloadKinds.includes(entry.kind)) continue
      const objs = activeProvider().list(entryGvkRef(entry), {
        namespace: entry.namespaced && ns !== '全部' ? ns : undefined,
      })
      for (const o of objs) {
        const score = rank(o.metadata.name)
        if (score === -1) continue
        hits.push({
          key: `${entryId(entry)}:${o.metadata.namespace ?? ''}:${o.metadata.name}`,
          name: o.metadata.name,
          kind: entry.kind,
          namespace: o.metadata.namespace,
          to: `${targetOf(entry)}&q=${encodeURIComponent(o.metadata.name)}`,
          score,
        })
      }
    }
  }
  hits.sort((a, b) => a.score - b.score || a.name.length - b.name.length || a.kind.localeCompare(b.kind))
  const visibleHits = hits.slice(0, 8)

  useEffect(() => {
    setHitIdx(0)
  }, [q])

  function pickSource(value: string) {
    if (value === 'mock') {
      setSourceMode('mock')
      return
    }
    if (value.startsWith('cluster:')) {
      const ctx = value.slice('cluster:'.length)
      setSourceContext(ctx)
      setSourceMode('cluster')
    }
  }

  const sourceValue = src.mode === 'cluster' ? `cluster:${srcState.context ?? ''}` : 'mock'
  const sourceDot = src.mode === 'mock' ? ' amber' : src.status === 'ready' ? '' : src.status === 'connecting' ? ' blue' : ' red'

  function go(hit: Hit) {
    setSearchOpen(false)
    setQ('')
    navigate(hit.to)
  }

  function toggleTheme() {
    const next = dark ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    localStorage.setItem('k8q-theme', next)
    setDark(!dark)
  }

  function toggleGroup(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function countOf(entry: GvkEntry): number {
    if (richWorkloadKinds.includes(entry.kind)) {
      return src.workloads.filter(w => w.kind === entry.kind && (ns === '全部' || w.namespace === ns)).length
    }
    return activeProvider().list(entryGvkRef(entry), {
      namespace: entry.namespaced && ns !== '全部' ? ns : undefined,
    }).length
  }

  const gvkEntry =
    location.pathname === '/explorer' ? byId.get(new URLSearchParams(location.search).get('gvk') ?? '') : undefined
  const nsDisabled = !!gvkEntry && !gvkEntry.namespaced

  return (
    <div className="app">
      <aside className={`sidebar${navOpen ? ' open' : ''}`}>
        <div className="logo">
          <HelmIcon />
          <div>
            <div className="logo-name">K8Q</div>
            <div className="logo-sub">QWAPP FOR KUBERNETES</div>
          </div>
        </div>

        <div className="sidebar-scroll">
          <nav className="nav" aria-label="集群资源导航">
            {groups.map(g => {
              const identityPage = pageItems[g.key]
              const entries = identityPage ? [] : entriesOf(g.key)
              const isOpen = expanded.has(g.key)
              return (
                <div className="nav-group" key={g.key} ref={activeGroup === g.key ? activeGroupRef : undefined}>
                  <button
                    type="button"
                    className={`nav-group-head${activeGroup === g.key ? ' current' : ''}`}
                    aria-expanded={isOpen}
                    onClick={() => toggleGroup(g.key)}
                  >
                    <span className="nav-chevron">{chevron}</span>
                    <span className="nav-group-icon">{groupIcons[g.key]}</span>
                    <span className="nav-group-label">{g.label}</span>
                    <span className="nav-group-en">{g.en}</span>
                  </button>
                  {isOpen && (
                    <div className="nav-items">
                      {identityPage?.map(item => (
                        <Link
                          key={item.key}
                          to={item.to}
                          aria-current={activeKey === item.key ? 'page' : undefined}
                          className={`nav-item${activeKey === item.key ? ' active' : ''}`}
                        >
                          {item.label}
                          {item.key === 'page:events' && <span className="nav-count">{src.events.length}</span>}
                        </Link>
                      ))}
                      {entries.map(entry => (
                        <Link
                          key={entryId(entry)}
                          to={targetOf(entry)}
                          aria-current={activeKey === navKeyOf(entry) ? 'page' : undefined}
                          className={`nav-item${activeKey === navKeyOf(entry) ? ' active' : ''}`}
                          title={`${entry.cn} · ${entry.kind} · ${entry.plural}`}
                        >
                          {entry.cn}
                          <span className="nav-count">{countOf(entry)}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>
        </div>

        <div className="sidebar-foot">
          <button type="button" className="btn primary sidebar-create" onClick={() => setCreateOpen(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            创建资源
          </button>
          <div className="sidebar-foot-meta">
            K8Q {APP_VERSION} · {src.mode === 'cluster' ? 'CLUSTER' : 'MOCK'}
            <br />
            {src.mode === 'cluster' ? srcState.context ?? '—' : '演示数据集 · 仅用于预览'}
          </div>
        </div>
      </aside>

      {navOpen && <div className="nav-mask" onClick={() => setNavOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn menu-btn"
            aria-label="打开导航"
            onClick={() => setNavOpen(v => !v)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="cluster-select" title="数据源:mock 演示或真实集群(经本机 node 桥)">
            <span className={`dot${sourceDot}`} />
            <select value={sourceValue} onChange={e => pickSource(e.target.value)}>
              <option value="mock">Mock 演示数据</option>
              {(srcState.health?.contexts ?? []).map(c => (
                <option key={c.name} value={`cluster:${c.name}`}>
                  集群 · {c.name}
                </option>
              ))}
              {srcState.bridgeChecked && !srcState.health && <option value="bridge-missing" disabled>未发现 K8Q 桥(需 kubectl + 千问办公)</option>}
            </select>
          </div>
          {src.mode === 'mock' && (
            <div className="cluster-select cluster-select-mock">
              <span className="dot" />
              <select value={active} onChange={e => setCluster(Number(e.target.value))}>
                {clusters.map((c, i) => (
                  <option key={c.id} value={i}>
                    {c.name} · {c.version}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={`cluster-select${nsDisabled ? ' disabled' : ''}`} title={nsDisabled ? '当前资源为集群级,命名空间过滤不适用' : '全局命名空间过滤'}>
            <span className="ns-tag">NS</span>
            <select value={nsDisabled ? '全部' : ns} disabled={nsDisabled} onChange={e => setNamespace(e.target.value)}>
              {['全部', ...src.namespaces].map(n => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="search-box">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={searchRef}
              placeholder="搜索全部资源…"
              value={q}
              onChange={e => { setQ(e.target.value); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setHitIdx(i => Math.min(i + 1, visibleHits.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setHitIdx(i => Math.max(i - 1, 0))
                } else if (e.key === 'Enter' && visibleHits[hitIdx]) {
                  go(visibleHits[hitIdx])
                }
              }}
            />
            <kbd>⌘K</kbd>
            {searchOpen && visibleHits.length > 0 && (
              <div className="search-pop">
                {visibleHits.map((h, i) => (
                  <button
                    key={h.key}
                    type="button"
                    className={`search-hit${i === hitIdx ? ' active' : ''}`}
                    onMouseEnter={() => setHitIdx(i)}
                    onMouseDown={() => go(h)}
                  >
                    <span className="name-cell">{h.name}</span>
                    <span className="mono dim search-hit-meta">
                      {h.kind}
                      {h.namespace ? ` · ${h.namespace}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="topbar-right">
            {src.mode === 'cluster' ? (
              <span className="mono topbar-sync">
                {src.status === 'ready'
                  ? `已同步 · ${relTime(src.lastSyncTs || Date.now())}`
                  : src.status === 'connecting'
                    ? '连接集群中…'
                    : `同步失败:${(src.error ?? '').slice(0, 40)}`}
              </span>
            ) : (
              <span className="mono topbar-sync">
                {cluster.region} · {cluster.provider}
              </span>
            )}
            <span className="ai-pill">
              <span className="dot" />
              QWAPP 已连接
            </span>
            <button className="icon-btn" onClick={toggleTheme} title={dark ? '切换为浅色' : '切换为暗夜'}>
              <ThemeIcon dark={dark} />
            </button>
            <Clock />
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>

      {createOpen && <CreateResource onClose={() => setCreateOpen(false)} />}
    </div>
  )
}