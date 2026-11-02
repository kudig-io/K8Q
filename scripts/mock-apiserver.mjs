#!/usr/bin/env node
// K8Q 开发用 K8s API 仿真器:以真实 API server 的 JSON 形状(canonical shapes)提供
// discovery / List / 变更 / eviction / scale / log 接口,内存状态,变更对后续 list 可见。
// 用途:在没有可达集群的机器上端到端验证 K8Q 的 KubeProvider 与 node 桥。
// 运行:node scripts/mock-apiserver.mjs [--port 47880]

import http from 'node:http'
import { URL } from 'node:url'

const args = process.argv.slice(2)
const portIdx = args.indexOf('--port')
const PORT = portIdx >= 0 ? Number(args[portIdx + 1]) : 47880

const uid = (() => { let n = 0; return p => `${p ?? 'obj'}-${(++n).toString(16).padStart(8, '0')}-${Math.random().toString(16).slice(2, 6)}` })()
const now = () => new Date().toISOString()
const minsAgo = m => new Date(Date.now() - m * 60_000).toISOString()

// ── 内存状态 ──────────────────────────────────────────────
const state = { rv: 1000, pods: [], deployments: [], replicaSets: [], statefulSets: [], daemonSets: [], cronJobs: [], jobs: [], services: [], configMaps: [], nodes: [], events: [], pdbs: [] }
const nextRv = () => String(++state.rv)

function pod({ name, ns, labels, nodeName, image, phase = 'Running', restarts = 0, owner, ageMin = 600 }) {
  return {
    apiVersion: 'v1', kind: 'Pod',
    metadata: { name, namespace: ns, uid: uid('pod'), resourceVersion: nextRv(), creationTimestamp: minsAgo(ageMin), labels, ...(owner ? { ownerReferences: [owner] } : {}) },
    spec: { nodeName, containers: [{ name: labels.app ?? 'app', image, ports: [{ containerPort: 8080, protocol: 'TCP' }], resources: { requests: { cpu: '250m', memory: '512Mi' }, limits: { cpu: '1', memory: '1Gi' } } }], restartPolicy: 'Always' },
    status: {
      phase, hostIP: '10.244.0.1', podIP: `10.244.${Math.floor(Math.random() * 8)}.${2 + Math.floor(Math.random() * 250)}`,
      startTime: minsAgo(ageMin),
      conditions: [{ type: 'Ready', status: phase === 'Running' ? 'True' : 'False' }, { type: 'PodScheduled', status: 'True' }],
      containerStatuses: [{ name: labels.app ?? 'app', ready: phase === 'Running', restartCount: restarts, image, state: phase === 'Running' ? { running: { startedAt: minsAgo(ageMin) } } : { waiting: { reason: phase === 'CrashLoopBackOff' ? 'CrashLoopBackOff' : 'ContainerCreating' } } }],
    },
  }
}

function rs({ name, ns, app, replicas, revision, ageMin }) {
  return {
    apiVersion: 'apps/v1', kind: 'ReplicaSet',
    metadata: { name, namespace: ns, uid: uid('rs'), resourceVersion: nextRv(), creationTimestamp: minsAgo(ageMin), labels: { app }, annotations: { 'deployment.kubernetes.io/revision': String(revision) }, ownerReferences: [{ apiVersion: 'apps/v1', kind: 'Deployment', name: app, uid: uid('dep-ref-' + app) }] },
    spec: { replicas, selector: { matchLabels: { app } }, template: { metadata: { labels: { app } }, spec: { containers: [{ name: app, image: `registry.mock/${app}:v1.${revision}.0` }] } } },
    status: { replicas, readyReplicas: replicas },
  }
}

function workload({ kind, name, ns, replicas, image, app, revision, suspended = false, schedule, ageMin = 4000 }) {
  const apiVersion = kind === 'CronJob' ? 'batch/v1' : kind === 'Job' ? 'batch/v1' : 'apps/v1'
  const spec = kind === 'CronJob'
    ? { schedule, suspend: suspended, jobTemplate: { spec: { template: { metadata: { labels: { app } }, spec: { containers: [{ name: app, image }], restartPolicy: 'OnFailure' } } } } }
    : { replicas, selector: { matchLabels: { app } }, template: { metadata: { labels: { app }, annotations: {} }, spec: { containers: [{ name: app, image }], restartPolicy: 'Always' } } }
  const status = kind === 'CronJob'
    ? { lastScheduleTime: minsAgo(30) }
    : { replicas, readyReplicas: kind === 'Job' ? 0 : replicas, availableReplicas: kind === 'Job' ? 0 : replicas }
  return { apiVersion, kind, metadata: { name, namespace: ns, uid: uid(kind.toLowerCase()), resourceVersion: nextRv(), creationTimestamp: minsAgo(ageMin), labels: { app } }, spec, status }
}

function seed() {
  state.nodes = ['mock-control-plane', 'mock-worker-01', 'mock-worker-02'].map((n, i) => ({
    apiVersion: 'v1', kind: 'Node',
    metadata: { name: n, uid: uid('node'), resourceVersion: nextRv(), creationTimestamp: minsAgo(40000), labels: i === 0 ? { 'kubernetes.io/role': 'control-plane' } : { 'kubernetes.io/role': 'worker' } },
    spec: {},
    status: { conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: { kubeletVersion: 'v1.30.4' }, capacity: { cpu: i === 0 ? '8' : '16', memory: `${i === 0 ? 16 : 32}Gi`, pods: '110' }, allocatable: { cpu: i === 0 ? '7800m' : '15600m', memory: `${i === 0 ? 15 : 30}Gi` } },
  }))

  const defs = [
    { kind: 'Deployment', name: 'gateway-api', ns: 'prod-a', replicas: 3, image: 'registry.mock/gateway:v3.12.1', revision: 4 },
    { kind: 'Deployment', name: 'billing-job', ns: 'prod-b', replicas: 2, image: 'registry.mock/billing:v4.0.2', revision: 2 },
    { kind: 'StatefulSet', name: 'redis-data', ns: 'prod-b', replicas: 3, image: 'registry.mock/redis:7.2', revision: 1 },
    { kind: 'DaemonSet', name: 'log-collector', ns: 'kube-system', replicas: 3, image: 'registry.mock/fluentbit:v2.1', revision: 1 },
    { kind: 'CronJob', name: 'data-backup', ns: 'prod-a', schedule: '*/15 * * * *', image: 'registry.mock/backup:v1.8' },
    { kind: 'CronJob', name: 'index-rebuild', ns: 'prod-b', schedule: '0 2 * * *', image: 'registry.mock/indexer:v2.3', suspended: true },
  ]

  for (const d of defs) {
    if (d.kind === 'Deployment') {
      state.deployments.push(workload({ ...d, revision: d.revision }))
      for (let r = d.revision; r >= 1; r--) state.replicaSets.push(rs({ name: `${d.name}-${String(100000 + r * 7919).slice(0, 5)}`, ns: d.ns, app: d.name, replicas: r === d.revision ? d.replicas : 0, revision: r, ageMin: r === d.revision ? 2880 : 20000 }))
      state.deployments.at(-1)._image = d.image
    } else if (d.kind === 'CronJob') state.cronJobs.push(workload(d))
    else if (d.kind === 'StatefulSet') state.statefulSets.push(workload(d))
    else state.daemonSets.push(workload(d))
  }

  const owner = (kind, name, r) => ({ apiVersion: 'apps/v1', kind, name, uid: uid('ref-' + name), controller: true, blockOwnerDeletion: true, ...(r ? {} : {}) })
  // Deployment pods → 经 RS
  for (const dep of state.deployments) {
    const activeRs = state.replicaSets.find(r => r.spec.replicas > 0 && r.metadata.ownerReferences?.[0]?.name === dep.metadata.name)
    for (let i = 0; i < dep.spec.replicas; i++)
      state.pods.push(pod({ name: `${dep.metadata.name}-${activeRs.metadata.name.slice(-5)}-${Math.random().toString(36).slice(2, 7)}`, ns: dep.metadata.namespace, labels: { app: dep.metadata.name }, nodeName: state.nodes[1 + (i % 2)].metadata.name, image: dep._image ?? 'registry.mock/app:latest', restarts: Math.random() > 0.85 ? 3 : 0, owner: owner('ReplicaSet', activeRs.metadata.name), ageMin: 2000 + i * 300 }))
  }
  for (const sts of state.statefulSets)
    for (let i = 0; i < sts.spec.replicas; i++)
      state.pods.push(pod({ name: `${sts.metadata.name}-${i}`, ns: sts.metadata.namespace, labels: { app: sts.metadata.name }, nodeName: state.nodes[1 + (i % 2)].metadata.name, image: sts.spec.template.spec.containers[0].image, owner: owner('StatefulSet', sts.metadata.name) }))
  for (const ds of state.daemonSets)
    state.nodes.forEach((n, i) => {
      if (i === 0) return
      state.pods.push(pod({ name: `${ds.metadata.name}-${Math.random().toString(36).slice(2, 7)}`, ns: ds.metadata.namespace, labels: { app: ds.metadata.name }, nodeName: n.metadata.name, image: ds.spec.template.spec.containers[0].image, owner: owner('DaemonSet', ds.metadata.name) }))
    })

  state.services.push(
    { apiVersion: 'v1', kind: 'Service', metadata: { name: 'gateway-api', namespace: 'prod-a', uid: uid('svc'), resourceVersion: nextRv(), creationTimestamp: minsAgo(9000), labels: { app: 'gateway-api' } }, spec: { type: 'ClusterIP', clusterIP: '10.96.0.51', selector: { app: 'gateway-api' }, ports: [{ port: 8080, protocol: 'TCP' }] }, status: {} },
    { apiVersion: 'v1', kind: 'Service', metadata: { name: 'redis-data', namespace: 'prod-b', uid: uid('svc'), resourceVersion: nextRv(), creationTimestamp: minsAgo(9000), labels: { app: 'redis-data' } }, spec: { type: 'ClusterIP', clusterIP: '10.96.0.77', selector: { app: 'redis-data' }, ports: [{ port: 6379, protocol: 'TCP' }] }, status: {} },
  )
  state.configMaps.push(
    { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'app-config', namespace: 'prod-a', uid: uid('cm'), resourceVersion: nextRv(), creationTimestamp: minsAgo(12000), labels: {} }, data: { env: 'production', owner: 'platform' } },
    { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'kube-proxy', namespace: 'kube-system', uid: uid('cm'), resourceVersion: nextRv(), creationTimestamp: minsAgo(40000), labels: {} }, data: { 'config.conf': 'apiVersion: kubeproxy.config.k8s.io/v1alpha1' } },
  )
  state.pdbs.push(
    { apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', metadata: { name: 'prometheus-pdb', namespace: 'prod-a', uid: uid('pdb'), resourceVersion: nextRv(), creationTimestamp: minsAgo(9000) }, spec: { minAvailable: 2, selector: { matchLabels: { app: 'gateway-api' } } }, status: { disruptionsAllowed: 0, currentHealthy: 2, desiredHealthy: 2 } },
  )
  state.events.push(
    { apiVersion: 'v1', kind: 'Event', metadata: { name: 'gateway-api.187a1f', namespace: 'prod-a', uid: uid('ev'), resourceVersion: nextRv(), creationTimestamp: minsAgo(12) }, involvedObject: { kind: 'Pod', namespace: 'prod-a', name: state.pods[0]?.metadata.name ?? 'gateway-api-x' }, reason: 'Created', message: 'Created container main', type: 'Normal', count: 1, lastTimestamp: minsAgo(12) },
    { apiVersion: 'v1', kind: 'Event', metadata: { name: 'billing-job.187b22', namespace: 'prod-b', uid: uid('ev'), resourceVersion: nextRv(), creationTimestamp: minsAgo(4) }, involvedObject: { kind: 'Deployment', namespace: 'prod-b', name: 'billing-job' }, reason: 'ScalingReplicaSet', message: 'Scaled up replica set billing-job to 2', type: 'Normal', count: 1, lastTimestamp: minsAgo(4) },
    { apiVersion: 'v1', kind: 'Event', metadata: { name: 'redis-data.187c30', namespace: 'prod-b', uid: uid('ev'), resourceVersion: nextRv(), creationTimestamp: minsAgo(2) }, involvedObject: { kind: 'Pod', namespace: 'prod-b', name: 'redis-data-1' }, reason: 'Unhealthy', message: 'Readiness probe failed: connection refused', type: 'Warning', count: 7, lastTimestamp: minsAgo(2) },
  )
}

// ── 行为模拟 ──────────────────────────────────────────────
function addEvent(ns, kind, name, reason, message, type = 'Normal') {
  state.events.unshift({ apiVersion: 'v1', kind: 'Event', metadata: { name: uid('ev'), namespace: ns, uid: uid('ev'), resourceVersion: nextRv(), creationTimestamp: now() }, involvedObject: { kind, namespace: ns, name }, reason, message, type, count: 1, lastTimestamp: now() })
  if (state.events.length > 80) state.events.length = 80
}

function findPod(ns, name) { return state.pods.find(p => p.metadata.namespace === ns && p.metadata.name === name) }
function pdbFor(ns, labels) {
  return state.pdbs.find(p => p.metadata.namespace === ns && Object.entries(p.spec.selector?.matchLabels ?? {}).every(([k, v]) => labels[k] === v) && Object.keys(p.spec.selector?.matchLabels ?? {}).length > 0)
}

function deletePod(ns, name, gracePeriodSeconds = 30) {
  const p = findPod(ns, name)
  if (!p) return null
  state.pods = state.pods.filter(x => x !== p)
  addEvent(ns, 'Pod', name, 'Killing', `Stopping container main (gracePeriodSeconds=${gracePeriodSeconds ?? 30})`)
  // 控制器自愈:Deployment/StatefulSet/DaemonSet 的 owner 存在则延迟重建
  const ownerRef = p.metadata.ownerReferences?.[0]
  if (ownerRef) {
    const rsOfDep = ownerRef.kind === 'ReplicaSet' ? state.replicaSets.find(r => r.metadata.name === ownerRef.name) : undefined
    const depName = rsOfDep?.metadata.ownerReferences?.[0]?.name ?? ownerRef.name
    const depKind = rsOfDep ? 'Deployment' : ownerRef.kind
    setTimeout(() => {
      const src = [depKind === 'Deployment' && state.deployments.find(d => d.metadata.name === depName), depKind === 'StatefulSet' && state.statefulSets.find(d => d.metadata.name === depName), depKind === 'DaemonSet' && state.daemonSets.find(d => d.metadata.name === depName)].find(Boolean)
      if (!src) return
      const image = src.spec.template?.spec?.containers?.[0]?.image
      const baseName = depKind === 'StatefulSet' ? name : `${depName}-${Math.random().toString(36).slice(2, 7)}`
      state.pods.push(pod({ name: baseName, ns, labels: p.metadata.labels, nodeName: state.nodes[1 + Math.floor(Math.random() * 2)].metadata.name, image, owner: ownerRef.kind === 'ReplicaSet' ? ownerRef : owner(depKind, depName) }))
      addEvent(ns, depKind, depName, 'SuccessfulCreate', `Created pod: ${baseName}`)
    }, 1200)
  }
  return p
}

// 扩缩容渐进同步:readyReplicas 每 900ms 逼近 spec.replicas,并增删 Pod
function syncReplicas(dep, kind) {
  const coll = { Deployment: state.deployments, StatefulSet: state.statefulSets, DaemonSet: state.daemonSets }[kind]
  const target = coll.find(x => x === dep)
  if (!target) return
  const cur = target.status.readyReplicas ?? 0
  const want = target.spec.replicas ?? 0
  if (cur === want) return
  const step = cur < want ? Math.min(want, cur + Math.max(1, Math.ceil(Math.abs(want - cur) / 2))) : Math.max(want, cur - Math.max(1, Math.ceil(Math.abs(want - cur) / 2)))
  target.status.readyReplicas = step
  target.status.replicas = step
  if (kind === 'Deployment') { const rsx = state.replicaSets.find(r => r.spec.replicas > 0 && r.metadata.ownerReferences?.[0]?.name === target.metadata.name); if (rsx) rsx.status.readyReplicas = step }
  if (step > cur) {
    for (let i = cur; i < step; i++) {
      const name = kind === 'StatefulSet' ? `${target.metadata.name}-${i}` : `${target.metadata.name}-${Math.random().toString(36).slice(2, 7)}`
      if (kind !== 'StatefulSet' || !findPod(target.metadata.namespace, name))
        state.pods.push(pod({ name, ns: target.metadata.namespace, labels: { app: target.metadata.name }, nodeName: state.nodes[1 + (i % 2)].metadata.name, image: target.spec.template.spec.containers[0].image }))
    }
  }
  addEvent(target.metadata.namespace, kind, target.metadata.name, 'ScalingReplicaSet', `Scaled replica set to ${step}`)
  if (step !== want) setTimeout(() => syncReplicas(dep, kind), 900)
}

// ── HTTP 服务 ─────────────────────────────────────────────
// metrics.k8s.io:基于 Pod 名称哈希生成稳定但随时间漂移的用量
function hashNum(s) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 100000; return h }
const cpuFor = name => `${(hashNum(name) % 700 + 40 + Math.round(Math.sin(Date.now() / 30000 + hashNum(name)) * 60 + 60))}m`
const memFor = name => `${(hashNum(name) % 600 + 120)}Mi`

function podMetricsList() {
  return {
    kind: 'PodMetricsList', apiVersion: 'metrics.k8s.io/v1beta1', metadata: {},
    items: state.pods.map(p => ({
      metadata: { name: p.metadata.name, namespace: p.metadata.namespace, creationTimestamp: now() },
      timestamp: now(), window: '30s',
      containers: (p.spec?.containers ?? []).map(c => ({ name: c.name, usage: { cpu: cpuFor(p.metadata.name), memory: memFor(p.metadata.name) } })),
    })),
  }
}

function nodeMetricsList() {
  return {
    kind: 'NodeMetricsList', apiVersion: 'metrics.k8s.io/v1beta1', metadata: {},
    items: state.nodes.map(n => ({
      metadata: { name: n.metadata.name, creationTimestamp: now() },
      timestamp: now(), window: '30s',
      usage: { cpu: `${Math.round((0.15 + (hashNum(n.metadata.name) % 50) / 100) * Number(n.status.capacity.cpu.replace(/[^0-9.]/g, '')) * 1000)}m`, memory: `${(parseInt(n.status.capacity.memory, 10) * 1024) / 4 | 0}Mi` },
    })),
  }
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const p = u.pathname.replace(/\/+$/, '') || '/'
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }
  const list = (kind, items) => send(200, { kind: `${kind}List`, apiVersion: 'v1', metadata: { resourceVersion: nextRv() }, items })
  let chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8') || '{}'
    let json = {}
    try { json = JSON.parse(body) } catch { /* ignore */ }
    try { route(req.method, p, u, json, send, list) } catch (e) { console.error(e); send(500, { kind: 'Status', status: 'Failure', code: 500, message: String(e) }) }
  })
})

function route(method, p, u, json, send, list) {
  if (method === 'OPTIONS') { send(204, ''); return }

  // discovery
  if (p === '/api') return send(200, { kind: 'APIVersions', versions: ['v1'], serverAddressByClientCIDRs: [{ clientCIDR: '0.0.0.0/0', serverAddress: `127.0.0.1:${PORT}` }] })
  if (p === '/apis') return send(200, { kind: 'APIGroupList', apiVersion: 'v1', groups: ['apps', 'batch', 'policy', 'metrics.k8s.io'].map(g => ({ name: g, versions: [{ groupVersion: `${g}/v1beta1`, version: 'v1beta1' }, { groupVersion: `${g}/v1`, version: 'v1' }].slice(g === 'metrics.k8s.io' ? 0 : 1), preferredVersion: g === 'metrics.k8s.io' ? { groupVersion: 'metrics.k8s.io/v1beta1', version: 'v1beta1' } : { groupVersion: `${g}/v1`, version: 'v1' } })) })
  if (p === '/api/v1') return send(200, { kind: 'APIResourceList', groupVersion: 'v1', resources: ['pods', 'services', 'configmaps', 'events', 'nodes'].map(n => ({ name: n, namespaced: n !== 'nodes', kind: n.replace(/s$/, '').replace(' ', ''), verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'] })) })
  if (p === '/apis/apps/v1') return send(200, { kind: 'APIResourceList', apiVersion: 'v1', groupVersion: 'apps/v1', resources: ['deployments', 'statefulsets', 'daemonsets', 'replicasets'].map(n => ({ name: n, namespaced: true, kind: n.replace(/s$/, '').replace('deployments', 'Deployment').replace('statefulsets', 'StatefulSet').replace('daemonsets', 'DaemonSet').replace('replicasets', 'ReplicaSet'), verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'] })) })

  // pods log(必须在通用 pod 路由前匹配)
  const logM = p.match(/^\/api\/v1\/namespaces\/([^/]+)\/pods\/([^/]+)\/log$/)
  if (logM && method === 'GET') {
    const pod = findPod(decodeURIComponent(logM[1]), decodeURIComponent(logM[2]))
    if (!pod) return send(404, { kind: 'Status', status: 'Failure', code: 404, message: 'pod not found' })
    const lines = []
    for (let i = 29; i >= 0; i--)
      lines.push(`${new Date(Date.now() - i * 2100).toISOString()} ${['INFO', 'INFO', 'WARN', 'ERROR'][i % 4]} [http] request served in ${(Math.random() * 90 + 4).toFixed(1)}ms${i % 7 === 0 ? ' path=/healthz' : i % 5 === 0 ? ' upstream=10.244.1.7:9000' : ''}`)
    if (pod.status.phase === 'Running')
      lines.push(`${now()} INFO [main] heartbeat ok, leader lease renewed`)
    return send(200, lines.join('\n') + '\n', 'text/plain')
  }

  // eviction
  const evM = p.match(/^\/api\/v1\/namespaces\/([^/]+)\/pods\/([^/]+)\/eviction$/)
  if (evM && method === 'POST') {
    const ns = decodeURIComponent(evM[1]), name = decodeURIComponent(evM[2])
    const pod = findPod(ns, name)
    if (!pod) return send(404, { kind: 'Status', status: 'Failure', code: 404, message: `pods "${name}" not found` })
    const pdb = pdbFor(ns, pod.metadata.labels)
    if (pdb && (pdb.status.disruptionsAllowed ?? 0) <= 0)
      return send(429, { kind: 'Status', apiVersion: 'v1', status: 'Failure', message: `Cannot evict pod as it would violate the pod's disruption budget. PodDisruptionBudget ${pdb.metadata.name} has disruptionsAllowed=0`, reason: 'TooManyRequests', code: 429 })
    deletePod(ns, name, json?.kind === 'Eviction' ? 30 : 30)
    return send(201, { kind: 'Eviction', apiVersion: 'policy/v1', metadata: { name, namespace: ns } })
  }

  // scale subresource
  const scaleM = p.match(/^\/apis\/apps\/v1\/namespaces\/([^/]+)\/(deployments|statefulsets|daemonsets)\/([^/]+)\/scale$/)
  if (scaleM) {
    const ns = decodeURIComponent(scaleM[1]), kind = { deployments: 'Deployment', statefulsets: 'StatefulSet', daemonsets: 'DaemonSet' }[scaleM[2]], name = decodeURIComponent(scaleM[3])
    const coll = { Deployment: state.deployments, StatefulSet: state.statefulSets, DaemonSet: state.daemonSets }[kind]
    const w = coll.find(x => x.metadata.namespace === ns && x.metadata.name === name)
    if (!w) return send(404, { kind: 'Status', status: 'Failure', code: 404, message: `${kind} ${name} not found` })
    if (method === 'PATCH' || method === 'PUT') {
      if (typeof json?.spec?.replicas === 'number') { w.spec.replicas = json.spec.replicas; setTimeout(() => syncReplicas(w, kind), 300) }
      return send(200, { kind: 'Scale', apiVersion: 'autoscaling/v1', metadata: { name, namespace: ns }, spec: { replicas: w.spec.replicas }, status: { replicas: w.status.readyReplicas ?? 0 } })
    }
    return send(200, { kind: 'Scale', apiVersion: 'autoscaling/v1', metadata: { name, namespace: ns }, spec: { replicas: w.spec.replicas }, status: { replicas: w.status.readyReplicas ?? 0 } })
  }

  // 常规资源路由(命名空间段可选,支持全命名空间列表)
  const coreM = p.match(/^\/api\/v1\/namespaces\/([^/]+)\/(pods|services|configmaps|events)(?:\/([^/]+)(?:\/(eviction|log|status))?)?$/)
  const coreAllM = p.match(/^\/api\/v1\/(pods|services|configmaps|events|nodes)$/)
  const appsM = p.match(/^\/apis\/apps\/v1\/(?:namespaces\/([^/]+)\/)?(deployments|statefulsets|daemonsets|replicasets)(?:\/([^/]+))?$/)
  const batchM = p.match(/^\/apis\/batch\/v1\/(?:namespaces\/([^/]+)\/)?(cronjobs|jobs)(?:\/([^/]+))?$/)
  const policyM = p.match(/^\/apis\/policy\/v1\/(?:namespaces\/([^/]+)\/)?poddisruptionbudgets$/)

  if (coreAllM && method === 'GET') {
    const kind = coreAllM[1]
    if (kind === 'nodes') return list('Node', state.nodes)
    if (kind === 'events') return list('Event', state.events)
    const coll = { pods: state.pods, services: state.services, configmaps: state.configMaps }[kind]
    return list(kind === 'pods' ? 'Pod' : kind === 'services' ? 'Service' : 'ConfigMap', coll)
  }
  if (coreM && method === 'GET') {
    const ns = decodeURIComponent(coreM[1]), kind = coreM[2]
    if (kind === 'events') return list('Event', state.events.filter(e => e.metadata.namespace === ns))
    const coll = { pods: state.pods, services: state.services, configmaps: state.configMaps }[kind]
    return list(kind === 'pods' ? 'Pod' : kind === 'services' ? 'Service' : 'ConfigMap', coll.filter(x => x.metadata.namespace === ns))
  }
  if (coreM && coreM[4] === undefined && coreM[3] && method === 'DELETE') {
    const ns = decodeURIComponent(coreM[1]), name = decodeURIComponent(coreM[3])
    if (coreM[2] !== 'pods') return send(405, { kind: 'Status', status: 'Failure', code: 405, message: 'not supported in mock' })
    const prev = deletePod(ns, name, json?.gracePeriodSeconds ?? 30)
    if (!prev) return send(404, { kind: 'Status', status: 'Failure', code: 404, message: `pods "${name}" not found` })
    return send(200, { kind: 'Pod', apiVersion: 'v1', metadata: { name, namespace: ns }, status: { phase: prev.status.phase, metadata: { deletionTimestamp: now() } } })
  }

  if (appsM && method === 'GET') {
    const ns = appsM[1] ? decodeURIComponent(appsM[1]) : undefined
    const coll = { deployments: state.deployments, statefulsets: state.statefulSets, daemonsets: state.daemonSets, replicasets: state.replicaSets }[appsM[2]]
    const items = ns ? coll.filter(x => x.metadata.namespace === ns) : coll
    return list({ deployments: 'Deployment', statefulsets: 'StatefulSet', daemonsets: 'DaemonSet', replicasets: 'ReplicaSet' }[appsM[2]], items)
  }
  if (appsM && appsM[1] && appsM[3] && (method === 'PATCH' || method === 'PUT')) {
    const ns = decodeURIComponent(appsM[1])
    const coll = { deployments: state.deployments, statefulsets: state.statefulSets, daemonsets: state.daemonSets, replicasets: state.replicaSets }[appsM[2]]
    const w = coll.find(x => x.metadata.namespace === ns && x.metadata.name === decodeURIComponent(appsM[3]))
    if (!w) return send(404, { kind: 'Status', status: 'Failure', code: 404, message: 'not found' })
    deepMerge(w, json)
    if (appsM[2] !== 'replicasets' && json?.spec?.replicas !== undefined) setTimeout(() => syncReplicas(w, { deployments: 'Deployment', statefulsets: 'StatefulSet', daemonsets: 'DaemonSet' }[appsM[2]]), 300)
    return send(200, w)
  }

  if (batchM && method === 'GET') {
    const ns = batchM[1] ? decodeURIComponent(batchM[1]) : undefined
    const coll = batchM[2] === 'cronjobs' ? state.cronJobs : state.jobs
    const items = ns ? coll.filter(x => x.metadata.namespace === ns) : coll
    return list(batchM[2] === 'cronjobs' ? 'CronJob' : 'Job', items)
  }
  if (batchM && batchM[1] && batchM[2] === 'jobs' && method === 'POST') {
    if (!json?.metadata?.name) return send(422, { kind: 'Status', status: 'Failure', code: 422, message: 'job metadata.name required' })
    const job = { ...json, status: { succeeded: 0, failed: 0, active: 1, startTime: now() } }
    state.jobs.unshift(job)
    addEvent(json.metadata.namespace, 'Job', json.metadata.name, 'SuccessfulCreate', 'Created pod for manual job')
    setTimeout(() => { job.status = { succeeded: 1, failed: 0, active: 0, startTime: job.status.startTime, completionTime: now() }; addEvent(job.metadata.namespace, 'Job', job.metadata.name, 'Completed', 'Job completed successfully') }, 2200)
    return send(201, job)
  }
  if (batchM && batchM[1] && batchM[3] && (method === 'PATCH' || method === 'PUT')) {
    const ns = decodeURIComponent(batchM[1])
    const w = state.cronJobs.find(x => x.metadata.namespace === ns && x.metadata.name === decodeURIComponent(batchM[3]))
    if (!w) return send(404, { kind: 'Status', status: 'Failure', code: 404, message: 'cronjob not found' })
    deepMerge(w, json)
    return send(200, w)
  }

  if (policyM && method === 'GET') {
    const items = policyM[1] ? state.pdbs.filter(x => x.metadata.namespace === decodeURIComponent(policyM[1])) : state.pdbs
    return list('PodDisruptionBudget', items)
  }

  // metrics.k8s.io(资源用量)——必须在兜底空列表路由之前
  if (p === '/apis/metrics.k8s.io/v1beta1/pods' && method === 'GET') return send(200, podMetricsList())
  if (p === '/apis/metrics.k8s.io/v1beta1/nodes' && method === 'GET') return send(200, nodeMetricsList())
  const nsPodMetrics = p.match(/^\/apis\/metrics\.k8s\.io\/v1beta1\/namespaces\/([^/]+)\/pods$/)
  if (nsPodMetrics && method === 'GET') {
    const ns = decodeURIComponent(nsPodMetrics[1])
    const all = podMetricsList()
    return send(200, { ...all, items: all.items.filter(m => m.metadata.namespace === ns) })
  }

  // 兜底:已注册但仿真器未持久化的资源类型 → 空列表(避免视图树轮询 404)
  const anyList = p.match(/^\/(?:api\/v1|apis\/[\w.]+\/v[\w]+)\/([a-z]+)$/)
  if (anyList && method === 'GET') {
    const kind = anyList[1].replace(/ie?s$/, 'y').replace(/s$/, '').replace(/(^|-[a-z])/g, s => s.toUpperCase().replace('-', ''))
    return list(kind === 'Ingres' ? 'Ingress' : kind === 'Endpoint' ? 'Endpoints' : kind, [])
  }

  if (p === '/health') return send(200, { ok: true, mock: true })
  return send(404, { kind: 'Status', status: 'Failure', code: 404, message: `the server could not find the requested resource (${p})` })
}

function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src ?? {})) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) deepMerge(target[k], v)
    else target[k] = v
  }
}

seed()
setInterval(() => {
  // 心跳:让资源版本缓慢前进,模拟集群活性
  nextRv()
}, 5000)
server.listen(PORT, '127.0.0.1', () => console.log(`mock-apiserver listening on http://127.0.0.1:${PORT}`))
