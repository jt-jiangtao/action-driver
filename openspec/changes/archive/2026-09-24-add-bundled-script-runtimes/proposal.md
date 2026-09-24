## Why

当前 `sandbox_shell_run` 只接受 `rg`、`head`、`tail`、`wc`，模型无法运行普通 macOS 命令、Python 或 Node.js 代码；即使用户本机装有解释器，这些调用也没有相应模型工具。用户需要无需预装 Python/Node、离线即可执行的通用能力。

Battle 已完成：用户明确选择 macOS 终端命令、随应用内置 Python/Node 解释器与标准库、三个独立模型工具，并决定移除四命令白名单。已比较单一多运行时工具与三个独立工具；用户选择后者。现有 Sandbox 规范禁止系统 Shell 和任意代码执行，与新方向直接冲突；用户已明确暂不考虑原有沙箱限制，接受通用命令可能读写文件或访问网络的能力变化。无未裁决的关键分歧。

## What Changes

- **BREAKING** 停止注册 `sandbox.shell.run@1` / `sandbox_shell_run`，移除专用四命令白名单；历史工具记录仍可只读展示，不重新执行。
- 新增独立的 `shell_run`、`python_run`、`node_run` 模型工具，共享子进程执行基础设施，支持流式输出、退出码、取消、超时和输出上限。
- Shell 调用 macOS 自带 `zsh`；Python 与 Node.js 运行时随应用按 arm64/x64 打包，执行时只使用包内绝对路径，不依赖用户安装或联网下载。提供 Python 标准库和 Node 内建模块，不承诺任意第三方包离线可用。
- 保留随包的 `rg` 二进制，作为通用终端命令可调用的普通程序，而非独立白名单工具。
- 将打包应用中无用户 Python/Node 环境的执行验证纳入验收。

## Capabilities

### New Capabilities

- `bundled-script-runtimes`: 定义三种执行工具、包内解释器选择、离线能力与打包验收。

### Modified Capabilities

- `sandbox-execution`: 替换禁止系统 Shell 与任意代码执行的旧要求，保留文件工具自身的路径约束及进程生命周期上限。
- `agent-tool-runtime`: 更新模型发现和自动执行场景中的 Shell 工具身份，并保持旧调用历史可读、不可重放。

## Impact

- 影响 Agent Runtime 的工具注册、进程执行、活动标题与输出投影，Desktop 的工具行展示、Runtime 路径解析及 macOS 打包冒烟测试。
- 构建时需取得并固定对应架构的 Python 独立发行包与 Node.js 官方二进制，校验来源与摘要；发布包体积增大。
- 文件列表、文件读取、Web Search 与现有工具事件协议继续复用，不新增模型侧标题请求。
