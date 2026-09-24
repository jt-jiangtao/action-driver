## ADDED Requirements

### Requirement: 从 LangSmith 会话视图浏览模型层日志
系统 SHALL 在模型层日志入口保持会话视图、任务视图、状态筛选、关键词搜索和自动刷新，但其成功数据 SHALL 全部来自 LangSmith 会话摘要。会话行 SHALL 展示名称、会话标识、开始时间、状态、总耗时、任务数和内嵌详情操作；展开后 SHALL 显示任务名称、开始时间、状态、耗时、模型和内嵌详情操作。

#### Scenario: 浏览并筛选 LangSmith 会话
- **WHEN** 用户在模型层日志中切换会话/任务视图或修改关键词、状态筛选
- **THEN** 页面仅基于已读取的 LangSmith 会话摘要展示匹配项，并保持现有筛选和刷新交互

#### Scenario: 打开模型层日志失败
- **WHEN** 模型层日志服务无法读取 LangSmith
- **THEN** 页面显示错误和重试入口，不显示示例、本地投影或内嵌调用详情

### Requirement: 从模型层列表查看内嵌详情
用户选择会话或任务的“查看详情”后，系统 SHALL 在应用内隔离视图加载关联的 LangSmith 详情地址，而不是在日志主内容区呈现自制调用详情。关闭详情后系统 SHALL 保留此前可合理恢复的会话列表、筛选和展开状态。

#### Scenario: 会话详情跳转
- **WHEN** 用户选择会话行的“查看会话详情”
- **THEN** 系统在应用内展示该会话的 LangSmith 页面，关闭后模型层日志仍显示原会话列表

#### Scenario: 任务详情跳转
- **WHEN** 用户展开会话后选择任务行的“查看详情”
- **THEN** 系统在应用内展示该任务的 LangSmith 页面，关闭后模型层日志仍显示原会话列表

## REMOVED Requirements

### Requirement: 用确定性 Mock 展示模型层运行记录
**Reason**: 模型层日志的唯一事实来源已改为 LangSmith，Mock 数据会造成与真实追踪不一致的双重来源。
**Migration**: 测试改用可控的 LangSmith 查询适配器；生产页面读取 LangSmith 会话摘要。

### Requirement: 以全页结构查看模型会话详情
**Reason**: 调用详情由 LangSmith UI 承载，应用不再复制和维护详情界面。
**Migration**: 列表详情操作改为在隔离视图加载经验证的 LangSmith 地址。

### Requirement: 导航动态模型调用链并查看完整数据
**Reason**: 动态调用树、输入输出与元数据以 LangSmith UI 为准，避免在应用中产生不完整副本。
**Migration**: 用户通过会话或任务详情操作在内嵌 LangSmith 页面查看调用树和完整数据。
