## Context

参见 `proposal.md` 的 Why。现状数据流：Runtime 流事件 → `RendererStreamClient` → `DesktopAgentAdapter.handleStreamEvent` → `StreamTaskProjection.apply`（文本增量按 75ms 合批）→ `onChange(snapshot())`（深拷贝）→ `emit`（再深拷贝）→ `App` 的 `setTask` → `TaskPage` 全量重渲染。投影内部大多已用展开语法更新，但 `response.content` 分支对上一个文本块做了 `last.text += delta` 的原地修改；`reduceActivityProjection` 每个事件都复制全部活动组；`TaskPage` 每次渲染为历史轮次重新拼装 `activityTask` 对象，`ConversationMessages` 以内联 `[]` 作为默认工具列表。组件中没有任何 `memo`。

## Goals / Non-Goals

**Goals**

- 流式输出期间，未变化的消息、历史轮次和活动组不重渲染，Markdown 只重新渲染变化的文本块。
- 流式更新不再让 `App`、侧边栏和首页重渲染。
- 任务快照不可变，分发路径不再深拷贝。

**Non-Goals**

- 不引入虚拟列表（已裁决）。
- 不改变视觉、交互、IPC 或 Runtime 协议。
- 不处理包体积、样式、ErrorBoundary（后续子项目）。

## Decisions

### 1. 任务状态由 zustand store 持有

新增 `stores/task-store.ts`：`createTaskStore(services)` 创建 vanilla store，状态为 `activeTask: TaskProjection | null`，动作为 `open(task)`、`present(task)`、`clear()`；创建时订阅 `agentSessionRepository.subscribe`，只接受与当前任务同 id 的投影。store 随 services 实例创建并经 `AppServicesProvider` 下发，测试可注入独立实例。组件通过 `useTaskStore(selector)` 订阅；`App` 只订阅 `activeTask?.id`，回调在调用时读 `getState()`，因此流式更新不会让 `App` 重渲染。`useComputerUseGuidance` 与恢复运行中任务流的副作用只订阅所需字段（id、status、是否含 `computer.*` 工具），比较函数使用 zustand 的 `useShallow`。

- 替代方案：基于现有 `subscribe` 与 React `useSyncExternalStore` 自建 store，零新依赖、代码量相当（Agent 推荐）。
- 裁决：用户选择 zustand。理由：selector 与浅比较开箱即用，写法统一。

### 2. 投影不可变与结构共享

`StreamTaskProjection.snapshot()` 直接返回内部不可变对象，`DesktopAgentAdapter.emit()` 与 `getTask()` 不再 `structuredClone`。约束：投影内部只能以展开语法生成新对象，MUST NOT 修改已发出的对象；`last.text += delta` 改为替换为新的文本块对象；所有 `delete this.task.preparingToolName` 均只作用于刚展开出的新对象（逐处核对）。`attach()` 与缓冲事件保留一次性拷贝，隔离外部传入的数据。

- 替代方案：保留深拷贝，只在组件层做深比较（如 `isEqual`）。实现简单，但每次更新仍有两次整任务深拷贝与一次整树深比较，成本仍随对话长度增长，未采用。

### 3. activity 归约器按需复制

`reduceActivityProjection` 只复制被事件改动的活动组及其 `items`，其余活动组、`timeline` 未变时保留原引用；`toolActivityIds`、`textPhases` 仅在写入时复制。归约器已有的测试全部保留，并新增「未改动的活动组保持引用」断言。

### 4. 渲染层按引用跳过

- `memo` 包裹 `UserMessage`、`AgentResponse`、`MarkdownContent`、`ToolRow` 与活动组组件；`MarkdownContent` 以 `useMemo` 按 `content` 缓存 `markdown.render` 结果。
- `ConversationMessages` 使用模块级常量空数组代替内联 `[]`。
- `TaskPage` 的历史轮次抽成 `PriorTurn` 组件并 `memo`，入参为该轮的 `turn`、`activity` 与稳定回调；`activityTask`、去重后的回复在组件内 `useMemo` 计算，不再依赖整个 `task` 对象（只取所需字段）。
- `App` 传给 `TaskPage` 的内联回调（暂停、继续、接管、确认、中断）改为 `useCallback`，并从 store 读取当前任务。

### 5. 测试

- 渲染次数：构造 100 条历史消息的任务，向最后一条连续推送 50 个文本增量，使用 React `Profiler` 与 `markdown.render` 计数断言：历史消息组件渲染次数不增加，Markdown 只重新渲染最后一条消息的文本块。
- 不可变性：在测试中对每个发出的快照做深度冻结，跑完 `response.start → content × N → tool.* → activity.* → response.end` 全流程，任何原地修改都会抛错。
- store：订阅过滤（只接受当前任务）、`open/present/clear` 行为、`App` 在流式更新期间不重渲染。
- 现有 `stream-task-projection`、`desktop-agent-adapter`、`activity-projection`、`App`、`TaskPage`、`ActivityTimeline` 测试全部保持通过。

## Risks / Trade-offs

- [遗漏的原地修改会在共享引用后污染旧快照、导致界面不刷新] → 不可变性测试深度冻结所有快照；归约器与投影改动逐处核对。
- [memo 依赖稳定引用，任一上游重新创建对象都会让优化失效且不报错] → 渲染次数测试把「不重渲染」固化为断言。
- [用户覆盖：选择 zustand 而非零依赖方案] → 接受新增运行时依赖及其升级维护成本；Agent 无法联网安装，需用户执行 `pnpm --filter @actiondriver/desktop add zustand`。
- [验证依赖用户] → Agent 的 shell 无法运行 macOS 版 `node_modules`，每一批改动由用户运行定向测试与 `pnpm typecheck` 并回传结果。
