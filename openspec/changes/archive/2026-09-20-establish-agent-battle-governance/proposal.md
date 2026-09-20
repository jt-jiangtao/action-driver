## Why

ActionDriver 的产品与技术决策目前依赖对话中的临时共识，缺少强制质疑、替代方案比较和结论留痕机制，容易让未经验证的用户假设直接进入设计与实现。现在需要将已有的产品 Battle 工作方式固化为项目级 Agent 治理协议，同时避免机械性任务被形式化争论阻塞。

## What Changes

- 建立两级决策分类：决策型任务必须完成 Battle，执行型任务在既有决策范围内可直接推进。
- 规定 Battle 必须覆盖目标、关键假设、证据与反例、替代方案、风险、推荐结论和用户裁决。
- 定义 Battle 的结束条件以及用户覆盖 Agent 建议时的记录要求，避免以模糊的“确认”替代决策闭环。
- 要求产品方向、系统边界、技术选型、数据模型、公共接口和高返工成本变更在 OpenSpec 中记录决策与权衡。
- 在仓库根级 Agent 指令和治理文档中发布协议，使后续开发 Agent 在开始实施前能够发现并遵循它。
- 明确例外：低风险、可逆、机械性且不改变既有决策的执行任务无需重复 Battle；一旦发现隐藏决策或冲突，必须升级。

## Capabilities

### New Capabilities

- `agent-decision-governance`: 定义开发 Agent 对产品与架构观点进行逻辑审查、Battle、决策留痕和实施门禁的项目级行为规范。

### Modified Capabilities

无。

## Impact

- 新增根目录 `AGENTS.md`，作为所有开发 Agent 的治理入口。
- 新增 `docs/governance/agent-battle-protocol.md`，记录完整协议、分类标准、Battle 模板和示例。
- 更新 `openspec/config.yaml`，要求相关 OpenSpec 产物体现 Battle 结论。
- 后续产品设计、架构设计和实现启动流程将受到门禁约束；产品运行时代码、外部 API 和用户数据格式不受影响。
