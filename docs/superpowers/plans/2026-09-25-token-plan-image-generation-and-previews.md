# Token Plan 生图与图片预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户显式选择 Token Plan 生图接口，正确告知未配置状态，并使宽幅图片在输入框和用户消息中完整可辨。

**Architecture:** 模型行保存 `imageGenerationApi`；Runtime 按该字段选择 Images API 或 Token Plan 适配器，仍通过现有 `image_generate` 和会话资产存储输出。Agent 图每轮读取配置状态，动态提供准确说明；图片 UI 只调整缩略图布局与加载反馈。

**Tech Stack:** TypeScript、React、Electron、SQLite、Vitest、Playwright、OpenSpec。

**Spec:** [已确认设计](../specs/2026-09-25-token-plan-image-generation-design.md)；[OpenSpec 变更](../../../openspec/changes/support-token-plan-and-image-previews/)。

## Global Constraints

- 生图接口只选 `openai-images` 或 `token-plan`；能力开关和默认模型由用户手动设置，迁移不得自动启用或触发计费。
- 保留 `image_generate` 工具名称、最多四张并行、现有会话图片资产和聊天连接协议。
- Token Plan 首版只支持官方直连 HTTPS 网关的同步文字生图，单请求 `n: 1`、`size: '1024*1024'`。
- 旧模型行迁移为 `openai-images`，保留图片能力和默认引用。
- 图片字节和提供方临时 URL 不写入模型日志、会话事件或遥测。
- 使用 `pnpm` 运行项目命令；不调用真实付费生图端点。

## Review Focus

- 旧库中已有 Images API 默认模型：迁移后仍能生成，字段不会因刷新丢失；Task 1 和 Task 2 测试覆盖。
- Token Plan 连接地址不属于官方 HTTPS 网关：设置时拒绝并保留已有配置；Task 1 和 Task 3 测试覆盖。
- 提供方返回空结果、非 HTTPS 图片 URL 或下载失败：没有成功图片或临时链接泄漏；Task 2 测试覆盖。
- 默认模型在任务开始后停用：下一轮模型请求获得未配置说明，执行中的工具明确失败；Task 2 和 Task 3 测试覆盖。
- 宽幅白底截图在预览和发送后看似空白：保持全图比例、边框与放大入口；Task 5 测试覆盖。

---

### Task 1: 模型协议字段与 SQLite 迁移

**Files:**

- Modify: `packages/model-connections/src/types.ts`
- Modify: `apps/agent-runtime/src/database.ts`
- Modify: `apps/agent-runtime/src/model-connections/sqlite-store.ts`
- Modify: `apps/agent-runtime/src/model-connections/service.ts`
- Test: `apps/agent-runtime/tests/database.test.ts`
- Test: `apps/agent-runtime/tests/model-connection-store.test.ts`
- Test: `apps/agent-runtime/tests/model-connection-service.test.ts`

**Interfaces:**

- Produces: `type ImageGenerationApi = 'openai-images' | 'token-plan'`；`ModelOptionDto.imageGenerationApi?: ImageGenerationApi`；`ModelConnectionService.setModelImageGenerationApi({ connectionId, modelId, api })`。
- Consumes: 现有 `ModelConnectionStore`、`ModelRef` 和 SQLite migration 机制。

- [ ] **Step 1: 写失败的迁移与服务测试。** 以旧 schema 建库后迁移，断言 `PRAGMA table_info(model_connection_models)` 包含 `image_generation_api` 且已有模型读出 `openai-images`；保存/刷新 `token-plan` 时保持该字段、开关和默认引用；不合法 API 值及非官方 Token Plan 地址被拒绝。
- [ ] **Step 2: 运行测试确认失败。** `pnpm vitest run apps/agent-runtime/tests/database.test.ts apps/agent-runtime/tests/model-connection-store.test.ts apps/agent-runtime/tests/model-connection-service.test.ts`；预期新断言失败于缺少字段/方法。
- [ ] **Step 3: 扩展共享类型与迁移。** 在 `DEFAULT_RUNTIME_MIGRATIONS` 追加 version 10：

  ```ts
  export type ImageGenerationApi = 'openai-images' | 'token-plan'
  export type ModelImageGenerationApiRequestDto = {
    connectionId: string
    modelId: string
    api: ImageGenerationApi
  }
  ```

  ```sql
  ALTER TABLE model_connection_models
    ADD COLUMN image_generation_api TEXT NOT NULL DEFAULT 'openai-images';
  ```

  在 `sqlite-store.ts` 的 SELECT/INSERT/`toModel` 往返字段；缺失或旧 DTO 归一化为 `openai-images`。在 `service.ts` 增加 `setModelImageGenerationApi`，验证枚举、模型归属与 `token-plan` 的官方 HTTPS `*.maas.aliyuncs.com` 地址；不改变能力开关或默认引用。

- [ ] **Step 4: 运行测试和类型检查。** 使用 Step 2 的 Vitest 命令及 `pnpm --filter @action-driver/agent-runtime typecheck`，确认迁移、读写与旧配置通过。
- [ ] **Step 5: 提交本任务。** `git add packages/model-connections/src/types.ts apps/agent-runtime/src/database.ts apps/agent-runtime/src/model-connections apps/agent-runtime/tests && git commit -m "feat: persist image generation API per model"`。

### Task 2: Token Plan 生图适配与路由

**Files:**

- Create: `apps/agent-runtime/src/media/token-plan-image-generation-adapter.ts`
- Modify: `apps/agent-runtime/src/media/image-generation-adapter.ts`（仅在抽取共享有界下载函数时）
- Modify: `apps/agent-runtime/src/model-connections/service.ts`
- Test: `apps/agent-runtime/tests/token-plan-image-generation-adapter.test.ts`
- Test: `apps/agent-runtime/tests/model-connection-service.test.ts`
- Test: `apps/agent-runtime/tests/image-generation-tool.test.ts`

**Interfaces:**

- Produces: `createTokenPlanImageGenerationAdapter({ fetch?, timeoutMs? }).generate(request, signal): Promise<Uint8Array>`，`request` 沿用 `ImageGenerationRequest`。
- Consumes: Task 1 的 `imageGenerationApi`、既有 `createImageGenerationAdapter`、`SessionAssetStore.saveGenerated`。

- [ ] **Step 1: 写失败的 Mock HTTP 测试。** `fetch` 先返回 `output.choices[0].message.content[0].image` 的 HTTPS URL，再返回测试 PNG；断言 POST 地址、Bearer、`model`、`input.messages`、`parameters: { size: '1024*1024', n: 1 }` 和最终字节。追加 429、空 choices、`http:` URL、下载 404、超限、取消及超时用例；服务测试断言两类协议正确路由，工具测试断言四张中的部分成功保留。
- [ ] **Step 2: 运行测试确认失败。** `pnpm vitest run apps/agent-runtime/tests/token-plan-image-generation-adapter.test.ts apps/agent-runtime/tests/model-connection-service.test.ts apps/agent-runtime/tests/image-generation-tool.test.ts`；预期新适配器缺失或路由断言失败。
- [ ] **Step 3: 实现最小适配器。** 从已验证的连接 URL 取 `origin`，拼 `/api/v1/services/aigc/multimodal-generation/generation`，发送单图 JSON；只接受结构化 `output.choices[*].message.content[*].image` HTTPS 地址，按现有 `MAX_IMAGE_BYTES` 有界下载并返回字节。所有错误转稳定 `IMAGE_*` 码，不输出提供方正文、API Key 或临时 URL。若抽取现有有界读取工具，保持 Images API 现有测试通过。

  ```ts
  const endpoint = new URL(
    '/api/v1/services/aigc/multimodal-generation/generation',
    request.baseUrl
  )
  const body = {
    model: request.modelId,
    input: { messages: [{ role: 'user', content: [{ text: request.prompt }] }] },
    parameters: { size: '1024*1024', n: 1 }
  }
  ```

- [ ] **Step 4: 在服务中分发。** `generateImage` 完成默认模型、能力及地址验证后，按 `model.imageGenerationApi ?? 'openai-images'` 选择适配器；不改工具 schema 或存储时序。
- [ ] **Step 5: 运行 Step 2 测试与类型检查。** 确认错误、取消和两条路由均通过；`pnpm --filter @action-driver/agent-runtime typecheck`。
- [ ] **Step 6: 提交本任务。** `git add apps/agent-runtime/src/media apps/agent-runtime/src/model-connections/service.ts apps/agent-runtime/tests && git commit -m "feat: generate images through Token Plan"`。

### Task 3: 未配置状态进入模型请求

**Files:**

- Modify: `apps/agent-runtime/src/agent-graph.ts`
- Modify: `apps/agent-runtime/src/runtime-process.ts`
- Test: `apps/agent-runtime/tests/agent-graph.test.ts`

**Interfaces:**

- Produces: `GraphToolRuntime.capabilityNotice?: () => Promise<string | null>`；每轮模型请求的临时系统消息。
- Consumes: `ModelConnectionService.getDefaultImageModel()` 与现有 `isAvailable` 过滤。

- [ ] **Step 1: 写失败的图测试。** 假工具 Runtime 未配置生图时，捕获 `ModelGateway` 请求并断言没有 `image_generate` 工具、有“设置 → 模型连接”配置说明；设置默认模型后第二轮断言工具可见、未配置说明消失；正文历史不重复追加该说明。
- [ ] **Step 2: 运行测试确认失败。** `pnpm vitest run apps/agent-runtime/tests/agent-graph.test.ts`，预期新模型消息断言失败。
- [ ] **Step 3: 实现动态说明。** `runtime-process.ts` 从同一 `service.getDefaultImageModel()` 构造 `capabilityNotice`。`agent-graph.ts` 在 `plan` 发送给模型的 `messages` 前临时插入系统消息，不写回 `state.modelMessages`，从而每轮重新读取且 checkpoint 不积累说明。保持无默认模型时过滤工具。

  ```ts
  const notice = await this.toolRuntime?.capabilityNotice?.()
  const messages = notice
    ? [{ role: 'system' as const, content: notice }, ...state.modelMessages]
    : state.modelMessages
  ```

- [ ] **Step 4: 运行测试与类型检查。** Step 2 命令及 `pnpm --filter @action-driver/agent-runtime typecheck`；检查含多次工具轮次的请求没有重复说明。
- [ ] **Step 5: 提交本任务。** `git add apps/agent-runtime/src/agent-graph.ts apps/agent-runtime/src/runtime-process.ts apps/agent-runtime/tests/agent-graph.test.ts && git commit -m "fix: explain unconfigured image generation to agent"`。

### Task 4: 桌面设置接通协议选择

**Files:**

- Modify: `apps/agent-runtime/src/service/http-service.ts`
- Modify: `apps/desktop/src/main/model-connections/http-client.ts`
- Modify: `apps/desktop/src/preload/desktop-api.ts`
- Modify: `apps/desktop/src/renderer/src/models/model-connections.ts`
- Modify: `apps/desktop/src/renderer/src/services/desktop-model-connections.ts`
- Modify: `apps/desktop/src/renderer/src/services/mock-model-connections.ts`
- Modify: `apps/desktop/src/renderer/src/pages/SettingsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ModelConnectionCard.tsx`
- Modify: `apps/desktop/src/renderer/src/components/settings/LibraryModelRow.tsx`
- Test: `apps/desktop/src/renderer/src/pages/SettingsPage.test.tsx`
- Test: `apps/desktop/src/renderer/src/services/desktop-model-connections.test.ts`

**Interfaces:**

- Produces: `PUT /model-connections/:connectionId/models/:modelId/image-generation-api` body `{ api: ImageGenerationApi }`；桌面服务 `setModelImageGenerationApi(connectionId, modelId, api): Promise<void>`。
- Consumes: Task 1 的服务方法和 DTO；设置页现有 query invalidation 流程。

- [ ] **Step 1: 写失败的服务与 UI 测试。** 设置页启用图片生成后选择 Token Plan，断言保存调用使用模型 ID 和 `token-plan`，重载后仍显示该选项；无效官方地址反馈在设置页且不清除旧配置；桌面 DTO 映射缺字段时显示 Images API。
- [ ] **Step 2: 运行测试确认失败。** `pnpm vitest run apps/desktop/src/renderer/src/pages/SettingsPage.test.tsx apps/desktop/src/renderer/src/services/desktop-model-connections.test.ts`，预期选择器和方法缺失。
- [ ] **Step 3: 打通 HTTP、main、preload 和 renderer。** HTTP 端用 `z.enum(['openai-images','token-plan'])` 校验并调用 Task 1 的服务方法；各层传同一枚举，不传 API Key；设置成功后更新 `model-connections` 查询缓存。

  ```ts
  // apps/agent-runtime/src/service/http-service.ts
  const imageGenerationApiSchema = z
    .object({
      api: z.enum(['openai-images', 'token-plan'])
    })
    .strict()
  ```

- [ ] **Step 4: 加入模型行选择器。** 只在生图开关开启时显示 `Images API` / `Token Plan`，清晰区分协议与默认模型；沿用当前设置页布局与错误提示，给控件可读标签和键盘焦点。
- [ ] **Step 5: 运行测试、类型检查和交互契约校验。** Step 2 命令、`pnpm --filter @action-driver/desktop typecheck`、`pnpm validate:e2e-interactions`。
- [ ] **Step 6: 提交本任务。** `git add apps/agent-runtime/src/service/http-service.ts apps/desktop/src && git commit -m "feat: configure image generation API in model settings"`。

### Task 5: 图片预览与用户消息显示

**Files:**

- Modify: `apps/desktop/src/renderer/src/components/AgentComposer.tsx`
- Modify: `apps/desktop/src/renderer/src/components/agent/UserMessage.tsx`
- Modify: `apps/desktop/src/renderer/src/components/agent/ConversationImage.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/agent.css`
- Test: `apps/desktop/src/renderer/src/components/AgentComposer.test.tsx`
- Test: `apps/desktop/src/renderer/src/components/Conversation.test.tsx`
- Test: `apps/desktop/e2e/local-runtime.spec.ts`（或专门的含图 UI 用例）

**Interfaces:**

- Consumes: 现有 `ImageReader`、对象 URL 生命周期、图片资产元数据。
- Produces: 输入卡片和用户消息的完整比例缩略图；放大与下载保持原行为。

- [ ] **Step 1: 写失败的 UI 测试。** 用一张宽幅白底文字 PNG 选择/粘贴为附件，断言预览图 `object-fit: contain`、文件名和移除按钮可见；用户图片消息只显示一张图，图像有清晰边框，可放大，缺失资产仍有错误占位。端到端场景核对发送后与重开会话时图片仍可读取。
- [ ] **Step 2: 运行组件测试确认失败。** `pnpm vitest run apps/desktop/src/renderer/src/components/AgentComposer.test.tsx apps/desktop/src/renderer/src/components/Conversation.test.tsx`。
- [ ] **Step 3: 实现布局。** 将 `.composer-image-preview img` 的固定 30×30 裁切替换为有界、保持比例的 `object-fit: contain` 图片区；文件名、移除按钮放在独立行。给 `.conversation-image-open` 及缩略图清晰边框、完整比例限制；用户图片消息避免空白文字 span 扩大气泡，图文混排仍遵循提交顺序。`ConversationImage` 加载失败时显示现有占位并释放对象 URL。

  ```css
  .composer-image-preview img {
    display: block;
    width: 100%;
    height: 96px;
    object-fit: contain;
  }
  .conversation-image-open img {
    display: block;
    max-width: min(320px, 100%);
    max-height: 240px;
    object-fit: contain;
  }
  ```

- [ ] **Step 4: 验证。** 运行 Step 2 命令和 `pnpm --filter @action-driver/desktop typecheck`；运行含图 UI 用例并检查宽幅白底文字图的截图，确认构图完整、尺寸和间距协调。
- [ ] **Step 5: 提交本任务。** `git add apps/desktop/src/renderer/src/components apps/desktop/src/renderer/src/styles/agent.css apps/desktop/e2e && git commit -m "fix: show complete conversation image previews"`。

### Task 6: 跨层验收与 OpenSpec 收尾

**Files:**

- Modify: `openspec/changes/support-token-plan-and-image-previews/tasks.md`（逐项勾选）
- Create: `openspec/changes/support-token-plan-and-image-previews/verification.md`（记录执行证据）

**Interfaces:**

- Consumes: Task 1–5 的实现和全部增量规范。

- [ ] **Step 1: 完整运行项目门禁。** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`；失败时仅修复本变更导致的问题并重跑对应门禁。
- [ ] **Step 2: 运行 Mock 桌面流程。** `pnpm test:e2e:local`，确认未配置提示、协议选择、Token Plan Mock 生图、四图部分失败、上传宽幅图和历史恢复；不调用真实计费端点。
- [ ] **Step 3: 校验 OpenSpec。** `openspec validate support-token-plan-and-image-previews --strict`，对照两个增量规范记录每个场景的通过证据；必要时补充缺失的回归测试。
- [ ] **Step 4: 提交验收记录。** 勾选完成任务，写 `verification.md` 并提交；按 `openspec-archive-change` 流程同步与归档，在验证完成前不归档。

## Handoff

此计划在 `main` 执行，沿用用户已确认的工作方式。实现前请先审查设计、OpenSpec 变更和本计划；确认后按 Task 1–6 逐项实施。文档中的真实 Token Plan 调用只描述协议，测试全部使用 Mock，避免产生费用。
