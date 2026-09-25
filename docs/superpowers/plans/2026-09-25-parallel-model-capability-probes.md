# 模型能力并行测试与聊天候选开放 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 刷新时并行测试模型及各适用能力，逐项显示加载与二态结果；隐藏语音视频标签，允许未测试的已启用聊天候选发送并在对话中呈现真实错误。

**Architecture:** Runtime 负责目录候选、能力探测和结果持久化；Renderer 负责有界模型并发、逐项瞬时状态和二态展示。测试结果不再充当聊天或附图发送的前置门槛，但默认生图仍须验证成功。用户消息先进入任务，提供方错误使用现有任务失败投影在对话轮次显示。

**Tech Stack:** TypeScript、React、TanStack Query、Vitest、OpenSpec、Electron Runtime。

**Spec:** `openspec/changes/parallel-model-capability-probes/design.md`、`openspec/changes/parallel-model-capability-probes/specs/`。

## Global Constraints

- 同一连接最多 4 个模型并行；同一模型的适用能力项并行，当前最多 4 项。
- 语音与视频模型保留模型行，不测试，也不显示能力标签。
- 设置页终态只显示“成功”或“失败”，不展示测试错误原因；内部失败状态和原因保留。
- 已启用且支持聊天调用的候选即使未测试或测试失败也可选择，选择时不提示；纯生图、纯语音视频和已停用模型不进入聊天候选。
- 附图消息不依赖视觉测试结果；实际模型错误在该轮对话中显示。
- 默认生图模型继续要求已启用且生图测试成功；不改变真实生图探测和图片资产规则。
- 不增加依赖，不迁移数据库；`probeCandidates` 是非持久化的可选 DTO 字段。

## Review Focus

- 一项能力抛异常时，其他能力仍结束并保留自己的结果；该项显示“失败”。在 Task 1 中测试。
- 并行请求完成顺序反转时，模型 A 的写入不抹掉模型 B 的结果或启用状态。在 Task 1 中测试。
- 批量刷新时第五个模型必须等前四个之一结束才开始；总进度按完成数量增加。在 Task 3 中测试。
- 只有语音视频目录能力的行不显示能力标签，也不发探测请求。在 Task 2、Task 3 中测试。
- 未测试模型发送含图消息若提供方拒绝，用户图片及错误仍位于同一轮对话，草稿不会在选择阶段被阻止。在 Task 4 中测试。

---

### Task 1: Runtime 候选 DTO、双层探测和结果替换

**Files:**
- Modify: `packages/model-connections/src/types.ts`
- Modify: `apps/agent-runtime/src/model-connections/service.ts`
- Test: `apps/agent-runtime/tests/model-connection-service.test.ts`
- Test: `apps/desktop/src/renderer/src/services/desktop-model-connections.test.ts`

**Interfaces:** `ModelOptionDto.probeCandidates?: ModelCapability[]`；`list`、`discover`、`refresh` 返回当前目录候选，存储结构不变。`testModels` 最多 4 个模型并发；每个模型的 `probeCapability` 并行；`testConnectionModels` 用当前能力结果替换旧能力对象。

- [x] **Step 1: 写失败测试。** 构造 `qwen3.7-max` 两个可控 HTTP 探测 Promise，断言文本和推理在任何一个 resolve 前均已开始；构造 5 个模型，断言仅 4 个先启动；令某项抛错，断言其他项保留成功。测试复测 `wan2.7-image` 后不再保留旧 `text/vision`，并发两个已保存模型反序完成后结果都存在且中途停用不被恢复。
- [x] **Step 2: 运行 `pnpm vitest run apps/agent-runtime/tests/model-connection-service.test.ts apps/desktop/src/renderer/src/services/desktop-model-connections.test.ts`，确认新增断言失败。**
- [x] **Step 3: 加入 DTO 字段、Runtime 目录映射、四模型工作池和模型内 `Promise.allSettled`；把拒绝转为该能力 `failed` 结果，保留内部错误；复测写入前重读连接，并以本次能力对象替换旧对象。** 核心映射形态为 `Object.fromEntries(await Promise.all(candidates.probes.map(async capability => [capability, await probeCapability(...)])))`，异常分支按现有 `ModelCapabilityResultDto` 类型填充失败。
- [x] **Step 4: 重跑上述测试与 `pnpm typecheck`，确认通过。**

### Task 2: 设置页能力项加载、二态和音视频隐藏

**Files:**
- Modify: `apps/desktop/src/renderer/src/models/model-connections.ts`
- Modify: `apps/desktop/src/renderer/src/services/desktop-model-connections.ts`
- Modify: `apps/desktop/src/renderer/src/services/mock-model-connections.ts`
- Modify: `apps/desktop/src/renderer/src/components/settings/ModelCapabilityResults.tsx`
- Modify: `apps/desktop/src/renderer/src/components/settings/LibraryModelRow.tsx`
- Modify: `apps/desktop/src/renderer/src/components/settings/ModelPickerRow.tsx`
- Modify: `apps/desktop/src/renderer/src/components/settings/ManualModelRow.tsx`
- Test: `apps/desktop/src/renderer/src/components/settings/settings-components.test.tsx`
- Test: `apps/desktop/src/renderer/src/services/mock-model-connections.test.ts`

**Interfaces:** 组件接收 `probeCandidates` 和 `testing`；在测试中按候选显示各项“测试中”与 loading 图标；测试结束仅展示“成功”“失败”。无候选的语音视频模型不显示能力标签、测试按钮禁用或隐藏，但模型行保留。

- [x] **Step 1: 写失败测试。** `ModelCapabilityResults` 输入 `probeCandidates: ['text','vision']` 与 `testing: true` 时同时出现两项加载态；输入 `unsupported/inconclusive/failed` 时仅出现“失败”，DOM、title、aria 不含原因；音视频 `catalogLabels` 不生成标签，模型名称及启用开关仍可见；Mock 复测会清理旧键。
- [x] **Step 2: 运行 `pnpm vitest run apps/desktop/src/renderer/src/components/settings/settings-components.test.tsx apps/desktop/src/renderer/src/services/mock-model-connections.test.ts`，确认失败。**
- [x] **Step 3: 贯通 DTO 映射和 Mock 候选字段，统一能力 chip 尺寸、图标与间距；运行中逐项显示 loading，结束后映射二态；移除设置页测试错误的行内文字与 tooltip，保留内部错误；语音视频行不显示能力标签。**
- [x] **Step 4: 重跑上述测试及 `pnpm typecheck`，确认通过。**

### Task 3: 批量刷新与添加向导的并行反馈

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/SettingsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/components/AddModelSetDialog.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ModelConnectionCard.tsx`
- Test: `apps/desktop/src/renderer/src/pages/SettingsPage.test.tsx`
- Test: `apps/desktop/src/renderer/src/pages/AgentSettingsPages.test.tsx`

**Interfaces:** `onRefresh` 刷新后以最多四模型并发调用 `testConnectionModels(connectionId,[modelId])`；每个完成使 `done += 1`，最终一次从 Runtime 同步。向导 `testModels` 由 Runtime 以最多 4 个模型并行执行，向导按所有待测候选画加载态。

- [x] **Step 1: 写失败测试。** 用延迟 Promise 测 5 模型只启动 4 个、先完成的行立即更新并推动计数、第五个随后开始；单行失败不阻断批次且界面只显示失败；刷新重复点击与单项测试互斥；向导一键测试含语音视频模型时不对它们发请求。
- [x] **Step 2: 运行 `pnpm vitest run apps/desktop/src/renderer/src/pages/SettingsPage.test.tsx apps/desktop/src/renderer/src/pages/AgentSettingsPages.test.tsx`，确认失败。**
- [x] **Step 3: 用四工作者循环替换顺序 `for await`；通过 Query cache 按模型合并已完成结果，批次结束再同步；请求异常给该行本次候选能力显示失败而非旧结果，刷新发现错误只显示通用失败文案；向导按候选显示加载态并保留模型选择。**
- [x] **Step 4: 重跑上述测试及 `pnpm typecheck`，确认通过。**

### Task 4: 放开聊天候选并将真实调用错误放进对话

**Files:**
- Modify: `apps/desktop/src/renderer/src/models/model-selection.ts`
- Modify: `apps/desktop/src/renderer/src/components/model-selector/ModelOptionItem.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/agent-runtime/src/model-connections/service.ts`
- Test: `apps/desktop/src/renderer/src/components/model-selector/ModelSelector.test.tsx`
- Test: `apps/desktop/src/renderer/src/App.test.tsx`
- Test: `apps/agent-runtime/tests/model-connection-service.test.ts`
- Test: `apps/desktop/src/renderer/src/components/Conversation.test.tsx`

**Interfaces:** `toModelSelectionProjection` 按启用、协议和目录候选过滤；不以 `capabilities.text/vision` 结果禁用模型。`App` 不因视觉测试状态拦截附图。Runtime `requireRunnableModel` 只校验存在、启用、协议；任务失败继续由 `TaskPage` 的对话失败区域呈现实际错误。

- [x] **Step 1: 写失败测试。** 未测试及文本失败的已启用聊天候选在下拉列表可选、无原因提示；停用、纯生图、纯音视频或未接入协议不可选；附图发送调用 `submitGoal`；Runtime 未测试模型真正调用 transport；提供方拒绝后任务页保留用户消息并显示同轮失败。
- [x] **Step 2: 运行 `pnpm vitest run apps/desktop/src/renderer/src/components/model-selector/ModelSelector.test.tsx apps/desktop/src/renderer/src/App.test.tsx apps/agent-runtime/tests/model-connection-service.test.ts apps/desktop/src/renderer/src/components/Conversation.test.tsx`，确认失败。**
- [x] **Step 3: 实现候选过滤、去除选择提示、去除 App 视觉门槛与 Runtime 文本/视觉测试门槛；维持停用及协议拦截、默认生图验证逻辑，确保提供方错误落入任务失败投影。**
- [x] **Step 4: 重跑上述测试及 `pnpm typecheck`，确认通过。**

### Task 5: 集成验收、规范同步与归档

**Files:**
- Update: `openspec/specs/model-connections-settings/spec.md`
- Update: `openspec/specs/conversation-images/spec.md`
- Update: `openspec/specs/agent-task-experience/spec.md`
- Archive: `openspec/changes/parallel-model-capability-probes/`

- [x] **Step 1: 运行 `pnpm check`，确认类型检查、lint、单测及构建通过；运行 `openspec validate parallel-model-capability-probes --strict`。**
- [x] **Step 2: 逐条对照变更规范，检查所有已裁决场景；在可运行桌面环境验证批量 loading、结果文案、下拉选择和对话失败位置；必要时修复测试所揭示的行为偏差。**
- [x] **Step 3: 运行 OpenSpec 同步与归档流程，确认主规范包含本次行为并校验。** 三份主规范已同步且 `openspec validate --specs` 通过；`openspec validate --all --strict` 被未改动的历史变更 `replace-agentd-with-local-langgraph-runtime` 缺少旧场景挡住。
- [x] **Step 4: 检查 `git diff --check` 与工作区，提交本次变更到当前 `main`，向用户报告提交号及验证结果。**
