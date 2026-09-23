## ADDED Requirements

### Requirement: 网络搜索调用遵守当前工具执行策略
系统 MUST 将 Web Search 视为网络副作用工具，且只允许本轮已授予、配置了本地 SearXNG 服务并通过参数校验的调用。按 `remove-interactive-tool-approval` 已裁决的策略，合法调用 SHALL 无需逐次人工批准而直接执行；取消与超时仍沿用工具生命周期和模型续跑行为。

#### Scenario: 已启用搜索自动运行
- **WHEN** 模型请求已启用的 Web Search 且参数有效
- **THEN** Runtime 直接执行该次调用，并将规范化搜索结果作为带原 provider tool call id 的工具结果交回模型

#### Scenario: 未授予或参数无效
- **WHEN** 模型请求未授予的 Web Search 或参数不符合输入 Schema
- **THEN** Runtime 不发起网络请求，并把结构化错误交回模型
