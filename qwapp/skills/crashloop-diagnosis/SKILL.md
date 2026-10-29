---
name: crashloop-diagnosis
description: 诊断 Kubernetes Pod CrashLoopBackOff / OOMKilled / ImagePullBackOff 等反复重启类故障,给出结构化排查路径与修复 YAML。当用户提到 Pod 重启、CrashLoop、OOM、退出码 137、镜像拉取失败时触发。
---

# CrashLoop 诊断

## 流程

1. **定位现象**:`kubectl get pods -n <ns>` 找到 RESTARTS 持续增长的 Pod。
2. **读退出码**:`kubectl describe pod <pod> -n <ns>` 看 Last State:
   - 137 = OOMKilled → 走内存水位分支
   - 1 / 2 = 应用自身异常 → 读 `--previous` 日志
   - 无退出码且反复 probe 失败 → liveness 配置分支
3. **读上一轮日志**:`kubectl logs <pod> -n <ns> --previous`
4. **给修复**:输出可直接 apply 的 YAML patch,并说明验证方式。

## OOMKilled 分支

- 用 requests/limits 对比 P95 水位,limit 建议 P95 × 1.3
- JVM/Go 需感知 cgroup v2(Go 1.19+ 的 GOMEMLIMIT,JVM 的 MaxRAMPercentage)
- 输出 patch 时 requests 不得等于 limits

## ImagePullBackOff 分支

- 检查 imagePullSecrets 与凭证轮换时间
- 给出 regcred 重建命令与 Deployment 引用方式

## 输出格式

固定四段:结论(一句话)、证据(命令+关键输出)、修复(YAML/命令)、验证(如何确认恢复)。
