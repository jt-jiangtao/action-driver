## Why

任务页右侧浏览器目前只是静态图片与视觉控件，Agent 也没有可用的生产 Browser Use 工具。用户需要像参考产品一样在右侧看到并操作真实网页，同时允许 Agent 自行打开独立 Chrome 窗口继续操作。

## What Changes

- 将任务页右侧占位面板接入真实的内置浏览器，支持标签页、地址栏、导航、网页交互和运行状态。
- 增加由 Action-Driver 启动和管理的独立 Chrome 表面，Agent 能通过 Browser Use 工具操作其页面；不连接用户现有浏览器或标签页。
- 在 `packages/browser-desktop` 中增加可复用的桌面浏览器会话、标签页命令及生命周期核心；由 `apps/desktop` 适配 Electron 宿主、任务绑定和 UI，并将接管、恢复、关闭和故障投影到任务页。
- 将 Browser Use 接入 Tool Registry、Policy Gate 与桌面 Skill Provider；底层自有包继续独立于 Codex 私有服务。
- 将 Browser Use 与 Computer Use 接入同一持久 CUA JS 入口，复用还原的 `@action-driver/cua`、`@action-driver/cua-repl`、`@action-driver/browser-runtime` 和 `@action-driver/browser-desktop`；统一入口验收通过后移除模型可见的 Browser Use JSON 命令。右侧 UI 继续使用内部会话命令。
- 修改原有“浏览器仅为 Mock 占位”的任务页要求；保留 Mock 作为视觉夹具。

## Capabilities

### New Capabilities

- `browser-session`: 规定内置与外部 Chrome 会话、Agent 操作、用户接管及资源生命周期。

### Modified Capabilities

- `agent-task-experience`: 将生产任务页的静态浏览器占位与仅 Mock 控件改为实时浏览器及真实交互，同时保留 Mock 验收路径。

## Impact

涉及 `packages/browser-desktop` 的通用会话核心与导出、`apps/desktop` 的 Electron Main、preload、Renderer、任务投影与 Skill Provider，以及 `plugins/browser-use` 的工具注册。独立 Chrome host 继续由 `packages/browser-runtime` 提供，经应用层注入。新增类型化会话与 IPC 契约；首版支持 macOS Chrome，不增加对 Codex App 私有服务的依赖。`implement-browser-use` 的独立双 Fork 基线保持独立；`reconstruct-codex-cua-packages` 的原件等价验收不因本次产品集成而自动完成。

## Battle Status

- 类型：产品与架构决策型；目标、成功标准、关键假设、替代方案和主要风险已讨论，用户于 2026-09-28 明确裁决。
- 最终方向：真实内置浏览器 + Agent 自行启动并操作独立 Chrome；用户与 Agent 共享所选会话，不连接现有浏览器标签页。
- 比较方案：截图流可复用现有 Chrome host，但用户直接输入与焦点、滚动和尺寸映射成本高；选择原生嵌入网页以满足右侧实时操作形态。
- 主要权衡：需要 Electron Main 管理原生 view 的层级和生命周期；内置与外部 profile 隔离，不自动迁移登录状态。用户把外部首版收窄为 Chrome。
- 模块归属补充裁决：用户确认通用桌面会话能力进入 `packages/browser-desktop`，Action-Driver 专有的 Electron/UI/Agent 接线留在 `apps/desktop`；不把产品验收冒充完整原件还原验收。
- 未决关键分歧：无。执行中若发现无法在既有 Skill/Tool 边界共享同一内置页面，应停止相关实现并重新裁决。
- 统一 CUA JS 补充裁决：用户要求 Browser Use 和 Computer Use 按 Codex 的 JS 调用行为对齐，并明确选择直接完善还原库、由 Action-Driver 仅做宿主适配。浏览器公共 client/命令实现保留在 `browser-runtime`，桌面专有 service 和会话留在 `browser-desktop`，`cua` 通过注入组合它们；本机 Chrome 启动属于 Action-Driver 宿主适配。替代方案是保留 JSON 命令只调整卡片显示，因 Agent 调用方式仍不一致而不采用。主要风险是候选 desktop service 尚未完全还原，须重新验证两个浏览器表面和 Computer Use；旧工具记录不迁移。

## 联合交付补充

用户进一步要求与 `reconstruct-codex-cua-packages` 的最终自有宿主切换一起完成：删除 `apps/agent-runtime/vendor`，Computer Use 保持可用。`thirdparty/backup` 仅作离线对照。浏览器产品验收与运行时切换验收必须共同通过，不能把单项完成作为最终交付。联合设计见 `docs/superpowers/specs/2026-09-28-browser-and-vendor-cutover-design.md`。
