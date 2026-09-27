## MODIFIED Requirements

### Requirement: 读取单个公开网页
系统 SHALL 提供现有 `tools.local.web.open` 工具，接受单个公网 HTTP(S) URL，使用 Jina Reader 返回有上限的标题、提取正文、来源 URL 与截断标记。系统 MUST NOT 自动读取正文链接或携带用户会话；Jina 服务可渲染目标页面脚本，系统 MUST 明确第三方读取边界，不承诺目标未执行脚本。Jina 凭据未配置时仅该工具不可用。

#### Scenario: 读取静态页面
- **WHEN** 本轮已授予且输入有效的有效公网 URL 且 Jina 返回可读正文
- **THEN** 系统返回有上限的标题、正文、来源 URL 和截断标记，关联当前调用

#### Scenario: 页面依赖脚本生成内容
- **WHEN** Jina 返回经远端渲染获得的正文
- **THEN** 系统可交付该正文；如服务未能提取，返回空正文或不可读取错误，不虚构内容

#### Scenario: 独立凭据
- **WHEN** 仅 Jina 凭据已配置
- **THEN** 网页读取可发现，搜索不可发现，不请求 Tavily 凭据

### Requirement: 限制出站网络目标
系统 MUST 在发送给 Jina 前拒绝 URL 凭据、本机、内网、链路本地、保留或其他非公网 IP，并校验输入域名的解析结果。宿主 MUST 只连接固定 Jina Reader HTTPS 服务，禁止跟随供应商 HTTP 重定向，不向目标网站发送用户 Cookie、认证或代理凭据。Jina API key MUST 仅发送给固定供应商服务。系统 MUST 校验供应商返回的来源 URL，拒绝非公网来源；系统 MUST NOT 将供应商内部 DNS、连接和重定向描述为宿主已校验的访问链路。

#### Scenario: URL 指向本地或内网
- **WHEN** 输入为 localhost、私有 IP、IPv4 映射的私有 IPv6 或域名解析到非公网地址
- **THEN** 系统在向 Jina 发送 URL 前拒绝调用

#### Scenario: 公网地址重定向到内网
- **WHEN** Jina 返回的来源 URL 为本机、内网或非 HTTP(S) URL
- **THEN** 系统拒绝结果，不向该来源发起本地请求；不得声称宿主已阻止 Jina 内部跳转

#### Scenario: DNS 地址在校验后发生变化
- **WHEN** 输入域名在宿主校验后发生 DNS 变化
- **THEN** 宿主仍仅连接固定 Jina 服务，不直接连接新目标；供应商对目标解析的限制属于第三方信任边界

#### Scenario: 供应商重定向
- **WHEN** Jina HTTPS API 返回 HTTP 重定向
- **THEN** 宿主拒绝跟随，不将密钥发送至重定向目标

### Requirement: 限制读取资源并提供明确失败
系统 MUST 限制 Jina 网络响应及解压后的字节数、正文长度和总时限，并响应取消。非成功状态、非 JSON、无法解析、空正文、识别出的登录或验证码内容、资源超限和超时 MUST 返回明确错误；认证、限流和额度错误 MUST 可区分。系统 MUST NOT 将原始 HTML、响应头、密钥、原始 provider 错误 body 或不受限正文交付模型，不自动重试或充值。

#### Scenario: 响应过大
- **WHEN** Jina 响应或解压后内容超过上限
- **THEN** 系统停止读取并释放连接，返回资源超限错误

#### Scenario: 正文过长
- **WHEN** 正文超过字符上限
- **THEN** 系统仅返回受限正文并将 truncated 设为 true

#### Scenario: 取消正在读取的页面
- **WHEN** 用户取消正在连接或读取的工具调用
- **THEN** 系统中止请求并记录取消终态，不误报超时

#### Scenario: 服务限流或认证失败
- **WHEN** Jina 返回限流或认证错误
- **THEN** 系统返回对应错误，不回显服务原始 body 或凭据

### Requirement: 展示来源和工具状态
系统 SHALL 在任务活动中区分网页读取的准备、运行、完成和失败，以可展开卡片展示标题、来源 URL、正文及截断状态，保持归档回放兼容。来源 URL MUST 使用通过校验的供应商 URL；如供应商未提供该字段则使用输入 URL，不宣称它是已验证的最终地址。网页正文 MUST 作为不可信数据处理，不得成为 Agent 指令或改变授权。配置文档 MUST 说明 URL 由 Jina 处理及额度限制。

#### Scenario: 查看已读取页面
- **WHEN** 用户展开已完成的网页读取工具行
- **THEN** 看到可读标题、来源、正文与截断提示，并可回放旧版结果

#### Scenario: 页面含指令样式文本
- **WHEN** 正文要求 Agent 忽略规则或发送凭据
- **THEN** 内容仅作为来源数据，不改变提示、工具授权或秘密访问权限

#### Scenario: Fake-IP DNS 通过固定公网解析验证
- **WHEN** 系统 DNS 返回 198.18/15 Fake-IP 且没有其他非公网地址
- **THEN** Reader MUST 仅向固定 Cloudflare HTTPS DoH 端点查询 A/AAAA，不附带供应商凭据，并拒绝重定向
- **AND** 至少一个有效答案且全部地址为公网才允许发送 Jina 请求，查询受同一取消和总时限约束
- **AND** 系统真实内网地址、字面量 Fake-IP 和解析失败 MUST NOT 通过此分支放行
