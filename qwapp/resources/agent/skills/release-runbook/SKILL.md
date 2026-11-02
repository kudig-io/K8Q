---
name: release-runbook
description: Kubernetes 应用发布与回滚操作手册:滚动发布前检查、发布中观察、异常时安全回滚。当用户提到发布、上线、回滚、rollback、rollout、灰度时触发。
---

# 发布与回滚 Runbook

## 发布前

- 确认目标工作负载 readinessProbe 已配置且当前全绿
- 确认 PDB 存在(minAvailable ≥ 1),避免滚动期间服务空洞
- 确认镜像 tag 已在仓库中存在且签名

## 发布中

- 观察 `kubectl rollout status`,关注 maxUnavailable / maxSurge 节奏
- 每个新批次 Ready 后再放量;错误率或 p99 明显抬升立即停止

## 回滚

- 首选 `kubectl rollout undo deploy/<name> --to-revision=<N>`,回滚本身记为新 revision,不覆盖历史
- 回滚前确认目标 revision 的镜像仍然存在于仓库
- 回滚后必须验证:readiness 全绿 + 核心业务指标恢复

## 在 K8Q 中的等价操作

「发布与生命周期」页:选择应用 → 版本历史 → 回滚到此版本;进度条实时反映副本替换节奏。
