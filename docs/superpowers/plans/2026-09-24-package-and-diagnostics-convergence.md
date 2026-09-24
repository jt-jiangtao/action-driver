# Package and Diagnostics Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收敛共享包、页面读取态与诊断职责，移除重复或无消费者的基础设施。

**Architecture:** 跨进程包只保留序列化协议；Runtime 持有模型实现；Renderer 持有 UI 投影和 TanStack Query 读取缓存；各进程显式装配。SQLite、LangSmith 与 OTel 各有清晰日志职责。

**Tech Stack:** TypeScript、React、TanStack Query、OpenAI SDK、LangGraph、LangSmith、OpenTelemetry、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-24-architecture-convergence-design.md`

## Global Constraints

- 在 `runtime-reliability` 与 `runtime-boundaries` 的协议和所有权切换通过后执行。
- 保留真实 LangGraph SQLite checkpointer；只删除无生产消费者的额外抽象。
- 生产装配不得回退 Mock；模型日志只以 LangSmith 为权威来源。
- 先核对现有未提交的 LangSmith、HTTP/WS 和 Skill 变更，避免覆盖。

## Review Focus

- TanStack Query 切页/返回时缓存陈旧：相关写命令后按 key 失效；Task 2。
- 模型实现移动后打包缺少 Node native/SDK 依赖：Runtime bundle 和 Electron E2E 能启动；Task 1。
- 删除 DI 容器后测试替身无法注入：工厂参数保留接口注入；Task 3。
- 日志后端不可用：任务仍成功且不泄露凭据；Task 4。
- 旧样式 token 移动后桌面页面错色/缺样式：视觉和打包冒烟校验；Task 3。

---

## File map

`packages/runtime-contracts` 保留 wire schema；`packages/contracts` 保留跨进程通用 DTO；`packages/activity-projection` 保留 Runtime 与 Renderer 共用的纯事件投影；`apps/agent-runtime/src/model-connections` 持有供应商实现；`apps/desktop/src/renderer/src/services` 持有其余 UI 投影与 Query hooks；`composition-root.ts` 仅显式装配；`packages/observability` 保留可被多个 Node 进程安全消费的诊断实现。

### Task 1: 模型实现和协议包归位

**Files:** Move implementation from `packages/model-connections/src/{provider-adapters,http-transport,service,store,secret-cipher}.ts` into `apps/agent-runtime/src/model-connections/`; Modify `packages/contracts/src/index.ts`, `packages/runtime-contracts/src/index.ts`, both package manifests and importers; Test `packages/model-connections/tests/*.test.ts` relocated to `apps/agent-runtime/tests/`.

**Interfaces:** Runtime model gateway keeps the existing provider semantics; cross-process packages export serializable DTO/Zod schema only.

- [ ] **Step 1: Write boundary test.** Add a package dependency assertion that `packages/contracts` and `packages/runtime-contracts` import no React, Electron, Node model SDK implementation or Runtime source; record current model gateway behavior tests before moving.
- [ ] **Step 2: Run red.** Run boundary test and `pnpm typecheck`; imports from implementation package should fail the intended boundary assertion.
- [ ] **Step 3: Move.** Relocate provider/service/storage implementation and tests into Runtime, update `model-gateway.ts` imports, retain stable DTO exports in contract packages, remove package only after `rg` finds no consumers. Keep credential migration code where needed until migration tests pass.

  ```ts
  // Runtime owns this import; wire packages expose ModelConnectionDto only.
  import { createModelProviderAdapter } from './model-connections/provider-adapters'
  ```
- [ ] **Step 4: Run green and commit.** `pnpm typecheck && pnpm test && pnpm --filter @actiondriver/agent-runtime build`; stage move/import/lock files and commit `refactor(runtime): own model provider implementations`.

### Task 2: UI 投影与 TanStack Query 读取态

**Files:** Move `packages/runtime-contracts/src/activity-projection.ts` pure shared logic to `packages/activity-projection`; keep remaining UI projection in `apps/desktop/src/renderer/src/services/`; Modify `apps/desktop/src/renderer/src/{App.tsx,pages/SkillsPage.tsx,pages/SettingsPage.tsx}`, associated service clients, `apps/desktop/package.json`; Test adjacent service/page `.test.ts(x)`.

**Interfaces:** `queryKeys` uniquely identify tasks, model connections and Skill definitions; WS projector is independent of Query cache and uses the reliability plan's pure reducer.

- [ ] **Step 1: Write failing tests.** Fetch tasks/models/Skills with loading, error and retry states; after mutation, assert only matching query keys refetch. Stream one content event and assert UI projection updates without writing raw event arrays into Query cache.
- [ ] **Step 2: Run red.** Run App, SettingsPage, SkillsPage and projection suites; confirm manually managed state/invalidations fail the new contract.
- [ ] **Step 3: Implement.** Add pinned `@tanstack/react-query`; one app `QueryClientProvider`; migrate each read service to typed query hooks and mutations with targeted invalidation. Move pure activity projection to the shared pure package and delete unused contract exports.

  ```ts
  const taskKeys = { all: ['tasks'] as const, detail: (id: string) => ['tasks', id] as const }
  const task = useQuery({ queryKey: taskKeys.detail(taskId), queryFn: () => api.getTask(taskId) })
  ```
- [ ] **Step 4: Run green and commit.** `pnpm typecheck && pnpm test && pnpm test:e2e:visual`; stage UI/package/lock files and commit `refactor(desktop): centralize reads with TanStack Query`.

### Task 3: 删除无消费者抽象、绑定容器和单消费者包

**Files:** Modify `apps/agent-runtime/src/composition-root.ts`, Desktop Main/Renderer composition roots, package manifests; Delete unused `apps/agent-runtime/src/projection-service.ts`, extra `CheckpointStore` adapter after consumer check; Move `packages/design-tokens/src/tokens.css` into Desktop styles; Test composition roots and `packages/design-tokens/tests/tokens.test.ts` moved/updated.

**Interfaces:** Each composition root exports a factory accepting explicit port dependencies; tests can pass fake ports without Inversify.

- [ ] **Step 1: Write boundary tests.** Assert each factory accepts fake storage, clock, model and native capability ports; assert actual LangGraph checkpoint survives a task restart; assert Desktop imports its own token stylesheet.
- [ ] **Step 2: Run red.** Run composition/checkpointer/token tests; capture existing DI and path coupling.
- [ ] **Step 3: Simplify.** Replace binding-only Inversify containers with factory parameters, remove `reflect-metadata` imports/dependencies, delete unused checkpoint/projection abstraction only after `rg` verifies no production consumer. Move design token CSS and update build paths; delete package when no second consumer exists.

  ```ts
  const runtime = createRuntime({ repositories, modelGateway, toolExecutor, checkpointer })
  // Tests pass fake ports through the same factory.
  ```
- [ ] **Step 4: Run green and commit.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; stage named files and commit `refactor: simplify composition and single-consumer packages`.

### Task 4: 诊断职责与重复追踪

**Files:** Modify `apps/agent-runtime/src/runtime-process.ts`, `apps/agent-runtime/src/{phoenix-model-observability,langsmith-observability}.ts`, `packages/observability/src/{index,otel,redaction}.ts`, Desktop log viewer clients; Test `apps/agent-runtime/tests/{langsmith-observability,model-log-projection,runtime-process}.test.ts`, `packages/observability/tests/*.test.ts`.

**Interfaces:** SQLite is task fact store; LangSmith is one model-call log source; OTel holds operational spans/metrics with task/request/call IDs.

- [ ] **Step 1: Write failing tests.** One model call produces one LangSmith record and no second Phoenix model record; disabling diagnostics or simulating backend failure preserves task result; token and sensitive payload never enter logs; Renderer bundle has no Node OTel import.
- [ ] **Step 2: Run red.** Run focused Runtime/observability tests and bundle inspection; capture duplicate tracing.
- [ ] **Step 3: Implement.** Remove Phoenix model tracing path, preserve LangSmith model log queries, restrict OTel to operations, split portable types from Node implementation imports, and propagate correlation IDs. Keep task/tool/approval facts in SQLite; send interface summaries only through OTel, without a local interface-log copy.

  ```ts
  const runtime = createRuntime({ modelObservability: langsmith, operationsTelemetry: otel })
  // Operational spans carry IDs and timing, never model input or output text.
  ```
- [ ] **Step 4: Run green and commit.** `pnpm check && pnpm test:e2e:local`; stage named files and commit `refactor(observability): separate model and operational logs`.

### Task 5: 最终集成与文档同步

**Files:** Modify `docs/superpowers/specs/2026-09-24-activity-event-order-design.md`, architecture/roadmap docs, affected OpenSpec changes/specs and `apps/desktop/e2e/local-runtime.spec.ts`.

**Interfaces:** Published architecture and OpenSpec describe one request sequence, one Runtime owner, one model log source.

- [ ] **Step 1: Add full-flow E2E.** Create two concurrent real tasks, reconnect during one, restart Runtime during a local tool, and verify task list/detail/logs reflect the durable result. Assert no production Mock fallback and no deprecated preload business method calls.
- [ ] **Step 2: Run red.** `pnpm test:e2e:local` should identify any remaining integration gaps before documentation changes.
- [ ] **Step 3: Sync docs.** Replace contradictory global-cursor-only wording, update boundary/transport table and database migration notes; reconcile active OpenSpec changes by updating their planning artifacts and sync/archive only when their own task lists are complete.

  ```text
  request sequence = display/application order
  global cursor     = durable replay position
  ```
- [ ] **Step 4: Verify and commit.** `pnpm check:all`, macOS packaged smoke for auth/native capability/diagnostics, `openspec validate` for affected changes; stage only related files and commit `docs: align architecture and validate convergence`.
