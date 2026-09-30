## Context

动机见 `proposal.md` 的 Why。本设计只记录约束与取舍。

**现有链路**（审查范围）：

```text
Runtime WS --> RendererStreamClient (连接/鉴权/重连/定序/去重/lifecycle/pending creates)
           --> DesktopAgentAdapter (pendingStreamEvents 缓冲 + tasks map + withBrowser 合并 + emit)
           --> StreamTaskProjection (75ms 合并 tick, seenEventIds/lastSequence/lastCursor/buffered)
           --> zustand task-store (activeTask 引用)
           --> TaskPage (派生视图在渲染体内) --> Conversation/AgentResponse/ActivityTimeline/MarkdownContent
```

**必须遵守的既有裁决与约束**

- `openspec/changes/archive/2026-09-26-optimize-task-streaming-render`：不引入虚拟列表（用户裁决）；任务快照不可变并在层间结构共享；分发路径不再深拷贝；投影内部只能用展开语法生成新对象。
- `openspec/specs/agent-task-experience` 已要求「流式期间只重新渲染变化的内容」与「已发出的快照保持不变，未变化部分共享引用」；本变更的 P1 是补齐实现，不是新增要求。
- 仓库流程：迭代期只跑定向测试，提交前才一次性跑 `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test`。
- 工作区约束：`apps/agent-runtime/**` 与 `packages/{plugin-contracts,plugin-sdk}/**`、`apps/desktop/src/renderer/src/main.tsx` 有其他回话的未提交改动，本变更默认不改动这些文件。

**本设计依据的实测证据**（Node v20.14.0，`apps/desktop` 的 markdown-it 15）

1. 不动点证明：把 `StreamTaskProjection` 的每个发出快照深冻结，并注入 `computer.app-approval.requested` / `resolved` 事件后，先前发出的快照 `pendingAppApproval` 保持 `[]`，且审批事件仍发出新引用；同一运行时中对冻结对象赋值会抛 `TypeError`，说明该探针是敏感的。
2. 渲染成本：`md.render` 对 553 字符 / 6.9KB / 27.7KB 文本分别约 0.69 / 1.56 / 3.69 ms；模拟 100 个递增 tick 到 27.7KB 累计约 181 ms。`md.parse` 单项约 3.88 ms，说明 markdown-it 的解析是单体成本，缓存能省下的是 HTML 生成与整段 `innerHTML` 重建。
3. 朴素分块不等价：对 `- a\n\n- b`，整段渲染是单个宽松列表，按空行切成两段则变成两个 `<ul>`；带空行的围栏代码块同理不可按空行切分。
4. 可行的等价分块：用 `md.parse(content, env)` 得到 token，按嵌套深度 0 分组，再用 `md.renderer.render(group, md.options, {})` 逐组渲染；在列表/嵌套列表/引用/表格/围栏代码/缩进代码/软换行语料上与 `md.render(整段)` 逐字相等。注意必须传 `md.options` 而不是 `{}`，否则 `breaks` 语义会改变。

## Goals / Non-Goals

**Goals**

- 消除与既有不可变约定不一致的写法，并把该约定固化为覆盖审批路径的测试。
- 让流式期间的重解析与重渲染严格限于变化的内容：历史消息零重渲染，单条流式消息每次提交只更新尾部块。
- 让历史轮次的派生计算不再随每个 tick 重算（结构性共享或增量派生，而非单纯 `useMemo`）。
- 让「谁来渲染什么」与工具常量各有唯一归属，并让定序/去重与任务状态各有唯一事实源。

**Non-Goals**

- 不引入虚拟列表（既有用户裁决）。
- 不改变视觉、交互、IPC、Runtime 协议与 e2e 交互 id。
- 不改动 Runtime 的持久化与协议实现（本 change 只处理 renderer；Runtime 侧需要配合的 legacy 标记属于待裁决选项）。
- 不追求「重写为纯 reducer + 事件溯源」这类超出当前收益的架构替换。

## Decisions

> 状态说明：D1 已由既有裁决覆盖（执行型）；D2–D7 已由用户于 2026-09-30 裁决为「一次到位（方案 A）」，即 D2–D7 全部保留、在同一 change 内实施；对 Agent 推荐的覆盖与已知代价见文末「Battle 结论」。

### D1 投影审批分支改为对象替换（执行型，建议直接实施）

- 当前方案：把 `this.task.pendingAppApproval = [...]` 改为 `this.task = { ...this.task, pendingAppApproval: [...] }`，并新增「真实快照 + 审批事件」的不可变回归测试。
- 替代方案：保持现状，只在评审规则中记录「此处依赖前置展开」。
- 理由：与 2026-09-26 已裁决的约定一致，成本极低且可逆；保留了「审批分支未来被移动到展开之前」时的防护。
- 最终裁决：**执行型，直接实施**（用户 2026-09-30 裁决：一次到位，含 D1）。

### D2 流式 Markdown 按顶层块渲染并按块缓存

- 当前方案：`MarkdownContent` 用 `md.parse` 得到顶层 token 分组，逐组渲染并按「组源文本」缓存 HTML，React 按组 key 渲染；流式 tick 只重新生成尾部活动组，`useScrollFade` 依赖从 `[content]` 改为块数量/结构键。附带等价性测试（语料见 Context 证据 4）。
- 替代方案 1：按空行切分文本块。实现最简单，但已被证明不等价（证据 3），不采用。
- 替代方案 2：流式期间尾部块渲染为纯文本，消息结束再整体渲染 Markdown。CPU 最省，但改变用户可见行为（加粗/链接/代码块在流式期延迟出现），属决策项。
- 替代方案 3：保留整段渲染，仅降低渲染频率（如 200ms）或用 `useDeferredValue`。改动最小，但长回答的整段 `innerHTML` 重建仍在，且与现有 75ms 合并语义叠加后交互延迟不可控。
- 理由：在不改变输出与组件契约的前提下，方案是最优的性价比；`md.parse` 的单体成本无法避免，但 DOM 重建与 HTML 生成可以限定到尾部块。
- 最终裁决：**采纳**（方案 A）。`MarkdownContent` 按顶层 token 分组渲染并按组源缓存；替代方案 2、3 一并否决（不改变流式期可见格式，也不降低更新频率）。

### D3 任务页派生视图与订阅范围

- 当前方案：把 `precedingTurns` 分组、`dedupeAssistantText`、可见性过滤抽成纯选择器 `useTaskView(task)`；输入区改为只订阅 `activeTask.id` 与 `status`，并把 `onSubmit` 等回调改为稳定引用。
- 已知限制：仅把派生计算放进 `useMemo([task.messages])` 不会生效——投影每个内容 tick 都重建 `messages` 数组，memo 每次仍失效。要真正 O(1)，必须让投影或适配器提供**稳定引用的历史切片**（例如沿用 `priorActivityTurns` 的形态，把已完成轮次与当前轮分开），或把派生下沉到投影内做增量计算。
- 替代方案：把历史轮次整体下沉为 `task.history`（稳定数组 + 稳定元素引用），任务页只渲染「历史 + 当前轮」。效果最好，但改动投影输出形状与相关 spec，属 P2。
- 理由：先做纯提取（输出等价、可测），把「稳定切片」作为 P2 的明确子项单独裁决。
- 最终裁决：**采纳并扩展到稳定切片**（方案 A）。除纯提取外，投影/适配器 SHALL 为已完成的历史轮次提供稳定引用，使任务页流式 tick 的派生计算不随历史长度增长。

### D4 展示归属：`selectTranscript(task) → Block[]`

- 当前方案：新增纯选择器，把「正文块、工具活动、图片画廊（含批次锚定）、审批卡片、交付文件、失败态」的归属与顺序一次性决定，`AgentResponse` / `ActivityTimeline` 退化为按块类型渲染的哑组件；`legacyHidden` / `isOrderedTranscript` 的兼容路径按删除判据移除。
- 替代方案：保留现有三处推导，只把它们各自补上单元测试与共享常量（不搬逻辑）。回归面最小，但归属仍然分散，后续每次改动都要同时改三处。
- 理由：收益主要是可维护性与可测试性，不直接改善渲染成本；因此建议与 D2/D3 分开裁决与提交，并要求先复制现有行为的等价性断言（画廊批次顺序、失败态只保留非文本、legacy 布局）再搬迁。
- 最终裁决：**采纳并删除兼容分支**（方案 A + 第二轮追加裁决）：`legacyHidden` / `isOrderedTranscript` 与运行态兜底一并移除，活动区只拥有 `phase: process` 的文本，所有转录按其持久化顺序渲染。

### D5 Renderer 与投影的定序去重事实源

- 当前方案（推荐，二选一）：保留 `RendererStreamClient` 作为唯一事实源，它只向外发布**已定序、已去重**的事件（含 `response.snapshot` 与 `request.accepted` 的差异化处理），`StreamTaskProjection` 退化为不持有 `seenEventIds` / `lastSequence` / `lastCursor` 的纯 reducer，并去掉 `buffered`。
- 替代方案：反过来让投影自保（现状），client 只负责连接、鉴权、重连与生命周期，删除 client 的 `seenEventIds`/`sequences`/`pendingBySequence`。这会让 client 变小，但恢复/重放路径的安全网全部压在投影上，且 `watchExisting` 的游标语义要重写。
- 已知反例：两条路径都必须覆盖 `restoreTaskStream`（重连后 `afterCursor` 恢复）与乱序/重复事件，任何一处缺失都会退化为「内容重复或丢失」；因此该决策必须先有测试基线再动代码。
- 最终裁决：**采纳**（方案 A）。`RendererStreamClient` 成为唯一事实源，只发布已定序去重的事件；`StreamTaskProjection` 退化为纯 reducer。

### D6 任务状态单一来源与适配器缓冲

- 当前方案：`DesktopAgentAdapter` 不再维护与投影重复的 `tasks` map（或明确把 map 定义为「非公开缓存的派生视图」，由投影快照作为唯一事实源），并把 `pendingStreamEvents` 换成按 `requestId` 预注册的未绑定投影。
- 替代方案：保留双状态源与缓冲，只补注释与测试说明二者关系。
- 已知约束：`taskId` 由服务端在 `request.accepted` 时给出，因此「在 `create()` 之前建投影」只能按 `requestId` 预注册并在 accepted 后绑定；这会引入「未绑定投影」这一新状态，需要明确失败/取消时的清理语义。
- 最终裁决：**采纳**（方案 A）。适配器删除 `pendingStreamEvents` 缓冲（改为按 `requestId` 预注册的未绑定投影），并让投影快照成为任务状态的唯一事实源。

### D7 生图工具常量与状态白名单收敛

- 当前方案：把 `tools/local/image-generation/generate` 与「进行中/已完成」判定收进共享位置，`TaskPage`、`AgentResponse`、`ActivityTimeline`、`ImageGallery` 与插件目录共同引用；用源码级测试保证不再出现重复字面量。
- 替代方案：放进 renderer 内部常量模块（改动面最小，但插件与 renderer 仍各写一份）。
- 待裁决点：落点选 `@action-driver/contracts`（renderer 与 Runtime 均可见）还是 renderer 内部 `models/`。
- 最终裁决：**采纳并落在 `@action-driver/contracts`**（renderer 与 Runtime/插件共用），状态白名单同时收敛为共享判定函数。

### Battle：替代方案比较

| 方案 | 范围 | 收益 | 成本 / 风险 | 适用条件 |
| --- | --- | --- | --- | --- |
| A 一次到位（用户理想形态） | D1–D7 全部，含 `selectTranscript`、纯 reducer、状态源合并 | 归属与事实源一次收口，长期维护成本最低 | 触及投影输出形状、组件契约、store 订阅与恢复路径；e2e 回归面最大；与另一回话在 `apps/agent-runtime` 的未提交改动存在协调成本 | 接受较长验证窗口，并先补齐等价性/渲染计数测试 |
| B 分两阶段（**推荐**） | P1 = D1 + D2 + D3（纯提取）+ D7；P2 = D4 + D5 + D6 + D3（稳定切片） | P1 收益明确、输出等价、单项可回滚；P2 的每一条都有独立测试面，可裁剪 | 归属问题在 P1 后仍存在；需要用户在 P1 与 P2 之间再做一次节奏决定 | 希望先拿下可量化收益、再评估重构节奏 |
| C 最小 | D1 + D2 | 成本最低、风险最小 | 派生计算仍随 tick 重算，输入区仍随流式重渲染，归属与账本问题全部保留 | 只关心「长回答流式卡顿」且资源紧张 |

### Battle：推荐与不确定性

- 推荐 **B**。理由：P1 的每一项都对应既有 spec 已要求的行为或纯机械收敛，可以用定向测试把「不变的行为」与「变化的成本」同时锁住；P2 的核心分歧（谁是定序事实源、历史轮次是否需要稳定切片、legacy 判据是否可删）互相牵制，先做会让 P1 的回归定位变难。
- 不确定性：没有真实设备上的 renderer profile，因此「Markdown 解析 vs DOM 重建 vs 派生计算」谁是主要热点属结构性推断；建议在 P1 落地后补一次 React Profiler 采样，再决定 P2 的顺序。

### Battle 结论

- 类型：混合（第 1 项执行型；第 2–6 项决策型）。
- 目标：在保持可观察行为（正文/活动/画廊顺序、Markdown 输出、审批卡片、旧转录布局）不变的前提下，消除违反既有不可变约定的写法，把流式期间的解析与重渲染限定在变化内容，并让展示归属、定序去重、任务状态各有唯一归属。
- 当前方案：方案 A「一次到位」——D1–D7 在同一 change 内全部实施。
- 主要质疑（详见「Battle：质疑」摘要于 proposal 与本节）：第 1 项不是活跃 invariant 破坏（已实测证明）；`selectTranscript` 不直接降低 Markdown 成本，收益以可维护性为主；D5/D6 会改动恢复路径与状态归属，必须先有测试基线；`legacyHidden` 的删除缺少数据判据。
- 替代方案：方案 B（分两阶段）、方案 C（最小改动），比较见上表。
- **最终决策：用户选择方案 A（一次到位）**，覆盖 Agent 推荐的方案 B。
- 用户覆盖项与已知代价：接受方案 A 带来的更大 e2e 回归面与更长验证窗口；接受渲染类测试需要改写（渲染计数与 `MarkdownContent` 的 spy 目标都会变化）；接受展示归属搬迁期间「先复制等价断言、再搬迁」的额外步骤。
- **追加裁决（2026-09-30，第二轮）**：用户要求「处理掉」两项遗留。第一轮公开的边界（删除会改变 4 处断言锁定的行为、需要 Runtime 标记）已被用户接受，按如下方式实施：
  - 删除镜像布局：活动区只拥有 `phase: process` 的文本；`pending` 与 `final` 只出现在正文。旧转录按其持久化顺序渲染，与有序转录同一路径。
  - 代价：运行中且缺少顺序信息的旧转录不再把整段文本镜像到活动区（该文本在正文中显示），`pages.test.tsx` 与 `activity-mirror.test.ts`、`ActivityTimeline.test.tsx` 中共 4 个断言按新行为重新基线化；`image-slot-order.test.ts` 的「无序 parts 保位」不受影响，仍成立。
  - 证据：删除后所有受影响的定向测试（renderer 422 项）与契约测试通过；`orderedTranscript` 字段此前从未被写入或读取，作为死字段一并删除。
- 重新开启条件：出现新证据说明运行中的无顺序转录需要在活动区提前展示镜像文本（例如 Runtime 恢复路径会长时间停留在 `pending` 且正文不流式）。

## Risks / Trade-offs

- [分块渲染在边角语法上不等价] → 采用 markdown-it token 顶层分组并在等价性测试中固化语料；任一不等价即回退到整段渲染（单点回滚，无数据影响）。
- [memo 依赖引用稳定，上游一旦重建对象，优化静默失效且不报错] → 渲染计数测试把「历史消息零重渲染」「每 tick 只更新尾部块」固化为断言；P1 完成后补一次 Profiler 采样。
- [`selectTranscript` 搬迁导致画廊批次顺序、失败态过滤、legacy 布局回归] → 搬迁前先以现有行为写等价性断言，再搬迁；`pnpm test:e2e:local` 在提交前运行一次。
- [定序事实源调整导致重连/重放路径丢事件或重复] → D5 实施前先为 `runtime-event-recovery` 与 `restoreTaskStream` 建立基线测试；两条路径都覆盖后再删账本。
- [状态源合并引入「browser 快照属于谁」的中间态] → D6 与 `withBrowser` 的归属一起裁决；若无法一次决定，保留 map 并明确其为派生缓存。
- [用户覆盖 Agent 建议] → 若用户选择方案 A 或 C 或覆盖 D2–D7 中的任一项，需在本文件回填「用户覆盖项与已知代价」，并按裁决更新 `specs/` 与 `tasks/` 后再实施。
- [legacy 删除缺少数据判据] → 若选择「加 Runtime 标记」，需评估与 `apps/agent-runtime` 其他未提交改动的冲突；若选择「不动 legacy」，本 change 记录删除条件而不实施。

## Migration Plan

- 无数据迁移（除 D5/D6 涉及的内存状态与 legacy 标记之外无持久化结构变化）。
- 提交策略：P1 与 P2 若同时裁决，按 tasks 分组、分提交；每个提交只包含本变更文件，并记录定向测试结果。
- 回滚：全部为 renderer 内部改动，回滚 = revert 对应提交；若写入 `orderedTranscript` 持久化标记，回滚需保留读取兼容。

## 实施记录（2026-09-30）

以下调整都在已裁决的「方案 A」范围内，没有改变目标、依赖或对外契约。

- D1：两处审批分支改为对象替换；新增深冻结 + 审批事件的回归用例。
- D2：`markdown-blocks.ts` 按顶层 token 分组、按块源缓存 HTML；`MarkdownContent` 改为每块一个 `.markdown-block` 包装，并在 `agent.css` 补首/末子元素外边距规则以保持原有视觉。`useScrollFade` 依赖改为块数量（DOM 变化由 MutationObserver 兜底）。
- D3：历史轮次分组按「任务首条消息 + 当前用户消息下标」缓存，流式 tick 复用同一结果；输入区改为 `TaskComposer` + `memo`（只接收原始类型与稳定回调），**未**改为直接订阅 store：任务页本身每 tick 都会重渲染，memo 已足以把编辑器移出渲染范围，也避免让组件在测试中依赖 `AppServicesProvider`。
- D4：`selectTranscript` 成为唯一决策点；`AgentResponse` 改用 `planMessageMedia`，`ActivityTimeline` 改为必填 `items`。旧转录镜像布局保留为选择器内的显式分支（见 Battle 结论的 legacy 边界）。
- D5：投影删除重复的定序/去重账本；保留「attach 快照游标已覆盖的缓冲事件不再应用」——这条属于投影自身对 attach 快照的正确性，client 无法代为判断（有既有用例锁定）。
- D6：适配器在 `create()` 之前创建投影，删除 `pendingStreamEvents`；`tasks` 降级为最近快照缓存，并在代码注释中标注投影是运行中任务的事实源。
- D7：常量与判定函数落在 `@action-driver/contracts`；插件清单由根级边界测试校验。Runtime 侧 5 处字面量本次未动（其中 2 个文件在其他回话的未提交改动中），已记为已知缺口。

## Open Questions

- 真实设备 profile 中三类成本的实际占比（可在 P1 落地后采样，不改变 specs 与 tasks 结构）。
- 现有用户持久化数据中是否存在无 `order` 的会话（决定问题 4 的答案，可用只读查询确认）。
- Runtime 侧生图工具 id 字面量的收敛时机（依赖其他回话在 `apps/agent-runtime` 的改动落地）。
