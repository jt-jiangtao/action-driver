## Context

见 `proposal.md`。当前 Runtime 的模型网关注入 `LangSmithObservability`，其查询能力和 Desktop 内嵌详情没有生产入口。`PhoenixModelObservability` 已能产生 OpenInference 模型 span，但只被测试引用且类型依赖 LangSmith 文件；本地 Alloy 已将 trace 同时送 Phoenix 和经属性过滤的 Tempo。`model_calls` 仍保存完整请求/响应，却没有生产读取方。运行日志采用 OTel；旧 Pino 文件读取、日志 IPC 及列表服务仍留在代码中。Main 的旧模型连接 JSON 迁移则仍在启动路径调用，不能当作死代码删除。

## Goals / Non-Goals

**Goals:**

- 使模型调用原文只进入本地 Phoenix 观测路径，运行日志和 Tempo 链路保持不含原文；模型追踪失败不影响任务结果。
- 删除 Action-Driver 直接依赖及主动使用的 LangSmith 配置、适配器、未装配的列表/详情与旧日志路径，并按真实入口审计移除其他无用实现和直接依赖。
- 保持既有任务事实、数据库历史记录、旧模型连接迁移以及设计/测试基础设施中仍有明确用途的资源。

**Non-Goals:**

- 不新建应用内日志页面或 Phoenix 导航入口，不把 Phoenix 历史导入 SQLite，也不迁移或删除远端 LangSmith 历史数据。
- 不删除现有 `model_calls` 表或历史行，不以一次静态扫描结果为唯一依据删除动态加载、打包入口、迁移代码或设计验收夹具。
- 不重做本次范围外的任务、模型连接、Browser/Computer 能力与 UI 架构。
- 不为删除 LangGraph 的间接 LangSmith SDK 而重写图编排与 checkpoint；该依赖只允许保持惰性，不允许自动出站。

## Decisions

### 1. 选择本地 Phoenix 作为模型内容观测端

最终裁决：用户选择移除 LangSmith 并改接本地 Phoenix。Runtime 向已有 `ProcessObservability.tracer` 取得模型 span；把追踪起止的窄接口和数据类型放在 Runtime 内部独立模块，模型网关不再引用任何 LangSmith 类型。模型 span 携带会话、任务、请求、关联 ID，完整输入输出只放在 OpenInference 内容属性；错误状态和用量在终态写入。Alloy 继续把同一 trace 送 Phoenix，并在进入 Tempo 前按允许字段剥离原文。凭据在写 span 前过滤。模型网关对追踪错误维持尽力而为处理，任务结果只由模型上游和业务持久化决定。

真实替代方案是连模型内容追踪一并移除，仅保留 OTel 摘要和任务消息；依赖与隐私面更小，但无法查看完整调用。另一方案是继续使用 LangSmith，具备现成的远端查询和 UI，但与用户要求的本地观测和精简依赖冲突。已向用户说明本机完整原文持久化、服务运维和采集链路停机时的丢失风险，用户选择 Phoenix。

实施中发现 `@langchain/core` 作为 LangGraph 依赖会间接安装并打包 LangSmith SDK。比较了替换 LangGraph 以彻底移除 SDK 与保留 LangGraph、仅移除主动追踪两种可执行方案；前者增加图编排、checkpoint 和恢复语义的高返工风险。用户裁决保留 LangGraph 的惰性间接依赖。Runtime 启动时显式关闭 LangChain/LangSmith 自动追踪环境开关，并以行为测试确认继承的环境变量不会造成 LangSmith 出站。

### 2. 旧模型调用存储只退役代码，不破坏历史数据

新请求停止写入仅供旧模型日志使用的 `model_calls`，删除无调用方的读取/投影接口；任务、消息、事件和 checkpoint 的业务持久化保持原样。SQLite 既有表、索引与历史行仍保留，避免启动迁移破坏用户数据。新库是否创建空兼容表服从当前 schema 迁移约束，不为清理引入数据版本重写。替代方案是删除表和历史行，可减少文件大小，却不可逆且不属于用户授权。

### 3. 用可达性加业务用途双重证据清理

以 Electron Main/Preload/Renderer、Runtime bundle、被调用的脚本和包公开入口为根建立引用清单，再核对动态导入、配置字符串、旧数据迁移、OpenSpec 与设计验收。删除仅由遗留测试引用的日志 IPC、LangSmith 详情、模型日志 DTO/服务、旧本机日志读取与相应测试。测试专用 Mock、视觉验收组件、E2E 夹具若仍承担当前设计/验收职责则保留。对每个三方依赖检查生产与构建脚本的直接使用；删除实际不需要的依赖并更新锁文件。替代方案是只运行静态未引用检测并全删，速度较快但会误删打包入口、迁移流程和测试资产。

### 4. 规范以当前事实为准，历史记录不改写

更新 `self-hosted-observability` 主规范和运维文档，使新验收只依赖 Phoenix。未完成的 `use-langsmith-model-logs` 变更标注被本变更取代并按 OpenSpec 能力完成归档或撤回；已归档的旧设计保留原始决策记录，必要时增加指向新变更的说明，而不把历史方案改成当前方案。

## Risks / Trade-offs

- [Phoenix 保存完整提示词与回复] → 仅绑定本机端口，保留持久卷权限与删除/备份说明；不采集 API Key、鉴权头或 Cookie。
- [Alloy/Phoenix 停机导致追踪丢失] → 追踪错误不能改变模型执行；文档明示无应用内补录或伪造回退，故障测试覆盖停机与恢复。
- [Tempo/Loki 泄漏模型原文] → 用唯一标记的真实模型调用验证 Phoenix 可查而 Tempo/Loki 全局不可查，并核对 Alloy 过滤规则。
- [误删测试或打包需要的模块] → 对候选做入口追踪、打包冒烟和全量检查；静态“零引用”只构成候选，不直接等于删除结论。
- [旧数据库含历史模型原文] → 不删除或迁移现有表；文档说明旧版本残留数据的保留与清理边界。
- [LangGraph 继续携带 LangSmith SDK] → 只保留间接依赖，关闭所有 LangChain/LangSmith 自动追踪开关并验证无外部出站；未来升级依赖时复核开关语义。

## Migration Plan

1. 先为 Phoenix 接线、同 trace 关联、错误隔离与无 LangSmith 出站建立失败测试，再迁移模型网关类型与 Runtime 装配。
2. 验证 Phoenix/Tempo/Loki 数据边界和采集器故障后，删除 LangSmith 与旧模型日志代码、未用依赖及死日志路径；每组删除后运行定向测试和类型检查。
3. 更新当前规范、运维文档及未完成的 LangSmith 变更状态；验证没有生产 LangSmith 配置或远端调用引用。
4. 运行完整检查、Electron 本地与打包冒烟、OpenSpec 严格验证。回滚应用版本可恢复旧代码，但不会恢复未送达的追踪；历史 SQLite 与远端 LangSmith 数据不自动改变。
