# 流式接入与任务页渲染链路收口

## 目标

在不改变可观察行为（正文/活动/画廊顺序、Markdown 输出、审批卡片、旧转录布局、e2e 交互 id）的前提下，消除投影中唯一违反「快照不可变」约定的写法，把流式期间的解析与重渲染限定在变化内容，并让「谁决定渲染什么」、定序去重、任务状态各有唯一归属。完整行为契约见 [OpenSpec](../../../openspec/changes/refactor-stream-render-pipeline/specs/agent-task-experience/spec.md)，决策与替代方案见 [design](../../../openspec/changes/refactor-stream-render-pipeline/design.md)、实施顺序见 [tasks](../../../openspec/changes/refactor-stream-render-pipeline/tasks.md)。

## 已裁决的取舍

Battle 由用户裁决为**方案 A「一次到位」**，覆盖 Agent 推荐的方案 B（分两阶段）。用户接受更大回归面与更长验证窗口，换取归属与事实源一次收口；已知代价记录在 design 的 Battle 结论中。第 1 项经实测复核确认不是活跃 invariant 破坏，按既有约定与防御性修复处理。

## 实现要点

- **展示归属**：新增 `models/transcript.ts`（`selectTranscript` / `selectPriorTurns` / `selectActivityItems`）与 `models/message-media.ts`（`planMessageMedia`）。任务页只遍历选择器给出的条目；`AgentResponse`、`ActivityTimeline` 不再各自推导图片锚定、过程文本去重与可见性。
- **块级 Markdown**：`components/markdown-blocks.ts` 用 markdown-it 顶层 token 分组渲染并按块源缓存 HTML；`MarkdownContent` 每块一个 `.markdown-block` 包装，流式 tick 只重新生成尾部块。空行切分被实测证否（宽松列表会被拆坏），因此不采用。
- **定序与去重**：`RendererStreamClient` 是唯一事实源；`StreamTaskProjection` 删除 `seenEventIds`/`lastSequence`/`lastCursor`，只保留「attach 快照已覆盖的缓冲事件不再重放」。
- **缓冲与状态源**：适配器删除 `pendingStreamEvents`，在 `create()` 之前创建投影，未命名任务的流事件缓冲在投影内部；`tasks` map 降级为最近快照缓存。
- **输入区**：抽出 `TaskComposer` 并 `memo`，提交适配器移入组件内部，使编辑器不参与流式 tick 的渲染。
- **常量收敛**：`IMAGE_GENERATION_TOOL_ID` 与三个判定函数移入 `@actiondriver/contracts`，renderer 五处字面量归零，并由根级边界测试守住插件清单与契约一致。

## 已知缺口（需后续裁决或协调）

两项遗留已按用户的追加裁决在第二轮处理完毕，见 design 的「追加裁决（2026-09-30，第二轮）」：

- 旧转录的镜像布局已删除：活动区只拥有 `phase: process` 的过程叙述，`pending`/`final` 只出现在正文，全部转录按持久化顺序渲染；4 个断言按新行为重新基线化。
- Runtime 的生图工具 id 字面量已全部收敛到 `@actiondriver/contracts`，根级边界测试覆盖 renderer 与 Runtime。
