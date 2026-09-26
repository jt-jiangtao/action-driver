## Why

任务页在模型流式输出时，`StreamTaskProjection` 每 75ms 推送一次任务快照，每次推送都会：在 `snapshot()` 与 `DesktopAgentAdapter.emit()` 中各深拷贝一次整个任务；由 `App` 的 `setTask` 触发整棵组件树（含侧边栏）重渲染；并对**所有**历史消息重新执行 Markdown 渲染。渲染成本随对话长度线性增长，长对话明显卡顿。这是前端优化 13 项中的第 1、2、12 项，作为 4 个子项目中的第一个落地。

## What Changes

- 新增按 services 实例创建的 zustand 任务 store，持有当前任务并订阅 `agentSessionRepository`；`App` 不再以 `useState` 持有任务，流式更新只让订阅了任务的组件重渲染。
- 任务投影改为不可变数据并做结构共享：去掉快照与分发路径上的 `structuredClone`，修正唯一的原地修改；activity 归约器只复制被改动的活动组。
- 消息、Markdown、工具行、活动组按引用跳过重渲染；历史轮次抽成独立的记忆化组件。
- 新增渲染次数测试与不可变性测试。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `agent-task-experience`: 新增「流式输出期间只重渲染变化内容」的性能要求。

## Impact

- 渲染进程：`App.tsx`、`pages/TaskPage.tsx`、`components/Conversation.tsx`、`components/agent/*`、`components/MarkdownContent.tsx`、`components/ActivityTimeline.tsx`、`services/stream-task-projection.ts`、`services/desktop-agent-adapter.ts`、新增 `stores/task-store.ts`。
- 共享包：`packages/activity-projection` 归约器改为按需复制。
- 依赖：`@actiondriver/desktop` 新增运行时依赖 `zustand`。
- 不改变任何对外契约、IPC、Runtime 协议或页面视觉。

## Battle Status

- 类型：架构（渲染进程状态所有权与依赖）。
- 状态：**Battle 已裁决**（2026-09-26）。用户要求 13 项前端优化全部处理，拆为 4 个子项目依次推进，本变更为子项目 1。
- 虚拟列表（第 2 项）：Agent 建议先做本变更再按 200 条消息的渲染耗时决定；用户裁决**本轮不引入**。
- 状态管理（第 12 项）：Agent 推荐基于现有 `subscribe` 的 `useSyncExternalStore`（零新依赖）；用户**覆盖为 zustand**，接受新增一个运行时依赖。
- 其余相关裁决（属后续子项目，此处仅记录）：渲染端 zod 保留校验只做瘦身；深色模式推迟，本轮只做颜色 token 化。
