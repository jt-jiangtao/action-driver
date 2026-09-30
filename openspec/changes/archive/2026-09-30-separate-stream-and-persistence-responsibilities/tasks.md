## 1. 事件恢复基线

- [x] 1.1 针对写入失败不发布、并发发布顺序、断线回放与快照高水位补足定向测试；运行 `pnpm vitest run apps/agent-runtime/tests/unit/stream-session-service.test.ts apps/agent-runtime/tests/unit/repositories.test.ts`。
- [x] 1.2 抽取流事件交付状态和发布/重放逻辑，保留 `StreamSessionService` 执行编排；运行流会话定向测试。
- [x] 1.3 将快照构建和纯转换函数移入内部模块，保持投影与事件输出一致；运行流会话定向测试。

## 2. 仓储与事务

- [x] 2.1 按任务/消息、输入文件、流请求/事件及工具记录拆分仓储内部实现，所有领域共用传入的 SQLite 连接；运行仓储定向测试。
- [x] 2.2 将跨表原子写入保留在单一事务边界内，验证故障注入时无部分状态和游标推进；运行仓储、流会话定向测试与 TypeScript 检查。

## 验证记录

- 流会话拆分：`stream-session-service.ts` 1309 行 → 1057 行；新增 `stream/event-delivery.ts`（交付状态：串行发布队列、已发布游标、publishThrough/replay 与释放）、`stream/stream-snapshot.ts`（快照构建与输出文件投影）、`stream/stream-values.ts`（boundedJson/boundedText/messageText/messageParts/toStreamError/withAssets/imageOrder 等纯转换）。执行编排、事件转换与 turn 生命周期仍留在服务内。
- 仓储拆分：`repositories.ts` 1114 行 → 466 行；新增 `persistence/{task-store,input-file-store,stream-store,tool-store,json-columns}.ts`。各领域仓储都由构造函数注入同一个 `Database.Database`，`recoverInterruptedRequests`、`createStreamTask`、`commit*` 等跨表聚合写入仍留在组合层，并保持 `database.transaction(...).immediate()` 边界。
- 新增 1 项故障注入断言：被拒负载（`PERSISTENCE_PAYLOAD_REJECTED`）不留下工具行与事件行；找不到 stream request 的跨表提交回滚已写入的消息。`repositories.test.ts` 13 项通过。
- 原有约束保持通过：并发发布顺序、快照高水位、断线回放/重放过期、写失败不发布、幂等提交（`stream-session-service.test.ts` 33 项、`repositories.test.ts` 13 项）。
- 相关定向套件：stream-session-service、repositories、runtime-process、composition-root、persistence-guard、database、tool-invocation-service 共 87 项通过；`pnpm --filter @action-driver/agent-runtime typecheck` 与改动文件 ESLint 通过。
