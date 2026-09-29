## Why

当前 HTTP 服务在同一文件中交织错误映射、来源与凭据检查、交互日志及多类资源路由，使安全边界和路由变更难以独立审查。利用项目已有的 Hono 组合能力可以降低维护成本。

## What Changes

- 将错误到响应的映射、请求中间件和资源路由移入独立模块。
- 保留 Hono 作为入口与组合层，并保持现有路由路径、验证、响应包裹、鉴权、跨域与日志脱敏语义。
- 加强与模块边界相关的定向回归测试，不新增 Web 框架。

Battle 已完成，用户明确接受以现有 Hono 做职责拆分。只拆代码区块而不形成中间件和路由边界是已比较的可行替代；无未裁决关键分歧。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。HTTP 对外契约保持不变；`.openspec.yaml` 使用 `skip_specs: true`。

## Impact

涉及 `apps/agent-runtime/src/service/http-service.ts`、相邻服务模块及 HTTP 定向测试。不修改客户端协议版本。
