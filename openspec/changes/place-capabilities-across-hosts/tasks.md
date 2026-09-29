## 1. 声明与宿主发现

- [x] 1.1 为插件和能力定义 UI、本地工作区、远程工作区、云端位置及设备/工作区需求；用定向契约测试验证旧插件兼容和不满足要求时明确失败。
- [x] 1.2 建立版本化宿主握手、实例 ID、在线状态与审计记录；用定向测试验证不兼容、重复实例和断连撤回。

## 2. 选择与执行

- [x] 2.1 实现按环境、安装位置、偏好、权限和工作区所有权选择唯一宿主；用定向测试验证 UI/本地/远程/云端组合及无匹配宿主。
- [x] 2.2 在调用入口固定宿主、插件版本和实例，同时校验 `local/cloud` 工具 ID 与 grants；用定向测试验证本地授权不能调用云端同名工具。
- [x] 2.3 建立跨宿主有界调用、取消、期限与最小上下文/资源传输；用定向测试验证取消确认、超时和未授权资源拒绝。

## 3. 故障恢复与迁移

- [x] 3.1 处理断连后的结果未知、禁止自动重放和重连后的重新验证；用定向故障测试验证旧实例迟到结果不覆盖新实例。
- [ ] 3.2 处理插件升级、停用及在途调用归属；用定向测试验证版本固定和贡献不双重发布。
- [ ] 3.3 接入 UI、本地工作区、远程工作区与云端宿主并保留旧本地路径兼容；用集成测试验证各位置执行、无设备权限失败和回滚路径。
- [ ] 3.4 完成跨位置安全验收：远程 URI、凭据代理、桌面 IPC 与任务授权；用定向安全测试和故障演练记录结果。

## 进度记录（进行中，未提交归档）

- 1.1 已完成并勾选：`packages/plugin-contracts/src/placement.ts` 定义 `ui`/`local-workspace`/`remote-workspace`/`cloud` 位置、设备（display/input/filesystem/network）、工作区要求（none/session-input/session-output/session-workspace）与握手协议版本；`manifestSchema` 增加可选 `placement`，缺失声明的旧插件保持“任意可用宿主”的现有行为（`supportsLocation` 对 `undefined` 返回 true）。
  - 定向契约测试：`packages/plugin-contracts/tests/unit/placement.test.ts` 4 项——默认 protocol/workspace、空位置/未知位置/preferred 不在 locations 内被拒、旧 manifest 无声明仍兼容、非法 devices 与 protocol 报 `INVALID_MANIFEST` 而不是静默丢弃要求。
- 1.2 已完成并勾选：`apps/agent-runtime/src/placement/hosts.ts` 提供版本化握手（`HostRegistry.connect`）、实例 ID 与淘汰墓碑、在线状态、`assertCurrent` 旧 epoch 拒绝与审计事件（connected/superseded/disconnected）；不支持的协议报 `PLACEMENT_PROTOCOL_UNSUPPORTED`，断连立即撤回新调用入口。
- 2.1/2.2 已完成并勾选：`placement/selector.ts` 按位置声明、设备能力、工作区要求、宿主已安装插件/工具、`local`/`cloud` target 命名空间与 grants 选择唯一宿主，支持调用方偏好与声明偏好，并记录 selected/refused 审计；`local` 位置只允许 `ui`/`local-workspace`，`cloud` 只允许 `remote-workspace`/`cloud`，grant 必须精确匹配工具 ID（`<toolId>` 或 `<toolId>@<version>`）。
- 2.3 已完成并勾选：`placement/invoker.ts` 在调用开始时固定宿主、实例与插件版本，只向目标宿主传递 requestId/callId/taskId/sessionId/deadline/grants 最小上下文，deadline 通过独立超时信号传播，取消请求发往被固定的实例；未获确认的取消或超时按 `PLACEMENT_RESULT_UNKNOWN` 记录，不视为成功。
  - 未授权资源拒绝依赖变更一已验收的资源层（跨会话 URI 读取返回 `RESOURCE_UNAUTHORIZED`，见 `openspec/specs/resource-uri-platform`），本变更不再重复实现。
- 3.1 已完成并勾选：断连或渠道异常且宿主不再是当前实例时报 `PLACEMENT_RESULT_UNKNOWN`，绝不自动重放或改投其他宿主；宿主以新实例重连后旧实例结果被 `PLACEMENT_STALE_INSTANCE` 丢弃，新调用必须重新握手并在 `selectHost` 重新校验授权。
- 本轮验证：`pnpm vitest run apps/agent-runtime/tests/unit/placement packages/plugin-contracts/tests` → 6 文件 45 项通过（其中 placement 14 项）；`pnpm --filter @actiondriver/plugin-contracts build` 后 `pnpm --filter @actiondriver/plugin-contracts typecheck`、`pnpm --filter @actiondriver/agent-runtime typecheck` 与改动文件 ESLint 通过。
- 仍未完成（未勾选）：
  - 3.2 插件升级/停用的在途归属只实现了“固定版本 + 实例墓碑”，尚未验证升级后贡献不双重发布。
  - 3.3 尚未把宿主目录/选择器/调用器接进真实的 UI、本地工作区、远程工作区与云端通道（现有 Desktop 本地能力 WebSocket 未注册为宿主，`local` 旧路径仍是唯一实通路），因此没有集成测试与回滚演练。
  - 3.4 跨位置安全验收（远程 URI、凭据代理、桌面 IPC、任务授权）尚未执行。
  - 现状风险：选择器与调用器目前是独立契约层实现，未接入运行时工具派发；在 3.3 完成前，生产路径仍按旧本地通道执行，位置声明不会改变实际执行位置。
