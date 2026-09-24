## MODIFIED Requirements

### Requirement: 限制执行资源和环境
执行工具 MUST 为子进程设置最大执行时间与最大输出字节数，并以当前工作区为默认工作目录；Python 和 Node 解释器路径及通用 Shell 可见的随包工具路径 MUST 从当前应用包确定。此要求不保证通用命令或代码不能读写文件、访问网络或启动其他程序。

#### Scenario: 命令输出超过上限
- **WHEN** stdout 或 stderr 超过配置上限
- **THEN** Runtime 停止继续收集、终止进程树，并以输出超限错误和已收集的受限内容结束调用

#### Scenario: 命令超过执行时间
- **WHEN** 子进程超过配置的最大时长
- **THEN** Runtime 终止进程树并以超时错误结束调用

#### Scenario: 工作区与随包路径
- **WHEN** 三种执行工具启动子进程
- **THEN** 默认工作目录是当前工作区，Shell 可找到随包的 `rg`、Python 与 Node，Python/Node 专用工具只使用包内解释器

## REMOVED Requirements

### Requirement: 不通过系统 Shell 解释命令
**Reason**: 用户已裁决以通用 macOS 终端命令替换四命令白名单，必须允许 Shell 语法与任意可执行程序。
**Migration**: 新调用使用 `shell_run`；历史 `sandbox.shell.run@1` 记录只读保留，不提供旧工具重放。

### Requirement: 默认不提供网络和写入能力
**Reason**: 用户已裁决通用 Shell、Python 和 Node.js 执行，无法继续保证命令不能写入或联网。
**Migration**: 新工具定义准确声明可写入及联网副作用；既有 `fs.list` 与 `fs.read` 的路径约束保持有效。
