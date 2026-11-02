import type { GvkRef, K8sDataProvider, ListOptions } from '../provider'
import type { K8sObject } from '../objects'
import { logBacklog, type LogLine } from './logs'
import {
  applyObject,
  current,
  deleteObject,
  getObject,
  listObjects,
  removePod,
  restartWorkload,
  rollbackWorkload,
  scaleWorkload,
  subscribe,
  suspendCronJob,
  triggerCronJob,
} from './store'

export class MockProvider implements K8sDataProvider {
  list(ref: GvkRef, opts?: ListOptions): K8sObject[] {
    return listObjects(ref, opts?.namespace)
  }

  get(ref: GvkRef, namespace: string | undefined, name: string): K8sObject | undefined {
    return getObject(ref, namespace, name)
  }

  watch(listener: () => void): () => void {
    return subscribe(listener)
  }

  logs(namespace: string, podName: string): LogLine[] {
    const pod = current()
      .workloads.flatMap(w => w.pods)
      .find(p => p.name === podName && p.namespace === namespace)
    return pod ? logBacklog(pod) : []
  }

  apply(ref: GvkRef, namespace: string | undefined, name: string, yaml: string): string[] {
    return applyObject(ref, namespace, name, yaml)
  }

  scale(ref: GvkRef, namespace: string, name: string, replicas: number): void {
    const w = current().workloads.find(w => w.kind === ref.kind && w.namespace === namespace && w.name === name)
    if (w) scaleWorkload(w.id, replicas)
  }

  restart(ref: GvkRef, namespace: string, name: string): void {
    const w = current().workloads.find(w => w.kind === ref.kind && w.namespace === namespace && w.name === name)
    if (w) restartWorkload(w.id)
  }

  delete(ref: GvkRef, namespace: string | undefined, name: string, opts?: { force?: boolean }): void {
    if (ref.kind === 'Pod' && namespace) removePod(namespace, name, opts?.force ? 'force' : 'graceful')
    else deleteObject(ref, namespace, name)
  }

  evict(ref: GvkRef, namespace: string, name: string): void {
    if (ref.kind !== 'Pod') return
    removePod(namespace, name, 'evict')
  }

  trigger(ref: GvkRef, namespace: string, name: string): void {
    if (ref.kind === 'CronJob') triggerCronJob(namespace, name)
  }

  setSuspend(ref: GvkRef, namespace: string, name: string, suspend: boolean): void {
    if (ref.kind === 'CronJob') suspendCronJob(namespace, name, suspend)
  }

  rollback(ref: GvkRef, namespace: string, name: string, revision: number): void {
    if (ref.kind === 'CronJob') return
    rollbackWorkload(namespace, name, revision)
  }
}

export const mockProvider = new MockProvider()
