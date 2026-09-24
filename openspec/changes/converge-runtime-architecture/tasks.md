## 1. 事件可靠性与恢复

- [ ] 1.1 核对旧库与在途代码，备份并迁移请求事件序号/唯一约束；通过 `apps/agent-runtime/tests/database.test.ts` 的并发旧库夹具。
- [ ] 1.2 统一原子事件追加与按请求有界重放，删除全表扫描；通过 `apps/agent-runtime/tests/repositories.test.ts` 和流服务测试。
- [ ] 1.3 Renderer 按请求序号处理交错、重复、乱序与快照，使用 `fast-check` 固定性质；通过流客户端和投影测试。
- [ ] 1.4 Runtime 启动幂等结束孤儿任务、保留部分内容和未知工具结果且不自动重试；通过重复启动和中途杀进程测试。

## 2. 传输与进程所有权

- [ ] 2.1 用 Hono、Node adapter 和 `@hono/zod-validator` 接管现有 HTTP 路由，保留 WS、鉴权、Origin 与脱敏；通过路由矩阵和安全边界测试。
- [ ] 2.2 建立 Runtime→Main 类型化本机能力端口，覆盖取消、超时、迟到结果；通过能力集成测试。
- [ ] 2.3 将 prompt、Skill 定义及配置权威写入迁至 Runtime，旧文件幂等导入；通过定义存储与设置/Skill 页面测试。
- [ ] 2.4 各业务操作迁入 HTTP/WS 后删除旧 MessagePort RPC 和 DTO，保留安全引导 IPC；通过 `pnpm test:e2e:local` 且生产装配无 Mock 回退。

## 3. 分包与前端读取态

- [ ] 3.1 模型供应商实现归入 Runtime，跨进程包仅导出协议；通过依赖边界测试、Runtime build 和模型测试。
- [ ] 3.2 将 UI 投影归入 Renderer，并用 TanStack Query 管理任务/模型/Skill 读取态与定向失效；通过页面、服务和视觉 E2E 测试。
- [ ] 3.3 以显式工厂代替纯绑定容器，删除无消费者的投影/checkpoint 抽象且保留 LangGraph checkpointer；通过组合根和重启测试。
- [ ] 3.4 将单消费者设计 token 归入 Desktop，清理无用包依赖；通过 typecheck、build 与视觉检查。

## 4. 诊断与全量验收

- [ ] 4.1 将模型层日志收敛到 LangSmith，停止重复 Phoenix 模型追踪，OTel 只记录运行诊断且 SQLite 保持任务事实；通过日志故障和敏感字段测试。
- [ ] 4.2 同步旧 cursor-only/Phoenix-only 文档与关联 OpenSpec 变更，验证 `openspec validate converge-runtime-architecture --strict` 通过且无相反规范留存。
- [ ] 4.3 运行 `pnpm check:all`、并发/重连/重启集成测试和 macOS 打包冒烟，核对所有验收场景后归档已完成的变更。
