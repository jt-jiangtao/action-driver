# sandbox-execution Specification

## Purpose

定义本地执行工具的时间、输出和运行时路径边界，确保命令与脚本在工作区内启动，并在超时或输出超限时给出明确结果。通用命令与脚本可以按用户授权读写文件和访问网络。

## Requirements

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
