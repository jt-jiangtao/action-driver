## ADDED Requirements

### Requirement: 工具过程遵循请求内事件顺序
系统 MUST 为活动、正文、工具生命周期及任务终态使用同一请求内持久化序号；工具条目 SHALL 保持首个生命周期事件的位置，后续同 call id 事件 SHALL 更新该条目。

#### Scenario: 并发任务与工具交错
- **WHEN** 两个任务交错发布正文与工具事件
- **THEN** 各任务的实时、重放与快照视图都保持自身事件顺序且不会因另一个任务的 cursor 间隔卡住

### Requirement: 中断工具不得自动重复执行
系统 MUST 将异常重启时结果尚未持久化的已开始工具调用呈现为未知，并 MUST NOT 自动重试该调用；用户显式重试 SHALL 创建新请求并保留旧调用记录。

#### Scenario: 本机操作中途崩溃
- **WHEN** Browser 或 Computer 操作已开始而 Runtime 在提交结果前退出
- **THEN** 用户可查看未知状态及旧调用标识，新的执行只能由显式新请求触发
