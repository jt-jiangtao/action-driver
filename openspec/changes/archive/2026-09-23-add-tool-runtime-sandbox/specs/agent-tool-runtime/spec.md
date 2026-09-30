## Purpose

定义 Agent 发现、选择、校验和执行可替换工具的统一行为，使不同工具共享权限、生命周期、取消、日志和模型续跑机制，而不把具体执行实现耦合到模型适配器或界面。

## ADDED Requirements

### Requirement: 注册版本化工具定义
系统 MUST 只向模型暴露本轮已启用的版本化工具定义；每个定义 MUST 包含稳定工具标识、模型可用名称、描述、输入 JSON Schema、风险等级、副作用分类和执行超时，且模型名称 MUST 能无歧义映射回内部工具标识。

#### Scenario: 构造模型请求的工具列表
- **WHEN** Runtime 为一次模型调用构造请求
- **THEN** 请求只包含本轮启用且策略允许发现的工具，并且每个输入 schema 都可序列化和校验

#### Scenario: 模型请求未知工具
- **WHEN** 模型返回未注册、未启用或版本不匹配的工具名称
- **THEN** Runtime 拒绝执行并产生稳定的 `TOOL_UNAVAILABLE` 结构化错误，不尝试猜测相近工具

### Requirement: 校验工具调用输入
系统 MUST 在调用执行器之前依据工具定义校验完整参数；无效 JSON、缺少必填字段、未知字段或类型错误 MUST 终止该次调用且不得产生执行副作用。

#### Scenario: 工具参数不符合 schema
- **WHEN** 模型返回的工具参数无法解析或不符合已注册 schema
- **THEN** Runtime 记录 `TOOL_INPUT_INVALID` 终态并将结构化错误作为工具结果交回模型

### Requirement: 执行模型与工具循环
系统 SHALL 支持模型返回一个或多个工具调用、逐一执行并把每个结果关联到原始 tool call id 后再次调用模型，直到模型产生面向用户的最终文本或达到调用预算。

#### Scenario: 单个工具调用后生成答案
- **WHEN** 模型先请求工具且工具成功返回结果
- **THEN** Runtime 把工具结果加入同一任务上下文并继续模型调用，最终只把模型生成的最终文本作为助手正文

#### Scenario: 模型返回多个工具调用
- **WHEN** 同一模型响应包含多个合法工具调用
- **THEN** Runtime 为每个调用创建独立 call id，按确定顺序执行并将全部结果关联回对应的 provider tool call id

#### Scenario: 超过工具调用预算
- **WHEN** 单次任务超过配置的最大工具轮次或最大调用数量
- **THEN** Runtime 停止继续调用并以 `TOOL_BUDGET_EXCEEDED` 失败，不进入无限模型循环

### Requirement: 统一工具调用生命周期
系统 SHALL 以 `proposed`、`waiting_approval`、`queued`、`running`、`completed`、`failed`、`cancelled` 表达工具调用，并为每次状态变化发布可序列化事件。

#### Scenario: 自动允许的只读工具
- **WHEN** 只读工具通过策略校验且不需要用户批准
- **THEN** 调用按 `proposed → queued → running → completed|failed` 转移并发布对应事件

#### Scenario: 需要批准的工具
- **WHEN** 策略判定工具需要明确用户批准
- **THEN** 调用进入 `waiting_approval`，在收到匹配 call id 的批准前不得进入 `queued`

#### Scenario: 用户拒绝工具
- **WHEN** 用户拒绝处于 `waiting_approval` 的调用
- **THEN** 调用进入 `cancelled`，执行器不得运行，拒绝结果作为结构化工具结果交回模型

### Requirement: 传播取消和超时
系统 MUST 将任务取消、用户取消和工具超时传播给当前执行器，且不得把“已请求取消”记录成“已取消完成”。

#### Scenario: 运行中取消任务
- **WHEN** 用户在工具执行期间取消当前任务
- **THEN** Runtime 中止执行器并等待其终态，再发布 `cancelled` 或实际失败状态

#### Scenario: 工具执行超时
- **WHEN** 工具超过定义的执行超时
- **THEN** Runtime 中止执行并记录 `TOOL_TIMEOUT`，随后按失败结果继续或终止模型循环

### Requirement: 分离正文、运行事件和聚合日志
系统 MUST 将工具执行进度记录为运行事件，将单次工具调用记录为一条可关联请求与结果的聚合日志，并禁止把工具进度文字混入助手正文或把每个输出分片记录成独立接口日志。

#### Scenario: 工具流式输出
- **WHEN** 执行器产生多个内容分片
- **THEN** WebSocket 以同一 call id 发送有序 `tool.start / tool.content / tool.end|tool.error` 事件，日志只保存一条聚合调用记录

#### Scenario: 查询日志页面
- **WHEN** 客户端调用日志查询控制面
- **THEN** 系统继续排除 `action-driver:log:list` 等日志读取操作，避免日志递归记录自身
