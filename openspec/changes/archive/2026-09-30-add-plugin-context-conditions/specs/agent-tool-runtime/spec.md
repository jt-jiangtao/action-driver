## ADDED Requirements

### Requirement: Context conditioned plugin tool discovery and execution
Runtime SHALL 仅在插件工具满足声明式条件和现有任务策略时将其加入模型本轮可用工具集合。模型或其他入口直接请求工具时，Runtime MUST 在执行器运行前重新检查条件与原有 grants；条件变化不得撤销已开始调用的版本绑定、取消和结果未知语义。

#### Scenario: 工具在发现后变为不可用
- **WHEN** 模型已看到某插件工具，但执行前其条件变为 false
- **THEN** Runtime 以结构化不可用错误结束新调用，不运行工具执行器

#### Scenario: 条件为真但任务未授予
- **WHEN** 插件工具条件为 true，而当前任务未授予该工具
- **THEN** 工具不进入模型可用集合，直接调用也被拒绝

#### Scenario: 在途调用期间条件变化
- **WHEN** 工具调用已开始后条件变为 false
- **THEN** 在途调用仍按原有版本固定、取消和终态规则完成，新调用被拒绝
