# Codex CUA 重建基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 若用户选择委派执行，则使用 superpowers:subagent-driven-development。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 固定四个原包基准，建立独立实现包与可验证的差异框架，为逐模块还原提供可复现输入和证据。

**Architecture:** 原始 vendor 作为基准，只读；packages 下四个实现包前期不接入 agent-runtime，cua-parity 单独启动基准与候选进程。阅读副本位于 analysis/codex-cua；清点完成后分别制定 sky、cua、cua-repl、browser 的模块还原计划，最终整体验收后统一替换。

**Tech Stack:** Node.js ESM、TypeScript 5.9.3、Vitest 3.2.7、Prettier 3.7.4、pnpm workspace；不新增依赖。

**Spec:** [设计](../../../openspec/changes/reconstruct-codex-cua-packages/design.md)、[规范](../../../openspec/changes/reconstruct-codex-cua-packages/specs/codex-cua-reconstruction/spec.md)。

## Global Constraints

- packages/cua、sky、cua-repl、browser-runtime、cua-parity，使用 @actiondriver/*。
- 原始 vendor 不重写；analysis/codex-cua 不作为产品构建输入。
- 前期仅差异 runner 引用新实现，禁止改 agent-runtime 默认依赖、生产 loader 与打包接线。
- 固定基准内每个自有 lib、JS 模块、类型与接口均属于自主实现范围；先分析用途与行为契约，不要求逐语句翻译；第三方依赖核实后直接在使用方 package.json 声明确切版本并由 pnpm-lock.yaml 固定，不使用 ^、~ 或 latest，不重写；未复制原生二进制不计入范围。
- 没有 source map，不宣称恢复原作者源码文本；未验证平台和不可用真实路径明确记录。
- 同一输入在独立进程中执行；真实操作分别重置夹具，不在用户当前页面上连续执行两份副作用。
- 每项只运行定向测试；准备提交才运行一次 pnpm typecheck、pnpm lint、pnpm test，按改动追加必要 E2E。无关脏文件不提交。
- 执行前检查当前工作区；如需隔离使用 native worktree 工具，不自动复制或覆盖别人的未提交文件。

## Review Focus

1. vendor 同步改变文件、增删文件或符号链接 → Task 1 验证基准漂移拒绝。
2. 压缩 bundle 没有可靠模块边界、重复路径内容不同 → Task 2 记录 unknown，不按名字合并。
3. 候选子进程挂起、崩溃或 stdout 混入日志 → Task 4 明确失败，释放进程，不伪造结果。
4. 归一化隐藏未知字段或错误 → Task 5 默认保留，明确差异失败。
5. 候选缺少导出、误引原包或生产提前切换 → Task 3/6 标明未实现并验证接线与来源。

## File Structure

- packages/cua-parity/src/types.ts：基准、用例、输出与差异的共享类型。
- packages/cua-parity/src/baseline.ts：遍历、哈希及漂移核验。
- packages/cua-parity/src/inventory.ts：文件分类、内容重复及引用/导出证据。
- packages/cua-parity/src/readable.ts：只生成阅读副本与原文件映射。
- packages/cua-parity/src/runner.ts、worker.mjs：进程启动、输入协议、结果协议、退出与清理。
- packages/cua-parity/src/compare.ts：显式字段归一化与结构差异。
- packages/cua-parity/src/report.ts：保留原始输出、差异和复现参数。
- packages/cua-parity/src/cli.ts：显式 capture、verify、inventory、readable、compare 命令；捕获与核验不得隐式互换。
- packages/cua-parity/tests/*.test.ts：Node 环境定向测试，文件首行使用 Vitest @vitest-environment node；不加载真实页面副作用。
- packages/cua-parity/fixtures/：受控原包与候选测试模块；不得借假模块宣称原包已经对齐。
- packages/{cua,sky,cua-repl,browser-runtime}/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts,docs/source-mapping.md}：独立构建边界和还原状态。
- analysis/codex-cua/{baseline.json,inventory.json,source-index.json,readable/}：生成资料，记录输入哈希与工具版本。

## Shared Interfaces

所有类型在 types.ts 定义，其他任务直接复用：

```ts
type FileRecord =
  | { path: string; kind: 'file'; sha256: string; bytes: number; mode: number }
  | { path: string; kind: 'symlink'; target: string }
  | { path: string; kind: 'directory' };
interface Baseline {
  schemaVersion: 1;
  packages: Record<string, { version: string | null; entry: string }>;
  files: FileRecord[];
}
interface Drift { path: string; reason: 'added' | 'removed' | 'changed' }
interface InventoryItem {
  path: string;
  classification: 'first-party' | 'third-party' | 'resource' | 'unknown';
  evidence: string[];
  imports: string[];
  exports: string[];
  duplicateOf: string | null;
}
interface CaseSpec {
  id: string;
  scenarioModule: string;
  input: unknown;
  timeoutMs: number;
}
interface Trace { kind: 'call' | 'event' | 'cleanup'; name: string; payload: unknown }
interface Outcome {
  status: 'returned' | 'threw' | 'timeout' | 'crashed' | 'protocol-error';
  value: unknown;
  error: { name: string; message: string; code: string | null } | null;
  trace: Trace[];
  stdout: string;
  stderr: string;
}
interface Difference { path: string; expected: unknown; actual: unknown }
interface NormalizationRule { path: string; reason: string }
```

`scenarioModule` 为受信本地夹具，导出 `run({ targetEntry, input, emit }): Promise<unknown>`，emit 接收 Trace。用例返回值、错误和 trace 必须为明确 JSON 可编码对象，undefined、NaN、BigInt、二进制等由具体夹具显式编码，框架不得默默 JSON 丢弃；测试此类输入返回 protocol-error。不要发明通用对象图等价算法。

### Task 1: 基准快照与漂移拒绝

**Files:** src/types.ts、baseline.ts、cli.ts；package.json、tsconfig.json、tsconfig.build.json；tests/baseline.test.ts（均位于 packages/cua-parity）。

**Interfaces:** `captureBaseline(root: string): Promise<Baseline>`；`verifyBaseline(root: string, baseline: Baseline): Promise<Drift[]>`。

- [ ] Step 1: 测试相同目录 verify 返回 []；修改字节、增删文件、改变符号链接或文件权限返回对应 path，枚举结果按路径排序，捕获不修改输入文件。
- [ ] Step 2: 运行 `pnpm vitest run packages/cua-parity/tests/baseline.test.ts`，确认因接口未实现失败。
- [ ] Step 3: 用 fs/promises 和 node:crypto 实现，lstat 不跟随符号链接；遍历完整 vendor，不能排除 node_modules 或 dist。记录 browser 无独立 package.json，version 为 null，入口取真实嵌套路径。
- [ ] Step 4: 同一命令通过；执行 capture 并 verify 实际 vendor，交付 baseline.json。CLI verify 漂移非零退出，capture 只显式执行，不由 verify 触发。

### Task 2: 每个自有 lib 的用途、接口分析与阅读副本

**Files:** src/inventory.ts、readable.ts；tests/inventory.test.ts、readable.test.ts；analysis/codex-cua 生成资料。

**Interfaces:** `inventory(root: string, baseline: Baseline): Promise<InventoryItem[]>`；`generateReadable(root: string, output: string, baseline: Baseline): Promise<void>`。

- [ ] Step 1: 测试捆绑第三方按 package.json 与许可证证据归类；同名不同哈希不合并；无可靠证据为 unknown；不声明正则结果是完整语法分析。
- [ ] Step 2: 测试格式化不修改 vendor、输出路径保持原相对路径；路径包含 ..、输出目录落入输入目录或链接逃逸时拒绝。
- [ ] Step 3: 运行 `pnpm vitest run packages/cua-parity/tests/inventory.test.ts packages/cua-parity/tests/readable.test.ts`，确认预期失败；实现后同命令通过。
- [ ] Step 4: 使用已有 TypeScript 编译器 API 分析 JS 静态引用和导出，动态计算导入及 bundle 未识别边界标 unknown；Prettier 只生成阅读副本。JSON、文档、二进制不伪装为 TS。
- [ ] Step 5: 生成实际 inventory 与 source-index，核验每个 baseline 文件有记录；人工检查全部自有 core/types/cua/cua-repl/browser/sky 库，为每项记录用途、参数、返回、错误、状态、副作用、依赖和证据；类型库安排编译期契约验证；检查 browser 三个入口和 api.json，并列出仍需分析的 bundle 边界，不把清点完成误报为源码完成。

### Task 3: 四个独立实现包

**Files:** File Structure 中列出的四个包文件；packages/cua-parity/tests/workspace-boundary.test.ts。

**Interfaces:** 包名 @actiondriver/cua、sky、cua-repl、browser-runtime；`build`、`typecheck`；暂不承诺源码清点之前尚未知的导出接口。

- [ ] Step 1: 写 workspace-boundary 测试，四包 private=true、名称正确、独立 build/typecheck 可用、不依赖 @oai、不依赖 vendor 路径；agent-runtime/package.json 不引用候选包。
- [ ] Step 2: 运行 `pnpm vitest run packages/cua-parity/tests/workspace-boundary.test.ts`，确认缺包失败。
- [ ] Step 3: 沿用 plugin-sdk 的 tsconfig 分层，Node ESM 输出的相对导入使用 .js；入口空导出只标为 scaffold，不冒充功能实现；mapping 文档标明模块未还原。
- [ ] Step 4: 同一定向测试通过；对五个包分别运行 `pnpm --filter @actiondriver/<包名> build` 和 typecheck。第三方依赖按清点的确切版本引入，不复制 vendor/node_modules；版本不可获取或定制补丁差异明确报告。依赖安装只更新本次 workspace 所需项，不升级其他依赖；四包不接入产品。

### Task 4: 独立进程 runner

**Files:** src/runner.ts、worker.mjs；fixtures/{return,throw,hang,crash,invalid-output}.mjs；tests/runner.test.ts。

**Interfaces:** `runCase(targetEntry: string, spec: CaseSpec): Promise<Outcome>`；worker 输入通过 IPC，日志走 stdout/stderr，结果通过 IPC，二者不混用。

- [ ] Step 1: 测试两个实例独立计数均从 1 开始，日志不破坏结果；抛错记录 name/message/code；hang 按 timeoutMs 失败；crash 和非法协议失败；退出后无遗留 worker。
- [ ] Step 2: 运行 `pnpm vitest run packages/cua-parity/tests/runner.test.ts`，确认未实现失败。
- [ ] Step 3: 使用 child_process.fork 启动 worker，受信 scenarioModule 调用 targetEntry；记录 trace 与错误；结束时终止 worker，依赖子进程只能由经过审查的夹具明确创建并清理。先测试普通模块，不直接启动真实浏览器或原生服务。
- [ ] Step 4: 同一定向测试通过；报告若原包无法在当前协议条件加载，不能退回用假实现宣称原包通过。

### Task 5: 差异比较与报告

**Files:** src/compare.ts、report.ts；tests/compare.test.ts、report.test.ts。

**Interfaces:** `compareOutcomes(reference: Outcome, candidate: Outcome, rules: NormalizationRule[]): Difference[]`；`writeReport(output: string, data: { baseline: Baseline; spec: CaseSpec; reference: Outcome; candidate: Outcome; differences: Difference[]; rules: NormalizationRule[] }): Promise<void>`。

- [ ] Step 1: 测试不同返回值、错误 code、事件顺序和 cleanup trace 均产生 Difference；只允许显式精确字段路径归一化，不支持通配符；空理由或不存在路径拒绝，不自动忽略随机 ID。
- [ ] Step 2: 测试报告包含两份未经归一化的原始 Outcome、输入、基准和规则；结果不可 JSON 编码时明确失败，不产生通过报告。
- [ ] Step 3: 运行 `pnpm vitest run packages/cua-parity/tests/compare.test.ts packages/cua-parity/tests/report.test.ts`，确认失败后实现，再运行通过。
- [ ] Step 4: 用已知相同夹具得到零差异，故意修改调用顺序得到非零退出和差异报告。此证据只证明框架能检测偏差，不代表四个包已还原。

### Task 6: 基础交付与后续模块计划

**Files:** packages/cua-parity/docs/foundation-report.md；docs/superpowers/plans 下各包模块计划；同一 OpenSpec tasks.md 的模块任务细化。

**Interfaces:** 消费 Task 1–5 输出；后续模块计划逐条定义原文件、目标 src 路径、导出、依赖、差异用例、执行顺序和状态，不定义未经清点的假模块。

- [ ] Step 1: 核验基准无漂移、inventory 全覆盖、五包独立构建、框架定向测试通过；交付框架报告和 unknown 列表。
- [ ] Step 2: 审查 agent-runtime 依赖、codex-module-loader.mjs、codex-service-host.mjs 及 stage-runtimes/stage 插件路径未接入候选；新增包不得从原包转导出假装重建。
- [ ] Step 3: 将 sky、cua、cua-repl、browser 拆成独立计划；每个原始自有 lib、模块及类型必须有接口与用途说明、自主实现任务或明确的重复模块映射；第三方库只安排来源核实、复用及集成验证任务。依赖顺序由清点证据确定，不能先验假设 browser 最后。
- [ ] Step 4: 为后续整体验收保留接口、成功/失败、跨包、真实操作和可复现构建矩阵；真实原包加载阻塞列为阻塞，不能移除要求。整体切换计划只在全部完成后编写。
- [ ] Step 5: `openspec validate reconstruct-codex-cua-packages --strict` 与定向差异检查通过；只在准备提交时运行仓库规定全量验证一次，提交只包含本任务。更新 OpenSpec 完成项时不得勾选“全部源码重建”或“整体验收”。

## Completion and Handoff

本计划仅交付清点、独立包边界与对比基础设施。四个包还原、跨包和真实场景验收、统一替换仍按原 OpenSpec 要求完成，不能以本阶段通过代替。模块清点发现系统边界、第三方归属或平台范围变化时，暂停相关写操作，先完成 Battle 与规划更新。

## Self-Review

已将基准漂移、未识别模块、进程故障、差异隐藏与提前替换对应到 Task 1–6。共享类型统一由 types.ts 定义。复杂模块还原无法在未清点前准确细化，因此明确由 Task 6 产出后续独立计划，未承诺当前基础计划已覆盖所有源码实现。
