import { useEffect, useRef, useState } from 'react'

export interface ListColumn<T> {
  title: string
  key: string
  width?: number
  value: (row: T) => string | number
  render?: (row: T) => React.ReactNode
}

/** 列显隐:按 key 持久化到 localStorage,首列(名称)锁定不可隐藏 */
export function useColumnVisibility(storageKey: string, allKeys: string[]): [Set<string>, (k: string) => void] {
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      return new Set()
    }
  })
  const visible = new Set(allKeys.filter(k => !hidden.has(k)))
  function toggle(k: string) {
    if (k === allKeys[0]) return
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]))
      } catch {
        /* localStorage 不可用时静默 */
      }
      return next
    })
  }
  return [visible, toggle]
}

export function ColumnSettings<T>({
  cols,
  visible,
  onToggle,
}: {
  cols: ListColumn<T>[]
  visible: Set<string>
  onToggle: (k: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <div className="col-settings" ref={ref}>
      <button className={`btn${open ? ' primary' : ''}`} onClick={() => setOpen(!open)}>
        列设置
      </button>
      {open && (
        <div className="col-pop">
          {cols.map((c, i) => (
            <label key={c.key}>
              <input type="checkbox" checked={visible.has(c.key)} disabled={i === 0} onChange={() => onToggle(c.key)} />
              {c.title}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 导出 CSV:加 BOM 保证 Excel 打开中文不乱码 */
export function exportCsv<T>(filename: string, cols: ListColumn<T>[], rows: T[]) {
  const lines = [cols.map(c => csvCell(c.title)).join(',')]
  for (const r of rows) lines.push(cols.map(c => csvCell(c.value(r))).join(','))
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function csvTimestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
