## Context

见 `proposal.md`。`apps/agent-runtime` 当前同时承载 Agent 逻辑与可执行本地宿主；`pnpm-workspace.yaml` 同时收录 `apps/*` 和 `packages/*`，所以目录迁移改变的是代码所有权，不是能否被 pnpm 识别。现有 `runtime-host-lifecycle` 规格已要求 Electron 与 Node 共用服务实现；本变更不得改变其对外行为。当前工作区有其他会话的未提交文件，实施与提交必须排除。

## Goals / Non-Goals

**Goals:**

- 用包依赖方向验证本地宿主只装配共享 Runtime，不让共享 Runtime 引入本地执行、存储或桌面实现。
- 保留同一 Agent Loop、工具/Skill 生命周期、会话协议、事件次序和 Electron/Node 启停语义。
- 名称准确区分共享运行逻辑和本地可执行宿主，并尽早修正本次迁移范围内误导性的名称。

**Non-Goals:**

- 不预设云端的存储、执行、身份、部署或多实例架构；不制造云端实现替身来验证包。
- 不进行全仓无关命名清理，不改变对外 JSON、HTTP/WS 或插件协议字段。

## Decisions

### 1. 共享包与本地宿主分别命名

共享包使用路径 `packages/agent-runtime`、包名 `@action-driver/agent-runtime`，只导出可复用的运行逻辑与端口；现有应用改为 `apps/local-runtime`、包名 `@action-driver/local-runtime`，继续生成 Electron `dist/index.js` 与 Node `dist/node.js`。包作用域跟随并行的全仓产品更名。未来云端应用若立项，可有自己的应用名并依赖共享包，不在本变更创建。

理由：`agent-runtime` 表示跨宿主共用的实现，`local-runtime` 表示本地可执行形态；相比 `agent-runtime-core`，不需要泛义的 `core` 后缀。替代方案是保留 `apps/agent-runtime` 并新增 `packages/agent-engine`：路径改动较少，但同一个概念会同时被称为 Runtime 和 Engine，且当前 `@action-driver/agent-runtime` 仍指本地进程。另一方案是整目录搬进 `packages/`：它保留全部本地耦合，无法满足云端复用目标。用户已确认需要区分共享包和宿主；本决策按该要求落实命名。

本次迁移中，位于本地宿主却使用通用名称的装配入口应明确标出本地属性，例如把 `createAgentRuntime` / `runtime-process.ts` 改为表达本地装配职责的名称。只改迁移所触及的内部标识；已清楚表达职责的 `local-adapters`、`local-runtime-server` 等名称保持。

### 2. 先划依赖边界，再迁移文件

`@action-driver/agent-runtime` 包含 Agent 图、Runtime 端口、工具与 Skill 的注册/策略/调用状态、流会话编排及纯逻辑投影。`@action-driver/local-runtime` 持有具体仓储、SQLite/rollout 文件、资产与输入输出文件、macOS 沙箱和脚本运行时、Computer Use、进程宿主与插件进程装配，以及面向本地配置的 HTTP/WS 入口。已独立的 `contracts`、`runtime-contracts`、`plugin-contracts` 等包保持现状。

现有 `StreamSessionService` 用 `Pick<SessionAssetStore/...>` 与桌面审批类型标注可选依赖，工具调用服务通过 `instanceof` 识别本地执行异常，`task-projection` 和流会话还从本地资源 provider 导入纯 URI 格式化函数。迁移时只将这些接点收窄为所需操作与稳定错误语义，把纯 URI 格式化逻辑放到已有资源契约层，使共享包不反向导入本地宿主；本地适配器继续实现具体操作。不得为尚无消费者的云端存储、审批或执行类型创建平行接口。

替代方案是直接移动文件并通过 `../../apps/local-runtime` 保留类型引用：构建可能通过，但包边界无效。另一个方案是为所有本地依赖建立通用 DI 容器：增加间接层且难以检验真实需求。因此采用小范围、显式端口与现有函数式装配。

### 3. 模型契约与供应商实现分包，避免循环依赖

既有 `tests/unit/model-provider-boundary.test.ts` 和归档的架构收敛设计要求 `@action-driver/model-connections` 只承载跨进程契约，不引入 OpenAI SDK。用户在实施前确认保留此边界。新建 `@action-driver/model-provider-runtime`，迁入 OpenAI/Anthropic 适配器、HTTP 传输、供应商错误归一化与直接需要的类型，并通过明确出口供本地宿主和未来云端宿主使用。`ConnectionModelGateway` 依赖 Agent Runtime 的 `ModelGateway` 端口，归共享 Runtime 包；`ModelConnectionService` 目前组合具体凭据/图片能力，连同文件与 SQLite store、密钥来源保留在本地宿主。依赖方向为 `model-provider-runtime → model-connections`、`agent-runtime → model-connections`、`local-runtime → 两个共享实现包`，禁止反向依赖。

替代方案一是覆盖旧裁决并把供应商实现直接放入 `model-connections`：包更少，但现有边界测试会失效，且把 OpenAI SDK 带入桌面端也依赖的纯契约包。替代方案二是让适配器暂留本地宿主，等云端应用出现再抽；改动较少，但与当前明确的跨宿主复用目标不符。用户确认采用独立供应商运行包。把整个旧 `model-connections/` 目录搬入新包也不采用，因为 Gateway 和本地凭据存储分别属于不同边界。

### 4. 测试与命名跟随所有权

原本位于应用目录、只验证迁出逻辑的单元测试移到对应包的 `tests/`；跨包边界测试可保留在根 `tests/`，本地装配、打包和 Electron/Node 启动测试留在 `apps/local-runtime/tests/` 或桌面端。清理跨包测试对旧 `apps/agent-runtime/src` 的相对路径导入，改从包的公开出口导入。命名检查覆盖本次迁移的文件、导出、测试、构建脚本与资源路径，避免“local”代码以通用名称从共享包出口暴露。

替代方案是把所有测试随目录整体搬迁：会把本地装配测试错误地归给共享包，违反 `docs/testing/test-placement.md`，因此按被测所有权拆分。

## Risks / Trade-offs

- [路径迁移面较广] → 已有构建脚本、桌面入口、打包资源和测试使用旧目录或包名；先列出引用，逐步更新并用定向测试覆盖启动、资源定位与打包入口。移动应用目录比新起一个 `-core` 包成本高，换取长期明确的命名。
- [共享包混入本地实现] → 加边界测试/静态检查，禁止共享包导入 `apps/`、Electron、SQLite 与 macOS 专用模块；不以类型导入作为例外。
- [模型包循环依赖或 SDK 污染契约包] → Gateway 留在 Runtime 包，协议适配与传输放在新 `model-provider-runtime`；保持 `model-connections` 无 OpenAI SDK，检查工作区依赖图和既有边界测试。
- [抽离改变错误或流事件语义] → 迁移以等价行为为准；围绕工具异常映射、流会话、Node/Electron 两种启动和关闭做定向验证。现有规格不变。
- [并行工作区改动] → 仅处理本变更文件；不暂存或提交其他会话的改动。用户未覆盖已知风险。

## Migration Plan

1. 建立共享包和新的本地宿主包身份，先固定包出口与单向依赖检查。
2. 搬迁 Agent/工具/Skill 逻辑与其测试，消除对本地类型和错误类的反向引用；保持旧装配调用顺序。
3. 搬迁模型协议适配与测试；接回 Runtime Gateway 和本地模型连接服务。
4. 迁移本地应用目录，更新构建、桌面启动、原生模块、资源与测试路径，并完成范围内的命名修正。
5. 运行受影响的定向测试与类型检查；准备提交时按仓库规范一次性运行全量验证，并记录已知无关失败。回滚为代码/路径回退，无数据迁移。
