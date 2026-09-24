## Context

参见 [proposal.md](proposal.md) 的 Why。当前 `AgentFileStore` 已拥有本地 Skill 目录、`.disabled` 标记和设置页文件编辑能力，但将可用性绑定到可执行器；任务协议固定给出空 Skill 列表。脚本注册器已有三个工具，`runProcess` 目前不接受 stdin。桌面版已按架构打包 Python、Node 和 `rg`；现有 arm64 包内 Node 22.22.1 可用 `--input-type=module-typescript` 执行可擦除类型的 stdin 源码。

本变更同时触及运行时、工具契约、桌面设置页和打包验收，属于经 Agent Battle 完成裁决的架构变更。旧 `manage-agent-skills` 变更仍未归档，其中的 executor 门槛与此方案相冲突，实施前必须修订该规划冲突。

## Goals / Non-Goals

**Goals:**

- 让目录中的普通 `SKILL.md` 能被安装、启停、任务发现和按需读取；与可执行工具授权分离。
- 用一套服务完成设置页与 `skill_install` 工具的 GitHub、本地文件夹安装，结果原子可恢复。
- 将 Shell、Python、Node、TypeScript 四个模型工具统一为 `{ script, args? }`，用所选工具决定解释器。
- 维持包内解释器、工作区默认目录、输出限制、取消、超时和历史记录只读展示。

**Non-Goals:**

- 通过 Skill 安装自动安装 npm/pip 包、执行安装钩子或授予工具权限。
- 自动识别脚本语言、从脚本文件路径执行、支持完整 TypeScript 编译或 `tsconfig` 转换。
- 同步/商店/自动更新 Skill、重放历史工具调用，或重做与本变更无关的设置页。

## Decisions

### 1. Skill 内容目录是事实来源

个人 Skill 位于 `~/.action-driver/skills/<id>`。本地应用已有 `AgentFileStore`，沿用其目录扫描、`.disabled` 和路径保护；生产 Runtime 明确接收用户 home，E2E 可显式覆写隔离目录。`SKILL.md` 的 YAML frontmatter 用标准解析器和 schema 校验；既有无 frontmatter 的内建/用户文件保留标题与首段描述回退读取，避免安装升级导致既有 Skill 消失。`executor` 在旧文件中可继续解析为能力映射，但不参与普通 Skill 的可用性判断。来源用 Skill 目录内的应用元数据记录，缺少元数据的既有 Skill 显示“本地”。不建第二套数据库状态。

替代方案是维护独立 Skill 注册表。这会使文件编辑、Finder 修改和状态数据库不同步，且现有目录已是事实来源；因此不采用。用户明确裁决普通 Skill 不需要 executor。

### 2. 两种安装入口共用原子导入服务

设置页“添加”和 Agent 的 `skill_install` 只提交来源说明给 Runtime 的同一安装端口：GitHub 仓库及子目录，或本地文件夹。GitHub 优先获取指定仓库路径的内容；公有下载失败时可走 Git sparse checkout，私有仓库只使用已配置的本机认证，不在产品中存新凭据。来源解析为临时目录后统一执行路径、符号链接、文件类型、文件数和总大小校验，确认 `SKILL.md` 可读，再复制到目标同级临时目录并原子重命名。目标 `<id>` 已存在时拒绝，不覆盖。清理失败的临时目录；离线 GitHub 安装报可恢复的网络错误。本地安装复制快照，源目录后续改动不自动同步。卸载仅删应用目录中的该 Skill，源目录不动。

替代方案是让设置页和 Agent 各自执行 Git/文件复制，改动初期较快，但会分叉校验、错误和状态，故拒绝。参考 Codex 的目录安装方式，但不依赖或修改 Codex 的 Skill 根目录。

### 3. 任务只注入元数据，正文按需读取

新任务创建时从同一目录快照读取已启用 Skill 的 id、名称和短描述，传入模型可见的发现列表；`skill_read` 校验 id 和相对文件路径后返回 `SKILL.md` 或该 Skill 目录中的附属文本文件。长内容服从工具输出上限。设置页读取完整目录不受任务启停影响；Agent 读取只面向已启用 Skill。任务进行中改动 Skill 时，已有任务的发现列表保持创建时快照，读取时按当前启用状态与文件存在性复查，避免已停用内容继续读取。Skill 安装/启用不改变任何工具 grants。

替代方案是每轮把所有正文塞入 system prompt；随 Skill 数量和参考文件增长会显著占用上下文，并使正文变更更难定位，故选择元数据加按需读取。用户裁决普通 Skill 是说明包，不需要 executor。

### 4. 四个独立工具只接受 inline source

`shell_run`、`python_run`、`node_run` 的模型定义升版本并收窄为非空 `script` 与可选字符串数组 `args`；新增同构 `ts_run`。Tool Registry 按工具名映射 `/bin/zsh`、包内 Python、包内 Node 或包内 Node 的 TypeScript 类型擦除模式。`runProcess` 增加受限 stdin 写入，处理写入失败、背压、子进程提前退出和取消；输出与进程组终止逻辑继续共用。执行 cwd 一律是任务工作区，源码文本无文件路径身份，附属文件需由脚本显式访问工作区。新输入严格拒绝旧字段，历史记录按照原定义版本只读展示。

替代方案是单个 `execution.run` 加语言参数，或从源码猜测语言。前者增加模型一次选择参数，后者对多语言共通语法不确定；用户明确选择四个独立工具。首版 `ts_run` 使用包内 Node 的原生类型擦除；完整 TypeScript 编译将引入额外工具链和依赖解析，超出已确认范围。

### 5. 工具授权仍独立于 Skill

`skill_install` 和 `skill_read` 作为有类型、可审计的 Runtime 工具注册；安装工具服从既有 Policy Gate。无论来自 GitHub 还是本地，`SKILL.md` 只作为非特权说明内容。旧 `executor` 字段只服务既有可执行能力映射，不能让任意新 Skill 自动获得 Shell、Browser 或 Computer 权限。这一边界也保留 Browser/Computer 适配器的独立性。

替代方案是允许 Skill manifest 声明权限并在启用时自动开放工具；这会把远程 Markdown 安装变成权限提升，且违背用户选择的普通说明型 Skill，因此不采用。

## Risks / Trade-offs

- [GitHub 内容不可信或路径越界] → 安装前校验路径、链接、规模与入口；不执行安装脚本，不让文档改变工具权限。用户在 Battle 中接受远程内容进入本地目录的风险。
- [包内 Node TypeScript 能力有限] → UI/工具描述明确仅支持类型擦除；不静默切换到系统解释器，失败时保留 stderr。用户接受无完整 `tsconfig`/第三方依赖支持。
- [源码 stdin 没有脚本文件目录] → 固定 cwd 为工作区，模型提示和错误说明清晰展示；需要 Skill 附属文件时先读取或显式使用工作区路径。
- [大型源码导致 stdin 阻塞或任务长时间无反馈] → 输入大小上限、可取消的背压处理以及既有超时；工具活动在进程启动前也显示准备状态。
- [旧规范与新规范相互冲突] → 实施前更新进行中的 `manage-agent-skills` 规划及对应测试，最终以本变更的新 Skill 可用性规则验收。
- [发布包架构不完整] → arm64/x64 打包验收分别检查包内 Python、Node、TypeScript 类型擦除及缺少系统运行时的离线执行。

## Migration Plan

1. 先修订未归档 `manage-agent-skills` 中 executor 为必需的规划与测试期望，保留它已完成的主提示词和文件编辑成果。
2. 扩展契约和目录服务，保留现有 `SKILL.md`、`.disabled` 与内建 Skill；缺少来源元数据的项目按既有本地 Skill 处理。
3. 接入统一安装服务、设置页和 Agent 的发现/读取/安装工具；在真实新任务中验证 Skill 生效。
4. 更换脚本工具的新版本输入，加入 `ts_run`，更新模型工具说明、事件展示和测试替身；旧日志只读，不自动迁移或重放参数。
5. 对两种安装来源、失败回滚、四种语言、取消/超时/输出上限、两种架构包和离线场景做验收；必要时回滚 Runtime/界面代码，磁盘上的原有 Skill 内容与历史记录不做破坏性迁移。
