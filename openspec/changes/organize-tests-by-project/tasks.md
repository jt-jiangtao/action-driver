## 1. 迁移清单与目录

- [ ] 1.1 建立一方测试及旧路径引用清单，核对 `apps/`、`packages/`、`plugins/`、`scripts/` 和根 `tests/` 的文件数量，并确认第三方与 vendored 文件未纳入。
- [ ] 1.2 将各项目的 `src/**/*.test.*` 和现有 `tests/*.test.*` 迁入所属 `tests/unit/`，将脚本测试迁入根 `tests/unit/scripts/`；用路径映射与 `rg --files` 核对无遗漏、无目标重名。
- [ ] 1.3 将 `apps/desktop/e2e/` 的测试、支持文件与交互契约迁入 `apps/desktop/tests/e2e/`；核对原目录不再有一方 E2E 文件。

## 2. 引用与配置

- [ ] 2.1 修正迁移文件的相对导入及受影响的生产/测试文件引用；用 `rg` 检查旧路径和定向 TypeScript 检查验证。
- [ ] 2.2 更新 Vitest、Playwright、包级测试配置、tsconfig 和 package scripts 的发现/排除路径；比对迁移前后测试发现清单并运行代表性定向测试。
- [ ] 2.3 更新 E2E 脚本、交互契约 `testFile`、路径校验工具及直接引用旧路径的文档；运行交互契约定向校验并检查所有指向的文件存在。

## 3. 集成验收与交付

- [ ] 3.1 核对所有一方测试都位于所属 `tests/unit/` 或 `tests/e2e/`、第三方文件无变化、测试发现集合一致；记录检查结果。
- [ ] 3.2 准备提交时按仓库规范仅执行一次 `pnpm typecheck`、`pnpm lint`、`pnpm test`，按桌面端 E2E 迁移风险追加必要的 E2E 验证；记录命令、通过/失败数量及与本次改动无关的已知失败。
- [ ] 3.3 审阅 diff 并仅提交本次任务的改动；以 `git status` 和提交内容确认没有混入主工作区的无关修改。
