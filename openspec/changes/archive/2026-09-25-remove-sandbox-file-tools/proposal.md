## Why

`sandbox.fs.list/read` 仍向模型提供专用文件工具，与已上线的通用 `shell_run` 重叠。用户要求删除这组工具及其实现，收敛模型可用工具面。

这是决策型变更，因为移除模型公共工具接口。Battle 已完成：检查了现有注册、Shell 替代能力、旧任务展示和测试；比较了“完全删除”与“仅停止注册、保留实现及历史专用展示”。Agent 起初推荐删除执行实现但保留历史展示；用户先确认，随后进一步明确要求“全部删除，历史问题不用考虑”，最终裁决覆盖原历史兼容建议。已知代价是新任务不再收到结构化文件结果，旧记录也不再获得专用标题或兼容保证；无未决关键分歧。

## What Changes

- **BREAKING** 新模型请求不再注册 `sandbox_fs_list` 或 `sandbox_fs_read`，旧调用不可再执行。
- 删除专用文件工具实现、仅为它们服务的路径守卫，以及 `sandbox.fs.*` 的专用活动标题和展示分支；保留工作区根目录对执行工具的要求。
- 新任务测试改用 `shell_run` 验证读取与列目录；删除专门验证旧 `sandbox.fs.*` 的测试与测试数据。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `sandbox-execution`：移除专用文件工具的路径与列表契约，保留通用执行工具资源边界。
- `bundled-script-runtimes`：新模型请求不再暴露 `sandbox_fs_list/read`，不承诺旧文件工具记录的专用展示。

## Impact

影响 Agent Runtime 工具注册、文件工具实现、活动标题、OpenSpec、Runtime 与桌面 E2E 测试。既有数据库记录不主动删除，但旧工具专用展示不再保证；无新依赖。
