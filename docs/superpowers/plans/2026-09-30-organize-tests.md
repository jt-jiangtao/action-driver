# 按项目整理测试目录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将一方测试迁到所属项目的 `tests/unit/`、`tests/e2e/`，保持测试发现和行为不变。

**Architecture:** 建立确定的旧路径到新路径映射，以所属项目为边界移动测试；同步修正相对导入、配置、脚本和交互契约。迁移只改变文件位置与路径引用，现有测试本身作为行为契约。

**Tech Stack:** pnpm、Vitest、Playwright、TypeScript、Node.js。

**Spec:** `docs/superpowers/specs/2026-09-30-organize-tests-design.md`；OpenSpec：`openspec/changes/organize-tests-by-project/`。

## Global Constraints

- 仅移动本仓库一方测试；`thirdparty/`、vendored 源码和开发技能测试保持原样。
- `src/foo/bar.test.ts` 映射为所属项目的 `tests/unit/foo/bar.test.ts`；已有 `tests/foo.test.ts` 映射为 `tests/unit/foo.test.ts`。
- `scripts/foo.test.mjs` 映射为根 `tests/unit/scripts/foo.test.mjs`；桌面端 `e2e/**` 映射为 `tests/e2e/**`。
- 保留断言与产品逻辑；`tests/setup.ts` 等根级测试基础设施可留原位。
- 保护 `apps/desktop/src/renderer/src/main.tsx` 中已存在的无关工作区修改；提交只包含本任务文件。
- 迭代期只运行相关定向测试；准备提交时才一次性执行仓库规定的完整验证。此迁移完成前不做中间提交。

## Review Focus

- 迁移源与目标同名：Task 1 检查目标路径唯一性，发生冲突时保留更多原目录层级。
- 测试内相对导入：Task 2 的代表性定向测试和 Task 4 的 typecheck 检查所有权边界变化。
- `src` 测试被漏移：Task 1 和 Task 4 比较清单，并检查一方 `src/` 没有测试文件。
- E2E 支持模块与快照路径：Task 3 用 Playwright `--list` 及定向 E2E 验证新 testDir。
- 交互契约 `testFile` 悬空：Task 3 运行 `pnpm validate:e2e-interactions`，逐项检查文件存在。

---

### Task 1: 建立迁移映射和基线

**Files:**
- Read: `apps/**`、`packages/**`、`plugins/**`、`scripts/**`、根 `tests/**` 中的 `*.test.{ts,tsx,mjs}` 和桌面端 `e2e/**`
- Record: `openspec/changes/organize-tests-by-project/tasks.md` 的验收进度与清单结果

**Interfaces:**
- Produces: 一份每个一方测试源路径到目标路径的确定映射，供后续任务使用。

- [ ] **Step 1:** 用 `rg --files apps packages plugins scripts tests -g '*.test.ts' -g '*.test.tsx' -g '*.test.mjs' -g '*.spec.ts' -g '*.spec.tsx'` 记录基线，并排除第三方/vendored 文件；预期能为每个一方文件确定唯一目标。
- [ ] **Step 2:** 对映射目标排序查重，确认不存在覆盖；若同名，保留更多源目录层级，并在 OpenSpec 记录映射。
- [ ] **Step 3:** 记录 `pnpm exec vitest list --json` 和 `pnpm exec playwright test --list` 的基线发现集合；仅做收集，不运行全量测试。

### Task 2: 迁移单元测试与导入

**Files:**
- Move: `apps/*/src/**/*.test.{ts,tsx}`、`packages/*/src/**/*.test.{ts,tsx}`、`plugins/*/src/**/*.test.{ts,tsx}` → 各项目 `tests/unit/**`
- Move: 各项目现有 `tests/**/*.test.{ts,tsx}` → 其 `tests/unit/**`
- Move: `scripts/**/*.test.{ts,mjs}` → 根 `tests/unit/scripts/**`；根 `tests/*.test.ts` → 根 `tests/unit/**`
- Modify: 被移动测试及引用它们的文件中的相对导入；必要的项目 `tsconfig.json`、包级测试配置与 `packages/create-actiondriver-plugin/package.json`

**Interfaces:**
- Consumes: Task 1 的路径映射。
- Produces: 位于所属 `tests/unit/` 的单元测试，保持原断言。

- [ ] **Step 1:** 按映射移动文件，修正相对导入；用 `git diff --find-renames --stat` 检查内容变化主要为路径引用。
- [ ] **Step 2:** 检查项目 tsconfig 和包级 Vitest 配置的 include/exclude；更新生成器自测脚本等直接引用旧测试路径的入口。
- [ ] **Step 3:** 对桌面端、agent-runtime、脚本、包和插件各运行至少一个迁移后定向测试，例如 `pnpm vitest run <新测试路径>`；预期所选测试通过，失败则先修正路径。

### Task 3: 迁移桌面端 E2E 与契约

**Files:**
- Move: `apps/desktop/e2e/**` → `apps/desktop/tests/e2e/**`
- Modify: `playwright.config.ts`、`package.json`、`scripts/test-packaged-macos.mjs`、`scripts/validate-e2e-interactions.mjs`、`scripts/e2e-interactions/contracts.mjs`、迁移后的 `interaction-contracts.json`
- Modify: 直接引用旧 E2E 或单元测试路径的文档、E2E 测试和支持文件

**Interfaces:**
- Consumes: Task 1 路径映射和 Task 2 新单元测试路径。
- Produces: Playwright 新 testDir 与可解析的交互契约。

- [ ] **Step 1:** 移动测试、支持模块和契约，调整相对导入与快照路径；`rg --files apps/desktop/e2e` 应无旧目录文件。
- [ ] **Step 2:** 更新 Playwright、package scripts 和打包脚本路径；`pnpm exec playwright test --list` 应列出与基线相同的测试用例。
- [ ] **Step 3:** 更新所有契约 `testFile`，运行 `pnpm validate:e2e-interactions`；预期 149 条声明有效且所有文件存在。
- [ ] **Step 4:** 运行与迁移直接相关的 E2E 定向用例或可行的本地启动路径；预期支持模块加载成功。

### Task 4: 集成检查与提交

**Files:**
- Modify: `openspec/changes/organize-tests-by-project/tasks.md`（勾选完成项并记录验证）
- Review: 本次改动的全部路径与 Git diff

**Interfaces:**
- Consumes: Tasks 1–3 的迁移结果。
- Produces: 可审阅、只包含本任务改动的提交。

- [ ] **Step 1:** 比对迁移前后的单元/E2E 发现集合；用 `rg --files apps packages plugins -g '*.test.ts' -g '*.test.tsx' | rg '/src/'` 确认一方源码内没有测试，并检查第三方 diff 为空。
- [ ] **Step 2:** 检查 `rg -n 'apps/desktop/e2e|scripts/[^ ]+\.test|src/[^ ]+\.test'` 的剩余结果；历史说明可保留，运行入口与契约必须使用新路径。
- [ ] **Step 3:** 准备提交时依仓库规范仅执行一次 `pnpm typecheck`、`pnpm lint`、`pnpm test`，再按需要运行 `pnpm test:e2e:local` 与打包 E2E；记录通过/失败数量和已知无关失败。
- [ ] **Step 4:** `git diff --check`、审阅 rename 与暂存清单，确保不包含无关的 `main.tsx` 修改；仅提交本任务文件并记录验证结果。
