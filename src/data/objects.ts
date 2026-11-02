import type { NodeInfo, Workload } from '../types'
import { rand, randInt } from './mock/seed'

export interface K8sObject {
  apiVersion: string
  kind: string
  metadata: {
    name: string
    namespace?: string
    labels: Record<string, string>
    annotations: Record<string, string>
    creationTs: number
  }
  spec: Record<string, unknown>
  status: Record<string, unknown>
}

export type ObjMap = Record<string, K8sObject[]>

export function gvkId(group: string, version: string, kind: string): string {
  return `${group}/${version}/${kind}`
}

const av = (g: string, v: string) => (g ? `${g}/${v}` : v)

export function objAgeMin(o: K8sObject): number {
  return Math.max(1, Math.floor((Date.now() - o.metadata.creationTs) / 60_000))
}

export function hash6(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6)
}

function meta(
  name: string,
  namespace: string | undefined,
  labels: Record<string, string> = {},
  maxAgeDays = 90,
): K8sObject['metadata'] {
  return { name, namespace, labels, annotations: {}, creationTs: Date.now() - randInt(30, maxAgeDays * 24 * 60) * 60_000 }
}

function mk(
  apiVersion: string,
  kind: string,
  m: K8sObject['metadata'],
  spec: Record<string, unknown> = {},
  status: Record<string, unknown> = {},
): K8sObject {
  return { apiVersion, kind, metadata: m, spec, status }
}

// 从工作负载实时派生,保证扩缩容/重启后 Explorer 侧数据同步
export function derivePods(workloads: Workload[]): K8sObject[] {
  const out: K8sObject[] = []
  for (const w of workloads)
    for (const p of w.pods)
      out.push(
        mk(
          'v1',
          'Pod',
          { name: p.name, namespace: p.namespace, labels: { app: w.name }, annotations: {}, creationTs: Date.now() - p.ageMin * 60_000 },
          { nodeName: p.node, containers: [{ name: w.name, image: w.image }] },
          { phase: p.phase, restarts: p.restarts, cpu: p.cpu, mem: p.mem, workload: `${w.kind}/${w.name}` },
        ),
      )
  return out
}

export function deriveNodes(nodes: NodeInfo[], version: string): K8sObject[] {
  return nodes.map(n =>
    mk(
      'v1',
      'Node',
      {
        name: n.name,
        namespace: undefined,
        labels: { 'kubernetes.io/role': n.roles[0] },
        annotations: {},
        creationTs: Date.now() - 420 * 24 * 3600_000,
      },
      { capacityCpu: n.cpuCapacity, capacityMem: n.memCapacity, podsCapacity: n.podsCapacity },
      { ready: n.ready, roles: n.roles.join(','), cpuUsed: n.cpuUsed, memUsed: n.memUsed, version },
    ),
  )
}

export function deriveReplicaSets(workloads: Workload[]): K8sObject[] {
  return workloads
    .filter(w => w.kind === 'Deployment')
    .map(w =>
      mk(
        'apps/v1',
        'ReplicaSet',
        {
          name: `${w.name}-${hash6(w.name)}`,
          namespace: w.namespace,
          labels: { app: w.name },
          annotations: {},
          creationTs: Date.now() - w.ageMin * 60_000,
        },
        { replicas: w.replicas, owner: w.name },
        { readyReplicas: w.readyReplicas },
      ),
    )
}

export function buildObjects(clusterIdx: number, workloads: Workload[]): ObjMap {
  const map: ObjMap = {}
  const put = (group: string, version: string, kind: string, objs: K8sObject[]) => {
    map[gvkId(group, version, kind)] = objs
  }

  // ── 工作负载(仅 Job 走静态生成;Pod/Node/ReplicaSet 实时派生,四类控制器走富渲染) ──
  const jobs: K8sObject[] = []
  workloads
    .filter(w => w.kind === 'CronJob')
    .forEach(c => {
      const n = randInt(1, 2)
      for (let i = 0; i < n; i++) {
        const failed = rand() > 0.85
        jobs.push(
          mk(
            'batch/v1',
            'Job',
            meta(`${c.name}-${randInt(28100, 29900)}`, c.namespace, { app: c.name }, 3),
            { completions: 1, parallelism: 1, backoffLimit: 4 },
            { succeeded: failed ? 0 : 1, failed: failed ? 1 : 0, duration: `${randInt(20, 400)}s`, owner: c.name },
          ),
        )
      }
    })
  jobs.push(
    mk('batch/v1', 'Job', meta('data-backup-20261029', 'prod-a', { job: 'backup' }, 2), { completions: 1, parallelism: 1, backoffLimit: 2 }, { succeeded: 1, failed: 0, duration: '318s', owner: '' }),
    mk('batch/v1', 'Job', meta('index-rebuild-8842', 'prod-b', { app: 'search-indexer' }, 2), { completions: 1, parallelism: 2, backoffLimit: 3 }, { succeeded: 0, failed: 1, duration: '92s', owner: '' }),
  )
  put('batch', 'v1', 'Job', jobs)

  // ── 网络 ──
  const svcDefs: K8sObject[] = [
    mk('v1', 'Service', meta('kubernetes', 'default', { component: 'apiserver' }, 400), { type: 'ClusterIP', clusterIP: '10.96.0.1', ports: ['443/TCP'] }),
    mk('v1', 'Service', meta('kube-dns', 'kube-system', { 'k8s-app': 'kube-dns' }, 400), { type: 'ClusterIP', clusterIP: '10.96.0.10', ports: ['53/UDP', '53/TCP'] }),
  ]
  workloads
    .filter(w => w.kind !== 'CronJob')
    .slice(0, clusterIdx === 0 ? 8 : 5)
    .forEach((w, i) => {
      const type = i === 0 ? 'LoadBalancer' : i === 3 ? 'NodePort' : 'ClusterIP'
      svcDefs.push(
        mk('v1', 'Service', meta(w.name, w.namespace, { app: w.name }), {
          type,
          clusterIP: `10.96.${randInt(1, 250)}.${randInt(2, 250)}`,
          ports: type === 'NodePort' ? ['8080:31080/TCP'] : type === 'LoadBalancer' ? ['443/TCP', '80/TCP'] : ['8080/TCP'],
        }),
      )
    })
  put('', 'v1', 'Service', svcDefs)

  put(
    '',
    'v1',
    'Endpoints',
    svcDefs.map(s =>
      mk('v1', 'Endpoints', meta(s.metadata.name, s.metadata.namespace), {
        addresses: Array.from({ length: randInt(2, 6) }, () => `10.244.${randInt(0, 8)}.${randInt(2, 250)}`),
        ports: s.spec.ports,
      }),
    ),
  )

  put(
    'discovery.k8s.io',
    'v1',
    'EndpointSlice',
    svcDefs.map(s =>
      mk(av('discovery.k8s.io', 'v1'), 'EndpointSlice', meta(`${s.metadata.name}-${hash6(s.metadata.name + 'slice').slice(0, 5)}`, s.metadata.namespace, { 'kubernetes.io/service-name': s.metadata.name }), {
        addressType: 'IPv4',
        endpoints: randInt(2, 6),
        ports: s.spec.ports,
      }),
    ),
  )

  const ing = (name: string, ns: string, cls: string, host: string, addr: string) =>
    mk(av('networking.k8s.io', 'v1'), 'Ingress', meta(name, ns), { className: cls, hosts: [host], tls: true }, { address: addr })
  put('networking.k8s.io', 'v1', 'Ingress', [
    ing('gateway-api', 'prod-a', 'nginx', 'api.example.internal', '10.244.255.10'),
    ing('user-center', 'prod-a', 'nginx', 'user.example.internal', '10.244.255.10'),
    ing('order-service', 'prod-b', 'alb', 'order.example.internal', '10.244.255.11'),
    ing('grafana', 'monitoring', 'nginx', 'grafana.example.internal', '10.244.255.12'),
    ing('prometheus', 'monitoring', 'nginx', 'prom.example.internal', '10.244.255.12'),
    ing('argocd-server', 'kube-system', 'nginx', 'argocd.example.internal', '10.244.255.13'),
  ])

  put('networking.k8s.io', 'v1', 'IngressClass', [
    mk(av('networking.k8s.io', 'v1'), 'IngressClass', meta('nginx', undefined, {}, 400), { controller: 'k8s.io/ingress-nginx', isDefault: true }),
    mk(av('networking.k8s.io', 'v1'), 'IngressClass', meta('alb', undefined, {}, 300), { controller: 'ingress.k8s.alibabacloud/alb', isDefault: false }),
    mk(av('networking.k8s.io', 'v1'), 'IngressClass', meta('traefik', undefined, {}, 200), { controller: 'traefik.io/ingress-controller', isDefault: false }),
  ])

  const np = (name: string, ns: string, selector: string, types: string[]) =>
    mk(av('networking.k8s.io', 'v1'), 'NetworkPolicy', meta(name, ns), { podSelector: selector, policyTypes: types })
  put('networking.k8s.io', 'v1', 'NetworkPolicy', [
    np('default-deny-ingress', 'prod-a', '{}', ['Ingress']),
    np('allow-internal-traffic', 'prod-a', 'app in (gateway-api, user-center)', ['Ingress', 'Egress']),
    np('allow-from-monitoring', 'prod-b', '{}', ['Ingress']),
    np('allow-internal-traffic', 'prod-b', 'tier=backend', ['Ingress', 'Egress']),
    np('egress-dns-only', 'kube-system', 'k8s-app=kube-dns', ['Egress']),
  ])

  // ── 存储 ──
  const pv = (name: string, cap: string, am: string, reclaim: string, phase: string, claim: string, sc: string) =>
    mk('v1', 'PersistentVolume', meta(name, undefined, {}, 200), { capacity: cap, accessModes: am, reclaimPolicy: reclaim, storageClass: sc }, { phase, claim })
  put('', 'v1', 'PersistentVolume', [
    pv('pv-data-01', '50Gi', 'RWO', 'Retain', 'Bound', 'prod-a/data-pvc', 'alicloud-disk-essd'),
    pv('pv-data-02', '100Gi', 'RWO', 'Retain', 'Bound', 'prod-b/redis-data', 'alicloud-disk-essd'),
    pv('pv-metrics-01', '200Gi', 'RWX', 'Delete', 'Bound', 'monitoring/prometheus-data', 'alicloud-nas'),
    pv('pv-grafana', '20Gi', 'RWO', 'Delete', 'Bound', 'monitoring/grafana-data', 'alicloud-disk-essd'),
    pv('pv-backup-01', '500Gi', 'RWX', 'Retain', 'Available', '', 'alicloud-nas'),
    pv('pv-system-01', '20Gi', 'RWO', 'Delete', 'Bound', 'kube-system/coredns-cache', 'standard'),
  ])

  const pvc = (name: string, ns: string, phase: string, volume: string, cap: string, sc: string) =>
    mk('v1', 'PersistentVolumeClaim', meta(name, ns), { storageClass: sc, accessModes: 'RWO' }, { phase, volume, capacity: cap })
  put('', 'v1', 'PersistentVolumeClaim', [
    pvc('data-pvc', 'prod-a', 'Bound', 'pv-data-01', '50Gi', 'alicloud-disk-essd'),
    pvc('redis-data', 'prod-b', 'Bound', 'pv-data-02', '100Gi', 'alicloud-disk-essd'),
    pvc('prometheus-data', 'monitoring', 'Bound', 'pv-metrics-01', '200Gi', 'alicloud-nas'),
    pvc('grafana-data', 'monitoring', 'Bound', 'pv-grafana', '20Gi', 'alicloud-disk-essd'),
    pvc('coredns-cache', 'kube-system', 'Bound', 'pv-system-01', '20Gi', 'standard'),
    pvc('upload-tmp', 'prod-a', 'Pending', '', '30Gi', 'alicloud-disk-essd'),
  ])

  const sc = (name: string, provisioner: string, reclaim: string, binding: string, isDefault: boolean) =>
    mk(av('storage.k8s.io', 'v1'), 'StorageClass', meta(name, undefined, {}, 300), { provisioner, reclaimPolicy: reclaim, volumeBindingMode: binding, isDefault })
  put('storage.k8s.io', 'v1', 'StorageClass', [
    sc('alicloud-disk-essd', 'diskplugin.csi.alibabacloud.com', 'Delete', 'WaitForFirstConsumer', true),
    sc('alicloud-disk-efficiency', 'diskplugin.csi.alibabacloud.com', 'Delete', 'Immediate', false),
    sc('alicloud-nas', 'nasplugin.csi.alibabacloud.com', 'Retain', 'Immediate', false),
    sc('local-path', 'node.csi.alibabacloud.com', 'Delete', 'WaitForFirstConsumer', false),
  ])

  // ── 配置 ──
  const cm = (name: string, ns: string, keys: number) =>
    mk('v1', 'ConfigMap', meta(name, ns), { keyCount: keys })
  put('', 'v1', 'ConfigMap', [
    cm('coredns', 'kube-system', 2),
    cm('kube-proxy', 'kube-system', 2),
    cm('app-config', 'prod-a', 6),
    cm('gateway-routes', 'prod-a', 4),
    cm('nginx-conf', 'prod-b', 3),
    cm('feature-flags', 'prod-b', 5),
    cm('prometheus-config', 'monitoring', 5),
    cm('grafana-dashboards', 'monitoring', 8),
  ])

  const secret = (name: string, ns: string, type: string, keys: number) =>
    mk('v1', 'Secret', meta(name, ns), { type, keyCount: keys })
  put('', 'v1', 'Secret', [
    secret('default-token-x7k9z', 'default', 'kubernetes.io/service-account-token', 3),
    secret('registry-cred', 'prod-a', 'kubernetes.io/dockerconfigjson', 1),
    secret('tls-wildcard-internal', 'prod-a', 'kubernetes.io/tls', 2),
    secret('db-credentials', 'prod-b', 'Opaque', 4),
    secret('grafana-admin', 'monitoring', 'Opaque', 2),
    secret('alertmanager-main', 'monitoring', 'Opaque', 1),
    secret('kube-dns-token-b4v2m', 'kube-system', 'kubernetes.io/service-account-token', 3),
  ])

  const sa = (name: string, ns: string, secrets: number) =>
    mk('v1', 'ServiceAccount', meta(name, ns), { secrets })
  put('', 'v1', 'ServiceAccount', [
    sa('default', 'default', 1),
    sa('default', 'prod-a', 1),
    sa('default', 'prod-b', 1),
    sa('kube-dns', 'kube-system', 1),
    sa('builder', 'prod-a', 2),
    sa('deploy-bot', 'prod-b', 2),
    sa('prometheus', 'monitoring', 1),
  ])

  const quota = (ns: string, cpuU: number, cpuH: number, memU: string, memH: string) =>
    mk('v1', 'ResourceQuota', meta('compute-quota', ns), {}, { cpuUsed: cpuU, cpuHard: cpuH, memUsed: memU, memHard: memH })
  put('', 'v1', 'ResourceQuota', [quota('prod-a', 23, 40, '41Gi', '80Gi'), quota('prod-b', 12, 24, '27Gi', '48Gi'), quota('monitoring', 6, 12, '9Gi', '16Gi')])

  put('', 'v1', 'LimitRange', [
    mk('v1', 'LimitRange', meta('default-limits', 'prod-a'), { limits: 3 }),
    mk('v1', 'LimitRange', meta('default-limits', 'prod-b'), { limits: 4 }),
  ])

  const hpa = (name: string, ns: string, target: string, min: number, max: number, cur: number) =>
    mk(av('autoscaling', 'v2'), 'HorizontalPodAutoscaler', meta(name, ns), { target, minReplicas: min, maxReplicas: max, metric: 'cpu 70%' }, { currentReplicas: cur })
  put('autoscaling', 'v2', 'HorizontalPodAutoscaler', [
    hpa('gateway-api-hpa', 'prod-a', 'Deployment/gateway-api', 3, 12, 6),
    hpa('risk-engine-hpa', 'prod-a', 'Deployment/risk-engine', 2, 6, 3),
    hpa('order-service-hpa', 'prod-b', 'Deployment/order-service', 2, 8, 4),
    hpa('notify-center-hpa', 'prod-b', 'Deployment/notify-center', 2, 5, 2),
  ])

  const pdb = (name: string, ns: string, minAvail: number | '', maxUnavail: number | '', allowed: number) =>
    mk(av('policy', 'v1'), 'PodDisruptionBudget', meta(name, ns), { minAvailable: minAvail || undefined, maxUnavailable: maxUnavail || undefined }, { disruptionsAllowed: allowed })
  put('policy', 'v1', 'PodDisruptionBudget', [
    pdb('gateway-api-pdb', 'prod-a', 2, '', 1),
    pdb('user-center-pdb', 'prod-a', 1, '', 1),
    pdb('order-service-pdb', 'prod-b', '', 1, 1),
    pdb('prometheus-pdb', 'monitoring', 1, '', 0),
  ])

  // ── 集群 ──
  const nsObj = (name: string, labels: Record<string, string>, maxAgeDays = 400) =>
    mk('v1', 'Namespace', meta(name, undefined, labels, maxAgeDays), {}, { phase: 'Active' })
  put('', 'v1', 'Namespace', [
    nsObj('default', {}),
    nsObj('kube-node-lease', {}),
    nsObj('kube-public', {}),
    nsObj('kube-system', {}),
    nsObj('prod-a', { environment: 'production', team: 'platform' }, 180),
    nsObj('prod-b', { environment: 'production', team: 'trade' }, 180),
    nsObj('monitoring', { environment: 'production', team: 'sre' }, 240),
  ])

  const pc = (name: string, value: number, preemption: string, isDefault: boolean) =>
    mk(av('scheduling.k8s.io', 'v1'), 'PriorityClass', meta(name, undefined, {}, 400), { value, preemptionPolicy: preemption, globalDefault: isDefault })
  put('scheduling.k8s.io', 'v1', 'PriorityClass', [
    pc('system-node-critical', 2000001000, 'PreemptLowerPriority', false),
    pc('system-cluster-critical', 2000000000, 'PreemptLowerPriority', false),
    pc('high-priority', 1000000, 'PreemptLowerPriority', false),
    pc('batch-low', -100, 'Never', false),
  ])

  put('node.k8s.io', 'v1', 'RuntimeClass', [
    mk(av('node.k8s.io', 'v1'), 'RuntimeClass', meta('gvisor', undefined, {}, 300), { handler: 'runsc' }),
    mk(av('node.k8s.io', 'v1'), 'RuntimeClass', meta('kata', undefined, {}, 300), { handler: 'kata' }),
  ])

  // ── 安全与 RBAC ──
  const rbac = av('rbac.authorization.k8s.io', 'v1')
  const role = (name: string, ns: string, rules: number) => mk(rbac, 'Role', meta(name, ns), { rules })
  put('rbac.authorization.k8s.io', 'v1', 'Role', [
    role('prometheus', 'monitoring', 3),
    role('config-reader', 'prod-a', 2),
    role('secret-reader', 'prod-b', 1),
    role('deployer', 'prod-b', 4),
    role('pod-reader', 'kube-system', 2),
  ])

  const clusterRole = (name: string, rules: number) => mk(rbac, 'ClusterRole', meta(name, undefined, {}, 400), { rules })
  put('rbac.authorization.k8s.io', 'v1', 'ClusterRole', [
    clusterRole('cluster-admin', 10),
    clusterRole('admin', 9),
    clusterRole('edit', 6),
    clusterRole('view', 4),
    clusterRole('prometheus', 5),
    clusterRole('system:discovery', 2),
    clusterRole('system:basic-user', 1),
  ])

  const rb = (name: string, ns: string, roleRef: string, subjects: number) =>
    mk(rbac, 'RoleBinding', meta(name, ns), { roleRef, subjects })
  put('rbac.authorization.k8s.io', 'v1', 'RoleBinding', [
    rb('prometheus', 'monitoring', 'Role/prometheus', 1),
    rb('config-reader-binding', 'prod-a', 'Role/config-reader', 2),
    rb('deployer-binding', 'prod-b', 'Role/deployer', 1),
    rb('read-secrets', 'prod-b', 'Role/secret-reader', 1),
  ])

  const crb = (name: string, roleRef: string, subjects: number) =>
    mk(rbac, 'ClusterRoleBinding', meta(name, undefined, {}, 400), { roleRef, subjects })
  put('rbac.authorization.k8s.io', 'v1', 'ClusterRoleBinding', [
    crb('cluster-admin', 'ClusterRole/cluster-admin', 2),
    crb('prometheus', 'ClusterRole/prometheus', 1),
    crb('system:basic-user', 'ClusterRole/system:basic-user', 1),
    crb('read-secrets-global', 'ClusterRole/view', 1),
  ])

  // ── 自定义资源(CRD) ──
  const cert = (name: string, ns: string, secretName: string, issuer: string, dns: string, ready: boolean) =>
    mk(av('cert-manager.io', 'v1'), 'Certificate', meta(name, ns), { secretName, issuerRef: issuer, dnsNames: [dns] }, { ready, condition: ready ? 'Ready' : 'Issuing' })
  put('cert-manager.io', 'v1', 'Certificate', [
    cert('wildcard-internal-tls', 'prod-a', 'tls-wildcard-internal', 'internal-ca', '*.example.internal', true),
    cert('api-cert', 'prod-a', 'api-tls', 'letsencrypt-prod', 'api.example.internal', true),
    cert('grpc-cert', 'prod-b', 'grpc-tls', 'internal-ca', 'grpc.example.internal', true),
    cert('monitoring-tls', 'monitoring', 'monitoring-tls', 'letsencrypt-prod', 'grafana.example.internal', false),
  ])

  const rollout = (name: string, ns: string, strategy: string, replicas: number, ready: number, step: string, phase: string) =>
    mk(av('argoproj.io', 'v1alpha1'), 'Rollout', meta(name, ns, { app: name }), { strategy, replicas }, { readyReplicas: ready, currentStep: step, phase })
  put('argoproj.io', 'v1alpha1', 'Rollout', [
    rollout('gateway-api', 'prod-a', 'canary', 6, 6, '8/8', 'Healthy'),
    rollout('recommend-svc', 'prod-a', 'canary', 5, 3, '2/8', 'Progressing'),
    rollout('order-service', 'prod-b', 'blueGreen', 4, 4, '—', 'Healthy'),
  ])

  const app = (name: string, ns: string, project: string, sync: string, health: string) =>
    mk(av('argoproj.io', 'v1alpha1'), 'Application', meta(name, ns, { 'app.kubernetes.io/instance': name }), { project, source: `git@git.internal:platform/${name}.git` }, { sync, health })
  put('argoproj.io', 'v1alpha1', 'Application', [
    app('cluster-addons', 'kube-system', 'system', 'Synced', 'Healthy'),
    app('ingress-nginx', 'kube-system', 'system', 'Synced', 'Healthy'),
    app('gateway-api', 'prod-a', 'apps', 'Synced', 'Healthy'),
    app('order-platform', 'prod-b', 'apps', 'OutOfSync', 'Progressing'),
    app('monitoring-stack', 'monitoring', 'system', 'Synced', 'Degraded'),
  ])

  return map
}

function scalar(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const s = String(v)
  if (s === '' || /[:#\s\[\]{}&,*!|>'"%@`]/.test(s) || /^(true|false|null|yes|no|on|off|-?\d)/i.test(s)) return JSON.stringify(s)
  return s
}

function dumpYaml(v: unknown, indent: number, lines: string[]) {
  const pad = '  '.repeat(indent)
  if (Array.isArray(v)) {
    if (v.length === 0) return
    for (const item of v) {
      if (item !== null && typeof item === 'object') {
        const sub: string[] = []
        dumpYaml(item, indent + 1, sub)
        const [first, ...rest] = sub
        lines.push(`${pad}- ${first.trimStart()}`)
        lines.push(...rest)
      } else {
        lines.push(`${pad}- ${scalar(item)}`)
      }
    }
    return
  }
  if (v !== null && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === undefined) continue
      if (val !== null && typeof val === 'object') {
        if (Array.isArray(val) && val.length === 0) {
          lines.push(`${pad}${k}: []`)
          continue
        }
        if (!Array.isArray(val) && Object.keys(val).length === 0) {
          lines.push(`${pad}${k}: {}`)
          continue
        }
        lines.push(`${pad}${k}:`)
        dumpYaml(val, indent + 1, lines)
      } else {
        lines.push(`${pad}${k}: ${scalar(val)}`)
      }
    }
    return
  }
  lines.push(`${pad}${scalar(v)}`)
}

export function yamlForObject(o: K8sObject): string {
  const doc: Record<string, unknown> = {
    apiVersion: o.apiVersion,
    kind: o.kind,
    metadata: {
      name: o.metadata.name,
      ...(o.metadata.namespace ? { namespace: o.metadata.namespace } : {}),
      labels: o.metadata.labels,
      annotations: o.metadata.annotations,
    },
    spec: o.spec,
    status: o.status,
  }
  const lines: string[] = []
  dumpYaml(doc, 0, lines)
  return lines.join('\n')
}
