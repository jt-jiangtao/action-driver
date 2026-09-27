## ADDED Requirements

### Requirement: Plugin owned tools follow runtime policy
Runtime SHALL 将插件工具绑定插件 ID、版本与实例，并继续执行现有输入校验、grants、可用性、超时、取消、事件和恢复规则。可信插件安装 SHALL 不自动扩大任务工具授权。

#### Scenario: Installed tool without grant
- **WHEN** 插件已启用但当前任务未授权其工具
- **THEN** 该工具不进入任务可调用集合，直接调用也被拒绝

#### Scenario: Plugin deactivates
- **WHEN** 插件进入停用或失败状态
- **THEN** 新调用不能解析到该插件，在途调用仍绑定原版本且不会静默切换实现

#### Scenario: Stale plugin instance reports result
- **WHEN** 已被回收的插件实例发送迟到消息
- **THEN** Runtime 不允许该消息重建贡献或覆盖另一实例的调用结果
