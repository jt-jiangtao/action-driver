# Module Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在一个变更中完成六处模块结构整理，保持既有协议、存储格式、迁移历史与公共导出兼容。

**Architecture:** 运行时的 session service、Graph runner 和 rollout store 保留各自的状态与生命周期所有权，把请求、工具、读取、写入和恢复流程拆成接受窄依赖的模块。Desktop 按功能归组；数据库迁移和 contracts 以稳定入口导出内部定义。

**Tech Stack:** TypeScript、Vitest、LangGraph、Electron/Vite、better-sqlite3、OpenSpec。

**Spec:** `openspec/changes/reorganize-module-boundaries/design.md`

## Global Constraints

- 直接在 `main` 工作；只提交本任务改动，一次完成六项，不创建工作树或拆成多个交付。
- 不新增依赖、不改用户可观察行为、HTTP/WebSocket 协议、rollout 格式、迁移 1–16 的内容/版本/名称或现有根导出。
- rollout JSONL 日志仍是唯一事实源，SQLite 投影可重建；存储状态和唯一追加能力归 `RolloutSessionStore`。
- 迭代期只运行本任务定向测试；准备最终提交时才一次性运行 `pnpm typecheck`、`pnpm lint`、`pnpm test` 及适用端到端命令。
- OpenSpec `skip_specs: true`：此变更不增加或修改行为性要求。

## Review Focus

- 同一幂等键重发时只返回原请求，并按原游标回放；由 Task 5 的测试覆盖。
- 运行中请求取消与终态同时到达时不重复清理活动 session；由 Task 5 的测试覆盖。
- 工具执行中进程退出后恢复只追加一个终态，绝不重跑工具；由 Task 3 的测试覆盖。
- 旧数据库从中间迁移版本升级时仍连续执行剩余版本；由 Task 2 的测试覆盖。
- Desktop mock 模式与真实模式经容器装配后仍指向同一功能契约；由 Task 6 的测试覆盖。

---

### Task 1: Contracts 主题模块

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/message-content.ts`, `task-projection.ts`, `skill.ts`, `agent-services.ts`（按真实依赖可增加一个小型共享类型文件）
- Test: `packages/contracts/tests/unit/contracts.test.ts`

**Interfaces:** 既有 `@action-driver/contracts` 根导出名称、类型和值保持不变；内部文件互相直接导入，不从 `index.ts` 回引。

- [ ] **Step 1:** 在 `contracts.test.ts` 中固定消息排序/活动锚点、Skill 联合类型相关运行时守卫及关键根导出；运行 `pnpm vitest run packages/contracts/tests/unit/contracts.test.ts`，确认当前基线通过。
- [ ] **Step 2:** 按主题迁移定义和函数，`index.ts` 仅再导出；以原文件导出清单和新入口清单比对名称，确认无丢失和冲突。
- [ ] **Step 3:** 运行 `pnpm vitest run packages/contracts/tests/unit/contracts.test.ts`，确认全部通过；检查包内无通过 `index.ts` 的循环导入。

### Task 2: 数据库迁移目录

**Files:**
- Modify: `apps/local-runtime/src/database.ts`
- Create: `apps/local-runtime/src/database/migrations/index.ts` 及按现有 1–16 号分组的迁移定义文件
- Test: `apps/local-runtime/tests/unit/model-connection-store.test.ts`、`apps/local-runtime/tests/unit/computer-use/app-approval-store.test.ts`

**Interfaces:** `RuntimeMigration`、`DEFAULT_RUNTIME_MIGRATIONS`、`openRuntimeDatabase`、`createRuntimeDatabase` 从 `database.ts` 保持原签名和导出；迁移模块不回引 `database.ts` 的运行时值。

- [ ] **Step 1:** 补充迁移清单版本、名称、连续性与从中间版本升级的回归断言；运行 `pnpm vitest run apps/local-runtime/tests/unit/model-connection-store.test.ts apps/local-runtime/tests/unit/computer-use/app-approval-store.test.ts` 建立基线。
- [ ] **Step 2:** 原样移动迁移定义至 `database/migrations/`，静态有序组合；`database.ts` 只导入清单并保留打开、备份、事务与校验。
- [ ] **Step 3:** 比对移动前后的迁移版本/名称/SQL，运行 Step 1 的定向测试并确认通过。

### Task 3: Rollout 读写恢复边界

**Files:**
- Modify: `apps/local-runtime/src/rollout/session-store.ts`
- Create: `apps/local-runtime/src/rollout/read.ts`, `write.ts`, `recovery.ts`, `store-context.ts`
- Test: `apps/local-runtime/tests/unit/rollout/session-store.test.ts`、`apps/local-runtime/tests/unit/stream-session-service.test.ts`

**Interfaces:** `RolloutSessionStore` 保持 `StreamSessionRepository` 和现有构造入口。`RolloutStoreContext` 只允许读取当前 session state/请求映射及调用 store 的唯一 `appendLines`；read 模块只返回派生结果，write/recovery 模块返回草稿或通过该 append 入口提交，均不实例化第二个 writer、projection 或 cache。

- [ ] **Step 1:** 固定重开、投影重建、事件水位、运行中恢复幂等及工具不重跑的测试；运行 `pnpm vitest run apps/local-runtime/tests/unit/rollout/session-store.test.ts` 建立基线。
- [ ] **Step 2:** 提取只读构造与转换到 `read.ts`，保持快照读取后的水位同步由 store 统一执行；运行 Step 1 定向测试。
- [ ] **Step 3:** 提取领域记录生成和提交到 `write.ts`，再提取中断恢复到 `recovery.ts`；store 仍唯一追加并管理缓存与投影。
- [ ] **Step 4:** 运行 `pnpm vitest run apps/local-runtime/tests/unit/rollout/session-store.test.ts apps/local-runtime/tests/unit/stream-session-service.test.ts`，确认顺序、重连和恢复用例通过。

### Task 4: Graph 状态与工具节点

**Files:**
- Modify: `packages/agent-runtime/src/agent-graph.ts`, `packages/agent-runtime/package.json`
- Create: `packages/agent-runtime/src/graph/state.ts`, `tool-execution.ts`, `helpers.ts`
- Test: `packages/agent-runtime/tests/unit/agent-graph.test.ts`、`apps/local-runtime/tests/unit/computer-use/graph-capture.test.ts`

**Interfaces:** `LangGraphRunner`、`GraphToolRuntime`、`threadIdForTask`、活动标题函数保持旧子路径及根导出；`graph/state.ts` 供 runner 装配，`graph/tool-execution.ts` 接受显式的工具运行依赖和观察者回调，不持有 runner 生命周期。

- [ ] **Step 1:** 固定工具并发、失败脱敏、中断/继续、易失图片释放和活动标题的测试；运行 `pnpm vitest run packages/agent-runtime/tests/unit/agent-graph.test.ts apps/local-runtime/tests/unit/computer-use/graph-capture.test.ts` 建立基线。
- [ ] **Step 2:** 将状态定义、路由限制、纯辅助函数移入 `graph/`，保持 runner 与原有导出；运行 Graph 定向测试。
- [ ] **Step 3:** 把工具调用节点移入 `graph/tool-execution.ts`，通过窄依赖对象接收原 runner 中的能力；只有真正需要的稳定接口才加入包子路径导出。
- [ ] **Step 4:** 运行 Step 1 的两组定向测试并确认通过，检查 `graph/` 无反向导入 `agent-graph.ts`。

### Task 5: Stream Session 请求、历史与轮次

**Files:**
- Modify: `packages/agent-runtime/src/stream-session-service.ts`, `packages/agent-runtime/package.json`
- Create: `packages/agent-runtime/src/stream/request-creation.ts`, `session-history.ts`, `turn-execution.ts` 及共享的窄端口类型文件
- Test: `apps/local-runtime/tests/unit/stream-session-service.test.ts`、`apps/local-runtime/tests/unit/service-http.test.ts`

**Interfaces:** `StreamSessionService` 保持现有公共方法及构造选项；`request-creation` 返回持久化后的请求、任务、消息与模型输入，`turn-execution` 接收这些值及单一发布回调；`session-history` 只依赖 `StreamSessionRepository` 并返回 `ModelInputMessage[]`。活动请求、活动 session、delivery 实例只在 service 中持有。

- [ ] **Step 1:** 补充幂等重发、accepted/start 顺序、持久化失败不发布、终态与取消竞态、运行中快照/重连的测试；运行 `pnpm vitest run apps/local-runtime/tests/unit/stream-session-service.test.ts` 建立基线。
- [ ] **Step 2:** 提取终态历史组装与请求创建；service 保留活动状态登记、清理及发布编排，运行 Step 1 测试。
- [ ] **Step 3:** 提取轮次执行，保留原有增量、工具、图片、成品和终态时序；必要的模块子路径以兼容方式加入包导出。
- [ ] **Step 4:** 运行 `pnpm vitest run apps/local-runtime/tests/unit/stream-session-service.test.ts apps/local-runtime/tests/unit/service-http.test.ts`，确认协议和恢复用例通过。

### Task 6: Desktop 服务功能归组

**Files:**
- Move: `apps/desktop/src/renderer/src/services/*.ts` 中对应的会话、模型连接、Agent 文件、任务目录、Skill、插件及共享传输文件到功能目录
- Modify: `apps/desktop/src/renderer/src/di/container.ts`、直接导入这些服务的页面、组件与 hook
- Test: `apps/desktop/tests/unit/renderer/src/services/**`、`apps/desktop/tests/unit/renderer/src/di/container.test.ts`、`apps/desktop/tests/unit/renderer/src/App.test.tsx`

**Interfaces:** 服务类及 `models/` 中的功能契约保持现有签名；调用方导入直接指向新功能目录；mock 与实际实现同组。`useComputerUseGuidance` 移入 hooks，任务判定留在会话功能组。

- [ ] **Step 1:** 记录现有服务到功能组映射，并固定 mock/真实容器装配与桌面页面测试；运行相关 `pnpm vitest run` 定向文件建立基线。
- [ ] **Step 2:** 按功能移动实现与 mock，更新源码、测试及构建引用；不保留旧路径转发文件。
- [ ] **Step 3:** 运行 `pnpm vitest run apps/desktop/tests/unit/renderer/src/services apps/desktop/tests/unit/renderer/src/di/container.test.ts apps/desktop/tests/unit/renderer/src/App.test.tsx`，确认通过；检查旧服务路径无引用。

### Task 7: 集成验证、归档与单次提交

**Files:**
- Modify: `openspec/changes/reorganize-module-boundaries/tasks.md` 及 OpenSpec 归档产物
- Verify: 四个受影响包与 Desktop 本地/打包运行链路

**Interfaces:** 不引入新的运行时接口；最终提交只包含本变更和归档记录。

- [ ] **Step 1:** 检查六项任务、导出清单、迁移清单和工作区差异，补齐剩余定向测试；确认已准备提交。
- [ ] **Step 2:** 只在此时各运行一次 `pnpm typecheck`、`pnpm lint`、`pnpm test`，记录命令与通过/失败/跳过数量。
- [ ] **Step 3:** 运行适用的 `pnpm test:e2e:local` 与 `pnpm test:e2e:packaged:macos`；记录数量和环境限制，不重复全量测试。
- [ ] **Step 4:** 按 OpenSpec archive 流程归档 `reorganize-module-boundaries`，只暂存本任务代码、测试、计划及归档记录；在提交信息中记录验证结果后执行一次最终 `git commit`。
