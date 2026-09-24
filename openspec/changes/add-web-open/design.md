## Context

详见 [proposal.md](proposal.md)。现有 `web.search@1` 通过本机 SearXNG 返回标题、URL 和摘要；`RuntimeToolRegistry`、`ToolInvocationService` 与任务归档已能承载新的网络工具。`apps/agent-runtime/src/searxng/search-tool.ts` 的 fetch 实现只连接固定 loopback JSON API，不适合任意公网 HTML。`implement-browser-use` 仍未实施，不能作为首版正文读取的运行依赖。

## Goals / Non-Goals

**Goals:**

- 用单 URL、单页面工具契约提供带来源的有限正文，供模型引用并在任务归档中查看。
- 在实际 TCP 连接处兑现公网限定，覆盖字面量 IP、DNS、重定向和 IPv4 映射 IPv6。
- 将网络传输、HTML 提取和工具展示分成可独立测试的单元。

**Non-Goals:**

- 不做浏览器导航、交互、登录、JavaScript 渲染、批量爬取、PDF 或附件下载。
- 不通过系统代理、用户浏览器会话或 SearXNG 代理请求目标页面。
- 不将 HTML 或 Readability 生成的 HTML 交给模型或界面渲染。

## Decisions

### 1. 独立静态工具，而非借用 Browser Skill

注册 `web.open@1` / `web_open`，输入 schema 只包含必填 `url`。默认向模型发现该工具；它与 `web_search` 分别负责搜索索引和读取已知页面。执行器返回 `{ title, url, text, truncated }`，并复用现有的取消、超时、日志和工具事件。任务活动与结果卡片针对该工具显示读取状态、标题及来源。

备选方案是先实现 Browser Skill，再复用浏览器 DOM 文本。浏览器可以处理动态站点，但会把简单读取与尚未完成的交互导航、会话状态和 UI 面板绑定，导致首版范围扩大。用户已选择独立静态读取；动态页面留给 Browser Skill。另一个较小方案是继续只用 `web_search` 摘要，其信息量不足以核实正文，未采纳。

### 2. URL 校验与实际连接使用同一地址决策

Runtime 的网络适配器使用 Node `http`/`https` 请求，并显式提供受控 `lookup`：先解析全部候选地址，使用 IP 分类库将 IPv4 映射 IPv6 规范化；只要有一个候选地址不是公网单播就拒绝，否则固定选中的公网地址供连接使用。字面量 IP 直接按相同规则校验；URL 禁止 userinfo、非 HTTP(S) 协议及空主机。保留原主机名用于 HTTP Host、TLS SNI 和证书校验。请求不使用系统代理，不发送 Cookie 或 Authorization。重定向手动处理，最多 3 次；每跳解析相对 `Location` 并重复全部校验。连接建立后的远端地址再核验，不一致即关闭。

备选方案是先用 `dns.lookup` 检查，再直接 `fetch`。解析与连接之间可能发生 DNS rebinding，`fetch` 还可能自动跟随跳转，因此无法证明实际连到的地址受限。用户明确裁决仅访问公网，此风险不能接受。另一备选是只放行 HTTPS 且禁止所有重定向；实现较简单，但会拒绝常见公开站点的 HTTP→HTTPS 或规范 URL 跳转，因此选择受限跟随。

### 3. 有界下载与文本提取

只接受 `text/html` 或 `application/xhtml+xml`，使用 GET 和明示的 `Accept`，不执行脚本、不请求子资源。传输按流计数，压缩传输还分别限制压缩与解压字节；网络总时限 15 秒，最多 3 次重定向，原始响应上限 2 MiB，解压后上限 4 MiB。解析时用 jsdom 创建无脚本、无外部资源的 DOM，用 Mozilla Readability 优先提取正文；若其不适合短页面，则对移除脚本、样式、导航等无关节点后的 body 文本做确定性回退。标题优先使用提取标题，其次 HTML title，最终用主机名。输出正文统一空白，最多 12,000 个 Unicode 字符；超出时截断并标记，空正文返回明确错误。HTTP 错误、非 HTML、超限和超时使用稳定错误类别，不把原始响应暴露给模型。

备选方案是手写正则或 DOM 启发式提取，依赖少但容易把导航、脚本和广告混入正文；选择已维护的 Readability。使用 jsdom 的开销高于轻量 DOM，但它是 Readability 官方 Node 用法，兼容性优先。实现时固定依赖版本，并确保不启用 `runScripts`、`resources` 或 `JSDOM.fromURL`。

### 4. 页面数据与提示边界

工具输出仅包含截断后的纯文本和最终来源 URL。模型能引用来源，但页面内容不会写入系统提示，也不参与工具授权或 URL 策略。任务视图从既有工具记录展示可读卡片；活动标题与图标沿用统一尺寸和状态样式。搜索结果仍可将 URL 传给 `web_open`，但工具自身不自动遍历链接。

备选方案是返回清洗后的 HTML 或 Markdown，以保留链接和版式。其结果体积与不可信标记面更大，还会让界面承担 HTML 消毒；首版选择纯文本。

## Risks / Trade-offs

- [JavaScript 网站、登录墙或反爬限制使正文为空] → 返回明确错误，用户可改用 Browser Skill；不绕过认证。
- [DNS rebinding 或重定向触达本地服务] → 在连接使用的地址上校验并固定公网目标，每跳重复，实际远端不符立即终止。
- [HTML 畸形或压缩炸弹耗费资源] → 限制传输和解压体积、正文长度、重定向次数与总时间；解析只在有界内容上执行。
- [外部网页出现提示注入内容] → 只交付有界纯文本，并保持工具结果的不可信来源语义；不把它拼入高优先级提示。
- [Readability 忽略短公告或列表页] → 在无正文时使用有限 body 文本回退；不能保证所有站点都能得到高质量正文。
- [依赖增加打包体积] → 只在 agent-runtime 打包 DOM 与提取库；实现后核对构建产物大小。
- 用户选择推荐的公网限定方案，没有覆盖 Agent 的安全建议。

## Migration Plan

1. 新增独立网络适配器与正文提取器，并用可注入解析/传输边界测试公网校验、DNS 变化、重定向、压缩和取消。
2. 注册工具并接入活动标题与可读结果展示；用模拟模型调用验证搜索 URL 后读取正文、归档回放及失败路径。
3. 验证类型、测试和桌面构建；无需迁移 SQLite 或旧任务。回滚可移除工具注册，已有工具记录仍按通用记录展示。
