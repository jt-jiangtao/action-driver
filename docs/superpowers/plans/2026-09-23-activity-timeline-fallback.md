# Codex 风格活动时间线回归修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让真实工具流、重连和任务恢复始终显示一个可容纳 `n` 条工具的 Codex 风格活动任务，而非旧工具卡。

**Architecture:** Agent Graph 为没有显式活动更新的连续外部工具批次创建受控兜底活动，并在最终回复前结束活动。Stream Session 从事件和工具记录构建可恢复活动快照；Renderer 直接投影该过程并只渲染 `ActivityTimeline`，由该组件负责运行态、归档、原始 I/O 和结论的层级。

**Tech Stack:** TypeScript、LangGraph、Zod、Electron Renderer、React、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-23-activity-timeline-fallback-design.md`；`openspec/changes/fix-activity-timeline-fallback/`

## Global Constraints

- Runtime 是活动分组、顺序和标题的唯一事实来源；前端不得按工具类别或模型轮次猜测。
- 一个活动任务可包含 `n` 条工具及其间正文；模型显式活动更新优先，兜底标题不得暴露思维链。
- 本地原始 I/O 不以 `NODE_ENV` 区分，并沿用既有输出上限、截断和展开边界。
- 运行态扫光必须遵循 `prefers-reduced-motion`；结束态默认折叠过程且结论位于其后。
- 不修改工具权限、模型提供商协议或远程服务边界。

## Review Focus

- 多轮工具调用：同一连续阶段的两个以上工具必须共享同一 `activityId`，而不是生成多张卡。
- 显式活动更新：模型提供的标题和版本必须覆盖兜底标题，过时版本不改变既有内容。
- 快照恢复：事件被裁剪后仍必须恢复活动顺序、工具原始 I/O 与完成归档。
- 审批：`waiting_approval` 仅出现在输入框上方，批准后工具仍留在原活动内。
- 可访问性：系统启用 reduced motion 时不可保留扫光动画。

---

### Task 1: 兜底活动事件

**Files:**
- Modify: `apps/agent-runtime/src/agent-graph.ts:54-75, 260-460`
- Modify: `apps/agent-runtime/tests/agent-graph.test.ts:20-150`

**Interfaces:**
- Consumes: `ProviderToolCall`、`ModelEventObserver`、当前 `activeActivityId`。
- Produces: `activity.started` / `activity.completed` 观察事件；所有外部工具调用带同一非空 `activityId`。

- [ ] **Step 1: 写入失败测试**

在 `agent-graph.test.ts` 增加模型仅返回两个 `sandbox_fs_read` 调用、未返回 `activity_update` 的用例：断言观察到一个 `started`、一个 `completed`，并断言两条工具记录的 `payload.activityId` 相同且非空。

- [ ] **Step 2: 验证测试失败**

Run: `corepack pnpm --filter @action-driver/agent-runtime test -- agent-graph.test.ts`

Expected: FAIL，因为当前两条工具事件的 `activityId` 为 `null`，且没有兜底活动事件。

- [ ] **Step 3: 实现最小归属逻辑**

在 `LangGraphRunner` 添加内部 `ensureFallbackActivity(state, calls)`：只在存在外部调用、没有 `activeActivityId` 且本轮没有显式 `activity_update` 时生成 `activity:<taskId>:<toolRound>`，发送标题为“正在执行工具”的 `started` 事件。在 `executeTools` 将此 id 传给每个外部调用；在产生最终 `finish` 前发送同 id 的 `completed` 事件。显式活动更新继续优先且不产生第二个兜底活动。

- [ ] **Step 4: 验证定向测试通过**

Run: `corepack pnpm --filter @action-driver/agent-runtime test -- agent-graph.test.ts`

Expected: PASS，已有显式活动更新用例和新增普通工具批次用例均通过。

### Task 2: 可恢复的活动快照

**Files:**
- Modify: `packages/runtime-contracts/src/stream-protocol.ts:205-255`
- Modify: `apps/agent-runtime/src/stream-session-service.ts:310-410`
- Modify: `apps/agent-runtime/tests/stream-session-service.test.ts:740-840`

**Interfaces:**
- Consumes: 持久化 `activity.*` 和 `tool.*` 事件、工具聚合记录。
- Produces: `response.snapshot.activities`、`response.snapshot.activityTimeline`、带 `activityId` 和原始 I/O 的工具快照项。

- [ ] **Step 1: 写入失败测试**

在 `stream-session-service.test.ts` 构造事件保留过期的完成任务：已有 `activity.started`、活动内正文、关联工具和 `activity.completed`。断言 `request.resume` 的 `response.snapshot` 含一个活动、正确顺序的时间线项、工具 `activityId` 与原始输入输出。

- [ ] **Step 2: 验证测试失败**

Run: `corepack pnpm --filter @action-driver/agent-runtime test -- stream-session-service.test.ts`

Expected: FAIL，因为当前 snapshot schema 和 payload 没有活动过程字段。

- [ ] **Step 3: 扩展协议和快照构建**

为 `response.snapshot` Zod schema 添加活动列表及有序条目；在 `StreamSessionService.snapshot` 读取当前请求的活动/工具事件，按 cursor 归纳活动、正文与工具引用，并从终态工具事件或工具记录保留 `activityId`、`rawInput`、`rawOutput` 和截断标记。复用事件排序，禁止从工具类型推断顺序。

- [ ] **Step 4: 验证定向测试通过**

Run: `corepack pnpm --filter @action-driver/agent-runtime test -- stream-session-service.test.ts`

Expected: PASS，过期恢复得到可渲染活动快照，既有 snapshot 用例继续通过。

### Task 3: Renderer 快照投影

**Files:**
- Modify: `packages/contracts/src/index.ts:52-114`
- Modify: `apps/desktop/src/renderer/src/services/stream-task-projection.ts:39-105, 260-290`
- Modify: `apps/desktop/src/renderer/src/services/stream-task-projection.test.ts:180-235`

**Interfaces:**
- Consumes: 扩展后的 `response.snapshot`。
- Produces: 完整的 `TaskProjection.activities`、`activityTimeline`、活动关联工具和原始 I/O。

- [ ] **Step 1: 写入失败测试**

在 `stream-task-projection.test.ts` 增加完整活动 snapshot：包含一个活动、正文项、两条工具和原始输出。断言 `snapshot()` 保留活动标题、两条按顺序的工具引用、工具 `activityId`、原始 I/O 和任务耗时。

- [ ] **Step 2: 验证测试失败**

Run: `corepack pnpm --filter @action-driver/desktop test -- stream-task-projection.test.ts`

Expected: FAIL，因为当前 `response.snapshot` 仅映射 messages 与 tools。

- [ ] **Step 3: 实现快照映射**

扩展 `TaskProjection` 快照输入类型；在 `StreamTaskProjection.apply` 的 `response.snapshot` 分支原子替换 `activities`、`activityTimeline`、`activityDurationMs` 和完整工具字段。确保活动项引用同一 `callId`，不重复附加实时事件。

- [ ] **Step 4: 验证定向测试通过**

Run: `corepack pnpm --filter @action-driver/desktop test -- stream-task-projection.test.ts`

Expected: PASS，实时投影与 snapshot 投影都产生相同活动树。

### Task 4: 统一 Codex 任务页面

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/TaskPage.tsx:1-125`
- Modify: `apps/desktop/src/renderer/src/components/ActivityTimeline.tsx:1-105`
- Modify: `apps/desktop/src/renderer/src/styles/agent.css:200-460`
- Modify: `apps/desktop/src/renderer/src/pages/pages.test.tsx:150-240`
- Modify: `apps/desktop/src/renderer/src/components/ActivityTimeline.test.tsx:1-110`

**Interfaces:**
- Consumes: `TaskProjection.activityTimeline` 和 `activities`，包括空活动过程。
- Produces: 无旧类别卡的 Codex 风格活动行、运行尾部状态、完成归档及输入区审批条。

- [ ] **Step 1: 写入失败页面测试**

在 `pages.test.tsx` 使用带工具但没有显式活动更新的 Runtime task 投影，断言不存在“运行结束”和 `.tool-activity-card`，存在“正在思考”或“用时”及 `ActivityTimeline` 的测试标识。为 `ActivityTimeline` 添加两工具同组、归档在结论之前、reduced-motion 无动画的组件断言。

- [ ] **Step 2: 验证测试失败**

Run: `corepack pnpm --filter @action-driver/desktop test -- pages.test.tsx ActivityTimeline.test.tsx`

Expected: FAIL，因为 `TaskPage` 仍在 `activityTimeline` 缺失时渲染 `ToolActivityCards`。

- [ ] **Step 3: 实现唯一活动时间线视图**

从 `TaskPage` 移除 `ToolActivityCards` 回退，始终使用 `ActivityTimeline`；空运行过程显示尾部“正在思考”。在 `ActivityTimeline` 中将工具呈现为图标、摘要、状态和可展开控制的紧凑行；仅原始 I/O 使用灰色等宽容器。样式移除大圆角类别卡、任务编号与“运行中 / 运行结束”标题，保留审批条位于 composer 上方、扫光仅用于运行态，并加入 `prefers-reduced-motion` 覆盖。

- [ ] **Step 4: 验证组件测试通过**

Run: `corepack pnpm --filter @action-driver/desktop test -- pages.test.tsx ActivityTimeline.test.tsx`

Expected: PASS，工具任务使用 Codex 时间线，结论不进入过程归档。

### Task 5: 真实普通工具流 E2E

**Files:**
- Modify: `apps/desktop/e2e/support/fake-openai-tool-server.ts:45-165`
- Modify: `apps/desktop/e2e/tool-runtime.spec.ts:120-250`

**Interfaces:**
- Consumes: 不发送 `activity_update` 的普通模拟模型响应。
- Produces: 对真实默认工具路径、归档结构和恢复语义的端到端保证。

- [ ] **Step 1: 写入失败 E2E 断言**

在既有 `read` 模式工具流用例中断言完成后出现活动归档、展开后出现一个活动标题及工具原始 I/O，且页面不含“运行结束”与旧工具卡选择器。新增刷新/恢复断言，确认归档和结论仍存在。

- [ ] **Step 2: 验证 E2E 失败**

Run: `corepack pnpm exec playwright test apps/desktop/e2e/tool-runtime.spec.ts --grep "runs a real workspace read"`

Expected: FAIL，因为 read 模式未发送显式活动更新且当前 UI 显示旧卡。

- [ ] **Step 3: 仅为测试添加多工具普通批次**

扩展 fake provider 的普通模式，使首轮返回两个合法外部工具调用但不返回 `activity_update`；确认断言它们归属于一个活动任务，避免测试只覆盖单工具偶然路径。

- [ ] **Step 4: 验证 E2E 通过**

Run: `corepack pnpm exec playwright test apps/desktop/e2e/tool-runtime.spec.ts`

Expected: PASS，普通工具流、审批、超时、网页搜索和活动归档全部通过。

### Task 6: 全量验证与变更记录

**Files:**
- Modify: `openspec/changes/fix-activity-timeline-fallback/tasks.md`

- [ ] **Step 1: 运行格式与类型检查**

Run: `corepack pnpm format:check && corepack pnpm typecheck`

Expected: 仅在没有既存无关格式错误时通过；若存在，逐项记录而不批量改写无关文件。

- [ ] **Step 2: 运行完整测试与规范校验**

Run: `corepack pnpm test && openspec validate "fix-activity-timeline-fallback" --strict`

Expected: PASS；记录测试文件数、测试数和所有不可归因的既有失败。

- [ ] **Step 3: 更新任务状态并提交限定文件**

将完成项更新为 `- [x]`。仅暂存本计划列出的代码、测试、OpenSpec 文件和设计文档后执行：

```bash
git add apps/agent-runtime apps/desktop packages/runtime-contracts packages/contracts \
  openspec/changes/fix-activity-timeline-fallback docs/superpowers
git commit -m "fix: restore codex activity timeline"
```

Expected: 提交不包含任何既有无关工作区修改。
