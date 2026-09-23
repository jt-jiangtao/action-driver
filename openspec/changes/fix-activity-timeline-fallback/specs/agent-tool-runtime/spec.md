## MODIFIED Requirements

### Requirement: 分离正文、运行事件和聚合日志
系统 MUST 将工具执行进度记录为运行事件，将单次工具调用记录为一条可关联请求与结果的聚合日志，并禁止把工具进度文字混入助手正文或把每个输出分片记录成独立接口日志。Runtime MUST 以可回放的有序活动事件关联正文、工具和文件变更：活动事件包含稳定 `activityId`，工具与文件事件可选关联该 id，标题更新包含单调递增的 `titleRevision`。Agent Graph MUST 拦截仅内部可见且无外部副作用的 `activity.update` 元操作，并将其转换为活动事件，而不得将它交给外部工具执行器或作为普通工具项呈现。若模型未提供活动更新，Runtime MUST 在首个外部工具调用前创建受控活动事件，并将后续连续工具调用及关联正文绑定到该活动，直到明确的下一活动或 Turn 结束。本地 Runtime 原始 I/O SHALL 允许该聚合记录向任务活动界面提供输入输出，且不得以 `NODE_ENV` 改变该行为。Runtime 的恢复快照 MUST 包含恢复任务过程所需的活动、关联工具、正文顺序和原始 I/O 边界；完整模型调用日志的保留、脱敏与展示策略不在本 requirement 中定义。

#### Scenario: 工具流式输出
- **WHEN** 执行器产生多个内容分片
- **THEN** WebSocket 以同一 call id 发送有序 `tool.start / tool.content / tool.end|tool.error` 事件，日志只保存一条聚合调用记录

#### Scenario: 本地开发查看原始输出
- **WHEN** 本地 Runtime 呈现工具记录
- **THEN** 界面可显示关联调用的原始输入输出而不改变助手正文

#### Scenario: 活动任务内的工具调用
- **WHEN** Agent Graph 为当前工作目标创建活动任务后发起工具调用
- **THEN** 工具生命周期事件携带该活动任务的 `activityId`，且重连回放保持原有 cursor 顺序

#### Scenario: 没有显式活动更新的工具调用
- **WHEN** 模型只返回一个或多个外部工具调用
- **THEN** Runtime 在发布首条工具生命周期事件前发布受控活动开始事件，并为该批次工具提供相同 `activityId`

#### Scenario: 查询日志页面
- **WHEN** 客户端调用日志查询控制面
- **THEN** 系统继续排除 `actiondriver:log:list` 等日志读取操作，避免日志递归记录自身
