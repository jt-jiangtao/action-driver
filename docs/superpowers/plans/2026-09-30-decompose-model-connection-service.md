# 模型连接服务职责拆分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持模型连接公共行为不变的前提下，分离能力探测、模型规则和服务编排，并按业务流程组织测试。

**Architecture:** `ModelConnectionService` 继续持有连接存储、凭据使用、草稿验证证据及异步状态复查。内部模块分别处理无状态模型规则、能力探测和错误归一化；模块不反向依赖服务。测试仍归 local-runtime 包。

**Tech Stack:** TypeScript 5.9、Vitest 3、pnpm 12、现有 `@action-driver/model-connections` 与 `@action-driver/model-provider-runtime`。

**Spec:** `docs/superpowers/specs/2026-09-30-model-connection-service-decomposition-design.md`；OpenSpec 归档于 `openspec/changes/archive/2026-09-30-decompose-model-connection-service/{proposal,design,tasks}.md`。

## Global Constraints

- 不改变公共端口、DTO、存储格式、进程边界、凭据密钥来源、错误码、测试请求顺序或最多四模型并发。
- `service.ts` 仍是状态与副作用的编排点，异步操作后必须重新核对相关连接、模型和默认生图引用。
- 不编辑持久规格或密钥保护代码；已发现的规格与实现冲突由独立变更处理。
- 迭代期仅运行相关 `pnpm vitest run <文件>` 与必要的包级 typecheck；准备提交时才一次性运行根 `pnpm typecheck`、`pnpm lint`、`pnpm test`。
- 提交只包含本变更文件；工作区有其他会话的改动时不得一并暂存。

## Review Focus

- 同一模型 ID 位于不同连接时，聊天仍使用所选连接；现有聊天与流式用例随测试拆分保留。生图连接选择通过未改动的服务代码核对。
- 能力探测未完成时连接或启用状态变化，旧结果不得覆盖新状态；现有竞态用例随测试拆分保留。
- 生图调用期间默认模型被停用时，旧图片不得被接受；现有用例随测试拆分保留。连接配置与接口证据的复查通过未改动的服务代码核对。
- Token Plan 两接口都应真实探测，保持结果、优先级与失败诊断；现有用例随测试拆分保留。
- 连接投影、错误和测试断言不泄漏 API Key；现有脱敏用例随测试拆分保留。

---

### Task 1: 测试基线与分组

**Files:**
- Modify: `apps/local-runtime/tests/unit/model-connection-service.test.ts`
- Create: `apps/local-runtime/tests/unit/model-connection-fixtures.ts`
- Create: `apps/local-runtime/tests/unit/model-connection-management.test.ts`
- Create: `apps/local-runtime/tests/unit/model-capability-testing.test.ts`
- Create: `apps/local-runtime/tests/unit/model-image-generation.test.ts`
- Create: `apps/local-runtime/tests/unit/model-chat-completion.test.ts`

**Interfaces:** 测试工具提供 `memoryStore(): ModelConnectionStore` 与 `createService(handler, openAiClientFactory?, imageResolver?)`，并暴露当前测试所需的 `draft` 与图片固件；测试文件自身管理 `vi.stubGlobal('fetch', ...)` 的清理。

- [x] **Step 1: 记录现状。** 原文件含 35 个显式 `it` 标题、参数化展开后 41 个用例；`pnpm vitest run apps/local-runtime/tests/unit/model-connection-service.test.ts` 为 41/41 通过，并已记录服务公共导出和依赖清单。
- [x] **Step 2: 按行为移动现有测试。** 连接管理、能力探测、生图和聊天分别为 6、11、11、13 个实际运行用例；共享确定性基础设施，保留断言和局部桩清理。
- [x] **Step 3: 验证等价性。** 四个目标文件定向测试合计 41/41 通过，35 个显式标题无遗漏。

### Task 2: 提取无状态模型规则

**Files:**
- Create: `apps/local-runtime/src/model-connections/model-option-policy.ts`
- Modify: `apps/local-runtime/src/model-connections/service.ts`
- Test: `apps/local-runtime/tests/unit/model-image-generation.test.ts`
- Test: `apps/local-runtime/tests/unit/model-connection-management.test.ts`

**Interfaces:** `model-option-policy.ts` 提供内部函数 `toDto(connection: StoredModelConnection): ModelConnectionDto`、`mergeDiscoveredModel(connection: StoredModelConnection, id: string): ModelOptionDto`、`withCatalogLabels(model: ModelOptionDto, baseUrl: string): ModelOptionDto`、`isImageEligible(model: ModelOptionDto, baseUrl: string): boolean`、`selectedImageApi(model: ModelOptionDto, baseUrl: string): ImageGenerationApi`、`imageApiForModel(baseUrl: string): ImageGenerationApi`。只由服务导入，不加入包公共导出。

- [x] **Step 1: 锁定规则边界。** 现有生图与管理测试覆盖资格、旧 Token Plan 结果降级、双成功接口优先级和列表映射；未添加镜像测试。
- [x] **Step 2: 移动最小实现。** 已将规则移入 `model-option-policy.ts`，服务调用同一资格判断。
- [x] **Step 3: 验证。** 生图与管理定向测试 17/17 通过，包级 typecheck 通过；服务公共导出仍为原三项。

### Task 3: 提取能力探测与错误归一化

**Files:**
- Create: `apps/local-runtime/src/model-connections/model-capability-testing.ts`
- Create: `apps/local-runtime/src/model-connections/model-service-error.ts`
- Modify: `apps/local-runtime/src/model-connections/service.ts`
- Test: `apps/local-runtime/tests/unit/model-capability-testing.test.ts`
- Test: `apps/local-runtime/tests/unit/model-image-generation.test.ts`

**Interfaces:** `probeModelCapabilities(endpoint: { baseUrl: string; apiKey: string; protocol: StoredModelConnection['protocol'] }, modelIds: readonly string[], transport: HttpTransport): Promise<ModelTestResultDto[]>` 只执行探测并返回结果，不读写连接。`toServiceError(failure: ProviderFailure | unknown): ModelServiceError` 供服务和探测模块共用，避免循环 import。

- [x] **Step 1: 锁定探测边界。** 现有测试覆盖四模型并发、同模型能力并发、Token Plan 双接口顺序及失败分类；无新增镜像测试。
- [x] **Step 2: 移动错误归一化与探测实现。** `toServiceError` 与探测实现已进入内部模块；连接重读、持久化和草稿缓存仍在服务。
- [x] **Step 3: 验证。** 能力与生图定向测试 22/22 通过，包级 typecheck 通过。

### Task 4: 服务收敛与最终等价性

**Files:**
- Modify: `apps/local-runtime/src/model-connections/service.ts`
- Modify: `openspec/changes/archive/2026-09-30-decompose-model-connection-service/tasks.md`
- Modify: `openspec/changes/archive/2026-09-30-decompose-model-connection-service/design.md`（仅记录验证证据）

**Interfaces:** `ModelConnectionServiceOptions`、`ModelConnectionService`、`validateDraft` 保持原签名和导出；两项公共端口实现不变。

- [x] **Step 1: 核对服务职责。** 冗余 helper 与 import 已移除；连接读写、草稿缓存与异步复查仍在服务，依赖方向和用例分布记入 OpenSpec design.md。
- [x] **Step 2: 定向集成验证。** 四个拆分测试、`model-gateway`、`service-http` 共 80/80 通过；包级 typecheck 通过。
- [x] **Step 3: 提交门禁。** `pnpm typecheck`、`pnpm lint` 通过；`pnpm test` 为 2598 通过、59 失败、5 跳过，失败来自新工作树缺少打包资源及基线迁移测试预期过期，详情记入 OpenSpec design.md。只暂存本变更文件后提交。此仓库门禁优先于每任务提交的通用建议。
