import { useSyncExternalStore } from 'react'
import type { Cluster, KEvent, MetricPoint, NodeInfo, PodInfo, Release, Workload, WorkloadKind } from '../../types'
import { buildObjects, deriveNodes, derivePods, deriveReplicaSets, gvkId, hash6, type K8sObject, type ObjMap } from '../objects'
import type { GvkRef } from '../provider'
import { byId, richWorkloadKinds } from '../registry'
import { parseAll } from '../yamlmini'
import { buildClusterState, clusters, nextEvent } from './data'
import { uid } from './seed'

interface ClusterState {
  nodes: NodeInfo[]
  workloads: Workload[]
  releases: Release[]
  events: KEvent[]
  metrics: MetricPoint[]
  objects: ObjMap
}

interface State {
  activeCluster: number
  namespace: string
  clusters: Cluster[]
  perCluster: Record<string, ClusterState>
}

const perCluster: Record<string, ClusterState> = {}
clusters.forEach((c, i) => {
  const built = buildClusterState(i)
  const now = Date.now()
  perCluster[c.id] = {
    ...built,
    objects: buildObjects(i, built.workloads),
    metrics: Array.from({ length: 48 }, (_, k) => ({
      t: now - (47 - k) * 60_000,
      cpu: 34 + Math.sin(k / 5) * 12 + Math.random() * 8,
      mem: 52 + Math.cos(k / 7) * 9 + Math.random() * 6,
    })),
  }
})

let state: State = { activeCluster: 0, namespace: '全部', clusters, perCluster }
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

export function setNamespace(ns: string) {
  state.namespace = ns
  emit()
}

// ── 通用对象读写(Explorer 泛化渲染走这里) ──

export function listObjects(ref: GvkRef, namespace?: string): K8sObject[] {
  const cs = current()
  const id = gvkId(ref.group, ref.version, ref.kind)
  let all: K8sObject[]
  if (id === '/v1/Pod') all = derivePods(cs.workloads)
  else if (id === '/v1/Node') all = deriveNodes(cs.nodes, state.clusters[state.activeCluster].version)
  else if (id === 'apps/v1/ReplicaSet') all = deriveReplicaSets(cs.workloads)
  else all = cs.objects[id] ?? []
  if (!namespace || namespace === '全部') return all
  return all.filter(o => o.metadata.namespace === namespace)
}

export function getObject(ref: GvkRef, namespace: string | undefined, name: string): K8sObject | undefined {
  return listObjects(ref).find(o => o.metadata.name === name && (namespace === undefined || o.metadata.namespace === namespace))
}

export function applyObject(ref: GvkRef, namespace: string | undefined, name: string, _text: string): string[] {
  const obj = getObject(ref, namespace, name)
  if (!obj) return []
  obj.metadata.annotations['k8q.io/last-applied'] = new Date().toISOString()
  const cs = current()
  cs.events = [
    {
      id: uid(),
      ts: Date.now(),
      type: 'Normal' as const,
      namespace: obj.metadata.namespace ?? 'default',
      object: `${obj.kind.toLowerCase()}/${obj.metadata.name}`,
      reason: 'SpecUpdated',
      message: `通过 K8Q YAML 编辑应用变更(mock 调和)`,
    },
    ...cs.events,
  ].slice(0, 60)
  emit()
  return ['无规格差异,刷新注解 k8q.io/last-applied']
}

export function deleteObject(ref: GvkRef, namespace: string | undefined, name: string) {
  const cs = current()
  const id = gvkId(ref.group, ref.version, ref.kind)
  if (cs.objects[id]) {
    cs.objects[id] = cs.objects[id].filter(
      o => !(o.metadata.name === name && (namespace === undefined || o.metadata.namespace === namespace)),
    )
  }
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
  rollRollout(w)
}

/** 滚动更新动画:Pods 全部置 Pending 后分三批拉起 */
function rollRollout(w: Workload) {
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

function addEvent(cs: ClusterState, type: 'Normal' | 'Warning', namespace: string, object: string, reason: string, message: string) {
  cs.events = [{ id: uid(), ts: Date.now(), type, namespace, object, reason, message }, ...cs.events].slice(0, 60)
}

/**
 * Pod 移除,mode 决定语义:
 * - graceful:先进入 Terminating(模拟 gracePeriod),到期后移除
 * - force:立即移除(gracePeriod=0)
 * - evict:驱逐语义,尊重 PDB——目标命名空间存在 disruptionsAllowed=0 的预算时拒绝
 * 控制器自愈:移除后重建副本(StatefulSet 保持原名,其余随机后缀)
 */
export function removePod(namespace: string, name: string, mode: 'graceful' | 'force' | 'evict') {
  const cs = current()
  const w = cs.workloads.find(w => w.namespace === namespace && w.pods.some(p => p.name === name))
  const pod = w?.pods.find(p => p.name === name)
  if (!w || !pod) return
  const obj = `${w.kind.toLowerCase()}/${w.name}`

  if (mode === 'evict') {
    const pdb = (cs.objects[gvkId('policy', 'v1', 'PodDisruptionBudget')] ?? []).find(
      p => p.metadata.namespace === namespace && Number(p.status.disruptionsAllowed) === 0,
    )
    if (pdb) {
      addEvent(cs, 'Warning', namespace, obj, 'Evicted', `驱逐被拒绝:PodDisruptionBudget ${pdb.metadata.name} 可中断额度为 0,请改用强制删除或调整预算`)
      emit()
      return
    }
  }

  const finalize = () => {
    w.pods = w.pods.filter(p => p !== pod)
    const stableName = w.kind === 'StatefulSet'
    const newName = stableName ? name : `${w.name}-${hash6(w.name + Date.now())}`
    const replacement: PodInfo = {
      name: newName,
      namespace,
      workload: w.name,
      node: cs.nodes.length ? cs.nodes[Math.floor(Math.random() * cs.nodes.length)].name : pod.node,
      phase: 'Pending',
      restarts: 0,
      ageMin: 0,
      cpu: 0.02,
      mem: 64,
    }
    w.pods.push(replacement)
    w.readyReplicas = Math.min(w.replicas, w.pods.filter(p => p.phase === 'Running').length)
    addEvent(cs, 'Normal', namespace, obj, 'SuccessfulCreate', `已创建替换 Pod ${newName}${stableName ? '(StatefulSet 保持稳定名称)' : ''}`)
    emit()
    setTimeout(() => {
      replacement.phase = 'Running'
      replacement.cpu = +(Math.random() * 0.6 + 0.05).toFixed(2)
      replacement.mem = +(Math.random() * 700 + 80).toFixed(0)
      w.readyReplicas = Math.min(w.replicas, w.pods.filter(p => p.phase === 'Running').length)
      w.status = w.readyReplicas === w.replicas ? 'Healthy' : 'Progressing'
      emit()
    }, 1500)
  }

  if (mode === 'force') {
    addEvent(cs, 'Normal', namespace, obj, 'Killing', `强制删除 Pod ${name}(gracePeriod=0,跳过优雅终止)`)
    finalize()
  } else {
    addEvent(cs, 'Normal', namespace, obj, 'Killing', `Pod ${name} 进入 Terminating(${mode === 'evict' ? '驱逐' : '优雅删除'},gracePeriod 30s)`)
    pod.phase = 'Terminating'
    emit()
    setTimeout(finalize, mode === 'evict' ? 600 : 1500)
  }
}

export function evictPod(namespace: string, name: string) {
  removePod(namespace, name, 'evict')
}

/** CronJob 立即触发:创建 manual Job,2.6s 后模拟跑完 */
export function triggerCronJob(namespace: string, name: string) {
  const cs = current()
  const w = cs.workloads.find(w => w.kind === 'CronJob' && w.namespace === namespace && w.name === name)
  if (!w) return
  const id = gvkId('batch', 'v1', 'Job')
  cs.objects[id] = cs.objects[id] ?? []
  const jobName = `${name}-manual-${Math.floor(Date.now() / 1000)}`
  const job: K8sObject = {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name: jobName, namespace, labels: { app: name }, annotations: {}, creationTs: Date.now() },
    spec: { completions: 1, parallelism: 1, backoffLimit: 4 },
    status: { succeeded: 0, failed: 0, duration: '—', owner: name },
  }
  cs.objects[id].unshift(job)
  addEvent(cs, 'Normal', namespace, `cronjob/${name}`, 'SuccessfulCreate', `手动触发:已创建 Job ${jobName}`)
  emit()
  setTimeout(() => {
    job.status.succeeded = 1
    job.status.duration = '42s'
    addEvent(current(), 'Normal', namespace, `job/${jobName}`, 'Completed', '手动触发的 Job 已完成(1/1)')
    emit()
  }, 2600)
}

export function suspendCronJob(namespace: string, name: string, suspend: boolean) {
  const cs = current()
  const w = cs.workloads.find(w => w.kind === 'CronJob' && w.namespace === namespace && w.name === name)
  if (!w || w.suspend === suspend) return
  w.suspend = suspend
  addEvent(cs, 'Normal', namespace, `cronjob/${name}`, suspend ? 'Suspended' : 'Resumed', suspend ? '已挂起:调度器不再产生新的 Job' : '已恢复:按 schedule 继续调度')
  emit()
}

/** 回滚到历史 revision:镜像回退 + 记入新 revision + 滚动更新 */
export function rollbackWorkload(namespace: string, name: string, revision: number) {
  const cs = current()
  const w = cs.workloads.find(w => w.kind !== 'CronJob' && w.namespace === namespace && w.name === name)
  const rev = w?.revisions?.find(r => r.revision === revision)
  if (!w || !rev || !w.revisions) return
  const currentRev = w.revisions[0]?.revision ?? 0
  if (revision === currentRev) return
  w.image = `${w.image.split(':')[0]}:${rev.imageTag}`
  w.revisions.unshift({
    revision: currentRev + 1,
    imageTag: rev.imageTag,
    deployedAt: Date.now(),
    operator: 'allen.galler',
    note: `回滚至 revision ${revision}`,
  })
  addEvent(cs, 'Normal', w.namespace, `${w.kind.toLowerCase()}/${w.name}`, 'Rollback', `已回滚至 revision ${revision},镜像回退到 ${rev.imageTag},滚动更新中`)
  rollRollout(w)
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

/** YAML 多文档导入:已注册 GVK 才能创建;工作负载走富渲染,其余进通用对象表 */
export function createFromYaml(text: string): { created: string[]; errors: string[] } {
  const created: string[] = []
  const errors: string[] = []
  let docs: Record<string, unknown>[]
  try {
    docs = parseAll(text)
  } catch (e) {
    return { created, errors: [e instanceof Error ? e.message : String(e)] }
  }
  const cs = current()
  const defaultNs = state.namespace !== '全部' ? state.namespace : 'default'
  docs.forEach((doc, i) => {
    const at = `第 ${i + 1} 个文档`
    const apiVersion = typeof doc.apiVersion === 'string' ? doc.apiVersion : ''
    const kind = typeof doc.kind === 'string' ? doc.kind : ''
    const meta = (doc.metadata ?? {}) as Record<string, unknown>
    const name = typeof meta.name === 'string' ? meta.name.trim() : ''
    if (!apiVersion || !kind || !name) {
      errors.push(`${at}:apiVersion / kind / metadata.name 均为必填`)
      return
    }
    const entry = byId.get(gvkId(apiVersion.includes('/') ? apiVersion.split('/')[0] : '', apiVersion.split('/').pop() ?? '', kind))
    if (!entry) {
      errors.push(`${at}:资源类型 ${apiVersion} ${kind} 未在 K8Q 注册,无法创建`)
      return
    }
    const namespace = typeof meta.namespace === 'string' && meta.namespace ? meta.namespace : defaultNs
    const labels = (typeof meta.labels === 'object' && meta.labels ? meta.labels : {}) as Record<string, string>

    if (kind === 'Pod') {
      errors.push(`${at}:mock 模式不支持直接创建裸 Pod,请创建其控制器(如 Deployment)`)
      return
    }

    if (richWorkloadKinds.includes(kind)) {
      const spec = (typeof doc.spec === 'object' && doc.spec ? doc.spec : {}) as Record<string, unknown>
      const template = spec.template as Record<string, unknown> | undefined
      const containers = (template?.spec as Record<string, unknown> | undefined)?.containers as Record<string, unknown>[] | undefined
      const image = typeof containers?.[0]?.image === 'string' ? (containers[0].image as string) : 'nginx:latest'
      const replicas = kind === 'DaemonSet' ? Math.max(1, Number(spec.replicas ?? 3)) : Math.max(0, Number(spec.replicas ?? 1))
      const w: Workload = {
        id: uid(),
        kind: kind as WorkloadKind,
        name,
        namespace: entry.namespaced ? namespace : 'default',
        replicas: kind === 'CronJob' ? 0 : replicas,
        readyReplicas: 0,
        image,
        ageMin: 0,
        status: 'Progressing',
        labels,
        annotations: {},
        pods: [],
        ...(kind === 'CronJob'
          ? { schedule: typeof spec.schedule === 'string' ? spec.schedule : '*/15 * * * *', suspend: spec.suspend === true, revisions: [] }
          : {
              revisions: [
                {
                  revision: 1,
                  imageTag: image.split(':')[1] ?? 'latest',
                  deployedAt: Date.now(),
                  operator: 'allen.galler',
                  note: 'YAML 导入创建',
                },
              ],
            }),
      }
      cs.workloads.unshift(w)
      if (kind !== 'CronJob' && w.replicas > 0) {
        for (let p = 0; p < w.replicas; p++)
          w.pods.push({
            name: `${name}-${hash6(name + Date.now())}-${p}`,
            namespace: w.namespace,
            workload: name,
            node: cs.nodes.length ? cs.nodes[p % cs.nodes.length].name : 'worker-00.internal',
            phase: 'Pending',
            restarts: 0,
            ageMin: 0,
            cpu: 0.02,
            mem: 64,
          })
        rollRollout(w)
      } else {
        w.status = 'Healthy'
      }
      created.push(`${kind}/${name}${entry.namespaced ? ` (${namespace})` : ''}`)
      addEvent(cs, 'Normal', w.namespace, `${kind.toLowerCase()}/${name}`, 'Created', '通过 K8Q YAML 导入创建')
      return
    }

    const id = gvkId(entry.group, entry.version, kind)
    cs.objects[id] = cs.objects[id] ?? []
    // mock 约定:除 apiVersion/kind/metadata 外的顶层键(data/type/rules/subjects…)都并入 spec,渲染层按扁平 spec 取列
    const rest = { ...doc }
    delete (rest as Record<string, unknown>).apiVersion
    delete (rest as Record<string, unknown>).kind
    delete (rest as Record<string, unknown>).metadata
    cs.objects[id].unshift({
      apiVersion,
      kind,
      metadata: {
        name,
        namespace: entry.namespaced ? namespace : undefined,
        labels,
        annotations: {},
        creationTs: Date.now(),
      },
      spec: rest as Record<string, unknown>,
      status: {},
    })
    created.push(`${kind}/${name}${entry.namespaced ? ` (${namespace})` : ''}`)
    addEvent(cs, 'Normal', entry.namespaced ? namespace : 'default', `${kind.toLowerCase()}/${name}`, 'Created', '通过 K8Q YAML 导入创建')
  })
  if (created.length > 0) emit()
  return { created, errors }
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
    labels: { app: input.name },
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
