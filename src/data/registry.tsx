import type { ReactNode } from 'react'
import { age } from '../components/common'
import { gvkId, objAgeMin, type K8sObject } from './objects'

export type GroupKey = 'workloads' | 'network' | 'storage' | 'config' | 'cluster' | 'rbac' | 'crd'

export interface ColumnDef {
  title: string
  key: string
  width?: number
  mono?: boolean
  value: (o: K8sObject) => string | number
  render?: (o: K8sObject) => ReactNode
}

export interface DetailField {
  k: string
  v: (o: K8sObject) => ReactNode
}

export interface GvkEntry {
  group: string
  version: string
  kind: string
  plural: string
  namespaced: boolean
  cn: string
  category: GroupKey
  columns: ColumnDef[]
  detailFields: DetailField[]
}

export const gvkGroups: { key: GroupKey; cn: string; en: string }[] = [
  { key: 'workloads', cn: '工作负载', en: 'WORKLOADS' },
  { key: 'network', cn: '网络', en: 'NETWORK' },
  { key: 'storage', cn: '存储', en: 'STORAGE' },
  { key: 'config', cn: '配置', en: 'CONFIG' },
  { key: 'cluster', cn: '集群', en: 'CLUSTER' },
  { key: 'rbac', cn: '安全与 RBAC', en: 'SECURITY' },
  { key: 'crd', cn: '自定义资源', en: 'CRD' },
]

/** 这四类控制器在 Explorer 中走富渲染(内嵌 Workloads 页),其余走通用渲染器 */
export const richWorkloadKinds = ['Deployment', 'StatefulSet', 'DaemonSet', 'CronJob']

function pill(tone: 'ok' | 'warn' | 'err' | 'info', text: string): ReactNode {
  const dot = tone === 'ok' ? '' : tone === 'warn' ? ' amber' : tone === 'err' ? ' red' : ' blue'
  return (
    <span className={`status-pill ${tone}`}>
      <span className={`dot${dot}`} />
      {text}
    </span>
  )
}

const nameCol: ColumnDef = {
  title: '名称',
  key: 'name',
  value: o => o.metadata.name,
  render: o => <span className="name-cell">{o.metadata.name}</span>,
}

const nsCol: ColumnDef = {
  title: '命名空间',
  key: 'namespace',
  width: 104,
  mono: true,
  value: o => o.metadata.namespace ?? '',
  render: o => <span className="mono dim">{o.metadata.namespace}</span>,
}

const ageCol: ColumnDef = {
  title: '年龄',
  key: 'age',
  width: 58,
  mono: true,
  value: o => objAgeMin(o),
  render: o => <span className="mono dim">{age(objAgeMin(o))}</span>,
}

/** 纯文本列(mono dim),value 同时用于排序 */
function tc(title: string, key: string, get: (o: K8sObject) => string | number, width?: number): ColumnDef {
  return { title, key, width, mono: true, value: get, render: o => <span className="mono dim">{get(o)}</span> }
}

const nsField: DetailField = { k: '命名空间', v: o => <span className="mono">{o.metadata.namespace ?? '—'}</span> }
const createdField: DetailField = {
  k: '创建时间',
  v: o => <span className="mono">{new Date(o.metadata.creationTs).toLocaleString('zh-CN', { hour12: false })}</span>,
}

/** 键数:mock 生成对象读 spec.keyCount,YAML 导入对象从 spec.data 推导 */
function keyCount(o: K8sObject): number {
  if (o.spec.keyCount !== undefined) return Number(o.spec.keyCount)
  return o.spec.data && typeof o.spec.data === 'object' ? Object.keys(o.spec.data).length : 0
}

function phasePill(phase: string): ReactNode {
  if (phase === 'Running' || phase === 'Succeeded' || phase === 'Bound' || phase === 'Active' || phase === 'Ready' || phase === 'Healthy' || phase === 'Synced')
    return pill('ok', phase)
  if (phase === 'Pending' || phase === 'Progressing' || phase === 'Issuing' || phase === 'OutOfSync' || phase === 'Available' || phase === 'Terminating')
    return pill('warn', phase)
  return pill('err', phase)
}

function wlCols(readyTitle = '就绪'): ColumnDef[] {
  return [
    nameCol,
    nsCol,
    {
      title: readyTitle,
      key: 'ready',
      width: 64,
      mono: true,
      value: o => Number(o.status.readyReplicas ?? 0),
      render: o => {
        const r = Number(o.status.readyReplicas ?? 0)
        const total = Number(o.spec.replicas ?? 0)
        return (
          <span className="mono" style={{ color: r === total ? 'var(--ok)' : 'var(--warn)' }}>
            {r}/{total}
          </span>
        )
      },
    },
    tc('副本', 'replicas', o => Number(o.spec.replicas ?? 0), 56),
    tc('镜像', 'image', o => String(o.spec.image ?? '—')),
    ageCol,
  ]
}

function wlFields(): DetailField[] {
  return [
    { k: '状态', v: o => phasePill(String(o.status.phase ?? 'Healthy')) },
    { k: '就绪副本', v: o => <span className="mono">{Number(o.status.readyReplicas ?? 0)} / {Number(o.spec.replicas ?? 0)}</span> },
    nsField,
    { k: '镜像', v: o => <span className="mono" style={{ fontSize: 11 }}>{String(o.spec.image ?? '—')}</span> },
    createdField,
  ]
}

export const registry: GvkEntry[] = [
  // ── 工作负载 ──
  {
    group: '', version: 'v1', kind: 'Pod', plural: 'pods', namespaced: true, cn: '容器组', category: 'workloads',
    columns: [
      nameCol,
      nsCol,
      { title: '状态', key: 'phase', width: 128, value: o => String(o.status.phase ?? ''), render: o => phasePill(String(o.status.phase)) },
      tc('重启', 'restarts', o => Number(o.status.restarts ?? 0), 56),
      tc('节点', 'node', o => String(o.spec.nodeName ?? ''), 150),
      ageCol,
    ],
    detailFields: [
      { k: '状态', v: o => phasePill(String(o.status.phase)) },
      nsField,
      { k: '节点', v: o => <span className="mono">{String(o.spec.nodeName)}</span> },
      { k: '所属工作负载', v: o => <span className="mono">{String(o.status.workload)}</span> },
      { k: '累计重启', v: o => <span className="mono">{String(o.status.restarts)}</span> },
      { k: '资源占用', v: o => <span className="mono">{Number(o.status.cpu).toFixed(2)}c · {String(o.status.mem)}Mi</span> },
      createdField,
    ],
  },
  {
    group: 'apps', version: 'v1', kind: 'Deployment', plural: 'deployments', namespaced: true, cn: '无状态应用', category: 'workloads',
    columns: wlCols(),
    detailFields: wlFields(),
  },
  {
    group: 'apps', version: 'v1', kind: 'ReplicaSet', plural: 'replicasets', namespaced: true, cn: '副本集', category: 'workloads',
    columns: [
      nameCol,
      nsCol,
      {
        title: '就绪', key: 'ready', width: 64, mono: true,
        value: o => Number(o.status.readyReplicas ?? 0),
        render: o => (
          <span className="mono" style={{ color: Number(o.status.readyReplicas) === Number(o.spec.replicas) ? 'var(--ok)' : 'var(--warn)' }}>
            {String(o.status.readyReplicas)}/{String(o.spec.replicas)}
          </span>
        ),
      },
      tc('所属 Deployment', 'owner', o => String(o.spec.owner ?? ''), 170),
      ageCol,
    ],
    detailFields: [
      { k: '就绪副本', v: o => <span className="mono">{String(o.status.readyReplicas)} / {String(o.spec.replicas)}</span> },
      nsField,
      { k: '所属 Deployment', v: o => <span className="mono">{String(o.spec.owner)}</span> },
      createdField,
    ],
  },
  {
    group: 'apps', version: 'v1', kind: 'StatefulSet', plural: 'statefulsets', namespaced: true, cn: '有状态应用', category: 'workloads',
    columns: wlCols(),
    detailFields: wlFields(),
  },
  {
    group: 'apps', version: 'v1', kind: 'DaemonSet', plural: 'daemonsets', namespaced: true, cn: '守护集', category: 'workloads',
    columns: wlCols(),
    detailFields: wlFields(),
  },
  {
    group: 'batch', version: 'v1', kind: 'Job', plural: 'jobs', namespaced: true, cn: '任务', category: 'workloads',
    columns: [
      nameCol,
      nsCol,
      {
        title: '状态', key: 'jobStatus', width: 100,
        value: o => (Number(o.status.failed) > 0 ? 'Failed' : Number(o.status.succeeded) >= Number(o.spec.completions ?? 1) ? 'Succeeded' : 'Running'),
        render: o => {
          const failed = Number(o.status.failed) > 0
          const done = Number(o.status.succeeded) >= Number(o.spec.completions ?? 1)
          return failed ? pill('err', 'Failed') : done ? pill('ok', 'Succeeded') : pill('info', 'Running')
        },
      },
      tc('完成度', 'completions', o => `${Number(o.status.succeeded)}/${Number(o.spec.completions)}`, 68),
      tc('耗时', 'duration', o => String(o.status.duration ?? '—'), 72),
      ageCol,
    ],
    detailFields: [
      {
        k: '状态',
        v: o => {
          const failed = Number(o.status.failed) > 0
          const done = Number(o.status.succeeded) >= Number(o.spec.completions ?? 1)
          return failed ? pill('err', 'Failed') : done ? pill('ok', 'Succeeded') : pill('info', 'Running')
        },
      },
      nsField,
      { k: '完成度', v: o => <span className="mono">{Number(o.status.succeeded)} / {Number(o.spec.completions)}</span> },
      { k: '耗时', v: o => <span className="mono">{String(o.status.duration)}</span> },
      { k: '来源 CronJob', v: o => <span className="mono">{String(o.status.owner) || '—'}</span> },
      { k: '并行度 / 重试上限', v: o => <span className="mono">{String(o.spec.parallelism)} / {String(o.spec.backoffLimit)}</span> },
      createdField,
    ],
  },
  {
    group: 'batch', version: 'v1', kind: 'CronJob', plural: 'cronjobs', namespaced: true, cn: '定时任务', category: 'workloads',
    columns: [
      nameCol,
      nsCol,
      tc('调度', 'schedule', o => String(o.spec.schedule ?? ''), 130),
      { title: '挂起', key: 'suspend', width: 60, value: o => String(o.spec.suspend ?? 'false'), render: o => <span className="mono dim">{String(o.spec.suspend ?? 'false')}</span> },
      tc('最近调度', 'lastSchedule', o => String(o.status.lastSchedule ?? '—'), 90),
      ageCol,
    ],
    detailFields: [
      nsField,
      { k: '调度表达式', v: o => <span className="mono">{String(o.spec.schedule)}</span> },
      { k: '最近调度', v: o => <span className="mono">{String(o.status.lastSchedule ?? '—')}</span> },
      createdField,
    ],
  },

  // ── 网络 ──
  {
    group: '', version: 'v1', kind: 'Service', plural: 'services', namespaced: true, cn: '服务', category: 'network',
    columns: [
      nameCol,
      nsCol,
      tc('类型', 'type', o => String(o.spec.type), 100),
      tc('ClusterIP', 'clusterIP', o => String(o.spec.clusterIP), 110),
      tc('端口', 'ports', o => (o.spec.ports as string[]).join(', '), 150),
      ageCol,
    ],
    detailFields: [
      { k: '类型', v: o => <span className="mono">{String(o.spec.type)}</span> },
      nsField,
      { k: 'ClusterIP', v: o => <span className="mono">{String(o.spec.clusterIP)}</span> },
      { k: '端口', v: o => <span className="mono">{(o.spec.ports as string[]).join(', ')}</span> },
      createdField,
    ],
  },
  {
    group: '', version: 'v1', kind: 'Endpoints', plural: 'endpoints', namespaced: true, cn: '端点', category: 'network',
    columns: [
      nameCol,
      nsCol,
      tc('地址数', 'addrs', o => (o.spec.addresses as string[]).length, 64),
      tc('地址', 'addrList', o => (o.spec.addresses as string[]).slice(0, 3).join(', ')),
      tc('端口', 'ports', o => (o.spec.ports as string[]).join(', '), 140),
      ageCol,
    ],
    detailFields: [
      nsField,
      { k: '端点地址', v: o => <span className="mono" style={{ fontSize: 11 }}>{(o.spec.addresses as string[]).join(', ')}</span> },
      { k: '端口', v: o => <span className="mono">{(o.spec.ports as string[]).join(', ')}</span> },
      createdField,
    ],
  },
  {
    group: 'discovery.k8s.io', version: 'v1', kind: 'EndpointSlice', plural: 'endpointslices', namespaced: true, cn: '端点切片', category: 'network',
    columns: [
      nameCol,
      nsCol,
      tc('地址类型', 'addressType', o => String(o.spec.addressType), 76),
      tc('端点数', 'endpoints', o => Number(o.spec.endpoints), 64),
      tc('端口', 'ports', o => (o.spec.ports as string[]).join(', '), 140),
      ageCol,
    ],
    detailFields: [
      nsField,
      { k: '所属 Service', v: o => <span className="mono">{o.metadata.labels['kubernetes.io/service-name']}</span> },
      { k: '地址类型', v: o => <span className="mono">{String(o.spec.addressType)}</span> },
      { k: '端点数', v: o => <span className="mono">{String(o.spec.endpoints)}</span> },
      createdField,
    ],
  },
  {
    group: 'networking.k8s.io', version: 'v1', kind: 'Ingress', plural: 'ingresses', namespaced: true, cn: '入口路由', category: 'network',
    columns: [
      nameCol,
      nsCol,
      tc('类', 'class', o => String(o.spec.className), 70),
      tc('主机', 'hosts', o => (o.spec.hosts as string[]).join(', ')),
      tc('地址', 'address', o => String(o.status.address ?? '—'), 110),
      ageCol,
    ],
    detailFields: [
      nsField,
      { k: 'IngressClass', v: o => <span className="mono">{String(o.spec.className)}</span> },
      { k: '主机', v: o => <span className="mono">{(o.spec.hosts as string[]).join(', ')}</span> },
      { k: 'TLS', v: o => <span className="mono">{o.spec.tls ? '启用' : '未启用'}</span> },
      { k: '入口地址', v: o => <span className="mono">{String(o.status.address)}</span> },
      createdField,
    ],
  },
  {
    group: 'networking.k8s.io', version: 'v1', kind: 'IngressClass', plural: 'ingressclasses', namespaced: false, cn: '入口类', category: 'network',
    columns: [
      nameCol,
      tc('控制器', 'controller', o => String(o.spec.controller)),
      { title: '默认', key: 'default', width: 60, value: o => String(o.spec.isDefault), render: o => (o.spec.isDefault ? pill('info', '默认') : <span className="mono dim">—</span>) },
      ageCol,
    ],
    detailFields: [
      { k: '控制器', v: o => <span className="mono">{String(o.spec.controller)}</span> },
      { k: '是否默认', v: o => <span className="mono">{o.spec.isDefault ? '是' : '否'}</span> },
      createdField,
    ],
  },
  {
    group: 'networking.k8s.io', version: 'v1', kind: 'NetworkPolicy', plural: 'networkpolicies', namespaced: true, cn: '网络策略', category: 'network',
    columns: [
      nameCol,
      nsCol,
      tc('Pod 选择器', 'podSelector', o => String(o.spec.podSelector)),
      tc('策略类型', 'policyTypes', o => (o.spec.policyTypes as string[]).join(' + '), 130),
      ageCol,
    ],
    detailFields: [
      nsField,
      { k: 'Pod 选择器', v: o => <span className="mono">{String(o.spec.podSelector)}</span> },
      { k: '策略类型', v: o => <span className="mono">{(o.spec.policyTypes as string[]).join(', ')}</span> },
      createdField,
    ],
  },

  // ── 存储 ──
  {
    group: '', version: 'v1', kind: 'PersistentVolume', plural: 'persistentvolumes', namespaced: false, cn: '持久卷', category: 'storage',
    columns: [
      nameCol,
      tc('容量', 'capacity', o => String(o.spec.capacity), 64),
      tc('访问模式', 'accessModes', o => String(o.spec.accessModes), 76),
      tc('回收策略', 'reclaim', o => String(o.spec.reclaimPolicy), 110),
      { title: '状态', key: 'phase', width: 92, value: o => String(o.status.phase), render: o => phasePill(String(o.status.phase)) },
      ageCol,
    ],
    detailFields: [
      { k: '状态', v: o => phasePill(String(o.status.phase)) },
      { k: '容量', v: o => <span className="mono">{String(o.spec.capacity)}</span> },
      { k: '访问模式', v: o => <span className="mono">{String(o.spec.accessModes)}</span> },
      { k: '回收策略', v: o => <span className="mono">{String(o.spec.reclaimPolicy)}</span> },
      { k: 'StorageClass', v: o => <span className="mono">{String(o.spec.storageClass)}</span> },
      { k: '绑定声明', v: o => <span className="mono">{String(o.status.claim) || '—'}</span> },
      createdField,
    ],
  },
  {
    group: '', version: 'v1', kind: 'PersistentVolumeClaim', plural: 'persistentvolumeclaims', namespaced: true, cn: '持久卷声明', category: 'storage',
    columns: [
      nameCol,
      nsCol,
      { title: '状态', key: 'phase', width: 88, value: o => String(o.status.phase), render: o => phasePill(String(o.status.phase)) },
      tc('卷', 'volume', o => String(o.status.volume) || '—', 120),
      tc('容量', 'capacity', o => String(o.status.capacity), 64),
      ageCol,
    ],
    detailFields: [
      { k: '状态', v: o => phasePill(String(o.status.phase)) },
      nsField,
      { k: '绑定卷', v: o => <span className="mono">{String(o.status.volume) || '—'}</span> },
      { k: '容量', v: o => <span className="mono">{String(o.status.capacity)}</span> },
      { k: 'StorageClass', v: o => <span className="mono">{String(o.spec.storageClass)}</span> },
      createdField,
    ],
  },
  {
    group: 'storage.k8s.io', version: 'v1', kind: 'StorageClass', plural: 'storageclasses', namespaced: false, cn: '存储类', category: 'storage',
    columns: [
      nameCol,
      tc('供应者', 'provisioner', o => String(o.spec.provisioner)),
      tc('回收策略', 'reclaim', o => String(o.spec.reclaimPolicy), 90),
      tc('绑定模式', 'binding', o => String(o.spec.volumeBindingMode), 150),
      { title: '默认', key: 'default', width: 60, value: o => String(o.spec.isDefault), render: o => (o.spec.isDefault ? pill('info', '默认') : <span className="mono dim">—</span>) },
      ageCol,
    ],
    detailFields: [
      { k: '供应者', v: o => <span className="mono">{String(o.spec.provisioner)}</span> },
      { k: '回收策略', v: o => <span className="mono">{String(o.spec.reclaimPolicy)}</span> },
      { k: '绑定模式', v: o => <span className="mono">{String(o.spec.volumeBindingMode)}</span> },
      { k: '是否默认', v: o => <span className="mono">{o.spec.isDefault ? '是' : '否'}</span> },
      createdField,
    ],
  },

  // ── 配置 ──
  {
    group: '', version: 'v1', kind: 'ConfigMap', plural: 'configmaps', namespaced: true, cn: '配置项', category: 'config',
    columns: [nameCol, nsCol, tc('键数', 'keys', keyCount, 64), ageCol],
    detailFields: [
      nsField,
      { k: '数据键数', v: o => <span className="mono">{String(keyCount(o))}</span> },
      createdField,
    ],
  },
  {
    group: '', version: 'v1', kind: 'Secret', plural: 'secrets', namespaced: true, cn: '保密字典', category: 'config',
    columns: [nameCol, nsCol, tc('类型', 'type', o => String(o.spec.type ?? 'Opaque'), 210), tc('键数', 'keys', keyCount, 64), ageCol],
    detailFields: [
      nsField,
      { k: '类型', v: o => <span className="mono">{String(o.spec.type ?? 'Opaque')}</span> },
      { k: '数据键数', v: o => <span className="mono">{String(keyCount(o))}</span> },
      createdField,
    ],
  },
  {
    group: '', version: 'v1', kind: 'ServiceAccount', plural: 'serviceaccounts', namespaced: true, cn: '服务账户', category: 'config',
    columns: [nameCol, nsCol, tc('Secrets 数', 'secrets', o => Number(o.spec.secrets), 84), ageCol],
    detailFields: [
      nsField,
      { k: '关联 Secrets 数', v: o => <span className="mono">{String(o.spec.secrets)}</span> },
      createdField,
    ],
  },
  {
    group: '', version: 'v1', kind: 'ResourceQuota', plural: 'resourcequotas', namespaced: true, cn: '资源配额', category: 'config',
    columns: [
      nameCol,
      nsCol,
      tc('CPU(用/限)', 'cpu', o => `${o.status.cpuUsed}/${o.status.cpuHard}`, 110),
      tc('内存(用/限)', 'mem', o => `${o.status.memUsed}/${o.status.memHard}`, 110),
      ageCol,
    ],
    detailFields: [
      nsField,
      { k: 'CPU 用量 / 上限', v: o => <span className="mono">{String(o.status.cpuUsed)} / {String(o.status.cpuHard)} cores</span> },
      { k: '内存用量 / 上限', v: o => <span className="mono">{String(o.status.memUsed)} / {String(o.status.memHard)}</span> },
      createdField,
    ],
  },
  {
    group: '', version: 'v1', kind: 'LimitRange', plural: 'limitranges', namespaced: true, cn: '限制范围', category: 'config',
    columns: [nameCol, nsCol, tc('约束项数', 'limits', o => Number(o.spec.limits), 76), ageCol],
    detailFields: [
      nsField,
      { k: '约束项数', v: o => <span className="mono">{String(o.spec.limits)}</span> },
      createdField,
    ],
  },
  {
    group: 'autoscaling', version: 'v2', kind: 'HorizontalPodAutoscaler', plural: 'horizontalpodautoscalers', namespaced: true, cn: '水平扩缩器', category: 'config',
    columns: [
      nameCol,
      nsCol,
      tc('目标', 'target', o => String(o.spec.target), 190),
      tc('副本范围', 'range', o => `${o.spec.minReplicas}-${o.spec.maxReplicas}`, 84),
      tc('当前副本', 'current', o => Number(o.status.currentReplicas), 76),
      ageCol,
    ],
    detailFields: [
      nsField,
      { k: '伸缩目标', v: o => <span className="mono">{String(o.spec.target)}</span> },
      { k: '副本范围', v: o => <span className="mono">{String(o.spec.minReplicas)} - {String(o.spec.maxReplicas)}</span> },
      { k: '当前副本', v: o => <span className="mono">{String(o.status.currentReplicas)}</span> },
      { k: '指标', v: o => <span className="mono">{String(o.spec.metric)}</span> },
      createdField,
    ],
  },
  {
    group: 'policy', version: 'v1', kind: 'PodDisruptionBudget', plural: 'poddisruptionbudgets', namespaced: true, cn: '中断预算', category: 'config',
    columns: [
      nameCol,
      nsCol,
      tc('最小可用', 'minAvailable', o => (o.spec.minAvailable !== undefined ? String(o.spec.minAvailable) : '—'), 76),
      tc('最大不可用', 'maxUnavailable', o => (o.spec.maxUnavailable !== undefined ? String(o.spec.maxUnavailable) : '—'), 84),
      tc('允许中断', 'allowed', o => Number(o.status.disruptionsAllowed), 76),
      ageCol,
    ],
    detailFields: [
      nsField,
      { k: '最小可用', v: o => <span className="mono">{o.spec.minAvailable !== undefined ? String(o.spec.minAvailable) : '—'}</span> },
      { k: '最大不可用', v: o => <span className="mono">{o.spec.maxUnavailable !== undefined ? String(o.spec.maxUnavailable) : '—'}</span> },
      { k: '当前允许中断', v: o => <span className="mono">{String(o.status.disruptionsAllowed)}</span> },
      createdField,
    ],
  },

  // ── 集群 ──
  {
    group: '', version: 'v1', kind: 'Node', plural: 'nodes', namespaced: false, cn: '节点', category: 'cluster',
    columns: [
      nameCol,
      tc('角色', 'roles', o => String(o.status.roles), 110),
      { title: '状态', key: 'ready', width: 88, value: o => String(o.status.ready), render: o => (o.status.ready ? pill('ok', 'Ready') : pill('err', 'NotReady')) },
      tc('CPU 使用', 'cpu', o => `${(Number(o.status.cpuUsed) * 100).toFixed(0)}% / ${o.spec.capacityCpu}c`, 110),
      tc('内存使用', 'mem', o => `${(Number(o.status.memUsed) * 100).toFixed(0)}% / ${o.spec.capacityMem}Gi`, 120),
      tc('Pods 容量', 'podsCapacity', o => Number(o.spec.podsCapacity), 84),
    ],
    detailFields: [
      { k: '状态', v: o => (o.status.ready ? pill('ok', 'Ready') : pill('err', 'NotReady')) },
      { k: '角色', v: o => <span className="mono">{String(o.status.roles)}</span> },
      { k: 'Kubelet 版本', v: o => <span className="mono">{String(o.status.version)}</span> },
      { k: 'CPU 容量 / 使用', v: o => <span className="mono">{String(o.spec.capacityCpu)}c · {(Number(o.status.cpuUsed) * 100).toFixed(0)}%</span> },
      { k: '内存容量 / 使用', v: o => <span className="mono">{String(o.spec.capacityMem)}Gi · {(Number(o.status.memUsed) * 100).toFixed(0)}%</span> },
      { k: 'Pods 容量', v: o => <span className="mono">{String(o.spec.podsCapacity)}</span> },
      createdField,
    ],
  },
  {
    group: '', version: 'v1', kind: 'Namespace', plural: 'namespaces', namespaced: false, cn: '命名空间', category: 'cluster',
    columns: [
      nameCol,
      { title: '状态', key: 'phase', width: 88, value: o => String(o.status.phase), render: o => phasePill(String(o.status.phase)) },
      tc('标签数', 'labels', o => Object.keys(o.metadata.labels).length, 64),
      ageCol,
    ],
    detailFields: [
      { k: '状态', v: o => phasePill(String(o.status.phase)) },
      createdField,
    ],
  },
  {
    group: 'scheduling.k8s.io', version: 'v1', kind: 'PriorityClass', plural: 'priorityclasses', namespaced: false, cn: '优先级类', category: 'cluster',
    columns: [
      nameCol,
      tc('值', 'value', o => Number(o.spec.value), 100),
      tc('抢占策略', 'preemption', o => String(o.spec.preemptionPolicy), 150),
      { title: '全局默认', key: 'globalDefault', width: 76, value: o => String(o.spec.globalDefault), render: o => (o.spec.globalDefault ? pill('info', '默认') : <span className="mono dim">—</span>) },
      ageCol,
    ],
    detailFields: [
      { k: '优先级值', v: o => <span className="mono">{String(o.spec.value)}</span> },
      { k: '抢占策略', v: o => <span className="mono">{String(o.spec.preemptionPolicy)}</span> },
      { k: '全局默认', v: o => <span className="mono">{o.spec.globalDefault ? '是' : '否'}</span> },
      createdField,
    ],
  },
  {
    group: 'node.k8s.io', version: 'v1', kind: 'RuntimeClass', plural: 'runtimeclasses', namespaced: false, cn: '运行时类', category: 'cluster',
    columns: [nameCol, tc('处理器', 'handler', o => String(o.spec.handler), 110), ageCol],
    detailFields: [
      { k: '容器运行时处理器', v: o => <span className="mono">{String(o.spec.handler)}</span> },
      createdField,
    ],
  },

  // ── 安全与 RBAC ──
  {
    group: 'rbac.authorization.k8s.io', version: 'v1', kind: 'Role', plural: 'roles', namespaced: true, cn: '角色', category: 'rbac',
    columns: [nameCol, nsCol, tc('规则数', 'rules', o => Number(o.spec.rules), 64), ageCol],
    detailFields: [nsField, { k: '规则数', v: o => <span className="mono">{String(o.spec.rules)}</span> }, createdField],
  },
  {
    group: 'rbac.authorization.k8s.io', version: 'v1', kind: 'ClusterRole', plural: 'clusterroles', namespaced: false, cn: '集群角色', category: 'rbac',
    columns: [nameCol, tc('规则数', 'rules', o => Number(o.spec.rules), 64), ageCol],
    detailFields: [{ k: '规则数', v: o => <span className="mono">{String(o.spec.rules)}</span> }, createdField],
  },
  {
    group: 'rbac.authorization.k8s.io', version: 'v1', kind: 'RoleBinding', plural: 'rolebindings', namespaced: true, cn: '角色绑定', category: 'rbac',
    columns: [nameCol, nsCol, tc('绑定角色', 'roleRef', o => String(o.spec.roleRef), 170), tc('主体数', 'subjects', o => Number(o.spec.subjects), 64), ageCol],
    detailFields: [
      nsField,
      { k: '绑定角色', v: o => <span className="mono">{String(o.spec.roleRef)}</span> },
      { k: '主体数', v: o => <span className="mono">{String(o.spec.subjects)}</span> },
      createdField,
    ],
  },
  {
    group: 'rbac.authorization.k8s.io', version: 'v1', kind: 'ClusterRoleBinding', plural: 'clusterrolebindings', namespaced: false, cn: '集群角色绑定', category: 'rbac',
    columns: [nameCol, tc('绑定角色', 'roleRef', o => String(o.spec.roleRef), 190), tc('主体数', 'subjects', o => Number(o.spec.subjects), 64), ageCol],
    detailFields: [
      { k: '绑定角色', v: o => <span className="mono">{String(o.spec.roleRef)}</span> },
      { k: '主体数', v: o => <span className="mono">{String(o.spec.subjects)}</span> },
      createdField,
    ],
  },

  // ── 自定义资源(CRD) ──
  {
    group: 'cert-manager.io', version: 'v1', kind: 'Certificate', plural: 'certificates', namespaced: true, cn: '证书', category: 'crd',
    columns: [
      nameCol,
      nsCol,
      tc('Secret', 'secretName', o => String(o.spec.secretName), 160),
      tc('签发者', 'issuer', o => String(o.spec.issuerRef), 120),
      { title: '状态', key: 'condition', width: 96, value: o => String(o.status.condition), render: o => phasePill(String(o.status.condition)) },
      ageCol,
    ],
    detailFields: [
      { k: '状态', v: o => phasePill(String(o.status.condition)) },
      nsField,
      { k: '目标 Secret', v: o => <span className="mono">{String(o.spec.secretName)}</span> },
      { k: '签发者', v: o => <span className="mono">{String(o.spec.issuerRef)}</span> },
      { k: 'DNS 名称', v: o => <span className="mono">{(o.spec.dnsNames as string[]).join(', ')}</span> },
      createdField,
    ],
  },
  {
    group: 'argoproj.io', version: 'v1alpha1', kind: 'Rollout', plural: 'rollouts', namespaced: true, cn: '渐进式发布', category: 'crd',
    columns: [
      nameCol,
      nsCol,
      tc('策略', 'strategy', o => String(o.spec.strategy), 88),
      {
        title: '就绪', key: 'ready', width: 64, mono: true,
        value: o => Number(o.status.readyReplicas),
        render: o => (
          <span className="mono" style={{ color: Number(o.status.readyReplicas) === Number(o.spec.replicas) ? 'var(--ok)' : 'var(--warn)' }}>
            {String(o.status.readyReplicas)}/{String(o.spec.replicas)}
          </span>
        ),
      },
      { title: '阶段', key: 'phase', width: 108, value: o => String(o.status.phase), render: o => phasePill(String(o.status.phase)) },
      ageCol,
    ],
    detailFields: [
      { k: '阶段', v: o => phasePill(String(o.status.phase)) },
      nsField,
      { k: '发布策略', v: o => <span className="mono">{String(o.spec.strategy)}</span> },
      { k: '就绪副本', v: o => <span className="mono">{String(o.status.readyReplicas)} / {String(o.spec.replicas)}</span> },
      { k: '当前步骤', v: o => <span className="mono">{String(o.status.currentStep)}</span> },
      createdField,
    ],
  },
  {
    group: 'argoproj.io', version: 'v1alpha1', kind: 'Application', plural: 'applications', namespaced: true, cn: 'GitOps 应用', category: 'crd',
    columns: [
      nameCol,
      nsCol,
      tc('项目', 'project', o => String(o.spec.project), 72),
      { title: '同步', key: 'sync', width: 100, value: o => String(o.status.sync), render: o => phasePill(String(o.status.sync)) },
      { title: '健康', key: 'health', width: 108, value: o => String(o.status.health), render: o => phasePill(String(o.status.health)) },
      ageCol,
    ],
    detailFields: [
      { k: '同步状态', v: o => phasePill(String(o.status.sync)) },
      { k: '健康状态', v: o => phasePill(String(o.status.health)) },
      nsField,
      { k: '项目', v: o => <span className="mono">{String(o.spec.project)}</span> },
      { k: '源仓库', v: o => <span className="mono" style={{ fontSize: 11 }}>{String(o.spec.source)}</span> },
      createdField,
    ],
  },
]

export const byId = new Map(registry.map(e => [gvkId(e.group, e.version, e.kind), e]))

export function entryId(e: GvkEntry): string {
  return gvkId(e.group, e.version, e.kind)
}

export function entryGvkRef(e: GvkEntry) {
  return { group: e.group, version: e.version, kind: e.kind }
}
