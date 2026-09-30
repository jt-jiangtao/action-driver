## Why

六处核心模块把不同生命周期和职责集中在单个文件或平铺目录中，修改流式请求、Graph 工具处理、桌面服务或会话持久化时需要跨越大量无关实现。整理模块边界可以让状态所有权、调用接口和测试归属更明确，降低后续修改时的理解与回归成本。

## What Changes

- 将 Agent Runtime 的请求创建、轮次执行、会话历史组装，以及 Graph 状态、工具调用处理和纯辅助逻辑拆成职责明确的模块；runner 与 session service 继续负责生命周期编排。
- 将 Desktop renderer 服务和 mock 按 agent-session、model-connections、agent-files 等实际功能归组，更新容器、页面及测试引用。
- 在现有 `rollout/` 下分离读取、写入和中断恢复逻辑，通过窄接口协作，由 `RolloutSessionStore` 统一持有会话状态及存储入口。
- 将 SQLite 迁移定义放入 `database/migrations/`，保持既有迁移版本、名称和执行顺序；`database.ts` 保留打开与迁移执行入口。
- 将 `packages/contracts/src/index.ts` 按消息、任务、Skill 等主题拆为内部文件，保持既有公共导出兼容；为适用的 Agent Runtime 模块增设清晰的子路径入口，更新内部调用方。
- 修复受影响测试，按仓库规范完成提交前验证。整个变更不改变用户可观察行为、流协议或持久化格式。

Battle 已完成。用户明确选择一次完成以上六项，并选择建立模块接口的方案 B，覆盖 Agent 推荐的保守入口方案 A。已知代价是引用调整范围更广，流事件顺序和 rollout 恢复路径的回归风险更高；用户已获悉。当前没有未裁决的产品或架构分歧。

## Capabilities

### New Capabilities

无。本变更只整理实现边界，不增加对外能力。

### Modified Capabilities

无。现有会话、流事件、持久化和桌面行为要求保持不变。此变更以 `skip_specs: true` 标记，不制造行为性要求。

## Impact

影响 `packages/agent-runtime`、`packages/contracts`、`apps/local-runtime`、`apps/desktop` 的内部源码、导入路径与相关测试；涉及现有 `@action-driver/agent-runtime` 子路径导出及 `@action-driver/contracts` 根导出。无新增依赖、协议版本、数据库迁移版本或数据格式变更。实现时需避开工作区其他任务的在途改动；当前 `main` 工作区干净，但有未归档的 OpenSpec 变更提及部分目标模块。
