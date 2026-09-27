# 自有 Electron 桌面宿主替换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ActionDriver 的开发、预览、本地 Electron 测试和 macOS 包统一运行自编译 Electron。

**Architecture:** 新增共享产物解析器与可跟踪的来源配置，启动包装脚本向 electron-vite 设置显式执行路径，E2E 和打包消费相同结果。保留 npm electron 类型和工具元数据，实际二进制严格来自自有 bundle。

**Tech Stack:** Node ESM、electron-vite 3.1.0、Electron 38.8.6、Playwright Test、macOS arm64。

**Spec:** `openspec/changes/replace-desktop-electron-with-fork/design.md` 与 `specs/desktop-shell/spec.md`。

## Global Constraints

- 统一替换开发、测试、打包全部入口；不回退官方二进制，不覆盖 node_modules。
- Electron 38.8.6 / Chromium 140.0.7339.249 / darwin-arm64；其他平台没有有效产物时明确失败。
- 不修改桌面 UI、IPC、Agent 行为，不替换 Playwright 依赖，不设计内核扩展。
- 迭代期只定向测试；准备一次集中提交时才运行全量验证。旧 Fork 基线改动和 docs/explorations 不混入提交。
- 当前会话按既有方式直接执行，最终一次独立代码审查。

## Review Focus

- 从 apps/desktop 或含空格路径启动：解析相对项目而非进程 cwd。Task 1 测试覆盖。
- 用户设置旧 ELECTRON_EXEC_PATH：受支持启动入口必须覆盖为已校验产物。Task 2 测试覆盖。
- 热重载及 Ctrl-C：保持子进程参数、退出码与信号传播。Task 2 测试覆盖。
- 框架文件篡改但 launcher 不变：全 bundle 校验必须失败。Task 1 测试覆盖。
- 包内宿主改名：来源与版本校验必须适配 ActionDriver 执行名。Task 3 测试覆盖。

---

### Task 1: 产物来源与解析

**Files:**
- Create: `config/electron-fork.json`
- Create: `scripts/lib/electron-fork.mjs`
- Create: `scripts/lib/electron-fork.test.mjs`
- Create: `scripts/lib/electron-fork.d.mts`（供 TypeScript E2E 使用）

**Interfaces:**
- Produces: `resolveElectronFork(options?: { projectRoot?: string; platform?: string; arch?: string }): Promise<{ executablePath: string; appPath: string; provenance: ElectronForkProvenance }>`。
- `ElectronForkProvenance` 记录 schemaVersion、Electron/Chromium 版本、platform、arch、repo、sourceCommit、Chromium 基线及补丁后 commit、构建 args 与 sha256、executableSha256、appSha256、相对项目 appPath。配置从已构建实物生成，不复制浮动 HEAD 当作构建记录。
- 校验版本与项目 electron 元数据一致，执行宿主读取真实版本、架构；检验来源配置的字段与 Fork 仓库身份、构建基线可追溯；全目录哈希包含文件内容和 symlink 目标，不遍历链接到包外。

- [ ] **Step 1:** 写失败测试 `acceptsRecordedArtifact`、`resolvesIndependentlyOfCwd`、`rejectsMissingBundle`、`rejectsFrameworkTamper`、`rejectsWrongVersion`、`rejectsWrongArchitecture`、`rejectsExecutableOutsideBundle`；使用临时夹具和可控探针，断言明确错误而非 fallback。
- [ ] **Step 2:** `node --test scripts/lib/electron-fork.test.mjs`，确认缺少解析器时失败。
- [ ] **Step 3:** 实现上述接口和配置，复用 baseline 校验算法思想，产品代码不 import Fork 测试目录；返回完整 bundle 与执行路径，不修改实际产物。
- [ ] **Step 4:** 同一测试命令通过，再实际解析本机 bundle，输出真实执行路径与版本；测量完整校验耗时并记录。

### Task 2: 开发、预览与本地 E2E

**Files:**
- Create: `scripts/run-desktop-electron.mjs`
- Create: `scripts/lib/desktop-electron-launch.mjs`
- Create: `scripts/lib/desktop-electron-launch.test.mjs`
- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/e2e/support/electron-fork.ts`
- Modify: `apps/desktop/e2e/{app,composer-focus,sidebar-collapse,main-prompt-offline,real-tool-smoke,tool-runtime,local-runtime,computer-use}.spec.ts`
- Create: `apps/desktop/e2e/electron-fork-runtime.spec.ts`

**Interfaces:**
- Consumes: Task 1 `resolveElectronFork()`。
- Produces: `runDesktopElectron(args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<number>`，解析器校验后使用本地 electron-vite CLI，覆盖 ELECTRON_EXEC_PATH；转发参数与退出状态，处理 SIGINT/SIGTERM，不继承 ELECTRON_RUN_AS_NODE。
- Produces: E2E `getElectronForkExecutable(): Promise<string>`，每个测试进程缓存已校验解析结果；所有本地 electron.launch 显式传 executablePath。

- [ ] **Step 1:** 包装器失败测试 `overridesStaleExecutablePath`、`forwardsArgumentsAndCwd`、`propagatesChildExit`、`forwardsTerminationSignal`、`doesNotLaunchAfterValidationFailure`；用子进程夹具验证，不启动长驻产品。
- [ ] **Step 2:** `node --test scripts/lib/desktop-electron-launch.test.mjs` 观察失败后实现包装器，把 desktop dev/preview 接到脚本，保持 predev 和现有 build 流程。
- [ ] **Step 3:** 定向包装器测试通过；枚举全部 electron.launch，修改未指定路径的本地入口，packaged-runtime 保持包内路径。
- [ ] **Step 4:** 新产品冒烟测试通过真实主进程断言 process.execPath、Electron 38.8.6、Chromium 140.0.7339.249 与 sandbox preload 桥接正常；验证 Runtime utility process 正常启动及 SQLite 持久化读写。若 ABI 不匹配，使用现有 build-electron-native.mjs 修复并保留 Node binding。
- [ ] **Step 5:** 构建所需桌面/Runtime 模块后，仅运行 `pnpm exec playwright test apps/desktop/e2e/electron-fork-runtime.spec.ts`；确认没有官方宿主启动。手动验证 dev 热重载、preview 启动和退出，保留结果。

### Task 3: macOS 打包来源

**Files:**
- Modify: `scripts/test-packaged-macos.mjs`
- Modify: `apps/desktop/e2e/packaged-runtime.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1 返回 appPath 与 provenance。
- Produces: 包内 `Contents/Resources/actiondriver-electron-provenance.json`，仅包含运行来源所需信息，不泄露开发者绝对源码路径；复制后原始 bundle 哈希不能冒充签名/重命名后包哈希。

- [ ] **Step 1:** 打包测试断言真实宿主路径位于 ActionDriver.app，process.versions 与来源记录相同；现有包内 Runtime、数据库、Computer Use helper 资源与签名检查继续成立。
- [ ] **Step 2:** 打包脚本用自有 appPath 替换 require('electron') 来源；打包前执行相同校验，保留现有 ditto、重命名、资源复制和签名顺序。
- [ ] **Step 3:** 在 README 记录自有源码锁定、原生 GN/Ninja、Node、SDK、Metal、ulimit 与 PCH 配置，列标准 dev/preview/test/package 命令及缺失产物提示；不声明其他平台通过。

### Task 4: 集中验收与提交

**Files:**
- Modify: `openspec/changes/replace-desktop-electron-with-fork/tasks.md`（按真实结果勾选）
- Modify: 本计划验证记录。

- [ ] **Step 1:** 准备提交时一次运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`，再运行 `pnpm test:e2e:local` 与 `pnpm test:e2e:packaged:macos`，记录通过/失败/跳过数量。既有 approval timeout、图片配置/夹具失败与本次故障严格区分，不能把全量声明全绿。
- [ ] **Step 2:** 一次独立最终审查，重点查入口遗漏、官方 fallback、产物校验绕过、ABI 与包内身份；发现问题定向修复验证。
- [ ] **Step 3:** `openspec validate replace-desktop-electron-with-fork --strict`、`git diff --check` 通过；显式暂存本次文件，提交信息包含验证结果，不推送。
- [ ] **Step 4:** 本次验收完成后归档本次 OpenSpec；旧 implement-browser-use 的剩余审查/提交任务不自动混入。

## Plan Self-Review

已核对来源一致、无效产物失败、全部入口、真实产品行为、SQLite 与打包五类场景，分别由 Tasks 1–3 实现和定向验证，Task 4 验证整体回归。接口统一使用 executablePath/appPath/provenance，无悬空测试入口。执行阶段如发现需升级基线或改变安全/运行边界，停止该项并重新 Battle。
