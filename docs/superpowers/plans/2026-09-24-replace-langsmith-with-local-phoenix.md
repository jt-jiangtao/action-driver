# 本地 Phoenix 替换 LangSmith 与无用代码清理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 LangSmith，把模型调用内容追踪接到本地 Phoenix，清理经引用审计证实无用途的代码和依赖，同时保留历史 SQLite 数据及仍在使用的迁移路径。

**Architecture:** Runtime 的模型网关依赖内部 `ModelTracePort`，生产装配注入 `PhoenixModelObservability(logging.tracer)`。Alloy 向 Phoenix 发送模型原文并向 Tempo 发送白名单属性；旧模型日志 UI、IPC、SQLite 新写入和本地日志读取路径退役，任务事实与 OTel 运行诊断保持现有所有权。

**Tech Stack:** TypeScript、Electron、OpenTelemetry、Phoenix、Alloy、SQLite、Vitest、Playwright、OpenSpec。

**Spec:** `docs/superpowers/specs/2026-09-24-replace-langsmith-with-local-phoenix-design.md`；OpenSpec `openspec/changes/replace-langsmith-with-local-phoenix-and-prune-unused-code/`。

## Global Constraints

- Phoenix 是新模型调用原文的唯一观测来源；Tempo/Loki 不得保存输入、输出或鉴权凭据。
- 观测失败不改变任务执行结果；不为缺失追踪提供 Mock 或旧 SQLite 回退。
- 不删除现有 `model_calls` 表、索引或历史行；不删除旧模型连接 JSON 迁移。
- 不新增应用内 Phoenix/日志入口；历史 OpenSpec 归档只保留原决策，不改写为当前方案。
- 所有命令用 `corepack pnpm`；任务完成前运行定向验证，最终运行全量和打包冒烟。

## File Map

| 路径                                                                                       | 职责                                                       |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `apps/agent-runtime/src/model-trace-port.ts`                                               | Runtime 内部模型追踪起止数据与端口                         |
| `apps/agent-runtime/src/phoenix-model-observability.ts`                                    | OpenInference 模型 span、凭据过滤、终态                    |
| `apps/agent-runtime/src/model-connections/model-gateway.ts`                                | 调用追踪端口并处理模型结果，不写旧 `model_calls`           |
| `apps/agent-runtime/src/runtime-process.ts`                                                | 从 OTel tracer 装配 Phoenix 适配器                         |
| `apps/agent-runtime/src/database.ts`                                                       | 保留历史 schema；用测试证明数据不丢                        |
| `apps/agent-runtime/src/repositories.ts`、`ports.ts`、`local-runtime-server.ts`            | 退役未读取的模型调用仓储和接口                             |
| `apps/agent-runtime/src/model-log-projection.ts`                                           | 保留任务投影，移出旧模型日志投影并改名为任务投影           |
| `apps/desktop/src/main/`、`src/renderer/src/`、`src/shared/`                               | 删除无生产入口的 LangSmith 与旧日志界面/IPC                |
| `packages/contracts/src/index.ts`、`packages/observability/src/`                           | 删除旧模型日志 DTO 和本地日志存储/读取边界，保留 OTel 摘要 |
| `apps/agent-runtime/package.json`、`packages/observability/package.json`、`pnpm-lock.yaml` | 删除 LangSmith 及确认不再需要的直接依赖                    |
| `docs/unused-code-audit-2026-09-24.md`                                                     | 候选、真实入口、删除或保留理由与验收证据                   |
| `docs/self-hosted-observability.md`、`openspec/specs/self-hosted-observability/spec.md`    | 当前运维和能力事实                                         |

## Review Focus

- **流式调用中途失败：** Phoenix span 必须以错误终态结束，已经交付给用户的部分内容不因追踪失败消失；任务 1 和 2 的测试覆盖。
- **追踪适配器抛异常：** 模型调用仍按上游结果成功或失败；任务 1 的测试覆盖。
- **凭据嵌在嵌套对象或数组：** Phoenix/Tempo/Loki 均不能保存凭据；任务 1 和 5 的测试覆盖。
- **旧库升级：** 历史 `model_calls` 行不删除，新任务不再写入；任务 3 的测试覆盖。
- **打包后动态入口：** 静态零引用候选不得导致 Runtime/Renderer 启动缺模块；任务 4 和 6 的打包冒烟覆盖。

---

### Task 1: 独立追踪端口与 Phoenix 适配器

**Files:**

- Create: `apps/agent-runtime/src/model-trace-port.ts`
- Modify: `apps/agent-runtime/src/phoenix-model-observability.ts`
- Modify: `apps/agent-runtime/src/model-connections/model-gateway.ts`
- Test: `apps/agent-runtime/tests/phoenix-model-observability.test.ts`
- Test: `apps/agent-runtime/tests/model-gateway.test.ts`

**Interfaces:**

- Produces: `ModelTracePort.start(run: ModelTraceStart): Promise<void>` 与 `finish(id: string, result: ModelTraceFinish): Promise<void>`；类型与现有结构相同，但位于独立文件。
- Consumes: `Tracer` 和网关现有 `ModelRequest`、终态结果；不引用 `langsmith-observability.ts`。

- [ ] **Step 1: 写失败测试。** 在 Phoenix 测试中从新模块导入 `ModelTracePort` 并声明 `const port: ModelTracePort = observation`，再加入嵌套凭据和错误终态；在网关测试中加入追踪 `start`、`finish` 抛异常但上游成功的场景。关键断言：

  ```ts
  expect(JSON.stringify(attributes)).toContain('MODEL_INPUT_MARKER')
  expect(JSON.stringify(attributes)).not.toMatch(/secret|Bearer/)
  expect(end).toHaveBeenCalledOnce()
  await expect(gateway.complete(realRequest)).resolves.toEqual({ kind: 'finish', content: 'done' })
  ```

- [ ] **Step 2: 跑红。** `corepack pnpm --filter @actiondriver/agent-runtime typecheck`，确认新模块尚不存在导致类型检查失败；再运行 `corepack pnpm exec vitest run apps/agent-runtime/tests/phoenix-model-observability.test.ts apps/agent-runtime/tests/model-gateway.test.ts` 检查新增行为断言。
- [ ] **Step 3: 实现最小修改。** 将 `ModelTraceStart`、`ModelTraceFinish` 从 LangSmith 文件移入 `model-trace-port.ts`，定义端口；Phoenix 和网关从新文件导入。保留网关的观测异常隔离，Phoenix 对嵌套对象/数组过滤凭据并在每个终态结束 span。

  ```ts
  export interface ModelTracePort {
    start(run: ModelTraceStart): Promise<void>
    finish(id: string, result: ModelTraceFinish): Promise<void>
  }
  ```

- [ ] **Step 4: 跑绿并提交。** 重跑上述 Vitest 与 `corepack pnpm --filter @actiondriver/agent-runtime typecheck`；审查 `git diff --check`，提交 `refactor: decouple model tracing from LangSmith`。

### Task 2: Runtime 装配 Phoenix 与真实链路

**Files:**

- Modify: `apps/agent-runtime/src/runtime-process.ts`
- Modify: `apps/agent-runtime/tests/runtime-process.test.ts`
- Modify: `apps/agent-runtime/tests/phoenix-model-observability.test.ts`
- Inspect: `deploy/observability/alloy.alloy`

**Interfaces:**

- Consumes: Task 1 的 `PhoenixModelObservability` 实现和 `createServiceLogger().tracer`。
- Produces: 生产 Runtime 的 `ConnectionModelGateway` 接收 Phoenix 追踪端口。

- [ ] **Step 1: 写失败测试。** 在 Runtime 装配测试中让真实模型网关执行一条受控调用，捕获 tracer 的模型 span；断言 `session.id`、`task.id`、`request.id` 与同一 `traceId` 的父链。额外让 span 写入抛错，断言任务结果仍由上游决定。
- [ ] **Step 2: 跑红。** `corepack pnpm exec vitest run apps/agent-runtime/tests/runtime-process.test.ts apps/agent-runtime/tests/phoenix-model-observability.test.ts`，确认当前生产装配仍指向 LangSmith，因此新断言失败。
- [ ] **Step 3: 接线。** 将 Runtime 装配替换为 `new PhoenixModelObservability(logging.tracer)`；保留 `createServiceLogger` 的生命周期关闭与 Alloy 现有 Phoenix/Tempo 分支。不新增第二个 tracer provider。

  ```ts
  const modelTraces = new PhoenixModelObservability(logging.tracer)
  const modelGateway = new ConnectionModelGateway({
    service,
    modelCalls: repositories.modelCalls,
    interactions,
    traces: modelTraces,
    callId: () => `model-call:${randomUUID()}`,
    correlationId: randomUUID,
    now: () => new Date().toISOString()
  })
  ```

- [ ] **Step 4: 跑绿并提交。** 重跑定向测试、`corepack pnpm --filter @actiondriver/agent-runtime build`，提交 `feat: send model spans to local Phoenix`。

### Task 3: 退役 LangSmith 和 SQLite 新模型日志写入

**Files:**

- Delete: `apps/agent-runtime/src/langsmith-observability.ts`、`apps/agent-runtime/tests/langsmith-observability.test.ts`
- Modify: `apps/agent-runtime/src/model-connections/model-gateway.ts`、`runtime-process.ts`、`ports.ts`、`repositories.ts`、`local-runtime-server.ts`、`index.ts`
- Modify: `apps/agent-runtime/src/model-log-projection.ts`（改为仅含任务投影，并将文件/引用命名为 `task-projection.ts`）
- Modify: `apps/agent-runtime/package.json`、`pnpm-lock.yaml`
- Test: `apps/agent-runtime/tests/model-gateway.test.ts`、`database.test.ts`、`model-log-projection.test.ts`

**Interfaces:**

- Consumes: Task 2 的 Phoenix 追踪路径。
- Produces: 新调用不写 `model_calls`；旧库仍保留表、索引及历史行，任务投影继续工作。

- [ ] **Step 1: 写失败测试。** 在旧库夹具插入一条 `model_calls` 历史行，重启并执行新任务后断言旧行原样存在且行数不增加。把现有模型网关的旧仓储断言改为 Phoenix 追踪与任务结果断言。

  ```ts
  expect(database.prepare('SELECT COUNT(*) AS count FROM model_calls').get()).toEqual({ count: 1 })
  expect(await repositories.tasks.get(taskId)).toMatchObject({ status: 'completed' })
  ```

- [ ] **Step 2: 跑红。** `corepack pnpm exec vitest run apps/agent-runtime/tests/model-gateway.test.ts apps/agent-runtime/tests/database.test.ts apps/agent-runtime/tests/model-log-projection.test.ts`，确认新任务写入旧表导致断言失败。
- [ ] **Step 3: 删旧路径。** 移除网关的 `modelCalls` 参数和 `save` 调用、仓储 `modelCalls` 属性、`ModelCallRepository`/`PersistedModelCall`、未用模型日志投影；保留数据库 v3 迁移的建表语句与历史行。删除 LangSmith 源码、单测、Runtime 导出和直接依赖，使用 `corepack pnpm install --lockfile-only` 更新锁文件。
- [ ] **Step 4: 跑绿并提交。** 运行上述定向测试、Runtime 类型检查与构建、`rg -n 'langsmith|LANGSMITH_' apps packages package.json pnpm-lock.yaml`（预期无生产匹配）；提交 `refactor: retire LangSmith and model call projection`。

### Task 4: 删除遗留模型/接口日志代码并审计其他候选

**Files:**

- Delete candidates: `apps/desktop/src/main/langsmith-detail-view.ts`、`logs-ipc.ts`、`apps/desktop/src/shared/log-ipc-contract.ts`、`apps/desktop/src/renderer/src/services/desktop-model-logs.ts`、`desktop-interaction-logs.ts` 及专属模型/日志模型文件和对应测试
- Delete candidates: `packages/observability/src/logger.ts`、`logs.ts`、`local-interaction-store.ts`、旧 `interactions.ts` 及仅为它们存在的测试和直接依赖
- Modify: `packages/observability/src/index.ts`、`interaction-store.ts`、`packages/contracts/src/index.ts`、相关 `package.json` 与 `pnpm-lock.yaml`
- Create: `docs/unused-code-audit-2026-09-24.md`

**Interfaces:**

- Consumes: 当前生产入口、测试/设计验收入口和 OpenSpec 决策；保留 `createInteractionLogRecorder` 的运行摘要与 OTel 导出接口。
- Produces: 可追踪的删除清单，以及每个保留候选的明确使用理由。

- [ ] **Step 1: 记录候选。** 从 Runtime、Electron Main/Preload/Renderer、脚本和包入口构建引用图；对每个零生产引用文件用 `rg` 复核动态引用、测试和设计审计用途。把候选、证据、结论写入审计文档；把旧模型连接迁移与有效视觉夹具列为保留项。
- [ ] **Step 2: 固定行为测试。** 在现有 `apps/desktop/src/main/interaction-logging.test.ts`、`apps/agent-runtime/tests/service-logging.test.ts` 和 `packages/observability/tests/otel-logger.test.ts` 中断言 Main/Runtime 仍产生无正文摘要、不会新增本机日志文件；先运行定向测试确认用户可见的记录边界被覆盖。旧日志 IPC 与模型详情入口缺席用生产入口审计和构建验证，不写镜像源码的测试。
- [ ] **Step 3: 分组删除。** 先删无生产入口的 Desktop 模型/接口日志路径及 DTO，再删旧本机日志读取/存储和测试；对 `interaction-store.ts` 中仅供旧存储使用的分支删除并让生产摘要接口保持稳定。确认 Pino 仅剩测试或类型引用后删除相关代码及依赖；保留真正参与运行/构建的模块。
- [ ] **Step 4: 验证并提交。** 运行 `corepack pnpm typecheck`、`corepack pnpm lint`、上述日志测试、`corepack pnpm --filter @actiondriver/desktop build`；检查包依赖和 `git diff --check`，提交 `refactor: remove unused log and UI paths`。

### Task 5: 当前规范、运维文档和本地平台验收

**Files:**

- Modify: `docs/self-hosted-observability.md`、`openspec/specs/self-hosted-observability/spec.md`
- Modify or archive: `openspec/changes/use-langsmith-model-logs/`（保留其历史事实并注明被本变更取代）
- Test: `packages/observability/tests/otel-live.test.ts`、`packages/observability/tests/grafana-provisioning.test.ts`；本地 Docker 环境验收

**Interfaces:**

- Consumes: Task 2 的生产 Phoenix span 与当前 Alloy 的双分支。
- Produces: 主规范和文档只描述 Phoenix 为新模型调用原文来源。

- [ ] **Step 1: 写集成验收。** 用唯一标记输入/输出和嵌套凭据运行本地假上游模型，查询 Phoenix、Tempo 和 Loki；断言 Phoenix 包含标记、Tempo/Loki 不包含标记，三者均无凭据，Phoenix span 与父调用共享 trace ID。
- [ ] **Step 2: 故障验收。** 临时停止 Alloy 或 Phoenix 并执行同样任务，确认模型响应正常；恢复服务后健康检查通过，不声明停机期间追踪可补录。
- [ ] **Step 3: 更新文档与变更状态。** 将主规范按 delta 同步，删除当前文档中的 LangSmith 配置/入口；把 `use-langsmith-model-logs` 标记为被取代并依仓库 OpenSpec 归档约束处理。保留历史设计及远端历史数据，说明旧 SQLite 原文与卷的保留边界。
- [ ] **Step 4: 验证并提交。** `corepack pnpm exec openspec validate --specs`、`corepack pnpm exec openspec validate replace-langsmith-with-local-phoenix-and-prune-unused-code --strict`；对当前代码和文档运行 `rg -n 'LangSmith|LANGSMITH_' apps packages docs/self-hosted-observability.md openspec/specs`（预期无当前路径匹配），提交 `docs: make Phoenix the model trace source`。

### Task 6: 全量验证与 OpenSpec 收尾

**Files:**

- Modify: `openspec/changes/replace-langsmith-with-local-phoenix-and-prune-unused-code/tasks.md`（逐项勾选）、归档目录
- Inspect: 所有已改产品代码和依赖锁文件

**Interfaces:**

- Consumes: Task 1–5 的全部实现和验收证据。
- Produces: 可复现的通过记录与已归档 OpenSpec 变更。

- [ ] **Step 1: 运行全量检查。** `corepack pnpm check:all`；记录单元测试、类型、Lint、构建及视觉/本地 E2E 结果。若失败，按系统化调试处理，不把失败当作无关项跳过。
- [ ] **Step 2: 验证打包与恢复。** `corepack pnpm test:e2e:packaged:macos`，并运行 Runtime 所有权、重启与旧库定向测试，确认打包 Runtime 能启动且历史数据未被破坏。
- [ ] **Step 3: 检查差异与范围。** `git diff --check`、依赖闭包审计、当前规范与生产引用搜索；确认 Phoenix 唯一模型原文出口、无 LangSmith SDK、无旧模型日志 UI 与新 SQLite 模型调用写入。
- [ ] **Step 4: 归档并提交。** OpenSpec 严格验证后同步 delta、归档新变更；仅在全部验收完成时勾选清单并提交最终收尾改动。若真实本地 Docker 环境不可用，保留未验收任务并明确报告，不声称完成。
