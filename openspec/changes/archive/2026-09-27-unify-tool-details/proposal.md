## Why

工具详情仍以整块 JSON 兜底，代码、网页和输出限制分别为 360、240、480px，且工具组外层另限 420px。用户难以识别有效输入输出，也无法充分阅读长内容。Battle 已完成：用户确认插件语义字段、统一组件和统一 640px 上限；无未决分歧。

## What Changes

- 插件通过公共 npm API 声明带标签的输入输出展示字段，内置工具全部覆盖，脚手架提供示例。
- 统一详情组件展示文本、代码、链接和图片；不整块显示 JSON，包括未知插件与历史数据兜底。
- 所有工具详情共享 640px 最大高度，短内容自然撑开、长内容内部滚动；任务组同样使用 640px 上限与可滚动区域。
- 实时、回放和恢复保留展示语义，原日志、模型结果与工具权限不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `plugin-platform`: 插件声明可序列化展示字段，公共 SDK 与脚手架支持。
- `inline-tool-activity`: 所有工具共用语义详情和统一滚动边界。

## Impact

公共 ToolDefinition 可选展示 metadata、Runtime 展示投影与事件、Desktop ToolGroup/ReadOnlyCode/CSS、内置 catalog、npm 脚手架及定向回归。兼容旧插件，没有 metadata 时仅显示有效摘要，不倾倒原对象。
