## Context

当前 `packages/observability/src/logger.ts` 使用 Pino 向终端和本机 JSON 文件写运行日志；`createInteractionLogRecorder` 将接口事件与请求/响应正文写入 `LocalInteractionLogStore`，Desktop 日志页读取该存储；Runtime 的 `GET /logs` 还可读取本机日志文件。Main 与 Runtime 是独立进程。根 `compose.yaml` 只运行质量检查。工作树中有未提交的 LangSmith 迁移代码，不可假设可以直接覆盖或删除。用户已决定取消本机接口日志存储和应用内日志列表，所有新产生的接口与运行日志只进入本地 Docker 统一平台。

## Goals / Non-Goals

**Goals:**

- 真实任务跨 HTTP、IPC、WebSocket、工具与模型时，能以 `trace_id`、`sessionId`、`taskId` 在 Loki、Tempo、Phoenix 中关联。
- Desktop Main 与 Agent Runtime 只用 OpenTelemetry Logs SDK 产生运行日志及接口调用摘要；不新增本机日志文件、交互日志记录或本机日志读取 API。
- Loki 仅存调用摘要与运行日志，Tempo 仅存不含模型原文的链路元数据，Phoenix 存完整模型提示词、输入、输出和错误详情。
- Grafana、Alloy、Loki、Tempo、Prometheus、Phoenix 由本地 Docker 启动、持久化和验收；ActionDriver 不提供观测页面或导航。

**Non-Goals:**

- 不将 Electron、Agent Runtime 或模型供应商迁入 Docker，不做云服务或高可用部署。
- 不在 ActionDriver 内重建日志、trace 或模型详情 UI；不记录每个 WebSocket 流式 chunk 或把每条普通日志转成 span。
- 不保证 Alloy 停机、OTel 批处理队列溢出或下游故障时日志零丢失；不提供离线日志副本。
- 不删除历史本机日志文件或数据库记录；任务状态、图 checkpoint 等业务持久化不属于“日志”迁移。
- 不在规划阶段改写未提交的 LangSmith 实现；实施时逐项核对其引用、测试和迁移边界。

## Decisions

### 1. 运行与接口日志统一由 Logs SDK 生产，取消本机日志存储

Main 与 Runtime 分别建立 `LoggerProvider`、批量处理器与 OTLP exporter，并在 `packages/observability` 暴露窄日志接口，代替 Pino 调用。HTTP、IPC、WebSocket 的入口/完成/失败路径发出结构化调用摘要，包含传输、方向、操作、结果、耗时、错误及关联 ID，但不接受任意 request/response body；WebSocket 单向事件与有回应的命令都要覆盖，流式 chunk 聚合而非逐块记录。进程退出时有界 flush/shutdown，发送失败不阻断主业务。

移除 `LocalInteractionLogStore` 的生产写入、Pino 本机 JSON 文件输出及 Runtime `GET /logs`，撤下相应本机查询契约与前端列表/详情。不因“日志只存统一平台”删除任务业务状态或历史文件。原始请求/响应正文不进入 Loki；完整 LLM 内容仅由模型追踪送 Phoenix。

替代方案一是保留 Pino 并让 Alloy 采集文件，迁移风险较低，但不符合用户对 OTel Logs SDK 的明确选择。替代方案二是继续保留本机接口详情，能离线查询，却引入双事实来源和本机存储维护；用户后续明确推翻早先保留本机副本的决定，并接受平台故障时日志可能不可恢复。此项覆盖及风险不再重复争论，除非出现新证据。

### 2. 单一 OTLP 入口，按目的地隔离数据

应用将 logs、traces、metrics 送到本机 Alloy OTLP 入口。Logs 进入 Loki；metrics 进入 Prometheus 可查询路径；容器标准输出由 Alloy 采集到 Loki。Trace 管线分支：Phoenix 接收模型 span 与必要父节点、保留完整模型内容；Tempo 分支先将属性限制为允许字段集合，再导出不含提示词、模型输入输出和工具载荷的 span。两支共享 trace ID。运行日志接口和 HTTP/IPC/WS 摘要拒绝任意载荷字段；以标记字符串的真实调用验证 Loki/Tempo 中没有原文。

替代方案是在应用中配置两套 tracer/exporter，源端隔离更直接，但跨进程上下文、trace ID 一致性与故障处理更复杂，首版由 Alloy 路由。必须验证 Phoenix 接收必要父节点，避免孤立模型 span。

### 3. 显式传播跨进程上下文并控制索引基数

HTTP 使用 W3C `traceparent`；Electron IPC 与 WebSocket 在现有类型化信封中注入/提取上下文，不能假设自动插桩能跨越消息边界。关键操作产生 span：入口请求、任务、工具、模型；日志取得活动 span 的 `trace_id`、`span_id`，并记录可用的 `sessionId`、`taskId`、`requestId`。Loki label 仅选服务名和环境等低基数字段；高基数关联 ID 保持为结构化元数据或正文属性。普通调用摘要不是额外 span 的替代，也不产生逐 chunk 噪声。

仅使用现有 `correlationId` 做文本关联是可执行替代，但无法给出正确父子关系与跨边界耗时，不满足完整调用链目标。

### 4. 本地 Docker 平台与产品界面分离

新增独立观测 Compose，固定镜像版本，提供 Grafana、Alloy、Loki、Tempo、Prometheus、Phoenix 与持久卷。Phoenix 首版使用持久卷 SQLite；宿主机服务端口只绑定 loopback。Grafana 预配 Loki、Tempo、Prometheus 数据源、trace-to-logs 关联及 ActionDriver 概览仪表盘。Grafana 的匿名角色使用 Editor，使操作者无需登录即可进入 Explore 自由查询；仪表盘覆盖应用日志、调用量、错误和耗时。文档写明启动、健康检查、持久化路径、停止、故障排查与原文数据的本机访问边界。

ActionDriver 设置侧栏及路由不再提供“日志/观测平台”页面，也不保留 Grafana/Phoenix 外链按钮或其专用 IPC。访问地址和启动指引仅写在运维文档，操作者用浏览器直接访问本机端口。现有 LangSmith 页面、RPC 和 `WebContentsView` 适配器在迁移测试通过后核对清理。

替代方案是在应用设置中保留两个受约束的外链按钮，平台更容易发现，但增加与核心任务无关的诊断入口及专用 IPC。用户明确选择删除整个入口并接受可发现性下降。将 Grafana/Phoenix 嵌入 Electron 还需处理认证、Cookie、页面生命周期与隔离，同样不采用。

Grafana 的另一可执行权限方案是匿名 Viewer 加只读仪表盘，能避免本机访问者修改面板，但 Explore 不可用，无法满足自由查询调用链与日志的诊断目标。用户在看到界面复现和权限差异后选择匿名 Editor；这个单机无认证取舍仅适用于 loopback 部署，不得直接暴露到局域网或公网。

## Risks / Trade-offs

- [JavaScript OTel Logs SDK 尚未达到 Stable] → 锁定版本、限制在适配层、覆盖类型与集成测试；用户覆盖保留 Pino 的建议。
- [Alloy 不可用或 SDK 队列耗尽时日志丢失，且不再有本机副本] → 不阻断业务，提供可诊断的发送状态、验收故障行为；这是用户选择的故障边界，不能将下游队列误称为应用侧保证。
- [HTTP/IPC/WS 摘要或原始 trace 泄露正文到 Loki/Tempo] → 日志 schema 不含 body，Tempo 使用允许字段集合，并用可识别原文的真实调用做三处检索验收。
- [Phoenix 存完整模型原文] → 仅绑定本机接口、持久卷权限受控、说明备份与删除方式；按用户裁决不对提示词/回复做内容脱敏，但不主动采集 API Key 或鉴权头。
- [Docker Socket 扩大 Alloy 权限] → 限本地 Compose 使用并明确记录；远程或多用户部署需重新决策。
- [LangSmith 未提交改动与迁移范围重叠] → 先清点修改和引用，再逐阶段迁移；不直接覆盖或删除用户工作树。
- [多服务资源与磁盘增长] → 有限保留期、持久卷监控；高可用及无限历史不在范围。
- [应用内无观测入口降低可发现性] → 运维文档保留固定本机 URL、启动命令与查询指引；这是用户在比较保留外链按钮后明确接受的产品取舍。
- [Grafana 匿名 Editor 可修改仪表盘] → 端口仅绑定 loopback，预置面板由只读配置文件恢复；多用户或远程访问前必须改为认证和最小权限。用户已接受本机单机部署的权限取舍。

## Migration Plan

1. 起独立 Docker 观测栈，验证健康、重启持久化和 Grafana 数据源；应用仍可保持原状。
2. 测试先行建立 Logs SDK 适配层与接口调用摘要，覆盖 HTTP/IPC/WS、单向事件、失败及边界字段；切换生产写入后移除 Pino 文件输出、交互日志存储写入与 `GET /logs`。旧历史文件保留，不执行删除。
3. 建立跨边界 trace 上下文、指标及 Phoenix/Tempo 分支；真实模型调用用标记输入输出验收数据隔离，故障注入验证日志丢失时业务可继续。
4. 移除应用日志页、设置侧栏入口、专用外链 IPC、本机列表/详情及失效 LangSmith 查询路径；保留任务业务状态存储，并将平台入口放在运维文档。
5. 跑单元、类型、集成及 Docker 真实环境验收；核对旧 `use-langsmith-model-logs` 变更的归宿。若回滚应用版本，旧日志路径可能重新启用，须明确部署回滚和数据边界，不将历史文件自动迁移到新平台。
