---
version: 1
slug: "src-pages-dashboard-tsx"
primary_target: "src/pages/Dashboard.tsx"
related_targets: ["src/App.tsx"]
---

## Direction contract

THESIS: 企业级 K8S 运维控制台,信息密度优先。拒绝"仪表盘模板"(大数字卡片+发光 accent+渐变网格背景):度量以 hairline 分隔的密集条带呈现,表格是主角,状态色只在承载语义时出现。

OWN-WORLD: 双主题——默认白底(#f4f5f7 ground / #ffffff surface / #e3e6ea hairline),暗夜可选(#101216 / #171a1f / #282d36)。品牌蓝 #2f5fd0(亮)/ #5b8af0(暗)承担激活态、链接、主按钮;状态色 #15803d/#b45309/#cf3226(暗色提亮)。系统字体栈承担 UI,JetBrains Mono 只用于数据、代码、度量。无渐变、无发光、无玻璃、无呼吸动画。

STORY: 运维打开控制台,一屏内读到节点水位、工作负载异常数、事件流;点进工作负载可过滤、看 YAML、扩缩容;发布页可建应用、滚动发布、回滚;AI 助手通过 QWAPP(mock)给出诊断。

FIRST VIEWPORT: 左侧 208px 白色导航轨(分组:集群/交付),顶部 50px 白色顶栏(集群选择器、搜索、主题切换、QWAPP 状态);内容区:页标题 → 7 格 metric-strip(节点/负载/Pod/CPU/内存/重启/告警)→ 左 1.5fr 节点表(内嵌利用率条)+ 右 1fr 实时事件流 → 三列:容量趋势 sparkline、Pod 状态分布表、命名空间负载。

FORM: 企业云控制台形态(阿里云控制台/Grafana 一类的工作产品),列表第七候选位之前的常规最优解;由用户 brief 直接钉死("企业级风格、默认白底、双主题、去 AI slop、加强信息量"),direction roll 被 pinned brief 覆盖。seed: none (unavailable)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
