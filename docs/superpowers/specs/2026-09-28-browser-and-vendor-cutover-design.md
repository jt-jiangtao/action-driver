# Browser Use 与原件运行时移除联合设计

## 目标

交付可在 macOS 上使用的 Browser Use：任务页右侧是可直接操作的内置浏览器，Agent 可在同一页面导航、点击、输入和截图；Agent 也可自行启动并操作独立 Chrome。与此同时，彻底移除 `apps/agent-runtime/vendor` 目录及其生产、构建和测试路径依赖，保持现有 Computer Use 的用户可见能力可用。`thirdparty/backup` 的原件备份保留，只用于离线静态或隔离差异对照，不能进入产品运行或打包产物。

这是一项联合交付：内置与外部 Browser Use、Computer Use 自有宿主切换、vendor 删除须共同通过验收。完成部分基础代码或单独跑通 Chrome 夹具不算完成。

## 已确认范围

- 浏览器产品行为沿用 [浏览器产品集成设计](2026-09-28-browser-product-integration-design.md)：右侧真实网页、标签与地址栏、用户接管、Agent 恢复；外部仅支持 Action-Driver 新启动的 Chrome，不附着已有浏览器。
- 底层 `@action-driver/*` 包不连接 Codex App 私有服务。Browser Use 经 Action-Driver 自有浏览器宿主执行；Computer Use 经 Action-Driver 自有 macOS helper 执行。
- 本期真实运行验收限 macOS。原件备份和历史对照证据可保留，但不得作为自有宿主真实验收的替身。

## 架构和迁移

`packages/browser-desktop` 持有宿主中立的会话、标签、控制与清理契约；`apps/desktop` 持有 Electron `WebContentsView`、任务绑定、右侧界面与 IPC，并为外部表面注入隔离 Chrome host。Agent 工具与用户控件通过同一会话入口执行；命令携带会话及标签身份，人工接管时暂停 Agent 操作。Browser Use 的自有 Chrome/CDP 实现位于 `packages/browser-runtime`，内置表面的 Electron 宿主只在桌面应用中。

`apps/agent-runtime` 保留现有 Tool Registry、Policy Gate、Skill Gate、任务取消、审批、沙箱和截图存储职责，改由明确的 Action-Driver 宿主端口构造 `@action-driver/cua`、`@action-driver/sky` 与 `@action-driver/cua-repl`。子进程 REPL 不再以 `CUA_VENDOR_ROOT` 加载原件；可信服务不再从 `vendorRoot` 解析原 Sky。运行时只传可序列化消息，特权动作仍由受控宿主执行。缺少自有宿主能力时显式失败，不回退到原件或 Codex 私有服务。

### 统一 CUA JS 调用（2026-09-28 补充裁决）

Agent 的 Browser Use 与 Computer Use 使用一个持久 JS/CUA 调用入口，接受代码、操作标题与超时，并提供重置。REPL 直接使用 `@action-driver/cua` 的合并 `createCUASession`，沿用 `@action-driver/cua-repl` 的初始化、文档、跨调用变量与重置语义；`cua.getState()` 同时发现获准的表面，`cua.getBrowser()`、`cua.getTab()` 和 `cua.createBrowserTab()` 使用浏览器服务，`cua.getApp()` 使用自有 macOS helper。浏览器动作不得通过桌面坐标点击代替。模型可见的 `tools.local.browser-use.command` 在统一入口验收通过后移除；右侧浏览器 UI 仍可走内部 Browser Session 命令端口。

浏览器对象和命令使用 `@action-driver/browser-desktop` 与 `@action-driver/browser-runtime` 的还原实现。前者对应 Codex 独立的 `@oai/browser-desktop` 包；后者是从 `@oai/cua` 内嵌浏览器 client/service 提取的 Action-Driver 包，并非第二个同名原包。两个原 client bundle 字节相同，可复用客户端；desktop service bundle 不同，桌面专有行为须在 `browser-desktop` 边界单独实现。`apps/desktop` 仅提供 Electron 内置 WebContentsView 和受管独立 Chrome 的宿主适配，`apps/agent-runtime` 仅提供任务绑定、可信 RPC 桥与工具注册。浏览器 RPC 必须以当前任务为权威归属，限定 Action-Driver 自建会话和标签页；桌面 RPC 继续经过应用授权。两条 RPC 各自检查对应 Skill/Policy Gate、取消、暂停与人工接管。REPL 只传可序列化请求和结果，不持有 Electron 或 helper 特权对象。一个 JS 单元可调用两个表面，但不能以启用其中一个表面绕过另一个的授权。

工具卡片显示模型提供的简短操作标题、实际执行的 JS 代码以及文本、错误和图片输出；按实际使用的表面标识 Browser Use、Computer Use 或两者。任务重新读取后这些字段仍可显示。原先 `browser-use.command` 的旧调用记录不迁移。浏览器输出需要控制长度、避免把截图 Base64 当正文呈现；图片通过受控资源引用显示。

本次方向来自用户指出的实际差异：现有 Browser Use 是逐条 JSON 命令，Computer Use 是持久 JS 调用，而 Codex CUA REPL 为浏览器和桌面提供同一 JS 会话。替代方案是在 UI 中把 JSON 命令排成脚本文本，修改范围小但模型仍不调用 CUA，因此不采用。主要代价是补齐还原库中尚未完成的 desktop 服务及 REPL 装配，重做工具注册与权限边界，并重新验证内置页、独立 Chrome、桌面授权、持久变量、重置、取消、失败和人工接管。用户明确选择直接完善并使用还原库，Action-Driver 只做宿主适配；在真实验收通过前不宣称与 Codex 完全对齐。

迁移期间先补齐和验证自有实现，再整体切换生产加载与打包；只有自有路径的真实验收通过，才删除 `apps/agent-runtime/vendor`。删除时同步移除同步脚本、构建复制步骤、环境变量、源码路径和隐含的测试路径假设。离线差异测试从固定 `thirdparty/backup/codex-cua` 读取原件；产品包依赖图和构建输出禁止包含该目录。

## 验收门槛

1. 可重置本地页面上的真实 Electron 内置表面完成导航、标签切换、点击、输入、滚动、截图、用户接管/恢复、任务切换和关闭；UI 显示真实 URL、标题与错误。
2. Agent 通过生产 Browser Use 工具自行启动隔离 Chrome，在相同夹具执行操作、截图和清理；无法启动、窗口被关闭、取消及断连有明确错误和资源释放；不附着既有 Chrome。
3. Computer Use 通过 Action-Driver 自有 macOS helper 完成应用发现、状态/截图、动作、授权拒绝、人工取消、REPL 重置及会话结束清理。现有安全门继续生效；真实夹具结果与必要的离线对照证据分开记录。
4. 浏览器候选包的生产所需命令、资源和失败路径、CUA 合并会话与 REPL 装配通过定向和跨包验证；未实现能力不得被假成功或悄悄省略。原件行为无法验证时记为缺口，并阻止宣称完整原件等价。
5. 仓库中不存在 `apps/agent-runtime/vendor`；运行时、构建、打包及生产依赖图都不读取 `thirdparty/backup` 或 Codex App 私有服务。离线测试可读取备份。目标 macOS 包和运行时均通过真实启动检查。
6. 完成改动并准备提交时，依仓库治理一次性运行类型、lint、全量测试及适用的本地/打包端到端检查；区分本次阻断与已有失败，不把失败写成通过。

## 决策和替代方案

用户明确要求移除 `apps/agent-runtime/vendor` 且保持 Computer Use 可用，并要求与 Browser Use 产品集成一起完成；`thirdparty/backup` 不在删除范围。直接删除目录并停用 Computer Use 可以立即清理文件，但违反可用性目标。仅把原件移到 `thirdparty/backup` 后继续从那里加载也能使指定目录消失，却违反底层服务独立和备份仅作对照的边界。选择完成自有宿主、整体切换并通过真实验收后删除目录。Browser Use 的右侧原生网页和独立 Chrome 的取舍沿用既有已批准设计。

## 风险与处理

- 自有候选仍有未完成命令与私有宿主接线。按能力清单和真实夹具逐项关闭缺口，生产切换前不得把单个成功案例当作整包完成。
- 原件位于当前生产路径。迁移要保持原有审批、取消、沙箱和截图行为，故测试必须覆盖拒绝与故障路径；切换和删除作为验收后的最后动作。
- Electron 内置 view 与外部 Chrome 的页面、profile 和生命周期不同。两种表面分别验收，不自动迁移登录状态；UI 明示当前表面。
- 备份含原始专有文件。保留其来源与哈希，限制为离线对照；静态边界与包内容检查防止误入生产。
