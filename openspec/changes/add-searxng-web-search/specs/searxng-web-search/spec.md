## Purpose

定义 ActionDriver 如何通过用户本机独立运行的 SearXNG 检索公开网页索引，同时保持明确的出站网络、结果内容和本地审计边界。

## ADDED Requirements

### Requirement: 仅连接显式配置的本机 SearXNG 服务
系统 MUST 仅在配置了有效的 loopback SearXNG HTTP endpoint 时注册 Web Search Tool；endpoint MUST 使用 `http`、字面量 `127.0.0.1` 或 `[::1]` 主机及显式端口，并且工具只可请求该 endpoint 的 `/search` 路径。系统 MUST NOT 跟随重定向、解析任意主机名或把调用转发至其他网络地址。

#### Scenario: 未配置本机服务
- **WHEN** Runtime 未收到有效的本机 SearXNG endpoint
- **THEN** 系统不向模型发现 `web.search@1`，且不发起任何网络请求

#### Scenario: 配置非 loopback endpoint
- **WHEN** 配置的 endpoint 包含非 loopback 主机、非 HTTP 协议、缺失端口或非根路径
- **THEN** 系统拒绝启用 Web Search 并提供稳定的配置错误，且不向该地址发起请求

### Requirement: 以受限输入执行 JSON 搜索
系统 SHALL 将模型调用映射为 SearXNG 的 JSON 搜索请求，且 MUST 校验查询文本、分类、语言、Safe Search、页码和结果数量。系统 MUST 对请求设置超时、请求体及响应体大小限制，并且 MUST NOT 请求搜索结果页面正文、图像、下载资源或后续 URL。

#### Scenario: 执行有效搜索
- **WHEN** 用户批准包含合法查询和筛选参数的 Web Search 调用
- **THEN** 系统仅向已配置 endpoint 的 `/search` 发出带 `format=json` 的请求，并把限定数量的结果交回同一模型工具调用链

#### Scenario: 搜索参数无效
- **WHEN** 模型提供空查询、未知筛选参数或超过允许范围的结果数量
- **THEN** 系统以 `TOOL_INPUT_INVALID` 终止该调用，且不向 SearXNG 发起请求

### Requirement: 返回可归因且有上限的规范化结果
系统 MUST 仅从成功的 SearXNG JSON 响应中提取标题、URL、摘要、引擎或类别等可用来源元数据，并 MUST 限制单项字段长度、结果数和总输出字节数。系统 MUST 标记截断；响应格式错误、超时、非成功 HTTP 状态或超出限制 MUST 产生结构化工具错误。

#### Scenario: 返回搜索摘要
- **WHEN** SearXNG 返回可解析的多个搜索结果
- **THEN** 系统按确定顺序将受限的标题、URL、摘要和来源元数据返回给模型，且不包含原始响应体

#### Scenario: 上游响应不可用
- **WHEN** SearXNG 超时、返回重定向、非 JSON、错误状态或超出响应上限
- **THEN** 系统记录结构化失败并将其作为工具结果交回模型，不尝试访问结果 URL 或其他主机

### Requirement: L1 本地审计记录不含秘密或原始响应
系统 MUST 将搜索查询、调用参数和截断后的规范化结果写入既有本地工具聚合记录及实际模型调用记录，以支持 L1 审计。系统 MUST NOT 将 API key、认证头、Cookie、代理凭据、原始 SearXNG 响应或容器环境秘密写入工具输出、WebSocket 帧、交互日志或模型上下文。

#### Scenario: 查询并查看调用链
- **WHEN** 已完成的 Web Search 被用户在本地日志中查看
- **THEN** 工具层和模型层均可关联该调用的查询与截断结果摘要，且任何秘密字段与原始响应均不可见

### Requirement: SearXNG 由应用外的本地部署提供
系统 MUST 提供可复现的本地 Docker 部署说明及 SearXNG 设置样例，要求服务只绑定 loopback 并启用 JSON 格式。桌面应用 MUST NOT 分发、启动、停止、更新或监控 SearXNG 容器，也 MUST NOT 管理其上游搜索引擎或凭据。

#### Scenario: 用户启动本地搜索服务
- **WHEN** 用户按部署文档在应用外启动 SearXNG 并配置有效 endpoint
- **THEN** ActionDriver 可调用其 JSON 搜索接口，但容器的生命周期仍完全由用户管理
