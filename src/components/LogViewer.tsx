import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtLogTs, logBacklog, nextLogLines, type LogLevel, type LogLine } from '../mock/logs'
import type { PodInfo } from '../types'

const levelRank: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 }
const levelCls: Record<LogLevel, string> = { DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'err' }

export default function LogViewer({ pods }: { pods: PodInfo[] }) {
  const [podName, setPodName] = useState(pods[0]?.name ?? '')
  const [minLevel, setMinLevel] = useState<LogLevel>('DEBUG')
  const [query, setQuery] = useState('')
  const [follow, setFollow] = useState(true)
  const [wrap, setWrap] = useState(false)
  const [extra, setExtra] = useState<LogLine[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const pod = pods.find(p => p.name === podName) ?? pods[0]
  const backlog = useMemo(() => (pod ? logBacklog(pod) : []), [pod?.name])

  useEffect(() => {
    setExtra([])
    setQuery('')
  }, [podName])

  useEffect(() => {
    if (!follow || !pod) return
    const t = setInterval(() => {
      setExtra(prev => [...prev, ...nextLogLines(pod, pod.restarts)].slice(-600))
    }, 1400)
    return () => clearInterval(t)
  }, [follow, pod?.name, pod?.phase])

  const all = useMemo(() => [...backlog, ...extra], [backlog, extra])
  const shown = useMemo(
    () =>
      all.filter(
        l =>
          levelRank[l.level] >= levelRank[minLevel] &&
          (!query || l.msg.toLowerCase().includes(query.toLowerCase())),
      ),
    [all, minLevel, query],
  )

  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [shown.length, follow])

  function download() {
    const text = shown.map(l => `${new Date(l.ts).toISOString()} ${l.level.padEnd(5)} ${l.msg}`).join('\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${pod?.name ?? 'pod'}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!pod) return <div className="dim" style={{ padding: 20, textAlign: 'center' }}>该工作负载没有可调度的 Pod</div>

  const errCount = all.filter(l => l.level === 'ERROR').length
  const warnCount = all.filter(l => l.level === 'WARN').length

  return (
    <div>
      <div className="log-toolbar">
        <select
          className="toolbar-select mono"
          style={{ maxWidth: 168, fontSize: 11 }}
          value={podName}
          onChange={e => setPodName(e.target.value)}
        >
          {pods.map(p => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <select className="toolbar-select" value={minLevel} onChange={e => setMinLevel(e.target.value as LogLevel)}>
          <option value="DEBUG">DEBUG+</option>
          <option value="INFO">INFO+</option>
          <option value="WARN">WARN+</option>
          <option value="ERROR">仅 ERROR</option>
        </select>
        <input
          className="toolbar-input"
          style={{ width: 118 }}
          placeholder="过滤日志…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <span className="spacer" />
        <button className={`btn${wrap ? ' primary' : ''}`} onClick={() => setWrap(!wrap)} title="切换自动换行">
          换行
        </button>
        <button className="btn" onClick={download}>
          下载
        </button>
      </div>
      <div className="log-meta">
        <span className="mono">{shown.length} / {all.length} 行</span>
        <span className="mono log-meta-err">ERROR {errCount}</span>
        <span className="mono log-meta-warn">WARN {warnCount}</span>
        <span className="dim">近 32 分钟 · 容器 main</span>
        <span className="spacer" style={{ flex: 1 }} />
        <button className={`btn${follow ? ' primary' : ''}`} style={{ padding: '3px 10px' }} onClick={() => setFollow(!follow)}>
          {follow ? '● 直播中' : '已暂停'}
        </button>
      </div>
      <div className={`log-pane${wrap ? ' wrap' : ''}`} ref={scrollRef}>
        {shown.map((l, i) => (
          <div className="log-line" key={`${l.ts}-${i}`}>
            <span className="log-ts">{fmtLogTs(l.ts)}</span>
            <span className={`log-level ${levelCls[l.level]}`}>{l.level}</span>
            <span className="log-msg">{l.msg}</span>
          </div>
        ))}
        {shown.length === 0 && <div className="log-empty">当前过滤条件下没有日志 — 放宽级别或清除关键字</div>}
      </div>
    </div>
  )
}
