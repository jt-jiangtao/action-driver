## Why

公开工具名称目前在 SDK 构造时转为下划线，导致模型回答、插件 API 和界面不符合点分隔命名。Battle 已完成，用户明确裁决：公开名称保留点号，仅模型协议层使用兼容名称；无未决分歧。

## What Changes

- 工具 ID 与公开 modelName 使用点分隔的完整命名；同步 SDK、catalog、Skill 指令及界面引用。
- OpenAI 协议发送声明、历史调用与结果时转换名称，回传准备事件与调用时恢复公开名称。
- 不保留未发布旧名称的调用兼容；映射冲突或协议名称非法时明确拒绝。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-tool-runtime`: 公开点分隔名称、协议边界兼容与旧调用恢复。

## Impact

公共契约、内置插件/脚手架、Runtime 指令和模型协议适配、Renderer 引用、命名与流式回归。无外部依赖，不修改授权和工具参数。
