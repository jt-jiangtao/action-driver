## 1. Rollout 日志核心

- [x] 1.1 定义 rollout 行模型（`session_meta`、`turn_begin`/`turn_end`、`block`、`tool`、`asset` 及必填字段 `seq`/`blockId`/`order`/`status`），并为其补类型与解析校验；验证：新增单元测试覆盖每种行的解析与拒绝非法行
- [x] 1.2 实现按会话解析的 append-only 写入器（整行 + newline + fsync），保证只追加不改写；验证：单元测试断言追加后既有字节完全不变
- [x] 1.3 实现容错读取器：跳过或截断到最后一个完整有效行，尾部残行不导致崩溃；验证：以被截断与含非法行的日志为输入，断言读出最后一个有效前缀
- [x] 1.4 实现 `fold(行序列)` 左折叠，产出会话状态（消息、块、工具项、回合），并保证与逐行 apply 结果一致；验证：单元测试对同一输入比较「全量 fold」与「逐行 apply」
- [x] 1.5 实现序号分配器与预留槽位：`image_batch` 预留 `1 + imageCount`，新块从预留之后分配；验证：单元测试覆盖图片乱序到达与占位期间新建块两种场景
- [x] 1.6 实现追加式状态更新与折叠取最后状态（工具与块状态）；验证：单元测试断言历史行不变且折叠结果为最后状态

## 2. SQLite 投影

- [x] 2.1 定义投影 schema（thread / turn / item，键为 `rollout_ordinal`）与投影游标表（字节偏移 + 序号）；验证：迁移到空的投影库成功，schema 与设计一致
- [x] 2.2 实现从 rollout 增量投影到投影库，重启从游标续投影且幂等；验证：中断后重启的单元测试断言不重复、不跳项、顺序一致
- [x] 2.3 实现投影被删除后仅凭日志全量重建；验证：删除投影库后重建，读取结果与删除前逐字段一致
- [x] 2.4 让会话列表、分页与快照读取只走投影；验证：定向单元测试覆盖列表顺序与分页边界

## 3. 接入运行时并保持对外协议

- [x] 3.1 用 rollout + 投影实现 `apps/agent-runtime/src/ports.ts` 中的仓储接口（task / message / event / tool / stream request / snapshot），替换 `SqliteRuntimeRepositories` 的调用点；验证：`local-adapters.test.ts` 与 `repositories.test.ts` 定向通过
- [x] 3.2 让 `stream-session-service` 以日志追加替代旧库提交，并把活动投影改为折叠结果，保持 `StreamServerEvent` 不变；验证：`stream-session-service.test.ts` 与服务端 HTTP 定向测试通过
- [x] 3.3 由投影生成 `response.snapshot` 的 `messages`/`tools`/`activities`/`activityTimeline` 字段，保证旧协议消费者无需改动；验证：快照与重放一致性定向测试通过
- [x] 3.4 重启恢复在日志与投影之上实现：运行中请求幂等转终态、运行中工具转未知、只追加终结行；验证：`recoverInterruptedRequests` 等价定向测试通过

## 4. 分组边界与占位

- [x] 4.1 把工具分组边界从「仅正文」扩展为「任意可见块」（正文、图片批次、图片、文档）；验证：agent-graph 定向测试断言「生图后执行工具进入新组」
- [x] 4.2 同轮并行工具（其间无可见块）归入同一组且顺序稳定；验证：agent-graph 定向测试覆盖多调用单轮场景
- [x] 4.3 占位与待执行先写后跑：生图批次与工具调用在执行前入日志；验证：stream-session-service 定向测试断言执行前已存在对应行
- [x] 4.4 刷新后占位、分组与组内顺序不变；验证：以中途快照恢复的定向测试断言稳定位置与插槽数量
- [x] 4.5 Renderer 侧确认无需改协议即可渲染新投影（如需要则仅调整投影入参适配层）；验证：`stream-task-projection`、`ActivityTimeline`、`transcript` 定向测试通过

## 5. 配置、凭据与资产归位

- [x] 5.1 把模型连接配置从运行时库迁到应用数据目录的配置文件，密钥保留在受 OS 保护的凭据存储；验证：`model-connection-store` 与 `model-connection-service` 定向测试通过
- [x] 5.2 图片与文件字节落文件目录，rollout 与投影只存引用；验证：资产与输入输出存储的定向测试通过
- [x] 5.3 侧栏列表与分页由投影的 `threads` 表承担，不另建追加式索引（design 决策 7 已同步）；验证：投影列表顺序与分页边界的定向测试通过
- [x] 5.4 跨进程安全由运行时所有权声明保证（同一数据目录单写者）；验证：`runtime-process` 拒绝第二个运行时、恢复归第一个写者的定向测试通过

## 6. 删除旧库与清理

- [x] 6.1 启动时检测并删除 `actiondriver.db` 及 `-wal`/`-shm`，不读取不转换；验证：以存在旧库的临时目录启动，断言旧文件被移除且不产生读取错误
- [x] 6.2 移除 `database.ts`、`persistence/*`、`model-connections/sqlite-store.ts`、`media/*` 与 `computer-use/app-approval-store.ts` 中被替代的旧实现与迁移代码；验证：`rg` 确认无残留调用点，`pnpm typecheck` 通过
- [x] 6.3 更新桌面端 `runtime-paths.ts`，改传数据目录与投影路径而非单一数据库文件；验证：`runtime-process.test.ts` 与桌面主进程定向测试通过

## 7. 提交前验证（提交动作的一部分）

- [x] 7.1 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test` 并记录通过/失败数量与已知无关失败；验证：三项命令结果记录进提交信息或本变更记录
- [x] 7.2 因涉及运行时与打包行为，追加 `pnpm test:e2e:local`（必要时 `pnpm test:e2e:packaged:macos`）；验证：e2e 结果记录进提交信息或本变更记录
- [ ] 7.3 提交只包含本变更相关文件，排除工作区中其他会话的 `placement/*`、`main.tsx` 等无关改动；验证：`git status` 与提交 diff 复核

## 8. 范围说明（未裁决项不实施）

- [x] 8.1 投影范围仅做 thread / turn / item；日志、记忆、目标、队列的投影待用户在 design 的 Open Questions 确认后再立项
- [x] 8.2 不迁移 LangGraph checkpoint 存储；如需迁移另开变更
