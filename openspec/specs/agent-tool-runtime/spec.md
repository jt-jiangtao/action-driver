# agent-tool-runtime Specification

## Purpose

定义 Agent 发现、选择、校验和执行可替换工具的统一行为，使不同工具共享权限、生命周期、取消、日志和模型续跑机制，而不把具体执行实现耦合到模型适配器或界面。

## Requirements

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
系统 SHALL 对本轮已授予且通过工具定义、名称与参数校验的调用自动执行，并以 `proposed`、`queued`、`running`、`completed`、`failed`、`cancelled` 表达新工具调用，为每次状态变化发布可序列化事件。系统 MUST NOT 为新调用产生 `waiting_approval` 或等待人工批准；未授予、未注册、名称不匹配或输入无效的调用 MUST 在执行器运行前失败。旧 `waiting_approval` 历史事件 SHALL 可只读解析，且不得因升级自动执行仍悬挂的旧调用。

#### Scenario: 已授权 Shell 与 Web Search 自动运行
- **WHEN** 模型请求本轮已授予的受限 Shell 或 Web Search，且参数通过校验
- **THEN** 调用无需人工操作，按 `proposed → queued → running → completed|failed` 转移，结果继续交回模型

#### Scenario: 自动允许的只读工具
- **WHEN** 本轮已授予的只读文件工具通过定义与参数校验
- **THEN** 调用无需人工操作，按 `proposed → queued → running → completed|failed` 转移

#### Scenario: 需要批准的工具
- **WHEN** 旧策略原本要求逐次批准的 Shell 或网络工具已获本轮授权并通过校验
- **THEN** 新策略不再产生 `waiting_approval`，调用直接进入 `queued`

#### Scenario: 用户拒绝工具
- **WHEN** Runtime 回放旧任务中已经持久化的用户拒绝事件
- **THEN** 该事件只作为历史终态显示，不能重新触发执行或审批

#### Scenario: 未授权或无效调用
- **WHEN** 模型请求未授予工具、名称不匹配的工具或无效参数
- **THEN** Runtime 记录失败且不得运行执行器

#### Scenario: 旧审批记录恢复
- **WHEN** Runtime 读取历史 `waiting_approval` 事件或升级时发现仍悬挂的旧审批
- **THEN** 历史顺序仍可读取，悬挂调用安全结束且执行器不得运行

### Requirement: 传播取消和超时
系统 MUST 将任务取消、用户取消和工具超时传播给当前执行器，且不得把“已请求取消”记录成“已取消完成”。

#### Scenario: 运行中取消任务
- **WHEN** 用户在工具执行期间取消当前任务
- **THEN** Runtime 中止执行器并等待其终态，再发布 `cancelled` 或实际失败状态

#### Scenario: 工具执行超时
- **WHEN** 工具超过定义的执行超时
- **THEN** Runtime 中止执行并记录 `TOOL_TIMEOUT`，随后按失败结果继续或终止模型循环

### Requirement: 分离正文、运行事件和聚合日志
系统 MUST 将工具执行进度记录为运行事件，将单次工具调用记录为一条可关联请求与结果的聚合日志，并禁止把工具进度文字混入助手正文或把每个输出分片记录成独立接口日志。Runtime MUST 以持久化 `cursor` 排列的活动事件关联正文、工具和文件变更：活动事件包含稳定 `activityId`，每个实际工具调用 MUST 关联执行时的活动 id 和稳定 `callId`，标题更新包含单调递增的 `titleRevision`。Agent Graph MUST 在运行流程中创建和按规则更新活动标题，不得向模型暴露 `activity_update` 元工具或为活动更新生成合成工具结果。Runtime MUST 在首个外部工具调用前创建受控活动事件，并将后续连续工具调用及关联正文绑定到该活动，直到下一活动或 Turn 结束。事件 MUST 在持久化后广播；首个工具事件决定其展示位置，后续工具输出 MUST 更新同一调用项。本地 Runtime 原始 I/O SHALL 允许该聚合记录向任务活动界面提供输入输出，且不得以 `NODE_ENV` 改变该行为。Runtime 的恢复快照 MUST 包含一致高水位 cursor、活动、关联工具、正文顺序和原始 I/O 边界；完整模型调用日志的保留、脱敏与展示策略不在本 requirement 中定义。

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

#### Scenario: 正文与工具交错
- **WHEN** 模型先后产生正文 A、工具 A、正文 B 和工具 B
- **THEN** 实时流、重连回放与快照恢复均按持久化 cursor 保持该顺序，工具结果仅更新对应 `callId` 的原位置

#### Scenario: 查询日志页面
- **WHEN** 客户端调用日志查询控制面
- **THEN** 系统继续排除 `actiondriver:log:list` 等日志读取操作，避免日志递归记录自身
