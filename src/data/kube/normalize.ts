// 真实 K8S JSON → K8Q 扁平模型适配器。
// registry 的列/详情渲染都按扁平 spec.* / status.* 取值,这里负责形状转换。

import type { KEvent, PodInfo, Workload, WorkloadKind } from '../../types'
import type { K8sObject } from '../objects'
import type { RawEvent, RawObject } from './transport'

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v))
const num = (v: unknown): number => (typeof v === 'number' ? v : Number.isFinite(Number(v)) ? Number(v) : 0)
const ageMinOf = (iso?: string): number => (iso ? Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)) : 0)

/** K8S Quantity → cores:"250m"→0.25,"1"→1,"1.5"→1.5 */
export function parseCpu(q: unknown): number {
  const s = String(q ?? '').trim()
  if (!s) return 0
  if (s.endsWith('m')) return Number(s.slice(0, -1)) / 1000
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/** K8S Quantity → Mi:"512Mi"→512,"1Gi"→1024,"1024Ki"→1,"1048576"→1 */
export function parseMemMi(q: unknown): number {
  const s = String(q ?? '').trim()
  if (!s) return 0
  const m = s.match(/^([\d.]+)(Ki|Mi|Gi|Ti|M|G|T)?$/)
  if (!m) return 0
  const n = Number(m[1])
  const unit = m[2] ?? ''
  const factor = unit === 'Ki' ? 1 / 1024 : unit === 'Mi' || unit === '' ? 1 : unit === 'Gi' ? 1024 : unit === 'Ti' ? 1024 * 1024 : unit === 'M' ? 1 / 1.048576 : unit === 'G' ? 1024 / 1.048576 : unit === 'T' ? 1024 * 1024 / 1.048576 : 1
  return Math.round(n * factor)
}

function imageOf(o: RawObject): string {
  const template = o.spec?.template as Record<string, unknown> | undefined
  const containers = (template?.spec as Record<string, unknown> | undefined)?.containers
  const first = Array.isArray(containers) ? (containers[0] as Record<string, unknown> | undefined) : undefined
  return str(first?.image) || '—'
}

function ownerOf(o: RawObject): { kind: string; name: string } | undefined {
  const ref = o.metadata.ownerReferences?.find(r => r.controller) ?? o.metadata.ownerReferences?.[0]
  return ref ? { kind: ref.kind ?? '', name: ref.name } : undefined
}

export function flatMeta(o: RawObject): K8sObject['metadata'] {
  return {
    name: o.metadata.name,
    namespace: o.metadata.namespace,
    labels: o.metadata.labels ?? {},
    annotations: o.metadata.annotations ?? {},
    creationTs: o.metadata.creationTimestamp ? new Date(o.metadata.creationTimestamp).getTime() : Date.now(),
  }
}

// ── Pod ───────────────────────────────────────────────────
export function normalizePod(o: RawObject, workloadIndex?: Map<string, string>): K8sObject {
  const owner = ownerOf(o)
  // Deployment 的 Pod 直接 owner 是 ReplicaSet,还原到 Deployment 名
  let workload = owner ? `${owner.kind}/${owner.name}` : ''
  if (owner?.kind === 'ReplicaSet') workload = `Deployment/${owner.name.replace(/-[a-z0-9]{4,6}$/i, '')}`
  if (workloadIndex) {
    const known = workloadIndex.get(`${o.metadata.namespace}/${o.metadata.name}`)
    if (known) workload = known
  }
  const restarts = Array.isArray(o.status?.containerStatuses)
    ? (o.status.containerStatuses as Record<string, unknown>[]).reduce((a, c) => a + num(c.restartCount), 0)
    : 0
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: flatMeta(o),
    spec: {
      nodeName: str(o.spec?.nodeName) || '—',
      image: imageOfPod(o),
      containers: Array.isArray(o.spec?.containers) ? o.spec.containers.length : 0,
    },
    status: {
      phase: str(o.status?.phase) || 'Unknown',
      restarts,
      workload,
      cpu: 0,
      mem: 0,
    },
  }
}

function imageOfPod(o: RawObject): string {
  const first = Array.isArray(o.spec?.containers) ? (o.spec.containers[0] as Record<string, unknown> | undefined) : undefined
  return str(first?.image) || '—'
}

/** 真实 Pod → 富面板 PodInfo(pods 表格渲染用) */
export function podInfo(o: RawObject): PodInfo {
  const flat = normalizePod(o)
  const owner = ownerOf(o)
  return {
    name: o.metadata.name,
    namespace: o.metadata.namespace ?? '',
    workload: owner?.kind === 'ReplicaSet' ? owner.name.replace(/-[a-z0-9]{4,6}$/i, '') : (owner?.name ?? ''),
    node: str(o.spec?.nodeName),
    phase: (flat.status.phase === 'Running' || flat.status.phase === 'Succeeded' || flat.status.phase === 'Pending'
      ? flat.status.phase
      : flat.status.phase === 'Failed'
        ? 'Failed'
        : 'CrashLoopBackOff') as PodInfo['phase'],
    restarts: num(flat.status.restarts),
    ageMin: ageMinOf(o.metadata.creationTimestamp),
    cpu: 0,
    mem: 0,
  }
}

// ── 工作负载 ──────────────────────────────────────────────
export function normalizeWorkload(o: RawObject): K8sObject {
  const ready = num(o.status?.readyReplicas)
  const total = num(o.spec?.replicas)
  return {
    apiVersion: str(o.apiVersion) || 'apps/v1',
    kind: str(o.kind),
    metadata: flatMeta(o),
    spec: { ...o.spec, image: imageOf(o), replicas: total },
    status: {
      readyReplicas: ready,
      phase: ready === total ? 'Healthy' : 'Progressing',
    },
  }
}

export function normalizeCronJob(o: RawObject): K8sObject {
  const suspended = o.spec?.suspend === true
  const last = str(o.status?.lastScheduleTime)
  return {
    apiVersion: 'batch/v1',
    kind: 'CronJob',
    metadata: flatMeta(o),
    spec: {
      schedule: str(o.spec?.schedule) || '—',
      suspend: suspended,
    },
    status: {
      lastSchedule: last ? new Date(last).toLocaleString('zh-CN', { hour12: false }) : '—',
      phase: suspended ? 'Suspended' : 'Active',
    },
  }
}

export function normalizeJob(o: RawObject): K8sObject {
  const failed = num(o.status?.failed)
  const succeeded = num(o.status?.succeeded)
  const start = o.status?.startTime ? new Date(str(o.status.startTime)).getTime() : undefined
  const end = o.status?.completionTime ? new Date(str(o.status.completionTime)).getTime() : undefined
  const owner = ownerOf(o)
  const durSec = start && end ? Math.round((end - start) / 1000) : undefined
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: flatMeta(o),
    spec: {
      completions: num(o.spec?.completions) || 1,
      parallelism: num(o.spec?.parallelism) || 1,
      backoffLimit: num(o.spec?.backoffLimit),
    },
    status: {
      succeeded,
      failed,
      duration: durSec !== undefined ? `${durSec}s` : '—',
      owner: owner?.name ?? '',
    },
  }
}

// ── 网络 / 存储 / 配置 / 集群 ─────────────────────────────
export function normalizeService(o: RawObject): K8sObject {
  const ports = Array.isArray(o.spec?.ports)
    ? (o.spec.ports as Record<string, unknown>[]).map(pp => `${num(pp.port)}${pp.nodePort ? `:${num(pp.nodePort)}` : ''}/${str(pp.protocol) || 'TCP'}`)
    : []
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: flatMeta(o),
    spec: {
      type: str(o.spec?.type) || 'ClusterIP',
      clusterIP: str(o.spec?.clusterIP) || '—',
      ports,
    },
    status: {},
  }
}

export function normalizeConfigMap(o: RawObject): K8sObject {
  return {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: flatMeta(o),
    spec: { keyCount: Object.keys(o.data ?? {}).length, data: o.data ?? {} },
    status: {},
  }
}

export function normalizeSecret(o: RawObject & { type?: string }): K8sObject {
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: flatMeta(o),
    spec: { type: str(o.spec?.type ?? o.type) || 'Opaque', keyCount: Object.keys(o.data ?? {}).length },
    status: {},
  }
}

export function normalizeNode(o: RawObject): K8sObject {
  const conds = Array.isArray(o.status?.conditions) ? (o.status.conditions as Record<string, unknown>[]) : []
  const ready = conds.find(c => c.type === 'Ready')?.status === 'True'
  const capacity = (o.status?.capacity ?? {}) as Record<string, string>
  const allocatable = (o.status?.allocatable ?? {}) as Record<string, string>
  const cpuCap = parseFloat(capacity.cpu ?? '0')
  const memCap = parseInt(capacity.memory ?? '0Gi', 10)
  return {
    apiVersion: 'v1',
    kind: 'Node',
    metadata: flatMeta(o),
    spec: {
      capacityCpu: cpuCap,
      capacityMem: memCap,
      podsCapacity: num(capacity.pods),
    },
    status: {
      ready,
      roles: Object.entries(o.metadata.labels ?? {})
        .filter(([k]) => k === 'kubernetes.io/role')
        .map(([, v]) => v)
        .join(',') || 'worker',
      version: str((o.status?.nodeInfo as Record<string, unknown> | undefined)?.kubeletVersion),
      cpuUsed: 0,
      memUsed: 0,
      cpuAllocatable: str(allocatable.cpu),
    },
  }
}

export function normalizeNamespace(o: RawObject): K8sObject {
  return {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: flatMeta(o),
    spec: {},
    status: { phase: str(o.status?.phase) || 'Active' },
  }
}

export function normalizePdb(o: RawObject): K8sObject {
  const spec = o.spec ?? {}
  return {
    apiVersion: 'policy/v1',
    kind: 'PodDisruptionBudget',
    metadata: flatMeta(o),
    spec: {
      minAvailable: spec.minAvailable,
      maxUnavailable: spec.maxUnavailable,
    },
    status: { disruptionsAllowed: num(o.status?.disruptionsAllowed) },
  }
}

const KIND_NORMALIZERS: Record<string, (o: RawObject) => K8sObject> = {
  Pod: normalizePod,
  Deployment: normalizeWorkload,
  StatefulSet: normalizeWorkload,
  DaemonSet: normalizeWorkload,
  ReplicaSet: normalizeWorkload,
  CronJob: normalizeCronJob,
  Job: normalizeJob,
  Service: normalizeService,
  ConfigMap: normalizeConfigMap,
  Secret: normalizeSecret,
  Node: normalizeNode,
  Namespace: normalizeNamespace,
  PodDisruptionBudget: normalizePdb,
}

export function normalize(kind: string, o: RawObject): K8sObject {
  return (KIND_NORMALIZERS[kind] ?? defaultNormalize)(o)
}

function defaultNormalize(o: RawObject): K8sObject {
  return { apiVersion: str(o.apiVersion), kind: str(o.kind), metadata: flatMeta(o), spec: { ...(o.spec ?? {}) }, status: { ...(o.status ?? {}) } }
}

// ── 富面板 Workload 聚合 ──────────────────────────────────
export function toWorkloads(
  raws: { Deployment: RawObject[]; StatefulSet: RawObject[]; DaemonSet: RawObject[]; CronJob: RawObject[] },
  pods: RawObject[],
): Workload[] {
  const out: Workload[] = []
  const kinds: WorkloadKind[] = ['Deployment', 'StatefulSet', 'DaemonSet', 'CronJob']
  for (const kind of kinds) {
    for (const o of raws[kind]) {
      const name = o.metadata.name
      const owned = pods.filter(pp => pp.metadata.namespace === o.metadata.namespace && pp.metadata.labels?.app === name)
      out.push({
        id: `cluster:${kind}:${o.metadata.namespace}:${name}`,
        kind,
        name,
        namespace: o.metadata.namespace ?? '',
        replicas: kind === 'CronJob' ? 0 : num(o.spec?.replicas),
        readyReplicas: kind === 'CronJob' ? 0 : num(o.status?.readyReplicas),
        image: imageOf(o),
        ageMin: ageMinOf(o.metadata.creationTimestamp),
        status: kind === 'CronJob' ? (o.spec?.suspend === true ? 'Degraded' : 'Healthy') : num(o.status?.readyReplicas) === num(o.spec?.replicas) ? 'Healthy' : 'Progressing',
        labels: o.metadata.labels ?? {},
        annotations: o.metadata.annotations ?? {},
        pods: owned.map(podInfo),
        ...(kind === 'CronJob' ? { schedule: str(o.spec?.schedule), suspend: o.spec?.suspend === true } : {}),
      })
    }
  }
  return out
}

// ── 事件 ──────────────────────────────────────────────────
export function toKEvents(items: RawEvent[]): KEvent[] {
  return items.map(e => {
    const inv = e.involvedObject ?? {}
    return {
      id: e.metadata.uid ?? e.metadata.name,
      ts: e.lastTimestamp ? new Date(e.lastTimestamp).getTime() : e.eventTime ? new Date(e.eventTime).getTime() : e.metadata.creationTimestamp ? new Date(e.metadata.creationTimestamp).getTime() : Date.now(),
      type: (e.type === 'Warning' ? 'Warning' : 'Normal') as KEvent['type'],
      namespace: inv.namespace ?? e.metadata.namespace ?? 'default',
      object: `${(inv.kind ?? 'object').toLowerCase()}/${inv.name ?? ''}`,
      reason: str(e.reason) || '—',
      message: str(e.message),
    }
  }).sort((a, b) => b.ts - a.ts)
}
