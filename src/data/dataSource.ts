// 数据源中枢:Mock 演示 / 真实集群(经 node 桥)的切换与统一操作分发。
// 页面只认 activeProvider() 与 useSourceData()/workloadOps(),不感知底层差异。

import { useSyncExternalStore } from 'react'
import type { LogLine } from './mock/logs'
import type { KEvent, MetricPoint, NodeInfo, PodInfo, Revision, Workload } from '../types'
import { KubeProvider, notifyError, onToast } from './kube/provider'
import { snapshotState, startSnapshot, stopSnapshot, subscribeSnapshot } from './kube/snapshot'
import { discoverBridge, type BridgeHealth } from './kube/transport'
import { mockProvider } from './mock/provider'
import { applyYaml, createFromYaml, current, deleteWorkload, evictPod, getState, removePod, restartWorkload, rollbackWorkload, scaleWorkload, suspendCronJob, triggerCronJob, useStore } from './mock/store'
import type { K8sDataProvider } from './provider'

export type SourceMode = 'mock' | 'cluster'

interface SourceState {
  mode: SourceMode
  context?: string
  health: BridgeHealth | null
  bridgeChecked: boolean
}

const LS_MODE = 'k8q.source.mode'
const LS_CTX = 'k8q.source.ctx'

const state: SourceState = {
  mode: localStorage.getItem(LS_MODE) === 'cluster' ? 'cluster' : 'mock',
  context: localStorage.getItem(LS_CTX) ?? undefined,
  health: null,
  bridgeChecked: false,
}

const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(l => l())
}

export function subscribeSource(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function sourceState(): SourceState {
  return state
}

const kubeProvider = new KubeProvider()

export function activeProvider(): K8sDataProvider {
  return state.mode === 'cluster' ? kubeProvider : mockProvider
}

export function activeMode(): SourceMode {
  return state.mode
}

/** 应用启动时调用一次:探测桥,若上次为集群模式则恢复 */
export async function initSource() {
  const health = await discoverBridge(true)
  state.health = health
  state.bridgeChecked = true
  if (state.mode === 'cluster') startSnapshot(health, state.context)
  emit()
}

export function setSourceMode(mode: SourceMode) {
  if (state.mode === mode) return
  state.mode = mode
  localStorage.setItem(LS_MODE, mode)
  if (mode === 'cluster') startSnapshot(state.health, state.context)
  else stopSnapshot()
  emit()
}

export function setSourceContext(ctx: string) {
  state.context = ctx
  localStorage.setItem(LS_CTX, ctx)
  if (state.mode === 'cluster') startSnapshot(state.health, ctx)
  emit()
}

// ── 视图侧统一数据钩子 ────────────────────────────────────

export interface SourceData {
  mode: SourceMode
  workloads: Workload[]
  events: KEvent[]
  namespaces: string[]
  nodes: NodeInfo[]
  metricsHistory: MetricPoint[]
  /** 集群模式附加状态 */
  context?: string
  status: 'idle' | 'connecting' | 'ready' | 'error'
  error?: string
  lastSyncTs: number
}

function useMockStore(): void {
  useStore(s => s)
}

export function useSourceData(): SourceData {
  useMockStore()
  useSyncExternalStore(subscribeSource, () => state.mode)
  const snap = useSyncExternalStore(subscribeSnapshot, snapshotState)
  if (state.mode === 'cluster') {
    return {
      mode: 'cluster',
      workloads: snap.workloads,
      events: snap.events,
      namespaces: snap.namespaces,
      nodes: snap.nodes,
      metricsHistory: snap.metricsHistory,
      context: snap.context,
      status: snap.status,
      error: snap.error,
      lastSyncTs: snap.lastSyncTs,
    }
  }
  const cs = current()
  return { mode: 'mock', workloads: cs.workloads, events: cs.events, namespaces: [...NAMESPACES_MOCK], nodes: cs.nodes, metricsHistory: cs.metrics, status: 'ready', lastSyncTs: 0 }
}

const NAMESPACES_MOCK = ['default', 'kube-system', 'prod-a', 'prod-b', 'monitoring']

// ── 工作负载操作分发(富面板与 Explorer 共用) ──────────────

export interface WorkloadOps {
  /** 富面板 YAML 编辑应用 */
  applyWorkloadYaml(w: Workload, text: string): string[]
  scale(w: Workload, replicas: number): void
  restart(w: Workload): void
  delete(w: Workload): void
  evictPod(namespace: string, name: string): void
  forceDeletePod(namespace: string, name: string): void
  triggerCron(w: Workload): void
  setSuspend(w: Workload, suspend: boolean): void
  rollback(w: Workload, revision: number): void
  /** 集群模式从 ReplicaSet 推导 revision 历史;mock 直接返回内存数据 */
  revisions(w: Workload): Revision[] | null
}

function gvkOf(w: Workload): { group: string; version: string; kind: string } {
  return w.kind === 'CronJob' ? { group: 'batch', version: 'v1', kind: 'CronJob' } : { group: 'apps', version: 'v1', kind: w.kind }
}

export const workloadOps: WorkloadOps = {
  applyWorkloadYaml(w, text) {
    if (state.mode === 'cluster') {
      void kubeProvider.apply(gvkOf(w), w.namespace, w.name, text)
      return ['已提交 merge-patch,等待刷新']
    }
    return applyYaml(w.id, text)
  },
  scale(w, replicas) {
    if (state.mode === 'cluster') void kubeProvider.scale(gvkOf(w), w.namespace, w.name, replicas)
    else scaleWorkload(w.id, replicas)
  },
  restart(w) {
    if (state.mode === 'cluster') void kubeProvider.restart(gvkOf(w), w.namespace, w.name)
    else restartWorkload(w.id)
  },
  delete(w) {
    if (state.mode === 'cluster') void kubeProvider.delete(gvkOf(w), w.namespace, w.name)
    else deleteWorkload(w.id)
  },
  evictPod(ns, name) {
    if (state.mode === 'cluster') void kubeProvider.evict({ group: '', version: 'v1', kind: 'Pod' }, ns, name)
    else evictPod(ns, name)
  },
  forceDeletePod(ns, name) {
    if (state.mode === 'cluster') void kubeProvider.delete({ group: '', version: 'v1', kind: 'Pod' }, ns, name, { force: true })
    else removePod(ns, name, 'force')
  },
  triggerCron(w) {
    if (state.mode === 'cluster') void kubeProvider.trigger(gvkOf(w), w.namespace, w.name)
    else triggerCronJob(w.namespace, w.name)
  },
  setSuspend(w, suspend) {
    if (state.mode === 'cluster') void kubeProvider.setSuspend(gvkOf(w), w.namespace, w.name, suspend)
    else suspendCronJob(w.namespace, w.name, suspend)
  },
  rollback(w, revision) {
    if (state.mode === 'cluster') void kubeProvider.rollback(gvkOf(w), w.namespace, w.name, revision)
    else rollbackWorkload(w.namespace, w.name, revision)
  },
  revisions(w) {
    if (state.mode === 'mock') return w.revisions ?? null
    return null // 集群模式走 async fetchRevisions
  },
}

/** 集群模式:从 ReplicaSet 注解推导 Deployment revision 历史 */
export async function fetchClusterRevisions(w: Workload): Promise<Revision[] | null> {
  if (w.kind === 'CronJob') return null
  return kubeProvider.listRevisions(w.namespace, w.name)
}

/** YAML 多文档创建:mock 走内存 store,集群走 POST */
export function createObjectsFromYaml(text: string): Promise<{ created: string[]; errors: string[] }> {
  if (state.mode === 'cluster') return kubeProvider.createFromYaml(text, getState().namespace === '全部' ? 'default' : getState().namespace)
  return Promise.resolve(createFromYaml(text))
}

/** 集群 Pod 日志(LogViewer 的 fetchLog 通道) */
export function fetchPodLogs(pod: PodInfo): Promise<LogLine[]> {
  return kubeProvider.fetchLogs(pod.namespace, pod.name)
}

export { notifyError, onToast, snapshotState }
