# 设计：在 JavaScript 入口内逐动作确认

## Decisions

**D1 挂起 + 续接（B2），不做重放（B1）。** 单元跑到有副作用的调用时**就地挂起**（子进程里那个 promise 保持 pending，绑定、循环位置、已产生的输出都保留），宿主把这轮以"待审批动作"结束；续接时把决定送回同一调用。最小 spike 证明同一节点里连续两次 `interrupt()` 每次 `resume` 各消化一个决定，但真实节点里第二轮会拿到与第一轮相同的恢复值，因此同一次 `js` 调用只允许一个动作（见 D4）。被否决的 B1 需要按序记忆化重放，且存在"批准 A 实际执行 B"的风险。

**D2 决定通过执行上下文传递。** `ToolInvocationContext.continuation.decisions` 携带该调用已作出的全部决定（最旧在前），`ToolInvocationService` 通过 `ToolExecutionContext.continuation` 交给工具，并让 `ToolApprovalRequired` 原样上抛（不写成 `tool.failed`）。事件按 `eventKey` 幂等，重放的节点不会重复写记录。

**D3 工具侧按序号投递。** `js` 执行器记住任务级的待审批动作，续接时跳过"序号小于当前等待动作"的已投递决定，序号更大则报 `APPROVAL_STALE`；投递后若单元在同一动作上再次挂起，会以同一序号报告（工具持有该序号的决定即可匹配）。等待用户的时间不计入单元超时，`js_reset` 在挂起时丢弃该会话。

**D4 一次调用一个动作。** 同一单元的第二个待审批动作返回 `COMPUTER_ACTION_SPLIT_REQUIRED`，要求模型把动作拆成两次调用；提示词与工具描述写明这一点。多动作单元留待对 LangGraph 多次中断语义再做一次 spike。

**D5 审批卡形态。** `pendingComputerApproval` 增加 `jsAction: { index, method, args }`，渲染器按 Skill API 的说法描述（点击第 N 个元素 / 输入文本 / 按键 / 写入字段 / 选中文本 / 拖拽 / 次级动作），沿用同一张卡与同一套"确认执行 / 拒绝"按钮。

## Risks / Trade-offs

- 确认粒度是一个动作一次；多动作任务会多次打断（用户已选择该方向）。
- 分类器只用于**批量调用**的拒绝判断，不再是许可判定：许可由挂起路径决定。
- 首轮被放弃的工具生成器会让宿主会话保持挂起；当前靠 `js_reset`、超时与 `ENGINE_UNAVAILABLE` 兜底。

## Verification

`pnpm typecheck`、`pnpm lint`（139 项交互契约）、`pnpm test`（160 文件 / 1016 用例）、`pnpm test:e2e:packaged:macos` 全部通过；定向用例覆盖挂起协议（假子进程与真实子进程）、图里的确认/批准/拒绝/批量拒绝、`jsAction` 投影与审批卡。
