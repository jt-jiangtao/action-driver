# sandbox-execution Specification

## Purpose

定义工作区文件工具的路径约束，以及本地执行工具的时间、输出和运行时路径边界。通用命令与脚本可以按用户授权读写文件和访问网络。

## Requirements

### Requirement: 将文件访问限制在工作区
Sandbox 文件工具 MUST 将所有输入解析为工作区根目录下的规范路径，并在访问前拒绝绝对越界、`..` 越界以及经符号链接逃逸的路径。

#### Scenario: 读取工作区文件
- **WHEN** `fs.read` 收到指向工作区内普通文件的相对路径
- **THEN** 工具返回有大小上限的 UTF-8 内容和文件元数据

#### Scenario: 路径尝试逃逸工作区
- **WHEN** `fs.list` 或 `fs.read` 的目标经规范化或解析符号链接后不位于工作区根目录
- **THEN** 工具以 `SANDBOX_PATH_DENIED` 失败且不读取目标内容

#### Scenario: 文件内容超过上限
- **WHEN** 目标文件大于单次读取上限
- **THEN** 工具只返回允许范围并明确标记截断、返回字节范围和原始大小

### Requirement: 提供受限目录列表
`fs.list` MUST 只返回目标目录的直接子项、类型和相对路径，并 MUST 对返回项数量设限。

#### Scenario: 列出工作区目录
- **WHEN** 模型调用 `fs.list` 并提供合法相对目录
- **THEN** 工具返回确定排序的直接子项，且不隐式递归遍历整个工作区

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
