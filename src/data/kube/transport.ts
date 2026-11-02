// 视图 → node 桥的传输层:发现桥端口并转发 K8S API 请求。
// 端口发现顺序:localStorage 缓存 → 扫描 47831-47845(与 main-bridge.mjs 约定一致)。

export interface BridgeContext {
  name: string
  cluster?: string
  server?: string
  namespace?: string
}

export interface BridgeHealth {
  app: string
  ok: boolean
  bridge: boolean
  port?: number
  mode: 'kubeconfig' | 'env' | 'unavailable'
  error?: string
  defaultContext?: string
  contexts: BridgeContext[]
}

const PORT_RANGE = [47831, 47845] as const
const LS_KEY = 'k8q.bridge.port'

let cachedPort: number | null = null
let cachedHealth: BridgeHealth | null = null

async function probe(port: number, timeoutMs = 900): Promise<BridgeHealth | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const health = (await res.json()) as BridgeHealth
    if (health.app !== 'io.kudig.k8q' || !health.bridge) return null
    health.port = port
    return health
  } catch {
    return null
  }
}

/** 发现桥;带缓存,失败时返回 null(视图降级 Mock) */
export async function discoverBridge(force = false): Promise<BridgeHealth | null> {
  if (!force && cachedHealth) return cachedHealth
  const tried = new Set<number>()
  const last = Number(localStorage.getItem(LS_KEY))
  const lastValid = Number.isFinite(last) && last >= PORT_RANGE[0] && last <= PORT_RANGE[1]
  if (lastValid) tried.add(last)
  for (let p = PORT_RANGE[0]; p <= PORT_RANGE[1]; p++) if (!tried.has(p)) tried.add(p)
  const order = [...tried]
  if (lastValid) order.unshift(last)
  for (const p of order) {
    const health = await probe(p)
    if (health) {
      cachedPort = p
      cachedHealth = health
      localStorage.setItem(LS_KEY, String(p))
      return health
    }
  }
  cachedPort = null
  cachedHealth = null
  return null
}

export function bridgePort(): number | null {
  return cachedPort
}

export class BridgeRequestError extends Error {
  code: number
  kind?: string
  reason?: string
  constructor(code: number, message: string, kind?: string, reason?: string) {
    super(message)
    this.code = code
    this.kind = kind
    this.reason = reason
  }
}

/** 面向单 context 的 K8S API 请求器 */
export class KubeTransport {
  constructor(
    private port: number,
    private context: string | undefined,
  ) {}

  setContext(context: string | undefined) {
    this.context = context
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = {}
    if (this.context) h['X-K8Q-Context'] = this.context
    if (json) h['Content-Type'] = 'application/merge-patch+json'
    return h
  }

  async request<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', apiPath: string, body?: unknown, opts?: { contentType?: string }): Promise<T> {
    const headers = this.headers(body !== undefined && opts?.contentType === undefined)
    if (opts?.contentType) headers['Content-Type'] = opts.contentType
    const res = await fetch(`http://127.0.0.1:${this.port}/k8s${apiPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    const ctype = res.headers.get('content-type') ?? ''
    if (!ctype.includes('application/json')) {
      const text = await res.text()
      if (!res.ok) throw new BridgeRequestError(res.status, text.slice(0, 300))
      return text as unknown as T
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      const msg = typeof data.message === 'string' ? data.message : `HTTP ${res.status}`
      throw new BridgeRequestError(res.status, msg, typeof data.kind === 'string' ? data.kind : undefined, typeof data.reason === 'string' ? data.reason : undefined)
    }
    return data as T
  }
}

/** 真实 K8S 对象形状(仅本应用消费到的字段子集) */
export interface RawObject {
  kind?: string
  apiVersion?: string
  metadata: {
    name: string
    namespace?: string
    uid?: string
    resourceVersion?: string
    creationTimestamp?: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
    ownerReferences?: { apiVersion?: string; kind?: string; name: string; uid?: string; controller?: boolean }[]
  }
  spec?: Record<string, unknown>
  status?: Record<string, unknown>
  data?: Record<string, string>
}

/** K8s Event 的顶层字段与普通对象不同,单独建模 */
export interface RawEvent extends RawObject {
  type?: string
  reason?: string
  message?: string
  lastTimestamp?: string
  eventTime?: string
  involvedObject?: { kind?: string; namespace?: string; name?: string }
}

export interface RawList {
  kind?: string
  items?: RawObject[]
}

export function apiPathFor(group: string, version: string, plural: string, namespace?: string): string {
  const base = group ? `/apis/${group}/${version}` : `/api/${version}`
  return namespace ? `${base}/namespaces/${encodeURIComponent(namespace)}/${plural}` : `${base}/${plural}`
}

export function logPath(namespace: string, pod: string): string {
  return `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/log`
}
