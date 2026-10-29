import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { current, useStore, setCluster } from '../mock/store'

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

const navGroups = [
  {
    name: '集群',
    items: [
      { to: '/dashboard', label: '集群总览', en: 'OVERVIEW' },
      { to: '/workloads', label: '工作负载', en: 'WORKLOADS' },
      { to: '/events', label: '事件流', en: 'EVENTS' },
    ],
  },
  {
    name: '交付',
    items: [
      { to: '/releases', label: '发布生命周期', en: 'RELEASES' },
      { to: '/assistant', label: 'AI 运维助手', en: 'QWAPP AI' },
    ],
  },
]

const glyphs: Record<string, JSX.Element> = {
  '/dashboard': (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="3" width="8" height="5" rx="1" />
      <rect x="13" y="10" width="8" height="11" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" />
    </svg>
  ),
  '/workloads': (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5Z" />
      <path d="M12 12 20 7M12 12v9.5M12 12 4 7" />
    </svg>
  ),
  '/events': (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 12h4l2.5-6 4 12L16 12h5" />
    </svg>
  ),
  '/assistant': (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4L12 3Z" />
      <path d="M18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z" />
    </svg>
  ),
  '/releases': (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M5 12h14M13 6l6 6-6 6" />
      <path d="M4 4v16" strokeDasharray="3 2" />
    </svg>
  ),
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

export default function Layout() {
  const clusters = useStore(s => s.clusters)
  const active = useStore(s => s.activeCluster)
  const cluster = clusters[active]
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark')
  const [now, setNow] = useState(() => new Date())
  const [q, setQ] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        setSearchOpen(true)
      }
      if (e.key === 'Escape') {
        setSearchOpen(false)
        setQ('')
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const hits = q.trim()
    ? current().workloads.filter(w => w.name.includes(q.trim()) || w.image.includes(q.trim()) || w.namespace.includes(q.trim())).slice(0, 6)
    : []

  function go(w: { kind: string; name: string }) {
    setSearchOpen(false)
    setQ('')
    navigate(`/workloads?q=${encodeURIComponent(w.name)}`)
  }

  function toggleTheme() {
    const next = dark ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    localStorage.setItem('k8q-theme', next)
    setDark(!dark)
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <HelmIcon />
          <div>
            <div className="logo-name">K8Q</div>
            <div className="logo-sub">QWAPP FOR KUBERNETES</div>
          </div>
        </div>
        <nav className="nav">
          {navGroups.map(g => (
            <div key={g.name}>
              <div className="nav-group">{g.name}</div>
              {g.items.map(item => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                  {glyphs[item.to]}
                  {item.label}
                  <span className="nav-en">{item.en}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          K8Q MVP v0.3.0
          <br />
          MOCK DATA · 仅演示
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="cluster-select">
            <span className="dot" />
            <select value={active} onChange={e => setCluster(Number(e.target.value))}>
              {clusters.map((c, i) => (
                <option key={c.id} value={i}>
                  {c.name} · {c.version}
                </option>
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
              placeholder="搜索资源 / 命名空间 / 镜像…"
              value={q}
              onChange={e => { setQ(e.target.value); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              onKeyDown={e => {
                if (e.key === 'Enter' && hits[0]) go(hits[0])
              }}
            />
            <kbd>⌘K</kbd>
            {searchOpen && hits.length > 0 && (
              <div className="search-pop">
                {hits.map(w => (
                  <button key={w.id} className="search-hit" onMouseDown={() => go(w)}>
                    <span className="name-cell">{w.name}</span>
                    <span className="mono dim" style={{ fontSize: 10.5 }}>{w.kind} · {w.namespace}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="topbar-right">
            <span className="mono" style={{ fontSize: 11 }}>
              {cluster.region} · {cluster.provider}
            </span>
            <span className="ai-pill">
              <span className="dot" />
              QWAPP 已连接
            </span>
            <button className="icon-btn" onClick={toggleTheme} title={dark ? '切换为浅色' : '切换为暗夜'}>
              <ThemeIcon dark={dark} />
            </button>
            <span className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {now.toLocaleTimeString('zh-CN', { hour12: false })}
            </span>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
