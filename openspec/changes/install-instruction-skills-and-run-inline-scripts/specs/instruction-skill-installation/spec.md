## Purpose

定义普通指令型 Skill 的本地安装、发现、启停和按需读取行为，让用户能从 GitHub 或本地文件夹导入包含 `SKILL.md` 的内容包，并在后续任务中可靠使用，而不要求 Skill 声明可执行器。

## ADDED Requirements

### Requirement: 固定目录中的普通 Skill 可用
系统 SHALL 将个人 Skill 保存到固定的应用管理目录，每个 Skill 占用独立子目录并以 `SKILL.md` 为入口。有效的普通 Skill MUST 能独立于 `executor` 字段被启用；Skill 正文和附属文件 MUST 留在本地目录中。

#### Scenario: 安装纯说明型 Skill
- **WHEN** 用户导入包含有效 `SKILL.md`、但没有 `executor` 声明的文件夹
- **THEN** 系统将其列为可启用的个人 Skill，并保留其 Markdown 和附属文件

#### Scenario: 重启后恢复个人 Skill
- **WHEN** 应用重启并重新扫描固定目录
- **THEN** 已安装 Skill 及其启停状态与重启前一致

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
