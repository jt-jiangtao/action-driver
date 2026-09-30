# 全仓无用代码清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除受控项目范围内可证实无用的代码及空源码目录，保留现行功能和所有明确排除项。

**Architecture:** 从各类声明入口建立可达性清单，再对静态候选作引用反查。先清理已定位的死代码，再按同一证据标准处理其余候选；测试、构建与 Git 检查作为删除后的验收。

**Tech Stack:** TypeScript 5.9、Electron、Swift Package、pnpm、Vitest、OpenSpec、Git。

**Spec:** `docs/superpowers/specs/2026-09-28-prune-unused-project-code-design.md`；OpenSpec 已归档至 `openspec/changes/archive/2026-09-29-prune-unused-project-code/`。以下任务中的活跃路径保留执行时记录。

## Global Constraints

- 只删代码和无需占位的空源码目录；不清理 `thirdparty/backup`、两个 Git 子模块、文档与设计资产、`.env.local` 或被忽略的本地构建产物。
- 不改变现行公共契约、产品行为、持久化数据或安全约束；触及这些边界时按 Agent Battle 协议暂停相关写操作。
- 迭代期只运行定向验证；准备提交时才一次性运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`。本次提交只含本任务改动。
- OpenSpec 变更的 `tasks.md` 随完成逐项勾选；审计证据写入该变更的 `audit.md`。

## Review Focus

- `package.json` 的 `exports`、`bin` 和脚本入口：验证保留的入口文件仍存在且可解析。
- Electron Main、Preload、Renderer 与插件 `plugin.json` 的动态入口：验证配置与构建装配仍引用有效文件。
- 仅由测试引用的工具或夹具：确认测试仍证明现行行为后再决定保留或删除。
- OpenSpec 活跃变更中明确预留的源码：核对计划文件，避免删除尚未接线的已批准实现。
- 备份、子模块、未跟踪配置及本地产物：以路径清单和 `git status` 确认未触及。

---

### Task 1: 建立全仓代码审计记录

**Files:**
- Create: `openspec/changes/prune-unused-project-code/audit.md`
- Read: root/workspace `package.json`, `plugin.json`, `apps/desktop/electron.vite.config.ts`, Swift `Package.swift`, `scripts/`, active `openspec/changes/`

**Interfaces:**
- Produces: 审计表的每行含路径、真实入口/消费者、删除或保留结论、核对命令；Task 2 和 3 只操作标记为删除的项。

- [ ] **Step 1: 固定基线。** 记录 `git status --short`、`git ls-files` 计数及排除目录；确认 `.env.local` 仅为预存未跟踪文件。
- [ ] **Step 2: 建立入口清单。** 逐项读取工作区脚本、包导出、插件清单、Electron 配置、Swift Package、测试配置及资源复制脚本；记录入口路径。
- [ ] **Step 3: 核对候选。** 对零入边文件、仅测试使用的实现和 `tsc --noUnusedLocals --noUnusedParameters` 诊断作 `rg`/动态路径反查，并核对活跃 OpenSpec；写入 `audit.md`。初筛的 86 个零入边文件不得直接批量删除。
- [ ] **Step 4: 验证审计。** `audit.md` 中每个删除项须有独立理由；`git diff --check` 通过，审计表列出保留的动态入口和排除项。

### Task 2: 删除已定位的桌面端与运行时死代码

**Files:**
- Delete: `apps/desktop/src/shared/detail-bounds.ts`，前提是 Task 1 再次确认无字符串或入口引用。
- Modify: `apps/agent-runtime/src/agent-files/agent-file-store.ts`，删除无消费者的 `isExecutorRegistered` 成员、构造选项和赋值。
- Modify: `apps/agent-runtime/tests/stream-session-service.test.ts`，将未使用的 `observer` 参数改为 `_observer`。
- Modify: `openspec/changes/prune-unused-project-code/audit.md` 与 `tasks.md`。

**Interfaces:**
- Consumes: Task 1 的审计表与入口结论。
- Produces: 已清理的桌面端与运行时源码，不改变 `AgentFileStore` 实际运行行为。

- [ ] **Step 1: 核对删除前状态。** `rg -n 'DetailBounds|detail-bounds|isExecutorRegistered' apps packages plugins scripts` 只命中待删定义；运行时未使用检查准确报告成员和测试参数。
- [ ] **Step 2: 删除最小代码。** 删除死文件、构造选项及赋值，重命名未使用参数；在审计表记录确切删除项。
- [ ] **Step 3: 定向验证。** 运行 `pnpm vitest run apps/agent-runtime/tests/agent-file-store.test.ts apps/agent-runtime/tests/stream-session-service.test.ts`、`pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters -p apps/agent-runtime/tsconfig.json` 及 `pnpm --filter @action-driver/desktop typecheck`，确认通过；如有新失败，先定位原因再继续。

### Task 3: 清理其余经审计证实无用的代码与空目录

**Files:**
- Delete/Modify: Task 1 `audit.md` 中标记为删除的其余 `apps/`、`packages/`、`plugins/`、`scripts/` 路径及直接关联配置/专属测试。
- Modify: `openspec/changes/prune-unused-project-code/audit.md` 与 `tasks.md`。

**Interfaces:**
- Consumes: Task 1 的逐项删除清单；不扩大到未列出的资源、备份或产物。
- Produces: 不留失效引用和空源码目录的受控代码树。

- [ ] **Step 1: 按模块删除。** 每组删除前复核审计理由，清理文件、无消费者的内部导出和失效专属测试；保留可运行的包/插件/脚本入口。
- [ ] **Step 2: 跑相关定向测试和工作区类型检查。** 命令与结果按模块记入 `audit.md`；删除后再用 `rg` 反查残余引用。
- [ ] **Step 3: 清理空目录。** 仅处理源码路径内无需占位的空目录；`find` 复查，确认 `.gitkeep` 所维护的目录与本地缓存未变。

### Task 4: 集成验收与提交

**Files:**
- Modify: `openspec/changes/prune-unused-project-code/audit.md` 与 `tasks.md`。
- Commit: 仅本变更的规划、审计与代码改动。

**Interfaces:**
- Consumes: Task 1–3 的审计与代码结果。
- Produces: 可追溯提交及 OpenSpec 实施记录。

- [ ] **Step 1: 审查全部差异。** 对照 `git diff`、审计表和活跃 OpenSpec；确认每项删除有证据、排除路径原样保留，`git diff --check` 通过。
- [ ] **Step 2: 执行提交前验证一次。** 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`；涉及界面或运行时的删除按需追加 `pnpm test:e2e:local` 或相关构建/启动检查。将命令、通过/失败数量及已知无关失败写入审计记录或提交信息。
- [ ] **Step 3: 更新 OpenSpec 并提交。** 勾选已完成任务，严格验证 `prune-unused-project-code`，只暂存本次任务文件并提交；重新检查 Git 状态，确认 `.env.local` 未被暂存。

归档在实施验证后按 `openspec-archive-change` 单独执行。

### Task 5: 统一 Node 并修复测试基线（追加裁决）

**Files:** `openspec/changes/prune-unused-project-code/{proposal,design,tasks,audit}.md`；具体测试与实现文件由根因调查确定。

**Interfaces:** 本次验证固定使用本机已安装的 Node v24.20.0；不改变 `package.json` 的 Node 支持范围、产品接口、持久化或安全约束。用户已裁决在同一清理分支修复既有测试失败，并接受跨模块复核成本。

- [x] **Step 1: 建立可复现基线。** 对照未修改主工作区与清理分支，均通过明确的 Node v24.20.0 PATH 运行失败文件的定向测试；把失败测试、报错、是否两边一致及根因记录在 `audit.md`。不在迭代期重跑全量 `pnpm test`。
- [x] **Step 2: 按根因逐项修复。** 每组先有失败用例，再做最小修复；运行该文件及直接关联测试。若修复触及新的产品边界，暂停并按 Agent Battle 协议裁决。
- [x] **Step 3: 提交前统一验证。** 只有全部预期修复完成并准备下一次提交时，执行一次 `corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm test`；记录结果、只暂存本任务文件并提交。全量仍红则保留分支并继续定位，不宣称通过。
