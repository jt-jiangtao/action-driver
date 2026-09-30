# Tool Runtime 与只读 Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让真实 OpenAI-compatible 模型通过现有 WebSocket 会话调用工作区只读工具，并在工具执行后继续生成最终 Markdown，同时完整记录审批、生命周期和日志。

**Architecture:** 在 `runtime-contracts` 定义 provider-neutral Tool 协议，在 `agent-runtime` 建立 Registry、Policy、Invocation Service 与 Sandbox Executor，在 `model-connections` 聚合 Chat Completions 的流式 tool calls，由 LangGraph 显式运行模型—工具循环。工具事件通过现有 WebSocket 独立传输，Renderer 只投影审批状态，不把工具进度拼入助手正文。

**Tech Stack:** TypeScript 5.9、Zod 4、LangGraph JS、OpenAI Node SDK、Node `child_process.spawn`、better-sqlite3、WebSocket、React 19、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-23-tool-runtime-sandbox-design.md`；规范性细节见 `openspec/changes/add-tool-runtime-sandbox/`。

## Global Constraints

- 所有工具输入在执行前 MUST 通过注册 schema 校验。
- Sandbox MUST 只读、工作区范围、默认无网络、无宿主秘密；不得宣称强 OS 隔离。
- `shell.run` MUST 使用 `shell: false`，只允许 `rg/head/tail/wc` 的参数白名单，并要求单次审批。
- 最终正文只来自模型 final text；工具状态只进入 `tool.*` 事件、审批条与日志。
- 每任务最多 8 个工具轮次、16 个工具调用；文件和聚合输出默认上限 1 MiB，命令默认超时 10 秒。
- 保留现有无工具文本流的请求体、Markdown 渲染、同会话续问、滚动和日志控制面排除行为。
- 当前工作区已有未提交修改；实现时只触碰本计划列出的相关文件，不清理或覆盖其他改动。

## Review Focus

- 分片 tool arguments 可能按任意边界拆分；聚合必须按 index 且只在终态解析 JSON。
- 符号链接和绝对路径可能逃逸 workspace；文件和命令路径必须经过 realpath containment。
- 审批可能重放或参数被替换；决定必须绑定 `taskId + callId + argumentsHash`。
- 取消与超时可能发生在子进程退出前；不得把“已请求取消”当成 completed。
- 工具事件重连可能重复；Renderer 和 Runtime 必须按 eventId/callId/sequence 幂等应用。

---

### Task 1: Tool 公共协议、数据库和 Registry

**Files:**
- Create: `packages/runtime-contracts/src/tool-protocol.ts`
- Modify: `packages/runtime-contracts/src/index.ts`
- Test: `packages/runtime-contracts/tests/tool-protocol.test.ts`
- Modify: `apps/agent-runtime/src/database.ts`
- Modify: `apps/agent-runtime/src/ports.ts`
- Modify: `apps/agent-runtime/src/repositories.ts`
- Test: `apps/agent-runtime/tests/database.test.ts`
- Test: `apps/agent-runtime/tests/repositories.test.ts`
- Create: `apps/agent-runtime/src/tool-registry.ts`
- Test: `apps/agent-runtime/tests/tool-registry.test.ts`

**Interfaces:**
- Produces: `ToolDefinition`, `ToolCall`, `ToolEvent`, `ToolError`, `ToolDecision`, `ToolExecutor`, `ToolRegistry.resolveModelName()`、`toolInvocations` repository。
- Consumes: 现有 `RuntimeEventRecord`、Zod、SQLite migration 约定。

- [ ] **Step 1: 为协议解析和 Registry 冲突写失败测试**

```ts
expect(() => parseToolCall({
  callId: 'call-1', providerCallId: 'provider-1', modelName: 'sandbox_fs_read',
  arguments: { path: 'README.md' }
})).not.toThrow()
expect(() => registry.register(readTool)).not.toThrow()
expect(() => registry.register({ ...otherTool, modelName: readTool.modelName }))
  .toThrow('TOOL_MODEL_NAME_CONFLICT')
```

- [ ] **Step 2: 运行目标测试并确认因缺少协议与 Registry 失败**

Run: `pnpm vitest run packages/runtime-contracts/tests/tool-protocol.test.ts apps/agent-runtime/tests/tool-registry.test.ts`

Expected: FAIL，提示模块或导出不存在。

- [ ] **Step 3: 实现最小公共类型与 Registry**

```ts
export type ToolDefinition = {
  id: string
  version: number
  modelName: string
  description: string
  inputSchema: Record<string, unknown>
  risk: 'low' | 'medium' | 'high'
  sideEffects: { filesystem: 'none' | 'read' | 'write'; network: boolean }
  timeoutMs: number
}

export interface ToolExecutor {
  execute(call: ToolCall, signal?: AbortSignal): AsyncIterable<ToolExecutorEvent>
}
```

Registry 注册时检查内部 id/version、模型名唯一、schema 为 object 且可 JSON 序列化；未知名称抛出带 code 的 `TOOL_UNAVAILABLE`。

- [ ] **Step 4: 为 v6 migration 和仓储写失败测试**

```ts
await repositories.toolInvocations.save({
  id: 'call-1', providerCallId: 'provider-1', taskId: 'task-1', toolId: 'sandbox.fs.read',
  toolVersion: 1, argumentsHash: 'sha256:test', input: { path: 'README.md' },
  decision: 'allow', status: 'completed', output: { content: 'ok' }, error: null,
  createdAt: now, updatedAt: now
})
expect(await repositories.toolInvocations.listByTask('task-1')).toHaveLength(1)
```

- [ ] **Step 5: 添加只前进 migration 与 repository**

新增 `tool_invocations` 表，包含 provider call id、tool id/version、arguments hash、decision、status、JSON input/output/error 和时间戳；为 `(task_id, created_at, id)` 建索引，并对 JSON 调用 `assertPersistablePayload`。

- [ ] **Step 6: 运行协议、数据库、仓储和类型检查**

Run: `pnpm vitest run packages/runtime-contracts/tests/tool-protocol.test.ts apps/agent-runtime/tests/tool-registry.test.ts apps/agent-runtime/tests/database.test.ts apps/agent-runtime/tests/repositories.test.ts && pnpm --filter @action-driver/runtime-contracts typecheck && pnpm --filter @action-driver/agent-runtime typecheck`

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/runtime-contracts apps/agent-runtime/src/database.ts apps/agent-runtime/src/ports.ts apps/agent-runtime/src/repositories.ts apps/agent-runtime/src/tool-registry.ts apps/agent-runtime/tests
git commit -m "feat: define tool runtime contracts"
```

### Task 2: OpenAI-compatible 流式 Tool Calling

**Files:**
- Modify: `packages/model-connections/src/types.ts`
- Modify: `packages/model-connections/src/service.ts`
- Modify: `packages/model-connections/src/provider-adapters.ts`
- Test: `packages/model-connections/tests/provider-adapters.test.ts`
- Test: `packages/model-connections/tests/model-connection-service.test.ts`
- Modify: `apps/agent-runtime/src/ports.ts`
- Modify: `apps/agent-runtime/src/model-connections/model-gateway.ts`
- Test: `apps/agent-runtime/tests/model-gateway.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition`。
- Produces: `ModelTerminal = { kind: 'final-text'; ... } | { kind: 'tool-calls'; calls: ProviderToolCall[] }` 与支持 tool/result 的领域消息。

- [ ] **Step 1: 写分片聚合失败测试**

```ts
chunks.push(
  { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'p1', function: { name: 'sandbox_fs_read', arguments: '{"pa' } }] }, finish_reason: null }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"README.md"}' } }] }, finish_reason: 'tool_calls' }] }
)
expect(await collect(adapter.stream(input))).toContainEqual({
  kind: 'end', result: { kind: 'tool-calls', calls: [{ providerCallId: 'p1', modelName: 'sandbox_fs_read', arguments: { path: 'README.md' } }] }
})
```

同时覆盖两个 index 交错、非法 JSON、缺失 id/name、无工具时请求体不出现 `tools`。

- [ ] **Step 2: 运行 provider tests 并确认失败**

Run: `pnpm vitest run packages/model-connections/tests/provider-adapters.test.ts`

Expected: FAIL，因为当前类型只支持文本 delta。

- [ ] **Step 3: 扩展 provider-neutral 类型和请求映射**

```ts
export type ModelInputMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'assistant'; toolCalls: ProviderToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string }
```

只有 `tools.length > 0` 时添加 OpenAI `tools` 与 `tool_choice: 'auto'`；tool-call 终态不要求 assistant text。

- [ ] **Step 4: 扩展 ModelGateway 的存储与日志测试**

断言第一轮工具请求和第二轮 tool result 都保存为独立 `model_calls`，请求中不存在 API key，最终正文仍走现有 `content/end`。

- [ ] **Step 5: 实现 Gateway 映射并运行相关测试**

Run: `pnpm vitest run packages/model-connections/tests apps/agent-runtime/tests/model-gateway.test.ts && pnpm --filter @action-driver/model-connections typecheck`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/model-connections apps/agent-runtime/src/ports.ts apps/agent-runtime/src/model-connections/model-gateway.ts apps/agent-runtime/tests/model-gateway.test.ts
git commit -m "feat: support streamed model tool calls"
```

### Task 3: Policy、Invocation 生命周期与聚合日志

**Files:**
- Create: `apps/agent-runtime/src/tool-policy.ts`
- Create: `apps/agent-runtime/src/tool-invocation-state-machine.ts`
- Create: `apps/agent-runtime/src/tool-output-collector.ts`
- Create: `apps/agent-runtime/src/tool-invocation-service.ts`
- Test: `apps/agent-runtime/tests/tool-policy.test.ts`
- Test: `apps/agent-runtime/tests/tool-invocation-state-machine.test.ts`
- Test: `apps/agent-runtime/tests/tool-invocation-service.test.ts`
- Modify: `apps/agent-runtime/src/service/logs.ts`
- Test: `apps/agent-runtime/tests/service-logs.test.ts`

**Interfaces:**
- Consumes: Tool Registry、repository、`InteractionLogRecorder`。
- Produces: `ToolInvocationService.execute(call, context, signal)`、`approve()`、`reject()`、聚合 Tool events。

- [ ] **Step 1: 写 Policy 与状态机失败测试**

```ts
expect(policy.decide(readDefinition, readCall)).toEqual({ kind: 'allow' })
expect(policy.decide(shellDefinition, shellCall)).toMatchObject({ kind: 'require_approval' })
expect(() => machine.transition('completed')).toThrow('INVALID_TOOL_TRANSITION')
```

- [ ] **Step 2: 实现 discover/call 双阶段 Policy 和状态机**

状态只允许：

```ts
proposed -> waiting_approval | queued | failed | cancelled
waiting_approval -> queued | cancelled
queued -> running | cancelled
running -> completed | failed | cancelled
```

- [ ] **Step 3: 写 Invocation Service 的 approval/hash/timeout/cancel 测试**

```ts
const pending = service.execute(shellCall, context, signal)
await service.approve({ taskId, callId, argumentsHash })
await expect(pending).resolves.toMatchObject({ status: 'completed' })
await expect(service.approve({ taskId, callId, argumentsHash: 'changed' }))
  .rejects.toThrow('TOOL_APPROVAL_STALE')
```

- [ ] **Step 4: 实现 Invocation Service 与 output collector**

每次转移以 invocation + runtime event 原子保存；collector 保持内容顺序，合计 1 MiB 后取消 executor 并返回 `SANDBOX_OUTPUT_LIMIT`。接口日志只在调用开始时创建一次，在终态完成一次。

- [ ] **Step 5: 验证日志控制面排除**

新增测试确保 `action-driver:log:list` 不进入 interaction store，tool content 分片不会增加接口日志条数。

- [ ] **Step 6: 运行目标测试与类型检查**

Run: `pnpm vitest run apps/agent-runtime/tests/tool-policy.test.ts apps/agent-runtime/tests/tool-invocation-state-machine.test.ts apps/agent-runtime/tests/tool-invocation-service.test.ts apps/agent-runtime/tests/service-logs.test.ts && pnpm --filter @action-driver/agent-runtime typecheck`

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/agent-runtime/src/tool-* apps/agent-runtime/src/service/logs.ts apps/agent-runtime/tests/tool-* apps/agent-runtime/tests/service-logs.test.ts
git commit -m "feat: execute policy-gated tool calls"
```

### Task 4: LangGraph 有界工具循环

**Files:**
- Modify: `apps/agent-runtime/src/agent-graph.ts`
- Modify: `apps/agent-runtime/src/ports.ts`
- Modify: `apps/agent-runtime/src/composition-root.ts`
- Test: `apps/agent-runtime/tests/agent-graph.test.ts`
- Test: `apps/agent-runtime/tests/deterministic-scenarios.test.ts`
- Test: `apps/agent-runtime/tests/composition-root.test.ts`

**Interfaces:**
- Consumes: `ModelTerminal`、Tool Registry、Tool Invocation Service。
- Produces: 最终 `AgentGraphResult`，其中工具输出只作为下一轮模型消息。

- [ ] **Step 1: 写完整循环失败测试**

Fake model 第一次返回 `sandbox_fs_read`，fake executor 返回 README 内容，第二次 model 断言收到匹配 `toolCallId` 的 tool result 后返回 `**done**`；最终断言 output 只有 `**done**`。

- [ ] **Step 2: 写多调用、预算和取消失败测试**

覆盖同响应 index 0/1 串行顺序、8 轮后失败、16 call 后失败、执行中 abort 等待 executor 终态。

- [ ] **Step 3: 扩展 Graph State 与节点**

```ts
toolRound: Annotation<number>({ reducer: replace, default: () => 0 })
toolCallCount: Annotation<number>({ reducer: replace, default: () => 0 })
pendingToolCalls: Annotation<ProviderToolCall[]>({ reducer: replace, default: () => [] })
modelMessages: Annotation<ModelInputMessage[]>({ reducer: replace, default: () => [] })
```

将 `model -> tools -> model` 设为显式条件边；不通过递归函数隐藏 checkpoint。

- [ ] **Step 4: 组合根注入真实 Tool Runtime**

local 模式注册真实 Registry/Policy/Invocation；测试模式注入 deterministic executors。不得让 React 或 model adapter 直接 new executor。

- [ ] **Step 5: 运行 graph、scenario、composition 测试**

Run: `pnpm vitest run apps/agent-runtime/tests/agent-graph.test.ts apps/agent-runtime/tests/deterministic-scenarios.test.ts apps/agent-runtime/tests/composition-root.test.ts`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/agent-runtime/src/agent-graph.ts apps/agent-runtime/src/ports.ts apps/agent-runtime/src/composition-root.ts apps/agent-runtime/tests
git commit -m "feat: run bounded model tool loop"
```

### Task 5: 工作区只读 Sandbox

**Files:**
- Create: `apps/agent-runtime/src/sandbox/path-guard.ts`
- Create: `apps/agent-runtime/src/sandbox/file-tools.ts`
- Create: `apps/agent-runtime/src/sandbox/shell-tool.ts`
- Create: `apps/agent-runtime/src/sandbox/index.ts`
- Test: `apps/agent-runtime/tests/sandbox-path-guard.test.ts`
- Test: `apps/agent-runtime/tests/sandbox-file-tools.test.ts`
- Test: `apps/agent-runtime/tests/sandbox-shell-tool.test.ts`
- Modify: `apps/agent-runtime/src/runtime-process.ts`
- Test: `apps/agent-runtime/tests/runtime-process.test.ts`

**Interfaces:**
- Produces: `createSandboxTools({ workspaceRoot, spawnProcess, limits })`。
- Consumes: ToolDefinition/Executor、Runtime 启动配置。

- [ ] **Step 1: 写路径逃逸矩阵测试**

使用临时工作区覆盖 `README.md`、`nested/file.txt`、`../outside.txt`、指向内部和外部的 symlink；断言外部和绝对路径为 `SANDBOX_PATH_DENIED`。

- [ ] **Step 2: 实现 PathGuard**

```ts
export interface PathGuard {
  resolveExisting(relativePath: string): Promise<{ absolutePath: string; relativePath: string }>
}
```

先拒绝 absolute/空/NUL，再 `resolve` + `realpath`，最后用带分隔符的 root containment 判断。

- [ ] **Step 3: 写并实现 fs.list/fs.read 测试**

列表只返回直接子项并按相对路径排序；读取返回 `{ content, encoding: 'utf-8', range, size, truncated }`，超过 1 MiB 截断。

- [ ] **Step 4: 写 shell 参数白名单和进程控制失败测试**

覆盖允许 `rg -n pattern src`，拒绝 `curl`、`sh -c`、`rg --pre`、`../`、`|` 字符作为语义参数、秘密 env、超时和输出超限。

- [ ] **Step 5: 实现 shell executor**

```ts
spawn(executablePath, validatedArgs, {
  shell: false,
  cwd: workspaceRoot,
  env: { PATH: trustedPath, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
  stdio: ['ignore', 'pipe', 'pipe']
})
```

只从固定可信路径解析 `rg/head/tail/wc`；取消时先 TERM，短宽限后 KILL，并等待 close 后确定终态。

- [ ] **Step 6: 在 Runtime 启动配置注入 workspaceRoot 并注册工具**

缺少或不存在 workspaceRoot 时 Runtime 明确启动失败，不回退到用户 HOME 或进程 cwd。

- [ ] **Step 7: 运行 Sandbox 与 Runtime tests**

Run: `pnpm vitest run apps/agent-runtime/tests/sandbox-*.test.ts apps/agent-runtime/tests/runtime-process.test.ts`

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add apps/agent-runtime/src/sandbox apps/agent-runtime/src/runtime-process.ts apps/agent-runtime/tests
git commit -m "feat: add readonly workspace sandbox"
```

### Task 6: WebSocket 审批与 Renderer 投影

**Files:**
- Modify: `packages/runtime-contracts/src/stream-protocol.ts`
- Test: `packages/runtime-contracts/tests/stream-protocol.test.ts`
- Modify: `apps/agent-runtime/src/service/websocket-service.ts`
- Modify: `apps/agent-runtime/src/stream-session-service.ts`
- Test: `apps/agent-runtime/tests/service-websocket.test.ts`
- Test: `apps/agent-runtime/tests/stream-session-service.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/desktop/src/renderer/src/services/renderer-stream-client.ts`
- Modify: `apps/desktop/src/renderer/src/services/stream-task-projection.ts`
- Create: `apps/desktop/src/renderer/src/components/ToolApprovalBar.tsx`
- Test: `apps/desktop/src/renderer/src/components/ToolApprovalBar.test.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/TaskPage.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/agent.css`

**Interfaces:**
- Produces: `approveTool(callId, argumentsHash)`、`rejectTool(callId, argumentsHash)`、`ToolInvocationProjection[]`。
- Consumes: Tool events 和 invocation service。

- [ ] **Step 1: 写 stream schema 与鉴权失败测试**

```ts
parseStreamClientEvent({
  type: 'tool.approve', protocol: STREAM_PROTOCOL, eventId, createdAt,
  requestId, taskId, callId, argumentsHash
})
```

断言鉴权前发送被 1008 关闭，未知/终态 call 被结构化拒绝，`session.ready.capabilities` 包含 approve/reject。

- [ ] **Step 2: 实现服务端审批控制和 tool.* 重放**

Tool events 使用自身 `callSequence`，同时保留持久化 cursor；`request.resume` 可重放等待审批与终态。approve/reject 必须委托 Invocation Service，而不是在 WebSocket 层直接改状态。

- [ ] **Step 3: 扩展 Renderer client 与任务投影**

```ts
export type ToolInvocationProjection = {
  callId: string
  toolId: string
  summary: string
  argumentsHash: string
  status: 'waiting_approval' | 'running' | 'completed' | 'failed' | 'cancelled'
}
```

Projection 只更新 `task.tools`，不得修改 assistant message content。

- [ ] **Step 4: 先写审批条组件测试**

断言长命令 `text-overflow: ellipsis` 可通过 title/accessible name 查看完整内容；waiting 状态有两个按钮；点击后 loading 并禁用重复操作；终态折叠；Tab 顺序正确。

- [ ] **Step 5: 实现紧凑审批条并接入 TaskPage**

组件位于 `ConversationViewport` 与固定底部 `AgentComposer` 之间，不改变 composer 锚定底部和 `conversation-body` 的 flex 滚动关系；没有等待项时不占高度。

- [ ] **Step 6: 运行协议、服务、Renderer 测试和 typecheck**

Run: `pnpm vitest run packages/runtime-contracts/tests/stream-protocol.test.ts apps/agent-runtime/tests/service-websocket.test.ts apps/agent-runtime/tests/stream-session-service.test.ts apps/desktop/src/renderer/src/services/stream-task-projection.test.ts apps/desktop/src/renderer/src/components/ToolApprovalBar.test.tsx && pnpm typecheck`

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/runtime-contracts packages/contracts apps/agent-runtime/src/service/websocket-service.ts apps/agent-runtime/src/stream-session-service.ts apps/agent-runtime/tests apps/desktop/src/renderer/src
git commit -m "feat: approve tool calls over websocket"
```

### Task 7: 真实垂直闭环、日志和最终验证

**Files:**
- Create: `apps/desktop/e2e/tool-runtime.spec.ts`
- Modify: `apps/agent-runtime/tests/service-logging.test.ts`
- Modify: `apps/agent-runtime/tests/model-log-projection.test.ts`
- Modify: `apps/desktop/e2e/local-runtime.spec.ts`
- Modify: `openspec/changes/add-tool-runtime-sandbox/tasks.md`

**Interfaces:**
- Consumes: 全部前序接口。
- Produces: 可重复的假上游 E2E、真实模型 smoke 记录和完成的 OpenSpec checklist。

- [ ] **Step 1: 建立假 OpenAI-compatible tool-call 上游**

第一次请求断言包含 `sandbox_fs_read` 并分片返回 tool call；第二次请求断言包含 provider call id 对应的 tool result，再返回 Markdown `## 已读取`。测试不能直接注入最终 UI 数据。

- [ ] **Step 2: 编写 fs.read 自动允许 E2E**

通过真实页面选择模型并发送“读取 README 的第一段”，断言 WebSocket、真实 Sandbox、第二轮模型请求、最终 Markdown、输入框固定底部和无右侧 Browser 面板。

- [ ] **Step 3: 编写 shell 审批 E2E**

假模型请求 `rg`；在点击前断言未 spawn，点击“允许一次”后断言执行并最终回答；另覆盖拒绝、任务取消和重连后审批条恢复。

- [ ] **Step 4: 验证两层日志**

断言接口层每个 tool call 恰好一条聚合日志，模型层包含两轮请求/响应，查询日志不生成 `action-driver:log:list`，正文不含“执行中/正在读取”等内部进度。

- [ ] **Step 5: 运行分组测试**

Run: `pnpm vitest run packages/runtime-contracts packages/model-connections apps/agent-runtime apps/desktop/src/renderer`

Expected: PASS。

- [ ] **Step 6: 运行构建与 E2E**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm exec playwright test apps/desktop/e2e/tool-runtime.spec.ts`

Expected: 全部 PASS；按用户既定要求，不执行 Figma 校验。

- [ ] **Step 7: 运行真实模型 smoke**

使用已保存且测试成功的 OpenAI-compatible 连接发送一个必须读取工作区文件的问题。验证真实 provider 返回 tool call；若不支持，记录 `TOOL_PROTOCOL_UNSUPPORTED` 和安全化响应，不切换 Mock、不伪造成功。

- [ ] **Step 8: 更新 OpenSpec tasks 并提交**

```bash
git add apps/desktop/e2e apps/agent-runtime/tests openspec/changes/add-tool-runtime-sandbox/tasks.md
git commit -m "test: verify sandbox tool call flow"
```
