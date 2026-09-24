# 大批量工具调用与准备阶段反馈实施计划

## 代码边界

- `apps/agent-runtime/src/agent-graph.ts`：预算、递归上限、准备事件转发。
- `apps/agent-runtime/src/model-connections/provider-adapters.ts`、`model-gateway.ts` 与 `packages/model-connections/src/types.ts`：仅工具名的流式事件。
- `apps/agent-runtime/src/stream-session-service.ts`、`packages/runtime-contracts/src/stream-protocol.ts`：进度事件持久化、广播、重放与快照。
- `packages/contracts/src`、`apps/desktop/src/renderer/src/services/stream-task-projection.ts`、`components/ActivityTimeline.tsx`：运行中准备状态投影与展示。
- `apps/desktop/src/renderer/src/services/renderer-stream-client.ts`、`desktop-agent-adapter.ts` 与 `App.tsx`：页面刷新后从任务快照水位重新订阅运行中的请求。
- `apps/agent-runtime/tests`、`apps/desktop/e2e`：预算、分片、生命周期、各类 100 次压力验证。

## 任务

1. 在 Graph 测试中加入 400 次混合调用、513 次超额和连续 400 轮用例，确认旧实现先失败。随后将预算与递归上限配套调整，重跑目标测试。
2. 在适配器测试中加入工具名先到、参数延迟和无参数泄露用例，确认失败。实现 `tool-call-preparing` 模型事件并沿 Gateway 与 Graph 转发。
3. 在 Runtime 流服务和协议测试中加入准备事件的序号、回放、快照和终态清理用例，确认失败。实现持久化事件与投影数据。
4. 在桌面组件和端到端测试中加入“正在准备 <工具名>”首帧、无空任务组、执行后清理、取消/失败清理用例，确认失败。实现状态行展示。
4.1. 页面刷新后验证准备状态仍在且后续正文和终态继续到达；以请求标识及快照水位恢复订阅，验证取消仍可用。
5. 增加可显式运行的压力测试：四类工具各 100 次短调用，分别核对输入、输出与成功数；Web Search 使用本地 HTTP 服务。运行并记录每类计数。
6. 执行 `pnpm typecheck`、相关 Vitest、Playwright、构建和 OpenSpec 严格校验；同步主规范并归档变更。

每步遵循红灯、绿灯、整理的顺序。保留现有工作树中其他任务的未提交改动。
