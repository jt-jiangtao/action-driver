# 指令型 Skill 安装与源码脚本工具设计

## 目标与成功标准

用户可以将 GitHub 仓库子目录或本地文件夹中的普通 `SKILL.md` 安装到 ActionDriver 固定目录，启用后在新任务中被发现，并在需要时读取正文和附属文件；无需 `executor`。模型调用 Shell、Python、Node 或 TypeScript 时，只向对应独立工具提交脚本源码文本与可选参数。无系统 Python/Node 的机器仍可运行包内解释器支持范围内的脚本。

验收时需要看到：两种来源安装及错误回滚、设置页和 Agent 入口一致、停用后新任务不发现、Markdown 不授予工具权限、四种语言选择正确、取消与超时可靠、旧任务记录不重放。

## 架构

`~/.action-driver/skills/<id>` 是个人 Skill 的事实来源。安装入口共用 Runtime 安装服务：解析来源到临时目录，验证 `SKILL.md`、目录边界和大小，再原子放入目标目录。既有 `.disabled` 状态沿用，既有无 frontmatter 的 Skill 继续兼容。设置页负责管理和查看；任务开始只注入已启用 Skill 的名称与短描述，`skill_read` 负责按需读取正文/附属文本。`skill_install` 调用同一安装服务。Skill 文本不会更改 Tool Registry 或 Policy Gate 的授权。

四个脚本工具使用统一 `{ script, args? }` 输入。工具名决定 `/bin/zsh`、包内 Python、包内 Node 或 Node 原生 TypeScript 类型擦除模式；源码走 stdin，默认工作目录是任务工作区。进程执行器统一负责流式输出、退出码、取消、超时和输出上限。TypeScript 首版只保证可擦除类型语法和 Node 内建模块；不提供完整编译与第三方依赖安装。

## 选择与边界

保留 `executor` 门槛只补 UI 较省改动，但普通说明型 Skill 仍无法使用；单个工具猜测语言会出现歧义。用户裁决普通 Skill 不需要 executor，脚本由四个独立工具显式选择语言。安装目录和现有目录服务继续充当事实来源，避免另建数据库注册表。远程内容、源码 stdin 无脚本目录、TypeScript 子集及历史工具契约变更是已接受的主要权衡；以目录校验、原子导入、清晰错误、版本化工具定义和只读历史处理。

## 规格与实施边界

详细行为合同和技术取舍见 [OpenSpec proposal](../../../openspec/changes/install-instruction-skills-and-run-inline-scripts/proposal.md)、[design](../../../openspec/changes/install-instruction-skills-and-run-inline-scripts/design.md) 及该变更的三个 delta spec。旧 `manage-agent-skills` 规划的 executor 必需条件须先修订。本文件供设计审阅；尚未授权修改产品代码。
