# PRODUCT.md — K8Q (QWAPP for Kubernetes)

## What it is
K8Q 是一个 Kubernetes 全生命周期工作台(纯前端 MVP,mock 数据),面向企业运维/SRE 团队。
五大模块:集群总览、工作负载管理(含 Pod 日志流与 YAML 在线编辑)、全集群事件流、AI 运维助手(QWAPP SDK 适配层,mock)、发布与生命周期。

## Audience & scene
企业运维与平台工程师,办公室白天环境为主、也有夜间值守场景 → 双主题:默认白色(企业办公),暗夜可选(值守)。
使用诉求:快速扫读大量状态、定位异常、执行操作。信息密度优先于表现力。

## Brand commitments (pinned by brief)
- 企业级风格,克制、精确、高信息密度。
- 白色底为默认主题,暗夜为第二主题,用户可切换并持久化。
- 去除 "AI slop":无渐变网格背景、无发光呼吸灯、无装饰性模糊/玻璃、无模板化卡片堆砌。
- 状态色必须承载真实语义(绿=健康、琥珀=降级/进行中、红=异常、蓝=信息/品牌)。
- 等宽字体只用于代码、数据、度量,不作"技术感"装饰。

## Platform
Web SPA(React 18 + Vite + TS),桌面优先,Operate 模式。

## Tech constraints
- 无 UI 组件库、无图表库(手写 SVG);样式为纯 CSS 变量设计系统。
- mock 数据层位于 src/mock/,AI 适配层位于 src/ai/qwapp.ts。
