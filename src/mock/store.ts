import { useSyncExternalStore } from 'react'
import type { Cluster, KEvent, MetricPoint, NodeInfo, Release, Workload } from '../types'
import { buildClusterState, clusters, nextEvent } from './data'
import { uid } from './seed'

interface ClusterState {
  nodes: NodeInfo[]
  workloads: Workload[]
  releases: Release[]
  events: KEvent[]
  metrics: MetricPoint[]
}

interface State {
  activeCluster: number
  clusters: Cluster[]
  perCluster: Record<string, ClusterState>
}

const perCluster: Record<string, ClusterState> = {}
clusters.forEach((c, i) => {
  const built = buildClusterState(i)
  const now = Date.now()
  perCluster[c.id] = {
    ...built,
    metrics: Array.from({ length: 48 }, (_, k) => ({
      t: now - (47 - k) * 60_000,
      cpu: 34 + Math.sin(k / 5) * 12 + Math.random() * 8,
      mem: 52 + Math.cos(k / 7) * 9 + Math.random() * 6,
    })),
  }
})

let state: State = { activeCluster: 0, clusters, perCluster }
const listeners = new Set<() => void>()

function emit() {
  state = { ...state }
  listeners.forEach(l => l())
}

export function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function getState() {
  return state
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

export function current(): ClusterState {
  return state.perCluster[state.clusters[state.activeCluster].id]
}

export function setCluster(idx: number) {
  state.activeCluster = idx
  emit()
}

export function scaleWorkload(id: string, replicas: number) {
  const cs = current()
  const w = cs.workloads.find(w => w.id === id)
  if (!w) return
  w.replicas = replicas
  w.readyReplicas = replicas
  w.status = 'Progressing'
  emit()
  setTimeout(() => {
    w.status = 'Healthy'
    emit()
  }, 1600)
}

export function restartWorkload(id: string) {
  const cs = current()
  const w = cs.workloads.find(w => w.id === id)
  if (!w) return
  w.annotations['kubectl.kubernetes.io/restartedAt'] = new Date().toISOString()
  w.status = 'Progressing'
  w.readyReplicas = 0
  w.pods.forEach(p => (p.phase = 'Pending'))
  emit()
  let step = 0
  const timer = setInterval(() => {
    step++
    w.readyReplicas = Math.min(w.replicas, Math.ceil((w.replicas * step) / 3))
    w.pods.forEach((p, i) => {
      if (i < w.readyReplicas) p.phase = 'Running'
    })
    if (step >= 3) {
      w.status = 'Healthy'
      clearInterval(timer)
    }
    emit()
  }, 900)
}

export function applyYaml(id: string, text: string): string[] {
  const cs = current()
  const w = cs.workloads.find(w => w.id === id)
  if (!w) return []
  const changes: string[] = []
  const im = text.match(/^\s*image:\s*(\S+)\s*$/m)
  if (im && im[1] !== w.image) {
    changes.push(`镜像 ${w.image.split(':').pop()} → ${im[1].split(':').pop()}`)
    w.image = im[1]
  }
  const rm = text.match(/^\s*replicas:\s*(\d+)\s*$/m)
  const target = rm ? Number(rm[1]) : null
  if (target !== null && target !== w.replicas) {
    changes.push(`副本 ${w.replicas} → ${target}`)
    w.replicas = target
  }
  if (changes.length === 0) {
    w.annotations['k8q.io/last-applied'] = new Date().toISOString()
    return ['无规格差异,仅刷新注解']
  }
  w.annotations['k8q.io/last-applied'] = new Date().toISOString()
  w.status = 'Progressing'
  if (target !== null) w.readyReplicas = Math.min(w.readyReplicas, target)
  cs.events = [
    {
      id: uid(),
      ts: Date.now(),
      type: 'Normal' as const,
      namespace: w.namespace,
      object: `${w.kind.toLowerCase()}/${w.name}`,
      reason: 'SpecUpdated',
      message: `通过 K8Q YAML 编辑应用变更:${changes.join(';')}`,
    },
    ...cs.events,
  ].slice(0, 60)
  emit()
  let step = 0
  const timer = setInterval(() => {
    step++
    w.readyReplicas = Math.min(w.replicas, w.readyReplicas + Math.ceil(w.replicas / 3))
    if (step >= 3 || w.readyReplicas >= w.replicas) {
      w.status = 'Healthy'
      clearInterval(timer)
    }
    emit()
  }, 900)
  return changes
}

export function deleteWorkload(id: string) {
  const cs = current()
  cs.workloads = cs.workloads.filter(w => w.id !== id)
  emit()
}

export function rollbackRelease(id: string, revision: number) {
  const cs = current()
  const r = cs.releases.find(r => r.id === id)
  if (!r) return
  r.status = 'rolling'
  r.readyReplicas = 0
  emit()
  let step = 0
  const timer = setInterval(() => {
    step++
    r.readyReplicas = Math.min(r.replicas, step)
    if (step >= r.replicas) {
      clearInterval(timer)
      r.status = 'deployed'
      r.currentRevision = Math.max(...r.revisions.map(v => v.revision)) + 1
      const src = r.revisions.find(v => v.revision === revision)
      r.revisions.push({
        revision: r.currentRevision,
        imageTag: src?.imageTag ?? 'unknown',
        deployedAt: Date.now(),
        operator: 'allen.galler',
        note: `回滚至 revision ${revision}`,
      })
    }
    emit()
  }, 700)
}

export function rolloutRelease(id: string, imageTag: string) {
  const cs = current()
  const r = cs.releases.find(r => r.id === id)
  if (!r) return
  r.status = 'rolling'
  r.readyReplicas = 0
  emit()
  let step = 0
  const timer = setInterval(() => {
    step++
    r.readyReplicas = Math.min(r.replicas, step)
    if (step >= r.replicas) {
      clearInterval(timer)
      r.status = 'deployed'
      r.currentRevision += 1
      r.revisions.push({
        revision: r.currentRevision,
        imageTag,
        deployedAt: Date.now(),
        operator: 'allen.galler',
        note: '手动触发发布',
      })
    }
    emit()
  }, 800)
}

export interface NewAppInput {
  name: string
  namespace: string
  image: string
  replicas: number
  port: number
  expose: 'ClusterIP' | 'NodePort' | 'Ingress'
}

export function createApp(input: NewAppInput): string {
  const cs = current()
  const id = uid()
  const w: Workload = {
    id,
    kind: 'Deployment',
    name: input.name,
    namespace: input.namespace,
    replicas: input.replicas,
    readyReplicas: 0,
    image: input.image,
    ageMin: 0,
    status: 'Progressing',
    annotations: { 'k8q.io/team': 'sre' },
    pods: [],
  }
  cs.workloads.unshift(w)
  const r: Release = {
    id: uid(),
    name: input.name,
    namespace: input.namespace,
    chart: input.image.split(':')[0],
    currentRevision: 1,
    status: 'rolling',
    replicas: input.replicas,
    readyReplicas: 0,
    revisions: [
      {
        revision: 1,
        imageTag: input.image.split(':')[1] ?? 'latest',
        deployedAt: Date.now(),
        operator: 'allen.galler',
        note: '首次部署',
      },
    ],
  }
  cs.releases.unshift(r)
  emit()
  let step = 0
  const timer = setInterval(() => {
    step++
    w.readyReplicas = Math.min(w.replicas, step)
    r.readyReplicas = w.readyReplicas
    if (step >= w.replicas) {
      clearInterval(timer)
      w.status = 'Healthy'
      r.status = 'deployed'
    }
    emit()
  }, 800)
  return r.id
}

let tickerStarted = false
export function startTicker() {
  if (tickerStarted) return
  tickerStarted = true
  setInterval(() => {
    const cs = current()
    cs.events = [nextEvent(cs.workloads), ...cs.events].slice(0, 60)
    const last = cs.metrics[cs.metrics.length - 1]
    cs.metrics = [
      ...cs.metrics.slice(-47),
      {
        t: Date.now(),
        cpu: Math.max(5, Math.min(95, last.cpu + (Math.random() - 0.5) * 9)),
        mem: Math.max(10, Math.min(95, last.mem + (Math.random() - 0.5) * 6)),
      },
    ]
    emit()
  }, 3500)
}
