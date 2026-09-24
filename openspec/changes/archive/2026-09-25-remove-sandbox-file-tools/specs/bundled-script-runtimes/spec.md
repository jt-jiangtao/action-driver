## MODIFIED Requirements

### Requirement: 旧白名单工具退出模型调用面
系统 MUST NOT 向新模型请求注册 `sandbox_shell_run`、`sandbox_fs_list` 或 `sandbox_fs_read`，MUST 继续只读展示历史 `sandbox.shell.run@1` 记录，且 MUST NOT 因重开或恢复任务而重放旧命令。系统不保证历史 `sandbox.fs.*` 记录的专用展示，且不得重放这些已移除工具。随包的 `rg` SHALL 继续可由通用 Shell 工具作为普通命令调用。

#### Scenario: 重开包含旧命令的任务
- **WHEN** 用户重开含 `sandbox.shell.run@1` 历史调用的任务
- **THEN** 原记录仍按原状态展示，新模型工具列表不包含旧工具，旧命令不被重新执行

#### Scenario: 新任务通过 Shell 访问文件
- **WHEN** 模型需要列目录或读取工作区文件
- **THEN** 可使用 `shell_run` 执行命令，模型请求不包含 `sandbox_fs_list` 或 `sandbox_fs_read`
