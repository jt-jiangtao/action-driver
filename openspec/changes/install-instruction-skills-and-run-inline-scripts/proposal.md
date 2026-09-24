## Why

当前生产版虽已有 `~/.action-driver/skills` 目录和设置页，却把没有已注册 `executor` 的普通 Skill 判为不可用；流式任务还固定传入空 Skill 列表。用户无法像使用 Codex Skill 一样安装、启用并实际使用本地指令包。现有脚本工具同时接受命令、源码和文件路径，接口也不符合用户确定的“选择对应工具、只传源码脚本”方式。

## What Changes

- 普通 Skill 以固定本地目录中的 `SKILL.md` 为定义，无需 `executor` 即可启用；目录、启停标记和文件内容继续作为事实来源。已注册工具仍由 Tool Registry 与 Policy Gate 授权，Skill 文本不授予权限。
- 提供统一安装服务，首版从 GitHub 仓库子目录或本地文件夹导入 Skill；设置页“添加”和 Agent 的 `skill_install` 工具调用同一服务。安装校验通过后原子写入，重名时不自动覆盖。
- 设置页按已确认的列表与详情方向展示名称、说明、来源、开关、Markdown 内容、打开目录、复制与卸载；Agent 在任务开始时发现已启用 Skill 的名称和简短描述，使用时按需读取正文及附属文件。
- **BREAKING** 新模型工具定义中的 `shell_run`、`python_run`、`node_run` 统一只接收非空 `script` 源码和可选 `args`，新增同样输入的 `ts_run`。Runtime 按模型选择的工具决定解释器，经标准输入传入源码，不猜测语言；旧调用记录仅供历史展示，不重新执行。
- 包内 Node 运行 TypeScript 首版只保证其原生类型擦除支持；保留包内 Python、Node、macOS Shell 的超时、取消、输出限制与离线能力。
- 修正现有未归档的 `manage-agent-skills` 规划与本变更之间的 `executor` 门槛冲突，保留其已完成的主提示词和文件管理成果，不重做无关页面工作。

## Capabilities

### New Capabilities

- `instruction-skill-installation`: 定义本地 Skill 目录、安装、启停、按需读取、设置页与 Agent 安装工具的可观察行为。

### Modified Capabilities

- `agent-skill-boundary`: 将普通指令型 Skill 与可执行工具授权解耦，并保留 Browser/Computer 既有能力边界。
- `bundled-script-runtimes`: 把脚本工具改为四个按工具名选择解释器的源码输入接口，并增加 TypeScript 行为。

## Impact

- Runtime：`AgentFileStore` 的声明解析与安装流程、流式任务的 Skill 发现、按需读取工具、脚本 Tool Registry、`runProcess` 标准输入、包内解释器分派。
- Desktop：Skill 列表和详情、安装入口、错误与启停状态；服务契约和 Mock 随之更新。
- 契约与迁移：Skill DTO、安装输入、脚本工具 Schema 及版本更新；现有 `SKILL.md`、`.disabled` 和历史任务记录保留。既有 `executor` 字段只承担旧能力映射，不再决定普通 Skill 是否可启用。
- 规划关系：本变更替代 `manage-agent-skills` 中“无已注册 executor 则 Skill 不可用”的决定；实施前须同步修订该仍在进行的变更，避免两套互相矛盾的验收标准。

## Battle Status

- 类型：产品与架构混合决策；状态：已完成，用户明确裁决。
- 目标：普通 Skill 可从 GitHub 或本地安装并在任务中生效；脚本调用只传源码，由所选工具决定语言。
- 已检查：现有本地目录、文件服务、工具注册、流式任务的空 Skill 列表、包内 Python/Node 与 TypeScript 原生支持范围。
- 替代方案：保留 `executor` 门槛只补安装 UI，改动较小但多数说明型 Skill 仍无法使用；单一脚本工具自动猜语言则对多语言共通语法不确定。用户选择指令型 Skill 与独立脚本工具。
- 已知权衡：源码输入不自带脚本所在目录；首版 TypeScript 不支持完整 `tsconfig` 转换和第三方依赖；安装远程 Skill 会引入外部内容。方案以明确错误、原子安装、现有工具策略和按需加载控制这些风险。
