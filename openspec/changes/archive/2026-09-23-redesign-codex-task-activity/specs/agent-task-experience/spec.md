## ADDED Requirements

### Requirement: 任务页按生成状态呈现过程
系统 SHALL 在任务页按生成中和生成结束呈现不同过程视图；运行中的活动任务和工具 SHALL 提供扫光反馈，并遵循 reduced-motion 偏好。

#### Scenario: 无工具的初始生成
- **WHEN** Turn 运行且尚无正文或活动任务
- **THEN** 用户看到“正在思考”尾部状态和扫光反馈

#### Scenario: 活动任务标题更新
- **WHEN** 正在展开的活动任务收到有效的新标题
- **THEN** 任务在原位改名且保持展开状态和已显示的子项

### Requirement: 输入框上方呈现工具审批
系统 SHALL 将等待审批的工具作为输入框上方的阻塞审批条呈现，而非过程时间线节点；终态审批结果 SHALL 保留在对应活动任务内的工具项。

#### Scenario: 工具等待审批
- **WHEN** Runtime 发布 `tool.waiting_approval`
- **THEN** 输入框上方显示工具摘要、拒绝和允许一次操作

#### Scenario: 审批结束
- **WHEN** 用户批准、拒绝、超时或取消等待审批的工具
- **THEN** 审批条消失，工具项显示相应终态
