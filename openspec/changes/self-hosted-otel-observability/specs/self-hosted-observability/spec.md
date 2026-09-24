## Purpose

定义 ActionDriver 在单机自托管环境中产生、采集和查询运行日志、分布式调用链、指标与完整模型调用内容的可验证行为，并明确各类数据的事实来源和故障边界。

## ADDED Requirements

### Requirement: 本地启动可持久化的观测平台
系统 SHALL 提供可由 Docker 在本机启动的日志、链路、指标、模型观测和可视化服务，并 SHALL 为需要保留历史的服务配置持久化存储；平台 SHALL NOT 依赖 LangSmith 云服务或其 API Key 才能展示模型调用。

#### Scenario: 启动本地平台
- **WHEN** 操作者按项目文档启动观测服务
- **THEN** Grafana、Loki、Tempo、Prometheus、Alloy 和 Phoenix 的健康状态及访问入口可检查，并在服务重启后保留已确认写入的历史数据

#### Scenario: 未提供 LangSmith 凭据
- **WHEN** 启动环境未设置 `LANGSMITH_API_KEY`
- **THEN** 本地观测平台仍能接收和展示新产生的模型调用

### Requirement: 运行日志使用 OpenTelemetry 日志信号
Desktop Main 与 Agent Runtime SHALL 通过 OpenTelemetry Logs SDK 产生结构化运行日志，并 SHALL 将其发送到本地采集器与 Loki；容器服务的运行日志 SHALL 同样进入 Loki。日志 SHALL 包含服务名、级别、时间及可用的任务、请求和 trace 关联标识。

#### Scenario: 查询一次失败的运行日志
- **WHEN** 一次已采集的运行操作失败且产生日志
- **THEN** 操作者可在 Grafana/Loki 按服务和时间找到错误记录，并利用关联标识定位对应调用链

#### Scenario: 采集器不可用
- **WHEN** 本地采集器不可用或日志批处理队列耗尽
- **THEN** 应用的主要任务流程不因运行日志发送而失败；系统 SHALL 暴露可诊断的发送失败状态，但不承诺集中运行日志在此期间完整保存

### Requirement: 跨边界调用链可关联
系统 SHALL 为进入 Runtime 的请求、任务执行、工具调用和模型调用产生关键链路节点，并 SHALL 在 HTTP、WebSocket 或 Electron IPC 等实际跨进程边界传播或显式关联 trace 上下文。链路与运行日志 SHALL 使用可互相定位的标识。

#### Scenario: 定位一次模型调用失败
- **WHEN** 用户提交任务并经历 IPC、Runtime、工具和模型调用后失败
- **THEN** 操作者可在 Grafana/Tempo 查看该次调用的关键节点、耗时和失败位置，并可转到相关 Loki 日志

### Requirement: 模型原文仅由本地 Phoenix 承载
系统 SHALL 在本地 Phoenix 中保存已启用观测的模型调用完整提示词、输入、输出和错误详情；Tempo 与 Loki SHALL NOT 保存这些原文，而 SHALL 只保存定位调用所需的元数据与关联标识。

#### Scenario: 查看完整模型调用
- **WHEN** 一次模型调用完成且 Phoenix 已成功接收追踪
- **THEN** 操作者可从 Phoenix 查看该调用的完整输入输出，并可通过共同关联标识与 Grafana 中的链路对应

#### Scenario: 验证数据边界
- **WHEN** 一次测试调用包含可识别的提示词与模型回复
- **THEN** Phoenix 中可检索到原文，而 Tempo span 与 Loki 日志中均找不到该原文

### Requirement: 指标与告警在 Grafana 可用
系统 SHALL 采集服务运行与关键操作的计数、失败和延迟指标，并 SHALL 使其在本地 Grafana 中可查询及用于告警。

#### Scenario: 查看运行状态
- **WHEN** 服务持续处理请求并产生成功或失败结果
- **THEN** 操作者可在 Grafana 查看请求量、错误率和耗时，并可定位到相关日志或链路

### Requirement: 接口交互详情不依赖集中平台
系统 SHALL 保留现有本机接口交互日志的写入、筛选和详情读取路径；集中观测平台不可用 SHALL NOT 使已保留的本机接口详情无法查看。

#### Scenario: 本地平台停止后查看接口详情
- **WHEN** Grafana、Loki、Tempo、Alloy 和 Phoenix 均未运行，但本机已有接口交互记录
- **THEN** 用户仍可在 ActionDriver 中筛选记录并查看保留期内的请求和响应详情
