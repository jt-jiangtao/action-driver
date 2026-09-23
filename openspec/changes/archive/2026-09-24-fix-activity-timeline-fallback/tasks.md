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

## 5. 参考截图的视觉校准（审批流程保持不变）

- [x] 5.1 用组件失败测试锁定混合活动、文件、本地搜索和方框终端图标，以及文件名点线下划线；调整活动和工具行图标。
- [x] 5.2 用桌面 E2E 失败断言锁定活动与子行图标、展开面板的同列对齐，以及标题箭头紧邻标题；校准缩进、行距和展开箭头。
- [x] 5.3 用组件失败测试锁定 Shell 的 `$ 命令`、输出和退出码展示；底层原始 I/O 与其他工具展示不变。
- [x] 5.4 构建并视觉检查活动归档和 Shell 展开截图，运行桌面工具 E2E 9/9、组件测试与类型检查；保留审批相关用例。

本轮验证：ActivityTimeline 组件 11/11、桌面工具 E2E 9/9、Desktop 构建与类型检查通过；全量 Vitest 634/635，唯一失败仍为上述既有本地 SSE 连接用例。后补的两项组件测试分别覆盖同类文件工具的活动图标、超过一分钟的用时格式，均已通过。

## 6. 刷新后恢复当前任务

- [x] 6.1 先以失败组件测试复现 Renderer 重建后回到首页、标题和消息不可见；实现只保存当前任务 ID 并从任务快照恢复。
- [x] 6.2 先以失败组件测试复现最近任务列表失败会阻断详情恢复；将两项读取解耦。
- [x] 6.3 桌面 E2E 验证刷新后无需侧栏点击即可看到原标题、结论和活动归档；运行类型检查、相关测试和严格 OpenSpec 校验。

刷新恢复验证：App 组件测试 13/13、ActivityTimeline 组件测试 11/11、桌面工具 E2E 9/9、Desktop 构建、全工作区类型检查、ESLint 和 OpenSpec 严格校验通过。全量 Vitest 635/637：原有本地 SSE 连接失败，以及 `LogsPage` 重试测试在并发全量运行时失败；后者单独重跑通过。短标题自动生成未纳入本执行型修复，须先完成独立裁决。
