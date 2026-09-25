# 所有模型实测文本推理视觉 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每个模型都真实测试文本、推理、视觉三项，不按模型名称跳过；生图探测与聊天用途规则继续独立工作。

**Architecture:** Runtime 固定三项探测候选并保留可选生图探测。聊天用途资格单独传到桌面，避免所有模型都有文本探测后误入聊天下拉列表。设置页、向导和批量刷新从同一候选集呈现逐项状态。

**Tech Stack:** TypeScript、React、Vitest、OpenSpec。

**Spec:** `openspec/changes/probe-core-capabilities-for-all-models/specs/model-connections-settings/spec.md`、`design.md`。

## Global Constraints

- 所有模型包括纯生图、音频、视频，都发起文本、推理、视觉三项测试；不发音频视频专项请求。
- 生图测试与默认生图验证沿用现有规则；最多四个模型并行，同模型能力并行。
- 设置页只显示逐项加载、成功或失败，不展示错误详情；内部仍记录失败。
- 批量启动后所有待测模型同时显示加载，包括排队中的模型；真实请求并发上限仍为四个模型。
- 已知纯生图、音频、视频仍不进入聊天选择器；未知聊天候选即使未测试也可选。

## Review Focus

- 图片模型三项请求失败时生图成功仍保留：Task 1 的 Runtime 测试覆盖。
- 音视频模型新增三项后仍不出现在聊天选择器：Task 2 的选择测试覆盖。
- 未知模型新增推理探测后仍可选为聊天：Task 2 的选择测试覆盖。
- 刷新对音视频模型实际发三项请求并显示状态：Task 3 的页面测试覆盖。
- 第五个模型排队时就显示三项加载，前四个请求之一完成后才发第五个请求：Task 3 的页面测试覆盖。
- 本轮重测替换旧能力结果而不丢失生图默认规则：Task 1 与 Task 3 的测试覆盖。

---

### Task 1: Runtime 三项探测

**Files:**
- Modify: `apps/agent-runtime/src/model-connections/model-capability-catalog.ts`
- Test: `apps/agent-runtime/tests/model-capability-catalog.test.ts`
- Test: `apps/agent-runtime/tests/model-connection-service.test.ts`

**Interfaces:** `capabilityCandidates(modelId, baseUrl).probes` 对每个模型都含 `text`、`reasoning`、`vision`；已适用的 `image_generation` 在三项之后。

- [ ] **Step 1: 写失败测试。** 对已知纯生图、音频、视频、文本模型和未知模型断言三项候选；在 Runtime 测试中用可控请求断言三个 `/chat/completions` 探测都发出。
- [ ] **Step 2: 运行 `pnpm exec vitest run apps/agent-runtime/tests/model-capability-catalog.test.ts apps/agent-runtime/tests/model-connection-service.test.ts`，确认旧代码的候选断言失败。**
- [ ] **Step 3: 实现固定三项候选。** 保留现有目录对生图接口与音视频专项显示的判断；固定探测集合可用 `const CORE = ['text', 'reasoning', 'vision'] as const`，生图附加在后。
- [ ] **Step 4: 重跑上述测试，确认三项独立结果和原生图结果均正确。**

### Task 2: 聊天用途与探测覆盖解耦

**Files:**
- Modify: `packages/model-connections/src/types.ts`
- Modify: `apps/agent-runtime/src/model-connections/service.ts`
- Modify: `apps/desktop/src/renderer/src/models/model-connections.ts`
- Modify: `apps/desktop/src/renderer/src/services/desktop-model-connections.ts`
- Modify: `apps/desktop/src/renderer/src/models/model-selection.ts`
- Modify: `apps/desktop/src/renderer/src/services/mock-model-connections.ts`
- Test: `apps/desktop/src/renderer/src/components/model-selector/ModelSelector.test.tsx`
- Test: `apps/agent-runtime/tests/model-connection-service.test.ts`

**Interfaces:** 模型 DTO 增加可选 `chatCandidate`；未传时沿用旧规则。Runtime 聊天调用使用相同用途资格而非三项探测候选。

- [ ] **Step 1: 写失败测试。** 纯生图和音视频模型即使有三项候选仍不可选或调用；已启用未知聊天模型即使未测试仍可选。
- [ ] **Step 2: 跑选择器和 Runtime 测试，确认新增断言在旧代码失败。**
- [ ] **Step 3: 在 Runtime 的 DTO 构造、桌面解码、Mock 与选择投影中贯通独立用途字段，改 `requireRunnableModel` 用该判断。**
- [ ] **Step 4: 重跑选择器、Runtime 和桌面服务测试。**

### Task 3: 页面反馈、集成与归档

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/settings/ModelCapabilityResults.tsx`（仅在测试揭示需要时）
- Modify: `apps/desktop/src/renderer/src/pages/SettingsPage.tsx`（仅在测试揭示需要时）
- Modify: `apps/desktop/src/renderer/src/components/AddModelSetDialog.tsx`（仅在测试揭示需要时）
- Test: `apps/desktop/src/renderer/src/pages/SettingsPage.test.tsx`
- Test: `apps/desktop/src/renderer/src/components/settings/settings-components.test.tsx`
- Test: `apps/desktop/src/renderer/src/pages/AgentSettingsPages.test.tsx`

**Interfaces:** 每行三项加载与终态；音视频专项标签仍隐藏，批量与向导不跳过这些模型。

- [ ] **Step 1: 写页面失败测试。** 音视频行显示三项，刷新和向导测试实际包含它们；五个模型一起进入测试中，但同时只发四个请求；结束只显示成功或失败。
- [ ] **Step 2: 跑页面测试确认旧行为不符，再做最小修改并重跑。**
- [ ] **Step 3: 运行 `pnpm check`、`openspec validate probe-core-capabilities-for-all-models --strict` 和 `git diff --check`。**
- [ ] **Step 4: 同步 `model-connections-settings` 主规范、归档变更并提交到 `main`。**
