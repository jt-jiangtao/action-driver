# Conversation Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户可上传图片让 Agent 识别，并让 Agent 一次并行生成最多 4 张图片；图片在实时对话和历史会话中可见，模型配置列表提供能力开关和默认生图模型选择。

**Architecture:** SQLite 继续保存消息、事件和资产索引；图片字节按会话存于本地目录。Chat Completions 适配器只在发出请求时从资产 ID 读取视觉输入；独立的 `image_generate` 工具使用模型列表中手动指定的 Images API 兼容模型，逐张提交资产和有序事件。桌面端通过认证 HTTP 请求读取图片并创建对象 URL。

**Tech Stack:** TypeScript、React/Slate、Electron、Hono、OpenAI SDK、SQLite、LangGraph、Vitest、Playwright；图片类型检测使用 `file-type@20.5.0`、尺寸读取使用 `image-size@2.0.4`，均由 pnpm 锁定。

**Spec:** [书面设计](../specs/2026-09-25-conversation-images-design.md)、[OpenSpec 技术设计](../../../openspec/changes/add-conversation-images/design.md)、[行为规格](../../../openspec/changes/add-conversation-images/specs/conversation-images/spec.md)。

## Global Constraints

- 在用户此前指定的 `main` 分支实施；不为本变更创建功能分支或工作树。
- 图片和附件按 `sessions/<sessionId>/attachments/{uploads,generated}/` 分目录；消息、任务、事件和图片元数据继续保存在 SQLite。
- `image_generate` 一次接受 1–4 条独立提示词，最多 4 个独立 Images API 兼容请求并行；逐张展示，部分失败保留成功图片。
- 模型连接列表提供图片输入、生图能力开关和唯一默认生图模型；不自动筛选候选，不在刷新时逐个进行可能计费的生图测试。
- 对话流、快照、持久化事件、工具原始 I/O、交互日志和 Phoenix trace 只记录图片引用与摘要，绝不记录图片字节或 base64。
- 首版只接 PNG、JPEG、WebP 输入；参考图编辑、局部重绘、遮罩及其他供应商原生生图协议不在范围内。
- 单张上传图片上限 20 MiB、解码像素上限 16,777,216，每条用户消息最多 4 张图片；生成响应也按 20 MiB 上限处理。
- 旧纯文本任务可读；提供方失败、取消、超时、文件缺失不能显示为图片生成成功。

## Review Focus

- 新会话只有图片、没有文字：必须有稳定任务标题并成功提交。Task 3、Task 7 的测试覆盖。
- 文件扩展名伪装为 PNG，但字节是损坏或其他类型：上传必须在建立引用前拒绝。Task 2 测试覆盖。
- 4 张并行中一张完成后取消：已提交图片保留，其余请求终止且不出现迟到成功事件。Task 5、Task 6 测试覆盖。
- 刷新模型列表或删除连接：图片能力开关和默认引用必须按模型 ID 保留或清除，不能误指向别的模型。Task 4、Task 8 测试覆盖。
- 新会话上传后请求失败或重试：暂存资产只能绑定到一个会话，不能串会话或在重放时重复生成。Task 2、Task 6 测试覆盖。

---

## File Map

| 文件                                                                                                            | 职责                                 |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `packages/contracts/src/index.ts`                                                                               | 图片资产引用、消息块和请求投影类型   |
| `packages/runtime-contracts/src/stream-protocol.ts`                                                             | 含图请求、逐张图片事件、恢复快照校验 |
| `packages/runtime-contracts/src/tool-protocol.ts`                                                               | 工具资产结果事件                     |
| `packages/model-connections/src/types.ts`                                                                       | 模型图片能力和多模态输入类型         |
| `apps/agent-runtime/src/database.ts`                                                                            | v9 图片资产、模型能力与默认模型迁移  |
| `apps/agent-runtime/src/media/session-asset-store.ts`                                                           | 暂存、会话目录、验证和原子文件写入   |
| `apps/agent-runtime/src/media/image-generation-adapter.ts`                                                      | Images API 兼容请求与结果归一        |
| `apps/agent-runtime/src/media/image-generation-tool.ts`                                                         | 1–4 张并行、取消和逐张结果           |
| `apps/agent-runtime/src/model-connections/{service,provider-adapters,model-gateway}.ts`                         | 能力设置、视觉请求和日志脱敏         |
| `apps/agent-runtime/src/{stream-session-service,tool-invocation-service,task-projection}.ts`                    | 图片事件、消息持久化与恢复           |
| `apps/agent-runtime/src/service/http-service.ts`                                                                | 认证上传和图片读取                   |
| `apps/desktop/src/renderer/src/{App.tsx,components/AgentComposer.tsx}`                                          | 图片选择、预览、提交                 |
| `apps/desktop/src/renderer/src/components/agent/{UserMessage,AgentResponse}.tsx`                                | 图片块、放大和保存                   |
| `apps/desktop/src/renderer/src/components/settings/{ModelLibrary,LibraryModelRow}.tsx`                          | 模型能力开关和默认选择               |
| `apps/desktop/src/renderer/src/services/{runtime-http-client,renderer-stream-client,stream-task-projection}.ts` | 二进制上传/读取和有序图片投影        |

### Task 1: 定义图片块和数据库迁移

**Files:** Modify `packages/contracts/src/index.ts`, `packages/model-connections/src/types.ts`, `packages/runtime-contracts/src/stream-protocol.ts`, `apps/agent-runtime/src/database.ts`; test `packages/runtime-contracts/tests/stream-protocol.test.ts`, `apps/agent-runtime/tests/repositories.test.ts`, `apps/agent-runtime/tests/model-connection-store.test.ts`.

**Interfaces:** Produce `ImageAssetRef = { assetId; sessionId; mimeType; width; height; byteLength; source:'upload'|'generated' }` and `MessageContentPart = {kind:'text';text:string}|{kind:'image';asset:ImageAssetRef}`. Persist new messages as `{parts:MessageContentPart[]}`; keep a reader for old `{text:string}`. Database v9 adds `session_assets`, `image_input_enabled`, `image_generation_enabled` and one `default_image_model` reference.

- [ ] **Step 1:** Write failing contract tests for a pure image request, a mixed text/image snapshot, old text content, and default model migration. The request schema must accept `content:''` only when at least one `imageAssetId` exists.

```ts
expect(parseStreamClientEvent(imageOnlyRequest).payload.input).toMatchObject({
  content: '',
  imageAssetIds: ['asset-1']
})
expect(() => parseStreamClientEvent(emptyRequest)).toThrow()
```

- [ ] **Step 2:** Run `corepack pnpm exec vitest run packages/runtime-contracts/tests/stream-protocol.test.ts apps/agent-runtime/tests/repositories.test.ts apps/agent-runtime/tests/model-connection-store.test.ts`; confirm the new cases fail for absent fields/migration.
- [ ] **Step 3:** Add the types, Zod fields and v9 migration. Keep old text accessors compatible, assign `image_input_enabled` and `image_generation_enabled` default `0`, and default image model nullable. Use `(connection_id,model_id)` as the default reference, and clear it when the model/connection is disabled or removed.

```ts
export type MessageContentPart =
  | { kind: 'text'; text: string }
  | { kind: 'image'; asset: ImageAssetRef }
export const readParts = (value: { text?: string; parts?: MessageContentPart[] }) =>
  value.parts ?? [{ kind: 'text' as const, text: value.text ?? '' }]
```

- [ ] **Step 4:** Rerun the three tests and `corepack pnpm typecheck`; verify an existing v8 database upgrades and old messages remain readable.
- [ ] **Step 5:** Commit this contract/migration slice as `feat: define conversation image contracts`.

### Task 2: 建立会话资产目录与认证传输

**Files:** Create `apps/agent-runtime/src/media/session-asset-store.ts`, `apps/agent-runtime/tests/session-asset-store.test.ts`; modify `apps/agent-runtime/src/service/http-service.ts`, `apps/agent-runtime/src/runtime-process.ts`, `apps/desktop/src/renderer/src/services/runtime-http-client.ts`, `apps/agent-runtime/package.json`, `pnpm-lock.yaml`; test `apps/agent-runtime/tests/service-http.test.ts`.

**Interfaces:** Produce `StagedAssetRef = Omit<ImageAssetRef,'sessionId'>` and `SessionAssetStore.stageUpload(bytes): Promise<StagedAssetRef>`, `bindStaged(assetId,sessionId): Promise<ImageAssetRef>`, `saveGenerated(sessionId,bytes): Promise<ImageAssetRef>`, `read(assetId,sessionId): Promise<{bytes:Uint8Array;mimeType:string}>`. Expose authenticated `POST /assets/staged` and `GET /sessions/:sessionId/assets/:assetId` routes; desktop client gains `uploadImage(file)` and `readImage(sessionId,assetId)` methods.

- [ ] **Step 1:** Write failing tests for valid PNG/JPEG/WebP, fake extension, corrupted bytes, oversized input, dimensions above the configured limit, two session folders, missing asset, wrong session, stale staging and idempotent bind.

```ts
await expect(store.bindStaged(assetId, 'session-a')).resolves.toMatchObject({
  sessionId: 'session-a'
})
await expect(store.bindStaged(assetId, 'session-b')).rejects.toThrow('ASSET_SESSION_MISMATCH')
expect(await store.read(assetId, 'session-a')).toMatchObject({ mimeType: 'image/png' })
```

- [ ] **Step 2:** Run `corepack pnpm exec vitest run apps/agent-runtime/tests/session-asset-store.test.ts apps/agent-runtime/tests/service-http.test.ts`; confirm new cases fail.
- [ ] **Step 3:** Add pinned `file-type@20.5.0` and `image-size@2.0.4`. Write to a random temp name under `staging/` or the target session directory, detect actual type and dimensions, atomically rename, then commit metadata. Use asset IDs for paths; never join raw filenames. Give binary routes their own bounded body handling and log only MIME/length/asset ID, while retaining the existing token and origin checks.

```ts
const detected = await fileTypeFromBuffer(bytes)
if (!detected || !['image/png', 'image/jpeg', 'image/webp'].includes(detected.mime))
  throw new AssetError('IMAGE_TYPE_UNSUPPORTED')
const { width, height } = imageSize(bytes)
if (!width || !height || width * height > MAX_IMAGE_PIXELS)
  throw new AssetError('IMAGE_DIMENSIONS_INVALID')
```

- [ ] **Step 4:** Rerun both tests, build Runtime, and inspect logs to confirm uploaded bytes/base64 are absent; verify missing file returns a stable not-found result rather than a server crash.
- [ ] **Step 5:** Commit as `feat: store session image assets`.

### Task 3: 接受含图消息并建立视觉模型输入

**Files:** Modify `packages/contracts/src/index.ts`, `apps/agent-runtime/src/stream-session-service.ts`, `apps/agent-runtime/src/ports.ts`, `apps/agent-runtime/src/task-projection.ts`, `apps/agent-runtime/src/agent-graph.ts`, `apps/agent-runtime/src/model-connections/provider-adapters.ts`; tests `apps/agent-runtime/tests/stream-session-service.test.ts`, `apps/agent-runtime/tests/provider-adapters.test.ts`, `apps/agent-runtime/tests/task-projection.test.ts`.

**Interfaces:** Consume Task 1's `MessageContentPart` and Task 2's asset reader. `ModelInputMessage` user content accepts text and image asset refs; adapter converts only user image parts to OpenAI-compatible `image_url` data URLs at send time. `request.create` accepts staged IDs; StreamSession binds them to the server-created session ID before persisting the user message.

- [ ] **Step 1:** Write failing tests for image-only request with title `图片消息`, mixed text/image history, duplicate create idempotency, a model request containing `[{type:'text'}, {type:'image_url'}]`, and a legacy `{text}` task projection.

```ts
expect(requestBody.messages.at(-1)?.content).toEqual([
  { type: 'text', text: '这是什么？' },
  { type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) } }
])
```

- [ ] **Step 2:** Run the three named test files; confirm the image-only request and multimodal adapter cases fail.
- [ ] **Step 3:** Persist user messages as `{parts}`, use trimmed text or `图片消息` for task title, pass ordered blocks through Graph history, and resolve bytes only inside the provider adapter. On bind or provider failure keep staged assets recoverable until their lease expires; do not create a partially referenced user message.

```ts
const goal = input.content.trim() || '图片消息'
const parts: MessageContentPart[] = [
  ...(input.content ? [{ kind: 'text' as const, text: input.content }] : []),
  ...boundAssets.map((asset) => ({ kind: 'image' as const, asset }))
]
```

- [ ] **Step 4:** Rerun tests and `corepack pnpm typecheck`; verify old text-only sessions still project the same content.
- [ ] **Step 5:** Commit as `feat: pass uploaded images to vision models`.

### Task 4: 在模型列表配置图片能力和默认模型

**Files:** Modify `apps/agent-runtime/src/model-connections/{store,sqlite-store,service}.ts`, `apps/agent-runtime/src/service/http-service.ts`, `packages/model-connections/src/types.ts`, `apps/desktop/src/preload/desktop-api.ts`, `apps/desktop/src/renderer/src/models/model-connections.ts`, `apps/desktop/src/renderer/src/services/{runtime-model-http-api,desktop-model-connections}.ts`; tests `apps/agent-runtime/tests/model-connection-service.test.ts`, `apps/agent-runtime/tests/service-http.test.ts`, `apps/desktop/src/renderer/src/services/desktop-model-connections.test.ts`.

**Interfaces:** Produce `setModelImageCapability({connectionId,modelId,kind:'input'|'generation',enabled})`, `setDefaultImageModel(model:ModelRef|null)` and `getDefaultImageModel():ModelRef|null`. A connection containing only an image-generation model can be stored without chat probe success; ordinary chat model testing remains unchanged.

- [ ] **Step 1:** Write failing service tests for toggles, one global default, refresh preserving flags by ID, disabled/deleted default clearing, image-only manual model save, and no images generation request during refresh.

```ts
await service.setModelImageCapability({
  connectionId: 'c1',
  modelId: 'img',
  kind: 'generation',
  enabled: true
})
await service.setDefaultImageModel({ connectionId: 'c1', modelId: 'img' })
expect(await service.getDefaultImageModel()).toEqual({ connectionId: 'c1', modelId: 'img' })
```

- [ ] **Step 2:** Run the three relevant test files and confirm the new API is absent.
- [ ] **Step 3:** Store capability flags and unique default reference in SQLite, expose matching authenticated HTTP methods, and map them through preload/renderer service types. Do not infer capabilities from model ID; `refresh` merges existing flags by exact ID and clears stale defaults. Permit manually added image-only model rows without requiring Chat Completions probe.

```ts
const previousById = new Map(connection.models.map((model) => [model.id, model]))
connection.models = discoveredIds.map((id) => ({
  ...newModelOption(id),
  imageInputEnabled: previousById.get(id)?.imageInputEnabled ?? false,
  imageGenerationEnabled: previousById.get(id)?.imageGenerationEnabled ?? false
}))
```

- [ ] **Step 4:** Rerun service tests and `corepack pnpm typecheck`; inspect that chat model selection stays unchanged when default image model changes.
- [ ] **Step 5:** Commit as `feat: configure model image capabilities`.

### Task 5: 并行生成最多 4 张图片

**Files:** Create `apps/agent-runtime/src/media/{image-generation-adapter,image-generation-tool}.ts`, `apps/agent-runtime/tests/image-generation-tool.test.ts`; modify `packages/runtime-contracts/src/tool-protocol.ts`, `apps/agent-runtime/src/{runtime-process,tool-activity}.ts`, `apps/agent-runtime/src/tool-output-collector.ts`.

**Interfaces:** Produce `createImageGenerationTool({defaultModel,generate,assets,sessionForTask})` with schema `{images:[{prompt:string}]}` length 1–4. Adapter sends one Images API compatible `/images/generations` request per item with `n:1`; returns validated image bytes and MIME. Executor yields `{kind:'asset',asset:ImageAssetRef,index:number}` as each request succeeds, then a JSON summary `{succeeded,failed}`. Add `tool.asset` to ToolExecutorEvent/ToolEvent; no image bytes in tool result.

- [ ] **Step 1:** Write failing tests with deferred adapter promises proving 4 requests start before any resolves, fifth item is rejected before network I/O, distinct prompts are passed, one failure preserves three assets, all fail yields tool failure, and cancellation stops unfinished requests but preserves finished assets.

```ts
const running = collect(tool.executor.execute(callWithFourPrompts, controller.signal))
expect(generate).toHaveBeenCalledTimes(4)
first.resolve(validPng)
expect(await nextAsset(running)).toMatchObject({ kind: 'asset', index: 0 })
```

- [ ] **Step 2:** Run `corepack pnpm exec vitest run apps/agent-runtime/tests/image-generation-tool.test.ts`; confirm new tests fail.
- [ ] **Step 3:** Register the tool only while a default model with generation flag exists. Launch up to 4 independent `generate` operations with a shared AbortSignal; validate each returned image before `saveGenerated`; yield completion in settled order. Produce a partial-success summary when `succeeded>0`, a failed terminal state when `succeeded===0`; cap returned bytes and provider URL downloads. Log only asset metadata and status.

```ts
const pending = new Map(images.map((item, index) => [index,
  generate({ model, prompt: item.prompt }, signal)
    .then((bytes) => ({ index, ok: true as const, bytes }))
    .catch((error) => ({ index, ok: false as const, error }))
]))
const failures: Array<{ index: number; message: string }> = []
while (pending.size) {
  const settled = await Promise.race(pending.values())
  pending.delete(settled.index)
  if (settled.ok) yield { kind: 'asset', index: settled.index,
    asset: await assets.saveGenerated(sessionId, settled.bytes) }
  else failures.push({ index: settled.index, message: sanitizeProviderError(settled.error) })
}
```

`sanitizeProviderError` 只保留稳定错误码和面向用户的简短描述，不写入服务端 URL、请求头或响应体。取消时等待已启动请求的结束状态，丢弃取消后返回的图片结果。

- [ ] **Step 4:** Rerun the new tests, tool protocol tests and Runtime typecheck. Check no unhandled promise rejection remains after first failure or cancel.
- [ ] **Step 5:** Commit as `feat: generate conversation images in parallel`.

### Task 6: 将逐张结果写入对话流并恢复

**Files:** Modify `apps/agent-runtime/src/{tool-invocation-service,stream-session-service,repositories,task-projection}.ts`, `packages/runtime-contracts/src/stream-protocol.ts`, `apps/desktop/src/renderer/src/services/stream-task-projection.ts`; tests `apps/agent-runtime/tests/{tool-invocation-service,stream-session-service,repositories}.test.ts`, `apps/desktop/src/renderer/src/services/stream-task-projection.test.ts`.

**Interfaces:** `tool.asset` stays associated with one call ID; `response.image` carries `asset:ImageAssetRef` and `contentIndex`. `commitAssistantImageWithEvent(request,message,event)` writes assistant `{parts}` and its image event in one repository transaction; request sequence is allocated with existing event rules. Snapshots include the same ordered parts and current succeeded/failed counts.

- [ ] **Step 1:** Write failing tests for image A completing before B, simultaneous tool/text events, partial failure, disconnect after A, resume without duplicates, and runtime restart after A without rerunning B. Confirm source image bytes never occur in event JSON.

```ts
expect(snapshot.messages.at(-1)?.parts).toEqual([
  { kind: 'image', asset: assetA },
  { kind: 'image', asset: assetB },
  { kind: 'text', text: '已生成两张图片' }
])
expect(JSON.stringify(snapshot)).not.toContain('data:image/')
```

- [ ] **Step 2:** Run the named Runtime and renderer projection tests; confirm ordering/recovery cases fail.
- [ ] **Step 3:** Persist asset refs before publishing, append `response.image` only after image metadata and file exist, and project image blocks by request sequence. End events must preserve already committed images while replacing only final text. On cancellation or restart keep completed assets, mark unresolved child jobs unknown, and never resubmit them automatically.

```ts
const next = {
  ...assistant,
  content: { parts: [...readParts(assistant.content), { kind: 'image', asset }] }
}
const record = await repositories.commitAssistantImageWithEvent(
  request,
  next,
  responseImageEvent(request, asset)
)
await publishThrough(request, record.cursor, emit)
```

- [ ] **Step 4:** Rerun tests and `corepack pnpm typecheck`; verify legacy text-only stream and snapshot fixtures still pass.
- [ ] **Step 5:** Commit as `feat: stream and recover generated images`.

### Task 7: 输入框和对话图片展示

**Files:** Modify `apps/desktop/src/renderer/src/{App.tsx,pages/HomePage.tsx,pages/TaskPage.tsx,components/AgentComposer.tsx}`, `apps/desktop/src/renderer/src/components/agent/{UserMessage,AgentResponse}.tsx`, `apps/desktop/src/renderer/src/services/{renderer-stream-client,runtime-http-client}.ts`; create `apps/desktop/src/renderer/src/components/agent/ConversationImage.tsx`; tests `apps/desktop/src/renderer/src/components/{AgentComposer,Conversation}.test.tsx`, `apps/desktop/src/renderer/src/services/renderer-stream-client.test.ts`, `apps/desktop/src/renderer/src/App.test.tsx`.

**Interfaces:** `AgentComposer.onSubmit({text,imageFiles})`; App stages images before stream create, passes `imageAssetIds`; `ConversationImage` fetches authenticated bytes by session/asset ID and owns its object URL cleanup. `AgentGoalRequest` accepts optional `imageAssetIds` while old `{goal}` remains valid.

- [ ] **Step 1:** Write failing component tests for paste/select, preview/remove, image-only send, model switch preserving pending files, invalid upload retaining draft, result image loading, missing-file placeholder, keyboard zoom and save.

```tsx
await user.upload(screen.getByLabelText('添加图片'), validPngFile)
expect(screen.getByRole('img', { name: '待发送图片预览' })).toBeVisible()
expect(screen.getByRole('button', { name: '发送' })).toBeEnabled()
```

- [ ] **Step 2:** Run the named component/client tests; confirm missing controls and image projection failures.
- [ ] **Step 3:** Add one shared attachment state path for both composers, stage on send, preserve draft on upload failure, and render typed message parts. Use `URL.createObjectURL` only after authenticated fetch, revoke on unmount, and present loading/error/zoom/download states with semantic labels and test IDs.

```tsx
const imageAssetIds = (await Promise.all(imageFiles.map((file) => assets.uploadImage(file)))).map(
  (asset) => asset.assetId
)
await streamClient.create({ goal: text, imageAssetIds, model })
// ConversationImage: URL.createObjectURL(await assets.readImage(sessionId, assetId))
```

- [ ] **Step 4:** Rerun tests, `corepack pnpm validate:e2e-interactions`, desktop typecheck and build; verify image-only task title shows `图片消息` rather than blank.
- [ ] **Step 5:** Commit as `feat: attach and display conversation images`.

### Task 8: 模型列表 UI 和端到端验收

**Files:** Modify `apps/desktop/src/renderer/src/components/settings/{ModelLibrary,LibraryModelRow}.tsx`, `apps/desktop/src/renderer/src/pages/SettingsPage.tsx`, `apps/desktop/src/renderer/src/styles/{settings,agent}.css` as relevant; tests `apps/desktop/src/renderer/src/pages/SettingsPage.test.tsx`, `apps/desktop/e2e/local-runtime.spec.ts`, `apps/desktop/e2e/support/fake-openai-tool-server.ts`.

**Interfaces:** Model row shows separate input/generation toggles and a single default-generation action only for generation-enabled rows. The model list refreshes through existing discovery; no candidate screen or automatic generation probe. E2E fake model service supports vision content parts and four independently delayed image responses.

- [ ] **Step 1:** Write failing settings tests for toggle states, one default, disabling/removing default, manual image-only model, and refresh preserving flags; add E2E cases for image-only vision, four results arriving out of order, one failure, cancel, restart and history restore.
- [ ] **Step 2:** Run `corepack pnpm exec vitest run apps/desktop/src/renderer/src/pages/SettingsPage.test.tsx` and the targeted local E2E case; confirm new assertions fail.
- [ ] **Step 3:** Wire UI controls to Task 4 service APIs, keep switch/default styles aligned with existing rows, show unconfigured and provider-error states. Add fake image responses as bytes to the test server; verify task stream contains refs rather than base64.

```tsx
<input
  type="checkbox"
  aria-label={`${model.name} 支持生图`}
  data-testid={e2eId('e2e/settings/model-connections/models/:model-id/image-generation#checkbox', {
    'model-id': model.id
  })}
  checked={model.imageGenerationEnabled}
  onChange={(event) => onToggleImageGeneration(model.id, event.target.checked)}
/>
```

- [ ] **Step 4:** Run `corepack pnpm check`, `corepack pnpm test:e2e:local`, and `corepack pnpm test:e2e:packaged:macos`; inspect generated app data to confirm separate session directories and usable image files. If a required packaged test cannot run, report the exact environment reason and leave the task unverified.
- [ ] **Step 5:** Commit as `feat: expose image models and verify image conversations`; sync and archive the OpenSpec change only after every acceptance item is verified.

## Final Self-Review

- Every OpenSpec requirement maps to Tasks 1–8: asset storage (1–2), visual input (3–4, 7), parallel generation (5–6), stream recovery (6), desktop presentation and configuration (7–8).
- Verify no plan step adds automatic candidate filtering, automatic paid image probing, reference-image editing or structured session migration.
- Run `git diff --check` and confirm the final worktree is clean after commits and OpenSpec archive.
