## Context

见 [proposal.md](proposal.md)。当前 Agent Runtime 运行在 Electron UtilityProcess 中，工具通过 `RuntimeToolRegistry` 注册并授予；`sandbox.shell.run@1` 以固定可执行文件和参数白名单执行。`createSandboxTools` 仍提供受限文件列表与读取；`rg` 已在 Runtime 构建时复制到 `dist/bin`。Desktop 的 `resolveRuntimePaths` 只接受 macOS arm64/x64；打包冒烟脚本将 Desktop 与 Agent Runtime 放入临时 `.app`，但仓库尚无正式 DMG/签名发行流水线。

## Goals / Non-Goals

**Goals:**

- 让模型明确区分终端命令、Python、Node.js，并复用既有工具生命周期与活动区。
- 在打包应用中使用包内 Python/Node，用户无需预装解释器，执行时无需下载。
- 保留原有文件工具、Web Search 与历史工具记录，同时停止新调用使用四命令白名单。

**Non-Goals:**

- 不提供任意第三方 `pip`/`npm` 包的离线镜像或自动安装。
- 不扩展 Windows/Linux，不新增 DMG、签名及公证发布流水线。
- 不在本轮设计通用代码执行的沙箱隔离；不声明文件系统或网络隔离保证。

## Decisions

### 1. 三个模型工具，共用一个进程执行器

注册 `local.shell.run@1` / `shell_run`、`local.python.run@1` / `python_run`、`local.node.run@1` / `node_run`。Shell schema 为 `{ command: string }`；Python/Node schema 为 `{ code?: string, file?: string, args?: string[] }`，执行器进一步校验 `code` 与 `file` 恰有一项。文件相对路径以工作区为基准，绝对路径按原值传入。三个工具分别拥有描述、活动标题和错误语义，但共用 `ProcessRunner` 的流式输出、取消、超时、输出上限与进程树终止逻辑。三者的工具定义声明文件系统写入和网络副作用；已授予时沿用当前自动执行策略。

备选是单一 `execution.run` 配 `runtime` 枚举，可减少模型工具数量，但混合参数模式会增加模型选错运行时与校验歧义。Agent 曾推荐单一工具；用户明确裁决三个独立工具，以换取更清晰的模型调用界面。该裁决已覆盖 Agent 推荐，不再重复讨论。

### 2. Shell 启动系统 zsh，Python/Node 启动包内绝对路径

共享执行器始终以 `spawn(file, args, { shell: false, cwd: workspaceRoot })` 启动明确可执行文件。Shell 工具使用 `/bin/zsh -lc <command>`，故管道、重定向和其他普通 macOS Shell 语法可用；Python 工具以包内 `python3 -c <code>` 或 `python3 <file>` 启动；Node 工具以包内 `node -e <code>` 或 `node <file>` 启动。`args` 原样作为额外参数数组传入，不由 Shell 拼接。工作目录默认为工作区。公共 PATH 将当前包内 Python、Node、`rg` 放在系统目录前，因此 Shell 工具也能直接调用随包程序。

备选是让 Shell/Python/Node 全部走宿主机 PATH，包体更小，但违背“用户无环境也能执行”；另一个备选是复用 Electron UtilityProcess 内的 Node 引擎，可省去 Node 二进制，却需要跨 Main/Runtime 的专用脚本代理，且执行行为与 CLI Node 不一致。选择独立包内 Node，使三种工具共享同一个进程协议。运行时解析失败直接返回运行时不可用错误，绝不回退系统 Python/Node。

### 3. 只在构建时下载并固定解释器

构建脚本使用锁定清单记录 Python 独立发行包及 Node 官方 macOS arm64/x64 归档的版本、来源和 SHA-256；先校验摘要再解压，失败即中止构建。Python 选择含标准库的可独立部署归档，Node 选择官方二进制归档。目标架构的文件被放到 Agent Runtime 部署树下的 `dist/runtimes/<platform>-<arch>/`；`rg` 继续在 `dist/bin`。应用运行时只从其 Runtime 部署目录解析二进制。构建缓存可以复用已校验归档；最终用户安装或首次执行不发生下载。打包应用每个架构只携带对应文件，不要求双架构通用包。

备选是首次执行时下载解释器，能缩小应用包，但离线用户首次运行失败。用户明确要求无预装环境，故选择随包提供。仓库目前只有临时 `.app` 冒烟脚本；此变更把运行时文件纳入该打包树并验证，正式安装器与签名发布留给独立发行变更。

### 4. 旧工具退出调用面，历史记录保持只读

移除 `sandbox.shell.run@1` 的注册与四命令校验实现；保留 `rg` 二进制。运行中旧调用若在升级时未完成，沿现有中断恢复规则进入未知/失败状态，不自动重试。已持久化的工具事件和活动卡继续按原 id 渲染。Renderer 对三个新 id 显示对应图标、标题与命令/代码摘要，旧记录沿用现有渲染分支。模型工具列表只包含新定义，不再暴露旧 `sandbox_shell_run`。

备选是同时保留旧工具一段过渡期；这会让模型面对两套重叠命令入口，与用户“移除这些”冲突，因此不采用。

### Battle 结论

- 类型：架构与产品能力混合。
- 目标：没有预装 Python/Node 的 macOS 用户也能离线运行命令和脚本。
- 最终方向：三个独立工具、共享进程执行器、包内 Python/Node、系统 zsh，移除四命令白名单。
- 已比较方案：单一多运行时工具、宿主机解释器、复用 Electron Node、首次运行下载、保留旧工具。
- 用户覆盖：选择三个工具而非 Agent 推荐的单一工具；暂不维持旧的“只读命令、无任意代码”沙箱约束，接受命令可写入和联网的能力变化。
- 重新开启条件：扩展其他平台、要求第三方依赖离线可用、要求安全隔离、或需要正式签名安装器。

## Risks / Trade-offs

- [通用代码可写入、联网或访问宿主资源] → 新规范明确撤销旧隔离保证，工具定义如实标注副作用；用户已明确暂不考虑沙箱安全。
- [包体积增大与构建供应链成本] → 每架构只带一个 Python 和一个 Node，版本与 SHA-256 固定，构建失败不使用宿主机替代。
- [Python 动态库或架构不匹配] → 在 arm64/x64 打包 `.app` 中检查解释器路径、标准库导入及架构，不能只用开发机单元测试代替。
- [脚本产生无限输出或遗留子进程] → 沿用输出上限与 AbortSignal，按进程组终止并验证取消/超时。
- [历史旧工具 id 不再可调用] → 保留历史投影，只读展示；中断调用不自动重试。
- [当前无正式安装器] → 本变更的离线保证在打包 `.app` 冒烟环境中验收，不声称已建立签名分发链。

## Migration Plan

1. 增加包内运行时清单、构建复制与 Runtime 路径解析，验证无宿主机 Python/Node 时仍能从包内启动。
2. 在共享进程执行器上注册三个新工具，并迁移活动标题与 Renderer 展示；停止注册旧白名单工具。
3. 更新本地、端到端及打包 `.app` 测试；确认历史调用只读、离线执行、取消、超时和非零退出码。
4. 若需要回滚，恢复旧工具注册与构建脚本；历史新工具记录仍按通用事件协议展示，但不得被回放执行。
