## Purpose

定义 Skill 的注册、查询、启用与删除行为，使用户能查看并管理 Agent 可用的能力，同时保持 Agent 只通过统一 Skill 契约调用能力。

## ADDED Requirements

### Requirement: 服务端持有 Skill 注册表
系统 SHALL 由服务端持有 Skill 注册表并写入本地存储，注册表项 SHALL 至少包含标识、名称、来源（内置或自定义）、状态与能力描述；内置 Skill MUST NOT 被删除或改名。

#### Scenario: 列出可用 Skill
- **WHEN** 客户端请求 Skill 列表
- **THEN** 服务端返回内置与自定义 Skill 的元数据与状态，并标记来源

#### Scenario: 注册自定义 Skill
- **WHEN** 用户新增一个自定义 Skill
- **THEN** 服务端校验标识唯一且描述完整后写入本地，并在列表中返回

#### Scenario: 重复标识
- **WHEN** 用户新增与既有 Skill 相同标识的定义
- **THEN** 服务端拒绝并返回可诊断错误，不覆盖既有定义

#### Scenario: 内置 Skill 只读
- **WHEN** 用户尝试删除或重命名内置 Skill
- **THEN** 服务端拒绝操作并保留原定义

### Requirement: 管理 Skill 生命周期
系统 SHALL 允许启用与停用 Skill，并 SHALL 在停用后阻止 Agent 调用该 Skill；删除自定义 Skill MUST 清理其定义并从列表移除。

#### Scenario: 停用后不可调用
- **WHEN** 一个 Skill 被停用
- **THEN** Agent 调用该 Skill 时收到可诊断的能力不可用结果，而不是静默失败

#### Scenario: 删除自定义 Skill
- **WHEN** 用户删除一个自定义 Skill
- **THEN** 服务端移除定义，列表不再返回该 Skill

### Requirement: 页面提供 Skill 管理入口
系统 SHALL 在侧栏 Skills 入口打开 Skill 管理页，展示 Skill 列表、来源、状态与可用操作；MCP 入口 MUST 保持可见但不打开页面。

#### Scenario: 打开 Skill 管理页
- **WHEN** 用户点击侧栏 Skills
- **THEN** 页面展示 Skill 列表与操作，并保持侧栏宽度与导航行为不变

#### Scenario: 点击 MCP
- **WHEN** 用户点击侧栏 MCP
- **THEN** 当前页面保持不变，不创建占位流程

#### Scenario: 页面不直接调用实现
- **WHEN** 页面展示或改变 Skill 状态
- **THEN** 请求经由服务端接口完成，页面不导入任何 Skill 具体实现
