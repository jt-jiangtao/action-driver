## Purpose

定义 macOS 桌面应用向模型提供的 Shell、Python 与 Node.js 独立执行能力，以及 Python/Node 解释器随包交付和离线运行的用户可观察保证。

## ADDED Requirements

### Requirement: 提供三个独立执行工具
系统 SHALL 向模型分别注册 `shell_run`、`python_run`、`node_run`，并在本轮授予后按既有工具生命周期自动执行。`shell_run` MUST 接收非空 `command` 文本；`python_run` 和 `node_run` MUST 恰好接收 `code` 或 `file` 中的一项，并可接收字符串数组 `args`。无效输入 MUST 在创建子进程前失败。

#### Scenario: 执行 macOS 终端命令
- **WHEN** 模型调用 `shell_run` 并提供含管道或重定向的合法命令文本
- **THEN** Runtime 以 macOS Shell 解释命令，按原调用 id 返回流式输出及退出状态

#### Scenario: 运行内联脚本或文件
- **WHEN** 模型调用 `python_run` 或 `node_run`，提供内联代码或脚本文件路径和可选参数
- **THEN** Runtime 使用对应解释器执行该输入，文件相对路径以工作区为基准，输出关联原调用 id

#### Scenario: 拒绝歧义输入
- **WHEN** Python 或 Node 工具同时收到 `code` 与 `file`，或两者都未提供
- **THEN** Runtime 产生输入无效终态且不启动解释器

### Requirement: 包内解释器保证离线执行
macOS arm64 与 x64 应用包 SHALL 各自包含匹配架构的 Python 解释器、Python 标准库与 Node.js 解释器。Python 和 Node 工具 MUST 只使用当前应用包内解析的绝对路径，MUST NOT 回退到用户安装的解释器，也 MUST NOT 在执行时下载运行时。系统仅保证 Python 标准库及 Node 内建模块；任意第三方 `pip` 或 `npm` 包不属于离线保证。

#### Scenario: 用户没有安装 Python 和 Node
- **WHEN** 用户在没有可用系统 Python/Node 的 macOS 上离线运行打包应用
- **THEN** `python_run` 与 `node_run` 仍成功运行仅使用标准库或内建模块的代码，且执行路径位于当前应用包内

#### Scenario: 包内运行时缺失
- **WHEN** 当前架构的包内解释器或 Python 标准库缺失
- **THEN** 对应工具返回明确的运行时不可用错误，不回退宿主机解释器

### Requirement: 共用进程生命周期与活动展示
三个工具 SHALL 共用工作区默认工作目录、stdout/stderr 流、退出码、超时、输出上限与取消语义。任务活动 SHALL 显示对应 Shell、Python 或 Node.js 动作及运行状态；工具过程不得混入助手正文。

#### Scenario: 脚本失败
- **WHEN** 命令或脚本以非零退出码结束
- **THEN** 对应工具进入失败终态，保留受限输出和退出码供任务活动查看

#### Scenario: 取消长时间运行的脚本
- **WHEN** 用户在 Python、Node 或 Shell 子进程运行中取消任务
- **THEN** Runtime 终止该调用的进程树并记录取消终态，不将取消请求误报为执行成功

### Requirement: 旧白名单工具退出模型调用面
系统 MUST NOT 向新模型请求注册 `sandbox_shell_run`，MUST 继续只读展示历史 `sandbox.shell.run@1` 记录，且 MUST NOT 因重开或恢复任务而重放旧命令。随包的 `rg` SHALL 继续可由通用 Shell 工具作为普通命令调用。

#### Scenario: 重开包含旧命令的任务
- **WHEN** 用户重开含 `sandbox.shell.run@1` 历史调用的任务
- **THEN** 原记录仍按原状态展示，新模型工具列表不包含旧工具，旧命令不被重新执行
