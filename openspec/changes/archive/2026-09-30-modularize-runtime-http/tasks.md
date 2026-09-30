## 1. 安全与观测边界

- [x] 1.1 固定来源、预检、凭据、body 限制与错误映射顺序的定向断言；运行 `pnpm vitest run apps/agent-runtime/tests/unit/service-http.test.ts`。
- [x] 1.2 将错误映射和请求安全/观测中间件抽为内部模块，保持顶层注册顺序及 best effort 日志；运行 HTTP、服务日志定向测试。

## 2. 路由与验证

- [x] 2.1 按模型连接、Agent 文件/Skill、媒体、任务和插件组织 Hono 路由，保留现有路径、schema 和 envelope；运行 HTTP 定向测试。
- [x] 2.2 保留 `createServiceHttpApp` 与 `startServiceHttpServer` 公共入口，检查路径清单、二进制响应和日志脱敏；运行 HTTP/服务日志定向测试与 TypeScript 检查。

## 验证记录

- 拆分结果：`http-service.ts` 848 行 → 组合入口 141 行；新增 `service/http/` 下 9 个内部模块——`http-contract`（envelope、校验、共享 schema）、`http-errors`（错误→响应映射）、`http-utils`（token/body/脱敏工具）、`http-request-policy`（来源、预检、凭据、body 限制、观测中间件）、`http-routes-service`、`http-routes-plugin`、`http-routes-media`、`http-routes-models`、`http-routes-agent-files`、`http-routes-tasks`。
- 注册顺序保持原样：插件 → 健康/版本 → 媒体 → 模型连接 → Agent 文件/Skill → 任务 → `notFound`；顶层 `onError` 保留在 `createServiceHttpApp`。
- 新增 1 项定向断言（来源 → 凭据 → body 限制的拒绝优先级、预检短路、错误 envelope）：`pnpm vitest run apps/agent-runtime/tests/unit/service-http.test.ts` 25 项通过。
- 相关定向套件：`service-http`、`service-logging`、`service-logs`、`service-websocket`、`local-capability-service`、`plugins/composition` 共 57 项通过。
- `pnpm --filter @action-driver/agent-runtime typecheck` 与改动文件 ESLint 通过。
