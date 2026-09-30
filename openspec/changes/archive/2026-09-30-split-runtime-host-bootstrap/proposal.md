## Why

Agent Runtime 已经是一个 loopback HTTP/WS 服务，但它的**启动入口仍硬依赖 Electron**：`apps/agent-runtime/src/runtime-entry.ts` 在拿不到 `process.parentPort` 时直接抛出 `Agent Runtime requires an Electron parentPort`，而存储、资产、checkpointer、执行沙箱、插件与传输的装配全部内联在 `apps/agent-runtime/src/runtime-process.ts` 的同一个启动函数里。

产品方向已确认服务端"必须可原样迁移到云端"（`docs/roadmap.md` 终态与阶段 5、`serve-runtime-over-http` 的可迁移约束），但当前形态下换宿主要么复制整个启动函数，要么改写 Electron 依赖。现在抽离的成本最低，也能立刻验证收益：不启动 Electron 就能起 Runtime 跑既有 HTTP/WS 契约。

## What Changes

- 新增**宿主无关的 Runtime 装配入口**与**宿主生命周期端口**：就绪描述符上报与关闭传播不再依赖 `parentPort`。
- 保留 Electron utility process 适配器（现有行为不变），新增**纯 Node 进程适配器**（信号 + 退出码），让同一装配在无 Electron 环境启动并完成一次会话。
- 把**存储与执行装配收敛为单一入口**：rollout 日志与投影、辅助状态库、资产目录、输入/输出文件、checkpointer、模型连接文件、执行沙箱与运行时路径由一处构造，并在关闭时统一释放。
- 不改变对外 HTTP/WS 契约、`action-driver.stream.v2` 协议、工具与事件语义、服务凭据校验与工作区约束。
- 不实现云端部署、远端存储、身份/多租户、调度或云端执行环境。

## Capabilities

### New Capabilities

- `runtime-host-lifecycle`: 定义 Runtime 的宿主无关启动、就绪上报与关闭传播，以及持久化/执行/凭据装配必须由单一装配入口提供并可被另一套宿主替换的约束。

### Modified Capabilities

<!-- 本变更不修改既有 spec 的 requirement；宿主边界此前未成为独立 capability。 -->

## Impact

- `apps/agent-runtime/src/runtime-entry.ts`：从"业务装配 + Electron 唯一入口"收敛为 Electron 宿主适配器。
- `apps/agent-runtime/src/runtime-process.ts`：拆出宿主无关的 `createAgentRuntime(...)` 与装配工厂，启动函数只做编排。
- 新增纯 Node 入口与宿主适配器；`ParentPortLike` 保留为 Electron 适配器的实现细节。
- `apps/desktop/src/main/runtime-supervisor.ts` 继续以 utility process 启动同一装配，就绪/关闭契约不变。
- 测试面：`runtime-process` 单测改为可注入宿主端口；新增"无 Electron 启动并完成一次会话"的定向冒烟测试。
- 不影响已归档的 `replace-sqlite-store-with-rollout-jsonl` 成果；本变更消费其 `RuntimeRepositories` 端口，不重新设计存储。

## Battle 状态

- 类型：架构型（决策型）。
- Battle 状态：架构分析与替代方案已公开（[analysis/cloud-runtime-preflight.md](../../../analysis/cloud-runtime-preflight.md)），用户指示"先更新 spec 和相关文档"，据此把已确认方向固化为规划产物；实现仍待 apply 阶段。
- 最终方向（已确认部分）：先做宿主引导与装配边界的低成本抽离，云端部署、身份/多租户、调度与云端执行环境**不在本变更范围**，需另行 Battle。
- 仍未解决的分歧：云端的部署位置、数据所有权与同步策略、是否需要无亲和调度（这些决定后续是"粘性路由"还是"外置共享状态"），以及云端是否引入人工审批。
