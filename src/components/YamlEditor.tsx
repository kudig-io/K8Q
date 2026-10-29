import { useMemo, useState } from 'react'
import { applyYaml } from '../mock/store'
import type { Workload } from '../types'
import { YamlView } from './common'

type DiffRow = { type: 'same' | 'add' | 'del'; text: string }

// 行级 LCS diff,YAML 清单规模(几十行)下开销可忽略
export function diffLines(a: string, b: string): DiffRow[] {
  const al = a.split('\n')
  const bl = b.split('\n')
  const m = al.length
  const n = bl.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (al[i] === bl[j]) {
      rows.push({ type: 'same', text: al[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', text: al[i] })
      i++
    } else {
      rows.push({ type: 'add', text: bl[j] })
      j++
    }
  }
  while (i < m) rows.push({ type: 'del', text: al[i++] })
  while (j < n) rows.push({ type: 'add', text: bl[j++] })
  return rows
}

function validateYaml(text: string): string[] {
  const errors: string[] = []
  if (!/^\s*apiVersion:\s*\S+/m.test(text)) errors.push('缺少 apiVersion 字段')
  if (!/^\s*kind:\s*\S+/m.test(text)) errors.push('缺少 kind 字段')
  if (!/^\s*name:\s*\S+/m.test(text)) errors.push('metadata.name 缺失')
  const rm = text.match(/^\s*replicas:\s*(\S+)\s*$/m)
  if (rm && !/^\d+$/.test(rm[1])) errors.push(`replicas 必须是整数,当前为 "${rm[1]}"`)
  if (/\t/.test(text)) errors.push('YAML 不允许使用 Tab 缩进,请替换为空格')
  return errors
}

export default function YamlEditor({ workload, original }: { workload: Workload; original: string }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'diff'>('view')
  const [draft, setDraft] = useState(original)
  const [applied, setApplied] = useState<string[]>([])

  const errors = useMemo(() => (mode === 'view' ? [] : validateYaml(draft)), [draft, mode])
  const diff = useMemo(() => diffLines(original, draft), [original, draft])
  const changed = diff.some(r => r.type !== 'same')
  const adds = diff.filter(r => r.type === 'add').length
  const dels = diff.filter(r => r.type === 'del').length

  function reset(nextMode: 'view' | 'edit' | 'diff') {
    setDraft(original)
    setMode(nextMode)
  }

  function apply() {
    const changes = applyYaml(workload.id, draft)
    setApplied(changes)
    setMode('view')
  }

  return (
    <div>
      <div className="log-toolbar">
        <div className="seg">
          <button className={`seg-btn${mode === 'view' ? ' active' : ''}`} onClick={() => reset('view')}>查看</button>
          <button className={`seg-btn${mode === 'edit' ? ' active' : ''}`} onClick={() => setMode('edit')}>编辑</button>
          <button
            className={`seg-btn${mode === 'diff' ? ' active' : ''}`}
            disabled={!changed && mode !== 'diff'}
            onClick={() => setMode('diff')}
          >
            Diff
          </button>
        </div>
        <span className="spacer" />
        {mode === 'edit' && (
          <>
            <button className="btn" onClick={() => reset('view')}>放弃修改</button>
            <button className="btn" disabled={!changed} onClick={() => setMode('diff')}>
              预览 Diff{changed ? ` (+${adds} −${dels})` : ''}
            </button>
            <button className="btn primary" disabled={!changed || errors.length > 0} onClick={apply}>
              应用变更
            </button>
          </>
        )}
        {mode === 'diff' && (
          <>
            <button className="btn" onClick={() => setMode('edit')}>继续编辑</button>
            <button className="btn primary" disabled={errors.length > 0} onClick={apply}>
              确认应用 (+{adds} −{dels})
            </button>
          </>
        )}
      </div>

      {applied.length > 0 && mode === 'view' && (
        <div className="apply-banner ok">
          已应用:{applied.join(';')} — 集群对象正在调和(mock)
        </div>
      )}
      {mode !== 'view' && errors.length > 0 && (
        <div className="apply-banner err">
          {errors.map(e => (
            <div key={e}>校验失败:{e}</div>
          ))}
        </div>
      )}
      {mode !== 'view' && errors.length === 0 && changed && (
        <div className="apply-banner info">校验通过 · {adds} 行新增 / {dels} 行删除</div>
      )}

      {mode === 'view' && <YamlView yaml={original} />}

      {mode === 'edit' && (
        <textarea
          className="yaml-editor"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Tab') {
              e.preventDefault()
              const el = e.currentTarget
              const { selectionStart: s, selectionEnd: en } = el
              setDraft(draft.slice(0, s) + '  ' + draft.slice(en))
              requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2))
            }
          }}
          spellCheck={false}
        />
      )}

      {mode === 'diff' && (
        <div className="yaml-view diff-view">
          {!changed && <div className="dim">与当前集群状态一致,没有变更</div>}
          {diff.map((r, i) =>
            r.type === 'same' ? (
              <div key={i} className="diff-same">{r.text}</div>
            ) : (
              <div key={i} className={r.type === 'add' ? 'diff-add' : 'diff-del'}>
                {r.type === 'add' ? '+' : '−'} {r.text}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}
