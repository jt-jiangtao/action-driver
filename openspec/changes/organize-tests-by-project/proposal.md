## Why

当前一方测试散落在 `src/`、各项目 `tests/` 和桌面端 `e2e/`，测试代码与产品源码混排，路径约定也不一致。统一归档后，开发者可以按所属项目和测试层级定位测试，同时保持现有测试行为与覆盖范围。

Battle 已完成：用户明确选择各项目自己的 `tests/unit`、`tests/e2e`，并批准迁移设计；目标与验收标准已确定，无未裁决的关键分歧。

## What Changes

- 将一方单元测试迁入所属项目的 `tests/unit/`，保留原源码相对路径以便定位。
- 将桌面端 E2E 测试及其支持文件迁入 `apps/desktop/tests/e2e/`。
- 更新测试导入、测试配置、脚本、TypeScript 项目范围、交互契约路径和相关文档，使新路径正常工作。
- 保持第三方与 vendored 源码原样，保留现有测试语义；本变更属于目录重构，不引入或修改产品功能规范，因此设置 `skip_specs: true`。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。

## Impact

影响 `apps/`、`packages/`、`plugins/`、根目录测试与脚本中的一方测试文件，以及 Vitest、Playwright、TypeScript 配置和引用旧路径的脚本/文档。产品接口、运行时行为及第三方代码不变。
