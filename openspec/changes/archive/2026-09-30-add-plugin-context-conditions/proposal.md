## Why

插件贡献目前依赖各自注册与界面逻辑判断可用性，缺少可共享、可观察的声明式条件。上下文键使宿主能在状态变化时一致地更新发现结果，同时保留执行时的授权与安全边界。

Battle 已完成：用户确认采用宿主拥有的上下文键和受限条件表达式，并要求在 `main` 工作区推进。发现并行变更 `extend-declarative-plugin-contributions` 后，用户确认本变更仅负责上下文键、条件求值及现有命令和工具接入；菜单与视图贡献结构及界面入口由并行变更负责。无未裁决关键分歧。

## What Changes

- 为现有插件贡献增加可选声明式可用条件，旧插件不声明条件时保持现有行为。
- 提供按宿主与插件实例归属的上下文键、受限表达式解析和确定性求值；未知键与非法表达式安全失败。
- 上下文变化时更新命令与工具的发现状态，并提供可供菜单、视图贡献消费的求值接口。
- 命令和工具直接调用时重新检查条件，原有 grants、输入校验、取消及安全门保持独立有效。

## Capabilities

### New Capabilities

- `plugin-context-conditions`：定义上下文键的所有权、生命周期、条件语法和可用性投影。

### Modified Capabilities

- `plugin-platform`：插件贡献可声明条件，宿主按条件发现与调用现有命令和工具。
- `agent-tool-runtime`：插件工具进入模型发现和执行时同时满足条件与原有工具策略。

## Impact

影响 `packages/plugin-contracts`、`packages/plugin-sdk`、`apps/agent-runtime/src/plugins` 和工具注册与发现路径，以及脚手架和插件开发文档。菜单、视图结构及 Desktop 可见入口由 `extend-declarative-plugin-contributions` 负责；本变更提供其可复用的条件求值接口。
