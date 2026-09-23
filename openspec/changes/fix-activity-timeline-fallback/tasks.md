## 1. Runtime 活动归属与恢复

- [x] 1.1 为没有 `activity_update` 的普通工具批次先编写 Agent Graph 失败测试，验证 Runtime 在任务启动时创建受控活动、将 `n` 条连续工具关联到相同 `activityId`，并在最终回复前关闭该活动；验证 `apps/agent-runtime/tests/agent-graph.test.ts`。
- [x] 1.2 实现受控兜底活动的创建、运行时标题更新和完成事件；移除模型显式活动元工具并通过 Agent Graph 测试。
- [x] 1.3 为过期重连的 `response.snapshot` 先编写失败测试，验证其包含活动、时间线、工具关联和原始 I/O 边界；扩展流协议与 Session 快照实现并验证 `apps/agent-runtime/tests/stream-session-service.test.ts`。

## 2. Desktop 活动投影与 Codex 视图

- [x] 2.1 为快照投影先编写失败测试，验证 Renderer 恢复活动任务、`n` 条工具及正文顺序而非仅工具数组；实现快照到 `TaskProjection` 的完整映射并验证 `apps/desktop/src/renderer/src/services/stream-task-projection.test.ts`。
- [x] 2.2 为任务页先编写失败组件测试，验证包含工具的 Runtime 任务不渲染旧“运行中 / 运行结束”卡；统一使用活动时间线、保留输入框上方审批条并验证 `apps/desktop/src/renderer/src/pages/pages.test.tsx`。
- [x] 2.3 按确认的 Codex 视觉规则重做活动行、折叠归档、扫光与 Shell 原始 I/O 区，验证 `apps/desktop/src/renderer/src/components/ActivityTimeline.test.tsx` 及 reduced-motion 样式契约。

## 3. 端到端验证

- [x] 3.1 扩展普通工具流桌面 E2E，验证未发送 `activity_update` 时仍显示一个含工具行的活动任务、无旧类别卡、结论在“用时”归档之后，并通过 `apps/desktop/e2e/tool-runtime.spec.ts`。
- [x] 3.2 扩展快照恢复测试，验证恢复后保持活动归档、原始 I/O 和最终结论层级，并通过 Runtime/Renderer 定向测试。
- [x] 3.3 运行格式化、类型检查、相关单元测试、桌面工具 E2E 和严格 OpenSpec 校验，并记录结果。

验证记录：桌面工具 E2E 9/9、全工作区类型检查、严格 OpenSpec 校验均通过；Vitest 全量复跑 629/630 通过，唯一失败是本变更前已可复现的 `packages/model-connections/tests/provider-adapters.test.ts` 本地 SSE 连接错误，不在本变更范围。后续补充了过期历史快照跳转回归测试，验证 cursor 缺口不阻塞恢复。

## 4. 已裁决的活动流程与有序投影改造

- [x] 4.1 先补失败测试，断言模型工具列表不含 `activity_update`，活动标题由 Graph 在每次真实工具执行前修订，工具调用和结果保持稳定 `activityId` / `callId`。
- [x] 4.2 移除模型可见活动元工具及其合成结果；仅由 Runtime 流程创建、更新和完成活动。
- [x] 4.3 先补失败测试，覆盖正文 A → 工具 A → 正文 B → 工具 B 的实时顺序、重连去重、快照一致高水位与并行工具结果原位更新。
- [x] 4.4 用同一 cursor 有序投影器生成实时与快照任务过程；任务页停止将累计助手正文独立置于活动时间线前，最终结论留在完成归档后。
- [x] 4.5 更新旧工具卡断言及桌面 E2E，运行相关类型检查、测试和严格 OpenSpec 校验。
