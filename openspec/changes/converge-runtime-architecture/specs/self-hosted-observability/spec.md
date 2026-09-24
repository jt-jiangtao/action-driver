## MODIFIED Requirements

### Requirement: 本地启动可持久化的观测平台
系统 SHALL 提供可由 Docker 在本机启动的运行日志、调用链、指标与可视化服务，并 SHALL 为需要保留历史的本地服务配置持久化存储；模型调用原文的权威来源 SHALL 为 LangSmith，模型日志页面在 LangSmith 不可用时 SHALL 显示读取错误而不得使用本地或 Mock 记录伪装成功。

#### Scenario: 启动本地平台
- **WHEN** 操作者按项目文档启动本地观测服务
- **THEN** Grafana、Loki、Tempo、Prometheus 和 Alloy 的健康状态与入口可检查，运行日志和指标可查询

#### Scenario: 未提供 LangSmith 凭据
- **WHEN** 未配置 LangSmith 凭据或服务不可达
- **THEN** Runtime 的主要任务仍可运行，模型层日志入口明确显示不可用及重试机会，不显示伪造记录

#### Scenario: 无需登录查看 Grafana 数据
- **WHEN** 操作者在部署主机打开 Grafana 首页
- **THEN** 预置的 ActionDriver 运行诊断仪表盘可查看日志、调用量、错误和耗时，并可进入 Explore 查询 Loki、Tempo 与 Prometheus

### Requirement: 接口调用日志仅存统一平台
系统 SHALL 为 HTTP、Electron IPC 与 WebSocket 边界产生结构化摘要运行日志，并 SHALL 发送至 OpenTelemetry 采集链路；摘要 MUST NOT 包含任意请求/响应正文。SQLite SHALL 保存任务、工具与审批事实，而不作为模型层日志或接口层摘要日志的替代来源。

#### Scenario: 查询跨传输调用摘要
- **WHEN** 任务经过实际存在的跨进程边界且本地平台正常运行
- **THEN** 操作者可按共同标识查找边界操作、结果和耗时，记录没有任意请求/响应正文

#### Scenario: 观测平台停机
- **WHEN** 采集器不可用且发生新的接口调用
- **THEN** 主要任务仍可完成，接口摘要允许丢失，任务持久化事实不丢失

## ADDED Requirements

### Requirement: 模型原文仅由 LangSmith 承载
系统 SHALL 在已配置时向 LangSmith 发送模型调用输入、输出和错误详情作为唯一模型层日志事实；Tempo 与 Loki SHALL NOT 保存这些原文，Phoenix SHALL NOT 同时作为模型调用的第二个权威追踪来源。鉴权凭据 MUST NOT 写入追踪。

#### Scenario: 查看完整模型调用
- **WHEN** 一次模型调用完成且 LangSmith 成功接收追踪
- **THEN** 用户通过受验证的 LangSmith 详情入口查看关联输入输出，并可凭共同标识与运行诊断关联

#### Scenario: 验证数据边界
- **WHEN** 一次测试调用包含可识别的模型输入与输出
- **THEN** LangSmith 中可检索到原文，Tempo span 与 Loki 日志中均找不到该原文或鉴权凭据

## REMOVED Requirements

### Requirement: 模型原文仅由本地 Phoenix 承载
**Reason**: 模型日志事实来源已裁决为 LangSmith，继续保留本地 Phoenix 原文会形成重复权威记录。
**Migration**: 停止 Phoenix 模型追踪；已有 Phoenix 历史按运维保留规则处理，新记录和详情由 LangSmith 承载。
