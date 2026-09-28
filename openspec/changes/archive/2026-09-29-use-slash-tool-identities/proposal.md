## Why

当前工具稳定 ID 使用点号分隔层级，而用户要求统一改为斜杠分隔。该 ID 已进入插件声明、授权、运行事件和持久化记录，必须作为一次明确的破坏性接口变更整体切换，避免同一工具在不同边界使用两种标识。

## What Changes

- **BREAKING**：所有新注册的工具 ID 改用 `/` 分隔层级。内置工具采用 `tools/<target>/<plugin>/<operation>`，例如 `tools/local/command/shell/run`；第三方工具 ID 也不得包含点号。
- **BREAKING**：移除点号工具 ID 与旧模型名的兼容别名。旧授权、旧插件工具声明及旧工具调用不自动迁移或映射到新工具。
- 插件 manifest、catalog、激活条件、Runtime Registry、Policy Gate、能力调用、活动投影及脚手架统一使用新 ID；模型可见名称继续使用下划线，不改模型提供方的函数名约束。
- 历史记录保留原始数据，不执行历史工具调用，也不承诺按新 ID 重新解释旧记录。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-tool-runtime`：将工具身份与授权规则改为斜杠格式，删除旧标识兼容要求。
- `plugin-platform`：插件工具贡献使用斜杠 ID，升级时不再承诺保持旧工具 ID 和授权。

## Impact

涉及 `packages/plugin-contracts`、`packages/plugin-sdk`、`packages/runtime-contracts`、内置插件及脚手架、`apps/agent-runtime`、`apps/desktop` 的工具 ID 常量与判断、相关测试和文档。已有外部插件若仍声明点号工具 ID 将无法通过新契约；旧 grants 不授权新工具。此次不更改非工具身份、模型名称、工具参数 schema 或执行权限边界。

## Battle Status

- 类型：架构决策型，涉及公共标识、授权和历史兼容。
- 目标与成功标准：所有新工具 ID 均使用 `/`；新授权与执行一致；旧点号 ID 不再可调用；模型名仍符合现有提供方约束。
- 当前主张与最终裁决：用户于 2026-09-28 明确选择直接切换，不保留兼容。
- 已比较替代方案：仅修改界面显示会留下内部点号 ID；保留旧别名可降低升级损坏，但增加双轨解析。用户在了解旧授权、插件和历史调用可能失效后选择一次性切换。
- 主要风险：已安装的旧版插件声明、旧授权及旧任务记录无法作为新工具调用依据。无未裁决的方向分歧。
