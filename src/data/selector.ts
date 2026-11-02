/** 简化 label selector:k=v、k!=v、k(存在性),逗号组合 */
export interface SelectorTerm {
  key: string
  op: 'eq' | 'neq' | 'exists'
  value?: string
}

const KEY_RE = /^[a-zA-Z0-9]([\w./-]*[\w])?$/
const VAL_RE = /^[\w.-]+$/

export function parseSelector(input: string): { terms: SelectorTerm[]; error?: string } {
  const trimmed = input.trim()
  if (!trimmed) return { terms: [] }
  const parts = trimmed.split(',')
  const terms: SelectorTerm[] = []
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i].trim()
    const at = `第 ${i + 1} 项 "${raw || '(空)'}"`
    if (!raw) return { terms: [], error: `${at} 为空,逗号后需要条件` }
    const neq = raw.split('!=')
    const eq = raw.split('=')
    if (neq.length === 2) {
      const [k, v] = neq.map(s => s.trim())
      if (!KEY_RE.test(k)) return { terms: [], error: `${at} 的键 "${k}" 不合法` }
      if (!VAL_RE.test(v)) return { terms: [], error: `${at} 的值 "${v}" 不合法` }
      terms.push({ key: k, op: 'neq', value: v })
    } else if (eq.length === 2) {
      const [k, v] = eq.map(s => s.trim())
      if (!KEY_RE.test(k)) return { terms: [], error: `${at} 的键 "${k}" 不合法` }
      if (!VAL_RE.test(v)) return { terms: [], error: `${at} 的值 "${v}" 不合法` }
      terms.push({ key: k, op: 'eq', value: v })
    } else if (eq.length === 1 && KEY_RE.test(raw)) {
      terms.push({ key: raw, op: 'exists' })
    } else {
      return { terms: [], error: `${at} 语法无效,支持 k=v、k!=v、k` }
    }
  }
  return { terms }
}

export function matchesSelector(labels: Record<string, string>, terms: SelectorTerm[]): boolean {
  return terms.every(t => {
    const v = labels[t.key]
    if (t.op === 'exists') return v !== undefined
    if (t.op === 'eq') return v === t.value
    return v !== t.value
  })
}
