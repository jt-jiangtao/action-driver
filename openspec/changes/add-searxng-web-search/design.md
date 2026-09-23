## Context

现有 `RuntimeToolRegistry`、`RuntimeToolPolicy` 和 `ToolInvocationService` 已提供版本化发现、参数校验、一次性批准、取消、事件持久化与交互日志。`RuntimeToolPolicy` 已将所有网络副作用判为 `require_approval`，而 `runtime-process` 当前仅注册 Sandbox 工具。Sandbox 规范刻意禁止网络，因此 SearXNG 必须作为独立网络执行器，而不是扩大 Sandbox 权限。详见 proposal.md 与本变更的 specs。

## Goals / Non-Goals

**Goals:**

- 以一个可替换的 HTTP Search Provider 将真实的本机 SearXNG JSON 搜索接入既有工具循环。
- 将可访问目标严格约束为显式配置的 loopback endpoint，保留每次调用批准与 L1 本地双层审计。
- 让用户在应用外以 Docker 运行 SearXNG，并以可复现文档连接 Runtime。

**Non-Goals:**

- 不在桌面应用中启动、升级或观察 Docker / SearXNG，不配置其上游引擎或凭据。
- 不进行网页正文抓取、链接跟随、Browser Use、截图、下载、网络通用代理或远程 SearXNG。
- 不迁移模型 API、增加托管搜索提供方或新增搜索设置 UI；本阶段通过 `ACTIONDRIVER_SEARXNG_ENDPOINT` 注入本机 endpoint，缺失或无效时工具不注册。

## Decisions

### 1. 以独立 Search Provider Port 接入 SearXNG，而非扩展 Sandbox

在 Agent Runtime 内新增面向搜索的 provider / executor 边界；其 Tool Definition 为 `web.search@1`，模型名为 `web_search`，声明网络副作用和受限输入 schema。`runtime-process` 在 endpoint 有效时注册该工具并发放本轮 grant；其余生命周期全部复用 Registry、Policy 和 Invocation Service。

备选方案是把 HTTP 请求加入 Sandbox。该方案看似复用执行器，却违反 Sandbox 默认禁网的既有契约，并会把仅对 SearXNG 合法的目标校验泛化为任意网络能力。最终裁决采用独立 Search Provider Port。

### 2. endpoint 由显式环境配置注入，并使用字面量 loopback 目标

Runtime 读取 `ACTIONDRIVER_SEARXNG_ENDPOINT`；只接受以 `http://127.0.0.1:<port>` 或 `http://[::1]:<port>` 表达、无路径前缀和无凭据的 URL。适配器固定将请求构造为该 origin 的 `/search`，使用 `redirect: 'manual'`，并拒绝重定向。未配置或无效时保持工具不可发现。

备选方案 A 是使用 `localhost` 或可配置远程 URL；DNS 解析、代理和 hosts 覆盖会破坏“本地-only”边界。备选方案 B 是增加桌面设置页与持久化连接配置；它能改善普通用户体验，但扩大了跨进程配置与 UI 范围。用户已裁决优先本机 Docker + 接口调用，因此首版选择显式环境配置；设置页留给独立变更。

### 3. 搜索请求和输出采用窄的可序列化契约

输入包括非空 `query`、可选 `categories`、`language`、`safesearch`、`pageno` 与受限 `maxResults`；schema 禁止未知字段。适配器强制 `format=json`，并把 SearXNG `results` 规范化为有序的 `title`、`url`、`snippet`、可用 `engines` / `category`。每字段、结果数量和总输出分别设固定上限（实施时以 10 个结果、64 KiB 聚合输出为上限），并携带截断元数据。

备选方案是返回原始 JSON 或在同一工具中抓取结果网页。原始 JSON 会扩大模型上下文与 L1 日志面；网页抓取则跨入 Browser Use 与额外 SSRF / 内容安全边界。最终裁决为仅返回截断、规范化摘要。

### 4. 网络调用逐次批准，L1 仅记录规范化审计数据

`web.search@1` 的 `sideEffects.network` 令既有 Policy 在每一次调用时生成 `waiting_approval`；批准绑定 task、call 和参数哈希，拒绝、过期或取消时 executor 不得创建 HTTP 请求。调用成功后，Invocation Service 的聚合记录保存输入和规范化结果，模型回合保存真实传入的工具结果；运行事件和 WebSocket 仍使用既有 call id。

适配器在内存中丢弃 HTTP headers、请求 URL 之外的 transport 元数据及原始 JSON。日志写入前只接收规范化结果；无 endpoint 凭据、Cookie 或代理认证进入配置或载荷。备选方案 L2 是仅保存哈希与 URL 元数据，隐私面更小但无法重放模型所见证据。用户明确选择 L1 并接受本地审计数据保留的代价。

### 5. Docker 是用户管理的外部依赖

仓库提供独立的 Compose 与 SearXNG `settings.yml` 样例，服务端口仅发布到 `127.0.0.1`，并显式启用 JSON 输出。文档说明启动、健康检查、`ACTIONDRIVER_SEARXNG_ENDPOINT` 配置、停止及常见失败；这些文件不参与 Electron 打包产物，也不由 Runtime 读取或控制。

备选方案是应用下载并管理镜像。它会引入桌面权限、更新、磁盘、跨平台 Docker 检测和故障责任，超出用户批准范围。最终裁决为外部、用户管理的部署。

## Risks / Trade-offs

- [SearXNG 上游引擎限流、验证码或变更页面结构] → 以稳定的结构化错误回到模型，不改为网页抓取；部署文档说明引擎由用户管理。
- [loopback 服务被其他本地进程占用或伪装] → 仅支持用户启动的固定 endpoint，逐次批准并暴露来源；本变更不宣称进程身份认证或对抗恶意本机软件。
- [查询或摘要含敏感数据，L1 会持久化它们] → 用户已选择 L1；限制结果长度、排除原始响应和秘密，并使用既有本地保留策略。
- [SearXNG 返回过大或畸形 JSON] → 设请求超时与读取上限，解析失败为结构化错误，且不把原始载荷记录或传给模型。
- [环境变量缺失导致工具不可用] → 工具保持未发现并提供清晰本地部署诊断；不回退到公共实例或任意网络地址。

## Migration Plan

1. 添加搜索 provider、endpoint 验证、工具定义和运行时条件注册；先以 fake SearXNG 覆盖输入、拒绝和错误路径。
2. 完成真实工具循环、批准、WebSocket 事件及 L1 双层日志的集成与端到端测试。
3. 添加外部 Docker Compose、设置样例和使用文档；由用户手动启动后，使用配置的 loopback endpoint 做真实 smoke。
4. 回滚时移除 `ACTIONDRIVER_SEARXNG_ENDPOINT` 或停用注册；模型恢复为没有 Web Search 的既有工具列表，已有本地审计记录保留且不会被伪装为成功搜索。

