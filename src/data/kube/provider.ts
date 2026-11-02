// KubeProvider:K8sDataProvider 的真实集群实现。
// 数据读取走 snapshot(同步、已规范化),变更动作走 transport(异步 REST),动作后触发刷新。
// 同步 list 契约与 MockProvider 一致,调用点(M1/M2 的页面)无需感知数据源差异。

import type { PodInfo } from '../../types'
import type { LogLine } from '../mock/logs'
import { gvkId, type K8sObject } from '../objects'
import type { GvkRef, K8sDataProvider, ListOptions } from '../provider'
import { parseAll } from '../yamlmini'
import { byId } from '../registry'
import { apiPathFor, BridgeRequestError, logPath, type RawObject } from './transport'
import { currentTransport, ensurePolled, scheduleRefresh, snapshotState, subscribeSnapshot } from './snapshot'

export class KubeProvider implements K8sDataProvider {
  list(ref: GvkRef, opts?: ListOptions): K8sObject[] {
    ensurePolled(ref)
    const all = snapshotState().objects[gvkId(ref.group, ref.version, ref.kind)] ?? []
    if (!opts?.namespace || opts.namespace === '全部') return all
    return all.filter(o => o.metadata.namespace === opts.namespace)
  }

  get(ref: GvkRef, namespace: string | undefined, name: string): K8sObject | undefined {
    return this.list(ref).find(o => o.metadata.name === name && (namespace === undefined || o.metadata.namespace === namespace))
  }

  watch(listener: () => void): () => void {
    return subscribeSnapshot(listener)
  }

  logs(_namespace: string, _podName: string): LogLine[] {
    // 集群日志走 LogViewer 的 fetchLog 异步路径;保留接口以兼容抽象
    return []
  }

  /** 拉取 Pod 日志(真实接口),解析为 LogLine */
  async fetchLogs(namespace: string, podName: string): Promise<LogLine[]> {
    const transport = currentTransport()
    if (!transport) return []
    const text = await transport.request<string>('GET', logPath(namespace, podName))
    return text
      .split('\n')
      .filter(l => l.trim())
      .slice(-400)
      .map(line => {
        const m = line.match(/^(\S+)\s+(DEBUG|INFO|WARN|ERROR)\s+(.*)$/)
        if (m) return { ts: new Date(m[1]).getTime() || Date.now(), level: m[2] as LogLine['level'], stream: 'stdout' as const, msg: m[3] }
        return { ts: Date.now(), level: 'INFO' as LogLine['level'], stream: 'stdout' as const, msg: line }
      })
  }

  apply(ref: GvkRef, namespace: string | undefined, name: string, yaml: string): string[] {
    void this.applyAsync(ref, namespace, name, yaml)
    return ['已提交 merge-patch,刷新后生效(见右上角同步状态)']
  }

  private async applyAsync(ref: GvkRef, namespace: string | undefined, name: string, yaml: string) {
    const transport = currentTransport()
    if (!transport) throw new Error('桥接不可用')
    const doc = parseAll(yaml)[0]
    delete (doc as Record<string, unknown>).apiVersion
    delete (doc as Record<string, unknown>).kind
    delete (doc as Record<string, unknown>).metadata
    const path = apiPathFor(ref.group, ref.version, pluralOf(ref), namespace) + '/' + encodeURIComponent(name)
    try {
      await transport.request('PATCH', path, doc)
      scheduleRefresh()
    } catch (e) {
      notifyError(`应用 YAML 失败:${errMsg(e)}`)
    }
  }

  async scale(ref: GvkRef, namespace: string, name: string, replicas: number): Promise<void> {
    const transport = currentTransport()
    if (!transport) return
    try {
      await transport.request('PATCH', `${apiPathFor(ref.group, ref.version, pluralOf(ref), namespace)}/${encodeURIComponent(name)}/scale`, { spec: { replicas } }, { contentType: 'application/merge-patch+json' })
      scheduleRefresh()
    } catch (e) {
      notifyError(`扩缩容失败:${errMsg(e)}`)
    }
  }

  async restart(ref: GvkRef, namespace: string, name: string): Promise<void> {
    const transport = currentTransport()
    if (!transport) return
    try {
      await transport.request('PATCH', apiPathFor(ref.group, ref.version, pluralOf(ref), namespace) + '/' + encodeURIComponent(name), {
        spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } } } },
      })
      scheduleRefresh()
    } catch (e) {
      notifyError(`滚动重启失败:${errMsg(e)}`)
    }
  }

  async delete(ref: GvkRef, namespace: string | undefined, name: string, opts?: { force?: boolean }): Promise<void> {
    const transport = currentTransport()
    if (!transport) return
    try {
      await transport.request('DELETE', apiPathFor(ref.group, ref.version, pluralOf(ref), namespace) + '/' + encodeURIComponent(name), {
        apiVersion: 'v1',
        kind: 'DeleteOptions',
        gracePeriodSeconds: opts?.force ? 0 : 30,
      })
      scheduleRefresh()
    } catch (e) {
      notifyError(`删除失败:${errMsg(e)}`)
    }
  }

  /** 驱逐:POST eviction 子资源;PDB 拒绝时上游返回 429,错误信息透传给 toast */
  async evict(ref: GvkRef, namespace: string, name: string): Promise<void> {
    const transport = currentTransport()
    if (!transport) return
    if (ref.kind !== 'Pod') return
    try {
      await transport.request('POST', `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}/eviction`, {
        apiVersion: 'policy/v1',
        kind: 'Eviction',
        metadata: { name, namespace },
      })
      scheduleRefresh()
    } catch (e) {
      if (e instanceof BridgeRequestError && e.code === 429) notifyError(`驱逐被拒绝:${errMsg(e)}`)
      else notifyError(`驱逐失败:${errMsg(e)}`)
    }
  }

  /** CronJob 立即触发:取原始 CronJob,以 jobTemplate 组装 Job 后 POST(等价 kubectl create job --from) */
  async trigger(ref: GvkRef, namespace: string, name: string): Promise<void> {
    const transport = currentTransport()
    if (!transport) return
    if (ref.kind !== 'CronJob') return
    try {
      const raw = await transport.request<RawObject>('GET', apiPathFor(ref.group, ref.version, 'cronjobs', namespace) + '/' + encodeURIComponent(name))
      const jobTemplate = ((raw.spec?.jobTemplate as Record<string, unknown> | undefined)?.spec ?? {}) as Record<string, unknown>
      await transport.request('POST', apiPathFor('batch', 'v1', 'jobs', namespace), {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          name: `${name}-manual-${Math.floor(Date.now() / 1000)}`,
          namespace,
          labels: raw.metadata.labels ?? {},
          annotations: { 'k8q.io/triggered-from': `cronjob/${name}` },
        },
        spec: jobTemplate,
      })
      scheduleRefresh()
    } catch (e) {
      notifyError(`触发 CronJob 失败:${errMsg(e)}`)
    }
  }

  async setSuspend(ref: GvkRef, namespace: string, name: string, suspend: boolean): Promise<void> {
    const transport = currentTransport()
    if (!transport) return
    try {
      await transport.request('PATCH', apiPathFor(ref.group, ref.version, pluralOf(ref), namespace) + '/' + encodeURIComponent(name), { spec: { suspend } })
      scheduleRefresh()
    } catch (e) {
      notifyError(`${suspend ? '挂起' : '恢复'}失败:${errMsg(e)}`)
    }
  }

  /** 回滚:从 ReplicaSet 历史取目标 revision 的容器列表,merge-patch 回 Deployment(等价简化版 rollout undo) */
  async rollback(ref: GvkRef, namespace: string, name: string, revision: number): Promise<void> {
    if (ref.kind === 'CronJob') return
    const transport = currentTransport()
    if (!transport) return
    try {
      const rsPath = apiPathFor('apps', 'v1', 'replicasets', namespace)
      const list = await transport.request<{ items?: RawObject[] }>('GET', rsPath)
      const target = (list.items ?? []).find(
        r => r.metadata.ownerReferences?.[0]?.name === name && r.metadata.annotations?.['deployment.kubernetes.io/revision'] === String(revision),
      )
      if (!target) {
        notifyError(`回滚失败:revision ${revision} 不存在`)
        return
      }
      const containers = (target.spec?.template as Record<string, unknown> | undefined)?.containers
      await transport.request('PATCH', apiPathFor('apps', 'v1', 'deployments', namespace) + '/' + encodeURIComponent(name), {
        spec: {
          template: {
            metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } },
            spec: { containers },
          },
        },
      })
      scheduleRefresh()
    } catch (e) {
      notifyError(`回滚失败:${errMsg(e)}`)
    }
  }

  /** Deployment 的 revision 历史(RS 注解推导),富面板回滚弹窗用 */
  async listRevisions(namespace: string, name: string): Promise<{ revision: number; imageTag: string; deployedAt: number; operator: string; note: string }[]> {
    const transport = currentTransport()
    if (!transport) return []
    try {
      const list = await transport.request<{ items?: RawObject[] }>('GET', apiPathFor('apps', 'v1', 'replicasets', namespace))
      return (list.items ?? [])
        .filter(r => r.metadata.ownerReferences?.[0]?.name === name)
        .map(r => {
          const containers = ((r.spec?.template as Record<string, unknown> | undefined)?.containers ?? []) as Record<string, unknown>[]
          const image = String(containers[0]?.image ?? '')
          return {
            revision: Number(r.metadata.annotations?.['deployment.kubernetes.io/revision'] ?? 1),
            imageTag: image.split(':').pop() ?? image,
            deployedAt: r.metadata.creationTimestamp ? new Date(r.metadata.creationTimestamp).getTime() : Date.now(),
            operator: '—',
            note: `ReplicaSet ${r.metadata.name}`,
          }
        })
        .sort((a, b) => b.revision - a.revision)
    } catch {
      return []
    }
  }
  /** YAML 多文档创建:每个文档 POST 到对应 API 路径;返回 {created, errors} */
  async createFromYaml(text: string, defaultNamespace: string): Promise<{ created: string[]; errors: string[] }> {
    const transport = currentTransport()
    const created: string[] = []
    const errors: string[] = []
    if (!transport) {
      errors.push('桥接不可用,无法创建资源')
      return { created, errors }
    }
    let docs: Record<string, unknown>[]
    try {
      docs = parseAll(text)
    } catch (e) {
      return { created, errors: [e instanceof Error ? e.message : String(e)] }
    }
    for (let i = 0; i < docs.length; i++) {
      const at = `第 ${i + 1} 个文档`
      const doc = docs[i]
      const apiVersion = typeof doc.apiVersion === 'string' ? doc.apiVersion : ''
      const kind = typeof doc.kind === 'string' ? doc.kind : ''
      const meta = (doc.metadata ?? {}) as Record<string, unknown>
      const name = typeof meta.name === 'string' ? meta.name.trim() : ''
      if (!apiVersion || !kind || !name) {
        errors.push(`${at}:apiVersion / kind / metadata.name 均为必填`)
        continue
      }
      const entry = byId.get(gvkId(apiVersion.includes('/') ? apiVersion.split('/')[0] : '', apiVersion.split('/').pop() ?? '', kind))
      if (!entry) {
        errors.push(`${at}:资源类型 ${apiVersion} ${kind} 未在 K8Q 注册,无法创建`)
        continue
      }
      if (kind === 'Pod') {
        errors.push(`${at}:不支持直接创建裸 Pod,请创建其控制器(如 Deployment)`)
        continue
      }
      const namespace = typeof meta.namespace === 'string' && meta.namespace ? meta.namespace : entry.namespaced ? defaultNamespace : undefined
      try {
        await transport.request('POST', apiPathFor(entry.group, entry.version, entry.plural, namespace), doc)
        created.push(`${kind}/${name}${namespace ? ` (${namespace})` : ''}`)
      } catch (e) {
        errors.push(`${at}:${errMsg(e)}`)
      }
    }
    if (created.length) scheduleRefresh()
    return { created, errors }
  }
}

function pluralOf(ref: GvkRef): string {
  return byId.get(gvkId(ref.group, ref.version, ref.kind))?.plural ?? ref.kind.toLowerCase() + 's'
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ── 轻量 toast:动作类错误统一 surfaced ────────────────────
type ToastListener = (msg: string | null) => void
let toastListener: ToastListener | null = null
let toastTimer: number | undefined

export function onToast(l: ToastListener): () => void {
  toastListener = l
  return () => {
    if (toastListener === l) toastListener = null
  }
}

export function notifyError(msg: string) {
  console.error('[k8q]', msg)
  toastListener?.(msg)
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toastListener?.(null), 5200)
}

export function podInfosFromSnapshot(namespace: string, workloadName: string): PodInfo[] {
  return snapshotState().workloads.find(w => w.namespace === namespace && w.name === workloadName)?.pods ?? []
}
