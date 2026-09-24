## 1. LangSmith Runtime 边界

- [x] 1.1 将 `langsmith` JavaScript SDK 加入 `apps/agent-runtime`，实现只从 `LANGSMITH_API_KEY`、`LANGSMITH_ENDPOINT`、`LANGSMITH_PROJECT` 构造的 LangSmith 适配器，并以单元测试验证缺配置、非法端点和凭据不泄漏。
- [x] 1.2 扩展模型请求上下文，使模型网关可取得稳定的 `sessionId`，在成功、流式终态和失败路径创建/完成 LangSmith trace，并以单元测试验证关联 metadata、输入输出、用量、错误和 API Key/鉴权头过滤。
- [x] 1.3 实现 LangSmith 根 trace/thread 查询、会话/任务摘要映射和详情地址生成；以适配器测试验证分页/排序、空结果、查询失败、状态映射以及不可信 URL 被拒绝。
- [x] 1.4 将 `model-log.list` 切换为 LangSmith 查询结果，移除 `model-log.get` 的生产读取职责及本地投影依赖；运行 Runtime contracts、`local-runtime-server` 与模型日志相关测试验证无本地/Mock 回退。

## 2. Desktop 安全导航与列表体验

- [x] 2.1 在共享合同、Preload 与 Desktop Main 增加类型化内嵌详情展示、定位、关闭入口；仅允许当前查询记录产生、HTTPS 且匹配 LangSmith Web origin 的初始地址，隔离远程内容并拒绝非 HTTPS 导航与弹窗，以 Main/Preload 单元测试验证允许和拒绝路径。
- [x] 2.2 调整 Renderer 模型日志 DTO 与 `ModelLogService`，保留会话/任务视图、筛选、搜索、展开、自动刷新和错误重试，使用 LangSmith 摘要及详情标识；更新服务和组件测试验证成功、空集合及读取失败状态。
- [x] 2.3 移除自制 `ModelSessionDetail`、本地请求/响应区块和相关详情状态；将会话与任务详情按钮改为应用内隔离视图，并以组件测试验证关闭后列表状态不被重置、页脚明确 LangSmith 来源。

## 3. 端到端验证与文档

- [x] 3.1 使用受控 LangSmith 适配器完成跨 Runtime、IPC 和 Renderer 的集成测试，验证同一 ActionDriver 会话聚合、成功/失败/空/未配置状态、筛选刷新以及不可信详情地址拒绝。
- [ ] 3.2 在隔离的真实 LangSmith 项目中完成桌面端手工或 E2E 验证：提交真实模型调用后会话出现在模型层列表，点击会话和任务详情均在应用内隔离视图显示正确页面；记录所需环境变量与已接受的数据出站/离线限制。
- [x] 3.3 运行针对变更的 `corepack pnpm exec vitest run` 测试集、`corepack pnpm --filter @actiondriver/agent-runtime typecheck`、Desktop 类型检查和 `openspec validate use-langsmith-model-logs --strict`，确认所有命令通过后再更新任务勾选状态。
