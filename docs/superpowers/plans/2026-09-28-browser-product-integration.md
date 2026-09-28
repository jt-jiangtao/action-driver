# Browser Product Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 macOS ActionDriver 任务页提供可由用户和 Agent 共同操作的真实内置浏览器，并允许 Agent 自行启动和操作隔离的外部 Chrome。

**Architecture:** `packages/browser-desktop` 持有宿主注入的通用会话核心；Electron Main 注入内置 `WebContentsView` 和自有独立 Chrome host，并维护 task→session 绑定。Renderer 通过类型化 IPC 展示和控制受管会话；Agent 通过既有 Tool Registry、Policy Gate 和 Skill Provider 访问同一会话。

**Tech Stack:** TypeScript、Electron 38.8.6、React、Playwright Core、Vitest、OpenSpec。

**Spec:** `docs/superpowers/specs/2026-09-28-browser-product-integration-design.md`；`openspec/changes/integrate-browser-use-desktop/`。

## Global Constraints

- 首版只支持 macOS；外部浏览器只支持 Chrome，且由 ActionDriver 自行启动隔离 profile。
- 不连接用户已有浏览器实例或标签页，不依赖 Codex App 私有服务。
- `packages/browser-desktop` 实现可复用会话、标签身份、命令和生命周期；不引用任务、Electron UI 或 Agent。`apps/desktop` 只实现 ActionDriver 专有宿主、任务绑定、IPC 与界面。
- `browser-desktop` 新产品会话核心单独导出和验收；不将其视为还原候选的全包原件等价证明。
- Agent 工具必须经过 Tool Registry、Policy Gate、Provider；Renderer 只通过具名类型化桥接操作浏览器。
- Mock 视觉夹具继续可用，生产 Browser Use 不回退到 Mock。
- 迭代期只运行相关定向测试；仅准备提交时一次性运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`，涉及真实 UI 的 E2E 在提交前按需追加。
- 工作区已有大量其他任务的未提交文件；只编辑和暂存本变更涉及的文件。

## Review Focus

- 输入非 HTTP(S) 地址：地址栏显示明确错误，不允许加载应用私有协议；Task 4 的 URL 测试覆盖。
- 页面自发打开新标签：只纳入当前受管会话，不带入应用 Renderer；Task 3 的弹窗测试覆盖。
- 标签页关闭与命令并发：旧 tab ID 的命令失败，不落到新标签；Task 1 的竞态测试覆盖。
- 快速折叠、切换任务和窗口缩放：网页状态不丢失、view 不遮挡其他控件；Task 3 的 Electron 测试覆盖。
- 外部 Chrome 已安装但启动失败或用户手动关闭：会话报错并清理自有 profile；Task 6 的实机测试覆盖。

---

### Task 1: 会话契约与状态机

**Files:** Create `packages/browser-desktop/src/session-contract.ts`、`packages/browser-desktop/src/session-controller.ts`、`packages/browser-desktop/tests/session-controller.test.ts`；modify `packages/browser-desktop/src/index.ts`。

**Interfaces:** `BrowserSurface = 'embedded' | 'external-chrome'`；`BrowserSessionSnapshot` 包含 `sessionId/surface/status/tabs/activeTabId/error`，不含 task ID；`BrowserSessionCommand` 是含受限动作的可辨识联合；`BrowserDesktopSessionController` 提供 `open(surface)`、`execute(sessionId,tabId,command)`、`transition(sessionId,control)`、`close(sessionId)`、`snapshot(sessionId)`、`subscribe(listener)`；`BrowserDesktopHost` 抽象具体表面。保留原有 `setupBrowserDesktop` 与 `createBrowserDesktopService` 的独立出口。

- [ ] 写失败的定向测试：隔离任务、tab ID 身份、关闭后命令、接管暂停、恢复前读取当前状态、快照可序列化。
- [ ] 运行 `pnpm vitest run packages/browser-desktop/tests/session-controller.test.ts`，确认针对缺失行为失败。
- [ ] 实现最小契约和会话核心；命令绑定明确 session/tab，串行化同一会话的 Agent 命令，不把旧 tab 命令重定向，且不引入 ActionDriver 任务或 Electron 类型。
- [ ] 重跑该定向测试，确认通过；更新 OpenSpec 1.1、1.2 的复选框。

### Task 2: 任务投影与桥接边界

**Files:** Modify `packages/contracts/src/index.ts`、`apps/agent-runtime/src/task-projection.ts`、`apps/desktop/src/renderer/src/services/desktop-agent-adapter.ts`、`apps/desktop/src/preload/desktop-api.ts`、`apps/desktop/src/preload/index.ts`；create `apps/desktop/src/main/browser-session/task-binding.ts`、`apps/desktop/src/main/browser-session/ipc.ts`、`apps/desktop/src/main/browser-session/ipc.test.ts`，扩展 `apps/desktop/src/preload/desktop-api.test.ts` 和 `apps/desktop/src/renderer/src/services/desktop-agent-adapter.test.ts`。

**Interfaces:** 应用层 `BrowserSessionRequest` 包含 task ID、session ID、可选 tab ID 和受限动作；`TaskBrowserBinding` 维护 task→session。`DesktopApi.browserSession.command(request: BrowserSessionRequest): Promise<BrowserSessionSnapshot>`；`browserSession.subscribe(listener)` 只接收序列化快照；任务投影添加受管会话标识、surface、tabs、activeTabId，同时兼容旧 Mock 字段。

- [ ] 写失败测试：合法桥接命令、恶意/错误 ID 拒绝、投影序列化、Mock 任务不受影响。
- [ ] 运行 `pnpm vitest run apps/desktop/src/main/browser-session/ipc.test.ts apps/desktop/src/preload/desktop-api.test.ts apps/desktop/src/renderer/src/services/desktop-agent-adapter.test.ts`，确认失败原因对应新行为。
- [ ] 实现白名单 IPC 和投影映射；Main 校验 sender 与请求，Renderer 不接触 Electron/Playwright 对象。
- [ ] 重跑定向测试，确认通过；更新 OpenSpec 1.3 和 2.1 的契约部分。

### Task 3: 内置网页宿主

**Files:** Create `apps/desktop/src/main/browser-session/embedded-host.ts`、`embedded-host.test.ts`；modify `apps/desktop/src/main/index.ts` 和 `apps/desktop/src/main/navigation-security.ts`（仅必要的受管网页规则）。

**Interfaces:** `createEmbeddedBrowserHost(window: BrowserWindow): BrowserDesktopHost`；每个 tab 拥有隔离的 `WebContentsView`；`setViewport(sessionId,tabId,bounds,visible)` 同步网页区域；该宿主从 `apps/desktop` 注入 `BrowserDesktopSessionController`。

- [ ] 写失败测试：网页 session 与应用隔离、HTTP(S) 导航、页面事件、新窗口归属、关闭及 bounds/可见状态。
- [ ] 运行 `pnpm vitest run apps/desktop/src/main/browser-session/embedded-host.test.ts`，确认失败。
- [ ] 实现 Main 持有的 view、生命周期和网页事件；页面不装应用 preload/Node，不允许加载应用私有协议。
- [ ] 重跑定向测试，并以真实 Electron 本地夹具检查分栏、放大、折叠、任务切换和缩放；更新 OpenSpec 2.1、2.2。

### Task 4: 内置页面操作和浏览器栏

**Files:** Create `apps/desktop/src/main/browser-session/embedded-actions.ts` 及测试；modify `apps/desktop/src/renderer/src/components/BrowserPanel.tsx`、`browser/BrowserTabBar.tsx`、`browser/BrowserNavigationBar.tsx`、`apps/desktop/src/renderer/src/pages/TaskPage.tsx`、`apps/desktop/src/renderer/src/styles/browser.css` 和相关交互契约。

**Interfaces:** `executeEmbeddedTabCommand(tabId,command)` 支持导航、返回、前进、刷新、点击、输入、滚动、截图；UI 对同一 session/tab 发送命令并显示页面事件状态。

- [ ] 写失败测试：UI 新建/切换/关闭 tab、地址栏 URL 验证、导航按钮状态、加载错误；本地 HTTP 页面上的 Agent 点击/输入/截图。
- [ ] 运行组件与宿主定向测试，确认缺失功能使其失败。
- [ ] 接入真实操作和页面控件；保留 Mock 的静态渲染路径，生产显示实时网页而不显示假栅格。
- [ ] 重跑定向测试和真实 Electron 本地页面夹具，确认 Agent 操作就是用户所见页面；更新 OpenSpec 2.3、2.4。

### Task 5: Agent 工具与生产 Provider

**Files:** Modify `plugins/browser-use/src/catalog.ts`、`plugins/browser-use/src/extension.ts`、`apps/agent-runtime/src/plugins/composition.ts` 或现有注册路径、`apps/desktop/src/main/skill-provider-host.ts`、`apps/desktop/src/main/index.ts`；create `apps/desktop/src/main/browser-session/provider.ts` 和定向集成测试。

**Interfaces:** Browser Use 工具只接受任务、会话、surface 与受管 tab 的类型化请求；Provider 通过 `TaskBrowserBinding` 找到 `BrowserDesktopSessionController` 中的会话，返回结构化页面结果和明确错误。

- [ ] 写失败测试：工具可发现、未授权被 Policy Gate 拒绝、授权后调用内置会话、Provider 不暴露 Mock 成功结果。
- [ ] 运行 Browser Use catalog、Runtime 注册和 Provider 的定向测试，确认失败。
- [ ] 在现有 Tool Contract 注册路径中接线；生产仅注册真实 Browser Use Provider，调用经过 Policy Gate。
- [ ] 重跑定向集成测试；更新 OpenSpec 3.2。

### Task 6: 独立 Chrome 表面

**Files:** Create `apps/desktop/src/main/browser-session/external-chrome-host.ts` 及测试；modify `apps/desktop/src/main/index.ts`，必要时只对 `packages/browser-runtime/src/local-browser-host.ts` 增加缺失的明确端口能力。

**Interfaces:** `createExternalChromeHost(profileRoot): BrowserDesktopHost` 包装自有 `createLocalBrowserHost`，注入 `BrowserDesktopSessionController`，仅返回 ActionDriver 创建的 tab，关闭时清理其 context/profile。

- [ ] 写失败测试：Chrome 不存在、启动失败、用户关闭窗口、隔离 profile、只列出受管 tab、关闭清理。
- [ ] 运行外部 host 定向测试，确认失败。
- [ ] 实现外部 Chrome 适配，不枚举或连接用户既有实例；Agent 指令直接作用于启动的窗口。
- [ ] 重跑定向测试及真实 macOS Chrome 本地 HTTP 夹具，验证启动、导航、点击、输入、截图、关闭；更新 OpenSpec 3.1、4.2。

### Task 7: 接管、恢复和端到端验收

**Files:** Modify `apps/desktop/src/renderer/src/components/browser/BrowserSkillControls.tsx` 与任务控制适配；create browser-session E2E 夹具和验收记录。

**Interfaces:** `transition(sessionId,'pause'|'take-over'|'resume')` 更新事实状态；恢复后 Provider 先读取当前 tab/page snapshot 再发下一动作。

- [ ] 写失败测试：接管期间 Agent 命令不执行、用户可操作、恢复后状态更新、已关闭 tab 不重放。
- [ ] 运行定向并发测试，确认失败；实现控制接线后重跑，确认通过。
- [ ] 用真实 Electron 和本地 HTTP 页面验证右侧浏览器完整交互、任务切换、布局、错误恢复，并记录复现步骤；更新 OpenSpec 3.3、4.1。
- [ ] 运行自有服务隔离扫描，确认 `browser-desktop` 新出口及应用适配均不连 Codex 私有服务，且不把产品验收误标为原件全包等价；更新 OpenSpec 4.3 的隔离部分。

### Task 8: 提交门禁

**Files:** 仅本计划、OpenSpec 变更以及上述实现文件；不暂存现有其他任务改动。

- [ ] 核对所有 OpenSpec 任务和真实验收证据，运行 `openspec validate integrate-browser-use-desktop --strict`。
- [ ] 准备提交时一次性运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`，并按实际改动运行所需本地或打包 E2E；记录通过数及与本变更无关的既有失败。
- [ ] 仅暂存并提交本变更文件，提交信息包含验证结果；检查 `git status --short` 确认其他任务文件未被纳入。
