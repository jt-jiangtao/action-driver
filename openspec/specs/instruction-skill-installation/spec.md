# instruction-skill-installation Specification

## Purpose

定义普通指令型 Skill 的本地安装、发现、启停和按需读取行为，让用户能从 GitHub 或本地文件夹导入包含 `SKILL.md` 的内容包，并在后续任务中可靠使用，而不要求 Skill 声明可执行器。

## Requirements

### Requirement: 固定目录中的普通 Skill 可用
系统 SHALL 将个人 Skill 保存到固定的应用管理目录，每个 Skill 占用独立子目录并以 `SKILL.md` 为入口。有效的普通 Skill MUST 能独立于 `executor` 字段被启用；Skill 正文和附属文件 MUST 留在本地目录中。

#### Scenario: 安装纯说明型 Skill
- **WHEN** 用户导入包含有效 `SKILL.md`、但没有 `executor` 声明的文件夹
- **THEN** 系统将其列为可启用的个人 Skill，并保留其 Markdown 和附属文件

#### Scenario: 重启后恢复个人 Skill
- **WHEN** 应用重启并重新扫描固定目录
- **THEN** 已安装 Skill 及其启停状态与重启前一致

### Requirement: 系统 Skill 使用独立受保护目录
系统 SHALL 将内置 Skill 存放于固定 Skill 根目录下的 `.system/<id>`，并在列表中标明系统来源。系统 Skill 的正文和附属文件 MUST 可供已启用任务读取；设置页 MUST 禁止编辑、重命名和卸载系统 Skill，但 SHALL 允许启停。普通 Skill 的安装 MUST NOT 写入 `.system` 或占用系统 Skill 标识。

#### Scenario: 查看系统 skill-creator
- **WHEN** 用户查看 `.system/skill-creator`
- **THEN** 设置页展示只读内容和系统来源，Agent 可在启用后按需读取其创建 Skill 的说明

#### Scenario: 系统与个人 Skill 共同展示
- **WHEN** 用户打开 Skills 设置列表
- **THEN** 系统和个人 Skill 都以统一行样式展示名称、单行摘要、来源和启停开关；打开行可在详情弹层查看完整内容

#### Scenario: 系统内容受保护
- **WHEN** 用户或安装工具尝试修改、卸载或覆盖系统 Skill
- **THEN** Runtime 拒绝内容变更并保留原文件，启停操作仍可生效

### Requirement: 迁移现有内置 Skill
系统 MUST 将旧根目录中的 `browser-tools`、`computer-tools`、`report-writer` 迁至 `.system`，保留其 `SKILL.md`、附属文件和启停状态；迁移失败或目标冲突 MUST 保留原内容且不得静默覆盖。

#### Scenario: 首次升级旧安装
- **WHEN** 用户的旧根目录存在已修改的内置 Skill 且 `.system` 尚无对应目标
- **THEN** 初始化后系统 Skill 位于 `.system/<id>`，原正文、附属文件和 `.disabled` 状态保持一致

#### Scenario: 迁移目标已有内容
- **WHEN** 旧根目录和 `.system` 同时存在同一内置 Skill 标识
- **THEN** 系统保留两份内容，明确区分系统版本与旧目录副本，不覆盖任一版本

### Requirement: 系统 skill-creator 指导创建普通 Skill
系统 SHALL 提供内置 `skill-creator` 作为指令型 Skill。它 MUST 指导 Agent 在工作区创建带有效 `SKILL.md` 的普通 Skill 文件夹，并通过现有安装工具导入个人目录；创建过程 MUST 服从当前脚本工具和权限策略，不要求额外 `skill_create` 执行器。

#### Scenario: 用户要求创建 Skill
- **WHEN** 用户要求 Agent 创建可复用 Skill 且系统 Skill 已启用
- **THEN** Agent 可发现并读取 `skill-creator`，使用现有工具完成内容创建与导入，而无需专门的创建工具

### Requirement: 从 GitHub 或本地文件夹安装
系统 SHALL 支持从 GitHub 仓库中的 Skill 子目录和用户选择的本地文件夹安装。安装 MUST 校验入口及目录内容，成功后完整呈现 Skill；失败时 MUST 给出可理解的原因且不留下半安装目录。目标名称冲突 MUST 拒绝并提示，不得静默覆盖现有 Skill。

#### Scenario: GitHub 子目录安装成功
- **WHEN** 用户提供可访问的 GitHub 仓库及其中含有效 `SKILL.md` 的子目录
- **THEN** 系统将该子目录的 Skill 内容安装到固定目录，并在列表中标出 GitHub 来源

#### Scenario: 从本地文件夹安装成功
- **WHEN** 用户选择包含有效 `SKILL.md` 的本地文件夹
- **THEN** 系统复制所需内容到应用管理目录，并在列表中标出本地来源

#### Scenario: 无效或重名安装
- **WHEN** 来源缺失 `SKILL.md`、内容不合法，或目标 Skill 名称已经存在
- **THEN** 系统返回具体错误，原有 Skill 不变且不出现部分安装结果

### Requirement: 设置页管理个人 Skill
设置页 SHALL 展示已安装 Skill 的名称、简短说明、来源和启用状态，允许查看 Markdown 正文及附属文件，并提供添加、启停、打开目录、复制 Markdown 和卸载操作。卸载 MUST 明确作用于该 Skill 的应用管理目录。

#### Scenario: 查看并停用 Skill
- **WHEN** 用户在列表中打开某个 Skill 的详情并将其停用
- **THEN** 详情显示其内容，列表状态更新，之后新任务不再发现该 Skill

#### Scenario: 安装后立即列出
- **WHEN** 设置页成功安装一个 Skill
- **THEN** 列表无需重启应用即可显示其名称、描述和来源

### Requirement: Agent 可以安装和按需读取 Skill
系统 SHALL 向获授权的 Agent 提供 Skill 安装工具，其 GitHub 与本地来源走与设置页相同的安装规则。新任务 SHALL 获得已启用 Skill 的名称与简短描述；Agent 在需要时 SHALL 能通过读取工具获取完整 `SKILL.md` 和允许的附属文件，停用 Skill 不得进入新任务的发现结果。

#### Scenario: Agent 使用安装工具
- **WHEN** Agent 调用 `skill_install` 导入有效 GitHub 子目录或本地文件夹
- **THEN** 返回安装结果，设置页与下一次任务均能发现同一个 Skill

#### Scenario: 按需加载正文
- **WHEN** Agent 根据发现到的 Skill 名称调用 `skill_read` 读取正文或其附属文件
- **THEN** 工具返回对应内容及可辨识的文件来源，受限于工具输出大小与路径边界

#### Scenario: 停用 Skill 不进入任务
- **WHEN** 某 Skill 已被停用且用户开始新任务
- **THEN** 初始 Skill 列表不包含该 Skill，Agent 不能通过 Skill 读取工具把它当作已启用 Skill 使用

### Requirement: Skill 文本不授予执行权限
Skill 的安装与启用 MUST NOT 自动授予 Shell、Python、Node、TypeScript 或其他工具权限，也 MUST NOT 自动安装其声明的第三方依赖。运行工具仍由独立的注册和策略控制。

#### Scenario: Skill 要求未授权工具
- **WHEN** 已启用 Skill 的 Markdown 指示 Agent 调用本轮未授权工具
- **THEN** Runtime 保持该工具不可调用，Skill 文本不能改变授权状态

### Requirement: 安装来源必须限制在选定目录内
系统 MUST 拒绝会读取选定 Skill 子目录之外文件的路径或链接，并限制导入大小；错误 MUST 保留原目标目录不变。

#### Scenario: 来源含越界链接
- **WHEN** 待安装目录包含指向其目录外的符号链接或越界路径
- **THEN** 安装失败并说明原因，外部文件不被复制到 Skill 目录
