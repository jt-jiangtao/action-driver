# Slash Tool Identities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将全部工具稳定 ID 从点号层级改为斜杠层级，不保留旧 ID 或授权别名。

**Architecture:** 公共契约先校验斜杠工具 ID；插件声明、Runtime 授权和 Desktop 展示随后使用同一 ID。模型函数名保持下划线，其他贡献身份不变。旧数据库事实原样保留，不再用于执行旧调用。

**Tech Stack:** TypeScript、Zod、Vitest、Electron、OpenSpec。

**Spec:** `docs/superpowers/specs/2026-09-28-slash-tool-identities-design.md`；`openspec/changes/archive/2026-09-29-use-slash-tool-identities/`。

## Global Constraints

- 内置 ID：`tools/<local|cloud>/<plugin-id>/<operation-segment>[/...]`；版本键使用 `@<version>`。
- 第三方工具贡献 ID 使用斜杠分隔且不含点号；非工具贡献的身份规则不变。
- 模型函数名维持下划线；旧点号工具 ID、旧 grants、旧模型别名均不映射。
- 迭代期只运行定向测试；准备最终提交时按 `AGENTS.md` 一次性执行 `corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm test` 及必要 E2E。
- 工作区其他未跟踪文件不进入提交；不改历史数据库记录。

## Review Focus

- `tools/local/command/node/run@2` 与旧点号版本键同时出现时，旧键不能授权新工具；Task 2 测试。
- manifest 声明与 catalog 不一致时不得激活半套插件；Task 3 测试。
- 旧安装目录中的同版本内置包刷新后，私有数据仍在且新清单生效；Task 6 测试。
- 历史任务携带未知点号工具 ID 时，Renderer 通用展示不能尝试执行；Task 7 测试。
- Browser 与 Computer 的同一 CUA JS 模型名不变，同时授权仍按新 ID 隔离；Task 8 测试。

---

### Task 1: 公共身份语法

**Files:** `packages/plugin-contracts/src/tool-identity.ts`、`packages/plugin-contracts/src/index.ts`、`packages/plugin-contracts/src/tool.ts`、`packages/runtime-contracts/src/tool-protocol.ts`、`packages/plugin-sdk/src/index.ts`；测试 `packages/plugin-contracts/src/index.test.ts`、`packages/runtime-contracts/tests/tool-protocol.test.ts`。

**Interfaces:** `createToolIdentity(target, pluginId, operation)` 产生斜杠 `id`、斜杠 `capabilityId`、现有下划线 `modelName`；tool manifest、catalog 和 Runtime definition 共用安全斜杠工具 ID 校验。插件、Skill 等其他贡献保持原校验。

- [x] 写测试：生成 `tools/local/command/node/run`；接受 `fixture/read`；拒绝 `fixture.read`、空片段、路径穿越；模型名为 `tools_local_command_node_run`。执行上述两个 Vitest 文件，确认预期失败。
- [x] 实现最小契约变更并重跑上述文件，确认全部通过。

### Task 2: Registry 与 Policy Gate 去别名

**Files:** `apps/agent-runtime/src/tool-registry.ts`、`apps/agent-runtime/src/tool-policy.ts`、`apps/agent-runtime/src/tool-invocation-service.ts`、`apps/agent-runtime/src/plugins/composition.ts`、`packages/plugin-contracts/src/tool-identity.ts`；对应 `tool-registry.test.ts`、`tool-policy.test.ts` 与插件装配测试。

**Interfaces:** Registry 只索引声明的 `id@version` 与 `modelName`；Policy Gate 对当前定义和 grants 作直接比较。旧点号键与旧模型别名返回拒绝。

- [x] 先补斜杠键允许、点号键拒绝及版本隔离测试，运行相关 Vitest 文件观察失败。
- [x] 删除旧别名表和规范化调用，更新 Registry/Policy/装配，重跑同组测试至通过。

### Task 3: 内置工具插件声明

**Files:** `plugins/{command,web,skills,image-generation,computer-use,browser-use}` 的 `plugin.json`、catalog、presentation 与直接相关测试。

**Interfaces:** manifest 的 `onTool:`、contributions 与 catalog `id` 完全相同；模型名维持原值。

- [x] 先在各插件 catalog 测试断言斜杠工具 ID 与声明一致，定向运行并观察失败。
- [x] 同步替换工具 ID、presentation 键及激活条件；重跑各插件测试，确认无旧点号工具 ID 发布。

### Task 4: Runtime 工具调用与投影

**Files:** `apps/agent-runtime/src/{agent-graph,stream-session-service,tool-activity,runtime-process,repositories}.ts`、`apps/agent-runtime/src/plugins/{command-port,skill-port}.ts` 及直接相关测试。

**Interfaces:** 工具记录、事件和能力 grants 统一保存/比较新 ID；旧记录保持原文且不恢复执行。

- [x] 在调用、重载、特殊工具判断测试中引入斜杠 ID 和旧记录拒绝断言，运行对应定向 Vitest 观察失败。
- [x] 更新消费者与回退展示逻辑，重跑这些测试并验证新 ID 从授权贯通到持久化投影。

### Task 5: 插件 SDK 和脚手架

**Files:** `packages/create-actiondriver-plugin/src/generate.mjs`、`generate.test.ts`、`packages/plugin-sdk/src/index.ts`、`docs/plugin-development.md`。

**Interfaces:** 生成插件使用 `tools/local/<plugin>/echo` 与现有下划线模型名；点号工具贡献显式失败。

- [x] 补生成、安装、执行和旧点号拒绝测试，运行 `packages/create-actiondriver-plugin/src/generate.test.ts` 观察失败。
- [x] 更新模板和文档示例，重跑测试确认构建产物可装载调用。

### Task 6: 安装副本刷新与第三方旧包失败

**Files:** `apps/agent-runtime/src/plugins/filesystem-repository.test.ts`、`composition.test.ts` 及必要的插件装配代码。

**Interfaces:** 同版本内置包从新版源刷新已有安装目录，私有数据不删除；点号第三方包报 `INVALID_MANIFEST`，不能半激活。

- [x] 用旧目录夹具补启动与刷新测试，确认现有刷新机制已满足切换要求。
- [x] 只修复真实发现的安装或校验缺口；重跑并确认旧数据、清单、失败诊断符合设计。

### Task 7: Desktop 工具展示

**Files:** `apps/desktop/src/renderer/src/{services/computer-use-guidance.ts,pages/TaskPage.tsx,components/ActivityTimeline.tsx,components/agent/ToolGroup.tsx,components/agent/ImageGallery.tsx,components/agent/AgentResponse.tsx}` 及对应组件测试。

**Interfaces:** 新斜杠 ID 匹配 Browser、Computer、Web 与 Image Generation 专属显示；未知旧点号 ID 使用通用卡片。

- [x] 先写新 ID 和旧未知 ID 的组件断言，运行相关定向 Vitest 观察失败。
- [x] 更新判断及特殊展示，重跑相关组件测试确认通过。

### Task 8: 全工具链扫尾

**Files:** 前述代码中的剩余工具 ID 消费方、内置插件测试、Browser/Computer Runtime 定向测试。

**Interfaces:** 生产代码不残留旧点号工具 ID 常量或别名调用；非工具点号身份保持不变。

- [x] 对 `apps packages plugins scripts` 扫描 `tools\.local\.|tools\.cloud\.` 和别名 API；为发现的真实消费方补失败测试。
- [x] 逐项修正并运行 Browser、Computer、Command、Web、Skills、Image Generation 的相关定向测试，确认发现与授权一致。

### Task 9: 集成验证与提交

**Files:** `openspec/changes/archive/2026-09-29-use-slash-tool-identities/tasks.md`、本变更改动文件。

**Interfaces:** OpenSpec 任务状态反映实际完成情况；最终提交仅含本任务文件。

- [x] `openspec validate use-slash-tool-identities --strict`，检查全部 delta 通过。
- [x] 验证真实 Electron 工具调用链；使用与本改动直接相关的本地 E2E 用例定位问题。
- [x] 准备提交时一次性运行 `corepack pnpm typecheck`、`corepack pnpm lint`、`corepack pnpm test`，并按需要追加本地 E2E；阅读完整输出并记录结果。原始全量测试 2357 通过、36 失败、2 跳过；修正 11 项旧夹具后定向通过，其余 25 项环境或超时失败经定向复核通过。全量测试未重跑，因此未声称全量通过；详见 OpenSpec tasks 验证记录。
- [x] 检查 `git diff --check`、改动边界与未跟踪文件，只提交本变更相关内容。
