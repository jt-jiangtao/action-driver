## MODIFIED Requirements

### Requirement: 本地启动可持久化的观测平台
系统 SHALL 提供可由 Docker 在本机启动的运行日志、调用链、指标与可视化服务，并 SHALL 为需要保留历史的本地服务配置持久化存储；完整模型调用原文的权威观测来源 SHALL 为本地 Phoenix。应用 SHALL NOT 用本地或 Mock 模型日志列表伪装观测平台中的记录。

#### Scenario: 启动本地平台
- **WHEN** 操作者按项目文档启动本地观测服务
- **THEN** Grafana、Loki、Tempo、Prometheus、Alloy 和 Phoenix 的健康状态与入口可检查，运行日志、指标及已采集的模型调用可查询

#### Scenario: 本地 Phoenix 不可用
- **WHEN** Phoenix 或本地采集链路不可用
- **THEN** Runtime 的主要任务仍可运行，未被采集的模型调用允许丢失，应用不展示伪造的模型日志记录

#### Scenario: 未提供 LangSmith 凭据
- **WHEN** 未配置任何 LangSmith 凭据且本地采集链路正常
- **THEN** Runtime 仍可运行并将模型调用追踪送至 Phoenix，不要求远端观测服务的凭据

#### Scenario: 无需登录查看 Grafana 数据
- **WHEN** 操作者在部署主机打开 Grafana 首页
- **THEN** 预置的 ActionDriver 运行诊断仪表盘可查看日志、调用量、错误和耗时，并可进入 Explore 查询 Loki、Tempo 与 Prometheus

### Requirement: 应用内不提供观测入口
ActionDriver SHALL NOT 在设置侧栏、页面路由或 Preload/Main IPC 中提供 Grafana、Phoenix 或其他模型日志平台的观测入口；平台的本机访问地址与启动方法 SHALL 由运维文档说明。

#### Scenario: 打开设置页面
- **WHEN** 用户进入 ActionDriver 设置
- **THEN** 设置侧栏不显示“日志/观测平台”，应用中也没有模型日志详情、Grafana 或 Phoenix 入口

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: 模型原文仅由 LangSmith 承载
**Reason**: 用户裁决取消 LangSmith 外部服务，改由本地 Phoenix 承载完整模型调用追踪。
**Migration**: 移除 LangSmith 追踪、查询、页面及配置，使用本地 Phoenix 查看新产生的模型调用；历史 LangSmith 数据不自动复制或删除。
