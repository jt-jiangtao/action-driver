## Context

本变更依照已批准的 `docs/superpowers/specs/2026-09-24-architecture-convergence-design.md`。现有 `stream_requests.last_sequence` 和 `runtime_events.sequence` 字段已存在，但缺少数据库唯一约束、统一原子分配和客户端一致消费；`runtime_events.cursor` 是全库自增。现有 `serve-runtime-over-http`、`manage-agent-skills`、`use-langsmith-model-logs` 正在实施，工作区有未提交修改，实施前需逐项核对并吸收。

## Goals / Non-Goals

**Goals:** 完成请求顺序与恢复、Runtime 单写入边界、HTTP/WS 迁移、包职责收敛和诊断事实来源收敛；旧数据与既有 UI/本机能力须通过回归验收。

**Non-Goals:** 本次不部署云端 Runtime、不增加账号同步、不替换 LangGraph/SQLite/OpenAI SDK/`ws`、不引入新的产品功能。阶段划分不删减用户确认的最终范围。

## Decisions

### 1. 分阶段收敛而非一次性重写

最终裁决：用户确认采用可靠性 → 传输及所有权 → 包与实现简化 → 诊断 → 全量验收的依赖顺序，并要求所有已发现问题完成。替代方案是一次性重写 Runtime/Desktop/DB/UI，边界更整齐但迁移和回归风险高；维持双 RPC/HTTP 的局部修补虽然更快，却留有两个权威路径。分阶段每一步形成可测试的软件，旧路径通过协议覆盖测试后再删除。

### 2. 请求内序号与全局 cursor 分工

沿用已有字段，在 `BEGIN IMMEDIATE` 事务里读取/更新请求的最后序号、插入事件并更新相关任务状态；增加 `(request_id,sequence)` 唯一约束和 `(request_id,cursor)` 重放索引。事件提交后广播。客户端按 request+sequence 连续消费，用 cursor 定位重放与快照水位。替代方案仅用全局 cursor：并发请求会产生单请求空洞，现有 Renderer 排序缓冲可能永远等不到缺失 cursor。旧记录按同请求 cursor 排序回填；快照必须携带一致高水位。

### 3. Runtime 唯一生命周期与保守恢复

Runtime 启动对无执行者的 `running` 请求原子追加单个中断终态并更新任务，重复启动幂等。已提交文本和工具事实保留，执行结果未提交的工具显示未知且不自动调用。LangGraph checkpoint 继续保存推理状态，但不作为用户可见任务终态。替代方案自动继续 Graph：可能重复执行外部操作，无法保证用户数据安全。

### 4. HTTP/WS 与定义所有权

用户确认 Hono + `@hono/zod-validator` 替换手写路由校验；Node adapter 与现有 `ws` 共用服务边界。旧 RPC 只在等价路由通过 E2E 后下线。Runtime 决定模型/prompt/Skill 定义和任务状态，Main 执行受权限约束的本机 Browser/Computer/文件操作。替代方案保留 Main 业务代理或引入 Socket.IO：前者保留双重边界，后者仍不能提供持久化任务语义。TanStack Query 仅管理 Renderer 读取态，流投影独立。

### 5. 包与诊断来源

协议包只包含序列化契约；模型实现置于 Runtime，UI 投影置于 Renderer；单消费者设计 token 回归 Desktop；纯绑定 Inversify 容器改为显式工厂，无生产消费者的 `CheckpointStore`/`ProjectionService` 移除，但真实 LangGraph checkpointer 保留。替代方案保留所有包和容器，短期改动少但职责依旧不透明。用户确认 `fast-check` 用于乱序/重复/重放性质测试。模型层日志遵循已裁决的 LangSmith 唯一来源，OTel 负责运行诊断，SQLite 负责任务事实，停止重复 Phoenix 模型追踪。

## Risks / Trade-offs

- [旧数据库部分事件无法回填] → 迁移前备份，在事务内验证身份与唯一性；失败时原库保留并进入明确恢复路径。
- [工具执行与结果提交之间崩溃] → 标记未知、保留调用标识、禁止自动重试。
- [HTTP/WS 与 RPC 过渡期双路径] → 单写入方和路由覆盖清单作为删除门槛；E2E 禁止生产 Mock 回退。
- [新增库增加依赖面] → Hono 只处理路由，TanStack Query 只处理读取态，`fast-check` 只做测试。
- [用户覆盖建议的范围拆分] → 用户坚持修复全部问题，接受更长迁移和打包回归成本；各阶段有单独验收，不以阶段划分删项。
- [在途 OpenSpec 与旧主规范冲突] → 更新旧的 cursor-only 和 Phoenix-only 结论，核对并吸收现有 change，完成后按各自状态同步/归档。

## Migration Plan

1. 核对目标文件当前 diff、现有变更完成度与协议版本；为旧 SQLite 建备份和可复现迁移夹具。
2. 按 `docs/superpowers/plans/2026-09-24-runtime-reliability.md` 完成序号、重放、投影和中断恢复。
3. 按 `docs/superpowers/plans/2026-09-24-runtime-boundaries.md` 完成 Hono、能力端口、定义所有权及 RPC 下线。
4. 按 `docs/superpowers/plans/2026-09-24-package-and-diagnostics-convergence.md` 完成包、读取态、DI 与观测收敛。
5. 执行 `pnpm check:all`、macOS 打包冒烟与 OpenSpec 校验，修订文档并逐项核实全部范围。数据库版本提升后禁止无说明地回滚到读取旧 schema 的应用；如迁移失败，使用升级前备份恢复而非盲目降级。
