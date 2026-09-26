## 1. 依赖与测试基线

- [ ] 1.1 用户执行 `pnpm --filter @actiondriver/desktop add zustand`，确认锁文件更新。
- [ ] 1.2 编写不可变性测试（深度冻结所有快照，覆盖文本、工具、活动与结束事件），确认在当前代码上因 `last.text += delta` 失败。
- [ ] 1.3 编写渲染次数测试（100 条历史消息 + 50 个增量），确认在当前代码上失败。

## 2. 投影不可变与结构共享

- [ ] 2.1 修正 `StreamTaskProjection` 中的原地修改，核对全部 `delete` 调用只作用于新对象。
- [ ] 2.2 去掉 `snapshot()`、`DesktopAgentAdapter.emit()` 与 `getTask()` 中的 `structuredClone`，不可变性测试通过。
- [ ] 2.3 `reduceActivityProjection` 改为只复制被改动的活动组，新增「未改动活动组保持引用」测试。

## 3. zustand 任务 store

- [ ] 3.1 新增 `stores/task-store.ts` 与 `useTaskStore`，经 `AppServicesProvider` 下发，补 store 单元测试。
- [ ] 3.2 `App` 改为从 store 读取与写入任务，回调读取 `getState()`；`useComputerUseGuidance` 与恢复任务流只订阅所需字段。
- [ ] 3.3 验证流式更新期间 `App` 与侧边栏不重渲染。

## 4. 渲染层记忆化

- [ ] 4.1 `memo` 包裹 `UserMessage`、`AgentResponse`、`MarkdownContent`（按内容缓存渲染）、`ToolRow` 与活动组组件。
- [ ] 4.2 `ConversationMessages` 使用常量空数组；`TaskPage` 抽出 `PriorTurn` 并记忆化派生数据；传给 `TaskPage` 的回调改为稳定引用。
- [ ] 4.3 渲染次数测试通过。

## 5. 验证

- [ ] 5.1 用户运行定向测试：`pnpm vitest run apps/desktop/src/renderer packages/activity-projection` 与 `pnpm typecheck`，结果记录于此。
- [ ] 5.2 用户在 `pnpm dev` 中用长对话手动确认流式输出流畅、界面无回归。
