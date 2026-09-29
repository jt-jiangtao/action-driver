## Why

现有插件可声明工具、Skill、命令和面板，但桌面视图、菜单与这些贡献的发现、可用性和生命周期尚未形成完整的一致契约。扩展现有插件平台可以让内置与第三方能力以同一种方式进入产品，同时保持宿主对授权和资源回收的控制。

Battle 已完成：用户要求完整平台能力，确认命令、工具、Skill、面板、视图和菜单均在范围内。已比较“扩展现有贡献注册体系”和“另建通用注册表”；后者会产生并行所有权与冲突处理，故推荐前者。用户选择完整覆盖，接受较大的公共接口与兼容迁移成本；无未裁决关键分歧。

## What Changes

- 将视图和菜单纳入插件的声明式贡献、发现、按需激活、可用性、冲突处理和停用回收流程。
- 统一命令、工具、Skill、面板、视图和菜单的宿主归属与状态投影；声明不直接授予模型工具权限。
- 为不兼容、缺失依赖、重复 ID、失效宿主和权限不足提供可诊断的失败结果。
- 保持现有插件 manifest 与 catalog 的版本化兼容策略；若需要新字段，明确旧插件的兼容行为。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `plugin-platform`：扩展贡献类型及跨 Runtime/Desktop 的声明、发现、启用、授权和清理契约。

## Impact

影响 `packages/plugin-contracts`、`packages/plugin-sdk`、`apps/agent-runtime/src/plugins`、`apps/desktop` 的插件面板与渲染入口，以及插件 manifest、catalog 和脚手架。与上下文键变更的可用性判断衔接，但不复制其状态引擎。
