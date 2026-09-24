## Context

参见 `proposal.md`。当前 `packages/observability/src/logger.ts` 以 Pino 向终端和本机 JSON 文件输出运行日志；`createInteractionLogRecorder` 另将接口事件及请求/响应详情写入 `LocalInteractionLogStore`，Desktop 日志页直接查询后者。Runtime 与 Desktop Main 各有日志进程边界。现有根 `compose.yaml` 只运行质量检查，没有观测服务。工作树中未提交的 `use-langsmith-model-logs` 改动把模型层查询与详情绑定到 LangSmith；本变更不能假设那批文件可以直接删除或覆盖。

## Goals / Non-Goals

**Goals:**

- 从一次真实任务进入应用到工具与模型返回，能用共同的 `trace_id`、`sessionId`、`taskId` 定位 Loki 日志、Tempo 链路和 Phoenix 中的模型详情。
- 所有观测后端与采集器由本地 Docker 启动并持久化；Electron 与 Runtime 可继续在宿主机运行。
- 将运行日志生产端改为 OpenTelemetry Logs SDK，且本机接口交互详情的读写与保留期不因集中平台状态而改变。
- 明确并验证 Phoenix 保存完整模型原文、Tempo/Loki 不保存原文的导出边界。

**Non-Goals:**

- 不把 ActionDriver Runtime、Electron 或模型供应商迁入 Docker，不部署云服务或生产级高可用集群。
- 不重新实现 Grafana、Tempo、Loki 或 Phoenix 的查询 UI；不将每一条普通日志转成 span。
- 不要求集中运行日志在采集器离线时零丢失；接口层本机详情仍须可靠写入。
- 不清理或重写未提交的 LangSmith 实现，迁移必须逐项核对后再移除不再使用的代码。

## Decisions

### 1. 运行日志采用 Logs SDK，本机接口详情保持独立

在 Main 与 Runtime 启动时分别建立 `LoggerProvider`、批量日志处理器及 OTLP exporter，并通过 `packages/observability` 暴露窄的日志接口，承接当前 `info`、`warn`、`error` 和结构化属性调用。把 `InteractionLogRecorder` 对 Pino `Logger` 的类型依赖改成此接口；它完成本机存储写入后，再尽力发送不含请求/响应原文的运行摘要。进程退出时有界 flush/shutdown；发送失败只影响集中日志，不使任务或本机接口日志失败。

替代方案是保留 Pino 作为生产端、让 Alloy 采集其文件。它更成熟、迁移更小，但用户已明确选择 OpenTelemetry Logs SDK；用户接受 JavaScript Logs 仍处于 Development、批量内存队列溢出可能丢失集中运行日志的代价。另一个替代方案是把本机接口详情也改为 Loki 查询，可减少存储种类，却会改变离线能力和现有列表/详情契约，故不采用。

### 2. 一条 OTLP 链路，按信号和目的地隔离数据

应用向本机 Alloy OTLP 接收端发送日志、trace 和指标。日志进入 Loki；指标进入 Prometheus 可查询路径；容器标准输出由 Alloy 的 Docker 采集组件补充到 Loki。主机进程直接发送 OTLP，不要求将其日志目录挂载到容器。Alloy 的 trace 管线分为两支：Phoenix 分支保存模型调用及其必要父子节点的完整内容；Tempo 分支先按允许字段集合构造不含提示词、输入、输出和工具载荷的 span，再发送到 Tempo。两个分支保持同一个 trace ID。运行日志生产接口不接受模型原文字段，Loki 采集前再以测试校验边界；不能把未经筛选的原始 trace 同时直接导出给 Tempo。

替代方案是在应用内启用两个完全独立的 tracer/exporter。它能在源头隔离数据，但共享 trace ID、跨进程上下文和错误处理更复杂，容易出现两个平台无法对应的链路，故首版由采集器集中路由。Phoenix 接收范围应覆盖模型 span 的必要父节点，避免过滤后形成无法理解的孤立调用树。

### 3. 明确跨进程上下文与低基数索引

为入口 HTTP/WS、Electron IPC、任务执行、工具调用和模型调用建立有业务意义的 span。HTTP 使用标准 `traceparent` 传播；IPC/WS 使用类型化消息字段或明确的上下文注入/提取，不能指望 Node 自动插桩跨越 Electron 消息边界。日志记录当前活动 span 的 `trace_id`、`span_id`，另记录可用的 `sessionId`、`taskId`、`requestId`。Loki 只把服务名、环境等低基数字段设为索引标签；trace、任务、请求标识留在结构化元数据或日志字段。

替代方案是只关联现有 `correlationId` 而不传播 OpenTelemetry 上下文。它能做文本搜索，但不能还原正确的父子 span 与跨服务耗时，因此不满足完整调用链目标。

### 4. 单机 Docker 平台与应用入口分离

新增独立于根质量检查 Compose 的观测栈，固定镜像版本，包含 Grafana、Alloy、Loki、Tempo、Prometheus、Phoenix 与持久卷。首版 Phoenix 采用持久卷上的 SQLite，符合单机本地场景；需要并发或更高吞吐时再独立迁移 PostgreSQL。宿主机对外服务端口仅绑定 loopback；文档提供启动、健康检查、数据路径、停止与故障排查。Grafana 预配 Loki、Tempo、Prometheus 数据源和 trace-to-logs 关联。

ActionDriver 日志页默认仍展示本机接口层列表和详情，同时提供受约束的本地 Grafana/Phoenix 导航。首版不复制模型会话列表或链路详情；平台不可用时显示清楚的状态和启动指引。导航地址从受信任的本机配置生成并由 Main 校验，不接受 Renderer 给出的任意网页地址。现有 LangSmith 页面、RPC 与 `WebContentsView` 适配器在迁移测试通过后再按依赖关系清理。

替代方案是把 Grafana/Phoenix 完整嵌入 Electron。它保持在应用内，但引入登录、Cookie、页面生命周期及隔离复杂度；用户已允许外链，因此首版仅做安全导航。

## Risks / Trade-offs

- [Logs SDK 的 JavaScript 实现尚未达到 Stable，版本升级可能影响 API] → 锁定版本，将依赖限制在观测适配层，增加类型检查和集成测试；这是用户覆盖保留 Pino 建议后接受的代价。
- [采集器停机或 SDK 队列耗尽时集中运行日志可能丢失] → 任务流程不阻塞，暴露发送失败/队列状态，并在验收中实测；本机接口详情继续可查。不把 Alloy 的下游持久队列误写成采集器停机时的应用侧保证。
- [原文误入 Tempo/Loki] → Tempo 分支采用允许字段集合，模型原文不进入运行日志 API；以带标记原文的真实调用同时查询三处，失败即不通过验收。
- [本机平台持有完整模型输入输出] → 只绑定本机接口、持久卷权限受控，文档明确备份与删除方式；按用户裁决不对提示词/回复做内容脱敏，但不主动采集 API Key 或鉴权头。
- [Docker Socket 可扩大 Alloy 权限] → 仅在本地 Compose 中授予必要访问并记录风险；若后续进入多用户/远程部署，重新评估容器日志采集方式。
- [LangSmith 变更与新方案在代码和规格上重叠] → 新变更作为取代方向，先盘点未提交文件及引用，再分阶段迁移；不擅自删除已有修改，旧变更不与本变更同时归档为互相矛盾的主规格。
- [本机多服务资源占用与磁盘增长] → 首版采用单机配置、有限保留期和持久卷监控；高可用与无限历史不在范围内。

## Migration Plan

1. 先起独立观测 Compose 并验证健康、重启持久化与三个 Grafana 数据源；保持应用现状可运行。
2. 测试先行，将 Pino 依赖改为日志接口与 Logs SDK 适配器，保留 `LocalInteractionLogStore` 和接口日志 UI；核验采集器不可用时写入不受影响。
3. 建立跨 HTTP/IPC/WS、任务、工具、模型的 trace 上下文与双路导出；真实模型调用用可识别的输入输出做 Phoenix/Tempo/Loki 边界验收。
4. 把模型诊断入口迁到 Phoenix、运行诊断入口迁到 Grafana，完成本地平台不可用状态与安全导航测试；核对并清理已失效的 LangSmith 查询/视图路径。
5. 运行单元、类型、集成与 Docker 真实环境验收；只有新方案通过后才将旧 LangSmith 变更标记为被取代或按项目流程归档。回滚可恢复上一应用版本及旧日志生产端；本机接口详情数据不需要迁移。
