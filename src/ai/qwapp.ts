// QWAPP SDK 适配层
// ─────────────────────────────────────────────────────────────
// 千问官方 QWAPP SDK 的接入点:线上接入时,只需将 MockQWAPPClient
// 替换为真实 QWAPP SDK 实例(实现同一 QWAPPClient 接口),例如:
//
//   import QWAPP from '@qwen/qwapp-sdk'
//   class LiveQWAPPClient implements QWAPPClient {
//     private app = new QWAPP.App({ apiKey: import.meta.env.VITE_QWAPP_API_KEY })
//     async chat(req: QWAPPChatRequest) {
//       const stream = await this.app.chat.stream({ messages: req.messages })
//       for await (const chunk of stream) req.onToken(chunk.delta)
//     }
//   }
//   export const qwapp: QWAPPClient = new LiveQWAPPClient()
//
// MVP 阶段使用 MockQWAPPClient,接口形状保持一致。

export interface QWAPPChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface QWAPPChatRequest {
  messages: QWAPPChatMessage[]
  onToken: (token: string) => void
  signal?: AbortSignal
}

export interface QWAPPClient {
  chat(req: QWAPPChatRequest): Promise<void>
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function intentOf(input: string): string {
  const s = input.toLowerCase()
  if (s.includes('crashloop')) return 'crashloop'
  if (s.includes('oom') || s.includes('137')) return 'oom'
  if (s.includes('imagepull') || s.includes('镜像')) return 'imagepull'
  if (s.includes('yaml') || s.includes('生成') || s.includes('deployment')) return 'yamgen'
  if (s.includes('回滚') || s.includes('rollback')) return 'rollback'
  if (s.includes('节点') || s.includes('node')) return 'node'
  if (s.includes('hpa') || s.includes('扩缩容') || s.includes('弹性')) return 'hpa'
  return 'generic'
}

const answers: Record<string, string> = {
  crashloop: `从事件流看,\`payment-core\` 有 Pod 处于 CrashLoopBackOff。典型排查路径:

1. **看退出码** — 退出码 137 基本可判定 OOMKilled,1 则是应用自身 panic/异常
2. **看上一轮日志**:
\`\`\`bash
kubectl logs <pod> -n payment --previous
\`\`\`
3. **看 probe 配置** — liveness 的 \`initialDelaySeconds\` 过短是常见诱因

当前集群里该 Pod 退出码为 **137**,建议先把 memory limit 从 1Gi 提到 2Gi 验证。需要我直接生成 patch 吗?`,
  oom: `OOMKilled(退出码 137)说明容器实际内存超出了 limit。建议:

1. 用 \`kubectl top pod\` 观察真实水位,mock 数据显示该工作负载峰值约 **1.4Gi**
2. limit 建议设为 **P95 水位 × 1.3**
3. 若是 JVM/Go 服务,检查堆参数是否感知 cgroup v2

\`\`\`yaml
resources:
  limits:
    memory: 2Gi
  requests:
    memory: 1Gi
\`\`\`

注意 requests 别和 limits 设成一样,否则会影响调度弹性。`,
  imagepull: `ImagePullBackOff / unauthorized 一般是凭证问题:

1. 确认 namespace 下存在 imagePullSecret:\n\`kubectl get secret -n <ns> | grep regcred\`
2. mock 集群里 \`search-indexer\` 引用的 \`registry.internal/search/indexer:v2.3.0\` 昨天刚轮换过仓库凭证,**secret 里的 token 可能已过期**
3. 修复方式:重新创建 regcred,然后在 Deployment 的 \`imagePullSecrets\` 中引用

需要我输出完整的 secret 重建命令吗?`,
  yamgen: `给你一份生产可用的 Deployment 模板(带 probe、资源限制和滚动策略):

\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  labels:
    app: my-app
spec:
  replicas: 4
  strategy:
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
      - name: my-app
        image: registry.internal/app/my-app:v1.0.0
        ports:
        - containerPort: 8080
        resources:
          requests: { cpu: 250m, memory: 512Mi }
          limits:   { cpu: "1",  memory: 1Gi }
        readinessProbe:
          httpGet: { path: /healthz, port: 8080 }
          periodSeconds: 10
        livenessProbe:
          httpGet: { path: /healthz, port: 8080 }
          initialDelaySeconds: 15
\`\`\`

要我按某个具体服务的参数定制吗?`,
  rollback: `回滚操作建议走发布历史而不是手改 YAML。K8Q 里的安全姿势:

1. 在「发布与生命周期」里选中应用 → 版本历史 → 选择目标 revision 回滚
2. 回滚本身也是一次新的 revision(审计友好),不是覆盖历史
3. 回滚前建议确认目标版本的 readiness 曾全绿

等价命令:\`kubectl rollout undo deploy/<name> --to-revision=<N>\``,
  node: `节点排查的几个抓手:

- **NotReady**:先 \`kubectl describe node\` 看 Conditions,最常见是 kubelet 心跳丢失或磁盘压力(DiskPressure)
- **资源水位**:当前 prod-east 有 2 个 worker 的 CPU 分配率已超 80%,建议开 cluster-autoscaler 或提前扩容
- **维护**:drain 前确认 PDB,\`kubectl drain <node> --ignore-daemonsets --delete-emptydir-data\`

需要我列出当前集群里水位最高的 3 个节点吗?`,
  hpa: `HPA 配置建议:

\`\`\`yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-app
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 4
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 65
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
\`\`\`

关键点:scaleDown 加稳定窗口防抖动;基于 CPU 的指标要求 requests 必须配置,否则 Utilization 算不出来。`,
  generic: `我是 QWAPP 运维助手(MVP 演示模式,当前由 mock 引擎驱动)。可以问我:

- **诊断**:CrashLoopBackOff、OOMKilled、ImagePullBackOff、节点 NotReady
- **生成**:Deployment / HPA / Service 的 YAML 模板
- **操作**:回滚策略、扩缩容建议、probe 配置

也可以点击右侧「快捷诊断」,我会结合当前集群(mock)的实时事件流给出分析。`,
}

export class MockQWAPPClient implements QWAPPClient {
  async chat(req: QWAPPChatRequest): Promise<void> {
    const lastUser = [...req.messages].reverse().find(m => m.role === 'user')
    const answer = answers[intentOf(lastUser?.content ?? '')]
    await sleep(500 + Math.random() * 500)
    for (const ch of answer) {
      if (req.signal?.aborted) return
      req.onToken(ch)
      await sleep(8 + Math.random() * 18)
    }
  }
}

export const qwapp: QWAPPClient = new MockQWAPPClient()
