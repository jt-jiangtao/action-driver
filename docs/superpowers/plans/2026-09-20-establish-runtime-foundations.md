# Action-Driver Runtime Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可打包的 Go + Eino Sidecar、版本化 UDS 协议、SQLite 本地存储、统一 Skill Registry 和定制 Electron Fork 供应链骨架，同时保持现有 UI 与 Mock 测试不变。

**Architecture:** Renderer 仅消费领域端口，Preload 暴露白名单 API，Electron Main 独占 Sidecar 进程和 gRPC client，Go Sidecar 独占 Agent Runtime、Skill Registry 与 SQLite。协议使用 Protobuf + gRPC over UDS；定制 Electron 源码在独立 Fork 仓库，本仓库只保存锁定清单、补丁索引和产物验证逻辑。

**Tech Stack:** TypeScript 5.9、Electron 38、InversifyJS 8、Go 1.24.2、Eino v0.9.19、gRPC-Go v1.84.0、modernc SQLite v1.59.0、`@grpc/grpc-js` 1.14.5、ts-proto 2.12.4、Buf CLI 1.73.0、Vitest、Go test、Playwright、Docker。

**Spec:** `openspec/changes/establish-runtime-foundations/design.md`

## Global Constraints

- 仅支持 macOS；生产用户不得依赖 Docker、Go 或 Node.js 开发环境。
- Renderer MUST NOT 获得 UDS 路径、gRPC client、数据库路径、Node.js 或 Electron 原始 API。
- SQLite 只有 Go Sidecar 一个写入者；状态更新和事件追加必须同事务提交。
- Browser Use 与 Computer Use 只共享基础 Skill Contract，Provider 可独立注册和替换。
- 本计划不得实现网页导航、Action Graph、Node Handle、增量观察、真实 Browser/Computer 动作或 Jev 推理。
- 现有 Figma 页面、Mock 模式、47 项单元测试和视觉基线必须保持通过。
- 每个实现任务先写失败测试，再写最小实现；每项 OpenSpec checkbox 只在对应验证命令通过后勾选。

## Review Focus

- Sidecar 启动后永远不 ready：命令必须快速返回 `RUNTIME_UNAVAILABLE`，且只能存在一个启动流程。
- 协议主版本不匹配：必须在任务写入前失败，不能自动降级或部分执行。
- 事件流断线且收到重复游标：投影只能应用一次，并从最后确认游标的下一条恢复。
- SQLite migration 中途失败：schema 与业务数据必须完整回滚，Sidecar 不得进入 ready。
- Fork 产物缺失、架构错误或 SHA-256 不匹配：生产打包必须失败，不得回退 npm 公版 Electron。

---

### Task 1: 建立协议源和可重复代码生成

**Files:**

- Create: `buf.yaml`
- Create: `buf.gen.yaml`
- Create: `proto/action-driver/runtime/v1/runtime.proto`
- Create: `packages/runtime-protocol/package.json`
- Create: `packages/runtime-protocol/tsconfig.json`
- Create: `packages/runtime-protocol/src/generated/runtime.ts`
- Create: `packages/runtime-protocol/tests/protocol.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `pnpm-workspace.yaml`

**Interfaces:**

- Produces: `RuntimeControl`, `AgentCommand`, `RuntimeEvents`, `SkillProvider` gRPC services and v1 message types.
- Produces: root scripts `proto:generate`, `proto:lint`, `proto:check`.

- [ ] **Step 1: 写失败的协议契约测试**

```ts
import { ErrorCode, SkillState } from '../src/generated/runtime'

it('keeps stable wire enum numbers', () => {
  expect(ErrorCode.PROTOCOL_INCOMPATIBLE).toBe(2)
  expect(SkillState.QUEUED).toBe(1)
  expect(SkillState.FAILED).toBe(7)
})
```

- [ ] **Step 2: 运行测试确认缺少生成包**

Run: `corepack pnpm vitest run packages/runtime-protocol/tests/protocol.test.ts`
Expected: FAIL，提示无法解析 `src/generated/runtime`。

- [ ] **Step 3: 定义 v1 Protobuf 和生成配置**

```proto
syntax = "proto3";
package action-driver.runtime.v1;

message RequestContext {
  uint32 protocol_major = 1;
  uint32 protocol_minor = 2;
  string request_id = 3;
  string session_id = 4;
  int64 deadline_unix_ms = 5;
}

enum ErrorCode {
  ERROR_CODE_UNSPECIFIED = 0;
  RUNTIME_UNAVAILABLE = 1;
  PROTOCOL_INCOMPATIBLE = 2;
  CAPABILITY_UNAVAILABLE = 3;
  DEADLINE_EXCEEDED = 4;
}
```

补齐四个 service、Skill 生命周期、task/message/step projection 和事件 cursor；Buf 生成 Go 与 ts-proto 代码，生成文件提交仓库。

- [ ] **Step 4: 验证生成、lint 和 drift**

Run: `corepack pnpm proto:generate && corepack pnpm proto:lint && corepack pnpm proto:check && corepack pnpm vitest run packages/runtime-protocol/tests/protocol.test.ts`
Expected: PASS；`git diff --exit-code -- packages/runtime-protocol/src/generated services/agentd/internal/gen` 返回 0。

- [ ] **Step 5: 提交协议基础**

```bash
git add buf.yaml buf.gen.yaml proto packages/runtime-protocol package.json pnpm-lock.yaml pnpm-workspace.yaml services/agentd/internal/gen
git commit -m "feat(protocol): define local runtime v1 API"
```

### Task 2: 建立 Go Sidecar 与 Eino 隔离边界

**Files:**

- Create: `go.work`
- Create: `services/agentd/go.mod`
- Create: `services/agentd/cmd/action-driver-agentd/main.go`
- Create: `services/agentd/internal/app/config.go`
- Create: `services/agentd/internal/app/service.go`
- Create: `services/agentd/internal/app/service_test.go`
- Create: `services/agentd/internal/einoadapter/driver.go`
- Create: `services/agentd/internal/einoadapter/deterministic.go`

**Interfaces:**

- Produces: `app.Config{SocketPath, DatabasePath, SessionToken, ProtocolMajor, ProtocolMinor}`.
- Produces: `einoadapter.Driver.Run(context.Context, Goal) (Plan, error)`.
- Consumes: generated runtime v1 Go messages from Task 1.

- [ ] **Step 1: 写配置和无凭据启动失败测试**

```go
func TestConfigRejectsMissingPrivatePaths(t *testing.T) {
    _, err := app.ParseConfig([]string{"--socket", "", "--database", ""})
    require.Error(t, err)
}

func TestDeterministicDriverDoesNotRequireModelCredentials(t *testing.T) {
    plan, err := einoadapter.NewDeterministicDriver().Run(context.Background(), einoadapter.Goal{Text: "test"})
    require.NoError(t, err)
    require.Equal(t, "test", plan.Goal)
}
```

- [ ] **Step 2: 运行 Go 测试确认包尚不存在**

Run: `go test ./services/agentd/internal/app ./services/agentd/internal/einoadapter`
Expected: FAIL，提示目标 package 或 symbol 不存在。

- [ ] **Step 3: 创建 Go 模块和 Eino seam**

在 `go.mod` 锁定 `github.com/cloudwego/eino v0.9.19`、`google.golang.org/grpc v1.84.0`、`modernc.org/sqlite v1.59.0`。`einoadapter` 使用 `compose.NewGraph[Goal, Plan]()` 建立可替换图入口，但 Phase 0 默认绑定确定性 driver，不加载模型供应商。

- [ ] **Step 4: 验证 Sidecar 基础包**

Run: `go test -race ./services/agentd/...`
Expected: PASS，且测试不读取任何模型 API key。

- [ ] **Step 5: 提交 Sidecar 骨架**

```bash
git add go.work services/agentd
git commit -m "feat(agentd): add sidecar application skeleton"
```

### Task 3: 实现 SQLite 迁移和事务仓储

**Files:**

- Create: `services/agentd/internal/storage/store.go`
- Create: `services/agentd/internal/storage/sqlite/store.go`
- Create: `services/agentd/internal/storage/sqlite/store_test.go`
- Create: `services/agentd/internal/storage/sqlite/migrations/0001_runtime.sql`
- Create: `services/agentd/internal/storage/sqlite/migrate.go`
- Create: `services/agentd/internal/storage/sqlite/migrate_test.go`

**Interfaces:**

- Produces: `storage.Store.WithTx(ctx, func(storage.Tx) error) error`.
- Produces: `storage.Tx.SaveTask`, `SaveSkillInvocation`, `AppendEvent`, `EventsAfter`.
- Consumes: domain identifiers and serialized v1 event payloads.

- [ ] **Step 1: 写迁移原子性和状态/事件同事务测试**

```go
func TestSkillStateAndEventRollbackTogether(t *testing.T) {
    store := openTempStore(t)
    err := store.WithTx(context.Background(), func(tx storage.Tx) error {
        require.NoError(t, tx.SaveSkillInvocation(fixtureInvocation("running")))
        require.NoError(t, tx.AppendEvent(fixtureEvent(1)))
        return errors.New("rollback")
    })
    require.Error(t, err)
    require.Empty(t, loadInvocations(t, store))
    require.Empty(t, loadEvents(t, store))
}
```

- [ ] **Step 2: 运行存储测试确认失败**

Run: `go test ./services/agentd/internal/storage/...`
Expected: FAIL，提示 storage 实现不存在。

- [ ] **Step 3: 实现 schema、WAL、foreign keys、busy timeout 和 checksum migrations**

`0001_runtime.sql` 创建 `tasks`、`messages`、`steps`、`skill_invocations`、`runtime_events` 和 `schema_migrations`；migration 在 Sidecar ready 前执行，每个文件独立事务。

- [ ] **Step 4: 验证首次创建、幂等重启、回滚和游标读取**

Run: `go test -race ./services/agentd/internal/storage/...`
Expected: PASS，包括损坏 migration fixture 不改变 schema version。

- [ ] **Step 5: 提交本地存储**

```bash
git add services/agentd/internal/storage
git commit -m "feat(storage): add transactional sqlite runtime store"
```

### Task 4: 实现 Skill Registry 和确定性 Runtime

**Files:**

- Create: `services/agentd/internal/skills/registry.go`
- Create: `services/agentd/internal/skills/registry_test.go`
- Create: `services/agentd/internal/runtime/runtime.go`
- Create: `services/agentd/internal/runtime/runtime_test.go`
- Create: `services/agentd/internal/runtime/events.go`
- Create: `services/agentd/internal/runtime/events_test.go`

**Interfaces:**

- Produces: `Registry.Register`, `Unregister`, `Resolve(skillID, contractVersion)`.
- Produces: `Runtime.SubmitGoal`, `InterruptTask`, `ContinueTask`, `InvokeSkill`, `EventsAfter`.
- Consumes: `storage.Store` and `einoadapter.Driver`.

- [ ] **Step 1: 写独立 Provider、未注册能力和游标恢复测试**

```go
func TestBrowserProviderDoesNotChangeComputerProvider(t *testing.T) {
    registry := skills.NewRegistry()
    registry.Register(browserProvider())
    require.True(t, registry.Available("browser-use", 1))
    require.False(t, registry.Available("computer-use", 1))
}
```

- [ ] **Step 2: 运行 Runtime 测试确认失败**

Run: `go test ./services/agentd/internal/skills ./services/agentd/internal/runtime`
Expected: FAIL，提示 Registry 和 Runtime 不存在。

- [ ] **Step 3: 实现注册、调用状态机和事件顺序**

调用已注册 Skill 时先在事务中保存 `queued` 和事件，再交给 Provider；未注册时返回 `CAPABILITY_UNAVAILABLE`。`EventsAfter(cursor)` 只返回严格大于 cursor 的事件并保持升序。

- [ ] **Step 4: 验证 Registry 与 Runtime**

Run: `go test -race ./services/agentd/internal/skills ./services/agentd/internal/runtime`
Expected: PASS，包含重复 cursor 不重复应用和 Browser/Computer 独立上下线。

- [ ] **Step 5: 提交 Runtime**

```bash
git add services/agentd/internal/skills services/agentd/internal/runtime
git commit -m "feat(runtime): add skill registry and event orchestration"
```

### Task 5: 实现 gRPC UDS Server 和 TypeScript Runtime Client

**Files:**

- Create: `services/agentd/internal/transport/grpc/server.go`
- Create: `services/agentd/internal/transport/grpc/server_test.go`
- Create: `apps/desktop/src/main/runtime/runtime-client.ts`
- Create: `apps/desktop/src/main/runtime/runtime-client.test.ts`
- Create: `apps/desktop/src/main/runtime/protocol-mapper.ts`
- Create: `apps/desktop/src/main/runtime/protocol-mapper.test.ts`
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces: `RuntimeClient.handshake`, `submitGoal`, `interruptTask`, `continueTask`, `subscribe`, `shutdown`.
- Consumes: Runtime v1 generated clients, Go Runtime and session token.

- [ ] **Step 1: 写 UDS-only、版本拒绝、deadline 和重复游标测试**

```ts
it('rejects a mismatched protocol major before commands', async () => {
  const client = createRuntimeClient(fakeTransport({ protocolMajor: 2 }))
  await expect(client.handshake({ protocolMajor: 1 })).rejects.toMatchObject({
    code: 'PROTOCOL_INCOMPATIBLE'
  })
})
```

- [ ] **Step 2: 运行 Go 和 TypeScript 传输测试确认失败**

Run: `go test ./services/agentd/internal/transport/... && corepack pnpm vitest run apps/desktop/src/main/runtime`
Expected: FAIL，提示 server/client 不存在。

- [ ] **Step 3: 实现临时 UDS listener、token interceptor、service handlers 和 JS client**

Go Server 不创建 TCP listener；TypeScript client 使用 `unix:<socketPath>`。所有命令传递 request id/deadline，事件订阅保存最后已应用 cursor 并丢弃重复项。

- [ ] **Step 4: 运行跨语言与映射测试**

Run: `go test -race ./services/agentd/internal/transport/... && corepack pnpm vitest run apps/desktop/src/main/runtime packages/runtime-protocol/tests`
Expected: PASS，且 TaskProjection 通过 `structuredClone`。

- [ ] **Step 5: 提交传输层**

```bash
git add services/agentd/internal/transport apps/desktop/src/main/runtime apps/desktop/package.json pnpm-lock.yaml
git commit -m "feat(runtime): connect Electron and agentd over UDS"
```

### Task 6: 实现 Electron Sidecar Supervisor

**Files:**

- Create: `apps/desktop/src/main/runtime/sidecar-process.ts`
- Create: `apps/desktop/src/main/runtime/sidecar-supervisor.ts`
- Create: `apps/desktop/src/main/runtime/sidecar-supervisor.test.ts`
- Create: `apps/desktop/src/main/runtime/runtime-paths.ts`
- Modify: `apps/desktop/src/main/container.ts`
- Modify: `apps/desktop/src/main/container.test.ts`
- Modify: `apps/desktop/src/main/index.ts`

**Interfaces:**

- Produces: `SidecarSupervisor.start(): Promise<RuntimeClient>` and `stop(): Promise<void>`.
- Produces: states `stopped | starting | ready | degraded | stopping | failed`.
- Consumes: injectable `SidecarProcessFactory`, `RuntimeClientFactory`, clock and filesystem ports.

- [ ] **Step 1: 写单实例、启动未就绪、三次重启上限和清理测试**

```ts
it('shares one in-flight start across windows', async () => {
  const first = supervisor.start()
  const second = supervisor.start()
  expect(first).toBe(second)
  expect(processFactory.spawn).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: 运行 Supervisor 测试确认失败**

Run: `corepack pnpm vitest run apps/desktop/src/main/runtime/sidecar-supervisor.test.ts`
Expected: FAIL，提示 SidecarSupervisor 不存在。

- [ ] **Step 3: 实现状态机、私有运行目录、架构二进制选择和有界重启**

60 秒窗口内最多 3 次重启；超过预算进入 `failed`。`stop()` 先调用 gRPC shutdown，超时后 terminate，并清理本次 instance 的 socket/run directory。

- [ ] **Step 4: 验证 Main 生命周期集成**

Run: `corepack pnpm vitest run apps/desktop/src/main`
Expected: PASS，窗口重建不会 spawn 第二个 Sidecar，`before-quit` 完成 stop。

- [ ] **Step 5: 提交 Supervisor**

```bash
git add apps/desktop/src/main
git commit -m "feat(desktop): supervise the local agent sidecar"
```

### Task 7: 增加白名单 IPC 与本地 Runtime Adapter

**Files:**

- Create: `apps/desktop/src/main/runtime/runtime-ipc.ts`
- Create: `apps/desktop/src/main/runtime/runtime-ipc.test.ts`
- Create: `apps/desktop/src/renderer/src/services/ipc-agent-runtime.ts`
- Create: `apps/desktop/src/renderer/src/services/ipc-agent-runtime.test.ts`
- Modify: `apps/desktop/src/preload/desktop-api.ts`
- Modify: `apps/desktop/src/preload/desktop-api.test.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/src/env.d.ts`
- Modify: `apps/desktop/src/renderer/src/di/container.ts`
- Modify: `apps/desktop/src/renderer/src/di/container.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/tests/contracts.test.ts`

**Interfaces:**

- Produces: `DesktopApi.agent.submitGoal/getTask/interrupt/continue/subscribeTask`.
- Produces: async `AgentSessionRepository.getTask(taskId): Promise<TaskProjection | null>`.
- Consumes: Main Runtime Client; Renderer never consumes wire types.

- [ ] **Step 1: 写隔离、异步仓储和 mock/local 绑定测试**

```ts
expect(window.productDesktop.agent).toEqual(
  expect.objectContaining({ submitGoal: expect.any(Function), getTask: expect.any(Function) })
)
expect(window.productDesktop).not.toHaveProperty('invoke')
expect(window.productDesktop).not.toHaveProperty('socketPath')
```

- [ ] **Step 2: 运行契约与 Adapter 测试确认失败**

Run: `corepack pnpm vitest run packages/contracts/tests apps/desktop/src/preload apps/desktop/src/renderer/src/services apps/desktop/src/renderer/src/di`
Expected: FAIL，提示 Agent API 与 IpcAgentRuntime 不存在。

- [ ] **Step 3: 实现明确 IPC channel、结构化克隆映射和 DI 模式**

Main 注册固定 channel；Preload 返回 DTO 并管理订阅取消；Renderer `mock` 继续绑定 `MockAgentRuntime`，`local` 绑定 `IpcAgentRuntime`。更新调用点以等待异步 `getTask`，页面结构和样式不变。

- [ ] **Step 4: 验证所有前端测试与视觉基线**

Run: `corepack pnpm check:all`
Expected: 现有及新增测试全部通过，4 张视觉截图差异仍低于 2%。

- [ ] **Step 5: 提交 IPC Adapter**

```bash
git add apps/desktop/src packages/contracts
git commit -m "feat(desktop): expose typed local runtime adapters"
```

### Task 8: 建立定制 Electron Fork 清单和产物校验

**Files:**

- Create: `toolchains/electron-fork/manifest.json`
- Create: `toolchains/electron-fork/manifest.schema.json`
- Create: `toolchains/electron-fork/patches/index.json`
- Create: `toolchains/electron-fork/artifact.schema.json`
- Create: `scripts/electron-fork/validate.mjs`
- Create: `scripts/electron-fork/validate.test.ts`
- Create: `docs/electron-fork.md`
- Modify: `package.json`

**Interfaces:**

- Produces: `electron-fork:validate` and `electron-fork:verify-artifact` scripts.
- Consumes: pinned Electron tag, Chromium revision, fork commit, patch-set id, architecture, protocol major and SHA-256.

- [ ] **Step 1: 写错误 checksum、缺失 patch、架构不匹配和禁止回退测试**

```ts
it('rejects a public Electron fallback for production', () => {
  expect(() => verifyArtifact(fixture({ source: 'npm-public' }), manifest)).toThrow(
    'CUSTOM_ELECTRON_REQUIRED'
  )
})
```

- [ ] **Step 2: 运行 manifest 测试确认失败**

Run: `corepack pnpm vitest run scripts/electron-fork/validate.test.ts`
Expected: FAIL，提示 validator 不存在。

- [ ] **Step 3: 实现 JSON schema、补丁顺序与 SHA-256 校验**

manifest 明确 pin 当前 Electron 38 基线和对应 Chromium revision；patch index 在 Phase 0 可为空但必须有确定 `patchSetId`。生产 verify 缺少定制产物时直接失败。

- [ ] **Step 4: 验证 Fork 工具链元数据**

Run: `corepack pnpm electron-fork:validate && corepack pnpm vitest run scripts/electron-fork/validate.test.ts`
Expected: PASS；任一 fixture 损坏都会非零退出。

- [ ] **Step 5: 提交 Fork 工具链骨架**

```bash
git add toolchains scripts/electron-fork docs/electron-fork.md package.json
git commit -m "build(electron): pin custom fork artifacts"
```

### Task 9: 完成 Docker、macOS 冒烟和全量验收

**Files:**

- Create: `services/agentd/internal/transport/grpc/e2e_test.go`
- Create: `apps/desktop/e2e/sidecar.spec.ts`
- Create: `.github/workflows/quality.yml`
- Create: `.github/workflows/electron-fork-macos.yml`
- Modify: `Dockerfile`
- Modify: `compose.yaml`
- Modify: `package.json`
- Modify: `openspec/changes/establish-runtime-foundations/tasks.md`

**Interfaces:**

- Consumes: all outputs from Tasks 1–8.
- Produces: reproducible `check:runtime`, Docker quality and macOS Sidecar/Fork verification workflows.

- [ ] **Step 1: 写真实 Sidecar E2E**

测试以临时 userData 启动实际二进制，验证 UDS 握手、离线 submit、事件 cursor、第二窗口复用进程和 app 退出后 socket/process 消失。

- [ ] **Step 2: 运行 E2E 确认流水线尚未覆盖**

Run: `corepack pnpm test:e2e --grep "local sidecar"`
Expected: FAIL，提示测试或打包 Sidecar 缺失。

- [ ] **Step 3: 扩展 Docker 和 macOS workflows**

Docker 安装 Go 1.24.2 与 Node 20.14，运行 proto drift、Go race、SQLite、TS、build 和 Fork manifest 检查；macOS workflow 构建/选择架构 Sidecar，并为 Fork 基线产物保留独立受控 job，不在 Linux 容器伪装 macOS Chromium 构建。

- [ ] **Step 4: 执行全量验证并更新 OpenSpec checkbox**

Run: `corepack pnpm format:check && corepack pnpm check:runtime && corepack pnpm check:all && docker compose build quality && docker compose run --rm quality && openspec validate establish-runtime-foundations --strict`
Expected: 全部退出 0；Go race、47 项既有测试、新增 Runtime 测试、Electron E2E 和 OpenSpec strict 均通过。

- [ ] **Step 5: 提交 Phase 0 验收**

```bash
git add .github Dockerfile compose.yaml package.json services/agentd apps/desktop/e2e openspec/changes/establish-runtime-foundations/tasks.md
git commit -m "test(runtime): verify local runtime foundations"
```
