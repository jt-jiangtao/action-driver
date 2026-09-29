# 按项目整理测试目录

## 目标与成功标准

把本仓库维护的一方测试从产品源码树和旧 E2E 目录中移出，统一存入所属项目的 `tests/unit/`、`tests/e2e/`。完成后，一方 `src/` 中不再有测试文件；迁移前后的测试发现集合、断言语义和产品行为一致；测试脚本、类型检查及 E2E 交互契约都引用新路径。

## 目录设计

| 原位置 | 新位置 | 规则 |
| --- | --- | --- |
| `apps/<app>/src/foo/bar.test.ts` | `apps/<app>/tests/unit/foo/bar.test.ts` | 保留 `src/` 内相对路径 |
| `packages/<pkg>/src/foo.test.ts` | `packages/<pkg>/tests/unit/foo.test.ts` | 同上 |
| `plugins/<plugin>/src/foo.test.ts` | `plugins/<plugin>/tests/unit/foo.test.ts` | 同上 |
| `<project>/tests/foo.test.ts` | `<project>/tests/unit/foo.test.ts` | 保留旧 `tests/` 内相对路径 |
| `apps/desktop/e2e/**` | `apps/desktop/tests/e2e/**` | 测试、支持文件与契约一起移动 |
| `scripts/foo.test.mjs` | `tests/unit/scripts/foo.test.mjs` | 保留 `scripts/` 内相对路径 |
| 根 `tests/foo.test.ts` | 根 `tests/unit/foo.test.ts` | 根级跨项目测试 |

文件名发生冲突时，保留更多原目录层级以避免覆盖，并记录映射。`tests/setup.ts` 等全局测试基础设施按配置需要留在根 `tests/`，不强行当作单元测试迁移。第三方、vendored 代码和开发技能自带测试不在范围内。

## 实施办法

先记录一方测试清单和旧路径引用，再按项目移动文件。只调整因移动造成的相对导入；随后更新 Vitest、Playwright、包级配置、TypeScript 配置、package scripts、交互契约 JSON、E2E 校验工具和直接引用旧路径的文档。迁移不修改测试断言或产品逻辑。

根配置目前按 `*.test.ts(x)` 发现单元测试，桌面端 Playwright testDir 指向 `apps/desktop/e2e`。这些入口必须在迁移中同时更新或核实能发现新目录。交互契约的每个 `testFile` 必须解析到实际文件。

## 已比较的方案与裁决

选择各项目分别使用 `tests/unit`、`tests/e2e`，因为文件所有权明确，与用户指定目录一致。可执行的替代方案是将所有测试集中到仓库根 `tests/`，但会增加跨包相对导入和局部配置维护成本；只搬 `src/` 中测试则无法形成统一约定。用户已明确裁决采用各项目目录，并接受多处配置必须同步调整的代价。无未解决的关键分歧。

## 风险与验证

- 相对导入失效：按文件映射修正，并运行相关定向测试与类型检查。
- 测试漏发现：比对迁移前后的一方测试清单，检查 Vitest 和 Playwright 的收集结果。
- E2E 入口或契约悬空：核对脚本旧路径与契约 `testFile`，运行定向验证。
- 大量文件搬迁难审阅：尽量保留文件内容，检查 Git rename 识别和第三方边界。

迭代期间不跑全量测试。准备提交实现时，遵守仓库规定只执行一次完整 typecheck、lint、test，并按桌面端 E2E 路径变更追加必要的 E2E 验证。实施和验收任务详见 [OpenSpec tasks](../../../openspec/changes/organize-tests-by-project/tasks.md)。
