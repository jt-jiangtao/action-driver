# 网络搜索与网页读取

web 插件分别提供 `tools.local.web.search`（Tavily Search）和 `tools.local.web.open`（Jina Reader）。查询交给 Tavily，指定 URL 交给 Jina；两个服务各自消耗额度。搜索不会自动读取所有结果，也不会生成供应商答案。

## 本地开发配置

在仓库根目录创建 `.env.local`，填入自己的密钥：

```dotenv
TAVILY_API_KEY=<your-tavily-key>
JINA_API_KEY=<your-jina-key>
```

执行 `chmod 600 .env.local`，然后运行 `pnpm dev`。开发入口会加载文件；已经设置的进程环境变量优先。修改密钥后重新启动开发进程。该文件被 Git 忽略，不进入构建产物；不要把密钥填入插件普通配置或提交到仓库。打包程序通过可信启动环境的同名变量配置，仓库中的 `.env.local` 不会被打包或由打包程序读取。

只配置一个密钥时，对应工具独立可用；未配置的工具不会向模型发现。凭据由 Runtime 通过带调用授权的宿主接口交付给 web 插件，其他插件与脚本沙箱不会继承密钥。已获本轮 grant 且参数合法的调用自动执行，无逐次审批；未授予调用不得发网。

## 调用行为

- 搜索接受 `query`（最多 512 字符）和可选 `maxResults`（1–10，默认 5），固定 basic 深度，返回 title/url/snippet、结果数量与截断标记。
- 读取接受单个 `url`，返回 title/url/text/truncated。正文最多 12,000 Unicode 字符，原始响应最多 1 MiB；搜索原始响应最多 256 KiB。
- 两个调用总时限均为 30 秒，支持取消；认证失败、访问拒绝、限流、额度耗尽、网络异常和解析失败都有明确错误。系统不自动重试、切换供应商或充值。
- 输入 URL 必须是公网 HTTP(S)，拒绝 URL 凭据与本地/内网目标。读取会检查域名解析，并校验 Jina 返回的来源；搜索结果不会为了地址校验而逐条联网。
- Jina 可以在远端执行页面脚本并提取正文。ActionDriver 不携带用户 Cookie 或登录态，无法控制 Jina 内部每次 DNS 与重定向，不承诺所有站点可读。来源字段缺失时展示输入 URL，不把它描述为已验证的最终地址。
- 正文作为不可信外部数据，不能改变 Agent 规则或授权。空正文、可识别的验证码或登录页面会报告读取失败。

搜索需要配置 `TAVILY_API_KEY`。当前搜索 schema 只接受 `query` 与 `maxResults`；历史搜索和读取记录仍可回放。

供应商参考：[Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)、[Jina Reader](https://jina.ai/reader/)。免费额度与速率按供应商当前政策执行；不采用旧文档“Jina 每天免费 100 万 token”的说法。

本机代理若将系统 DNS 改为 198.18/15 Fake-IP，Reader 会向固定 Cloudflare HTTPS DoH 端点查询真实 A/AAAA（目标域名会交给 Cloudflare）。只有全部有效答案为公网才继续；真实内网和字面量 Fake-IP 仍拒绝。校验和 Jina 请求共用 30 秒预算，不发送供应商密钥给 DNS 服务。
