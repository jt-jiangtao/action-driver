## 1. 资源协议

- [x] 1.1 在共享契约中定义版本化 URI、provider 能力、权威调用上下文、错误码与取消信号；用定向测试验证规范化、非法 URI 和跨作用域拒绝。
- [x] 1.2 建立 scheme/provider 注册与生命周期管理；用定向测试验证重复注册、版本不兼容、卸载和不可用时无文件系统回退。

## 2. 操作与版本

- [x] 2.1 实现有界流 read、list、write 与能力错误；用定向测试验证大文件、超时、取消及未提交写入不被当作成功。
- [x] 2.2 实现预期版本写入、创建条件和不可变资源拒写；用并发定向测试验证冲突不覆盖、派生新版不改历史引用。
- [x] 2.3 实现 watch 的版本/序号、权限撤销和断线重同步；用定向测试验证事件缺口可见且跨会话监听失败。

## 3. Provider 与兼容迁移

- [x] 3.1 将会话输入及登记产物接入只读 provider，并保留旧文件 ID 解析；用历史任务和跨会话定向测试验证原版本与隔离。
- [x] 3.2 接入可写工作资源、插件资源及远程 provider；用定向测试覆盖读写列举监听、远程断线和取消。
- [x] 3.3 将 Desktop 打开资源及插件 Host API 接入 URI 路由并保留兼容适配；用定向测试验证任意路径/URI 无法绕过桌面白名单。
- [x] 3.4 用端到端样例验证旧任务卡片、同会话输入、远程资源与并发写入在重启后仍符合 spec；记录兼容与回滚结果。

## 进度记录（进行中，未提交归档）

- 已完成 1.1、1.2、2.1、2.2、2.3，实现落在共享契约与 Runtime 资源层，尚未接入既有输入/产物存储、插件资源、远程 provider、Desktop 与插件 Host API；3.1–3.4 未开始。
  - 契约：`packages/runtime-contracts/src/resource-uri.ts` 定义 `adr://v1/<scheme>/<id>` 规范化 URI（含可选 task/session/version 作用域）、`RESOURCE_*` 结构化错误码、provider 描述符（能力显式声明）、provider 操作接口与有界流读写请求。
  - 注册表：`apps/agent-runtime/src/resources/registry.ts` 按 scheme 注册 provider，重复 scheme 报 `RESOURCE_VERSION_CONFLICT` 并给出双方归属，协议版本不受支持报 `RESOURCE_UNSUPPORTED`，从未服务的 scheme 报 `RESOURCE_SCHEME_UNKNOWN`，已停用 provider 报 `RESOURCE_UNAVAILABLE`（无文件系统回退），并在分发前完成作用域、取消与截止时间校验。
  - 语义：`apps/agent-runtime/src/resources/store.ts` 提供 `boundedStream` 与 `VersionedResourceStore`：有界分块读取、写入中断不产生已提交版本、预期版本写入冲突不覆盖、`createOnly` 创建条件、交付后不可变（`RESOURCE_IMMUTABLE`）、按 `version` 选择符读取历史版本、watch 携带版本与序号、`reportGap` 产生 `resync-required`、权限撤销后停止投递。
  - 定向测试：`pnpm vitest run packages/runtime-contracts/tests/unit/resource-uri.test.ts apps/agent-runtime/tests/unit/resources/` → 3 文件 17 项全部通过；`pnpm --filter @action-driver/agent-runtime typecheck` 与 `pnpm --filter @action-driver/runtime-contracts typecheck` 通过；改动文件 ESLint 通过。
- 3.1 进行中（未勾选）：只读 provider 与旧 ID 兼容映射已实现并有定向测试，但**尚未接入真实存储与 Runtime 装配**。
  - 已实现：`apps/agent-runtime/src/resources/media-providers.ts` 提供 `createInputFileProvider`/`createOutputFileProvider`，输入按 `sessionId` 授权读取、产物按 `taskId + sessionId` 校验后读取登记副本，列表以虚拟集合 id `all` 暴露且条目标记 `immutable`；`legacyResourceUri(scheme, fileId, scope)` 把旧文件 ID 直接映射为 URI（id 即 fileId，不改写历史指向）。
  - 定向测试（fake 端口）：`apps/agent-runtime/tests/unit/resources/media-providers.test.ts` 4 项通过——旧 ID 可解析并读到原字节、跨会话读取与监听在 provider 之前被拒绝且未触碰存储、存储归属不符转成结构化 `RESOURCE_NOT_FOUND`、产物列表带任务归属与不可变标记。
  - 已补齐资源 HTTP 路由：`apps/agent-runtime/src/service/http/http-routes-resources.ts` 提供 `POST /resources/read|list`，把调用方作用域原样交给注册表，内联读取上限 8 MiB（超限报 `RESOURCE_UNSUPPORTED`，不静默截断）；`mapErrorToResponse` 新增 `ResourceError` 分支（403/404/409/400），定向测试 3 项通过。
- 3.1 已完成并勾选：`apps/agent-runtime/src/resources/runtime-resources.ts` 提供 `createRuntimeResourceRegistryFromStores`（把 `SessionInputFileStore.read` + `repositories.inputFiles.listBySession` 与 `SessionOutputStore.readSnapshot|listByTask` 接到两个只读 provider）与 `createResourceHttpPort`（每次请求给出独立 deadline 与取消信号）；`runtime-process.ts` 实例化该注册表并把端口传入 `startServiceHttpServer`，`http-service.ts` 在提供 `resourceRoutes` 时挂载 `POST /resources/read|list`。
  - 真实存储定向测试：`apps/agent-runtime/tests/unit/resources/runtime-resources.test.ts` 3 项通过——历史任务产物在后续任务覆盖同名输出路径后仍读到原登记副本、同会话输入可经 URI 读取并列举、跨会话读取与列举被拒（带作用域的 URI 报 `RESOURCE_UNAUTHORIZED`，无作用域 URI 由存储归属校验转成 `RESOURCE_NOT_FOUND`，不泄露字节）。
  - 本轮定向验证：`pnpm vitest run apps/agent-runtime/tests/unit/resources/` → 5 文件 21 项全部通过；`pnpm --filter @action-driver/agent-runtime typecheck` 通过；改动文件 ESLint 通过。
- 3.2 已完成并勾选：
  - 可写工作资源：`apps/agent-runtime/src/resources/work-provider.ts` 提供 `createSessionScopedStoreProvider`，把 `VersionedResourceStore` 按 `<sessionId>/<path>` 命名空间暴露为 `workspace` scheme，支持 read/write/list/watch；跨会话读写与监听在 provider 内先拒绝，写入沿用预期版本、`createOnly`、取消与期限语义。
  - 插件资源：`apps/agent-runtime/src/resources/plugin-resources.ts` 提供 `createPluginResourceProvider`（`plugin` scheme，按 `<pluginId>/<sessionId>/` 授权）与 `createPluginArtifactHostPorts`；`artifacts.create` 写入宿主拥有的 plugin store，`artifacts.read` 接受统一 URI 并保留裸 artifact id 兼容；`plugins/host-api.ts` 把调用信号传给 artifacts 端口，`runtime-process.ts` 通过 `apiPorts.artifacts` 装配。
  - 远程 provider：`remote-provider.ts` 把传输的断连、取消、期限和监听缺口翻译成 `RESOURCE_UNAVAILABLE`/`RESOURCE_CANCELLED`/`RESOURCE_DEADLINE_EXCEEDED` 与 `resync-required`，写入中途断连显式标注结果未知且不自动重放；`remote-http-transport.ts` 是真实 HTTP 传输（`/readyz` 探活 + `/resources/read|list|write`），`parseRemoteResourceHosts` 从 `ACTION_DRIVER_RESOURCE_REMOTE_HOSTS` 注册远程 scheme，声明解析失败即报错、不静默丢弃宿主；HTTP 面没有推送通道，因此远程注册显式声明 `watch: false`，watch 请求得到 `RESOURCE_UNSUPPORTED` 而非半截流。
  - 资源 HTTP 面补齐 `POST /resources/write`（内联上限 8 MiB，支持 `expectedVersion`/`createOnly`/`contentType`），有界读写经 `RESOURCE_INLINE_MAX_BYTES` 校验。
  - 定向测试：`apps/agent-runtime/tests/unit/resources/provider-platform.test.ts` 13 项（工作资源读写列举监听、跨会话拒绝、并发冲突不覆盖、取消/期限、插件跨 plugin 与跨会话拒绝、远程断连、写入结果未知不重放、watch 缺口、取消传播、HTTP 传输代理与结构化拒绝翻译）；`runtime-resources.test.ts` 新增远程宿主注册/非法声明拒绝 2 项。
  - 本轮验证：`pnpm vitest run apps/agent-runtime/tests/unit/resources/` → 6 文件 36 项全部通过；`pnpm vitest run apps/agent-runtime/tests/unit/plugins apps/agent-runtime/tests/unit/composition-root.test.ts apps/agent-runtime/tests/unit/runtime-process.test.ts apps/agent-runtime/tests/unit/service-http.test.ts` → 20 文件 95 项通过；`pnpm --filter @action-driver/agent-runtime typecheck`、`pnpm --filter @action-driver/runtime-contracts typecheck`、`pnpm vitest run packages/runtime-contracts/tests`（51 项）与改动文件 ESLint 均通过。
- 3.3 已完成并勾选：
  - Desktop 打开资源：`apps/desktop/src/main/task-output-ipc.ts` 同时接受 `uri` 与旧 `{fileId,taskId,sessionId}`（恰好一个），URI 必须通过共享契约的 `parseResourceUri` 规范化校验（拒绝路径、`file://`/`https://`、非 `adr://v1`、路径穿越与 fragment），随后经 `POST /resources/read` 由运行时解析并返回受控字节，只有该字节会写入临时文件交给系统打开；`apps/desktop/src/shared/task-output-contract.ts`、`preload/desktop-api.ts` 与渲染层 `services/task-output-open.ts` 保留旧三元组兼容。
  - 插件 Host API：`artifacts.create/read` 已在 3.2 接入统一 URI（含裸 id 兼容），本轮补齐协作契约：`packages/runtime-contracts/src/stream-protocol.ts` 的 `response.end`/`response.snapshot` `outputFiles` 增加可选 `uri`，`packages/contracts` 的 `TaskOutputFileProjection` 增加可选 `uri`；`task-projection.ts`、`stream/stream-snapshot.ts`、`stream-session-service.ts` 在任务卡片与快照中投影该 URI，渲染层优先用它打开、无 URI 时回退旧标识。
  - 定向测试：`apps/desktop/tests/unit/main/task-output-ipc.test.ts` 4 项（URI 经 `/resources/read` 打开并保留扩展名；`/etc/passwd`、`../../secrets.pdf`、`file://`、`https://`、`adr://v1/...#fragment`、`adr://v2/...` 与同时给出 uri+fileId 全部在 fetch/openPath 之前拒绝）。
  - 本轮验证：`pnpm vitest run apps/desktop/tests/unit/main apps/agent-runtime/tests/unit/service-websocket.test.ts apps/agent-runtime/tests/unit/resources` → 37 文件 138 项通过；`apps/agent-runtime/tests/unit/stream-session-service.test.ts`+`task-projection`+`local-runtime-server`+契约测试 → 8 文件 101 项通过；`runtime-contracts`/`contracts`/`agent-runtime`/`desktop` typecheck 与改动文件 ESLint 通过。
- 3.4 已完成并勾选：
  - 端到端样例：`apps/agent-runtime/tests/unit/resources/resource-e2e.test.ts` 用真实 SQLite 存储、真实 provider 注册表与运行时的 HTTP 资源面（`registerResourceRoutes` + `createResourceHttpPort`，Bearer 校验与 `mapErrorToResponse` 一致）覆盖同一用例内的四条主线：
    1. 旧任务卡片：`toOutputFileProjection` 产出的 URI 经 `POST /resources/read` 读回任务 A 的登记副本，即使任务 B 已覆盖同名输出路径；
    2. 同会话输入：绑定输入经 URI 读回原字节，跨会话读取得到 403 + `RESOURCE_UNAUTHORIZED`；
    3. 远程资源：本地运行时经 `createHttpRemoteResourceTransport` 代理到独立远程宿主的 `remote-host` scheme 读回字节，宿主不可达时报 `RESOURCE_UNAVAILABLE` 而不是回退本地文件；
    4. 并发写入与重启：两个基于 `expectedVersion: '1'` 的并发写入只有一个提交、另一个得到 `RESOURCE_VERSION_CONFLICT`；关闭并重开数据库后，最新版本内容、`?version=1` 历史版本与旧任务卡片 URI 全部仍可读取。
  - 本轮修复：`resources/store.ts` 的写入在并发下会因共享临时 meta 文件名互相 `rename` 而报 `ENOENT`，且版本检查与提交不是原子的（两个写入者可能都通过检查）。现在按资源键串行化写入（`serialize`），临时 meta 文件名唯一化，冲突稳定返回 `RESOURCE_VERSION_CONFLICT`。
  - 兼容与回滚：旧入口全部保留（`GET /sessions/:id/outputs/:fileId/content`、`{fileId,taskId,sessionId}` 打开请求、插件 `artifacts.read({id})`、会话输入按 fileId 读取），新 URI 只是叠加；`ACTION_DRIVER_RESOURCE_REMOTE_HOSTS` 未配置时不注册任何远程 scheme，资源平台不改变既有本地路径行为。回滚方式：不再挂载 `resourceRoutes` 或忽略 `uri` 字段即可回到 3.1 之前的旧入口，历史文件 ID 与登记副本不受影响。
  - 已知限制（不影响本变更验收，记录为后续工作）：远程 HTTP 面目前只有有界内联 read/list/write，没有推送式 watch（远程注册显式 `watch: false`，请求得到 `RESOURCE_UNSUPPORTED`）；远程读取沿用 8 MiB 内联上限，超出报 `RESOURCE_UNSUPPORTED` 而非截断。
