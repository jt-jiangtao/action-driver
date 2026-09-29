## Context

见 [proposal.md](proposal.md)。当前 Vitest 从仓库根目录发现 `*.test.ts(x)`，Playwright 使用 `apps/desktop/e2e` 作为 testDir；包内 TypeScript 配置、根脚本和 E2E 交互契约都引用现有路径。仓库同时包含第三方与 vendored 测试，必须按所有权划定迁移范围。此变更是目录和引用重构，不改变测试断言或产品行为。

## Goals / Non-Goals

**Goals:**

- 每个一方项目将单元测试放在自身 `tests/unit/`，E2E 放在自身 `tests/e2e/`；根级跨项目测试放在根 `tests/unit/`。
- 源码树内不再存放一方测试，且迁移前后的测试发现集合一致。
- 配置、脚本、契约和类型检查均指向新目录。

**Non-Goals:**

- 不重写测试逻辑、调整产品功能或更换测试框架。
- 不移动 `thirdparty/`、vendored 源码及开发技能自带的测试。
- 不把源码旁的测试辅助模块一概搬走；仅移动测试专用文件及与测试套件紧密绑定的支持文件。

## Decisions

### 1. 按所属项目分层存放

**选择：** `apps/<name>/tests/unit/`、`apps/<name>/tests/e2e/`，`packages/<name>/tests/unit/` 和 `plugins/<name>/tests/unit/`。`src/foo/bar.test.ts` 迁为 `tests/unit/foo/bar.test.ts`；已有 `tests/foo.test.ts` 迁为 `tests/unit/foo.test.ts`。脚本测试归入根 `tests/unit/scripts/`，根跨项目测试归入根 `tests/unit/`。这样项目所有权清晰，文件名冲突时保留必要的相对目录。

**真实替代方案：** 全部放到根 `tests/unit` 与 `tests/e2e`。这同样能把测试移出源码，但会削弱包边界，跨项目相对导入和局部配置维护成本更高。另一可执行方案是仅移动 `src` 内测试，保持现有 `tests/` 与 `e2e/`；改动量更小，却无法兑现统一目录约定。用户最终裁决为各项目 `tests/unit`、`tests/e2e`，本设计遵循该方向。

### 2. 路径迁移与测试发现同时完成

**选择：** 先建立源路径到目标路径映射，移动文件并修正相对导入，再同步 Vitest、Playwright、TypeScript 配置、package scripts、E2E 契约与路径校验工具。保留测试文件名和断言语义，使用迁移前后发现清单比对数量和身份。

**替代方案：** 仅移动文件并依赖现有 glob 自动发现。该方案无法保证 Playwright testDir、硬编码脚本和契约 JSON 正常运行，因此不采用。

### 3. 第三方边界与独立工作区

**选择：** 只改 `apps/`、`packages/`、`plugins/`、`scripts/` 和根 `tests/` 中由本仓库维护的测试与引用；不触及 `thirdparty/` 和 vendored 子树。使用独立工作区，避免将主工作区已有的无关 `apps/desktop/src/renderer/src/main.tsx` 修改混入交付。

**替代方案：** 对全仓库测试做不区分所有权的批量移动。它会修改上游代码并增加升级冲突，不符合本次目标。

## Risks / Trade-offs

- [相对导入在迁移后失效] → 依据路径映射重写导入，运行针对性测试和 typecheck。
- [测试被发现但运行配置遗漏] → 比对迁移前后清单，检查 Vitest、Playwright、包级配置及 E2E 脚本的实际路径。
- [交互契约内的 `testFile` 字符串变成悬空引用] → 同步更新 JSON 与验证器，并运行定向校验。
- [文件数量较多，Git diff 难审阅] → 尽量保留内容和文件名，分批按项目迁移，用 rename 检查审阅差异。
- [用户选择各项目目录带来多处配置更新] → 已在 Battle 中披露，用户明确选择该方案；此代价是本次已接受的范围。

## Migration Plan

1. 记录一方测试与路径引用清单，确认排除的第三方区域。
2. 按项目搬迁单元测试和桌面端 E2E 支持文件，保持断言不变。
3. 修正导入、配置、脚本、交互契约和直接引用旧路径的文档。
4. 先做目录/路径静态检查和定向测试；准备提交时依仓库治理规范仅执行一次完整验证，再提交本次变更。
5. 如迁移导致无法维持原测试发现集合，可回退该独立分支中的迁移提交。
