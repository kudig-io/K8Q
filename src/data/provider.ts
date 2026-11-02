import type { PodInfo } from '../types'
import type { LogLine } from './mock/logs'
import type { K8sObject } from './objects'

/** 定位一种 K8S 资源类型(group 为空串表示核心组) */
export interface GvkRef {
  group: string
  version: string
  kind: string
}

export interface ListOptions {
  namespace?: string
}

/**
 * 数据层抽象:对齐 K8S 语义的读写接口。
 * 当前由 MockProvider 实现,后续 KubeProvider(真实集群)实现同一接口即可替换。
 */
export interface K8sDataProvider {
  /** 按 GVK 列出对象;namespace 省略或 '全部' 时跨命名空间(集群级对象忽略该参数) */
  list(ref: GvkRef, opts?: ListOptions): K8sObject[]
  /** 取单个对象;集群级对象传 namespace = undefined */
  get(ref: GvkRef, namespace: string | undefined, name: string): K8sObject | undefined
  /** 订阅数据变更(mock 下即 store emit;真实实现走 watch 流) */
  watch(listener: () => void): () => void
  /** 取 Pod 日志 backlog(实时流由 UI 层 tick 追加) */
  logs(namespace: string, podName: string): LogLine[]
  /** 应用 YAML 到指定对象,返回变更描述列表 */
  apply(ref: GvkRef, namespace: string | undefined, name: string, yaml: string): string[]
  /** 扩缩容(仅工作负载类有意义) */
  scale(ref: GvkRef, namespace: string, name: string, replicas: number): void
  /** 滚动重启(仅工作负载类有意义) */
  restart(ref: GvkRef, namespace: string, name: string): void
  /** 删除对象;force 为 true 时跳过优雅终止(gracePeriod=0),可绕过 PDB 对驱逐的阻塞 */
  delete(ref: GvkRef, namespace: string | undefined, name: string, opts?: { force?: boolean }): void
  /** 驱逐 Pod(优雅删除 + 尊重 PodDisruptionBudget,预算耗尽时拒绝) */
  evict(ref: GvkRef, namespace: string, name: string): void
  /** CronJob 立即触发:按真实 K8S 语义生成 `${name}-manual-${unixTs}` Job */
  trigger(ref: GvkRef, namespace: string, name: string): void
  /** CronJob 挂起/恢复调度 */
  setSuspend(ref: GvkRef, namespace: string, name: string, suspend: boolean): void
  /** 工作负载回滚到历史 revision(镜像回退 + 滚动更新) */
  rollback(ref: GvkRef, namespace: string, name: string, revision: number): void
}

export type { K8sObject, LogLine, PodInfo }
