## Why

当前模型层日志由本地 Runtime 的 `model_calls` 投影生成，详情页还会在应用内复制请求与响应。用户已明确选择将 LangSmith 作为唯一模型层日志来源：保留会话列表的快速浏览体验，但把调用详情交给 LangSmith UI，避免两套日志事实来源不一致。

## What Changes

- Runtime SHALL 使用标准 `LANGSMITH_API_KEY`、可选 `LANGSMITH_ENDPOINT` 与 `LANGSMITH_PROJECT` 环境变量把每次模型调用追踪到 LangSmith，并以 ActionDriver 的会话和任务标识关联 trace/thread。
- 模型层日志列表 SHALL 从 LangSmith 查询会话/trace 数据并映射为现有会话视图；成功为空时显示空状态，读取失败时显示可诊断错误和重试，MUST NOT 回退到本地或 Mock 模型日志。
- 模型层日志中的会话和任务“详情”操作 SHALL 在应用内隔离的 Electron `WebContentsView` 中展示受验证的 LangSmith Web URL；应用内自制调用详情视图及其本地请求/响应投影 SHALL 被移除。
- **BREAKING** `model-log.get` 与本地 `model_calls` 不再作为模型层日志 UI 的数据源；本地任务、消息和接口层交互日志不受影响。
- 首版仅通过 Runtime 启动环境变量配置 LangSmith，不新增应用内 LangSmith 设置页或本地凭据持久化。

## Capabilities

### New Capabilities
- `langsmith-model-observability`: 定义 Runtime 对 LangSmith 的模型调用追踪、会话查询和安全 URL 生成边界。

### Modified Capabilities
- `layered-log-viewer`: 模型层日志从本地/Mock 详情视图改为 LangSmith 会话列表及外部详情导航。

## Impact

- 影响 `apps/agent-runtime` 的模型网关、Runtime RPC 与依赖；新增 LangSmith JavaScript SDK，并使用环境变量提供配置。
- 影响 Desktop Main、Preload、共享 IPC 合同和 Renderer 模型日志服务/视图；Main 负责经白名单验证后创建、定位并关闭隔离的 LangSmith 视图。
- 本地 `model_calls` 可继续作为非 UI 的运行审计或迁移兼容数据，但不得再被模型层日志页面读取。
- Battle 已完成：用户裁决采用 LangSmith 唯一事实来源，并接受系统提示词、用户输入和模型输出出站，以及离线或追踪服务不可用时模型层日志不可查看的代价。后续 Battle 裁决将详情改为应用内 `WebContentsView`；用户已知需要隔离远程内容和处理登录、导航、视图生命周期。应用内配置页仍不在本次范围内。
