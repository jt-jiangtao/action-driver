## Context

动机和裁决见 proposal.md。当前 web 插件的 search 从普通插件 storage 获取 SearXNG endpoint，reader 使用本地 HTTP 与宿主 `host.web.extract`。Runtime 在启动时把环境中的 endpoint 写入 web 配置。SDK 与 PluginHostAPI 已支持带权威调用上下文的 `credentials.request`，但 Runtime 尚未为 web 装配对应凭据端口。

参考实现：lattice-agents 的 `apps/agent-server/internal/websearch/searcher.go` 使用 Jina Reader JSON 响应，但其旧免费额度说明不作为本次设计依据。协议依据：[Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)、[Jina Reader](https://jina.ai/reader/)。未验证用户本轮提供的密钥或剩余额度；之前验证的 lattice-agents 密钥不是本轮选定密钥。

## Goals / Non-Goals

**Goals:** 保留 `tools.local.web.search/open` 身份、grants 授权、取消和回放；两个凭据独立配置、两个工具独立可用；明确配置、认证、额度、限流与内容错误；用定向测试验证协议与秘密不泄漏。

**Non-Goals:** 本次不实现备用 provider 自动切换、自动重试、缓存、余额查询、自动充值、Browser 登录态、新配置页面或官方 SDK。没有默认的“搜索后读取全部结果”流程，也不引入 Tavily Extract 或 Jina Search。

## Decisions

### 1. Tavily 搜索与 Jina 读取分别作为唯一默认实现

用户最终裁决：Search 使用 Tavily，Open 使用 Jina Reader。相比继续使用 SearXNG + 静态读取，减少外部 Docker 维护并覆盖远端渲染内容；相比 Tavily Search + Extract，两个工具使用用户指定的独立供应商与凭据。用户覆盖项：放弃此前推荐的 Tavily Extract 兜底，接受两个供应商的配置与额度管理成本。保留本地静态读取兜底未获本次裁决，不加入自动链路。

成功标准：分别正确返回来源结果与非空正文；取消终止请求；缺密钥、认证失败、限流、额度耗尽、响应错误明确呈现；秘密不出现在模型、归档或日志。无成功率或免费请求次数保证。

### 2. 使用现有宿主凭据接口与本地环境配置

首版 Runtime 从可信本地启动环境的 `TAVILY_API_KEY`、`JINA_API_KEY` 读取秘密，在宿主内存中保存并通过现有 `credentials.request` 按调用授权发给 web 插件。只允许 web 插件在相匹配工具调用中请求指定凭据，禁止任意插件获取这两把密钥；凭据不得通过普通 storage 持久化或注入其他插件进程环境。非秘密 configuration 仅记录各工具是否配置。

用户提供的值在实施配置阶段仅写入 Git 忽略的本地运行配置，并限制文件权限，不进入规划文件。复用现有本地启动配置机制，不增加凭据存储数据库或新公共接口。备选将 key 放入插件 configuration 会落入普通 JSON 持久化，不采用。缺一个凭据仅隐藏对应工具，不阻断另一个工具或整个插件启动。配置变化在 Runtime 重启后的新调用中生效。

### 3. Tavily 请求固定端点且限制额度相关参数

向 `https://api.tavily.com/search` 发 POST JSON，通过 Authorization Bearer 认证，不将密钥放 URL。schema 保留 query（1–512 字符）及 maxResults（1–10，默认 5），移除 SearXNG 专属 categories、language、safesearch、pageno；首次实施不扩大筛选能力。固定 `search_depth: basic`、`auto_parameters: false`、`include_answer: false`、`include_raw_content: false`，避免隐式升级搜索深度或生成答案。

把 title/url/content 映射到既有 title/url/snippet；provider 名用于明确来源，不伪造 engines。URL 必须为无凭据的公网 HTTP(S) URL 字面形式；不会为了校验搜索结果而联网读取目标。固定字段和总响应限制，不将原始 provider 响应写进记录。

### 4. Jina Reader 使用单个公网 URL 并保留输出契约

请求前复用公网 URL 校验（包括 DNS 解析），向 `https://r.jina.ai/<目标URL>` 发请求，Accept JSON、Authorization Bearer；仅发送目标 URL，不转发 Cookie、用户认证或本地代理凭据。宿主至供应商的 HTTP 请求不跟随重定向，凭据不会转发给其他服务。响应映射成现有 `{title,url,text,truncated}`，text 保存 Jina 提取的可读正文，不执行或渲染返回内容。最大 12,000 Unicode 字符、标题 256 字符；正文为空或明显的登录/验证码页返回不可读取错误。供应商如提供来源 URL则校验后返回，否则使用经校验的输入 URL，禁止把后者宣称为已验证的最终 URL。

Jina 可在服务端渲染脚本，宿主不再承诺“目标页面没有执行脚本”；它依然不携带用户会话，也不通过 Browser Skill 交互。备选在本地自动启动浏览器扩大运行边界，本次不采用。

### 5. 统一生命周期和受限失败

每个调用总时限默认 30 秒，Tavily 响应最多 256 KiB，Jina 响应最多 1 MiB，均包含网络读流与解析时间。继续响应调用取消；不将取消误报成超时。HTTP 401/403 映射认证/访问失败，429 映射限流，Tavily 432/433 等额度错误单独报告，网络、5xx、非 JSON、畸形数据和大小超限使用稳定错误码。错误信息由本地模板生成，不直传可能回显密钥的第三方 body 或异常文本。首版不自动重试，避免额外计费；provider 故障不悄悄转发到其他供应商。

## Risks / Trade-offs

- [第三方数据处理] → 用户已选择云 API；描述公开查询交给 Tavily、目标 URL 交给 Jina；不给服务发送本地文件、Cookie 或其他供应商密钥。
- [远端访问链路不可控制] → 宿主校验输入与返回的来源，阻止明显非公网 URL；不能把此前“每次目标重定向校验/DNS 地址固定”的本地保障描述为 Jina 服务保证。若验证发现 Jina 会交付不安全来源，拒绝结果；新的安全边界冲突需重新 Battle。
- [免费额度不足及共享限流] → 不承诺 Jina 每日免费额度；明确 Search/Reader 各自消耗额度，默认 basic，无自动充值或升级。
- [供应商正文不完整、验证码被当正文] → 有限质量检查和真实站点验收，失败明确报告，不虚构读取成功；质量识别不能保证覆盖所有网站。
- [旧 schema 不兼容] → 保留历史展示和结果回放，移除参数不静默忽略；新调用只发现新 schema。
- [本地环境文件为明文] → 只存在用户本地、文件权限受限、被 Git 忽略，不拷贝入包和沙箱；不新增未经裁决的密钥管理系统。

## Migration Plan

1. 补齐 web 专属凭据装配与可用性，然后实现两个 provider，更新 catalog 和运行文档。
2. 替换默认配置入口；旧 SearXNG endpoint 不再启用搜索，文档明确迁移至 Tavily key。保留旧模块与部署说明作为历史参考，不在本次删除无关代码。
3. 实施阶段写入两把用户已提供密钥到忽略的本地配置，重启 Runtime；进行一次 Search 和一次 Reader 冒烟，只报告状态与结果数量/长度。
4. 迭代只跑定向测试；准备提交时一次运行 typecheck/lint/test，运行时改动按需追加本地/打包 E2E，记录结果。不在规划阶段运行全量测试或提交。
5. 回滚通过恢复此前插件与 Runtime 版本及 SearXNG 配置完成；本次不迁移历史任务数据，历史结果继续可读。

## Implementation Rulings

- Ruling: 当前 agent-tool-runtime 已裁决合法 grant 调用自动执行；本规划中的旧审批措辞按该既有策略校正，未授权调用不得发网，不恢复逐次审批。补充对应 runtime delta，使 Tavily 装配条件一致。
- Ruling: 项目尚未自动加载本地 env 文件；开发入口增加 `.env.local` 加载（环境变量优先），使批准的本地凭据配置在 pnpm dev 启动时实际生效。文件忽略且权限 0600，打包程序仍可通过可信启动环境配置。

### Fake-IP DNS 裁决（2026-09-28）

真实冒烟发现系统 DNS 返回 198.18/15 保留地址。比较直接拒绝（安全但代理网络不可用）、放开保留地址（破坏公网限制）、固定 Cloudflare DoH 验证。推荐第三项，用户明确裁决采用。仅系统结果包含 Fake-IP 且无其他非公网地址时向固定 HTTPS Cloudflare 端点查询 A/AAAA；全部答案必须为公网，否则拒绝。不发送供应商凭据，重定向拒绝，受同一取消和 30 秒预算约束。风险：目标域名交给 Cloudflare；校验只验证公网属性，实际页面由 Jina 获取，无法固定 Jina 的远端 DNS。真实内网、字面量 Fake-IP、DNS 失败均不放行。

### 缓存版本修复

用户重启后仍失败，最新数据库调用时间与新进程吻合；安装目录 web/1.2.0 的 extension 不含 DoH，而构建目录包含 DoH。FilesystemPluginRepository.publish 将版本包视为不可变，同版本不覆盖。因此递增 web 清单/package 版本以通过已有发布流程安装新代码，保留旧缓存与数据；不改变通用插件缓存语义。这是既有方向中的执行型修复。
