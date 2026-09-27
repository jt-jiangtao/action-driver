## Why

现有工具 ID 混用 local、web、skill、image、computer，模型名称也存在 js 等无归属名称。用户已确认统一 tools.<target>.<plugin>.<operation>，要求直接替换。

## What Changes

- **BREAKING** 内置工具采用 tools.local.<plugin>.<operation>，模型名称使用确定性的下划线形式；版本和参数不变。
- 宿主装配命名绑定，公共 npm helper 提供 local/cloud 身份及位置无关能力标识；不增加云端执行器。
- 仅保留既有内置旧 ID/名称/版本 grants 到 local 的显式兼容映射；不混用 cloud。历史事件保留原始记录，展示适配兼容。
- 同步插件 manifest/catalog、授权、提示词、Skill、脚手架、活动识别和定向回归。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- agent-tool-runtime：统一工具身份与兼容规则。

## Impact

公共插件 SDK/contracts、内置包、Runtime、Desktop 历史活动与模型工具 schema、项目指令及脚手架。Battle 完成：比较仅使用能力 ID 加 metadata 与显式 target 命名；后者使本地/云端选择及授权明确，用户“确认替换”。已公开旧 grants/历史兼容成本；local 表示执行上下文归属，联网不等于 cloud。无未决分歧，沿用 main 和单一职责。
