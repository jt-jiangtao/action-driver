## Why

流会话服务同时处理执行、事件发布与重放、快照和转换，仓储文件同时处理多个持久化领域。两处代码共享事件顺序与事务约束，需作为一个切片整理，才能让边界清晰且不破坏恢复语义。

## What Changes

- 拆出流事件发布/重放、快照与纯转换职责，保留原有 `StreamSessionService` 入口和执行编排。
- 按持久化领域拆分仓储实现，由现有 `SqliteRuntimeRepositories` 组合，同享一个数据库连接。
- 保持事件提交后发布、请求内连续序号、全局 cursor 定位、快照高水位及跨表原子提交。
- 用现有定向测试和针对边界的补充测试验证行为不变；不引入 ORM 或迁移数据库结构。

Battle 已完成，用户明确接受保守抽取。新增服务接口层并迁移全部调用方是已比较的可行替代，但在当前事件语义下返工与回归风险更高。无未裁决关键分歧。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。现有 `runtime-event-recovery` 等需求继续适用，`.openspec.yaml` 使用 `skip_specs: true`。

## Impact

涉及 `stream-session-service.ts`、`repositories.ts`、相邻内部模块及流会话/仓储定向测试。数据库文件、schema、公共端口和事件协议不变。
