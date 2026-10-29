import type { PodInfo } from '../types'

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

export interface LogLine {
  ts: number
  level: LogLevel
  msg: string
}

// 每个 pod 独立的确定性 PRNG,避免消费全局 seed 导致刷新间不稳定
function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const httpPaths = [
  ['GET', '/api/v1/orders?status=pending', '200'],
  ['GET', '/api/v1/users/profile', '200'],
  ['POST', '/api/v1/payments/authorize', '201'],
  ['GET', '/healthz', '200'],
  ['GET', '/api/v1/search?q=phone&page=3', '200'],
  ['PUT', '/api/v1/inventory/sku-88421', '200'],
  ['POST', '/api/v1/risk/evaluate', '200'],
  ['GET', '/api/v1/coupon/list?uid=48221', '200'],
  ['DELETE', '/api/v1/sessions/expired', '204'],
  ['GET', '/metrics', '200'],
] as const

const infoMsgs = [
  'connection pool [primary] checkout 12ms, active=34/100',
  'cache hit ratio 94.2% over last 60s window',
  'flushed 128 pending index segments to storage',
  'leader election: lease renewed, term=4821',
  'scheduled job completed in 342ms, next run in 15m0s',
  'gRPC stream established with billing-job.middleware:9090',
  'checkpoint written, offset=81230412',
  'config reloaded from ConfigMap app-config (checksum 9f2ac1)',
  'GC pause (young) 21ms, heap 612Mi → 388Mi',
  'outbox relay: 64 messages dispatched, 0 failed',
] as const

const warnMsgs = [
  'slow query detected: 1240ms on orders_by_user_index',
  'retrying upstream call (attempt 2/3): connect timeout to auth-service:8080',
  'memory usage 82% of container limit, consider raising requests',
  'rate limiter engaged: 412 req/s exceeds quota 400 req/s',
  'TLS certificate for *.internal expires in 13 days',
  'consumer lag on topic trade-events: 2,304 messages behind',
] as const

const errMsgs = [
  'upstream connect error: dial tcp 10.244.3.17:8080: connect: connection refused',
  'unhandled exception in worker-4: NullPointerException at OrderService.settle(OrderService.java:218)',
  'OOM killer imminent: cgroup memory.usage 1023Mi / 1024Mi',
  'failed to write WAL segment: no space left on device /var/lib/data',
  'health probe failing 3 consecutive checks, marking pod NotReady',
] as const

const crashCycle = [
  'starting container main (attempt #%N)',
  'panic: runtime error: invalid memory address or nil pointer dereference',
  '[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x6f3a20]',
  'goroutine 1 [running]:',
  'main.main() /app/cmd/server/main.go:47 +0x1e5',
  'container main exited with code 2, restarting in 20s (backoff)',
] as const

function pickN<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length)]
}

function genLine(r: () => number, crashing: boolean, ts: number, attempt: number): LogLine {
  if (crashing && r() > 0.45) {
    const msg = pickN(r, crashCycle).replace('%N', String(attempt))
    const level: LogLevel = msg.startsWith('starting') ? 'INFO' : 'ERROR'
    return { ts, level, msg }
  }
  const roll = r()
  if (roll > 0.93) return { ts, level: 'ERROR', msg: pickN(r, errMsgs) }
  if (roll > 0.78) return { ts, level: 'WARN', msg: pickN(r, warnMsgs) }
  if (roll > 0.62) {
    const [method, path, code] = pickN(r, httpPaths)
    const ms = Math.floor(r() * 240 + 2)
    const bytes = Math.floor(r() * 9000 + 128)
    const ip = `10.244.${Math.floor(r() * 8)}.${Math.floor(r() * 250 + 2)}`
    return { ts, level: 'INFO', msg: `${ip} - - "${method} ${path} HTTP/1.1" ${code} ${bytes}B ${ms}ms` }
  }
  if (roll > 0.52) return { ts, level: 'DEBUG', msg: `trace span exporter flushed ${Math.floor(r() * 90 + 4)} spans` }
  return { ts, level: 'INFO', msg: pickN(r, infoMsgs) }
}

const backlogCache = new Map<string, LogLine[]>()

// 确定性 backlog:同一 pod 名始终生成相同的历史日志
export function logBacklog(pod: PodInfo): LogLine[] {
  const cached = backlogCache.get(pod.name)
  if (cached) return cached
  const crashing = pod.phase === 'CrashLoopBackOff' || pod.phase === 'Failed'
  const r = mulberry(hashSeed(pod.name))
  const lines: LogLine[] = []
  const now = Date.now()
  const start = now - 32 * 60_000
  let t = start
  let attempt = pod.restarts
  lines.push({
    ts: start,
    level: 'INFO',
    msg: `starting ${pod.workload} ${pod.name} — image resolved, env loaded, listening on :8080`,
  })
  while (t < now) {
    t += Math.floor(r() * 9000 + 900)
    if (t > now) break
    lines.push(genLine(r, crashing, t, attempt))
    if (lines.length % 61 === 0) attempt++
  }
  backlogCache.set(pod.name, lines)
  return lines
}

// 实时流:非确定性,每次 tick 生成 1-3 行
export function nextLogLines(pod: PodInfo, attempt: number): LogLine[] {
  const crashing = pod.phase === 'CrashLoopBackOff' || pod.phase === 'Failed'
  const r = Math.random
  const n = 1 + Math.floor(Math.random() * 3)
  const out: LogLine[] = []
  let t = Date.now()
  for (let i = 0; i < n; i++) {
    out.push(genLine(r, crashing, t, attempt))
    t += 200
  }
  return out
}

export function fmtLogTs(ts: number): string {
  const d = new Date(ts)
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}
