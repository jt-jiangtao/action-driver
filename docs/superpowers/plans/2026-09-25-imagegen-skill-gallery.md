# Imagegen 系统 Skill 与生图画廊实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 生图以 1–4 个稳定点阵卡片显示逐张进度，助手文字始终在生成图上方，并把完整且适配的 Codex Imagegen Skill 随包提供。

**Architecture:** 工具运行事件传递安全的张数；资产事件和持久化图片部件保留调用 ID 与索引。Runtime 与桌面投影共用助手内容归一规则，渲染器按插槽显示画廊。系统 Skill 走现有 `.system` 播种、保护和列表通道。

**Tech Stack:** TypeScript、React、Zod、Vitest、Electron、CSS、OpenSpec。

**Spec:** `openspec/changes/imagegen-system-skill-gallery/`；书面设计 `docs/superpowers/specs/2026-09-25-imagegen-skill-gallery-design.md`。

## Global Constraints

- 只实施已批准的 1–4 张并行展示、文字在前和 Imagegen Skill 适配；不新增模型接口或 Python 依赖。
- 事件和快照不得包含图片字节或原始提示词；新增字段对旧数据可选。
- 保留用户上传图片气泡既有布局。新设计决策出现时先按仓库 Battle 规则升级，不自行扩大范围。
- 每项先写能失败的行为测试，再改实现。每项完成后运行定向测试并复核 diff。

## Review Focus

- 完成、重连、历史记录是否都维持同一助手内容顺序。
- 四张乱序返回、重复事件、部分失败、取消与多次调用的插槽是否稳定。
- 系统 Skill 文件是否完整，默认执行路径是否真的指向 ActionDriver 工具。

---

## Task 1: 扩展生图进度与图片来源契约

**Files:** `packages/contracts/src/index.ts`、`packages/runtime-contracts/src/tool-protocol.ts`、`packages/runtime-contracts/src/stream-protocol.ts`、`apps/agent-runtime/src/tool-invocation-service.ts`、`apps/agent-runtime/src/stream-session-service.ts`、`apps/agent-runtime/src/local-runtime-server.ts`、`apps/agent-runtime/src/task-projection.ts`；测试在 `apps/agent-runtime/tests/tool-invocation-service.test.ts`、`apps/agent-runtime/tests/stream-session-service.test.ts` 及协议现有测试。

- [x] 1.1 写失败测试：`image.generate` 运行事件和快照含 1 或 4 的 `imageCount`；普通工具不含此字段；旧载荷仍可解析；资产与持久化图片有调用 ID、索引但没有提示词或字节。
- [x] 1.2 为 `ToolInvocationProjection` 和工具流基础事件加入可选 `imageCount`；仅从已校验的 `image.generate` 输入 `images.length` 计算，传到 Runtime 事件、投影及快照。
- [x] 1.3 为助手图片部件加入可选来源元数据，将 `tool.asset` 的调用 ID 与索引保存到 `response.image` 对应部件；保留旧消息解析。
- [x] 1.4 运行定向协议、工具调用和流服务测试，确认新增与旧数据用例通过；检查事件结构没有原始输入字段泄漏到新增进度元数据。

## Task 2: 统一助手文字与生成图顺序

**Files:** `apps/agent-runtime/src/stream-session-service.ts`、`apps/agent-runtime/src/task-projection.ts`、`apps/desktop/src/renderer/src/services/stream-task-projection.ts`、可复用的助手内容归一辅助模块；测试在 `apps/agent-runtime/tests/stream-session-service.test.ts`、`apps/desktop/src/renderer/src/services/stream-task-projection.test.ts`。

- [x] 2.1 写失败测试：文字→图片→文字的流、最终响应、四张乱序资产、重复资产、旧版图片在文字前、快照重连均显示文字在前；用户消息不变。
- [x] 2.2 实现统一归一函数，助手文字区置前，生成图片按调用 ID 与索引稳定排序；无来源元数据的旧图片保留彼此相对顺序。
- [x] 2.3 在 Runtime 最终持久化、桌面流式更新和历史投影处应用该规则，移除当前 `response.end` 的图片在前重排。
- [x] 2.4 运行流服务和投影定向测试，人工检查变更没有影响纯文字消息或用户上传图。

## Task 3: 实现固定插槽生图画廊

**Files:** `apps/desktop/src/renderer/src/components/agent/AgentResponse.tsx`、`apps/desktop/src/renderer/src/components/agent/ConversationImage.tsx`、新增画廊组件与组件测试、`apps/desktop/src/renderer/src/styles/agent.css`、必要的对话容器数据传递。

- [x] 3.1 写失败组件测试：1–4 个运行卡按 `imageCount` 立即出现；四张乱序成功在原插槽替换；多次调用独立成组；部分失败、取消保留成功图及准确状态。
- [x] 3.2 将任务工具进度与助手消息关联到画廊；卡片内部沿用 `ConversationImage` 的读取、放大和保存，缺失文件使用已有可理解状态。
- [x] 3.3 实现浅灰大圆角点阵卡、最多两列与窄屏单列、低幅度动画和 `prefers-reduced-motion` 关闭动画；文字区域固定在画廊上方。
- [x] 3.4 运行组件测试与现有图片消息测试，检查开始、逐张完成和结束时卡片不移动，用户气泡仍为 104×104。

## Task 4: 完整复制并适配 Imagegen Skill

**Files:** 来源 `/Users/jiangtao/.codex/skills/.system/imagegen/`；目标 `apps/agent-runtime/resources/system-skills/imagegen/`；`apps/agent-runtime/src/agent-files/agent-file-store.ts`、`apps/agent-runtime/src/agent-files/skill-installer.ts`、`apps/desktop/src/main/index.ts`、`apps/desktop/src/renderer/src/services/mock-agent-files.ts`、`scripts/test-packaged-macos.mjs`；相关测试 `apps/agent-runtime/tests/agent-file-store.test.ts`、`apps/agent-runtime/tests/skill-installer.test.ts`。

- [x] 4.1 列出来源全部文件并完整复制，包括 `SKILL.md`、`references/`、`scripts/`、`assets/`、`agents/`、`LICENSE.txt`；逐文件比对清单与许可证。
- [x] 4.2 修改 Skill 主说明及必要入口元数据：默认通过现有 `image.generate` 一次传入 1–4 条提示词；原 CLI 只列为参考，不自动安装依赖或绕过默认模型配置。
- [x] 4.3 写失败测试并加入系统 ID、初始化播种、只读保护、设置列表识别；验证新用户与已有用户升级后都可列出、启停但不可编辑或卸载。
- [x] 4.4 更新 macOS 包校验以检查完整 Imagegen 文件树，运行 Skill 测试和打包资源检查。

## Task 5: 集成验证与交付

- [x] 5.1 运行 `pnpm typecheck`、`pnpm lint`、定向 Vitest、`pnpm build` 和 `openspec validate imagegen-system-skill-gallery --strict`；仅修复真实失败。
- [x] 5.2 在本地对话验证 4 张乱序完成、部分失败、取消、历史重开、减少动态效果和图片放大保存；记录可复现结果。
- [x] 5.3 复核 `git diff --check`、OpenSpec 任务完成标记及最终 diff，按仓库流程同步规范、归档并提交已验证变更。

## 验证记录

- 2026-09-25：`pnpm test` 通过（786 passed，2 skipped）；`pnpm lint`、`pnpm typecheck`、`pnpm build`、`openspec validate imagegen-system-skill-gallery --strict`、`openspec validate --specs`、`git diff --check` 均通过。
- `pnpm test:e2e:packaged:macos` 通过（1 passed），随包 Imagegen 文件树及许可证校验通过。
- 本地对话投影与组件用例覆盖 4 张乱序完成、部分失败、取消、快照及旧历史记录、减少动态效果规则和现有图片交互；未调用付费生图提供方。
