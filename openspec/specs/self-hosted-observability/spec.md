# self-hosted-observability Specification

## Purpose

定义 Action-Driver 在单机自托管环境中产生、采集和查询运行日志、分布式调用链、模型追踪与指标的可验证行为，并明确 Phoenix 模型调用追踪与本地任务事实的来源和故障边界。

## Requirements

### Requirement: 本地启动可持久化的观测平台
系统 SHALL 提供可由 Docker 在本机启动的运行日志、调用链、指标与可视化服务，并 SHALL 为需要保留历史的本地服务配置持久化存储；完整模型调用原文的权威观测来源 SHALL 为本地 Phoenix。应用 SHALL NOT 用本地或 Mock 模型日志列表伪装观测平台中的记录。

#### Scenario: 启动本地平台
- **WHEN** 操作者按项目文档启动本地观测服务
- **THEN** Grafana、Loki、Tempo、Prometheus、Alloy 和 Phoenix 的健康状态与入口可检查，运行日志、指标和已采集的模型调用可查询

#### Scenario: 本地 Phoenix 不可用
- **WHEN** Phoenix 或本地采集链路不可用
- **THEN** Runtime 的主要任务仍可运行，未被采集的模型调用允许丢失，应用不展示伪造的模型日志记录

#### Scenario: 未提供 LangSmith 凭据
- **WHEN** 未配置任何 LangSmith 凭据且本地采集链路正常
- **THEN** Runtime 仍可运行并将模型调用追踪送至 Phoenix，不要求远端观测服务的凭据

#### Scenario: 无需登录查看 Grafana 数据
- **WHEN** 操作者在部署主机打开 Grafana 首页
- **THEN** 预置的 Action-Driver 运行诊断仪表盘可查看日志、调用量、错误和耗时，并可进入 Explore 查询 Loki、Tempo 与 Prometheus

### Requirement: 运行日志使用 OpenTelemetry 日志信号
Desktop Main 与 Agent Runtime SHALL 通过 OpenTelemetry Logs SDK 产生结构化运行日志，并 SHALL 将其发送到本地采集器与 Loki；容器服务的运行日志 SHALL 同样进入 Loki。日志 SHALL 包含服务名、级别、时间及可用的任务、请求和 trace 关联标识。应用 SHALL NOT 再将运行日志写入本机 JSON 文件或提供本机日志读取接口。

#### Scenario: 查询一次失败的运行日志
- **WHEN** 一次已采集的运行操作失败且产生日志
- **THEN** 操作者可在 Grafana/Loki 按服务和时间找到错误记录，并利用关联标识定位对应调用链

#### Scenario: 采集器不可用
- **WHEN** 本地采集器不可用或日志批处理队列耗尽
- **THEN** 应用的主要任务流程不因运行日志发送而失败；系统 SHALL 暴露可诊断的发送失败状态，但不承诺这段时间的日志可恢复或离线查看

### Requirement: 跨边界调用链可关联
系统 SHALL 为进入 Runtime 的请求、任务执行、工具调用和模型调用产生关键链路节点，并 SHALL 在 HTTP、WebSocket 或 Electron IPC 等实际跨进程边界传播或显式关联 trace 上下文。链路与运行日志 SHALL 使用可互相定位的标识。

#### Scenario: 定位一次模型调用失败
- **WHEN** 用户提交任务并经历 IPC、Runtime、工具和模型调用后失败
- **THEN** 操作者可在 Grafana/Tempo 查看该次调用的关键节点、耗时和失败位置，并可转到相关 Loki 日志

### Requirement: 模型原文仅由本地 Phoenix 承载
Runtime SHALL 为真实模型调用产生关联任务和请求标识的模型追踪，并 SHALL 通过本地采集链路把完整输入、输出和错误详情送至 Phoenix。Tempo 与 Loki MUST NOT 保存模型原文或鉴权凭据；模型追踪失败 MUST NOT 改变任务执行结果。系统 SHALL NOT 再向 LangSmith 发送模型调用内容。

#### Scenario: 查看完整模型调用
- **WHEN** 一次真实模型调用完成且本地采集链路正常
- **THEN** 操作者能在 Phoenix 查询关联的输入、输出、状态和错误详情，并用相同 trace 标识关联 Tempo 链路及 Loki 摘要

#### Scenario: 验证数据边界
- **WHEN** 一次测试调用包含可识别的模型输入和输出及鉴权凭据
- **THEN** Phoenix 可查到输入和输出，Tempo 与 Loki 查不到原文，三个平台都查不到鉴权凭据

#### Scenario: 采集链路中断
- **WHEN** 本地采集链路在模型调用期间停止或队列耗尽
- **THEN** 模型调用仍按上游结果完成或失败，未送达的追踪允许丢失且不会被应用内 Mock 或旧 SQLite 模型日志补足

### Requirement: 指标与告警在 Grafana 可用
系统 SHALL 采集服务运行与关键操作的计数、失败和延迟指标，并 SHALL 使其在本地 Grafana 中可查询及用于告警。

#### Scenario: 查看运行状态
- **WHEN** 服务持续处理请求并产生成功或失败结果
- **THEN** 操作者可在 Grafana 查看请求量、错误率和耗时，并可定位到相关日志或链路

### Requirement: 应用内不提供观测入口
Action-Driver SHALL NOT 在设置侧栏、页面路由或 Preload/Main IPC 中提供 Grafana、Phoenix 或其他模型日志平台的观测入口；平台的本机访问地址与启动方法 SHALL 由运维文档说明。

#### Scenario: 打开设置页面
- **WHEN** 用户进入 Action-Driver 设置
- **THEN** 设置侧栏不显示“日志/观测平台”，应用中也没有模型日志详情、Grafana 或 Phoenix 入口

### Requirement: 接口调用日志仅存统一平台
系统 SHALL 为 HTTP、Electron IPC 与 WebSocket 边界产生结构化摘要运行日志，并 SHALL 发送至 OpenTelemetry 采集链路；摘要 MUST NOT 包含任意请求/响应正文。SQLite SHALL 保存任务、工具与审批事实，而不作为模型层日志或接口层摘要日志的替代来源。应用 SHALL NOT 将接口摘要写入本机交互存储或提供本机列表、详情和读取接口；可用时摘要 SHALL 包含传输、方向、操作、结果、耗时、错误及任务或请求关联标识。

#### Scenario: 查询跨传输调用摘要
- **WHEN** 任务经过实际存在的跨进程边界且本地平台正常运行
- **THEN** 操作者可按共同标识查找边界操作、结果和耗时，记录没有任意请求/响应正文

#### Scenario: 观测平台停机
- **WHEN** 采集器不可用且发生新的接口调用
- **THEN** 主要任务仍可完成，接口摘要允许丢失，任务持久化事实不丢失
