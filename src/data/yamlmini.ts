/**
 * 简化 YAML 解析器(mock 实现,非完整 YAML 1.2):
 * 支持 --- 多文档、缩进嵌套映射、键值标量、- 列表(标量或映射)、行内 {} / []、注释行。
 * 不支持锚点/多行字符串/流式嵌套,仅覆盖 K8Q 导入场景所需的清单子集。
 */

type Val = Record<string, unknown> | unknown[] | string | number | boolean | null

function scalar(raw: string): Val {
  const s = raw.trim()
  if (s === '' || s === '~' || s === 'null') return null
  if (s === '{}') return {}
  if (s === '[]') return []
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1)
  if (s === 'true') return true
  if (s === 'false') return false
  if (/^-?\d+$/.test(s)) return parseInt(s, 10)
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s)
  return s
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

function parseBlock(lines: string[], start: number, indent: number): [Val, number] {
  const isList = lines[start].trimStart().startsWith('- ')
  if (isList) {
    const arr: unknown[] = []
    let i = start
    while (i < lines.length && indentOf(lines[i]) === indent && lines[i].trimStart().startsWith('- ')) {
      const content = lines[i].trimStart().slice(2)
      if (/^[\w./-]+:\s*/.test(content)) {
        // 列表项为映射:首键与 '- ' 同行,其余键在 indent+2 层级
        const m = content.match(/^([\w./-]+):\s*(.*)$/)!
        const obj: Record<string, unknown> = {}
        i++
        if (m[2]) {
          obj[m[1]] = scalar(m[2])
        } else if (i < lines.length && indentOf(lines[i]) > indent + 2) {
          const [v, ni] = parseBlock(lines, i, indentOf(lines[i]))
          obj[m[1]] = v
          i = ni
        } else {
          obj[m[1]] = {}
        }
        while (i < lines.length && indentOf(lines[i]) === indent + 2 && !lines[i].trimStart().startsWith('- ')) {
          const [k, ni] = parseMapEntry(lines, i, indent + 2)
          Object.assign(obj, k)
          i = ni
        }
        arr.push(obj)
      } else {
        arr.push(scalar(content))
        i++
      }
    }
    return [arr, i]
  }
  const obj: Record<string, unknown> = {}
  let i = start
  while (i < lines.length && indentOf(lines[i]) === indent && !lines[i].trimStart().startsWith('- ')) {
    const [entry, ni] = parseMapEntry(lines, i, indent)
    Object.assign(obj, entry)
    i = ni
  }
  return [obj, i]
}

function parseMapEntry(lines: string[], i: number, indent: number): [Record<string, unknown>, number] {
  const line = lines[i].trimStart()
  const m = line.match(/^([\w./-]+):\s*(.*)$/)
  if (!m) throw new Error(`无法解析第 ${i + 1} 行 "${lines[i].trim()}"`)
  const [, key, rest] = m
  if (rest) return [{ [key]: scalar(rest) }, i + 1]
  const next = i + 1
  if (next < lines.length && indentOf(lines[next]) > indent) {
    const [v, ni] = parseBlock(lines, next, indentOf(lines[next]))
    return [{ [key]: v }, ni]
  }
  return [{ [key]: {} }, i + 1]
}

/** 拆分并解析多文档;解析失败抛出带文档序号的错误 */
export function parseAll(text: string): Record<string, unknown>[] {
  const docs = text
    .split(/^---\s*$/m)
    .map(d => d.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')))
    .filter(lines => lines.length > 0)
  if (docs.length === 0) throw new Error('没有可解析的 YAML 文档')
  return docs.map((lines, idx) => {
    try {
      const [v] = parseBlock(lines, 0, indentOf(lines[0]))
      if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('文档必须是 YAML 映射')
      return v as Record<string, unknown>
    } catch (e) {
      throw new Error(`第 ${idx + 1} 个文档:${e instanceof Error ? e.message : String(e)}`)
    }
  })
}
