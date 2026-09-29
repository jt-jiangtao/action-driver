## 1. 投影不可变与审批快照（执行型，D1）

- [x] 1.1 把 `stream-task-projection.ts` 中 `computer.app-approval.requested` / `resolved` 两处的 `this.task.pendingAppApproval = …` 改为对象替换
- [x] 1.2 在 `stream-task-projection.test.ts` 新增「replaces the approval list instead of editing an emitted snapshot」用例（深冻结发出的快照 + 审批请求/结果事件）

## 2. 生图工具共享常量（D7）

- [x] 2.1 在 `packages/contracts` 中导出 `IMAGE_GENERATION_TOOL_ID`、`isImageGenerationTool`、`imageGenerationSlotCount`、`hasImageGenerationGallery`、`isImageGenerationRunning`，并在 `packages/contracts/tests/unit/contracts.test.ts` 补包内测试
- [x] 2.2 让 `TaskPage`、`AgentResponse`、`ActivityTimeline`、`ImageGallery` 改为引用共享判定，删除四处重复字面量与两份状态白名单
- [x] 2.3 新增根级边界测试 `tests/unit/image-generation-tool-id.test.ts`：插件清单声明的工具 id 与契约常量一致，且 renderer/preload/shared 内不再出现该字面量。Runtime 侧仍有 5 处字面量（其中 `runtime-process.ts`、`stream/stream-snapshot.ts` 在其他回话的未提交改动中），本次未触碰，已记入 design 的已知缺口

## 3. 流式 Markdown 块级渲染（D2）

- [x] 3.1 新增 `components/markdown-blocks.ts`：按顶层 token 分组渲染、按块源缓存 HTML，导出 `markdownIt` 实例与缓存大小供测试观察
- [x] 3.2 `MarkdownContent` 改为渲染块列表（每块一个 `.markdown-block` 包装），`useScrollFade` 依赖从整段内容改为块数量；`agent.css` 补两条首/末子元素外边距规则以保持原有视觉
- [x] 3.3 新增 `markdown-blocks.test.ts`：7 组语料上分块 HTML 与整段渲染逐字相等、宽松列表不被拆成两个列表、重复块命中缓存、块键在追加时保持稳定
- [x] 3.4 改写 `TaskPage.render.test.tsx`：挂载后历史消息渲染 50 次、随后 50 个流式 tick 只新增 50 次尾部块渲染且历史文本不再进入渲染器

## 4. 展示归属单一决策点（D4）

- [x] 4.1 新增 `models/transcript.ts`：`selectTranscript` 返回当前轮次条目序列（历史轮次、用户消息、活动区、审批、助手消息、交付文件、失败提示），旧转录镜像布局是该模块内的显式分支；`models/message-media.ts` 的 `planMessageMedia` 决定助手消息的文本/画廊块
- [x] 4.2 `AgentResponse` 与 `ActivityTimeline` 退化为按已决定内容渲染（`ActivityTimeline` 新增必填 `items`，不再自行推导归属）；`TaskPage` 只遍历 `useTaskView(task)` 的条目
- [x] 4.3 新增 `models/transcript.test.ts`：条目顺序、活动归属、镜像布局、有序去重、失败态、审批与交付文件位置、历史轮次引用缓存、画廊锚定与待渲染批次

## 5. 流式期派生计算与订阅范围（D3）

- [x] 5.1 选择器以任务首条消息为键缓存已完成轮次的分组结果：流式 tick 只替换当前轮消息，历史分组与去重复用同一结果（`transcript.test.ts` 断言同一引用）
- [x] 5.2 抽出 `components/TaskComposer.tsx` 并 `memo`：只接收原始类型与稳定回调，提交适配器移到组件内部，使 378 行编辑器不在流式 tick 的渲染范围内（未改为直接订阅 store，理由见 design 实施记录）
- [x] 5.3 `TaskPage.render.test.tsx` 新增渲染计数：20 个流式 tick 后输入区仍只有挂载那一次渲染

## 6. Renderer 唯一事实源与适配器收敛（D5、D6）

- [x] 6.1 `RendererStreamClient` 确认为唯一定序去重事实源（已有「delivers each request event once for shuffled frames and duplicates」等用例覆盖乱序/重复/缺口），投影侧不再重复这份账本
- [x] 6.2 `StreamTaskProjection` 删除 `seenEventIds` / `lastSequence` / `lastCursor` 与对应守卫，只保留「attach 快照已覆盖的缓冲事件不再重放」这一条自身必要的过滤；投影测试改为断言只应用本任务/本消息的事件
- [x] 6.3 `DesktopAgentAdapter` 删除 `pendingStreamEvents`，改为在 `create()` 之前创建投影并把未命名任务的流事件缓冲在投影内；`tasks` map 降级为最近一次发出快照的缓存（投影是运行中任务的事实源）
- [x] 6.4 新增适配器用例「buffers live events inside the projection created before the task exists」，并跑通 services/pages/App 定向测试

## 7. 收尾验证与记录

- [x] 7.1 补齐 `docs/superpowers/specs/2026-09-30-stream-render-pipeline-design.md` 设计说明
- [x] 7.2 准备提交时一次性运行 `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test`，把命令、通过数、已知无关失败与 Node 版本写入提交信息与本文件
- [x] 7.3 只提交本变更相关文件（commit `53f5ae6`），并在交付说明中列出工作区中其他回话的未提交文件

## 8. 第二轮：删除旧转录镜像布局并收敛 Runtime 工具 id（用户追加裁决）

- [x] 8.1 删除 `isOrderedTranscript` 与 `legacyHidden`：`isActivityOwnedText` 只认 `phase: process`，`selectVisibleAssistantMessages` 不再有镜像分支；`TaskProjection.orderedTranscript` 死字段一并删除
- [x] 8.2 重新基线化被旧行为锁定的断言：`pages.test.tsx`（镜像领先正文）、`activity-mirror.test.ts`（无顺序转录）、`ActivityTimeline.test.tsx`（pending 文本归属与指示器）
- [x] 8.3 `packages/contracts` 新增 `isImageGenerationToolId`（含 `@version` 授权串），Runtime 五处字面量（`tool-activity.ts` ×2、`tool-invocation-service.ts`、`stream/stream-snapshot.ts`、`stream-session-service.ts`、`runtime-process.ts` 授权串 ×2）全部改为引用常量
- [x] 8.4 根级边界测试扩展到 `apps/agent-runtime/src`；跑 `corepack pnpm vitest run apps/desktop/tests/unit/renderer packages/contracts tests/unit/image-generation-tool-id.test.ts` → 422 通过

## 验证记录

Node 版本：默认 shell 的 **v20.14.0**（`node_modules` 中 `better-sqlite3` 按 Node 20 ABI 编译，故不使用 Node 24）。

- 定向测试（迭代期逐步运行）：`stream-task-projection` 32 通过、`desktop-agent-adapter` 17 通过、`renderer-stream-client` 6 通过、`markdown-blocks` 10 通过、`transcript` 8 通过、`TaskPage.render` 2 通过、`ActivityTimeline` 34 通过、`packages/contracts` 11 通过、根级边界测试 2 通过；随后一次性运行 `apps/desktop/tests/unit`：**509 通过 / 3 失败**。
- 提交前一次性全量：`corepack pnpm typecheck` 通过；`corepack pnpm lint` 因 `apps/desktop/src/renderer/src/main.tsx:1` 未使用的 `StrictMode` 报 1 个错误；`corepack pnpm test` 为 **2518 通过 / 11 失败 / 2 跳过**（419 个文件，7 个失败文件）。
- 已知且与本次改动无关的失败：
  - `packages/cua`、`packages/sky`、`packages/browser-runtime` 共 11 个用例，因 Node 20 缺少 `URL.parse`、`Promise.withResolvers` 以及 thirdparty 依赖的 ESM/CJS 差异而失败（与 delegation 中记录的既有环境失败一致）。
  - `apps/desktop/tests/unit/preload/desktop-api.test.ts` 与 `Sidebar.test.tsx` 的 3 个失败来自其他回话在插件贡献平台的未提交改动（`pluginContributions` 出现在 Preload API 面，`Sidebar.tsx` / `components/plugins/**` 为其新文件）。
  - `corepack pnpm lint` 的唯一错误同样来自其他回话的 `apps/desktop/src/renderer/src/main.tsx`，未代为修改以免把他人改动并入本次提交。
