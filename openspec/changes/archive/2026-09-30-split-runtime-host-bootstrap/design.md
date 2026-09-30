## Context

见 `proposal.md` 的 Why。当前形态：`runtime-entry.ts` 是唯一的启动入口，且硬依赖 `process.parentPort`；`runtime-process.ts` 的 `startAgentRuntimeProcess(parentPort, dataRoot, exit, environment)` 已把宿主参数化，但函数体内仍内联构造存储（`openRuntimeDatabase`、`ClaimRuntimeOwnership`、`SqliteRuntimeRepositories`、`RolloutSessionStore`、`RolloutRuntimeRepositories`、`AssetStore`、输入/输出文件、`createSqliteCheckpointer`、模型连接文件）、执行环境（`SessionSandbox`、`resolveExecutionRuntimePaths`、插件宿主）、以及 HTTP/WS 服务面。

已归档的 `replace-sqlite-store-with-rollout-jsonl` 把会话历史改为 rollout JSONL + SQLite 投影，并在 `ports.ts` 引入 `RuntimeRepositories`，`local-adapters.ts` 已不再依赖具体存储实现。因此**存储接口层已经就绪**，本变更只需要装配入口与宿主引导，不重新设计存储。

约束：只支持 macOS 本地运行时；对外协议 `actiondriver.stream.v2` 与事件语义保持不变；工作区存在其他会话未提交的改动，提交时必须排除。

## Goals / Non-Goals

**Goals:**

- Runtime 启动、就绪与关闭不依赖 Electron，可在纯 Node 宿主运行同一装配。
- 存储/执行/凭据/传输由一个装配入口构造并在关闭时统一释放。
- 本地形态对外行为完全不变（协议、事件、权限、桌面监督流程）。

**Non-Goals:**

- 不实现云端部署、远端持久化、对象存储、调度、配额。
- 不实现身份、多租户或凭据托管服务；不改动现有单进程访问凭据模型。
- 不改动 Linux/容器执行沙箱与运行时路径（`sandbox-execution` 既有规格不变）。
- 不改动 LangGraph 执行流程、工具协议或流式协议。

## Decisions

### 1. 用一个宿主生命周期端口替代 parentPort 硬依赖

新增最小端口（就绪上报 + 关闭订阅），实现两个适配器：Electron utility process（保持现有 `runtime.ready` / `runtime.shutdown` 行为）与纯 Node 进程（SIGINT/SIGTERM + 退出码）。

理由：`parentPort` 只承担"就绪上报"和"关闭指令"两件事，抽象面越小越不容易变成空壳接口；两者行为差异清晰，不共享业务逻辑。

替代方案：把父端口改成通用事件总线或插件化宿主协议。被否决——当前只有两个动作，通用协议会引入无消费者的复杂度，且增加桌面启动路径的回归面。

### 2. 启动函数拆为"装配工厂 + 宿主编排"

`runtime-process.ts` 拆成两部分：`createAgentRuntime(options)`（纯装配，返回 `{ ready, close }` 与就绪描述符）由宿主无关代码持有；`electron-host.ts` / `node-host.ts` 只负责把宿主事件接到 `ready`/`close`。`runtime-entry.ts` 退化为 Electron 适配器。

理由：宿主无关的装配是云端与本地共用的部分；适配器保持极薄，便于用定向测试覆盖启动、就绪与关闭。

替代方案：给整个 Runtime 定义抽象基类或 DI 容器。被否决——现状是显式注入的函数式装配（`composition-root.ts`），引入容器会改变既有风格且没有收益。

### 3. 存储与执行装配收敛为单一入口

把 `runtime-process.ts` 中内联的数据根派生与构造逻辑收敛到单一装配入口（例如 `createRuntimeStorage({ dataRoot })` 与 `createExecutionEnvironment({ runtimeDist, workspaceRoot })`），并随 `close()` 释放。装配入口以数据根/工作区根为输入，调用方不再自行拼接文件布局。

理由：云端替换点应当只有一两个具名函数，而不是散落在启动函数里的二十处路径拼接；这也是 `replace-sqlite-store-with-rollout-jsonl` 已经把数据根参数化后最自然的收尾。

替代方案：为存储再定义一套 cloud 专用端口。被否决——`ports.ts` 的 `RuntimeRepositories` 已是接口，再加一层是单实现接口缺陷，且会与刚归档的存储变更冲突。

### 4. 明确不做：云端形态与身份

本变更不引入云端分支、不新增多租户字段、不做粘性路由或共享状态。理由：这些需要独立的 Battle 与用户裁决（部署位置、数据所有权、调度模型），提前实现会造成返工并污染唯一一条已验证的本地启动路径。

## Battle 结论

- 类型：架构型（决策型）
- 目标：让 Runtime 的启动与装配不再绑定 Electron，从而去掉云端化的最大前置返工，同时保持本地行为不变。
- 当前方案：宿主生命周期端口 + 装配工厂；先做宿主与装配边界。
- 主要质疑：若不做第二实现，宿主端口会退化为单实现接口缺陷；云端真实需求（无亲和调度、多租户）尚未裁决。
- 替代方案：A 现在全量抽离（存储/执行/身份都预置端口与双实现）；B 零抽离，云立项时一次大改；C 只抽宿主与装配缝隙（本方案）。
- 最终决策：采用 C。用户指示"先更新 spec 和相关文档"，本变更据此固化为规划产物；实现须在用户审查规划产物后进入 apply。
- 主要权衡：接受"云端立项时仍需新增执行环境与身份子系统"，换取现在不引入无消费者的抽象、不改动已验证的桌面启动路径。
- 用户覆盖：无。
- 重新开启条件：云端部署/调度模型明确，或出现需要跨实例共享状态、云端人工审批的真实需求。

## Risks / Trade-offs

- [单实现接口风险] → 宿主端口只有"就绪 + 关闭"两个动作，且必须**立刻**交付纯 Node 适配器与"无 Electron 启动"的定向测试，确保第二个实现真实存在。
- [桌面启动回归] → 保持 `runtime.ready` / `runtime.shutdown` 与监督器的重启、超时语义不变，并以现有桌面定向测试作为门禁。
- [装配搬迁风险] → 只做"位置搬家"不改行为：同一实现、同一顺序、同一清理步骤；拆分后逐项核对启动与关闭路径。
- [与其他会话冲突] → 本变更触及 `runtime-entry.ts` / `runtime-process.ts`，与未提交的 rollout 改动同文件；必须在对方提交后再实施，提交时排除无关改动。
- [范围蔓延] → 任何"顺手把存储/SDK 换成云端形态"的改动都属于范围扩张，必须停下并升级为 Battle。

## Migration Plan

1. 先落宿主生命周期端口与 Electron 适配器（行为不变），确认桌面启动与关闭测试通过。
2. 再落纯 Node 适配器与无 Electron 启动的定向冒烟测试。
3. 最后做装配搬迁（存储/执行工厂），逐项比对启动与关闭顺序。
4. 回滚策略：纯代码结构变更，无数据迁移；回滚即恢复原启动函数。

## Open Questions

1. 纯 Node 入口的命名与打包归属（独立 `apps/cloud-runtime` 骨架，还是 `apps/agent-runtime` 内的第二个 entry）——倾向后者，云端立项时再决定是否需要独立 app。
2. 云端是否需要独立的数据根与服务凭据引导方式（环境变量 vs 平台秘密注入）——属于云端立项范围。
3. 装配入口是否需要同时承担"工作区根"的校验与派生——待实现时按最小改动决定。
