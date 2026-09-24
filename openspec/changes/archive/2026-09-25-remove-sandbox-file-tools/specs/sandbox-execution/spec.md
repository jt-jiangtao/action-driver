## REMOVED Requirements

### Requirement: 将文件访问限制在工作区
**Reason**: `sandbox.fs.list/read` 专用执行器退出新工具面，通用 Shell 的工作区与资源约束由保留的执行资源要求覆盖。
**Migration**: 新任务通过 `shell_run` 执行文件命令；不提供旧工具的专用兼容展示。

### Requirement: 提供受限目录列表
**Reason**: 不再注册专用 `fs.list` 工具。
**Migration**: 新任务通过 `shell_run` 列目录；不提供旧列表工具的专用兼容展示。
