## 1. 资源协议

- [x] 1.1 在共享契约中定义版本化 URI、provider 能力、权威调用上下文、错误码与取消信号；用定向测试验证规范化、非法 URI 和跨作用域拒绝。
- [x] 1.2 建立 scheme/provider 注册与生命周期管理；用定向测试验证重复注册、版本不兼容、卸载和不可用时无文件系统回退。

## 2. 操作与版本

- [x] 2.1 实现有界流 read、list、write 与能力错误；用定向测试验证大文件、超时、取消及未提交写入不被当作成功。
- [x] 2.2 实现预期版本写入、创建条件和不可变资源拒写；用并发定向测试验证冲突不覆盖、派生新版不改历史引用。
- [x] 2.3 实现 watch 的版本/序号、权限撤销和断线重同步；用定向测试验证事件缺口可见且跨会话监听失败。

## 3. Provider 与兼容迁移

- [x] 3.1 将会话输入及登记产物接入只读 provider，并保留旧文件 ID 解析；用历史任务和跨会话定向测试验证原版本与隔离。
- [ ] 3.2 接入可写工作资源、插件资源及远程 provider；用定向测试覆盖读写列举监听、远程断线和取消。
- [ ] 3.3 将 Desktop 打开资源及插件 Host API 接入 URI 路由并保留兼容适配；用定向测试验证任意路径/URI 无法绕过桌面白名单。
- [ ] 3.4 用端到端样例验证旧任务卡片、同会话输入、远程资源与并发写入在重启后仍符合 spec；记录兼容与回滚结果。

## 进度记录（进行中，未提交归档）

- 已完成 1.1、1.2、2.1、2.2、2.3，实现落在共享契约与 Runtime 资源层，尚未接入既有输入/产物存储、插件资源、远程 provider、Desktop 与插件 Host API；3.1–3.4 未开始。
  - 契约：`packages/runtime-contracts/src/resource-uri.ts` 定义 `adr://v1/<scheme>/<id>` 规范化 URI（含可选 task/session/version 作用域）、`RESOURCE_*` 结构化错误码、provider 描述符（能力显式声明）、provider 操作接口与有界流读写请求。
  - 注册表：`apps/agent-runtime/src/resources/registry.ts` 按 scheme 注册 provider，重复 scheme 报 `RESOURCE_VERSION_CONFLICT` 并给出双方归属，协议版本不受支持报 `RESOURCE_UNSUPPORTED`，从未服务的 scheme 报 `RESOURCE_SCHEME_UNKNOWN`，已停用 provider 报 `RESOURCE_UNAVAILABLE`（无文件系统回退），并在分发前完成作用域、取消与截止时间校验。
  - 语义：`apps/agent-runtime/src/resources/store.ts` 提供 `boundedStream` 与 `VersionedResourceStore`：有界分块读取、写入中断不产生已提交版本、预期版本写入冲突不覆盖、`createOnly` 创建条件、交付后不可变（`RESOURCE_IMMUTABLE`）、按 `version` 选择符读取历史版本、watch 携带版本与序号、`reportGap` 产生 `resync-required`、权限撤销后停止投递。
  - 定向测试：`pnpm vitest run packages/runtime-contracts/tests/unit/resource-uri.test.ts apps/agent-runtime/tests/unit/resources/` → 3 文件 17 项全部通过；`pnpm --filter @actiondriver/agent-runtime typecheck` 与 `pnpm --filter @actiondriver/runtime-contracts typecheck` 通过；改动文件 ESLint 通过。
- 3.1 进行中（未勾选）：只读 provider 与旧 ID 兼容映射已实现并有定向测试，但**尚未接入真实存储与 Runtime 装配**。
  - 已实现：`apps/agent-runtime/src/resources/media-providers.ts` 提供 `createInputFileProvider`/`createOutputFileProvider`，输入按 `sessionId` 授权读取、产物按 `taskId + sessionId` 校验后读取登记副本，列表以虚拟集合 id `all` 暴露且条目标记 `immutable`；`legacyResourceUri(scheme, fileId, scope)` 把旧文件 ID 直接映射为 URI（id 即 fileId，不改写历史指向）。
  - 定向测试（fake 端口）：`apps/agent-runtime/tests/unit/resources/media-providers.test.ts` 4 项通过——旧 ID 可解析并读到原字节、跨会话读取与监听在 provider 之前被拒绝且未触碰存储、存储归属不符转成结构化 `RESOURCE_NOT_FOUND`、产物列表带任务归属与不可变标记。
  - 已补齐资源 HTTP 路由：`apps/agent-runtime/src/service/http/http-routes-resources.ts` 提供 `POST /resources/read|list`，把调用方作用域原样交给注册表，内联读取上限 8 MiB（超限报 `RESOURCE_UNSUPPORTED`，不静默截断）；`mapErrorToResponse` 新增 `ResourceError` 分支（403/404/409/400），定向测试 3 项通过。
- 3.1 已完成并勾选：`apps/agent-runtime/src/resources/runtime-resources.ts` 提供 `createRuntimeResourceRegistryFromStores`（把 `SessionInputFileStore.read` + `repositories.inputFiles.listBySession` 与 `SessionOutputStore.readSnapshot|listByTask` 接到两个只读 provider）与 `createResourceHttpPort`（每次请求给出独立 deadline 与取消信号）；`runtime-process.ts` 实例化该注册表并把端口传入 `startServiceHttpServer`，`http-service.ts` 在提供 `resourceRoutes` 时挂载 `POST /resources/read|list`。
  - 真实存储定向测试：`apps/agent-runtime/tests/unit/resources/runtime-resources.test.ts` 3 项通过——历史任务产物在后续任务覆盖同名输出路径后仍读到原登记副本、同会话输入可经 URI 读取并列举、跨会话读取与列举被拒（带作用域的 URI 报 `RESOURCE_UNAUTHORIZED`，无作用域 URI 由存储归属校验转成 `RESOURCE_NOT_FOUND`，不泄露字节）。
  - 本轮定向验证：`pnpm vitest run apps/agent-runtime/tests/unit/resources/` → 5 文件 21 项全部通过；`pnpm --filter @actiondriver/agent-runtime typecheck` 通过；改动文件 ESLint 通过。
