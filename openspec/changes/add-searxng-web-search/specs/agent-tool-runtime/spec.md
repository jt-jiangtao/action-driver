## ADDED Requirements

### Requirement: 网络搜索调用必须逐次获得批准
系统 MUST 将 Web Search 视为网络副作用工具；即使该工具已获本轮发现授权，每一次模型发起的调用仍 MUST 进入 `waiting_approval`，并把批准绑定到 task id、call id 与完整参数哈希。批准、拒绝、超时和取消后，系统 SHALL 继续沿用既有工具生命周期和模型续跑行为。

#### Scenario: 用户允许一次搜索
- **WHEN** 模型请求已启用的 Web Search 且用户批准当前调用
- **THEN** Runtime 只执行具有匹配参数哈希的该次调用，并将规范化搜索结果作为带原 provider tool call id 的工具结果交回模型

#### Scenario: 用户拒绝或参数已变更
- **WHEN** 用户拒绝搜索调用，或批准消息的 task、call 或参数哈希不匹配当前等待中的调用
- **THEN** Runtime 不发起网络请求，并以既有拒绝或陈旧批准终态处理该调用
