# 单次生成最多十六张图片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 让 `image.generate` 一次可靠生成最多 16 张图片，每次调用并发最多 4 张，且对话画廊保持每张图片的固定位置。

**Architecture:** Runtime 用原始输入索引调度窗口为 4 的请求队列，持续把成功资产按索引发到现有事件流。流协议与快照传递 1–16 的 `imageCount`；桌面沿用当前画廊组件，仅扩大数量用例；系统 Imagegen Skill 告诉 Agent 超过 16 张时分次调用。

**Tech Stack:** TypeScript、Zod、Vitest、React、Electron、OpenSpec。

**Spec:** [书面设计](/Users/jiangtao/coding/action-driver/docs/superpowers/specs/2026-09-25-generate-more-than-four-images-design.md)；[OpenSpec 设计](/Users/jiangtao/coding/action-driver/openspec/changes/generate-up-to-sixteen-images/design.md)；[规范差量](/Users/jiangtao/coding/action-driver/openspec/changes/generate-up-to-sixteen-images/specs/conversation-images/spec.md)。

## Global Constraints

- 单次调用接受 1–16 个提示词，最多 4 个提供方请求同时执行；第 17 个在网络请求前拒绝。
- 每个提供方请求保留 120 秒默认超时；生图工具总超时 600 秒。
- 取消后不启动队列中的请求，不保存或发出新的资产；已成功资产继续保留。
- 不改变用户上传图片最多 4 张、提供方接口、会话资产目录及事件不传图片字节的约定。
- 多个工具调用之间没有全局并发限制；超过 16 张由 Imagegen Skill 指导 Agent 分次调用。

## Review Focus

- 第 17 个输入必须在网络前拒绝，测试由 Task 1 覆盖。
- 某个请求失败也必须释放并发窗口、启动下一项，测试由 Task 1 覆盖。
- 请求取消时即使活动 promise 尚未结束，也不得启动新请求或保存迟到资产，测试由 Task 1 覆盖。
- `imageCount` 为 16 的事件和快照必须可解析，用户上传 5 张仍拒绝，测试由 Task 2 覆盖。
- 5 和 16 张在流式、终态和重连后占位数量及顺序稳定，测试由 Task 3 覆盖。

---

### Task 1: 生图工具输入与并发队列

**Files:**
- Modify: `apps/agent-runtime/src/media/image-generation-tool.ts`
- Test: `apps/agent-runtime/tests/image-generation-tool.test.ts`

**Interfaces:**
- Consumes: `ToolCall.arguments.images` 数组、`ImageGenerationToolOptions.generate`、`AbortSignal`。
- Produces: 原有 `asset` 事件（含原始 `index`）和 `{ succeeded, failed }` 结果；工具定义新增上限 16、总超时 600 秒。

- [x] **Step 1: 写失败测试。** 将现有“第 5 张拒绝”改为第 17 张拒绝；增加 5、16 张可运行、16 张只有 4 个活动请求、失败补位、乱序索引、取消未启动队列及迟到资产不保存的用例。延迟请求可以沿用本文件 `deferred()`；关键断言示例：

```ts
const prompts = Array.from({ length: 16 }, (_, index) => String(index))
const iterator = tool.executor.execute(call(prompts))[Symbol.asyncIterator]()
const first = iterator.next()
await tick()
expect(generate).toHaveBeenCalledTimes(4)
jobs[2]!.resolve(new Uint8Array([2]))
expect((await first).value).toMatchObject({ kind: 'asset', index: 2 })
await tick()
expect(generate).toHaveBeenCalledTimes(5)
```

- [x] **Step 2: 运行红灯。** `pnpm exec vitest run apps/agent-runtime/tests/image-generation-tool.test.ts`；确认新增边界/队列测试因 4 张上限或一次全启动而失败。
- [x] **Step 3: 实现最小队列。** 工具 schema `maxItems: 16`、执行器校验 `images.length > 16`、`timeoutMs: 600_000`。保持 `nextIndex` 和最多 4 个活动 promise；每次 settled 后先补位，再持久化/发出结果。等待活动 promise 时响应取消信号；开始、补位、保存和 yield 前检查取消。核心结构：

```ts
let nextIndex = 0
const active = new Map<number, Promise<Settled>>()
const startNext = () => {
  if (signal?.aborted || nextIndex >= images.length) return
  const index = nextIndex++
  const prompt = (images[index] as { prompt: string }).prompt.trim()
  active.set(index, options.generate({ model, prompt }, signal)
    .then((bytes): Settled => ({ index, ok: true, bytes }))
    .catch((): Settled => ({ index, ok: false })))
}
for (let slot = 0; slot < Math.min(4, images.length); slot++) startNext()
while (active.size) {
  const settled = await waitForSettledOrAbort(active.values(), signal)
  active.delete(settled.index)
  startNext()
  // 保留现有的失败计数、saveGenerated 和 asset 事件逻辑。
}

function waitForSettledOrAbort<T>(promises: Iterable<Promise<T>>, signal?: AbortSignal): Promise<T> {
  const next = Promise.race(promises)
  if (!signal) return next
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('IMAGE_CANCELLED'))
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => { cleanup(); reject(signal.reason ?? new Error('IMAGE_CANCELLED')) }
    signal.addEventListener('abort', onAbort, { once: true })
    next.then((value) => { cleanup(); resolve(value) }, (error) => { cleanup(); reject(error) })
  })
}
```

- [x] **Step 4: 运行绿灯及相邻测试。** `pnpm exec vitest run apps/agent-runtime/tests/image-generation-tool.test.ts apps/agent-runtime/tests/tool-invocation-service.test.ts`；确认 4、5、16、17 张、失败补位、全部失败、取消和工具总超时的断言通过。
- [x] **Step 5: 提交可独立验证的工具变更。** `git add apps/agent-runtime/src/media/image-generation-tool.ts apps/agent-runtime/tests/image-generation-tool.test.ts`，随后 `git commit -m "feat: queue up to sixteen image requests"`。

### Task 2: 扩展数量事件与快照上限

**Files:**
- Modify: `packages/runtime-contracts/src/stream-protocol.ts`
- Modify: `apps/agent-runtime/src/tool-invocation-service.ts`
- Modify: `apps/agent-runtime/src/stream-session-service.ts`
- Test: `packages/runtime-contracts/tests/stream-protocol.test.ts`
- Test: `apps/agent-runtime/tests/tool-invocation-service.test.ts`
- Test: `apps/agent-runtime/tests/stream-session-service.test.ts`

**Interfaces:**
- Consumes: 已验证的 `images.length` 与持久化 `invocation.input`。
- Produces: 工具事件和快照中可选的 `imageCount`（1–16）；上传请求 `imageAssetIds` 仍最多 4。

- [x] **Step 1: 写失败协议与恢复测试。** 验证 16 的工具事件、快照能解析，17 的数量不能解析；5 张上传仍被拒绝；16 张调用的事件和重连快照都含 `imageCount: 16`，不把提示词加入新增数量字段。协议断言示例：

```ts
expect(parseStreamServerEvent({ ...toolEvent, imageCount: 16 })).toMatchObject({ imageCount: 16 })
expect(() => parseStreamServerEvent({ ...toolEvent, imageCount: 17 })).toThrow()
expect(() => parseStreamClientEvent({ ...requestEvent, payload: { ...requestEvent.payload,
  input: { content: '', role: 'user', imageAssetIds: ['a','b','c','d','e'] }
} })).toThrow()
```

- [x] **Step 2: 运行红灯。** `pnpm exec vitest run packages/runtime-contracts/tests/stream-protocol.test.ts apps/agent-runtime/tests/tool-invocation-service.test.ts apps/agent-runtime/tests/stream-session-service.test.ts`；确认 16 张事件或快照测试失败。
- [x] **Step 3: 修改三处上限。** 流协议中两处 `imageCount` Zod 上限改为 16；工具事件添加数量的条件与快照从持久化输入推算数量的条件改为 `<= 16`。保留 `imageAssetIds.max(4)` 和已有只传资产引用的逻辑。
- [x] **Step 4: 运行绿灯。** 重跑 Step 2 命令；检查普通工具事件不带 `imageCount`、旧 1–4 张事件可解析、16 张恢复仍按资产原索引展示。
- [x] **Step 5: 提交协议变更。** `git add packages/runtime-contracts/src/stream-protocol.ts packages/runtime-contracts/tests/stream-protocol.test.ts apps/agent-runtime/src/tool-invocation-service.ts apps/agent-runtime/src/stream-session-service.ts apps/agent-runtime/tests/tool-invocation-service.test.ts apps/agent-runtime/tests/stream-session-service.test.ts`，随后 `git commit -m "feat: stream sixteen image slots"`。

### Task 3: 多张画廊与 Imagegen 指导

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/Conversation.test.tsx`
- Modify only if test exposes a defect: `apps/desktop/src/renderer/src/components/agent/ImageGallery.tsx`、`apps/desktop/src/renderer/src/styles/agent.css`
- Modify: `apps/agent-runtime/resources/system-skills/imagegen/SKILL.md`
- Test: `apps/agent-runtime/tests/agent-file-store.test.ts`、`apps/desktop/src/renderer/src/services/stream-task-projection.test.ts`

**Interfaces:**
- Consumes: `ToolInvocationProjection.imageCount` 及 `MessageContentPart.generation.index`。
- Produces: 5–16 个固定插槽的既有画廊展示；Skill 主说明接受 1–16 张、超出分次调用。

- [x] **Step 1: 写画廊测试。** 用 5 张和 16 张工具投影渲染 `AgentResponse`，断言立即出现等量 `.image-gallery-slot`，乱序资产原位填充；终态缺失项显示失败或取消，文字始终在画廊前。检查两列/窄屏和 `prefers-reduced-motion` 规则。例：

```tsx
const tools = [{ ...baseTool, imageCount: 16, status: 'running' as const }]
const view = render(<AgentResponse message={{ id: 'a', role: 'agent', content: '生成中' }} tools={tools} generating />)
expect(view.container.querySelectorAll('.image-gallery-slot')).toHaveLength(16)
expect(view.container.querySelector('.agent-message')?.firstElementChild).toHaveTextContent('生成中')
```

- [x] **Step 2: 运行定向组件测试。** `pnpm exec vitest run apps/desktop/src/renderer/src/components/Conversation.test.tsx apps/desktop/src/renderer/src/services/stream-task-projection.test.ts`；如果现有画廊已满足全部断言，只保留测试变更，不为扩大上限重写组件。
- [x] **Step 3: 更新 Skill。** 将 `SKILL.md` 的 2–4 与 up-to-four 文案改为 1–16、同时最多 4 个请求、超过 16 张分次调用；只修改 ActionDriver 适配入口，原始 Codex 参考文件和 `LICENSE.txt` 不变。增加测试断言适配说明包含上限 16。
- [x] **Step 4: 验证随包文件。** `pnpm exec vitest run apps/agent-runtime/tests/agent-file-store.test.ts apps/desktop/src/renderer/src/components/Conversation.test.tsx`，再运行 `pnpm test:e2e:packaged:macos`，确认 Skill 资源和许可证仍随包存在。
- [ ] **Step 5: 提交展示与 Skill 变更。** 只暂存本任务实际修改文件，随后 `git commit -m "feat: show and guide larger image batches"`。

### Task 4: 全量验证与规范归档

**Files:**
- Modify after validation: `openspec/specs/conversation-images/spec.md`、`openspec/specs/instruction-skill-installation/spec.md`
- Archive: `openspec/changes/generate-up-to-sixteen-images/`

**Interfaces:** 已通过测试的工具、协议、画廊和 Skill；不新增运行时 API。

- [ ] **Step 1: 运行完整验证。** 依次运行 `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`openspec validate generate-up-to-sixteen-images --strict`、`git diff --check`。仅修复具体失败；若发现新的产品或架构决策，先更新 Battle 和规划。
- [ ] **Step 2: 同步主规范并归档。** 将两份 MODIFIED Requirement 的完整块同步到对应主规范，运行 `openspec validate --specs`；勾选已验证的 `tasks.md`，按仓库归档流程把变更移入 `openspec/changes/archive/`。
- [ ] **Step 3: 复核并提交。** `git diff --check`、`git status --short`、检查提交只含本变更文件；提交规范与归档并记录 commit SHA。不得声称跑过真实付费提供方，除非确实执行过。
