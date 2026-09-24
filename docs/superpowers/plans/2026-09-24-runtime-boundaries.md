# Runtime Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将业务请求、定义写入和本机能力接到单一 Runtime 边界，删除旧业务 RPC。

**Architecture:** Hono + Zod 提供 HTTP 控制面，现有 `ws` 承担任务流与本机能力响应；Runtime 决定任务和定义状态，Main 执行需本机权限的能力并托管进程。

**Tech Stack:** TypeScript、Hono、`@hono/node-server`、`@hono/zod-validator`、Zod、ws、Electron、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-24-architecture-convergence-design.md`

## Global Constraints

- 承接 `2026-09-24-runtime-reliability.md` 的事件协议；保留本机认证、Origin、CSP 和脱敏策略。
- Runtime 是模型、prompt、Skill 定义与任务的权威写入者；Main 仅托管与执行本机能力。
- 旧业务 RPC 只在对应 HTTP/WS 能力及回归测试通过后删除。
- 先读取 `serve-runtime-over-http`、`manage-agent-skills` 和当前未提交 diff；不能覆盖在途实现。

## Review Focus

- 无效 JSON 与字段：HTTP 返回结构化 4xx，数据未写入；Task 1。
- Renderer token/Origin 不匹配：HTTP 与 WS 一致拒绝；Task 1。
- Main 能力执行晚于取消：Runtime 不接受迟到结果为成功；Task 2。
- 重启期间 prompt/Skill 默认文件初始化被执行两次：原路径内容不被覆盖；Task 3。
- 打包后页面仍调用被删除的 preload 方法：E2E 失败而非静默 Mock 降级；Task 4。

---

## File map

`service/http-service.ts` 为路由与认证适配层；`service/websocket-service.ts` 为流入口；`stream-session-service.ts` 为任务协调；Runtime 定义存储与 Main 本机文件适配器分离。跨进程 DTO 位于 `packages/runtime-contracts`，页面只使用类型化 HTTP/WS 客户端。

### Task 1: Hono 路由、校验与安全边界

**Files:** Modify `apps/agent-runtime/src/service/http-service.ts`, `apps/agent-runtime/src/local-runtime-server.ts`, `apps/agent-runtime/package.json`, `apps/agent-runtime/src/runtime-entry.ts`; Test `apps/agent-runtime/tests/service-http.test.ts`, `apps/agent-runtime/tests/local-runtime-server.test.ts`.

**Interfaces:** Export a Hono app factory accepting existing service dependencies and returning Fetch-compatible routes; define `createModelConnectionSchema` from the current create-request DTO. Node server remains the owner of WS upgrade.

- [ ] **Step 1: Write failing tests.** For every existing route, assert method/path, valid response, Zod 400 error code, missing token 401, invalid Origin rejection, and redacted logs. Pin a route parity table before replacing the router.
- [ ] **Step 2: Run red.** `pnpm vitest run apps/agent-runtime/tests/service-http.test.ts apps/agent-runtime/tests/local-runtime-server.test.ts` must expose the new validation contract.
- [ ] **Step 3: Implement.** Add pinned Hono, Node adapter and validator dependencies. Define `zValidator('json', schema)` on write routes, centralized auth/error middleware, then mount the app on the existing HTTP server without taking over `ws` upgrades. Keep health/version policy explicit.

  ```ts
  app.post('/model-connections', zValidator('json', createModelConnectionSchema), async (context) => {
    return context.json(await service.createModelConnection(context.req.valid('json')), 201)
  })
  ```
- [ ] **Step 4: Run green and commit.** Run target tests, `pnpm typecheck`, `pnpm --filter @actiondriver/agent-runtime build`; stage route/package/lock/test files and commit `refactor(runtime): serve validated HTTP routes with Hono`.

### Task 2: 本机能力执行端口

**Files:** Modify `apps/agent-runtime/src/ports.ts`, `apps/agent-runtime/src/stream-session-service.ts`, `apps/agent-runtime/src/service/websocket-service.ts`, `apps/desktop/src/main/runtime-client-gateway.ts`, `packages/runtime-contracts/src/stream-protocol.ts`; Test `apps/agent-runtime/tests/stream-session-service.test.ts`, `apps/desktop/src/main/agent-ipc.test.ts`.

**Interfaces:** `invokeLocalCapability({invocationId,requestId,deadline,kind,input}, signal)` returns a typed result or terminal error. Runtime owns invocation status; Main owns OS execution.

- [ ] **Step 1: Write failing tests.** Assert one invocation maps to one result, cancellation aborts Main execution, late results remain diagnostic only, disconnect produces a typed unavailable error, and duplicate invocation IDs do not execute twice within one process.
- [ ] **Step 2: Run red.** Run both target suites; the port contract should fail before implementation.
- [ ] **Step 3: Implement.** Add serializable request/result schema in `packages/runtime-contracts`; wire Runtime request/timeout/cancel over existing WS control channel; Main dispatches only allowlisted Browser/Computer/file operations. Runtime records lifecycle events through the reliability plan's sequencer.

  ```ts
  type LocalCapabilityInvocation = {
    invocationId: string; requestId: string; deadline: string
    kind: 'browser' | 'computer' | 'file'; input: unknown
  }
  ```
- [ ] **Step 4: Run green and commit.** Run target suites plus `pnpm test:e2e:local`; stage named files and commit `feat(runtime): route local capabilities through Main`.

### Task 3: prompt/Skill 定义归属与幂等初始化

**Files:** Modify `apps/desktop/src/main/agent-files/agent-file-store.ts`, `apps/desktop/src/main/agent-files-ipc.ts`, `apps/agent-runtime/src/ports.ts`, `apps/agent-runtime/src/service/http-service.ts`; Add focused Runtime definition-store adapter and tests alongside it; Test `apps/desktop/src/main/agent-files/agent-file-store.test.ts`, `apps/desktop/src/main/agent-files-ipc.test.ts`.

**Interfaces:** Runtime exposes typed definition read/write commands and owns constrained file read/write decisions. `Definition` is the existing validated prompt/Skill record type, not a new generic document shape. `~/.action-driver` 原路径是唯一事实来源；默认文件仅在缺失时创建。

- [ ] **Step 1: Write failing tests.** Initialize legacy prompt/Skill files twice, assert their content and identity remain unchanged; update through Runtime and assert Main cannot independently mutate the definition; malformed file produces visible error without overwriting valid data.
- [ ] **Step 2: Run red.** Run target suites and new Runtime definition-store test; expect duplicate authority/import behavior.
- [ ] **Step 3: Implement.** Put definition validation, identity and write decisions in Runtime 的受限文件服务。原文件直接沿用，默认文件缺失时才创建；switch Renderer services to Runtime routes, then remove Main's definition write command.

  ```ts
  type DefinitionStore = {
    initialize(): Promise<void>
    save(definition: Definition): Promise<Definition>
  }
  ```
- [ ] **Step 4: Run green and commit.** Run target suites, `pnpm typecheck`, settings/skills E2E; stage named files and commit `refactor(runtime): own prompt and Skill definitions`.

### Task 4: 清退旧业务 RPC

**Files:** Modify `apps/desktop/src/main/agent-ipc.ts`, `apps/desktop/src/preload/desktop-api.ts`, `apps/desktop/src/main/index.ts`, `packages/runtime-contracts/src/index.ts`, `apps/desktop/src/renderer/src/services/desktop-task-catalog.ts`; Test adjacent `.test.ts` files and `apps/desktop/e2e/local-runtime.spec.ts`.

**Interfaces:** Renderer uses only HTTP/WS business clients; preload retains immutable connection bootstrap and Electron-only capabilities.

- [ ] **Step 1: Write failing parity test.** Enumerate old RPC business operations and assert each has a working HTTP/WS path; exercise tasks, model settings, Skill definitions, logs and cancel/resume with production assembly and no Mock fallback.
- [ ] **Step 2: Run red.** Run target IPC/client suites; any still-required RPC operation must fail parity and be migrated before deletion.
- [ ] **Step 3: Implement.** Switch remaining call sites to Runtime clients, remove only proven unused business channels/DTOs, keep process control and native permission APIs. Update interaction contract manifest and documentation with the final transport matrix.

  ```ts
  // Renderer business clients use the injected Runtime endpoint.
  const task = await runtimeHttp.getTask(taskId)
  streamClient.subscribe(handlePersistedEvent)
  ```
- [ ] **Step 4: Run green and commit.** `pnpm check && pnpm test:e2e:local`; stage named files and commit `refactor(desktop): retire business MessagePort RPC`.
