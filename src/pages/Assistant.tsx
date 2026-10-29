import { useEffect, useRef, useState } from 'react'
import { qwapp } from '../ai/qwapp'
import { current, useStore } from '../mock/store'
import type { ChatMessage, ChatSession } from '../types'
import { uid } from '../mock/seed'

function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`')) return <code key={`${keyPrefix}-${i}`}>{p.slice(1, -1)}</code>
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={`${keyPrefix}-${i}`}>{p.slice(2, -2)}</strong>
    return p
  })
}

function renderMarkdown(md: string) {
  const segments: Array<{ type: 'text' | 'code'; body: string }> = []
  const re = /```\w*\n([\s\S]*?)```/g
  let last = 0
  for (const m of md.matchAll(re)) {
    if (m.index > last) segments.push({ type: 'text', body: md.slice(last, m.index) })
    segments.push({ type: 'code', body: m[1].replace(/\n$/, '') })
    last = m.index + m[0].length
  }
  if (last < md.length) segments.push({ type: 'text', body: md.slice(last) })

  const out: JSX.Element[] = []
  segments.forEach((seg, si) => {
    if (seg.type === 'code') {
      out.push(
        <pre key={`code-${si}`}>
          <code>{seg.body}</code>
        </pre>,
      )
      return
    }
    const lines = seg.body.split('\n')
    let list: string[] = []
    const flush = (idx: number) => {
      if (list.length) {
        out.push(
          <ol key={`list-${si}-${idx}`}>
            {list.map((li, j) => (
              <li key={j}>{renderInline(li, `${si}-${idx}-${j}`)}</li>
            ))}
          </ol>,
        )
        list = []
      }
    }
    lines.forEach((line, li) => {
      const m = line.match(/^\d+\.\s+(.*)$/) || line.match(/^[-*]\s+(.*)$/)
      if (m) {
        list.push(m[1])
      } else {
        flush(li)
        if (line.trim()) out.push(<p key={`p-${si}-${li}`}>{renderInline(line, `${si}-${li}`)}</p>)
      }
    })
    flush(-1)
  })
  return out
}

const quickActions = [
  { title: '诊断 CrashLoopBackOff', desc: '结合当前集群事件流分析异常 Pod', prompt: '帮我诊断当前集群里的 CrashLoopBackOff 问题' },
  { title: 'OOMKilled 排查', desc: '退出码 137 的内存水位建议', prompt: 'payment-core 的 Pod 老是 OOMKilled,怎么排查?' },
  { title: '生成 Deployment YAML', desc: '生产可用的工作负载模板', prompt: '帮我生成一个生产可用的 Deployment YAML' },
  { title: 'HPA 弹性伸缩建议', desc: '自动扩缩容配置与防抖动', prompt: '给我一个 HPA 的配置建议和模板' },
  { title: '安全回滚流程', desc: '版本回退的正确姿势', prompt: '发布出问题了,怎么安全回滚?' },
  { title: '节点水位体检', desc: 'CPU/内存分配率与扩容建议', prompt: '帮我看看节点水位,需要扩容吗?' },
]

export default function Assistant() {
  useStore(s => s.activeCluster)
  const cluster = current()
  const [sessions, setSessions] = useState<ChatSession[]>([
    { id: uid(), title: '日常巡检咨询', createdAt: Date.now(), messages: [] },
  ])
  const [activeId, setActiveId] = useState(sessions[0].id)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const active = sessions.find(s => s.id === activeId)!

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [active.messages])

  async function send(text: string) {
    if (!text.trim() || busy) return
    setBusy(true)
    setInput('')
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: text }
    const aiMsg: ChatMessage = { id: uid(), role: 'assistant', content: '', streaming: true }
    setSessions(prev =>
      prev.map(s =>
        s.id === activeId
          ? { ...s, title: s.messages.length === 0 ? text.slice(0, 18) : s.title, messages: [...s.messages, userMsg, aiMsg] }
          : s,
      ),
    )
    const history = [...active.messages, userMsg].map(m => ({ role: m.role, content: m.content }))
    await qwapp.chat({
      messages: history,
      onToken: token => {
        setSessions(prev =>
          prev.map(s =>
            s.id === activeId
              ? { ...s, messages: s.messages.map(m => (m.id === aiMsg.id ? { ...m, content: m.content + token } : m)) }
              : s,
          ),
        )
      },
    })
    setSessions(prev =>
      prev.map(s =>
        s.id === activeId
          ? { ...s, messages: s.messages.map(m => (m.id === aiMsg.id ? { ...m, streaming: false } : m)) }
          : s,
      ),
    )
    setBusy(false)
  }

  const badPods = cluster.workloads.flatMap(w => w.pods).filter(p => p.phase === 'CrashLoopBackOff').length
  const warns = cluster.events.filter(e => e.type === 'Warning').length

  return (
    <div>
      <h1 className="page-title">AI 运维助手 <span className="en">QWAPP COPILOT</span></h1>
      <p className="page-desc">基于 QWAPP SDK(mock)的集群诊断与 YAML 生成 · 接入真实 SDK 仅需替换 src/ai/qwapp.ts 中的实现</p>

      <div className="assistant-layout">
        <div className="card" style={{ padding: 12 }}>
          <button
            className="btn primary"
            style={{ width: '100%', marginBottom: 10 }}
            onClick={() => {
              const s: ChatSession = { id: uid(), title: '新会话', createdAt: Date.now(), messages: [] }
              setSessions(prev => [s, ...prev])
              setActiveId(s.id)
            }}
          >
            + 新会话
          </button>
          <div className="chat-list">
            {sessions.map(s => (
              <div key={s.id} className={`chat-item${s.id === activeId ? ' active' : ''}`} onClick={() => setActiveId(s.id)}>
                {s.title}
                <div className="t">{s.messages.length} 条消息</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card chat-panel">
          <div className="chat-scroll" ref={scrollRef}>
            {active.messages.length === 0 && (
              <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-3)', maxWidth: 380 }}>
                <div style={{ fontSize: 18, color: 'var(--text)', marginBottom: 8 }}>
                  你好,我是 QWAPP
                </div>
                问我任何关于当前集群的问题:故障诊断、YAML 生成、容量规划、发布策略。试试右侧的快捷诊断。
              </div>
            )}
            {active.messages.map(m => (
              <div key={m.id} className={`msg ${m.role}`}>
                {renderMarkdown(m.content)}
                {m.streaming && <span className="cursor-blink" />}
              </div>
            ))}
          </div>
          <div className="chat-input-row">
            <textarea
              placeholder="输入问题,Enter 发送…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(input)
                }
              }}
            />
            <button className="btn primary" style={{ height: 46, padding: '0 20px' }} disabled={busy} onClick={() => send(input)}>
              发送
            </button>
          </div>
        </div>

        <div className="card" >
          <h4 className="card-title">快捷诊断 · Quick Actions</h4>
          <div className="kv" style={{ marginBottom: 12 }}>
            <span className="k">集群快照</span>
            <span className="v mono" style={{ fontSize: 12 }}>
              {cluster.workloads.length} workloads · {badPods} crashloop · {warns} warnings
            </span>
          </div>
          <div className="quick-actions">
            {quickActions.map(q => (
              <button key={q.title} className="quick-btn" disabled={busy} onClick={() => send(q.prompt)}>
                <div className="q-title">{q.title}</div>
                {q.desc}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
