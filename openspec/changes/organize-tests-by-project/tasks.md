## 1. 迁移清单与目录

- [x] 1.1 建立一方测试及旧路径引用清单，核对 `apps/`、`packages/`、`plugins/`、`scripts/` 和根 `tests/` 的文件数量，并确认第三方与 vendored 文件未纳入。

基线：一方测试文件 430 个，目标路径 430 个且无冲突；Vitest 收集 2454 个用例、404 个文件；Playwright 收集 44 个用例、11 个文件。清单保存在本次执行的忽略目录中，第三方与 vendored 文件未纳入。
- [x] 1.2 将各项目的 `src/**/*.test.*` 和现有 `tests/*.test.*` 迁入所属 `tests/unit/`，将脚本测试迁入根 `tests/unit/scripts/`；用路径映射与 `rg --files` 核对无遗漏、无目标重名。

419 个单元测试均已到达唯一目标，源路径无遗留；Vitest 收集仍为 2454 个用例，映射后的文件名与用例名集合完全一致。
- [x] 1.3 将 `apps/desktop/e2e/` 的测试、支持文件与交互契约迁入 `apps/desktop/tests/e2e/`；核对原目录不再有一方 E2E 文件。

## 2. 引用与配置

- [x] 2.1 修正迁移文件的相对导入及受影响的生产/测试文件引用；用 `rg` 检查旧路径和定向 TypeScript 检查验证。
- [x] 2.2 更新 Vitest、Playwright、包级测试配置、tsconfig 和 package scripts 的发现/排除路径；比对迁移前后测试发现清单并运行代表性定向测试。
- [x] 2.3 更新 E2E 脚本、交互契约 `testFile`、路径校验工具及直接引用旧路径的文档；运行交互契约定向校验并检查所有指向的文件存在。

迁移后 Playwright 列表与基线一致（44 个用例、11 个文件）；146 条契约均指向存在的测试文件，交互校验通过（149 条声明）；`main-prompt-offline.spec.ts` 1 项通过。桌面、运行时及插件定向 TypeScript 检查通过。

## 3. 集成验收与交付

- [x] 3.1 核对所有一方测试都位于所属 `tests/unit/` 或 `tests/e2e/`、第三方文件无变化、测试发现集合一致；记录检查结果。

430 个基线测试均有新路径且旧路径无文件；17 个 E2E 文件均在新目录。Vitest 基线 2454 个用例全部保留；另有并行工作新增的 4 个用例，不属于本次迁移。Playwright 列表逐行一致，第三方与 vendored 路径无改动。
- [x] 3.2 准备提交时按仓库规范仅执行一次 `pnpm typecheck`、`pnpm lint`、`pnpm test`，按桌面端 E2E 迁移风险追加必要的 E2E 验证；记录命令、通过/失败数量及与本次改动无关的已知失败。

提交前完整验证仅运行一次：`pnpm typecheck` 因并行插件改动中的 `ContextValue` 导出不一致失败；本次迁移涉及的 desktop、agent-runtime 与 5 个插件 tsconfig 定向检查通过。`pnpm lint` 报 22 处错误，其中 21 处来自迁移后脚本测试缺少 Node 全局配置，已修正且定向 ESLint 通过；余下一处是工作区原有 `main.tsx` 的未使用 `StrictMode` 导入。`pnpm test` 收集 411 个文件、2466 项测试，397 文件通过、12 文件失败、2 文件跳过；2405 项通过、59 项失败、2 项跳过。5 项失败由迁移后的 `import.meta.dirname` 路径造成，已修正且 4 个相关文件的定向测试全通过；其余失败受 Node 20/24 API 与 `better-sqlite3` ABI 不一致影响，Node 24 下的 6 个相关文件定向测试通过，SQLite 原生模块在并行构建中出现 ABI 来回切换。E2E 迁移后 `main-prompt-offline.spec.ts` 1 项通过，Playwright 收集和交互契约校验通过；未运行打包 E2E，因为产品打包内容未变。
- [x] 3.3 审阅 diff 并仅提交本次任务的改动；以 `git status` 和提交内容确认没有混入主工作区的无关修改。
