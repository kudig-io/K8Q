export type WorkloadKind = 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'CronJob'
export type PodPhase = 'Running' | 'Pending' | 'Failed' | 'CrashLoopBackOff' | 'Succeeded' | 'Terminating'

export interface Cluster {
  id: string
  name: string
  version: string
  region: string
  provider: string
}

export interface NodeInfo {
  name: string
  roles: string[]
  ready: boolean
  cpuCapacity: number
  memCapacity: number
  podsCapacity: number
  cpuUsed: number
  memUsed: number
}

export interface PodInfo {
  name: string
  namespace: string
  workload: string
  node: string
  phase: PodPhase
  restarts: number
  ageMin: number
  cpu: number
  mem: number
}

export interface Workload {
  id: string
  kind: WorkloadKind
  name: string
  namespace: string
  replicas: number
  readyReplicas: number
  image: string
  ageMin: number
  status: 'Healthy' | 'Degraded' | 'Progressing'
  labels: Record<string, string>
  annotations: Record<string, string>
  pods: PodInfo[]
  /** CronJob 专有:调度表达式与挂起状态 */
  schedule?: string
  suspend?: boolean
  /** 控制器专有:rollout 历史(新 revision 在前) */
  revisions?: Revision[]
}

export interface KEvent {
  id: string
  ts: number
  type: 'Normal' | 'Warning'
  namespace: string
  object: string
  reason: string
  message: string
}

export interface Release {
  id: string
  name: string
  namespace: string
  chart: string
  currentRevision: number
  status: 'deployed' | 'rolling' | 'failed'
  replicas: number
  readyReplicas: number
  revisions: Revision[]
}

export interface Revision {
  revision: number
  imageTag: string
  deployedAt: number
  operator: string
  note: string
}

export interface MetricPoint {
  t: number
  cpu: number
  mem: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  messages: ChatMessage[]
}
