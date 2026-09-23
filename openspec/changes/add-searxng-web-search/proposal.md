## Why

通用 Tool Runtime 已能在真实模型调用中执行只读 Sandbox 工具，但无法检索工作区之外的最新公开信息。通过用户本机独立运行的 SearXNG 提供受控 Web Search，可在不把搜索引擎、容器生命周期或第三方搜索凭据打包进桌面应用的前提下补齐这一能力。

这是一次架构型变更，Battle 已完成。最终方向是“本机 Docker 独立部署 SearXNG，ActionDriver 只调用其 loopback JSON API；首版只搜索、不抓取网页正文；每次调用均须允许一次；L1 本地双层日志保留查询与截断摘要”。不存在未裁决的关键分歧。

## What Changes

- 新增版本化的 `web.search@1` Tool，向模型提供查询、语言、Safe Search、分类和受限结果数等可校验输入，并将规范化的标题、URL、摘要和来源元数据交回模型。
- 新增 SearXNG HTTP 适配器，只允许访问配置的 loopback endpoint 的 `/search` JSON API；拒绝非 loopback 地址、重定向、非 JSON 响应和超出资源上限的结果。
- 将 Web Search 作为网络副作用工具复用既有“一次性批准”、取消、超时、WebSocket 生命周期和模型→工具→模型循环；不扩展 Sandbox 的默认禁网边界。
- 提供独立的本地 SearXNG Docker 部署说明与配置样例。镜像、容器和上游搜索引擎由用户在应用外启动和维护，桌面应用不得管理它们。
- 按 L1 将搜索查询和截断后的规范化结果写入现有工具聚合记录及真实模型调用记录；API key、认证头、原始上游响应和容器秘密不得进入工具输出、WebSocket 或日志。

## Capabilities

### New Capabilities

- `searxng-web-search`: 定义本机 SearXNG 的受控搜索、调用批准、结果规范化、日志与本地部署边界。

### Modified Capabilities

- `agent-tool-runtime`: 明确网络搜索工具在既有通用工具运行时中的发现、单次批准、结果交回模型与可观察性行为。

## Impact

- 影响 `apps/agent-runtime` 的工具注册、配置装配和 HTTP 执行器，以及对应单元和真实工具闭环 E2E。
- 影响 `packages/runtime-contracts` 的 Tool Definition / 结果协议（仅在现有契约无法表达搜索输入或结果限制时）。
- 新增应用外的 Docker Compose、SearXNG 设置样例和本地部署文档；不新增模型协议、不迁移至 OpenAI Responses API，也不加入 Browser Use、网页抓取或任意网络访问。

