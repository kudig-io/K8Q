---
name: K8Q — QWAPP for Kubernetes
description: 企业级 Kubernetes 全生命周期工作台控制台设计系统:密度优先、双主题、状态色语义化
colors:
  bg: "#f4f5f7"
  surface: "#ffffff"
  surface-2: "#f6f7f9"
  line: "#e3e6ea"
  line-2: "#d0d5dc"
  text: "#1b1e23"
  text-2: "#57606b"
  text-3: "#6b7480"
  brand: "#2f5fd0"
  brand-weak: "#eef3fd"
  ok: "#15803d"
  ok-weak: "#eaf6ee"
  warn: "#b45309"
  warn-weak: "#fbf1e2"
  err: "#cf3226"
  err-weak: "#fcecea"
  info: "#2f5fd0"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: "17px"
    fontWeight: 650
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 600
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 600
  mono:
    fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace"
    fontFeature: "tabular-nums"
rounded:
  micro: "3px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "10px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "14px"
  content: "18px 22px 36px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "#fff"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  tab-active:
    backgroundColor: "transparent"
    textColor: "{colors.brand}"
  nav-item-active:
    backgroundColor: "{colors.brand-weak}"
    textColor: "{colors.brand}"
    rounded: "{rounded.md}"
    padding: "7px 10px"
  tag-ok:
    backgroundColor: "{colors.ok-weak}"
    textColor: "{colors.ok}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  tag-warn:
    backgroundColor: "{colors.warn-weak}"
    textColor: "{colors.warn}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  tag-err:
    backgroundColor: "{colors.err-weak}"
    textColor: "{colors.err}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  tag-info:
    backgroundColor: "{colors.brand-weak}"
    textColor: "{colors.info}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
---

# Design System: K8Q(QWAPP for Kubernetes)

## Overview

**Creative North Star: "运维舰桥 (The Watch Bridge)"**

像一艘船的舰桥:仪表密集、每格读数都是真的、颜色只在报警时开口。K8Q 是企业运维与平台工程师的 Kubernetes 全生命周期工作台,设计的第一优先级是**信息密度**——运维打开控制台,要在一屏内读到节点水位、工作负载异常数与实时事件流,然后立刻动手操作。所有视觉决策都为扫读与定位异常服务,表现力让位给吞吐。

视觉世界是**企业云控制台**形态(阿里云控制台 / Grafana 一类的工作产品):发丝线(hairline)切分、表格为主角、扁平表面、克制的品牌蓝。双主题服务真实场景——默认白底对应办公室白天,暗夜主题对应夜间值守(暗底上状态色整体提亮保证对比度)。已确认的视觉否决项(去 "AI slop"):无渐变网格背景、无发光、无玻璃拟态、无呼吸动画、无仪表盘模板式大数字卡片堆砌。

**Key Characteristics:**
- 企业级、克制、精确;信息密度优先于表现力
- 表格与条带是主角,卡片是容器不是内容
- 状态色必须承载真实语义(绿=健康、琥珀=降级/进行中、红=异常、蓝=信息/品牌)
- 双主题:亮色为默认,暗色为提亮变体;所有颜色经由 CSS 变量切换
- 系统字体栈承担 UI,JetBrains Mono 只用于代码、数据、度量
- 扁平 + 发丝线;阴影只属于弹出层

## Colors

调色板性格:冷灰中性层 + 单一控制台蓝品牌色 + 四色语义状态组;中性色按 bg → surface → surface-2 → line → line-2 → text-3 → text-2 → text 由底到前景分层,状态色成对出现(实色 + 弱底)。

> frontmatter 中的 `colors` 是**亮色(默认)主题的规范值**。暗色主题值无法进入 frontmatter 扁平结构,完整双主题对照见下表,暗色值同时在 `.impeccable/design.json` 侧车的 `colorMeta.*.darkValue` 中维护。两个主题共用同一套 token 名,切换只换值。

### Primary
- **控制台蓝 (Console Blue)**(`#2f5fd0`,暗 `#5b8af0`):唯一的品牌色。承担激活态、链接、主按钮、选中态、焦点环、焦点边框;暗色主题为提亮变体。info 与 brand 同源同色,语义上 info 用于"信息/变更中"状态表达。
- **弱底蓝 (Console Blue Wash)**(`#eef3fd`,暗 `rgba(91, 138, 240, 0.14)`):品牌弱底,用于导航/会话选中底、搜索命中 hover、行内代码底、tag-info 底。暗色主题为半透明实色弱底。

### Neutral
- **云灰底 (Cloud Gray)**(`#f4f5f7`,暗 `#101216`):应用全局背景 `--bg`。
- **纸白 (Paper White)**(`#ffffff`,暗 `#171a1f`):卡片、抽屉、弹窗、导航、顶栏表面 `--surface`。
- **雾灰 (Mist Gray)**(`#f6f7f9`,暗 `#1e2229`):次级表面 `--surface-2`——表头底、hover 行、输入底、聊天消息底、进度条轨道。
- **发丝线 (Hairline)**(`#e3e6ea`,暗 `#282d36`):1px 结构边框 `--line`。
- **深发丝线 (Deep Hairline)**(`#d0d5dc`,暗 `#363d48`):强调边框 `--line-2`——输入框、按钮、弹窗外框、滚动条 thumb。
- **石墨 (Graphite)**(`#1b1e23`,暗 `#e3e6ea`):前景主文字 `--text`。
- **钢灰 (Steel Gray)**(`#57606b`,暗 `#9aa4ae`):次级文字 `--text-2`——描述、元信息、消息体。
- **雾钢 (Fog Steel)**(`#6b7480`,暗 `#8b95a1`):三级文字 `--text-3`——表头、标签、弱化读数、占位符。

### Status(状态色,无语义不上色)
- **运行绿 (Ops Green)**(`#15803d`,暗 `#3fba6f`):健康 / Ready / Normal / 完成,弱底 `#eaf6ee`(暗 `rgba(63, 186, 111, 0.12)`)。
- **琥珀 (Amber)**(`#b45309`,暗 `#e8a13d`):降级 / Pending / 进行中(滚动发布、滚动更新进度),弱底 `#fbf1e2`(暗 `rgba(232, 161, 61, 0.12)`)。
- **告警红 (Alert Red)**(`#cf3226`,暗 `#f06055`):异常 / CrashLoopBackOff / Failed / 删除,弱底 `#fcecea`(暗 `rgba(240, 96, 85, 0.12)`)。

### 双主题 Token 总表(唯一事实来源:`src/styles.css` 的 `:root` 与 `[data-theme='dark']`)

| Token | 亮色(默认) | 暗色 |
| --- | --- | --- |
| `--bg` | `#f4f5f7` | `#101216` |
| `--surface` | `#ffffff` | `#171a1f` |
| `--surface-2` | `#f6f7f9` | `#1e2229` |
| `--line` | `#e3e6ea` | `#282d36` |
| `--line-2` | `#d0d5dc` | `#363d48` |
| `--text` | `#1b1e23` | `#e3e6ea` |
| `--text-2` | `#57606b` | `#9aa4ae` |
| `--text-3` | `#6b7480` | `#8b95a1` |
| `--brand` | `#2f5fd0` | `#5b8af0` |
| `--brand-weak` | `#eef3fd` | `rgba(91, 138, 240, 0.14)` |
| `--ok` | `#15803d` | `#3fba6f` |
| `--ok-weak` | `#eaf6ee` | `rgba(63, 186, 111, 0.12)` |
| `--warn` | `#b45309` | `#e8a13d` |
| `--warn-weak` | `#fbf1e2` | `rgba(232, 161, 61, 0.12)` |
| `--err` | `#cf3226` | `#f06055` |
| `--err-weak` | `#fcecea` | `rgba(240, 96, 85, 0.12)` |
| `--info` | `#2f5fd0` | `#5b8af0` |
| `--shadow-pop` | `0 2px 6px rgba(16, 24, 40, 0.08), 0 12px 32px rgba(16, 24, 40, 0.12)` | `0 2px 6px rgba(0, 0, 0, 0.3), 0 12px 32px rgba(0, 0, 0, 0.45)` |
| `--font-ui` | `-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Segoe UI', sans-serif` | (同亮色) |
| `--font-mono` | `'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace` | (同亮色) |

### Named Rules
**状态色语义规则 (The Semantic Status Rule).** 绿=健康、琥珀=降级/进行中、红=异常、蓝=信息/品牌。颜色只在承载语义时出现,任何装饰性用色一律禁止;同一语义在全站共享同一对实色 + 弱底。

**品牌克制规则 (The One Voice Rule).** 品牌蓝只用于激活态、链接、主按钮与焦点;它是全站唯一的强调音,出现面积保持克制——它的稀缺即意义。

## Typography

**Display/UI Font:** 系统字体栈 `-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Segoe UI', sans-serif`(--font-ui),经 `index.html` 的 Google Fonts 预连接加载 JetBrains Mono 后,UI 字体不再有任何外部依赖。
**Body Font:** 同上(系统栈即正文)。
**Label/Mono Font:** `'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace`(--font-mono),仅用于代码、数据、度量与标识性元信息。

**Character:** 系统无衬线保证中文运维文案的屏读效率与跨平台一致;等宽字体是"读数语言"——时间戳、版本号、资源名、度量值,tabular-nums 保证数字列对齐。两者分工严格,互不越界。

### Hierarchy
- **Headline**(650,17px):页标题 `.page-title`,右侧内嵌 mono 英文小标(10px, `--text-3`, letter-spacing 0.1em)作为导航定位,而非装饰。
- **Title**(600,13px):卡片标题 `.card-title`;抽屉/弹窗标题为 15px/650。
- **Body**(400,13px / 1.55):全局基准,页面描述、消息体、表单。
- **Label**(600,11px):表头、字段标签;弱读数标签为 400,11px(`--text-3`)。
- **Mono Data**(600,11–19px,tabular-nums):metric 主值 19px;代码 11–12.5px;时间戳/读数 10–11.5px。

### Named Rules
**等宽即数据规则 (The Mono Means Data Rule).** 等宽字体只服务于代码、数据、度量与元信息标识(英文小标、kbd、tag),不得用于标题或正文来制造"技术感"。

## Layout

应用骨架为固定左右结构:左侧 **208px** 白色导航轨(logo 区 + 分组导航 + 底部版本信息),右侧主列 = **50px** 顶栏(集群选择器、搜索、QWAPP 状态、主题切换、时钟)+ 滚动内容区(padding `18px 22px 36px`)。内容区节奏:页标题 → 页描述 → 主体。栅格:g gap 统一 **14px**;`dash-grid` 为 `1.5fr 1fr`,`dash-row` 三列 `1fr 1fr 1fr`,`release-cards` 三列;助手页三栏 `230px 1fr 250px`。密度基调:正文字号 13px,表格单元格 padding `6px 10px`,主字号区间 11–13px。

### 主题切换机制
- 写入:`index.html` `<head>` 内联脚本在首帧前执行 `document.documentElement.dataset.theme = localStorage.getItem('k8q-theme') || 'light'`,防止暗色用户刷新时白屏闪烁。
- 切换:顶栏主题按钮调用 `toggleTheme()`——写 `document.documentElement.dataset.theme`,同时持久化 `localStorage.setItem('k8q-theme', next)`;初始状态从 `document.documentElement.dataset.theme` 读取。
- 过渡:`body` 上 `background 0.2s ease, color 0.2s ease`;组件级 hover/过渡统一 0.12s。
- 契约:全部颜色必须经 CSS 变量消费,严禁在组件内硬编码色值,否则切换失效。

### 响应式断点(唯二断点,`src/styles.css` 底部)
- **≤1280px**:`.dash-grid`、`.dash-row` 折叠为单列;`.release-cards` 变两列;助手页侧栏收窄为 `190px 1fr 210px`。
- **≤900px**:侧栏收成 **54px** 图标轨(隐藏 logo 文字、分组名、英文小标、底部信息);顶栏收紧(padding `0 12px`,隐藏 mono 时钟与搜索框 `⌘K` 提示,搜索框占满);`.metric-strip` 变水平滚动(`grid-auto-columns: minmax(132px, 1fr)`);`.release-cards` 单列;助手页单栏并隐藏左右卡片,聊天面板高度 `calc(100vh - 240px)`;抽屉全屏(`width: 100vw`);表格字号降为 12px;内容区 padding `14px 14px 30px`。

## Elevation & Depth

静态扁平。深度不来自阴影,而来自 **tonal 分层**:全局底 `--bg` → 表面 `--surface` → 次表面 `--surface-2`,辅以 1px 发丝线边框。全站只有**一个**阴影 token,且只赋予弹出层(抽屉、弹窗、搜索浮层)。`release-card.selected` 的选中态用 `box-shadow: 0 0 0 1px var(--brand)` 焦点环式描边,而非投影抬升。

### Shadow Vocabulary
- **浮层阴影 (shadow-pop)**(亮色 `0 2px 6px rgba(16, 24, 40, 0.08), 0 12px 32px rgba(16, 24, 40, 0.12)`;暗色 `0 2px 6px rgba(0, 0, 0, 0.3), 0 12px 32px rgba(0, 0, 0, 0.45)`):仅 `.drawer`、`.modal`、`.search-pop`。暗色更深,保证暗夜浮层分离度。
- **遮罩**:抽屉 `rgba(16, 24, 40, 0.35)`,弹窗 `rgba(16, 24, 40, 0.4)`;暗色主题沿用同一遮罩(不偏蓝的黑灰遮罩)。

### Named Rules
**静态扁平规则 (The Flat-By-Default Rule).** 表面在静止状态下零投影;阴影只作为"浮出层级"的响应(drawer/modal/浮层),hover 抬升、辉光、多层投影均被禁止。

## Shapes

形态语言:小圆角 + 发丝线,工具感。圆角分级(实测值):微轨 **3px**(util/hbar/mini-bar/progress 轨道)、小组件 **4px**(tag、kbd、滚动条 thumb、搜索命中)、交互件 **6px**(按钮、输入、导航项、图标按钮、卡片内小组件)、容器 **8px**(卡片、metric-strip、搜索浮层、聊天气泡)、弹窗 **10px**(modal 上限)。填充条一律直角(`border-radius: 0`),轨道圆角包裹。焦点环:2px 实色 `var(--brand)` + 1px offset + 2px 圆角(`:focus-visible`),全站唯一焦点表达。

### Named Rules
**小圆角纪律 (The Small Radius Rule).** 全站圆角不超过 10px;大圆角 pill、胶囊按钮与超大圆角卡片不属于这个世界。

## Components

### Buttons
- **Shape:** 6px 圆角,1px `--line-2` 边框,12px/500 字号,padding `6px 12px`,`white-space: nowrap`。
- **Primary:** `--brand` 实底 + `#fff` 字 + 同色边框;hover 用 `filter: brightness(1.08)` 微亮,不改色相。
- **Secondary(默认 .btn):** `--surface` 底 + `--text` 字;hover 边框与字色转 `--brand`。
- **Danger:** 视觉同 Secondary,hover 时边框与字色转 `--err`。
- **状态:** `:disabled` 透明度 0.5 + `not-allowed`;所有状态过渡 0.12s。

### Navigation(侧栏 + 顶栏)
- 侧栏导航项:6px 圆角,padding `7px 10px`,500 字重,图标 15px(0.75 透明度);hover 为 `--surface-2` 底 + `--text` 字;active 为 `--brand-weak` 底 + `--brand` 字 + 图标全不透明。右侧英文小标(`--font-mono`, 9px)仅作定位。
- 顶栏:50px 高,`--surface` 底 + 底部发丝线;集群选择器与搜索框为 6px 圆角输入形态;图标按钮 28×28、6px 圆角,hover 转品牌色。

### Cards / Containers
- **Corner:** 8px;**Background:** `--surface`;**Border:** 1px `--line`;**Shadow:** 无(见 Elevation);**Padding:** `14px 16px`;卡片标题 13px/600 + mono 灰色小标。表格容器卡片可 `padding: 0 + overflow: hidden` 收边。

### Metric Strip(签名组件)
- 单条容器:grid 等分列、hairline 左分隔(首格除外)、8px 圆角、整底 `--surface`;格内 padding `10px 14px`。
- 格结构:11px 标签(`--text-3`)→ 19px/600 等宽主值(tabular-nums,单位 11px 弱化)→ 11px mono 副读数(超长省略)。
- 副读数承载异常语义时变色(如异常数 > 0 用 `--err`,告警数超阈值用 `--warn`);≤900px 时横向滚动。

### Data Table(table.data,主角)
- 12.5px 正文,表头 11px/600、`--text-3`、`--surface-2` 底、底部 `--line-2` 分隔;单元格 padding `7px 10px`(td 6px);行底 `--line` 发丝线,末行无线;行 hover `--surface-2`,`tr.clickable` 配指针。
- 列语言:名称列 `name-cell`(600 + 深色),资源名/命名空间/数值列 mono + tabular-nums,弱化列 `dim`,镜像列限宽省略;就绪列按 `ready/replicas` 是否相等着 `--ok`/`--warn`;重启数 > 10 着 `--err`;空态为居中弱化文案行。

### Tabs
- 下划线式:容器底部 1px `--line`,tab 为透明底文字按钮(12.5px/500,padding `7px 12px`),下划线 2px 透明;hover 字色加深;active 字色与下划线转 `--brand`;计数用 10px mono 弱标。抽屉内复用同一组件做详情分区。

### Drawer(详情抽屉)
- 右侧滑入:宽 640px(max 94vw,≤900px 全屏),`--surface` 底、左边 1px `--line-2`、shadow-pop;进入动画 `drawer-in` 0.2s(translateX(40px) + fade);遮罩 `fade-in` 0.15s。
- 结构:头部(标题 15px/650 + mono 副标 + ✕ 关闭)→ 滚动体(padding `14px 18px`)→ 底部操作区(顶部发丝线,右对齐按钮组)。详情用 `kv-grid`(两列 k/v)或 `kv-strip`(横排 mono 值)。

### Modal
- 居中,宽 430px(max 94vw),10px 圆角,1px `--line-2` 边框 + shadow-pop;进入动画 `modal-in` 0.18s(translateY(8px) + fade);标题 15px/650;操作区右对齐(取消 + primary)。表单字段:label 12px/500,输入 6px 圆角 + `--line-2` 边框,focus 边框转 `--brand`;range 输入用 `accent-color: var(--brand)`。向导步骤条(wizard-steps)用底部 2px 线:待办 `--line`、进行 `--brand`、完成 `--ok`。

### Event Stream(事件流)
- 行结构 `58px 58px 1fr`(时间戳 / 类型 tag / 消息),12px,行间 `--line` 分隔,hover `--surface-2`;时间戳 mono 11px;消息单行省略,`<b>` 强调 reason;详情场景消息可换行。
- 类型 tag:10px mono,padding `1px 6px`,4px 圆角——`normal` 绿对、`warn` 琥珀对、`err` 红对、`info` 蓝对(实色字 + 弱底)。

### Status Pill & Dot(状态三件套之二)
- `.status-pill`:行内 12px,实色字 + 前置 6px 圆点(同色);`.dot` 变体 amber/red/blue/grey。状态表达 = status-pill(带文字)+ dot(纯图形)+ tag(事件类型),按信息密度选位。

### YAML Viewer
- `pre.yaml-view`:mono 11.5px/1.7,`--surface-2` 底 + 1px `--line` + 6px 圆角,padding `12px 14px`,横向滚动,保留换行。
- 高亮语义:键 `--brand`、字符串/列表项 `--ok`、数值 `--warn`、注释 `--text-3`;仅四色,不引入语法高亮彩虹。

### Charts(手写 SVG,无图表库)
- **UtilBar(利用率条):** 行 `92px 1fr 108px`(无名时 `1fr 96px`),轨道高 6px、3px 圆角、`--surface-2` 底 + 1px `--line`;填充直角,宽度过渡 0.5s;阈值着色:≥85 `--err`、≥70 `--warn`、否则 `--ok`。
- **HBar(排名条):** 行 `104px 1fr 56px`,名称 mono 11px 省略,值 mono 右对齐;填充恒为 `--brand`(无量纲语义,不抢状态色)。
- **Sparkline(趋势线):** viewBox 520×h,折线 1.5px 实色 + 同色 8% 透明面积 + 末端 2.5px 圆点;默认高 72px(可 52px);颜色由数据语义指定(CPU `--brand`、MEM `--ok`)。
- **mini-bar / progress-track:** 5–6px 高微轨;mini-bar 完成态 `--ok`、滚动中 `--warn`(rolling);progress-fill 恒 `--warn`(仅用于进行中)。禁用 gauge/donut/ring。

### Search(顶栏)
- 搜索框 `--surface-2` 底 + 1px `--line`,focus 边框转 `--brand` 并变白底;`⌘K` 提示为 4px 圆角 mono kbd;命中浮层 8px 圆角 + shadow-pop,命中项 hover `--brand-weak`,`⌘K` 聚焦 / Esc 关闭。

### Chat(助手页)
- 消息气泡:用户 `--brand` 底 + `#fff` 字(右下角 3px 削角),助手 `--surface-2` 底 + 1px `--line`(左下角削角);代码块 `--surface` 底 + `--line-2` 框,行内 code 为 `--brand-weak` 底 + `--brand` 字;流式光标为 6×13px `--brand` 竖条 blink 0.9s。

### Named Rules
**表格主角规则 (The Table-First Rule).** 数据密集场景优先表格与条带;任何"仪表盘模板式"大数字卡片、图形化仪表盘、圆环读数都让位于 `table.data` 与 UtilBar/HBar 的线性表达。

## Do's and Don'ts

### Do:
- **Do** 用 `metric-strip` 呈现页面顶部度量:hairline 分列、19px 等宽 tabular-nums 主值、副读数承载异常着色。
- **Do** 用 1px 发丝线 + `--surface`/`--surface-2` tonal 分层表达结构;阴影只给 drawer/modal/搜索浮层。
- **Do** 让数据表可扫读:名称列 600 字重、数值列 mono + tabular-nums、行 hover 变底、`clickable` 行配指针。
- **Do** 用 dot + status-pill + tag 表达状态,并保持语义一致:绿健康、琥珀进行中、红异常、蓝信息。
- **Do** 用 UtilBar/HBar/Sparkline 做全部数据图形,遵守 UtilBar 阈值配色与 HBar 品牌色规则。
- **Do** 在暗色主题中使用提亮的实色 + 半透明弱底(见双主题总表),保持对比度优先。
- **Do** 经 `data-theme` + `k8q-theme` localStorage 机制切换主题,新颜色一律进 `:root` / `[data-theme='dark']` 两个 token 块。
- **Do** 让新页面遵循 1280px / 900px 断点折叠行为,并在 900px 下可用(图标轨、横向滚动条带、全屏抽屉)。

### Don't:
- **Don't** 用渐变网格背景、径向光晕、发光文字或发光边框;全站无 glow。
- **Don't** 用玻璃拟态(backdrop-filter 模糊、半透明磨砂层)。
- **Don't** 用呼吸动画、心跳脉冲、循环动画装饰状态(唯一允许的循环动画是聊天流式光标 blink)。
- **Don't** 用 kicker/eyebrow 式标题点缀行;页标题内嵌 mono 英文小标是既有定位规范,不是 eyebrow,不要再叠加。
- **Don't** 用 progress ring、gauge、donut 展示单一利用率读数——用 UtilBar/HBar 线性条替代。
- **Don't** 把等宽字体用于标题、正文或任何"技术感"装饰;它只服务于代码、数据、度量。
- **Don't** 给静态卡片、按钮加投影或 hover 抬升;不要多层投影。
- **Don't** 使用超过 10px 的圆角、pill/胶囊形按钮、表情符号图标或插画式空态。
- **Don't** 在组件内硬编码色值或新增 token 名;双主题必须同步维护亮/暗两组值。
