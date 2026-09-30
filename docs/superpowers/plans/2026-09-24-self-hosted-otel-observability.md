# 自托管 OpenTelemetry 观测平台 Implementation Plan

> 历史实施计划。下文 Phoenix 模型追踪路径已由 `docs/superpowers/specs/2026-09-24-architecture-convergence-design.md` 覆盖：当前模型层日志使用 LangSmith，OpenTelemetry 负责运行诊断。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Action-Driver 的运行与 HTTP/IPC/WebSocket 调用日志只送入本地 Docker 统一平台，在 Grafana 关联链路和指标，在 Phoenix 查看完整模型内容，并取消本机日志存储与应用内日志列表。

**Architecture:** Electron Main 与 Agent Runtime 使用 `packages/observability` 的 OTel Logs SDK、tracer 和 meter 向本机 Alloy 发送 OTLP。Alloy 将日志送 Loki、指标送 Prometheus、完整模型 trace 送 Phoenix，并把允许字段的 trace 送 Tempo；Grafana 统一查询运行信息。Action-Driver 设置页只提供经 Main 校验的本地平台入口。

**Tech Stack:** Node.js ≥20.14.0、pnpm 12.4.1、TypeScript、Electron、React、OpenTelemetry JavaScript、Docker Compose、Grafana、Alloy、Loki、Tempo、Prometheus、Phoenix、Vitest、Playwright。

**Spec:** `openspec/changes/self-hosted-otel-observability/design.md`；`openspec/changes/self-hosted-otel-observability/specs/self-hosted-observability/spec.md`；`openspec/changes/self-hosted-otel-observability/specs/layered-log-viewer/spec.md`。

## Global Constraints

- 本地 Docker 承载全部观测服务；Electron 和 Runtime 留在宿主机。
- 应用运行和 HTTP/IPC/WebSocket 日志只通过 OpenTelemetry Logs SDK 进入 Loki；不再写本机日志文件、交互日志存储或提供 `GET /logs`。
- 接口摘要只含传输、方向、操作、结果、耗时、错误和关联标识；不含任意请求/响应正文。
- 完整 LLM 提示词、输入、输出与错误详情只进 Phoenix；Tempo/Loki 不含这些原文。
- Alloy 不可用或 SDK 队列满时业务继续，未接收日志允许丢失；不制作离线副本。
- 历史文件与任务业务状态不删除；工作树中未提交的 LangSmith 修改逐项核对，不覆盖无关改动。
- 宿主机观测端口只绑定 loopback；Renderer 不得提供任意跳转 URL。

## Review Focus

1. WebSocket 单向事件没有 completion 回调：应仍产生一次摘要，测试放在任务 2。
2. 大量流式 chunk：应聚合而非每块一条日志，测试放在任务 2。
3. 含标记原文的 HTTP/IPC/WS 载荷：Loki/Tempo 不出现，Phoenix 仅保存模型原文，测试放在任务 3。
4. Alloy 停机或 SDK 队列耗尽：任务可继续且不创建本机文件，测试放在任务 2 和任务 5。
5. Renderer 恶意传入非本机 URL：Main 拒绝且不打开，测试放在任务 4。

---

## File map

- `deploy/observability/compose.yaml`、`deploy/observability/alloy.alloy`、`deploy/observability/loki.yaml`、`deploy/observability/tempo.yaml`、`deploy/observability/prometheus.yaml`、`deploy/observability/grafana/provisioning/datasources/datasources.yaml`: 各服务启动、路由、数据源与持久化；与根质量检查 `compose.yaml` 独立。
- `packages/observability/src/logger.ts`、`packages/observability/src/otel.ts`、`packages/observability/src/interaction-store.ts`、`packages/observability/src/index.ts`: 进程日志接口、SDK 生命周期、调用摘要和对外导出。保留历史存储代码只供旧数据/测试读取，生产路径不再引用。
- `apps/desktop/src/main/logging.ts`、`apps/desktop/src/main/agent-ipc.ts`、`apps/desktop/src/main/index.ts`、`apps/agent-runtime/src/runtime-process.ts`、`apps/agent-runtime/src/service/http-service.ts`、`apps/agent-runtime/src/service/websocket-interaction-recorder.ts`: Main/Runtime 接线与跨边界观测。
- `apps/desktop/src/main/logs-ipc.ts`、`apps/desktop/src/preload/desktop-api.ts`、`apps/desktop/src/shared/agent-ipc-contract.ts`、`apps/desktop/src/renderer/src/pages/LogsPage.tsx`、`apps/desktop/src/renderer/src/components/logs/InterfaceLogsView.tsx`、`apps/desktop/src/renderer/src/components/logs/ModelLogsView.tsx`: 删除失效的读取契约/视图，建立安全导航；具体删除范围先按全局引用核对。
- `docs/self-hosted-observability.md`: 启动、访问边界、保留期、故障和真实验收。

### Task 1: Docker 观测栈与数据路由

**Files:**
- Create: `deploy/observability/compose.yaml`, `deploy/observability/alloy.alloy`, `deploy/observability/loki.yaml`, `deploy/observability/tempo.yaml`, `deploy/observability/prometheus.yaml`, `deploy/observability/grafana/provisioning/datasources/datasources.yaml`
- Create: `docs/self-hosted-observability.md`
- Test: `deploy/observability/compose.yaml` 的配置和容器健康命令

**Interfaces:**
- Consumes: OTLP gRPC/HTTP logs、traces、metrics。
- Produces: 本机 loopback OTLP 接收端，以及 Grafana、Phoenix 的受信任本机 URL；具体端口一经配置须同步到任务 4 的 Main 常量。

- [ ] **Step 1: 写出失败的配置验收。** 先执行：

```bash
docker compose -f deploy/observability/compose.yaml config --quiet
```

预期：文件尚不存在或 Compose 配置失败。记录本机 Docker 可用性；若 Docker 本身不可用，先完成静态配置，不声称真实验收通过。

- [ ] **Step 2: 创建独立 Compose 和逐服务配置。** 使用固定镜像版本、命名卷、loopback 端口、healthcheck；Alloy 需有 `otelcol.receiver.otlp`，logs → Loki、metrics → Prometheus 可查询路径、trace → Phoenix 与 Tempo 两支。Tempo 分支应先做属性允许字段处理。Grafana 数据源至少含 Loki、Tempo、Prometheus，Tempo 配置 trace-to-logs。

```yaml
services:
  grafana:
    ports:
      - "127.0.0.1:3000:3000"
    volumes:
      - grafana-data:/var/lib/grafana
```

其余服务遵守同样端口和持久卷原则；不要把 Phoenix 的完整模型 span 直接无筛选复制给 Tempo。

- [ ] **Step 3: 运行配置和健康检查。**

```bash
docker compose -f deploy/observability/compose.yaml config --quiet
docker compose -f deploy/observability/compose.yaml up -d
docker compose -f deploy/observability/compose.yaml ps
```

预期：所有服务健康、宿主端口仅显示 `127.0.0.1`、Grafana 三个数据源可查询。重启服务后验证已确认接收的测试信号仍可检索；写入 `docs/self-hosted-observability.md` 的实际命令与保留期。

- [ ] **Step 4: 独立提交该可运行栈。** 只暂存本任务新文件，提交消息 `feat: add local observability stack`。

### Task 2: Logs SDK 与无正文接口摘要

**Files:**
- Modify: `packages/observability/package.json`, `packages/observability/src/logger.ts`, `packages/observability/src/interaction-store.ts`, `packages/observability/src/index.ts`, `pnpm-lock.yaml`
- Create: `packages/observability/src/otel.ts`, `packages/observability/tests/otel-logger.test.ts`
- Modify/Test: `packages/observability/src/interaction-store.test.ts`, `apps/agent-runtime/tests/websocket-interaction-recorder.test.ts`

**Interfaces:**
- Consumes: Alloy OTLP 地址、当前 `InteractionTransport`/`InteractionDirection`、活动 span context。
- Produces: `createProcessObservability({ serviceName, endpoint })` 返回 `{ logger, tracer, meter, close }`；`logger.info(attributes, message)`、`warn`、`error`；`createInteractionLogRecorder({ logger, ids, clock })` 的摘要版，不再接受 `store`。

- [ ] **Step 1: 先写失败测试，钉住摘要 schema 与无副本。**

```ts
const finish = await recorder.start({
  transport: 'ipc',
  direction: 'renderer->service',
  operation: 'task:run',
  taskId: 'task-1',
  request: { kind: 'json', value: { secretMarker: 'BODY_NEVER_IN_LOKI' } }
})
await finish({ outcome: 'ok', response: { kind: 'text', text: 'RESPONSE_NEVER_IN_LOKI' } })
expect(emitted[0]).toMatchObject({
  transport: 'ipc', operation: 'task:run', outcome: 'ok', taskId: 'task-1'
})
expect(JSON.stringify(emitted)).not.toMatch(/BODY_NEVER_IN_LOKI|RESPONSE_NEVER_IN_LOKI/)
```

同文件再写 `recordOneWay` 恰好一条摘要、失败有错误码、chunk 聚合的断言；`createProcessObservability` 故障测试要以拒绝发送的假 exporter 验证业务回调照常完成且没有文件创建。

- [ ] **Step 2: 运行红灯。**

```bash
corepack pnpm exec vitest run packages/observability/tests/otel-logger.test.ts packages/observability/src/interaction-store.test.ts apps/agent-runtime/tests/websocket-interaction-recorder.test.ts
```

预期：新 API/无正文断言失败，而非测试未被发现。

- [ ] **Step 3: 实现最小日志适配与 recorder。** OTel 日志事件只映射白名单属性；LoggerProvider/BatchLogRecordProcessor/OTLP exporter 的导入与版本按锁定依赖确定；`close()` 有界 flush。维持调用方所需的 `info/warn/error` 形式，删除生产 logger 的 `filePath` 与 `logFilePath`。调用摘要通过显式对象构造，不传播 `request`、`response`、`payload`、`secretValues`。

```ts
type CallSummary = {
  transport: 'http' | 'ipc' | 'websocket'
  direction: string
  operation: string
  outcome: string
  durationMs?: number
  taskId?: string
  requestId?: string
  correlationId: string
  errorCode?: string
}
```

- [ ] **Step 4: 运行绿灯和类型检查。**

```bash
corepack pnpm exec vitest run packages/observability/tests/otel-logger.test.ts packages/observability/src/interaction-store.test.ts apps/agent-runtime/tests/websocket-interaction-recorder.test.ts
corepack pnpm typecheck
```

预期：通过；如现有测试依赖本机 store，先迁移测试期望并保留有意义的历史存储单测。

- [ ] **Step 5: 提交。** 只暂存本任务文件，提交 `feat: emit structured OTel call logs`。

### Task 3: Main/Runtime 接线、trace、metrics 与 Phoenix 边界

**Files:**
- Modify: `apps/desktop/src/main/logging.ts`, `apps/desktop/src/main/agent-ipc.ts`, `apps/desktop/src/main/index.ts`, `apps/agent-runtime/src/runtime-process.ts`, `apps/agent-runtime/src/service/http-service.ts`, `apps/agent-runtime/src/service/websocket-interaction-recorder.ts`, `apps/agent-runtime/src/model-connections/model-gateway.ts`
- Test: `apps/desktop/src/main/interaction-logging.test.ts`, `apps/desktop/src/main/agent-ipc.test.ts`, `apps/agent-runtime/tests/service-logging.test.ts`, `apps/agent-runtime/tests/service-logs.test.ts`, `apps/agent-runtime/tests/model-gateway.test.ts`

**Interfaces:**
- Consumes: 任务 2 的 `createProcessObservability` 与摘要 recorder；现有 IPC/WS 类型化消息。
- Produces: HTTP/IPC/WS 跨进程 trace context、任务/工具/模型 span、请求量/错误/耗时指标、Phoenix 完整模型 span；不再注册 `GET /logs` 或生产存储写入。

- [ ] **Step 1: 先写失败的跨边界与删除契约测试。**

```ts
expect(childSpan.spanContext().traceId).toBe(parentSpan.spanContext().traceId)
expect(childSpan.parentSpanId).toBe(parentSpan.spanContext().spanId)
expect(JSON.stringify(lokiRecords)).not.toContain('MODEL_INPUT_MARKER')
expect(JSON.stringify(tempoSpans)).not.toContain('MODEL_OUTPUT_MARKER')
expect(JSON.stringify(phoenixSpans)).toContain('MODEL_OUTPUT_MARKER')
```

HTTP 服务测试再断言 `GET /logs` 返回 404；Main/Runtime 用临时 userData 目录启动后断言没有新的 `logs/*.log` 或 `logs/interactions` 写入；已有业务数据库文件不能误判为日志。WebSocket 单向事件和高频 chunk 分别断言一条摘要和不随 chunk 数线性增长。

- [ ] **Step 2: 运行红灯。**

```bash
corepack pnpm exec vitest run apps/desktop/src/main/interaction-logging.test.ts apps/desktop/src/main/agent-ipc.test.ts apps/agent-runtime/tests/service-logging.test.ts apps/agent-runtime/tests/service-logs.test.ts apps/agent-runtime/tests/model-gateway.test.ts
```

预期：至少由新契约断言失败。

- [ ] **Step 3: 接线并逐边界消除本机日志写入。** Main/Runtime 分别初始化并有界关闭 OTel provider；HTTP 从 `traceparent` 提取，IPC/WS 在类型化信封注入/提取，不把 trace ID 当 Loki label。仅关键操作建 span；模型原文只附于送 Phoenix 的模型 span，Tempo 分支过滤器必须在导出前应用。删除 Runtime `GET /logs`，并移除 `logFilePath` 生产传递。

```ts
const summary = {
  transport: 'websocket' as const,
  direction: 'service->renderer',
  operation: message.type,
  outcome: 'sent',
  ...(message.taskId ? { taskId: message.taskId } : {})
}
logger.info(summary, 'websocket event')
```

该片段只示意白名单结构；实现要由公共 recorder 统一发出，不在各边界复制第二套 schema。

- [ ] **Step 4: 跑绿灯、类型与真实三目的地内容检查。**

```bash
corepack pnpm exec vitest run apps/desktop/src/main/interaction-logging.test.ts apps/desktop/src/main/agent-ipc.test.ts apps/agent-runtime/tests/service-logging.test.ts apps/agent-runtime/tests/service-logs.test.ts apps/agent-runtime/tests/model-gateway.test.ts
corepack pnpm typecheck
```

预期：通过；另起 Docker 栈发送含唯一标记的真实模型调用，用 Phoenix/Loki/Tempo API 查询并保存检索结果到验收记录。不可把仅检查本地 mock 称为真实验收。

- [ ] **Step 5: 提交。** 只暂存本任务文件，提交 `feat: correlate runtime traces and metrics`。

### Task 4: 只保留平台导航的日志工作区

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/LogsPage.tsx`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/desktop-api.ts`, `apps/desktop/src/shared/agent-ipc-contract.ts`
- Review/remove if unreferenced: `apps/desktop/src/main/logs-ipc.ts`, `apps/desktop/src/renderer/src/components/logs/InterfaceLogsView.tsx`, `apps/desktop/src/renderer/src/components/logs/ModelLogsView.tsx`, `apps/desktop/src/renderer/src/services/desktop-interaction-logs.ts`, `apps/desktop/src/renderer/src/services/desktop-model-logs.ts`
- Test: `apps/desktop/src/renderer/src/pages/LogsPage.test.tsx`, `apps/desktop/src/preload/desktop-api.test.ts`, `apps/desktop/src/main/interaction-logging.test.ts`

**Interfaces:**
- Consumes: 任务 1 固定的 loopback 平台地址；现有 SettingsSidebar。
- Produces: Renderer 只可调用 `openObservabilityPlatform('grafana' | 'phoenix')`；Main 从固定映射构造 URL、验证并打开，不接受 Renderer URL。

- [ ] **Step 1: 写失败的导航和拒绝测试。**

```tsx
expect(screen.getByRole('button', { name: /Grafana/ })).toBeVisible()
expect(screen.getByRole('button', { name: /Phoenix/ })).toBeVisible()
expect(screen.queryByTestId('e2e/settings/logs/entries/0#button')).not.toBeInTheDocument()
expect(screen.queryByTestId('e2e/settings/logs/inspector#section')).not.toBeInTheDocument()
```

Main 测试验证 `https://evil.example`、非 loopback host、非 http(s) scheme 均不能从 Renderer 输入触达 shell/browser；平台不可用时页面显示启动指引。

- [ ] **Step 2: 运行红灯。**

```bash
corepack pnpm exec vitest run apps/desktop/src/renderer/src/pages/LogsPage.test.tsx apps/desktop/src/preload/desktop-api.test.ts
```

预期：缺少入口或安全契约导致失败。

- [ ] **Step 3: 实现仅导航的页面并清理旧查询链。** Main 固定 `grafana`/`phoenix` 到本机地址，Renderer 只传平台枚举；保留设置侧栏。逐一检查当前未提交的 LangSmith、接口列表、模型详情 RPC 引用，移除仅服务旧日志 UI 的生产路径和测试，保留任务业务状态与无关用户改动。更新 E2E interaction contract，避免旧 test ID 僵尸引用。

```ts
type ObservabilityPlatform = 'grafana' | 'phoenix'
const platformUrls: Record<ObservabilityPlatform, URL> = {
  grafana: new URL('http://127.0.0.1:3000'),
  phoenix: new URL('http://127.0.0.1:6006')
}
```

若任务 1 实际端口不同，使用其已固定值；不可由 Renderer 传 URL 覆盖。

- [ ] **Step 4: 绿灯与引用检查。**

```bash
corepack pnpm exec vitest run apps/desktop/src/renderer/src/pages/LogsPage.test.tsx apps/desktop/src/preload/desktop-api.test.ts
corepack pnpm validate:e2e-interactions
corepack pnpm typecheck
rg -n 'LocalInteractionLogStore|action-driver:logs:list|LANGSMITH_API_KEY' apps packages
```

预期：测试通过；`rg` 命中只属于历史工具/测试或已解释的非生产路径，不能凭搜索结果直接删除用户文件。

- [ ] **Step 5: 提交。** 只暂存本任务文件，提交 `feat: replace log viewer with local platform links`。

### Task 5: 故障、重启与真实环境端到端验收

**Files:**
- Modify: `docs/self-hosted-observability.md`
- Test: `apps/desktop/e2e/app.spec.ts`、`apps/desktop/e2e/local-runtime.spec.ts`、相关 Runtime 集成测试
- Review: `openspec/changes/use-langsmith-model-logs/` 的迁移状态；只按 OpenSpec 流程处置，不擅自归档。

**Interfaces:**
- Consumes: 任务 1–4 的全部服务与代码。
- Produces: 可复现验收记录和回归测试；不产生额外日志存储。

- [ ] **Step 1: 写/更新 E2E 断言。**

```ts
await expect(page.getByRole('button', { name: /Grafana/ })).toBeVisible()
await expect(page.getByRole('button', { name: /Phoenix/ })).toBeVisible()
await expect(page.getByTestId('e2e/settings/logs/inspector#section')).toHaveCount(0)
```

补充运行时故障测试：Alloy 停止时任务仍返回；调用前后本机日志目录无新文件；恢复后新调用可在 Loki 查询，停机期间缺失不视为违反规格。

- [ ] **Step 2: 运行完整静态和自动化验证。**

```bash
corepack pnpm check
corepack pnpm test:e2e:local
openspec validate self-hosted-otel-observability --strict
git diff --check
```

预期：全部通过；若原有脏工作树造成失败，分清基线与本变更，不通过虚构“已验收”跳过。

- [ ] **Step 3: 完成真人可复现的 Docker 环境验收。** 记录 Docker 镜像 digest、容器健康、Grafana 三数据源查询、一次真实 HTTP/IPC/WS/模型链路的共同 trace ID、Phoenix 原文、Tempo/Loki 无原文、重启持久化、停机业务连续性。文档附实际命令与输出摘要，不记录模型密钥或任意鉴权头。

- [ ] **Step 4: 提交验收证据。** 只暂存文档与测试，提交 `test: verify self-hosted observability end to end`；最后按项目 OpenSpec 流程申请审查并在实施完成后归档。
