## Why

上一轮只读审查（本回合已用真实快照与微基准复核）确认流式接入与任务页渲染链路的分层方向正确，但仍有三类问题：投影中唯一违反既有「快照不可变、只能以展开语法生成新对象」约定的写法；可量化的流式渲染成本（每条流式消息在每个 75ms 合并 tick 都整段重解析 Markdown 并重建整段 DOM，任务页每 tick 还要重算 O(历史) 的派生视图）；以及「谁来渲染什么」的归属分散在投影、`activity-mirror`、`AgentResponse`、`ActivityTimeline`、`TaskPage` 五处，同一生图工具常量与状态白名单重复 5 次、定序去重账本与任务状态各有两份。这些问题都在 renderer 内部的桌面应用代码中，但整改会改动组件契约、模块职责与状态归属，因此必须先完成 Battle 再进入 OpenSpec 规划与实施。

## What Changes

本变更已由用户于 2026-09-30 裁决为**方案 A「一次到位」**：以下条目全部保留并在同一 change 内实施（Agent 原推荐方案 B 被覆盖，代价记录在 `design.md` 的 Battle 结论与 Risks / Trade-offs）。

- **已核实并建议先行（P1，低风险、输出等价）**
  - 把 `stream-task-projection.ts` 中两处 `this.task.pendingAppApproval = …` 的原地写法改为对象替换，与同文件其他分支及 2026-09-26 已裁决的不可变约定一致，并补一条覆盖审批路径的真实快照回归测试。
  - `MarkdownContent` 改为按顶层块渲染并对已闭合块缓存渲染结果，使单个流式消息每个 tick 只重新解析尾部活动块、只更新尾部块的 DOM；`useScrollFade` 的重查依赖随之收窄。
  - `TaskPage` 把正文/活动/可见性派生计算抽成纯选择器，并让输入区只订阅所需字段，使输入区不随流式 tick 重渲染。
  - 把生图工具 ID 与「进行中/已完成」判定收进共享常量并删除重复字面量。
- **需明确裁决后再做（P2 / 方案 A）**
  - 新增纯选择器 `selectTranscript(task) → Block[]`，让「正文、工具活动、图片画廊、审批卡片」的归属只被决定一次，`AgentResponse` / `ActivityTimeline` 退化为哑组件。
  - 在 `RendererStreamClient` 与 `StreamTaskProjection` 之间二选一定序与去重的事实源，删除重复账本与重复 `structuredClone`。
  - 取消 `DesktopAgentAdapter.pendingStreamEvents` 缓冲（按 `requestId` 预注册未绑定投影），或明确保留并说明理由。
  - 合并 `DesktopAgentAdapter.tasks` 与投影快照的双状态源。
- **追加裁决后完成（第二轮，2026-09-30）**
  - 删除旧转录的镜像布局：`isOrderedTranscript` / `legacyHidden` 及其在 `isActivityOwnedText` 中的运行态兜底一并移除，活动区只拥有 `phase: process` 的过程叙述；`TaskProjection.orderedTranscript` 死字段删除。
  - Runtime 侧生图工具 id 字面量全部收敛到 `IMAGE_GENERATION_TOOL_ID`（含 `@version` 授权串），根级边界测试覆盖 renderer 与 Runtime。

## Capabilities

- 修改 `agent-task-experience`：强化「流式输出期间只重渲染变化的内容」（按块缓存、稳定历史引用、输入区不随流式 tick 重渲染），并新增「展示归属由单一选择器决定」的 requirement。
- 修改 `codex-task-activity`：把「正文/过程文本归属一次决定、不在正文与活动区重复出现」写入有序正文 requirement。
- `inline-tool-activity`、`conversation-images` 的现有 requirement 语义不变，仅由共享常量实现，本轮不产生 delta。
- 不新增 capability：本变更不引入新的用户可见能力，只收口既有能力的实现与职责。

## Battle Status

### 类型与分类依据

混合型，逐项分类如下（依据 [AGENTS.md](../../../AGENTS.md) 与 [Agent Battle 协议](../../../docs/governance/agent-battle-protocol.md)）：

| 项 | 分类 | 依据 |
| --- | --- | --- |
| 1 审批分支原地写 | 执行型 | 低风险、可逆、机械，且完全处于 2026-09-26 已裁决的「快照不可变」范围内；实测证明当前不会污染已发出的快照（见质疑 Q1），因此不是紧急缺陷，只是与已裁决约定不一致 |
| 2 Markdown 分块缓存 | 执行型（若只改渲染内部实现且输出等价）；决策型（若改为流式期纯文本尾部、或降低渲染频率） | 前者不改变组件契约与可观察输出；后者改变用户可见行为 |
| 3 派生视图与订阅范围 | 执行型（纯提取，渲染结果不变）；决策型（若为让历史轮次获得稳定引用而改投影输出结构，或改 store 订阅契约） | 后者改变模块职责与数据形状 |
| 4 展示归属三方越界 | 决策型 | 改变组件契约与「谁决定渲染什么」的职责边界 |
| 5 解析层重复与 client 单类过大 | 决策型 | 改变模块职责与定序/去重的事实源 |
| 6 状态双源 | 决策型 | 改变任务状态的数据所有权 |

### 状态

**Battle 已完成并由用户裁决（2026-09-30）**：用户选择**方案 A「一次到位」**，覆盖 Agent 推荐的方案 B。裁决结论、被否决方案、用户覆盖项与已知代价、回滚方式见 `design.md`；`specs/` 与 `tasks/` 只写入已裁决内容。

- 第 1 项经实测复核确认**不是活跃的 invariant 破坏**（发出的快照不会被原地修改），按既有约定与防御性修复处理，属执行型。
- legacy 兼容分支：Agent 第一轮只做了集中与判据记录（删除会改变 4 处断言锁定的行为）；用户随后明确要求「处理掉」，第二轮已删除镜像布局并重新基线化这些断言（决策与代价见 `design.md` 的追加裁决记录）。
- 重开条件：出现新证据使前述分类或复核结论失效（例如在真实设备 profile 中证明 Markdown 解析为主要热点、Runtime 侧落地 `orderedTranscript` 标记、或投影中新增了绕过展开语法的写法）。

## Impact

- 代码：`apps/desktop/src/renderer/src/services/{stream-task-projection.ts,desktop-agent-adapter.ts,renderer-stream-client.ts}`、`apps/desktop/src/renderer/src/pages/TaskPage.tsx`、`apps/desktop/src/renderer/src/components/{MarkdownContent.tsx,Conversation.tsx,ActivityTimeline.tsx,scroll-fade.ts}`、`apps/desktop/src/renderer/src/components/agent/{AgentResponse.tsx,ImageGallery.tsx,activity-mirror.ts}`、`apps/desktop/src/renderer/src/stores/task-store.ts`（视裁决）。
- 测试：`apps/desktop/tests/unit/renderer/src/{services,pages,components}` 下对应定向测试；e2e 交互 id 与 `apps/desktop/tests/e2e/**` 预计不需要改动。
- 依赖与契约：不新增依赖；不修改 Runtime 协议、IPC、视觉与 e2e 交互 id；不改动 `apps/agent-runtime`（另一回话在该目录有未提交改动，若裁决要求 Runtime 侧写入 legacy 标记，需另行协调）。
- 现有 spec：`agent-task-experience`、`codex-task-activity`，可能涉及 `inline-tool-activity`、`conversation-images`（视裁决）。
