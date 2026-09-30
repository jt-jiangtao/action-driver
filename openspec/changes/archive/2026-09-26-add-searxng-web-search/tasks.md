> 后续决策：`remove-interactive-tool-approval` 将移除新调用的逐次审批。已勾选任务保留初次接入的历史验收事实，新变更另有迁移与回归任务。

## 1. 搜索工具契约与本机目标校验

- [x] 1.1 在 Agent Runtime 新增 SearXNG provider / executor 与 `web.search@1` 定义，校验查询和筛选输入 schema；通过单元测试验证合法输入、空查询、未知字段和结果数量上限。
- [x] 1.2 实现 `ACTION_DRIVER_SEARXNG_ENDPOINT` 的字面量 loopback URL 校验与固定 `/search` 请求构造；通过单元测试验证 IPv4/IPv6 合法地址以及协议、主机、端口、凭据、路径和重定向拒绝。
- [x] 1.3 实现有超时和响应字节上限的 JSON HTTP 客户端，并将结果规范化为截断的标题、URL、摘要和来源元数据；通过 fake SearXNG 测试覆盖成功、畸形 JSON、非成功状态、超时、重定向和过大响应，确认不请求结果链接。

## 2. Tool Runtime 与日志集成

- [x] 2.1 在 Runtime 装配中仅于 endpoint 有效时注册并授予 Web Search Tool；通过组合根 / 进程测试验证未配置时工具不可发现、无效配置不发网、有效配置时模型请求包含 `web_search`。
- [x] 2.2 复用既有网络副作用策略和一次性批准状态机接入搜索调用；通过工具调用测试验证 `waiting_approval`、匹配参数哈希批准、拒绝、陈旧批准、超时和取消均不会越过批准边界。
- [x] 2.3 确保规范化结果进入工具聚合记录、WebSocket 事件和后续真实模型回合，并实施 L1 日志清洗；通过集成测试验证查询及截断摘要可关联，同时 API key、认证头、Cookie、代理凭据和原始 SearXNG JSON 不出现于任何记录。

## 3. 真实调用闭环

- [x] 3.1 扩展本地 fake OpenAI 工具服务器与 fake SearXNG 服务，完成“模型请求搜索 → 用户允许一次 → 搜索结果 → 模型最终答案”的端到端测试，并验证最终助手 Markdown 不混入工具进度。
- [x] 3.2 增加端到端负向覆盖：用户拒绝、无 endpoint、无效 endpoint、搜索服务失败和结果截断；验证模型收到结构化工具结果，且不存在绕过 loopback 或访问结果 URL 的网络请求。

## 4. 用户管理的本机部署

- [x] 4.1 新增不进入 Electron 打包流程的 Docker Compose 与 SearXNG `settings.yml` 样例，将端口绑定至 loopback 并启用 JSON 输出；通过 Docker Compose 配置校验及本机健康检查验证样例可启动。
- [x] 4.2 编写本机部署与故障排查文档，说明 Docker 前置条件、启动/停止命令、endpoint 环境变量、健康检查、JSON API 验证、日志边界和应用不管理容器的限制；按文档从干净环境完成一次手动 smoke。

## 5. 回归验证

- [x] 5.1 运行受影响 workspace 的类型检查、单元测试和工具 Runtime E2E；记录命令及结果，并确认现有 Sandbox 默认禁网测试和模型文本流测试保持通过。
- [x] 5.2 在已配置本机 SearXNG 与真实模型的环境执行一次搜索 smoke，确认实际双层日志和一次性批准可观察；若环境不可用，记录阻塞原因并保留 fake 服务端到端证据（当前未配置用户的真实模型连接；本机 Docker JSON health check 与 fake OpenAI/SearXNG E2E 均已通过）。
