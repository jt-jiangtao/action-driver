# tavily-web-search Specification

## Purpose
定义 ActionDriver 如何通过 Tavily 检索公开网页索引，使用独立且受授权的供应商凭据，并控制出站服务、规范化结果、取消、额度与本地审计边界。

## Requirements

### Requirement: 以受限输入执行 JSON 搜索
系统 SHALL 将查询和受限结果数映射为 Tavily JSON 搜索请求，默认 basic 深度，MUST 禁止自动升级深度、生成答案和额外正文提取。输入仅接受非空 query 与可选 maxResults（1–10，默认 5），未知字段 MUST 被拒绝。请求 MUST 有总超时与响应大小限制，并支持取消；系统 MUST NOT 自动调用网页读取、读取图片或访问结果链接。

#### Scenario: 执行有效搜索
- **WHEN** 本轮已授予且输入有效的合法 query 与 maxResults 的搜索调用
- **THEN** 系统只向 Tavily Search API 发起一次 basic 请求，返回限定数量的结果

#### Scenario: 搜索参数无效
- **WHEN** 输入为空、包含旧供应商专属字段或结果数量越界
- **THEN** 系统返回 `TOOL_INPUT_INVALID`，不发起请求

#### Scenario: 取消搜索
- **WHEN** 用户取消正在请求的搜索调用
- **THEN** 系统停止读取网络响应并记录取消状态，不自动重试

### Requirement: 返回可归因且有上限的规范化结果
系统 MUST 仅从成功的 Tavily JSON 响应中提取有上限的标题、公网 HTTP(S) URL、摘要及可用来源元数据，限制结果数量与总输出，并标记截断。系统 MUST 区分认证失败、限流、额度耗尽、网络失败、超时、非成功状态、畸形数据和超限，不交付原始 provider 响应。

#### Scenario: 返回搜索摘要
- **WHEN** Tavily 返回合法结果
- **THEN** 系统保持结果顺序并返回 title、url、snippet，忽略不安全或不合法 URL，不伪造来源元数据

#### Scenario: 上游响应不可用
- **WHEN** Tavily 返回认证、限流、额度错误、重定向、非 JSON、超时或超限
- **THEN** 系统记录稳定且不含秘密的结构化错误，不自动读取结果或切换供应商

#### Scenario: 查询无结果
- **WHEN** Tavily 返回合法空结果列表
- **THEN** 系统返回空列表，明确搜索完成但无结果，不报告已找到来源

### Requirement: L1 本地审计记录不含秘密或原始响应
系统 MUST 将查询、参数和受限规范化结果写入既有本地工具与模型记录。系统 MUST NOT 将 API key、认证头、Cookie、代理凭据、原始供应商响应或可能回显秘密的错误文本写入工具输出、WebSocket、日志或模型上下文。真实密钥 MUST 仅通过宿主可信本地配置加载，不提交至 Git、不分发至其他插件或任务沙箱。

#### Scenario: 查询并查看调用链
- **WHEN** 用户查看已完成的搜索记录
- **THEN** 可关联查询与结果，无法看到任何真实凭据或原始响应

#### Scenario: 上游错误回显密钥
- **WHEN** 第三方错误 body 或异常字符串包含认证信息
- **THEN** 系统用本地错误模板替代，不记录或展示该秘密

### Requirement: Tavily 搜索独立配置与可用性
系统 SHALL 在已配置 Tavily 凭据时向模型发现 `tools.local.web.search`，本轮已授予且输入有效时仅连接固定 Tavily HTTPS Search API；系统 MUST NOT 将密钥放入普通插件配置、请求 URL 或工具参数。搜索与 Jina Reader 的配置 MUST 独立，不得因其中一个未配置而阻断另一个。

#### Scenario: 未配置搜索密钥
- **WHEN** Tavily 凭据未配置但 Jina 凭据已配置
- **THEN** 搜索不可发现且不发起请求，网页读取仍可用

#### Scenario: 调用未获本轮授权
- **WHEN** 搜索调用未获得本轮 grant
- **THEN** 系统不向 Tavily 发起请求

#### Scenario: 凭据授权边界
- **WHEN** 其他插件或不匹配的工具调用请求 Tavily 凭据
- **THEN** 宿主拒绝，不交付秘密
