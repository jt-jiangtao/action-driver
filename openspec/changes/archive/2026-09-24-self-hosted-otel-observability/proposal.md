## Why

当前运行日志、接口交互详情与模型调用记录分散在本机文件、本机存储和正在实施的 LangSmith 方向中，无法在本地部署的统一平台中按一次任务关联错误、耗时与模型原文。需要建立可真实验收的自托管观测链路，并停止新增本机接口日志存储。

## What Changes

- 使用 OpenTelemetry JavaScript Logs SDK 代替 Pino 产生 Main 与 Runtime 的结构化运行日志；通过 OTLP 送入本地 Docker 中的 Alloy，再进入 Loki。容器自身日志也由 Alloy 采集。
- 为 HTTP、IPC、任务、工具及模型等关键边界建立 OpenTelemetry trace，上报 Tempo；运行日志与 trace 共享关联标识。指标进入 Prometheus，由 Grafana 统一展示日志、链路、指标和告警。
- 在本地 Docker 中部署 Phoenix，保存并展示完整 LLM 提示词、输入和输出。Tempo 与 Loki 不保存这些原文；相关 trace 使用共同标识跳转 Phoenix。
- Grafana 在仅绑定本机端口的前提下使用匿名 Editor，并预置可直接查看 ActionDriver 日志、调用量、错误及耗时的仪表盘；Explore 可用于进一步查询。
- HTTP、IPC、WebSocket 调用摘要与其他运行日志统一通过 OpenTelemetry Logs SDK 进入 Loki，不再写本机日志文件或 `LocalInteractionLogStore`，也不再提供本机 `GET /logs` 与前端日志列表/详情。接口日志仅包含操作、方向、传输、结果、耗时、错误和关联标识，不记录任意请求/响应正文。
- ActionDriver 不再提供日志或观测平台页面、侧栏入口及外链按钮；操作者按运维文档从浏览器直接打开本地 Grafana/Phoenix，完整模型输入输出仍仅在 Phoenix 查看。
- **BREAKING** 模型日志不再以 LangSmith 为事实来源；现有未完成的 `use-langsmith-model-logs` 变更由本变更取代其后续方向。迁移时核对其未提交实现，不直接清除用户工作树。

## Capabilities

### New Capabilities

- `self-hosted-observability`: 定义本地 Docker 观测平台、OpenTelemetry 三类信号、日志与链路关联、Phoenix 内容边界及故障行为。

### Modified Capabilities

- `layered-log-viewer`: 移除整个应用内日志工作区及其侧栏入口；平台访问地址保留在运维文档。

## Impact

- 涉及 `packages/observability` 的日志 API 与交互记录器、Desktop Main/Preload/Renderer、Agent Runtime 的模型网关和调用链边界、依赖与测试。
- 新增独立的本地 Docker Compose 观测服务及其持久卷、采集器配置、Grafana 数据源和验收说明；不把应用 Runtime 强制迁入容器。
- Battle 已完成：用户选择 OpenTelemetry Logs SDK，覆盖保留 Pino 的建议；后续明确推翻早先保留本机接口详情的决定，选择所有接口与运行日志只存统一平台，并接受采集器不可用、SDK 内存队列耗尽时日志丢失及离线不可查的风险。完整 LLM 内容仅进入本地 Phoenix，Tempo/Loki 只保留关联元数据；任务业务状态存储不属于日志迁移。产品入口的后续裁决是移除整个应用内观测页面，而非保留外链按钮；用户接受平台地址只能从文档获取的可发现性代价。Grafana 空白首页的故障调查表明 Viewer 无 Explore 权限且无预置仪表盘；用户在“Viewer＋只读仪表盘”和“匿名 Editor＋仪表盘”之间选择后者，接受本机访问者可编辑仪表盘的风险。
