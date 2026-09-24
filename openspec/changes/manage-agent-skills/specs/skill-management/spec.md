## Purpose

定义本地主提示词与 Skill 文件的管理、持久化和运行时读取行为，使用户能在统一设置区域控制 Agent 的基础指令和可用能力，同时保持 `~/.action-driver` 文件目录为唯一事实来源。

## ADDED Requirements

### Requirement: Runtime 持有本地 Agent 配置
系统 SHALL 由本地 Runtime 通过受限文件服务持有并持久化全局主提示词与 Skill 文件；主提示词 SHALL 存放在 `~/.action-driver/prompts/main.md`，Skill SHALL 存放在 `~/.action-driver/skills/<skill>/`；Renderer MUST NOT 以页面内置 Mock、数据库、`localStorage` 或独立 JSON 注册表替代生产事实来源；测试环境 MAY 注入确定性替身。

#### Scenario: 重启后恢复配置
- **WHEN** 用户保存主提示词或改变 Skill 状态后重启应用
- **THEN** 页面与 Runtime 恢复最近一次成功保存的本地配置

#### Scenario: 生产环境读取配置
- **WHEN** 生产应用打开主提示词或 Skills 设置页
- **THEN** 页面从 Runtime 提供的真实本地服务加载数据，不填充页面内置示例记录

#### Scenario: 测试环境替换服务
- **WHEN** 组件测试或视觉验收需要稳定复现加载、空、成功或失败状态
- **THEN** 测试组合根可以替换相同服务契约，而不改变生产组合根的数据来源

### Requirement: 编辑全局主提示词
系统 SHALL 提供一个全局生效的主提示词设置，在单个编辑面板中支持 Markdown 实时渲染与 Monaco 源码模式、显式保存、恢复默认值，并 SHALL 在存在未保存修改时给出清晰提示。

#### Scenario: 编辑并预览主提示词
- **WHEN** 用户在实时编辑模式修改主提示词
- **THEN** 同一个编辑面板直接渲染当前 Markdown 草稿，且渲染操作不被视为保存

#### Scenario: 切换源码模式
- **WHEN** 用户切换到源码模式
- **THEN** 同一编辑区域使用 Monaco 展示当前 Markdown 源码，不创建第二份输入内容

#### Scenario: 保存主提示词
- **WHEN** 用户保存有效的主提示词
- **THEN** Runtime 持久化该内容，页面清除未保存状态，并在后续任务启动时读取新内容

#### Scenario: 保存失败
- **WHEN** Runtime 无法保存主提示词
- **THEN** 页面保留当前草稿与未保存状态，展示可诊断错误和重试操作

#### Scenario: 恢复默认值
- **WHEN** 用户确认恢复默认主提示词
- **THEN** Runtime 保存内置默认内容，页面更新编辑器与预览并清除未保存状态

#### Scenario: 带未保存修改离开
- **WHEN** 用户修改主提示词后尝试离开页面且尚未保存
- **THEN** 系统提示用户保存、放弃或取消离开，不静默丢失草稿

### Requirement: Runtime 管理 Skill 文件目录
系统 SHALL 由 Runtime 枚举和管理 `~/.action-driver/skills/<skill>/`；每个 Skill SHALL 以目录和 `SKILL.md` 为声明来源，并 MAY 包含 references、scripts 等子目录。Runtime SHALL 规范化并校验真实路径，MUST 拒绝目录穿越和越出 Skill 根目录的符号链接访问。

#### Scenario: 列出可用 Skill
- **WHEN** 客户端请求 Skill 列表
- **THEN** Runtime 返回 Skill 目录、文件树、解析后的声明与执行器状态

#### Scenario: 注册自定义 Skill
- **WHEN** 用户新增一个自定义 Skill
- **THEN** Runtime 校验目录名唯一后创建目录与 `SKILL.md`，并在列表中返回

#### Scenario: 重复标识
- **WHEN** 用户新增与既有 Skill 相同标识的定义
- **THEN** Runtime 拒绝并返回可诊断错误，不覆盖既有目录

#### Scenario: 内置 Skill 只读
- **WHEN** 用户尝试删除或重命名受保护的内置 Skill
- **THEN** Runtime 拒绝操作并保留原文件

#### Scenario: 保存 Skill 文件
- **WHEN** 用户保存 Skill 目录内的文本文件
- **THEN** Runtime 使用临时文件和原子替换保存，并返回新的修改时间或内容摘要

### Requirement: 管理 Skill 生命周期
系统 SHALL 允许启用与停用普通说明型 Skill，并 SHALL 在停用后阻止 Agent 读取该 Skill；删除自定义 Skill MUST 清理其定义并从列表移除。系统 MAY 从 `SKILL.md` 的可选 `executor` frontmatter 读取既有运行时执行器 ID，目录名 MUST NOT 被隐式当作执行器 ID。没有 executor 的有效普通 Skill SHALL 可启用；任何 Skill 的启用 MUST NOT 授予可执行工具权限。

#### Scenario: 解析执行器映射
- **WHEN** 一个 Skill 的 `SKILL.md` 声明 `executor: browser-use` 且该执行器已注册
- **THEN** Skill 列表返回该执行器 ID 供诊断；是否能调用对应工具仍由 Tool Registry 与 Policy Gate 决定

#### Scenario: 目录名与执行器 ID 不同
- **WHEN** `browser-tools` 目录的 `SKILL.md` 映射到 `browser-use`
- **THEN** 系统保留目录名作为 Skill 配置标识，并使用 `browser-use` 作为运行时能力标识，不重命名目录

#### Scenario: 执行器未注册
- **WHEN** Skill 缺少 `executor` 映射或映射到当前未注册的执行器
- **THEN** 普通说明内容仍可启用，但任务上下文不因此暴露该执行器能力

#### Scenario: 停用后不可调用
- **WHEN** 一个 Skill 被停用
- **THEN** 后续任务不向模型暴露该能力，并且 Agent 绕过规划直接调用时仍收到可诊断的能力不可用结果，而不是静默失败

#### Scenario: 任务使用启动时技能快照
- **WHEN** 用户启动一个任务
- **THEN** Runtime 从本地 Skill 目录生成已启用说明型 Skill 的摘要快照，执行器可用性仍由独立工具注册与策略决定

#### Scenario: 删除自定义 Skill
- **WHEN** 用户删除一个自定义 Skill
- **THEN** 服务端移除定义，列表不再返回该 Skill

### Requirement: 页面提供 Skill 管理入口
系统 SHALL 在设置侧栏提供 Skills 页面，使用仓库式列表展示 Skill 名称、路径、来源与执行器状态；选择 Skill 后 SHALL 使用左侧文件树与右侧单编辑面板展示目录内容。应用主侧栏 Skills 入口 SHALL 打开同一页面，MCP 入口 MUST 保持可见但不打开页面。

#### Scenario: 打开 Skill 管理页
- **WHEN** 用户点击设置侧栏或应用主侧栏的 Skills
- **THEN** 页面展示同一份 Skill 列表与操作，并保持设置导航与数据状态一致

#### Scenario: 查看 Skill 详情
- **WHEN** 用户选择一个 Skill
- **THEN** 页面展示文件树、保存状态、执行器状态和所选文件内容，不执行该 Skill

#### Scenario: 点击 MCP
- **WHEN** 用户点击侧栏 MCP
- **THEN** 当前页面保持不变，不创建占位流程

#### Scenario: 页面不直接调用实现
- **WHEN** 页面展示或改变 Skill 状态
- **THEN** 请求经由服务端接口完成，页面不导入任何 Skill 具体实现

### Requirement: 设置内容区还原 ActionDriver 主题并使用一致布局
系统 SHALL 引用唯一的既有 248px 设置侧栏，并 SHALL 以已确认的 ActionDriver 生图和现有设置页主题 Token 为视觉基准。右侧内容 SHALL 使用页面内局部 Auto Layout 管理标题操作区、路径栏、编辑器工具栏、筛选栏、表格、分页和抽屉；组件复用 MUST NOT 改变生图的信息层级、密度或按钮形态。页面每组操作 SHOULD 最多包含一个 Primary 按钮。

日志页为视觉例外：系统 SHALL 保留同一设置侧栏与日志信息架构，但日志右侧内容区 SHALL 使用 Codex 式纯白画布和中性灰分隔，蓝色 SHOULD 仅用于选中态、链接与必要主操作；下拉打开与关闭状态 SHALL 使用同一 Chevron 图标体系。

#### Scenario: 显示页面标题与操作
- **WHEN** 用户打开主提示词或 Skills 设置页
- **THEN** 页面在统一标题区展示标题、说明和右对齐操作，主内容从同一水平基线开始

#### Scenario: 显示下拉选择
- **WHEN** 页面需要选择编辑模式、过滤条件或排序
- **THEN** 使用与现有设置页主题一致、具有当前值和右侧下拉指示的选择控件或操作菜单，不使用无边界漂浮文本

#### Scenario: 调整窗口宽度
- **WHEN** 内容区域宽度变化
- **THEN** 页面依赖布局约束重新排布，按钮、下拉框和编辑器不通过固定绝对坐标互相覆盖

### Requirement: 首版不执行任意 Skill 脚本
系统 MUST 允许启用没有 executor 的有效普通 Skill；自定义 Skill 声明 MUST NOT 被页面直接解释为可执行脚本，启用 SHALL NOT 自动授予工具权限。

#### Scenario: 自定义 Skill 没有执行器
- **WHEN** 用户查看或启用一个只有声明但没有已注册执行器的自定义 Skill
- **THEN** 页面允许启用说明内容，Runtime 仍拒绝未授权工具调用并返回可诊断结果
