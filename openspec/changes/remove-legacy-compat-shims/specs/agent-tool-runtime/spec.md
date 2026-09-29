## MODIFIED Requirements

### Requirement: 统一工具调用生命周期
系统 SHALL 对本轮已授予且通过工具定义、名称与参数校验的调用自动执行，并以 `proposed`、`queued`、`running`、`completed`、`failed`、`cancelled` 表达新工具调用，为每次状态变化发布可序列化事件。系统 MUST NOT 为新调用产生 `waiting_approval` 或等待人工批准；未授予、未注册、名称不匹配或输入无效的调用 MUST 在执行器运行前失败。旧 `waiting_approval` 历史事件 SHALL 可只读解析。

#### Scenario: 已授权 Shell 与 Web Search 自动运行
- **WHEN** 模型请求本轮已授予的 `shell_run`、`python_run`、`node_run` 或 Web Search，且参数通过校验
- **THEN** 调用无需人工操作，按 `proposed → queued → running → completed|failed` 转移，结果继续交回模型

#### Scenario: 自动允许的只读工具
- **WHEN** 本轮已授予的只读文件工具通过定义与参数校验
- **THEN** 调用无需人工操作，按 `proposed → queued → running → completed|failed` 转移

#### Scenario: 需要批准的工具
- **WHEN** 旧策略原本要求逐次批准的工具已获本轮授权并通过校验
- **THEN** 新策略不再产生 `waiting_approval`，调用直接进入 `queued`

#### Scenario: 用户拒绝工具
- **WHEN** Runtime 回放旧任务中已经持久化的用户拒绝事件
- **THEN** 该事件只作为历史终态显示，不能重新触发执行或审批

#### Scenario: 未授权或无效调用
- **WHEN** 模型请求未授予工具、名称不匹配的工具或无效参数
- **THEN** Runtime 记录失败且不得运行执行器

#### Scenario: 旧审批记录恢复
- **WHEN** Runtime 读取历史 `waiting_approval` 事件
- **THEN** 历史顺序仍可读取，且执行器与审批都不会被重新触发
