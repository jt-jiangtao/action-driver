## Why

现有搜索依赖用户维护的本机 SearXNG，网页读取只支持静态 HTML，无法覆盖依赖脚本的正文。用户已裁决搜索使用 Tavily、网页读取使用 Jina Reader，保留两个独立工具，降低本地服务维护负担并扩大可读取页面范围。

这是架构决策型变更，Battle 已完成：已比较继续使用 SearXNG + 静态读取、Tavily Search + Extract、Tavily Search + Jina Reader；用户确认最后一种方案，并授权创建本次规划。已公开第三方接收查询/URL、额度与限流风险；不承诺免费额度提高或所有站点可读。实现以现有 grants 授权、取消、归档和公网输入限制继续有效为成功标准。

## What Changes

- `tools.local.web.search` 使用 Tavily Search，默认 basic 搜索，返回有上限的标题、URL、摘要；不自动读取搜索结果。
- `tools.local.web.open` 使用 Jina Reader，读取单个公网 URL，返回可归因的正文；不引入用户登录态或交互式 Browser 能力。
- 保留现有工具身份和展示，更新供应商描述、参数和超时。
- 通过宿主凭据接口获取用户已提供的两个密钥；凭据不进入普通插件配置、日志、模型上下文或 Git。本次规划不写入密钥。
- **BREAKING**：默认路径不再使用 SearXNG endpoint；旧 categories/pageno 等供应商专属参数不再声明，旧归档仍可回放，未完成的旧调用返回明确参数错误。
- **BREAKING**：网页内容改为第三方 Reader 提取；宿主不再执行目标站点的每次重定向或脚本，不能宣称宿主掌握第三方实际访问链路。仍拒绝本地/内网输入和不安全来源结果。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-tool-runtime`：搜索装配条件由本机 SearXNG 改为 Tavily 凭据，保持现有本轮 grants 自动执行策略。

- `searxng-web-search`：以 Tavily 搜索及供应商独立的密钥、错误、额度边界取代本机 SearXNG 运行要求；保留既有 capability 路径以避免重复规范。
- `public-web-page-reading`：改为 Jina Reader 提取，明确第三方访问与宿主校验的边界，并保留取消、来源与不可信内容约束。

## Impact

涉及 `plugins/web` 的 search/reader catalog、executor、extension，`apps/agent-runtime/src/runtime-process.ts` 与插件凭据装配，以及相关工具可用性、展示与定向测试。SDK 已有 `credentials.request`，宿主已有授权上下文校验；Runtime 当前未装配 web 凭据端口，需要在现有接口内补齐。文档更新 SearXNG 默认部署说明与新凭据配置说明；不修改 Browser/Computer Skill、不新增供应商管理 UI、不安装官方 SDK，也不提交真实密钥。

Fake-IP 补充 Battle 已结束：用户批准仅对系统 Fake-IP DNS 结果使用固定 Cloudflare DoH 公网验证，继续拒绝真实内网地址。
