# Tasks: 在 JavaScript 入口内逐动作确认

- [x] 1 子进程"挂起/续接"协议与宿主 API（`approvalRequired` / `continueRun`、决策投递、超时暂停、`js_reset` 丢弃挂起会话）。
- [x] 2 工具调用续跑：`ToolExecutionContext.continuation`、`ToolApprovalRequired` 原样上抛、按序号投递与 `APPROVAL_STALE`。
- [x] 3 图节点循环：`interrupt()` 携带 `jsAction`、按 `callId` 记决定、调用结束清空、同一单元第二个动作返回 `COMPUTER_ACTION_SPLIT_REQUIRED`。
- [x] 4 审批卡与投影改为 `jsAction`，提示词与工具描述改为"动作前逐个确认、一次调用一个动作"。
- [x] 5 验证：定向测试（挂起/续接、批准/拒绝、批量拒绝、投影、卡片）、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:e2e:packaged:macos`。
- [ ] 6 后续（另开变更）：一个单元内连续多个动作的确认（需先澄清 LangGraph 同轮多次 `interrupt()` 的语义）；按动作类型分级确认或任务级一次性授权。
