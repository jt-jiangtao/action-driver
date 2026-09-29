## Context

`http-service.ts` 同时创建 Hono、处理安全/观测中间件、注册全部资源路由并启动服务器。现有 `service-http.test.ts` 覆盖来源、预检、凭据、错误与交互日志。参见 proposal.md。

## Goals / Non-Goals

**Goals:** 使错误映射、请求策略/观测和路由群组可分别阅读与测试，同时保持 HTTP 可观察行为。

**Non-Goals:** 不更换 Hono、不扩展路由、不更改服务端口、WebSocket 协议或公共 `ServiceHttpOptions`。

## Decisions

1. **入口。** `createServiceHttpApp` 仍负责按原顺序注册错误处理、全局中间件和路由，`startServiceHttpServer` 仍负责 Node server/WebSocket 装配。内部模块不持有服务器生命周期。
2. **中间件。** 拆出错误映射与请求策略/观测逻辑，保留原有先来源、再凭据、再有限 body 检查的拒绝顺序；预检白名单、健康端点例外、二进制上传/下载处理、响应记录和密钥脱敏原样保留。观测仍为 best effort。
3. **路由。** 使用 Hono `route` 或注册函数按模型连接、Agent 文件/Skill、媒体、任务、插件分组。每组依赖 `ServiceHttpOptions` 的窄字段；请求校验与 envelope 工具共用。可行替代是把大文件切成文本块后依次 import，迁移容易但责任仍混杂。用户裁决采用真正的中间件和资源边界。

## Risks / Trade-offs

- [中间件注册顺序影响 401/403/400 或 CORS 头] → 用现有 `service-http.test.ts` 比较预检、拒绝和成功响应，并补边界用例。
- [子路由挂载改变路径或异常传播] → 对照现有路径清单测试，保留顶层 `onError`。
- [日志泄露或观测失败影响业务] → 保留脱敏与 best effort 测试。

用户未覆盖 Agent 推荐。逐组迁移可单独回退；没有协议或数据迁移。
