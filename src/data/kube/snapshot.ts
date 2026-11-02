// 集群快照存储:后台轮询 K8S API,把真实对象规范化为扁平模型;
// 视图层同步读取(与 mock store 相同的订阅模式),轮询/动作后刷新时 emit。
// 每个 GVK 首次被 UI 请求时加入轮询集合(按需拉取),避免全量 34 类资源的无谓请求。

import type { KEvent, MetricPoint, NodeInfo, Workload } from '../../types'
import { gvkId, type K8sObject, type ObjMap } from '../objects'
import type { GvkRef } from '../provider'
import { byId } from '../registry'
import { apiPathFor, KubeTransport, type BridgeHealth, type RawObject } from './transport'
import { normalize, parseCpu, parseMemMi, toKEvents } from './normalize'

export type ClusterStatus = 'idle' | 'connecting' | 'ready' | 'error'

export interface SnapshotState {
  status: ClusterStatus
  error?: string
  context?: string
  health?: BridgeHealth
  objects: ObjMap
  workloads: Workload[]
  events: KEvent[]
  namespaces: string[]
  nodes: NodeInfo[]
  metricsHistory: MetricPoint[]
  lastSyncTs: number
}

let transport: KubeTransport | null = null
let health: BridgeHealth | null = null
let timer: number | undefined
let refreshing = false
let dirty = false
const pollRefs = new Map<string, GvkRef>()

const state: SnapshotState = {
  status: 'idle',
  objects: {},
  workloads: [],
  events: [],
  namespaces: [],
  nodes: [],
  metricsHistory: [],
  lastSyncTs: 0,
}

const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(l => l())
}

export function subscribeSnapshot(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function snapshotState(): SnapshotState {
  return state
}

const POLL_MS = 5000

/** 初始化(切数据源时调用);transport 为 null 表示桥不可用,进入 error 态 */
export function startSnapshot(h: BridgeHealth | null, ctx?: string) {
  stopSnapshot()
  health = h
  pollRefs.clear()
  if (!h || h.mode === 'unavailable') {
    state.status = 'error'
    state.error = h?.error ?? '未发现 K8Q 桥接进程(需要千问办公内运行,或本机启动 main-bridge)'
    emit()
    return
  }
  state.status = 'connecting'
  state.error = undefined
  state.context = ctx ?? h.defaultContext
  state.health = h
  transport = new KubeTransport(h.port ?? 0, state.context)
  emit()
  void refresh()
  timer = window.setInterval(() => void refresh(), POLL_MS)
}

export function switchContext(ctx: string) {
  if (state.context === ctx) return
  startSnapshot(health, ctx)
}

export function stopSnapshot() {
  if (timer !== undefined) window.clearInterval(timer)
  timer = undefined
  transport = null
  state.status = 'idle'
  state.objects = {}
  state.workloads = []
  state.events = []
  state.namespaces = []
  state.nodes = []
  state.metricsHistory = []
  state.lastSyncTs = 0
  emit()
}

/** 注册需要轮询的 GVK(UI 请求时懒注册);立即触发一次刷新 */
export function ensurePolled(ref: GvkRef) {
  const id = gvkId(ref.group, ref.version, ref.kind)
  if (pollRefs.has(id)) return
  pollRefs.set(id, ref)
  if (transport) void refresh()
}

const BASE_KINDS: GvkRef[] = [
  { group: '', version: 'v1', kind: 'Pod' },
  { group: '', version: 'v1', kind: 'Namespace' },
  { group: '', version: 'v1', kind: 'Event' },
  { group: '', version: 'v1', kind: 'Node' },
  { group: 'apps', version: 'v1', kind: 'Deployment' },
  { group: 'apps', version: 'v1', kind: 'StatefulSet' },
  { group: 'apps', version: 'v1', kind: 'DaemonSet' },
  { group: 'batch', version: 'v1', kind: 'CronJob' },
]

/** 拉取全部已注册 GVK + 派生数据;失败进入 error 态(保留旧数据供降级显示) */
export async function refresh(): Promise<boolean> {
  if (!transport || refreshing) return false
  refreshing = true
  dirty = false
  try {
    for (const ref of BASE_KINDS) {
      const id = gvkId(ref.group, ref.version, ref.kind)
      if (!pollRefs.has(id)) pollRefs.set(id, ref)
    }
    const refs = [...pollRefs.values()]
    const settled = await Promise.allSettled(
      refs.map(async ref => {
        const res = await transport!.request<{ items?: RawObject[] }>('GET', apiPathFor(ref.group, ref.version, entryPlural(ref)))
        return { ref, items: res.items ?? [] }
      }),
    )
    const objects: ObjMap = {}
    let rawEvents: RawObject[] = []
    let anyOk = false
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue
      anyOk = true
      const { ref, items } = s.value
      if (ref.kind === 'Event') {
        rawEvents = items
        continue
      }
      objects[gvkId(ref.group, ref.version, ref.kind)] = items.map(o => normalize(ref.kind, o))
    }
    if (!anyOk) throw new Error('所有资源列表请求均失败')

    await mergeMetrics(objects)
    state.objects = objects
    state.workloads = deriveWorkloads(objects)
    state.events = toKEvents(rawEvents)
    const nsList = objects['/v1/Namespace']
    if (nsList && nsList.length) state.namespaces = nsList.map(n => n.metadata.name).sort()
    state.nodes = deriveNodes(objects)
    pushMetricsHistory(objects)
    state.lastSyncTs = Date.now()
    if (state.status !== 'ready') state.status = 'ready'
    emit()
    return true
  } catch (e) {
    state.status = 'error'
    state.error = e instanceof Error ? e.message : String(e)
    emit()
    return false
  } finally {
    refreshing = false
    if (dirty) void refresh()
  }
}

/** 变更型动作后调用:立即刷新(防抖合并) */
export function scheduleRefresh() {
  dirty = true
  if (!refreshing) void refresh()
}

function entryPlural(ref: GvkRef): string {
  const entry = byId.get(gvkId(ref.group, ref.version, ref.kind))
  if (entry) return entry.plural
  return ref.kind.toLowerCase() + 's'
}

/** 拉取 metrics.k8s.io 并合并进扁平 Pod/Node(失败静默——metrics-server 可选) */
interface MetricsUsage {
  cpu?: string
  memory?: string
}
interface PodMetricsItem {
  metadata: { name: string; namespace?: string }
  containers?: { name?: string; usage?: MetricsUsage }[]
}
interface NodeMetricsItem {
  metadata: { name: string }
  usage?: MetricsUsage
}

async function mergeMetrics(objects: ObjMap): Promise<void> {
  const transport = currentTransport()
  if (!transport) return
  const [pm, nm] = await Promise.allSettled([
    transport.request<{ items?: PodMetricsItem[] }>('GET', '/apis/metrics.k8s.io/v1beta1/pods'),
    transport.request<{ items?: NodeMetricsItem[] }>('GET', '/apis/metrics.k8s.io/v1beta1/nodes'),
  ])
  if (pm.status === 'fulfilled') {
    const byKey = new Map((objects['/v1/Pod'] ?? []).map(p => [`${p.metadata.namespace}/${p.metadata.name}`, p]))
    for (const item of pm.value.items ?? []) {
      const pod = byKey.get(`${item.metadata.namespace}/${item.metadata.name}`)
      const containers = item.containers ?? []
      const cpu = containers.reduce((a, c) => a + parseCpu(c.usage?.cpu), 0)
      const mem = containers.reduce((a, c) => a + parseMemMi(c.usage?.memory), 0)
      if (pod) {
        pod.status.cpu = Math.round(cpu * 1000) / 1000
        pod.status.mem = mem
      }
    }
  }
  if (nm.status === 'fulfilled') {
    const byName = new Map((objects['/v1/Node'] ?? []).map(n => [n.metadata.name, n]))
    for (const item of nm.value.items ?? []) {
      const node = byName.get(item.metadata.name)
      if (!node) continue
      const usage = item.usage ?? {}
      const cpuCores = parseCpu(usage.cpu)
      const memMi = parseMemMi(usage.memory)
      const capCpu = Number(node.spec.capacityCpu) || 1
      const capMemMi = Number(node.spec.capacityMem) * 1024 || 1
      node.status.cpuUsed = Math.min(1, Math.round((cpuCores / capCpu) * 1000) / 1000)
      node.status.memUsed = Math.min(1, Math.round((memMi / capMemMi) * 1000) / 1000)
      ;(node.status as Record<string, unknown>).cpuUsageCores = Math.round(cpuCores * 1000) / 1000
      ;(node.status as Record<string, unknown>).memUsageMi = memMi
    }
  }
}

/** 扁平 Node → Dashboard 节点表 NodeInfo */
function deriveNodes(objects: ObjMap): NodeInfo[] {
  return (objects['/v1/Node'] ?? []).map(n => ({
    name: n.metadata.name,
    roles: String(n.status.roles ?? 'worker').split(',').filter(Boolean),
    ready: n.status.ready === true,
    cpuCapacity: Number(n.spec.capacityCpu ?? 0),
    memCapacity: Number(n.spec.capacityMem ?? 0),
    podsCapacity: Number(n.spec.podsCapacity ?? 110),
    cpuUsed: Number(n.status.cpuUsed ?? 0),
    memUsed: Number(n.status.memUsed ?? 0),
  }))
}

/** 集群利用率滚动历史(48 点,Dashboard sparkline) */
function pushMetricsHistory(objects: ObjMap) {
  const nodes = objects['/v1/Node'] ?? []
  const capCpu = nodes.reduce((a, n) => a + Number(n.spec.capacityCpu ?? 0), 0)
  const capMemMi = nodes.reduce((a, n) => a + Number(n.spec.capacityMem ?? 0) * 1024, 0)
  const usedCpu = nodes.reduce((a, n) => a + Number((n.status as Record<string, unknown>).cpuUsageCores ?? 0), 0)
  const usedMemMi = nodes.reduce((a, n) => a + Number((n.status as Record<string, unknown>).memUsageMi ?? 0), 0)
  if (!capCpu || !capMemMi) return
  const point: MetricPoint = { t: Date.now(), cpu: (usedCpu / capCpu) * 100, mem: (usedMemMi / capMemMi) * 100 }
  state.metricsHistory = [...state.metricsHistory.slice(-47), point]
}

/** 从规范化对象聚合富面板 Workload(替代 mock workloads 数组) */
function deriveWorkloads(objects: ObjMap): Workload[] {
  const deploys = objects['apps/v1/Deployment'] ?? []
  const sts = objects['apps/v1/StatefulSet'] ?? []
  const ds = objects['apps/v1/DaemonSet'] ?? []
  const cjs = objects['batch/v1/CronJob'] ?? []
  const pods = (objects['/v1/Pod'] ?? []).filter(p => String(p.status.phase) !== 'Terminating')
  const out: Workload[] = []
  const mk = (o: K8sObject, kind: Workload['kind']) => {
    const name = o.metadata.name
    const owned = pods.filter(p => p.metadata.namespace === o.metadata.namespace && String(p.status.workload ?? '').endsWith(`/${name}`))
    out.push({
      id: `cluster:${kind}:${o.metadata.namespace}:${name}`,
      kind,
      name,
      namespace: o.metadata.namespace ?? '',
      replicas: kind === 'CronJob' ? 0 : Number(o.spec.replicas ?? 0),
      readyReplicas: kind === 'CronJob' ? 0 : Number(o.status.readyReplicas ?? 0),
      image: String(o.spec.image ?? '—'),
      ageMin: Math.max(1, Math.floor((Date.now() - o.metadata.creationTs) / 60_000)),
      status: kind === 'CronJob' ? (o.spec.suspend === true ? 'Degraded' : 'Healthy') : Number(o.status.readyReplicas ?? 0) === Number(o.spec.replicas ?? 0) ? 'Healthy' : 'Progressing',
      labels: o.metadata.labels,
      annotations: o.metadata.annotations,
      pods: owned.map(p => ({
        name: p.metadata.name,
        namespace: p.metadata.namespace ?? '',
        workload: name,
        node: String(p.spec.nodeName ?? ''),
        phase: (['Running', 'Pending', 'Succeeded', 'Failed', 'Terminating'].includes(String(p.status.phase)) ? String(p.status.phase) : 'CrashLoopBackOff') as Workload['pods'][number]['phase'],
        restarts: Number(p.status.restarts ?? 0),
        ageMin: Math.max(1, Math.floor((Date.now() - p.metadata.creationTs) / 60_000)),
        cpu: Number(p.status.cpu ?? 0),
        mem: Number(p.status.mem ?? 0),
      })),
      ...(kind === 'CronJob' ? { schedule: String(o.spec.schedule ?? ''), suspend: o.spec.suspend === true } : {}),
    })
  }
  deploys.forEach(o => mk(o, 'Deployment'))
  sts.forEach(o => mk(o, 'StatefulSet'))
  ds.forEach(o => mk(o, 'DaemonSet'))
  cjs.forEach(o => mk(o, 'CronJob'))
  return out
}

export function currentTransport(): KubeTransport | null {
  return transport
}
