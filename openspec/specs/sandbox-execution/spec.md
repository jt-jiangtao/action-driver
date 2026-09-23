# sandbox-execution Specification

## Purpose

定义首个本地受限执行器的可观察安全边界，使 Agent 能在明确工作区内读取文件和运行有限的只读命令，同时不继承宿主机秘密、任意网络能力或不受控的文件系统访问。

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

### Requirement: 不通过系统 Shell 解释命令
`shell.run` MUST 使用参数数组启动明确允许的只读可执行文件，MUST NOT 使用系统 shell 解释字符串，并 MUST 在执行前校验命令、参数和路径。

#### Scenario: 运行允许的只读命令
- **WHEN** 请求的可执行文件在允许列表中且所有路径参数均位于工作区
- **THEN** 工具以工作区为 cwd 执行并返回退出码、stdout、stderr、耗时和截断标记

#### Scenario: 请求未允许命令或 shell 语法
- **WHEN** 请求包含未允许可执行文件、管道、重定向、命令替换或无法安全分类的参数
- **THEN** 工具以 `SANDBOX_COMMAND_DENIED` 失败且不创建子进程

### Requirement: 限制执行资源和环境
Sandbox MUST 为命令设置最大执行时间和最大输出字节数，只传入显式最小环境变量，并 MUST NOT 传入模型凭据、Runtime 访问令牌或用户自定义秘密。

#### Scenario: 命令输出超过上限
- **WHEN** stdout 或 stderr 超过配置上限
- **THEN** Sandbox 停止继续收集、终止子进程并以 `SANDBOX_OUTPUT_LIMIT` 返回已收集内容和截断状态

#### Scenario: 命令超过执行时间
- **WHEN** 子进程超过配置的最大时长
- **THEN** Sandbox 终止进程树并以 `SANDBOX_TIMEOUT` 结束调用

### Requirement: 默认不提供网络和写入能力
首版 Sandbox MUST NOT 注册网络客户端、文件写入、补丁应用或任意代码执行工具；允许的命令集合 MUST 排除可发起网络请求或修改工作区的可执行文件与参数组合。

#### Scenario: 模型请求未开放能力
- **WHEN** 模型尝试调用网络、文件写入、补丁或未注册执行能力
- **THEN** Tool Runtime 返回 `TOOL_UNAVAILABLE` 或 `SANDBOX_COMMAND_DENIED`，且宿主机状态保持不变
