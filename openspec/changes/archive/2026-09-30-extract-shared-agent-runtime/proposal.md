## Why

`split-runtime-host-bootstrap` 已让同一 Runtime 可由 Electron 或纯 Node 启动，但 Agent 图、会话编排和本地存储、桌面能力仍位于同一个应用包中。未来云端 Agent 若直接依赖该应用，将同时引入本地文件、SQLite、macOS 执行环境和桌面能力；现在明确共享代码与本地宿主的包边界，可以避免云端阶段复制 Agent Loop。

## What Changes

- 将供本地与未来云端复用的 Agent 执行图、工具与 Skill 调用、会话编排及必要端口抽入 `packages/agent-runtime`（包名 `@action-driver/agent-runtime`）。共享包不得依赖 `apps/`、Electron、本地 SQLite 装配或 macOS 执行实现。
- 将当前可启动的本地进程移至 `apps/local-runtime`（包名 `@action-driver/local-runtime`），保留 Electron 与纯 Node 两个入口、本地存储、执行环境、桌面能力及 HTTP/WS 装配；桌面端继续启动这个本地宿主。
- 将 OpenAI/Anthropic 协议适配、HTTP 传输与供应商错误归一化抽入新 `packages/model-provider-runtime`（包名 `@action-driver/model-provider-runtime`）；现有 `packages/model-connections` 继续只承载契约。依赖 Runtime 端口的 `ConnectionModelGateway` 归共享 Runtime 包；本地模型连接服务、文件/SQLite 凭据存储与密钥来源留在本地宿主。共享包之间保持单向依赖，不创建循环。
- 更新工作区依赖、构建/打包脚本、资源定位和测试路径；保留现有对外协议、工具与审批语义、事件顺序、桌面监督和关闭行为。
- 不实现云端应用、Linux 沙箱、远端存储、身份/多租户、调度、云端凭据托管或跨实例状态。

## Capabilities

### New Capabilities

无。本变更仅调整代码所有权与依赖方向，不增加对外行为。

### Modified Capabilities

无。`runtime-host-lifecycle`、`agent-tool-runtime` 等现有规格的行为保持不变，因此本变更设置 `skip_specs: true`。

## Impact

- 代码：`apps/agent-runtime`、新 `apps/local-runtime`、`packages/agent-runtime`、`packages/model-provider-runtime` 与现有 `packages/model-connections`，以及引用其路径或包名的桌面端、脚本和测试。
- 包名：当前本地可执行应用改称 `@action-driver/local-runtime`，共享库使用 `@action-driver/agent-runtime`。这是**BREAKING** 的内部工作区包名与路径调整，不改变最终用户协议。包作用域采用并行的产品更名变更裁决后的 `@action-driver/*`。
- Battle 状态：架构型决策已完成。用户确认按“共享 Runtime 核心 + 模型协议实现复用，本地宿主保留具体装配”的方向推进，并要求包与宿主名称可区分；采用上述命名。整目录直接搬入 `packages/` 会携带本地依赖；等云端应用落地才拆则推迟共用边界的验证。两者均未采用。实施前发现既有架构裁决与边界测试要求 `model-connections` 只放契约，用户进一步确认采用独立 `model-provider-runtime` 包，保留这条既有边界。模型 Gateway 留在 Runtime 侧，以免形成包循环。
- 仍未裁决：云端部署、数据归属、身份/租户、调度与执行隔离。实施中若必须改变这些边界，应暂停并另行 Battle。
