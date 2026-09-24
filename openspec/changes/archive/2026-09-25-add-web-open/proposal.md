## Why

现有 `web_search` 只能提供搜索结果标题和摘要。Agent 找到来源后仍无法在同一工具循环中读取公开网页正文，因而难以核对细节和给出准确来源。首版增加受控的静态网页读取能力，不依赖尚未完成的交互式 Browser Skill。

这是产品与架构决策型变更，Agent Battle 已完成。用户选择独立的静态 `web_open`，并确认只允许访问公网 HTTP(S) 页面，重定向后仍须保持这一边界。已比较直接复用 Browser Skill 的方案；没有未裁决的关键分歧。

## What Changes

- 新增版本化 `web.open@1` 工具（模型名 `web_open`），接受单个 URL，返回网页标题、正文文本、最终来源 URL 和截断状态。
- 对初始 URL、DNS 解析结果、实际连接地址与每次重定向执行公网校验；拒绝本机、内网、保留地址、凭据 URL 和非 HTTP(S) 目标。
- 对下载、解压、解析、正文长度、重定向次数和执行时间设上限；只处理静态 HTML，不运行页面脚本或加载子资源。
- 复用现有工具注册、取消、事件与任务归档；任务界面显示“读取网页”的具体状态和来源，搜索工具保持独立。

## Capabilities

### New Capabilities

- `public-web-page-reading`: 定义静态网页读取、网络目标限制、正文提取、资源上限、来源归因和错误行为。

### Modified Capabilities

无。现有 `agent-tool-runtime` 的通用工具生命周期、取消和归档要求已经覆盖新工具。

## Impact

- 影响 `apps/agent-runtime` 的网络执行器、工具注册和活动标题，以及桌面端工具结果展示。
- 新增 HTML 正文提取、DOM 解析和 IP 地址分类依赖；不改变模型协议、SQLite 会话结构或 SearXNG 部署。
- 不支持登录、点击、执行 JavaScript、下载附件、PDF、自动爬取链接或访问本地服务；这些能力属于独立的 Browser Skill 或后续变更。
