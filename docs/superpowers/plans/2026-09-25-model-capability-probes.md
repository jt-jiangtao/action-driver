# Model Capability Probes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 由逐项真实测试决定模型的文本、推理、视觉和生图能力；用户只选择默认生图模型，含图消息仅在视觉测试成功后发送。

**Architecture:** Runtime 持有模型目录、探测、自动生图路由、能力状态和 SQLite 迁移；共享 DTO 传递逐项结果，桌面端只展示及提交前校验。保留已完成的图片布局和失败展示修复，用新增能力状态替换本次尚未提交的互斥 `ModelKind` 实现。

**Tech Stack:** TypeScript、React 19、Vitest、SQLite、Electron、Playwright、OpenSpec。

**Spec:** [书面设计](../specs/2026-09-25-model-capability-probes-design.md)、[会话图片 delta](../../../openspec/changes/archive/2026-09-25-allow-image-attachments-for-chat-models/specs/conversation-images/spec.md)、[模型设置 delta](../../../openspec/changes/archive/2026-09-25-allow-image-attachments-for-chat-models/specs/model-connections-settings/spec.md)。

## Global Constraints

- 用户要求直接在 `main` 实施；不要创建分支或工作树。
- 仅在用户主动测试时发起真实探测；生图测试实际生成一张图，验证后丢弃，不写入会话。
- 音频、Realtime 和视频只展示目录能力，不发起测试，不作为已通过的聊天或生图模型。
- 附图发送要求当前模型文本和视觉测试均成功；未测、失败、不支持和无法判定一律阻止并保留草稿。
- 旧连接、密钥、模型启用状态、默认生图引用及会话图片保留；旧成功状态只提示重新测试。
- 完成后运行 OpenSpec 严格校验、`pnpm check` 和相关 Electron E2E，再同步主规范、归档并提交。

## File Structure

- `packages/model-connections/src/types.ts`：能力枚举、逐项测试结果、跨进程 DTO；删除用于修改互斥类型和接口的公开操作。
- `apps/agent-runtime/src/model-connections/model-capability-catalog.ts`：用户列出的 Token Plan 模型目录与候选探测映射；目录不声明实际测试成功。
- `apps/agent-runtime/src/model-connections/capability-probes.ts`：文本、推理、视觉、生图四种可取消探测和测试结果分类。
- `apps/agent-runtime/src/model-connections/service.ts`：编排探测、持久化结果、聊天/生图资格和自动路由。
- `apps/agent-runtime/src/database.ts`、`model-connections/sqlite-store.ts`：第 12 版迁移和逐项结果读写。
- `apps/desktop/src/renderer/src/components/settings/ModelCapabilityResults.tsx`：目录提示、逐项结果与错误详情；替代 `ModelKindFields.tsx`。
- `apps/desktop/src/renderer/src/models/*`、设置组件、`App.tsx`：能力投影、添加与重测、默认生图、视觉提交门槛。
- Runtime HTTP、桌面 preload/client、Mock：逐项 DTO 贯通。现有用户图片与失败回复组件保持。

## Review Focus

- 旧 `testState: success` 的连接升级后显示“需要重新测试”，不能悄悄变成可发送图片；Task 2 的迁移测试固定此行为。
- `qwen3.7-max` 的文本通过且视觉未通过时，纯文字可发送、带图草稿保留；Task 5 的桌面与 Runtime 测试固定此行为。
- 网络或限流失败不能写成“不支持”，再次测试成功应只覆盖该能力；Task 3 的错误分类测试固定此行为。
- 同一模型文本和生图都通过时，应同时出现在聊天和默认生图候选；Task 4 与 Task 5 的测试固定此行为。
- 生图测试图不能成为会话资产，默认生图模型被停用后工具不能继续出现；Task 3 与 Task 5 的测试固定此行为。

---

### Task 1: 能力契约与候选目录

**Files:**
- Modify: `packages/model-connections/src/types.ts`
- Create: `apps/agent-runtime/src/model-connections/model-capability-catalog.ts`
- Test: `apps/agent-runtime/tests/model-capability-catalog.test.ts`

**Interfaces:** Produce `ModelCapability = 'text' | 'reasoning' | 'vision' | 'image_generation'`, `ModelCapabilityResultDto` with `state`, `source`, `testedAt`, `failure`, and `ModelOptionDto.capabilities`. Produce `capabilityCandidates(modelId, baseUrl)` returning supported probe candidates plus display-only audio/video labels.

- [x] 写失败测试：`qwen3.8-max` 返回文本、推理、视觉候选；`qwen3.7-max` 不返回视觉；`wan2.7-image` 只返回生图；`happyhorse-1.1-t2v` 仅有视频展示标签；未知 ID 在兼容端点返回文本、视觉、生图候选。运行 `pnpm exec vitest run apps/agent-runtime/tests/model-capability-catalog.test.ts`，确认缺少目录函数而失败。
- [x] 在共享类型中定义以下结构，并把测试 DTO 改成一个模型下的逐项结果；删除 `ModelSetKindRequestDto` 与 `ModelImageGenerationApiRequestDto` 的新写入路径：

```ts
type ModelCapability = 'text' | 'reasoning' | 'vision' | 'image_generation'
type CapabilityState = 'untested' | 'testing' | 'success' | 'unsupported' | 'failed' | 'inconclusive'
type CapabilitySource = 'catalog' | 'probe' | 'legacy'
type ModelCapabilityResultDto = {
  state: CapabilityState
  source: CapabilitySource
  testedAt?: string
  failure?: ModelFailure
}
type ModelTestResultDto = {
  modelId: string
  capabilities: Partial<Record<ModelCapability, ModelCapabilityResultDto>>
}
```

- [x] 实现纯函数目录；按已确认书面设计逐一列入用户给出的千问、万相、HappyHorse、DeepSeek、智谱 ID。目录仅在官方 Token Plan 连接适用，未知兼容连接使用通用候选。运行目录测试和 `pnpm typecheck`，确认通过。
- [x] 提交 Task 1 的契约、目录和测试，提交信息 `feat: define tested model capabilities`。

### Task 2: SQLite 能力结果与旧数据迁移

**Files:**
- Modify: `apps/agent-runtime/src/database.ts`
- Modify: `apps/agent-runtime/src/model-connections/sqlite-store.ts`
- Modify: `apps/agent-runtime/src/model-connections/store.ts`
- Test: `apps/agent-runtime/tests/database.test.ts`
- Test: `apps/agent-runtime/tests/model-connection-store.test.ts`

**Interfaces:** Consume Task 1 的 `ModelCapabilityResultDto`。模型读写始终返回四项可序列化状态；旧 `test_state`、`model_kind`、`image_generation_api` 只用于迁移提示，不作为成功证据。

- [x] 写失败迁移测试：从第 11 版带聊天成功和旧默认生图引用的数据库升级，连接及引用仍在，但文本/生图为 `source: 'legacy'`、`state: 'untested'`；能力结果读写往返不改变其他模型。运行 `pnpm exec vitest run apps/agent-runtime/tests/database.test.ts apps/agent-runtime/tests/model-connection-store.test.ts`。
- [x] 添加第 12 版迁移，使用与现有 `model_connection_models` 级联关系一致的键；逐项持久化状态、来源、时间和安全错误摘要。逻辑约束示例：

```sql
CREATE TABLE model_capability_results (
  connection_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (capability IN ('text','reasoning','vision','image_generation')),
  state TEXT NOT NULL,
  source TEXT NOT NULL,
  tested_at TEXT,
  failure_code TEXT,
  failure_message TEXT,
  PRIMARY KEY (connection_id, model_id, capability),
  FOREIGN KEY (connection_id, model_id)
    REFERENCES model_connection_models(connection_id, model_id) ON DELETE CASCADE
);
```

- [x] 在 store 的连接读写事务中处理这张表，确保刷新同一 ID 时能力结果保留；新模型初始化为未测试，旧字段只形成待重测提示。重跑上述测试和 `pnpm typecheck`。
- [x] 提交 Task 2 的迁移和测试，提交信息 `feat: persist per-model capability results`。

### Task 3: 四类真实探测与错误分类

**Files:**
- Create: `apps/agent-runtime/src/model-connections/capability-probes.ts`
- Modify: `apps/agent-runtime/src/model-connections/provider-adapters.ts`
- Modify: `apps/agent-runtime/src/model-connections/service.ts`
- Test: `apps/agent-runtime/tests/model-connection-service.test.ts`
- Test: `apps/agent-runtime/tests/model-provider-adapters.test.ts`（如现有对应测试路径不同，以 `rg --files apps/agent-runtime/tests` 中的实际文件为准）

**Interfaces:** Produce `probeCapability(endpoint, modelId, capability, signal)` returning one `ModelCapabilityResultDto`; Runtime test methods return all attempted capability results for each model. The image adapter is chosen by the existing official Token Plan URL predicate, otherwise Images API.

- [x] 写失败服务测试：文本需非空内容；推理只接受显式推理证据；视觉用内置图片的预期回答；生图需有效图片字节；一个视觉失败不覆盖文本成功；限流与超时不记为 `unsupported`；音视频 ID 不触发 HTTP 模态探测；取消后不留下 `testing`。运行 `pnpm exec vitest run apps/agent-runtime/tests/model-connection-service.test.ts`。
- [x] 在探测模块实现明确的结果分类和超时信号，视觉使用固定小图及其可核验答案；不要在日志中输出图片 base64。核心分派形态：

```ts
switch (capability) {
  case 'text': return probeText(endpoint, modelId, signal)
  case 'reasoning': return probeReasoning(endpoint, modelId, signal)
  case 'vision': return probeVision(endpoint, modelId, signal)
  case 'image_generation': return probeImage(endpoint, modelId, signal)
}
```

- [x] `probeImage` 调用现有 Token Plan 或 Images API 适配器生成一张测试图，调用 `inspectImage(bytes)` 验证后丢弃。服务按候选能力逐项保存，测试重试仅更新该项；更新 Runtime 生图默认有效性与实际请求路由。重跑服务、适配器测试和 `pnpm typecheck`。
- [x] 提交 Task 3 的探测与测试，提交信息 `feat: probe text vision reasoning and image models`。

### Task 4: DTO、HTTP 与设置页

**Files:**
- Modify: `apps/agent-runtime/src/service/http-service.ts`
- Modify: `apps/desktop/src/main/model-connections/http-client.ts`
- Modify: `apps/desktop/src/preload/desktop-api.ts`
- Modify: `apps/desktop/src/renderer/src/services/runtime-model-http-api.ts`
- Modify: `apps/desktop/src/renderer/src/services/desktop-model-connections.ts`
- Modify: `apps/desktop/src/renderer/src/services/mock-model-connections.ts`
- Modify: `apps/desktop/src/renderer/src/models/model-connections.ts`
- Modify: `apps/desktop/src/renderer/src/models/add-model-set-state.ts`
- Create: `apps/desktop/src/renderer/src/components/settings/ModelCapabilityResults.tsx`
- Modify: `apps/desktop/src/renderer/src/components/AddModelSetDialog.tsx`
- Modify: `apps/desktop/src/renderer/src/components/settings/LibraryModelRow.tsx`
- Modify: `apps/desktop/src/renderer/src/components/settings/ManualModelRow.tsx`
- Modify: `apps/desktop/src/renderer/src/components/settings/ModelPickerRow.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/SettingsPage.tsx`
- Delete: `apps/desktop/src/renderer/src/components/settings/ModelKindFields.tsx`
- Test: `apps/agent-runtime/tests/service-http.test.ts`
- Test: `apps/desktop/src/renderer/src/pages/SettingsPage.test.tsx`
- Test: `apps/desktop/src/renderer/src/components/settings/settings-components.test.tsx`

**Interfaces:** Consume Task 1 `ModelTestResultDto` and Task 3 Runtime methods. UI test action has no kind or image API argument; setting a default image model remains the sole user choice.

- [x] 写失败 HTTP 与 UI 测试：同一模型四项状态往返、音视频仅标签且可作为不可调用记录保存、添加时无类型/API 控件、仅生图成功模型显示可用默认按钮、文本+生图双成功可保存。运行上述三个测试文件。
- [x] 修改 HTTP、preload、client、Mock 与本地状态机，保持模型测试逐项结果；移除 `setModelKind`、`setModelImageGenerationApi` UI 写入和 `imageModels` 测试参数。设置组件以 `ModelCapabilityResults` 显示状态、来源、时间与错误详情：

```tsx
<ModelCapabilityResults
  capabilities={model.capabilities}
  catalogLabels={model.catalogLabels}
  onTest={() => onTestModel(model.id)}
/>
```

- [x] 移除旧 `ModelKindFields.tsx` 及其使用点；保留模型行统一间距、图标大小和按钮状态。重跑 HTTP、设置、Mock、桌面客户端测试，以及 `pnpm typecheck` 和 `pnpm lint`。
- [x] 提交 Task 4 的设置与契约修改，提交信息 `feat: show per-capability model test results`。

### Task 5: 选择器、默认生图与严格视觉门槛

**Files:**
- Modify: `apps/desktop/src/renderer/src/models/model-selection.ts`
- Modify: `apps/desktop/src/renderer/src/components/model-selector/ModelSelector.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/agent-runtime/src/model-connections/service.ts`
- Modify: `apps/desktop/src/renderer/src/styles/agent.css`
- Test: `apps/desktop/src/renderer/src/components/model-selector/ModelSelector.test.tsx`
- Test: `apps/desktop/src/renderer/src/App.test.tsx`
- Test: `apps/agent-runtime/tests/model-connection-service.test.ts`

**Interfaces:** Chat eligibility is `enabled && capabilities.text.state === 'success'`; image submission additionally requires `capabilities.vision.state === 'success'`; image default requires `enabled && capabilities.image_generation.state === 'success'` and a tested route.

- [x] 写失败测试：文本成功且视觉不支持时纯文字可提交、图片提交被拒且文件和文字保持；视觉未测试、失败、无法判定也被拒；Runtime 直接收到含图消息时同样拒绝；双成功模型仍可被聊天和默认生图共同使用。运行上述测试文件。
- [x] 在桌面提交入口和 Runtime `requireRunnableModel` 双层校验多模态内容；桌面提示连接到模型设置的测试入口，拒绝时不要调用 `stageImages`：

```ts
const hasImage = imageFiles.length > 0
if (hasImage && model.capabilities.vision.state !== 'success') {
  showComposerError('当前模型的图片识别测试尚未通过，请到模型设置中测试')
  return
}
```

- [x] 更新聊天选择器与默认生图验证；默认模型被停用、删除或生图重测失效后不暴露生图工具。重跑三个测试文件及 `pnpm typecheck`。
- [x] 提交 Task 5 的选择与提交校验，提交信息 `feat: gate image messages on tested vision`。

### Task 6: 端到端验证、规范同步与归档

**Files:**
- Modify: `apps/desktop/e2e/support/fake-openai-tool-server.ts`
- Modify: `apps/desktop/e2e/tool-runtime.spec.ts`
- Modify: `openspec/specs/conversation-images/spec.md`
- Modify: `openspec/specs/model-connections-settings/spec.md`
- Modify: `openspec/changes/allow-image-attachments-for-chat-models/tasks.md`

**Interfaces:** No new API; verifies Tasks 1–5 and closes the OpenSpec change.

- [x] 扩展 fake provider：视觉成功、明确视觉拒绝、测试成功后实际请求拒绝、文本+生图都成功；E2E 断言图文布局、草稿保留、默认生图按钮、失败回复与历史恢复。运行 `pnpm exec playwright test apps/desktop/e2e/tool-runtime.spec.ts -g 'image|vision|model capability'`。
- [x] 运行 `openspec validate allow-image-attachments-for-chat-models --strict` 与 `pnpm check`，阅读完整输出；如本次修改造成失败，回到对应任务修复并复测。
- [x] 按 OpenSpec sync 流程将两个 delta 同步到主规范，然后归档变更；核对 `git diff --check` 和 `git status --short`，确认只包含本次批准范围。
- [x] 提交实现、测试、规范与归档文件到 `main`，记录提交哈希及验证命令的退出状态。
