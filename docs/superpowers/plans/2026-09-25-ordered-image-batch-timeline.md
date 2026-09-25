# Ordered Image Batch Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让生图批次按调用顺序占据固定位置，使生图后的最终文字出现在图片下方，并在重连与历史中保持相同顺序。

**Architecture:** 在助手消息中持久化 `image-batch` 锚点，用 `response.image_batch` 事件把它投影到实时客户端。图片继续使用 `callId/index` 引用，仅填入锚点的固定插槽；终态仅替换最终文字，画廊按部件顺序渲染。

**Tech Stack:** TypeScript、Zod、SQLite、React、Vitest、OpenSpec。

**Spec:** `docs/superpowers/specs/2026-09-25-ordered-image-batches-design.md`；`openspec/changes/ordered-image-batch-timeline/`。

## Global Constraints

- 所有新增事件只传调用 ID、数量、索引和资产引用，不传提示词或图片字节。
- 单次 `image.generate` 仍支持 1–16 张，单次调用同时最多 4 个提供方请求。
- 用户上传图片气泡保持图片在文字上方；过程文字继续在可展开归档中。
- 旧消息不做破坏性迁移，按已持久化的部件顺序展示。

## Review Focus

- 批次锚点已到、图片尚未完成时刷新：恢复相同数量的占位卡。
- 两批图片完成顺序与调用顺序不同：批次位置及各批索引均不变。
- 工具失败或取消后没有返回图片：仅对应空插槽显示终态。
- 图片与批次事件重复回放：不增加第二个锚点或重复图片。
- 助手只有旧版文字与图片部件：按已保存的顺序展示，不依赖新事件。

---

### Task 1: Shared ordered parts and stream event

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/tests/contracts.test.ts`
- Modify: `packages/runtime-contracts/src/stream-protocol.ts`
- Modify: `packages/runtime-contracts/tests/stream-protocol.test.ts`

**Interfaces:**
- Produces: `MessageContentPart` 新分支 `{ kind: 'image-batch'; callId: string; imageCount: number }`。
- Produces: `response.image_batch` 事件 `{ callId; imageCount; contentIndex }`，沿用响应身份和请求内序号。
- Retains: `normalizeAssistantParts(parts): MessageContentPart[]`，但保留原有内容次序。

- [ ] **Step 1: 写失败测试。** 在合约测试中输入 `text('前')、batch A、image A:1、batch B、text('后')、image A:0、重复 A:1`，断言两个锚点和两个文字片段的相对次序不变，图片按调用与索引去重。在协议测试中解析合法 `response.image_batch`，并拒绝携带 `prompt` 或 base64 的载荷。

```ts
const parts = normalizeAssistantParts([
  { kind: 'text', text: '前' },
  { kind: 'image-batch', callId: 'a', imageCount: 2 },
  { kind: 'image', asset: second, generation: { callId: 'a', index: 1 } },
  { kind: 'image-batch', callId: 'b', imageCount: 1 },
  { kind: 'text', text: '后' },
  { kind: 'image', asset: first, generation: { callId: 'a', index: 0 } }
])
expect(parts.filter((part) => part.kind !== 'image')).toEqual([
  { kind: 'text', text: '前' },
  { kind: 'image-batch', callId: 'a', imageCount: 2 },
  { kind: 'image-batch', callId: 'b', imageCount: 1 },
  { kind: 'text', text: '后' }
])
```

- [ ] **Step 2: 运行失败测试。** `pnpm exec vitest run packages/contracts/tests/contracts.test.ts packages/runtime-contracts/tests/stream-protocol.test.ts`；预期缺少新分支或事件类型。
- [ ] **Step 3: 最小实现。** 扩展联合类型与 Zod 判别联合；归一化只合并相邻文字，按 `callId` 去重锚点、按 `callId:index` 去重图片。不要将独立批次或文字片段整体排序。
- [ ] **Step 4: 运行同一测试及 `pnpm typecheck`。** 确认新旧消息均可解析；类型检查暴露的穷尽分支随本任务修复。
- [ ] **Step 5: 提交。** `git add packages/contracts packages/runtime-contracts && git commit -m "feat: represent ordered image batch anchors"`。

### Task 2: Persist batch anchors before images

**Files:**
- Modify: `apps/agent-runtime/src/stream-session-service.ts`
- Modify: `apps/agent-runtime/tests/stream-session-service.test.ts`
- Modify as needed for the atomic write: `apps/agent-runtime/src/repositories.ts`、`apps/agent-runtime/src/ports.ts`

**Interfaces:**
- Consumes: Task 1 的 `image-batch` 部件和 `response.image_batch` 事件。
- Produces: 工具进入运行态后先发布批次事件、再发布该调用任何 `response.image`；助手消息与事件使用单个持久化事务。

- [ ] **Step 1: 写失败的多批 Runtime 测试。** 模拟两个生图调用各 2 张、资产按 `B:1、A:1、B:0、A:0` 到达、最后模型返回 `全部完成`。断言批次事件顺序为 A、B，图片只引用自己的调用和索引；快照的非图片部件顺序为 A、B、最终文字。另测在 A 运行但无图片时快照已有 A 锚点，以及存储失败不发布孤立事件。

```ts
expect(events.filter((event) => event.type === 'response.image_batch').map((event) => event.callId))
  .toEqual(['a', 'b'])
expect(snapshot?.messages.at(-1)?.parts?.filter((part) => part.kind !== 'image'))
  .toEqual([
    { kind: 'image-batch', callId: 'a', imageCount: 2 },
    { kind: 'image-batch', callId: 'b', imageCount: 2 },
    { kind: 'text', text: '全部完成' }
  ])
```

- [ ] **Step 2: 运行失败测试。** `pnpm exec vitest run apps/agent-runtime/tests/stream-session-service.test.ts`。
- [ ] **Step 3: 最小实现。** 在工具 `running` 记录回调里识别 `image.generate` 与合法 `imageCount`，向 `assistantParts` 追加唯一锚点，用 `commitAssistantContentWithEvent` 原子保存 `response.image_batch`；通过新增事件 cursor 发布已提交的工具及批次事件。图片事件只添加资产部件，文本 delta 写入当前文字片段并发送实际 `contentIndex`。结束时移除归档过程文字，仅在所有锚点与图片之后留下最终文字；取消和失败保留已提交内容。
- [ ] **Step 4: 运行 Runtime 测试、相关 repository 测试及 `pnpm typecheck`。** 核对请求序号、重放、快照和无图片字节。
- [ ] **Step 5: 提交。** `git add apps/agent-runtime && git commit -m "feat: persist ordered image batch starts"`。

### Task 3: Project ordered events in the desktop

**Files:**
- Modify: `apps/desktop/src/renderer/src/services/stream-task-projection.ts`
- Modify: `apps/desktop/src/renderer/src/services/stream-task-projection.test.ts`

**Interfaces:**
- Consumes: Task 1 的新事件和有序部件，以及 Task 2 的真实 `contentIndex`。
- Produces: `TaskProjection.messages[].parts` 在实时、终态与快照路径中的一致顺序。

- [ ] **Step 1: 写失败测试。** 从没有图片的助手消息开始，按批次 A、文字、批次 B、B 图片、A 图片、最终内容的事件顺序投影；断言锚点及文字位置稳定。重复 A 图片和批次事件不得重复；快照替换后继续收到图片仍填原批次。

```ts
expect(projection.snapshot()?.messages.at(-1)?.parts?.filter((part) => part.kind !== 'image'))
  .toEqual([
    { kind: 'image-batch', callId: 'a', imageCount: 2 },
    { kind: 'image-batch', callId: 'b', imageCount: 1 },
    { kind: 'text', text: '完成' }
  ])
```

- [ ] **Step 2: 运行失败测试。** `pnpm exec vitest run apps/desktop/src/renderer/src/services/stream-task-projection.test.ts`。
- [ ] **Step 3: 最小实现。** `response.image_batch` 依据 `contentIndex` 插入锚点；`response.content` 更新对应文字片段而非第一片；`response.image` 保留调用元数据；`response.end` 只校准最终文字且不重排图片。attach 和 snapshot 沿用保序归一化。
- [ ] **Step 4: 运行投影测试和 `pnpm typecheck`。** 覆盖重放、重复事件、完成、取消与旧快照。
- [ ] **Step 5: 提交。** `git add apps/desktop/src/renderer/src/services && git commit -m "feat: preserve image batch order in stream projection"`。

### Task 4: Render the timeline and verify compatibility

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/agent/AgentResponse.tsx`
- Modify: `apps/desktop/src/renderer/src/components/agent/ImageGallery.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Conversation.test.tsx`
- Modify if test demonstrates a need: `apps/desktop/src/renderer/src/styles/agent.css`

**Interfaces:**
- Consumes: 有序 `MessageContentPart[]`、`ToolInvocationProjection[]`、现有 `ImageReader`。
- Produces: 每个批次独立画廊，旧记录按已存顺序兜底；插槽样式和动画保持现有设计。

- [ ] **Step 1: 写失败组件测试。** 两批锚点 A、B 后有最终文字：断言 DOM 顺序为 A 画廊、B 画廊、文字，A 有 2 个槽、B 有 1 个槽。B 图片先到仍保持顺序；失败和取消仅改变相应空槽。无锚点旧消息按保存的文字与图片顺序显示；上传图片气泡维持图片在文字上方。

```ts
const children = [...view.container.querySelector('.agent-message')!.children]
expect(children.map((node) => node.classList.contains('image-gallery') ? 'gallery' : 'text'))
  .toEqual(['gallery', 'gallery', 'text'])
```

- [ ] **Step 2: 运行失败测试。** `pnpm exec vitest run apps/desktop/src/renderer/src/components/Conversation.test.tsx`。
- [ ] **Step 3: 最小实现。** `AgentResponse` 按部件顺序生成文字和批次块，按 `callId` 把图片引用交给单批 `ImageGallery`；旧图片连续段交给兜底画廊。画廊按输入索引建立插槽，只依赖对应调用状态；必要时小幅调整间距，不重做动画。
- [ ] **Step 4: 运行组件测试和 `pnpm typecheck`。** 确认 1、5、16 张样例及旧消息仍正确。
- [ ] **Step 5: 提交。** `git add apps/desktop/src/renderer/src/components apps/desktop/src/renderer/src/styles && git commit -m "feat: render ordered image galleries and text"`。

### Task 5: Integration, OpenSpec sync and archive

**Files:**
- Modify via OpenSpec sync/archive: `openspec/specs/conversation-images/spec.md`、`openspec/specs/runtime-event-recovery/spec.md`。
- Update: `openspec/changes/ordered-image-batch-timeline/tasks.md`。

**Interfaces:**
- Consumes: Tasks 1–4 的行为、测试与设计。
- Produces: 主规范与已验证代码一致，变更归档。

- [ ] **Step 1: 运行检查。** `pnpm typecheck`、`pnpm exec vitest run packages/contracts/tests/contracts.test.ts packages/runtime-contracts/tests/stream-protocol.test.ts apps/agent-runtime/tests/stream-session-service.test.ts apps/desktop/src/renderer/src/services/stream-task-projection.test.ts apps/desktop/src/renderer/src/components/Conversation.test.tsx`、`pnpm test`、`pnpm build`、`openspec validate ordered-image-batch-timeline --strict`；解决本变更造成的失败。
- [ ] **Step 2: 核对恢复与保密边界。** 使用测试快照确认锚点、资产引用及批次顺序一致，事件与快照不含图片字节或提示词；用 `git diff --check` 核对格式。
- [ ] **Step 3: 勾选 OpenSpec tasks，并同步及归档。** 按仓库 `openspec-sync-specs` 与 `openspec-archive-change` 流程操作，核对主规范与变更归档结果。
- [ ] **Step 4: 提交并报告。** 提交规范归档，报告根因、排序规则、测试结果和旧记录限制。
