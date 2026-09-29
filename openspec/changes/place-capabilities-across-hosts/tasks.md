## 1. 声明与宿主发现

- [x] 1.1 为插件和能力定义 UI、本地工作区、远程工作区、云端位置及设备/工作区需求；用定向契约测试验证旧插件兼容和不满足要求时明确失败。
- [x] 1.2 建立版本化宿主握手、实例 ID、在线状态与审计记录；用定向测试验证不兼容、重复实例和断连撤回。

## 2. 选择与执行

- [x] 2.1 实现按环境、安装位置、偏好、权限和工作区所有权选择唯一宿主；用定向测试验证 UI/本地/远程/云端组合及无匹配宿主。
- [x] 2.2 在调用入口固定宿主、插件版本和实例，同时校验 `local/cloud` 工具 ID 与 grants；用定向测试验证本地授权不能调用云端同名工具。
- [x] 2.3 建立跨宿主有界调用、取消、期限与最小上下文/资源传输；用定向测试验证取消确认、超时和未授权资源拒绝。

## 3. 故障恢复与迁移

- [x] 3.1 处理断连后的结果未知、禁止自动重放和重连后的重新验证；用定向故障测试验证旧实例迟到结果不覆盖新实例。
- [x] 3.2 处理插件升级、停用及在途调用归属；用定向测试验证版本固定和贡献不双重发布。
- [x] 3.3 接入 UI、本地工作区、远程工作区与云端宿主并保留旧本地路径兼容；用集成测试验证各位置执行、无设备权限失败和回滚路径。
- [x] 3.4 完成跨位置安全验收：远程 URI、凭据代理、桌面 IPC 与任务授权；用定向安全测试和故障演练记录结果。

## 进度记录（全部完成，待归档）

- 1.1 已完成并勾选：`packages/plugin-contracts/src/placement.ts` 定义 `ui`/`local-workspace`/`remote-workspace`/`cloud` 位置、设备（display/input/filesystem/network）、工作区要求（none/session-input/session-output/session-workspace）与握手协议版本；`manifestSchema` 增加可选 `placement`，缺失声明的旧插件保持“任意可用宿主”的现有行为（`supportsLocation` 对 `undefined` 返回 true）。
  - 定向契约测试：`packages/plugin-contracts/tests/unit/placement.test.ts` 4 项——默认 protocol/workspace、空位置/未知位置/preferred 不在 locations 内被拒、旧 manifest 无声明仍兼容、非法 devices 与 protocol 报 `INVALID_MANIFEST` 而不是静默丢弃要求。
- 1.2 已完成并勾选：`apps/agent-runtime/src/placement/hosts.ts` 提供版本化握手（`HostRegistry.connect`）、实例 ID 与淘汰墓碑、在线状态、`assertCurrent` 旧 epoch 拒绝与审计事件（connected/superseded/disconnected）；不支持的协议报 `PLACEMENT_PROTOCOL_UNSUPPORTED`，断连立即撤回新调用入口。
- 2.1/2.2 已完成并勾选：`placement/selector.ts` 按位置声明、设备能力、工作区要求、宿主已安装插件/工具、`local`/`cloud` target 命名空间与 grants 选择唯一宿主，支持调用方偏好与声明偏好，并记录 selected/refused 审计；`local` 位置只允许 `ui`/`local-workspace`，`cloud` 只允许 `remote-workspace`/`cloud`，grant 必须精确匹配工具 ID（`<toolId>` 或 `<toolId>@<version>`）。
- 2.3 已完成并勾选：`placement/invoker.ts` 在调用开始时固定宿主、实例与插件版本，只向目标宿主传递 requestId/callId/taskId/sessionId/deadline/grants 最小上下文，deadline 通过独立超时信号传播，取消请求发往被固定的实例；未获确认的取消或超时按 `PLACEMENT_RESULT_UNKNOWN` 记录，不视为成功。
  - 未授权资源拒绝依赖变更一已验收的资源层（跨会话 URI 读取返回 `RESOURCE_UNAUTHORIZED`，见 `openspec/specs/resource-uri-platform`），本变更不再重复实现。
- 3.1 已完成并勾选：断连或渠道异常且宿主不再是当前实例时报 `PLACEMENT_RESULT_UNKNOWN`，绝不自动重放或改投其他宿主；宿主以新实例重连后旧实例结果被 `PLACEMENT_STALE_INSTANCE` 丢弃，新调用必须重新握手并在 `selectHost` 重新校验授权。
- 本轮验证：`pnpm vitest run apps/agent-runtime/tests/unit/placement packages/plugin-contracts/tests` → 6 文件 45 项通过（其中 placement 14 项）；`pnpm --filter @actiondriver/plugin-contracts build` 后 `pnpm --filter @actiondriver/plugin-contracts typecheck`、`pnpm --filter @actiondriver/agent-runtime typecheck` 与改动文件 ESLint 通过。
- 3.2 已完成并勾选：
  - 选择器现在要求宿主声明的插件清单包含被抓取的 `plugin@version`：宿主升级或停用插件后，新调用不再落到该版本，而在途调用继续按原 owner/version 归属（`PlacementInvoker` 固定 `hostEpoch` 与 `version`）。
  - `HostRegistry.connect` 拒绝同一插件 id 的重复声明（防止一次握手双重发布贡献），并对同实例重新握手记录 `host.updated` 审计（升级/停用可追踪）。
  - 定向测试：`placement.test.ts` 新增 4 项——重复插件声明被拒、升级审计、升级期间在途调用保持 v1 且新调用只选到 v2、停用插件后不再可选。
- 3.3 已完成并勾选：
  - 新增真实通道与宿主面：`placement/channels.ts`（本地技能通道 + 远程 HTTP 通道，只传 owner/toolId/payload/最小 context，信号属于传输状态不上线）、`placement/routes.ts`（`GET /placement/hosts`、`POST /placement/handshake|disconnect|invoke|cancel`）、`placement/router.ts`（`PlacementRouter` 组合宿主目录、选择器、调用器与通道；`connectRemoteHost` 采纳远端自报的 hostId/instanceId/清单，避免用本进程臆造的实例 ID 固定调用）。
  - 接入运行时：`runtime-process.ts` 把本进程注册为本地宿主（工具清单取自真实工具注册表、插件清单取自 `pluginPlatform.catalogs()`、仅绑定实际可经技能通道执行的 `tools/local/cua/*`），按 `ACTIONDRIVER_PLACEMENT_HOSTS` 连接远程宿主（不可达只记日志、撤回新调用而不阻止启动），并把宿主面挂到服务 HTTP（`http-service.ts` 的 `placementRoutes`）；`http-errors.ts` 新增 `PlacementError` 映射（403/404/409/500/400）。
  - 旧本地路径兼容：`PlacementRouter.invoke` 对未声明他处、且没有非本地宿主服务该工具的调用返回 `{placed:false}`，生产路径继续走既有本地通道；无声明插件在任何位置都不受影响。回滚方式：不配置 `ACTIONDRIVER_PLACEMENT_HOSTS` 或移除 `placementRoutes` 即回到纯本地执行，声明字段可保留不使用。
  - 定向测试：`router.test.ts` 9 项——未声明本地工具走旧路径、云端工具经真实 HTTP 宿主面执行并回传、缺少云端 grant 明确拒绝且不回落本地、仅远程插件无宿主时明确 `PLACEMENT_NO_HOST`、固定到旧实例的调用被 409 拒绝、UI 宿主只能执行已声明绑定、宿主握手与选择进入审计、取消只在调用真正结束后确认、配置解析与回滚路径。
- 3.4 已完成并勾选（`placement/security-acceptance.test.ts` 4 项故障/安全演练）：
  - 最小上下文：跨宿主线上负载仅含 requestId/callId/taskId/sessionId/deadline/grants 与固定 owner，断言不含 `adr://`、`file://`、token/secret/apiKey 字样；远程宿主拿不到资源 URI 或工作区路径。
  - UI 宿主边界：`electron.ipc.invoke`、`computer-use.permissions`、`resources.read` 等未声明能力一律 404 `PLACEMENT_UNAVAILABLE`，页面权限不因位置选择扩大。
  - 授权边界：只持本地 grant 的云端调用报 `PLACEMENT_TARGET_MISMATCH`，且远端审计长度不变（确实没有到达远端，也没有本地重放）。
  - 故障演练结果记录在测试断言中：断连 → `PLACEMENT_NO_HOST`（无本地回落）；期限 → `PLACEMENT_RESULT_UNKNOWN`（不宣告成功）；取消被宿主确认 → 仍按未确认副作用记 `PLACEMENT_RESULT_UNKNOWN`。
  - 本轮修复：调用器把通道调用与 abort 竞速，宿主即使忽略信号也不会拖过调用期限或取消（此前会让调用悬挂）。
- 全部 9 项任务完成。已知边界（不影响验收，供后续演进）：`/placement/*` 与本轮资源面一样没有推送式 watch；宿主库存由配置/握手提供，尚无 UI 侧宿主发现面板；Desktop 进程仍以“本地工作区宿主”注册，尚未单独注册为 `ui` 宿主。
