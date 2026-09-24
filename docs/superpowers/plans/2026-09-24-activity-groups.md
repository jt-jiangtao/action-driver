# Activity Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按正文阶段切分工具组，并显示动态工具标题、图标、扫光和最终正文归档。

**Architecture:** Runtime 负责分组边界和安全标题。活动投影保持事件顺序，Renderer 仅根据投影与运行状态呈现。重连快照复用同一投影。

**Tech Stack:** TypeScript、LangGraph、React、Vitest、Playwright、OpenSpec。

**Spec:** `docs/superpowers/specs/2026-09-24-activity-groups-design.md`

## Global Constraints

- 任务组不能包含模型正文。
- 不增加 LLM 标题调用或新依赖。
- 活动标题和工具标题不得包含未经清洗的原始输入或输出。
- 运行态动画遵循 `prefers-reduced-motion`。

## Review Focus

- 纯文本回复：只有正文与用时，没有空工具组。
- 正文、多个工具、正文、单个工具：两个工具组，顺序稳定。
- 连续工具跨模型请求但没有正文：保持一个组。
- 失败与取消后：标题和扫光进入终态。
- 刷新及重连：过程归档与最终正文不重复、不丢失。

---

### Task 1: Runtime 分组与标题

**Files:** `apps/agent-runtime/src/agent-graph.ts`、`apps/agent-runtime/src/tool-activity.ts`、对应测试。

**Interfaces:** 消费 `ModelGatewayEvent` 与工具调用；产生稳定 `activityId`、单调 `titleRevision` 和安全工具标题。

- [x] 写失败测试，断言正文第一次出现前无组、正文隔开的工具创建不同组、连续工具共享组。
- [x] 运行定向 Vitest，确认失败原因是旧的组生命周期。
- [x] 实现最小状态迁移与 Runtime 标题规则，并验证定向测试。

### Task 2: 事件投影与快照

**Files:** `packages/contracts/src/index.ts`、`packages/runtime-contracts/src/stream-protocol.ts`、`apps/agent-runtime/src/stream-session-service.ts`、`apps/desktop/src/renderer/src/services/stream-task-projection.ts`、对应测试。

**Interfaces:** 工具事件及快照携带受限工具标题；正文片段和任务组保留 cursor 顺序。

- [x] 写失败测试，断言工具标题从实时事件到重连快照一致，且连续组与独立文本保序。
- [x] 运行定向 Vitest，确认旧投影缺少标题或边界。
- [x] 扩展最小契约和投影，重新运行定向测试。

### Task 3: 活动区显示

**Files:** `apps/desktop/src/renderer/src/components/ActivityTimeline.tsx`、`apps/desktop/src/renderer/src/pages/TaskPage.tsx`、`apps/desktop/src/renderer/src/styles/agent.css`、对应组件测试。

**Interfaces:** 消费活动时间线、工具标题、状态和最终消息；呈现组外正文、动态组图标、等待状态及归档。

- [x] 写失败组件测试，覆盖等待状态、交替文本与工具组、运行扫光、完成后仅最终正文展开。
- [x] 运行定向 Vitest，确认失败由现有 UI 行为造成。
- [x] 实现最小呈现和样式，运行定向测试。

### Task 4: 桌面验证与收尾

**Files:** `apps/desktop/e2e/tool-runtime.spec.ts`、`apps/desktop/e2e/support/fake-openai-tool-server.ts`、OpenSpec 任务文件。

**Interfaces:** 真实桌面通过 fake 模型流验证实时与重连行为。

- [x] 扩展桌面 E2E 覆盖纯文本与交替工具组。
- [x] 运行完整 `corepack pnpm check`、受影响桌面 E2E、`openspec validate add-inline-tool-activity-cards --strict`。
- [x] 复核 `git diff` 和任务完成情况，再提交。
