# Browser Use 与 vendor 移除联合实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 macOS 右侧内置 Browser Use 与 Agent 自行启动的外部 Chrome，同时在保持 Computer Use 可用的条件下完全移除 `apps/agent-runtime/vendor`。

**Architecture:** `packages/browser-desktop` 管理宿主中立的会话，`apps/desktop` 注入 Electron 内置网页和独立 Chrome、绑定任务并展示 UI。`apps/agent-runtime` 经 ActionDriver 自有 helper/host 装配 CUA、Sky、REPL，不再加载原件；备份仅供离线对照。浏览器产品与底层切换分阶段实现，最后共同验收。

**Tech Stack:** TypeScript 5.9、Node ESM、Electron 38、React、Playwright Core、Swift macOS Computer Use helper、Vitest、OpenSpec。

**Spec:** `docs/superpowers/specs/2026-09-28-browser-and-vendor-cutover-design.md`；详细浏览器任务见 `docs/superpowers/plans/2026-09-28-browser-product-integration.md`，自有宿主任务见 `docs/superpowers/plans/2026-09-28-cua-owned-hosts.md`。

## Global Constraints

- 只支持 macOS；外部浏览器只支持由 Agent/ActionDriver 启动、使用独立 profile 的 Chrome，不连接现有标签。
- Browser 与 Computer 的底层自有包及真实验收不得连接 Codex App 私有服务。
- `thirdparty/backup` 保留为离线对照；任何产品源码、依赖图和打包产物不得从该目录加载。
- 不削弱现有 Computer Use 的授权、取消、沙箱、截图、重置与资源清理行为；缺少能力时明确失败，不能假成功。
- 迭代期只运行改动相关定向测试与必要的 typecheck；全量 `pnpm typecheck`、`pnpm lint`、`pnpm test` 及适用 E2E 仅在准备提交时运行一次。
- 主仓库有其他任务未提交改动；浏览器隔离工作树也有未提交实现。整合时保留两边现有内容，只提交本次变更涉及的文件。

## Review Focus

1. REPL 子进程在重置和第二次调用后是否继续由自有 CUA/Sky 服务，且不复活 vendor；Task 3 覆盖。
2. Computer Use 授权拒绝、Esc 取消和会话结束时是否释放 helper 与截图资源；Task 3/4 覆盖。
3. 内置 view 的真实网页是否正是 Agent 操作的页面，且任务切换、折叠和缩放不丢状态；Task 2 覆盖。
4. Chrome 用户手动关闭、启动失败、CDP 断连时是否报错并清理隔离 profile；Task 2/4 覆盖。
5. 迁移后的测试、脚本和包内容是否偷偷引用 `vendor` 或 `thirdparty/backup` 生产路径；Task 5 覆盖。

---

### Task 1: 对齐两项变更的实现状态与隔离工作树

**Files:** `openspec/changes/{integrate-browser-use-desktop,reconstruct-codex-cua-packages}/tasks.md`、浏览器隔离工作树内的 `packages/browser-desktop/src/session-*`、`apps/desktop/src/main/browser-session/*`、主仓库自有宿主文件。

**Interfaces:** 以 `BrowserDesktopSessionController`、`ActionDriverBrowserHost`、`ActionDriverComputerHost` 为后续稳定边界。整合已有实现时不得覆盖主仓库已有未提交的 `browser-runtime`、Sky、CUA 改动。

- [ ] 只读核对两处 `git status`、文件哈希和定向测试结果，列出已完成、重复及冲突文件；为要继续的单一工作树保留所有现有改动。
- [ ] 对重叠的 `browser-runtime` 文件逐段合并接口与实现，保留主仓库自有宿主进展及隔离工作树的浏览器会话进展。
- [ ] 对已存在的浏览器会话、IPC、CUA 和 Sky 测试运行定向命令，记录基线；只将实际完成的 OpenSpec 项勾选。

### Task 2: 完成浏览器产品会话与真实 UI

**Files:** `packages/browser-desktop/src/session-contract.ts`、`session-controller.ts`；`apps/desktop/src/main/browser-session/{embedded-host,external-chrome-host,provider,ipc,task-binding}.ts`；`apps/desktop/src/preload/*`；`apps/desktop/src/renderer/src/{components,pages,services}/`；`plugins/browser-use/src/*`。精确接口和测试文件见浏览器产品实施计划 Task 1–7。

**Interfaces:** Main 的两个宿主实现 `BrowserDesktopHost`；`TaskBrowserBinding` 只映射 task→session；preload 的 `browserSession.command/subscribe` 传可序列化契约；Provider 通过现有 Tool Registry/Policy Gate 调同一控制器。

- [ ] 对内置 view 隔离、标签身份、任务投影、Browser Use 工具与 UI 控件写对应失败测试，再运行所改测试文件确认 RED。
- [ ] 实现 Electron `WebContentsView` 真实导航/操作/事件和页面 bounds、外部 Chrome 适配、Agent Provider 与接管控制；每完成一个边界就跑对应定向测试及必要 typecheck。
- [ ] 以本地 HTTP 夹具在真实 Electron 和 Chrome 验证右侧页面、标签、输入/点击/滚动/截图、Agent 操作、用户接管、任务切换、关闭和错误；记录操作及资源清理证据。
- [ ] 更新 `integrate-browser-use-desktop` 任务 1–4 的真实完成状态；部分通过不勾选整体任务。

### Task 3: 补齐自有 CUA、Sky、REPL 与 Computer Use 宿主

**Files:** `packages/{sky,cua,cua-repl,browser-runtime,browser-desktop}/src/`；`apps/agent-runtime/src/computer-use/{cua-runtime,entry,codex-sky-session}.ts`；`apps/agent-runtime/resources/js-repl/{repl-server,codex-service-host}.mjs` 及相关定向测试。具体包级缺口见自有宿主实施计划 Task 2–7、OpenSpec 55–57。

**Interfaces:** `createActionDriverSky(ActionDriverComputerHost, options)` 使用版本化 `ComputerHelperRequest`；`createTinyskyAlt({browserHost,computerHost,...})` 只接收自有端口；REPL 子进程由受控宿主提供模块映射，不接收 `CUA_VENDOR_ROOT`。

- [ ] 为当前仍未覆盖的 Sky/Browser 命令、BrowserDesktop 服务差异、CUA 合并会话及 REPL 重置写失败的定向测试；运行对应测试确认缺口。
- [ ] 实现并接入自有 host，移除候选入口的 Codex 私有 pipe、RPC 和全局 fallback；逐包运行对应测试、类型检查和服务隔离扫描。
- [ ] 保留 `agent-runtime` 原有审批、任务取消、沙箱和图片存储，使用自有 helper 的成功、拒绝、取消、重置及关闭夹具验证；记录真实结果与未覆盖项。

### Task 4: 联合真实验收与生产切换

**Files:** `analysis/codex-cua/owned-macos-acceptance.md`、浏览器真实验收记录；`apps/agent-runtime/src/runtime-process.ts`、`src/computer-use/*`、`resources/js-repl/*`、`package.json`，以及桌面产品接线。

**Interfaces:** 生产 `createComputerUseEntry` 不接收 `vendorRoot`；运行时和 REPL 只从已安装自有包与 ActionDriver helper 装配 CUA/Sky。Browser Use Tool Provider 和 UI 指向 Task 2 的同一会话。

- [ ] 在可重置 macOS helper 和本地 HTTP 页面上覆盖 OpenSpec 57.1–57.3 及 Browser Use 4.1–4.2；逐项列明通过、阻断和证据级别。
- [ ] 仅当生产必需路径无阻断差异时，写失败的运行时定向测试：装配不含 vendor、授权/取消/重置仍可用、Browser Use 两表面被 Agent 调用。
- [ ] 改生产 loader、REPL 模块映射、依赖和打包配置；运行定向测试及真实应用启动，检查 Computer Use 和 Browser Use 同时工作。失败时修复自有实现，不转从备份加载。

### Task 5: 迁移离线对照并删除 vendor

**Files:** `packages/{cua,sky,cua-repl,browser-runtime,cua-parity}/tests/*` 的原件路径、`scripts/sync-codex-cua.mjs`、`apps/agent-runtime/scripts/copy-js-entry.mjs` 及测试、`apps/agent-runtime/vendor/`、相关文档/基准。

**Interfaces:** `captureBaseline('thirdparty/backup/codex-cua')` 仅在离线差异/漂移测试使用；产品构建仅复制自有 REPL 资源与包，不复制原件。

- [ ] 将固定原件测试改读备份，重写“生产仍使用 vendor”的旧断言为“生产不读备份和 vendor”；对纯构建/包边界写失败测试。
- [ ] 移除 vendor 同步与复制脚本、`CUA_VENDOR_ROOT`、生产源码及打包引用；运行定向测试和源/产物隔离扫描。
- [ ] 删除 `apps/agent-runtime/vendor` 的全部受控文件，确认该路径不存在；对仓库源代码、构建输出和打包产物复核。保留 `thirdparty/backup` 文件与哈希清单。

### Task 6: 最终验证、记录与提交

**Files:** 两项 OpenSpec 的 proposal/design/spec/tasks、联合验收记录及本计划；仅暂存本任务改动。

- [ ] 运行两个 OpenSpec strict validate，核对联合设计的每条验收标准和未完成项；阻断项仍在时不宣称完成。
- [ ] 准备提交时依 AGENTS.md **一次性**运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`，以及必要的本地/打包 E2E；记录命令、通过/失败数量和故障归因。
- [ ] 仅提交本任务文件，检查提交与工作树保留其他任务的改动。实际完成后按 OpenSpec archive 流程归档两个 change；未完成时不归档。
