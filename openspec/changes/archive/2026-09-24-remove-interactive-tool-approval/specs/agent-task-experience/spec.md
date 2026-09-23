## REMOVED Requirements

### Requirement: 输入框上方呈现工具审批
**Reason**: 新工具调用无需人工审批，审批条不再是可到达的活跃界面状态。
**Migration**: 移除审批条及允许/拒绝操作；旧审批记录仅在历史过程里只读呈现。

## ADDED Requirements

### Requirement: 工具自动执行期间输入区保持可用
系统 SHALL 在已授权工具自动执行时继续呈现任务过程和输入框，不得显示要求用户允许或拒绝的工具审批控件。

#### Scenario: Shell 和 Web Search 正在自动执行
- **WHEN** 工具由 Runtime 直接排队或运行
- **THEN** 用户看到关联活动中的工具行和正常输入区，不需要点击允许一次或拒绝

#### Scenario: 查看旧审批历史
- **WHEN** 用户打开包含历史 `waiting_approval` 事件的已完成任务
- **THEN** 页面可回看原工具过程，但不显示可操作的审批按钮
