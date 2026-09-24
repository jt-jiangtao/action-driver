# 内置脚本运行时设计

## 目标与范围

让 macOS arm64/x64 用户在未安装 Python 或 Node.js 且离线时，仍可通过 Agent 使用 Shell、Python 和 Node.js。模型分别看到 `shell_run`、`python_run`、`node_run`；Python 标准库和 Node 内建模块随应用可用，任意第三方包不在首版保证范围。

当前工具入口 `sandbox_shell_run` 仅允许 `rg/head/tail/wc`。新能力替换该入口，不改变文件列表、文件读取和 Web Search。历史工具记录保留只读展示。

## 决策

1. **三个模型工具与一个底层执行器。** Shell 接收 `command`；Python/Node 接收 `code` 或 `file` 中恰好一项及可选 `args`。它们共用 stdout/stderr 流、非零退出码、取消、超时和输出上限；工作目录为当前工作区。Agent 推荐过单一 `execution.run`，但用户选择三个独立工具，以获得清晰的模型接口。不会同时保留旧白名单工具。
2. **解释器定位。** Shell 用 macOS `/bin/zsh`。Python 与 Node 分别用当前应用包中的绝对路径；找不到包内运行时时明确失败，不查找宿主机 PATH。Shell 的 PATH 优先包含包内 Python、Node 与现有 `rg`，因而可作为普通终端命令调用它们。
3. **构建与交付。** 构建清单固定 Python 独立发行包、Node 官方二进制的版本、下载地址与 SHA-256。构建期间校验并复制目标架构文件至 Agent Runtime 部署树。运行阶段无下载。每个 `.app` 只包含目标架构运行时。现有仓库尚无正式 DMG、签名及公证流水线；本变更验收已打包 `.app` 的离线能力。
4. **规范迁移。** 原 `sandbox-execution` 对系统 Shell 和任意代码的禁止与用户新裁决冲突；新 OpenSpec delta 显式移除该限制。原 `fs.list`/`fs.read` 的路径约束不变；通用进程仍受取消、超时和输出上限控制。

## 交互与失败行为

- 三个工具继续走现有 `proposed → queued → running → completed|failed|cancelled` 生命周期，并在任务组内显示对应动作、流式输出和终态。
- 模型输入缺少命令、同时给出 Python/Node 的 `code` 和 `file`、或两者都缺失时，在启动子进程前失败。
- 解释器缺失、非零退出、输出超限与超时都有可区分的错误；取消会终止子进程树。
- 旧 `sandbox.shell.run@1` 已存档记录在重开任务时仍能显示，且不会因恢复而重新执行。

## 验收

- 在没有用户 Python/Node 的打包 macOS `.app` 中离线运行三种工具；Python 检查标准库导入，Node 检查内建模块，并确认实际解释器路径位于该包内。
- Shell 执行普通管道/重定向及随包 `rg`。Python/Node 分别覆盖内联代码与工作区脚本文件。
- 验证输入拒绝、非零退出、流式输出、超时、取消、历史旧记录只读；arm64/x64 分别通过打包检查。

## 主要代价

应用体积和构建维护成本上升。通用命令与脚本能够写文件或联网；用户已明确暂不采用旧沙箱限制。正式签名分发及第三方包离线仓库属于后续独立范围。

对应的 OpenSpec 规划见 [add-bundled-script-runtimes](../../../openspec/changes/archive/2026-09-24-add-bundled-script-runtimes/proposal.md)。
