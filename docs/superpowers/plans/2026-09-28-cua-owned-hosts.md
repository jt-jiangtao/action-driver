# CUA 独立宿主与 browser-desktop 还原 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The current task is to be implemented natively in this session; do not dispatch subagents without a separate user request.

**Goal:** 把五个 `@actiondriver/*` CUA 候选包还原为不连接 Codex 私有服务、可通过 ActionDriver 自有 macOS 宿主验证的独立实现；整体验收前不切换生产。

**Architecture:** 原件与候选彻底分离。新增 `@actiondriver/browser-desktop` 保存独立服务的接口与差异实现；`browser-runtime` 提供共享浏览器客户端/服务模块。所有宿主调用经显式注入的 ActionDriver port；Computer Use 对接已有 Swift helper，Browser Use 建立自有 Chrome/CDP 宿主，不读取 Codex App 私有路径、pipe、turn metadata 或 broker。

**Tech Stack:** TypeScript 5.9.3、Node ESM、Vitest 3.2.7、Playwright Core 1.59.0、Swift macOS helper；第三方版本沿既定 OpenSpec 精确锁定。

**Spec:** [OpenSpec 规范](../../../openspec/changes/reconstruct-codex-cua-packages/specs/codex-cua-reconstruction/spec.md)、[设计](../../../openspec/changes/reconstruct-codex-cua-packages/design.md)、[任务](../../../openspec/changes/reconstruct-codex-cua-packages/tasks.md)。

## Global Constraints

- 原件完整留在 vendor/back；新实现代码、目录和标识不使用 `oai_` 前缀，产品构建不导入备份。
- 五个候选包及其验收测试绝不连接 Codex App 私有服务、私有 native pipe、会话/turn metadata 或认证 broker；只允许 ActionDriver 自有进程、helper、socket 与浏览器宿主。
- 原包差异仅用于不会触达私有服务的离线场景；旧 Codex 宿主实机证据不算最终验收。
- 仅 macOS；Linux/Windows 缺口继续写入 `docs/codex-cua-platform-gaps.md`。
- 三方依赖按确切版本引入，Zod 仅按已批准的 `3.25.76` 例外；不要重写三方库。
- 先测试失败、再实现、再运行定向测试；迭代期禁止全量 `pnpm test` 和 E2E。准备最终提交才按 AGENTS.md 一次性全量检查。
- 未完成真实 ActionDriver 宿主验收前，不改 `apps/agent-runtime` 的默认生产依赖与 loader。

## Review Focus

1. 候选默认初始化无 host 时必须显式失败，不得静默读取 `globalThis.nodeRepl`；在 Task 3 的测试中固定。
2. 测试注入伪装为本机 App 私有 pipe 的路径必须被拒绝；在 Task 2 的静态和运行边界测试中固定。
3. Swift helper 与原 Sky pipe 的帧/错误语义不相同；在 Task 4 用真实 helper 契约测试适配，不转发旧帧。
4. 浏览器关闭、取消或 CDP 断连不得遗留 profile、端口、标签和监听；在 Task 5/8 测试。
5. codex-app 环境缺少认证安全说明时保持拒绝；cloud/orbit 只读本环境原件；在 Task 7 测试。

## File Structure

- `thirdparty/backup/browser-desktop/@oai/browser-desktop/`：App 随附包的只读原件，`thirdparty/backup/browser-desktop/manifest.json` 记录版本、哈希、权限和来源。
- `analysis/codex-cua/desktop-inventory.json`、`analysis/codex-cua/desktop-source-map.md`：独立包的文件/模块归属和共享/差异清单；不进入构建。
- `packages/cua-parity/src/desktop-baseline.ts`：纯文件层快照验证，不加载服务。
- `packages/cua-parity/src/service-isolation.ts`：候选源码、产物和验收脚本的禁止依赖/路径扫描。
- `packages/browser-runtime/src/host-port.ts`：ActionDriver-owned 浏览器 client port；`runtime-initialization.ts` 通过显式 host 初始化，不读取 Codex global。
- `packages/sky/src/mac/actiondriver-host.ts`：原 Sky 方法到 ActionDriver Computer Use helper 请求的适配。
- `packages/browser-runtime/src/local-browser-host.ts`：ActionDriver 自有 Chrome/CDP 生命周期与 `BrowserBackend` API 适配；相关能力分拆至其各自文件，避免单文件承载 75 个命令。
- `packages/browser-desktop/{package.json,tsconfig.json,tsconfig.build.json,src/,tests/,docs/source-mapping.md}`：独立候选包、资源及服务差异。
- `packages/cua/src/default-runtime.ts`、`packages/cua-repl/src/launch.ts`：仅装配自有 host 的默认入口。
- `analysis/codex-cua/owned-macos-acceptance.md`：真实 macOS 夹具、命令、结果、截图与清理证据；不得复用历史 Codex 宿主结论。

---

### Task 1: 固定 desktop 原件与漂移检测

**Files:** Create `thirdparty/backup/browser-desktop/@oai/browser-desktop/`, `thirdparty/backup/browser-desktop/manifest.json`, `packages/cua-parity/src/desktop-baseline.ts`, `packages/cua-parity/tests/desktop-baseline.test.ts`; modify `thirdparty/backup/README.md`.

**Interfaces:** `captureDesktopBaseline(root: string): Promise<{version: string; files: FileRecord[]}>`；`verifyDesktopBaseline(root: string, baseline: DesktopBaseline): Promise<Drift[]>`。复用既有 `FileRecord`/`Drift`，但独立 baseline 不改变 vendor 的 1117 条目快照。

- [ ] 写失败测试：源/备份相同返回空漂移；改一字节、少一文件、改权限都返回对应路径；候选代码不从备份导入。
- [ ] 运行 `pnpm vitest run packages/cua-parity/tests/desktop-baseline.test.ts`，确认因接口缺失失败。
- [ ] 从本机安装目录完整复制 106 个文件，保存逐文件 SHA-256、大小、模式和原路径；不覆盖既有 `thirdparty/backup/codex-cua`。
- [ ] 实现独立 capture/verify，运行同一定向测试；对原路径与备份逐项校验后再记录基准。

### Task 2: 来源映射与全包服务隔离检查

**Files:** Create `analysis/codex-cua/desktop-inventory.json`, `analysis/codex-cua/desktop-source-map.md`, `packages/cua-parity/src/service-isolation.ts`, `packages/cua-parity/tests/service-isolation.test.ts`; update `packages/browser-runtime/docs/source-mapping.md`.

**Interfaces:** `auditServiceIsolation(paths: string[]): Promise<{path: string; reason: string}[]>`；扫描候选源码、打包产物和会被执行的验收脚本，跳过明确的原件/分析数据，不以名称为唯一判断依据。记录 desktop client 与内嵌 client 字节相同、两个 service 哈希不同。

- [ ] 写失败测试：`nodeRepl.rpc('browser', ...)`、Codex App 安装路径、私有 pipe 环境名、静态/动态加载原 bundle 均报告；ActionDriver 自有 helper/socket 不误报。
- [ ] 运行 `pnpm vitest run packages/cua-parity/tests/service-isolation.test.ts`，确认 RED。
- [ ] 实现扫描器和 desktop 106 文件清单；提取 service 对外 RPC、资源选择、第三方证据及未知项，不把 1.9 MB bundle 的所有代码冒充自有模块。
- [ ] 运行测试与只读扫描，保存初始发现；已有违规连接点必须在后续任务消除，不能为了绿色检查加白名单。

### Task 3: 显式 ActionDriver 浏览器 host port

**Files:** Create `packages/browser-runtime/src/host-port.ts`, `packages/browser-runtime/tests/host-port.test.ts`; modify `packages/browser-runtime/src/runtime-initialization.ts`, `packages/browser-runtime/tests/runtime-initialization.test.ts` and public setup types.

**Interfaces:** `ActionDriverBrowserHost` 提供 `setup(options: RuntimeSetupOptions): Promise<{apiManifest: ApiManifest; disabledMemberIds: string[]}>`、`execute(command: Record<string, unknown>): Promise<unknown>`、`displayImage(bytes: Uint8Array): Promise<void> | void`、`close(): Promise<void>`；`setupBrowserRuntime({host, ...options})` 要求显式 port。无 host 返回 `BROWSER_HOST_UNAVAILABLE`，不探测全局 Codex `nodeRepl`。

- [ ] 先写失败测试：伪全局 Codex RPC 被计数为零；无 host 失败；显式本地 host 收到 setup/execute，关闭后拒绝命令。
- [ ] 运行 `pnpm vitest run packages/browser-runtime/tests/host-port.test.ts packages/browser-runtime/tests/runtime-initialization.test.ts`，确认 RED。
- [ ] 接入 port、更新客户端装配和类型断言；保留原包离线对照时使用显式受控 transport。
- [ ] 运行上述定向测试和 `pnpm --filter @actiondriver/browser-runtime typecheck`。

### Task 4: Sky 对接自有 macOS Computer Use helper

**Files:** Create `packages/sky/src/mac/actiondriver-host.ts`, `packages/sky/tests/actiondriver-host.test.ts`; modify `packages/sky/src/sky-proxy.ts`, `packages/sky/src/service.ts`, `packages/sky/tests/native-connection.test.ts`；按需复用 `@actiondriver/runtime-contracts` 的现有 request/response schema。

**Interfaces:** `ActionDriverComputerHost.request(input: ComputerHelperRequest, signal?: AbortSignal): Promise<unknown>`；`createActionDriverSky(host: ActionDriverComputerHost)` 输出现有 sky 客户端调用面。旧 Sky 原生帧与 helper JSON 线协议分别解析，不传旧 `ensureService` 帧到 helper。

- [ ] 写失败测试：list apps、app state、click、截图返回的映射；无权限、错误码、超时、取消、断连后清理；Codex 私有 socket 永不打开。
- [ ] 运行 `pnpm vitest run packages/sky/tests/actiondriver-host.test.ts`，确认 RED。
- [ ] 以现有 Swift helper/ActionDriver runtime 契约实现适配，保持候选 API 的错误形状；新增行为差异显式记录。
- [ ] 运行该文件及 `packages/sky/tests/native-connection.test.ts`、Sky typecheck。

### Task 5: 自有 macOS 浏览器宿主与 CDP 生命周期

**Files:** Create `packages/browser-runtime/src/local-browser-host.ts`, `packages/browser-runtime/src/local-cdp-adapter.ts`, `packages/browser-runtime/tests/local-browser-host.test.ts`, `packages/browser-runtime/tests/local-cdp-adapter.test.ts`; modify `service-native-runtime.ts` only at explicit host assembly seam.

**Interfaces:** `createLocalBrowserHost({profileRoot, browserExecutable?, launch, clock?}): Promise<ActionDriverBrowserHost>`；由 ActionDriver 启动/拥有本地 Chrome/CDP，适配 `SessionBrowserApi` 所需 tab、session、CDP、clipboard 和关闭事件，向 `BrowserBackend` 提供可测试端口。缺 browser 可执行文件或 CDP 握手失败明确拒绝并清理 profile。

- [ ] 写失败测试：创建/发现标签、CDP 事件与命令关联、断连/取消、关闭后监听/profile 清理、未授权路径拒绝。
- [ ] 运行两份定向测试确认 RED。
- [ ] 用固定的 `playwright-core@1.59.0` 和本地 browser executable 建立自有 CDP port；不借 Codex App pipe 或签名二进制。按现有 `BrowserBackend` 调用面拆分适配模块。
- [ ] 运行两份定向测试、`service-native-runtime.test.ts` 和 browser-runtime typecheck；能力缺口保留显式失败。

### Task 6: desktop 候选包及服务差异

**Files:** Create `packages/browser-desktop/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts,src/service.ts,src/resources.ts,docs/source-mapping.md,tests/client.test.ts,tests/service.test.ts,tests/resources.test.ts}`；按 Task 2 的差异清单增加小模块；修改 pnpm lockfile 与打包测试。

**Interfaces:** `setupBrowserDesktop({host, environment, ...options})` 复用 Task 3 客户端 port；`createBrowserDesktopService({host, environment})` 返回 `{setup, execute, dispose}`。服务差异模块按 Task 2 来源映射逐一接入，不在默认入口读取 `nodeRepl` 或 App 路径。

- [ ] 写失败测试：共享 client 的相同命令序列、独立 service 的 setup/错误/清理差异、资源环境选择；codex-app 缺 `browserAuthSafetyPrecheck` 必须拒绝，cloud/orbit 文档哈希需匹配源文件。
- [ ] 运行三个定向测试确认 RED。
- [ ] 建立独立 workspace 包与第三方精确版本；逐模块还原 desktop service 差异，未确认分支保持明确不可用，不复用不同哈希的内嵌 service 冒充一致。
- [ ] 运行三个测试、desktop typecheck、实际 `pnpm pack` 离线安装/来源扫描；持续更新差异覆盖矩阵直到自有模块无遗漏。

### Task 7: CUA 与 REPL 只装配自有 host

**Files:** Modify `packages/cua/src/default-runtime.ts`, `packages/cua-repl/src/launch.ts`, `packages/cua-repl/src/bin.ts`, `apps/agent-runtime/src/computer-use/cua-runtime.ts` 的候选路径；test `packages/cua/tests/default-runtime.test.ts`, `packages/cua-repl/tests/launch.test.ts`, `apps/agent-runtime/src/computer-use/cua-runtime.test.ts`。

**Interfaces:** `createTinyskyAlt({browserHost?, computerHost?, browser?, computer?})` 将 Task 3/4 ports 注入；REPL 启动只接受 ActionDriver 自有 JS runtime/module map。生产 loader 在全套验收前仍用旧路径，候选入口不得回退 Codex 服务。

- [ ] 写失败测试：browser-only、computer-only、合并文档/会话、reset、取消与子进程故障；向环境放入 Codex 服务路径也不会连接。
- [ ] 运行列出的定向测试确认 RED。
- [ ] 把候选工厂和 REPL 接线迁到自有 port；保留现有生产路径直到 Task 8 完成，不混入一次性切换。
- [ ] 运行上述定向测试、CUA/REPL typecheck 及 Task 2 的隔离扫描。

### Task 8: 五包真实验收与切换判定

**Files:** Create `analysis/codex-cua/owned-macos-acceptance.md`; modify `docs/codex-cua-platform-gaps.md`, `openspec/changes/reconstruct-codex-cua-packages/tasks.md` and coverage matrix; only after passing all gates touch production loader and rollback plan.

**Interfaces:** 固定的本地计算器/文本编辑器与离线 HTTP 页面夹具；记录 ActionDriver helper/browser 宿主版本、输入、状态、截图哈希、标签/profile/进程清理和失败恢复。原包离线对照单独列，不视为私有服务实机证据。

- [ ] 在自有 helper 上分别验证 Sky/CUA/REPL 的成功、无权限、取消和重置；在自有 browser host 上验证 browser-runtime/desktop 的页面操作、截图、文件路径、安全拒绝和释放。
- [ ] 运行适用定向测试、类型检查、隔离扫描、原件漂移验证与独立打包安装；每个未覆盖或不同结果标为阻断/非阻断并给依据。
- [ ] 逐项核对 OpenSpec 1.x、3.x、4.1–4.4、55–57；任何阻断未解决时停止在候选，不改生产 loader。
- [ ] 只有全部验收通过，才写整体切换/回退计划、统一替换接线，执行一次提交前全量检查并记录结果；按 AGENTS.md 只提交本任务文件，之后按 OpenSpec archive 流程处理。

## Self-review

Task 1/2 对应独立基准、来源和禁止连接；Task 3–7 分别给 browser、computer、desktop、CUA/REPL 可替换宿主；Task 8 对应真实 macOS、隔离、平台缺口和切换门槛。五项 Review Focus 分别在 Task 3、2、4、5/8、6 有定向断言。所有动作依赖前一任务的明确接口；若 Task 2 发现新的私有模块职责或 Task 5 证明自有 browser host 无法承载既定命令，先按 Battle 更新设计，再改实现。
