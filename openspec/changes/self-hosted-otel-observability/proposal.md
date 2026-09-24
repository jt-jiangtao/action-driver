## Why

当前运行日志、接口交互详情与模型调用记录分散在本机文件、本机存储和正在实施的 LangSmith 方向中，无法在本地部署的统一平台中按一次任务关联错误、耗时与模型原文。需要建立可真实验收的自托管观测链路，同时保留现有接口层日志的离线查看能力。

## What Changes

- 使用 OpenTelemetry JavaScript Logs SDK 代替 Pino 产生 Main 与 Runtime 的结构化运行日志；通过 OTLP 送入本地 Docker 中的 Alloy，再进入 Loki。容器自身日志也由 Alloy 采集。
- 为 HTTP、IPC、任务、工具及模型等关键边界建立 OpenTelemetry trace，上报 Tempo；运行日志与 trace 共享关联标识。指标进入 Prometheus，由 Grafana 统一展示日志、链路、指标和告警。
- 在本地 Docker 中部署 Phoenix，保存并展示完整 LLM 提示词、输入和输出。Tempo 与 Loki 不保存这些原文；相关 trace 使用共同标识跳转 Phoenix。
- 保留现有本机接口交互记录、请求/响应详情、筛选与离线查看。ActionDriver 日志页增加 Grafana/Phoenix 诊断入口，不复制两套平台的详情功能。
- **BREAKING** 模型日志不再以 LangSmith 为事实来源；现有未完成的 `use-langsmith-model-logs` 变更由本变更取代其后续方向。迁移时核对其未提交实现，不直接清除用户工作树。

## Capabilities

### New Capabilities

- `self-hosted-observability`: 定义本地 Docker 观测平台、OpenTelemetry 三类信号、日志与链路关联、Phoenix 内容边界及故障行为。

### Modified Capabilities

- `layered-log-viewer`: 保留接口层本机日志能力，并将模型层与运行诊断入口改为 Phoenix/Grafana 导航。

## Impact

- 涉及 `packages/observability` 的日志 API 与交互记录器、Desktop Main/Preload/Renderer、Agent Runtime 的模型网关和调用链边界、依赖与测试。
- 新增独立的本地 Docker Compose 观测服务及其持久卷、采集器配置、Grafana 数据源和验收说明；不把应用 Runtime 强制迁入容器。
- Battle 已完成：用户明确选择 OpenTelemetry Logs SDK，覆盖保留 Pino 的建议；明确保留本机接口详情，并接受采集器不可用、SDK 内存队列耗尽时集中运行日志可能丢失。完整 LLM 内容仅进入本地 Phoenix，Tempo/Loki 只保留关联元数据。规划仍须用户审查，尚未授权实施。
