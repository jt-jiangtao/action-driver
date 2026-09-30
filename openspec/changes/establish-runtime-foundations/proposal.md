## Why

Action-Driver 已具备可运行的 Electron UI 和 Mock Skill 边界，但 Agent、持久化、跨进程通信与定制 Chromium 仍只有占位接口。需要先建立可独立验证的 Phase 0 运行时基础，才能在不把浏览器实现耦合进 Renderer 的前提下安全进入 Browser Use 开发。

## What Changes

- 建立 Go + Eino 本地 Agent Service 的进程骨架、健康检查、版本握手、受控启动和退出行为。
- 建立 Electron Main 与 Go Sidecar 之间基于 Unix Domain Socket 的版本化、类型安全通信边界；Renderer 仍只通过最小 Preload API 访问应用能力。
- 建立由 Go Sidecar 独占写入的 SQLite 本地存储与迁移机制，为任务、消息、步骤、Skill 调用和运行事件提供持久化基础。
- 将现有 Mock Skill 边界扩展为 Agent Runtime 的 Skill Registry 与统一调度契约，Browser Use 和 Computer Use 继续作为彼此独立的能力注册。
- 建立定制 Electron/Chromium Fork 的上游版本锁定、补丁序列、构建产物清单与应用消费约定，但本阶段不修改 Chromium 内核行为。
- 增加协议兼容、Sidecar 生命周期、数据库迁移、Skill 注册和构建清单的自动化验证。
- 本阶段不实现真实网页导航、Action Graph、Node Handle、增量观察、受约束浏览器动作、Jev 推理循环或 macOS Computer Use。

## Capabilities

### New Capabilities

- `sidecar-lifecycle`: 定义 Electron 启动、监督、探活和关闭本地 Go Agent Service 的可观察行为。
- `runtime-transport`: 定义 Electron 与 Go Sidecar 通过 Unix Domain Socket 完成版本握手、请求响应和事件订阅的行为。
- `local-runtime-storage`: 定义 SQLite 本地数据库的所有权、迁移、事务和核心运行记录持久化行为。
- `electron-fork-toolchain`: 定义定制 Electron/Chromium Fork 的版本来源、补丁追踪、可复现构建和产物验收约定。

### Modified Capabilities

- `agent-skill-boundary`: 将现有 Mock Skill 契约扩展为由 Go Agent Runtime 管理的 Skill Registry、调度和生命周期事件边界。

## Impact

- 新增 Go Workspace、Agent Service 入口、协议定义、SQLite schema/migration 与对应测试目录。
- Electron Main 新增 Sidecar Supervisor、UDS Client 和 IPC Adapter；Preload 仍保持显式白名单，React 页面不直接访问 Sidecar 或数据库。
- `packages/contracts` 将从手写 Mock DTO 过渡到版本化协议映射，同时保留 UI 只读投影和现有 Mock 测试适配器。
- 新增定制 Electron Fork 清单、补丁目录约定和构建/校验脚本；真正的 Chromium 内核改动留给后续 Browser Use change。
- 开发、协议校验、Go/TypeScript 测试和通用 CI 使用 Docker；macOS Electron/Chromium 产物构建与签名相关验证运行在固定版本的 macOS 执行器上。
