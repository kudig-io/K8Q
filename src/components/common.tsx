import { useEffect, type ReactNode } from 'react'

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

export function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  useEscape(onClose)
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

export function Drawer({ title, sub, onClose, actions, children }: {
  title: string
  sub?: string
  onClose: () => void
  actions?: ReactNode
  children: ReactNode
}) {
  useEscape(onClose)
  return (
    <>
      <div className="drawer-mask" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <h3 className="drawer-title">{title}</h3>
            {sub && <div className="drawer-sub">{sub}</div>}
          </div>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">{children}</div>
        {actions && <div className="drawer-actions">{actions}</div>}
      </div>
    </>
  )
}

function highlightYaml(yaml: string): ReactNode[] {
  return yaml.split('\n').map((line, i) => {
    let node: ReactNode = line
    const m = line.match(/^(\s*)([\w./-]+)(:)(\s*(.*))$/)
    if (m) {
      const [, indent, key, colon, rest] = m
      let val: ReactNode = rest
      const trimmed = rest.trim()
      if (/^"?'?[\w./:-]+"?$/.test(trimmed) && trimmed) {
        val = <span className="yaml-str">{rest}</span>
      }
      node = (
        <>
          {indent}
          <span className="yaml-key">{key}</span>
          {colon}
          {val}
        </>
      )
    } else if (/^\s*-/.test(line)) {
      node = <span className="yaml-str">{line}</span>
    }
    return <div key={i}>{node}</div>
  })
}

export function YamlView({ yaml }: { yaml: string }) {
  return <pre className="yaml-view">{highlightYaml(yaml)}</pre>
}

export function age(min: number): string {
  if (min < 60) return `${min}m`
  if (min < 60 * 24) return `${Math.floor(min / 60)}h`
  return `${Math.floor(min / 60 / 24)}d`
}

export function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s前`
  if (s < 3600) return `${Math.floor(s / 60)}m前`
  if (s < 86400) return `${Math.floor(s / 3600)}h前`
  return `${Math.floor(s / 86400)}d前`
}
