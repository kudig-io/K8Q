import type { Cluster, KEvent, NodeInfo, PodInfo, Release, Workload } from '../types'
import { pick, rand, randInt, uid } from './seed'

export const clusters: Cluster[] = [
  { id: 'cls-prod-east', name: 'prod-east', version: 'v1.30.4', region: '华东1(杭州)', provider: 'ACK' },
  { id: 'cls-staging', name: 'staging', version: 'v1.29.2', region: '华北2(北京)', provider: 'ACK' },
  { id: 'cls-edge-sg', name: 'edge-sg', version: 'v1.28.9', region: '新加坡', provider: 'ACK Edge' },
]

const namespaces = ['default', 'kube-system', 'payment', 'search', 'middleware', 'observability', 'ingress']

const appNames = [
  'gateway-api', 'user-center', 'order-service', 'payment-core', 'risk-engine',
  'search-indexer', 'recommend-svc', 'notify-center', 'billing-job', 'auth-service',
  'inventory-sync', 'trade-engine', 'coupon-svc', 'log-collector', 'metric-agent',
]

const images = [
  'registry.internal/app/gateway-api:v3.12.1',
  'registry.internal/app/user-center:v2.8.0',
  'registry.internal/app/order-service:v5.1.3',
  'registry.internal/pay/payment-core:v4.0.2',
  'registry.internal/ml/risk-engine:v1.9.7',
  'registry.internal/search/indexer:v2.3.0',
  'nginx:1.27-alpine',
  'redis:7.2-cluster',
  'registry.internal/app/notify-center:v1.4.4',
]

function makePods(workload: string, namespace: string, replicas: number, ready: number, nodes: NodeInfo[]): PodInfo[] {
  const pods: PodInfo[] = []
  for (let i = 0; i < replicas; i++) {
    const healthy = i < ready
    const phase = healthy
      ? rand() > 0.08 ? 'Running' : 'Succeeded'
      : rand() > 0.5 ? 'CrashLoopBackOff' : 'Pending'
    pods.push({
      name: `${workload}-${Math.floor(rand() * 1e6).toString(16).padStart(6, '0')}-${i}`,
      namespace,
      workload,
      node: pick(nodes).name,
      phase: phase as PodInfo['phase'],
      restarts: healthy ? randInt(0, 3) : randInt(8, 42),
      ageMin: randInt(30, 60 * 24 * 14),
      cpu: +(rand() * 0.8 + 0.05).toFixed(2),
      mem: +(rand() * 900 + 80).toFixed(0) as unknown as number,
    })
  }
  return pods
}

function makeNodes(count: number, control: number): NodeInfo[] {
  const nodes: NodeInfo[] = []
  for (let i = 0; i < count; i++) {
    const isControl = i < control
    const cpuCapacity = isControl ? 8 : pick([16, 32, 64])
    const memCapacity = isControl ? 32 : pick([64, 128, 256])
    nodes.push({
      name: `${isControl ? 'master' : 'worker'}-${i.toString().padStart(2, '0')}.internal`,
      roles: isControl ? ['control-plane'] : ['worker'],
      ready: rand() > 0.04,
      cpuCapacity,
      memCapacity,
      podsCapacity: 110,
      cpuUsed: +(rand() * 0.6 + 0.15).toFixed(2),
      memUsed: +(rand() * 0.65 + 0.2).toFixed(2),
    })
  }
  return nodes
}

export function buildClusterState(clusterIdx: number) {
  const nodes = makeNodes(clusterIdx === 0 ? 9 : clusterIdx === 1 ? 5 : 4, clusterIdx === 0 ? 3 : 1)
  const workloads: Workload[] = []
  const count = clusterIdx === 0 ? 16 : 9
  for (let i = 0; i < count; i++) {
    const kind = i % 6 === 5 ? 'CronJob' : i % 6 === 4 ? 'DaemonSet' : i % 5 === 3 ? 'StatefulSet' : 'Deployment'
    const name = appNames[i % appNames.length] + (i >= appNames.length ? '-v2' : '')
    const namespace = pick(namespaces.slice(2))
    const replicas = kind === 'CronJob' ? 0 : kind === 'DaemonSet' ? nodes.filter(n => !n.roles.includes('control-plane')).length : randInt(2, 8)
    const degraded = rand() > 0.82 && replicas > 0
    const ready = degraded ? Math.max(0, replicas - randInt(1, 2)) : replicas
    workloads.push({
      id: uid(),
      kind: kind as Workload['kind'],
      name,
      namespace,
      replicas,
      readyReplicas: ready,
      image: images[i % images.length],
      ageMin: randInt(60, 60 * 24 * 90),
      status: degraded ? 'Degraded' : rand() > 0.9 ? 'Progressing' : 'Healthy',
      annotations: { 'k8q.io/team': pick(['sre', 'payment', 'search', 'platform']) },
      pods: makePods(name, namespace, Math.max(replicas, 1), ready, nodes),
    })
  }
  const releases: Release[] = workloads
    .filter(w => w.kind === 'Deployment')
    .slice(0, 6)
    .map((w, i) => {
      const revs = randInt(3, 8)
      const revisions = Array.from({ length: revs }, (_, r) => ({
        revision: r + 1,
        imageTag: `v${randInt(1, 5)}.${randInt(0, 20)}.${randInt(0, 9)}`,
        deployedAt: Date.now() - (revs - r) * randInt(3600_000, 86400_000 * 3),
        operator: pick(['allen.galler', 'ci-bot', 'ops.zhang', 'sre.li']),
        note: pick(['常规发布', 'hotfix: 修复空指针', '灰度转正', '性能优化上线', '依赖升级', '回滚后重新发布']),
      }))
      return {
        id: uid(),
        name: w.name,
        namespace: w.namespace,
        chart: w.image.split(':')[0],
        currentRevision: revs,
        status: i === 1 ? 'rolling' : 'deployed',
        replicas: w.replicas,
        readyReplicas: i === 1 ? Math.max(1, Math.floor(w.replicas / 2)) : w.readyReplicas,
        revisions,
      } as Release
    })
  const events = seedEvents(workloads)
  return { nodes, workloads, releases, events }
}

const warnReasons: Array<[string, string]> = [
  ['BackOff', '容器重启退避中,最近一次退出码 137 (OOMKilled)'],
  ['FailedScheduling', '0/9 节点可用: 5 节点 CPU 不足, 4 节点存在 taint'],
  ['Unhealthy', 'Liveness probe 失败: Get "http://:8080/healthz": context deadline exceeded'],
  ['FailedMount', '无法挂载卷 data-pvc: 等待 PV 绑定超时'],
  ['ImagePullBackOff', '拉取镜像失败: unauthorized: authentication required'],
]
const normalReasons: Array<[string, string]> = [
  ['Scheduled', 'Pod 已成功调度到节点 worker-03.internal'],
  ['Pulled', '镜像拉取成功,耗时 2.31s'],
  ['Started', '容器 main 已启动'],
  ['ScalingReplicaSet', '扩容 ReplicaSet 至 6 副本'],
  ['NodeReady', '节点 worker-07.internal 状态变为 Ready'],
  ['SuccessfulCreate', '已创建 Pod,等待调度'],
]

export function seedEvents(workloads: Workload[]): KEvent[] {
  const events: KEvent[] = []
  for (let i = 0; i < 24; i++) {
    const warn = rand() > 0.6
    const [reason, message] = warn ? pick(warnReasons) : pick(normalReasons)
    const w = pick(workloads)
    events.push({
      id: uid(),
      ts: Date.now() - randInt(5_000, 3600_000 * 4),
      type: warn ? 'Warning' : 'Normal',
      namespace: w.namespace,
      object: `${w.kind.toLowerCase()}/${w.name}`,
      reason,
      message,
    })
  }
  return events.sort((a, b) => b.ts - a.ts)
}

export function nextEvent(workloads: Workload[]): KEvent {
  const warn = Math.random() > 0.62
  const [reason, message] = warn ? pick(warnReasons) : pick(normalReasons)
  const w = workloads[Math.floor(Math.random() * workloads.length)]
  return {
    id: uid(),
    ts: Date.now(),
    type: warn ? 'Warning' : 'Normal',
    namespace: w.namespace,
    object: `${w.kind.toLowerCase()}/${w.name}`,
    reason,
    message,
  }
}

export function yamlFor(w: Workload): string {
  const tpl = w.kind === 'CronJob' ? 'CronJob' : w.kind
  return [
    `apiVersion: ${w.kind === 'CronJob' ? 'batch/v1' : 'apps/v1'}`,
    `kind: ${tpl}`,
    `metadata:`,
    `  name: ${w.name}`,
    `  namespace: ${w.namespace}`,
    `  labels:`,
    `    app: ${w.name}`,
    `    managed-by: k8q`,
    `  annotations:`,
    `    k8q.io/team: ${w.annotations['k8q.io/team'] ?? 'sre'}`,
    `spec:`,
    w.kind === 'CronJob'
      ? `  schedule: "*/15 * * * *"\n  jobTemplate:\n    spec:\n      template:\n        spec:\n          containers:\n          - name: ${w.name}\n            image: ${w.image}\n          restartPolicy: OnFailure`
      : `  replicas: ${w.replicas}\n  selector:\n    matchLabels:\n      app: ${w.name}\n  template:\n    metadata:\n      labels:\n        app: ${w.name}\n    spec:\n      containers:\n      - name: ${w.name}\n        image: ${w.image}\n        ports:\n        - containerPort: 8080\n        resources:\n          requests:\n            cpu: 250m\n            memory: 512Mi\n          limits:\n            cpu: "1"\n            memory: 1Gi\n        readinessProbe:\n          httpGet:\n            path: /healthz\n            port: 8080\n          initialDelaySeconds: 5\n          periodSeconds: 10`,
  ].join('\n')
}
