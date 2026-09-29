## Context

`StreamSessionService` 约 1300 行，执行流程与发布/重放、快照投影和事件转换交错。`SqliteRuntimeRepositories` 约 1100 行，任务、消息、输入文件、事件、流请求、工具记录及跨表事务同处一类。现有 `runtime-event-recovery` spec 明确约束序号、游标、高水位与原子性。参见 proposal.md。

## Goals / Non-Goals

**Goals:** 让流交付与快照转换、持久化领域各有清楚的内部边界；维持现有执行顺序、单数据库连接和跨表事务原子性。

**Non-Goals:** 不改变事件 schema、cursor 分配、数据库迁移、重试策略、公共 Port 或跨进程边界。

## Decisions

1. **流服务保留编排所有权。** `StreamSessionService` 继续处理创建、取消、执行与终态；内部事件交付对象拥有 `publishedCursors` 与串行发布队列，提供 `publishThrough` 和 `replay` 语义；快照构建及纯数据转换移至独立模块。事件存储成功后才调用交付。可行替代是新建全套服务接口并迁移调用方，隔离更强但会扩大异步状态和事件顺序风险。用户裁决采用保守抽取。
2. **持久化组合。** `SqliteRuntimeRepositories` 保留公开入口和唯一注入的 `Database.Database` 实例。内部领域模块持有同一个连接；多表原子操作仍由同一组合层或明确的事务协作模块以 `database.transaction(...).immediate()` 包围，不在每个领域仓储中另开连接或提前提交。
3. **契约测试。** 先固定并发事件的请求内连续 sequence、全局 cursor 顺序、断线重放、过期快照水位、事件写失败不发布、消息/工具/终态原子提交。拆分后沿用现有 `stream-session-service.test.ts` 与 `repositories.test.ts` 的定向验证。

## Risks / Trade-offs

- [串行锁或回放游标被拆散] → 将交付状态封装在一个内部对象，按请求验证并发发布与重连。
- [跨表事务被领域拆分截断] → 保留单一连接及事务外壳，测试故障注入后的零部分写入。
- [快照与事件转换不一致] → 共享纯转换函数并比对现有快照/回放断言。

用户未覆盖 Agent 推荐。没有数据迁移；按内部模块逐步迁移，可回退到原组合实现。
