## Purpose

定义任务对话中工具活动卡的分组、折叠和恢复体验，使用户能在不混入 Assistant 正文的前提下了解 Agent 正在执行或已经完成的操作。

## ADDED Requirements

### Requirement: 按生命周期分组呈现工具活动
系统 SHALL 在同一任务对话流中将工具调用分为“正在运行中”和“已完成”两个活动区。`waiting_approval`、`queued` 与 `running` 调用 MUST 位于运行区；`completed`、`failed` 与 `cancelled` 调用 MUST 位于完成区，并按其调用顺序稳定排列。

#### Scenario: 工具从执行中转为完成
- **WHEN** 某一工具调用从 `running` 进入任一终态
- **THEN** 同一 call id 的卡片从运行区移动到完成区且不创建重复卡片

### Requirement: 运行区突出当前活动
系统 SHALL 默认展开最近一个仍处于运行区的工具卡，并显示工具名称、简短参数摘要、当前状态和安全的实时进度。较早仍在运行的卡片 MUST 保持可访问但默认折叠。

#### Scenario: 同时存在多个运行调用
- **WHEN** 任务有多个尚未终态的工具调用
- **THEN** 用户看到最近调用展开，其余调用以紧凑卡片显示，且 Assistant Markdown 中不出现工具进度文本

### Requirement: 完成区提供受限详情
系统 SHALL 令终态工具卡默认折叠，并显示工具名称、终态、耗时和一行结果或错误摘要。展开后 MUST 仅呈现已清洗、受长度限制的输入、输出和错误字段。

#### Scenario: 查看成功搜索结果
- **WHEN** 用户展开已完成的 Web Search 卡片
- **THEN** 系统显示规范化且截断的查询和结果摘要，不显示原始 SearXNG JSON、认证信息或 transport 元数据

### Requirement: 批准在原活动卡内完成
系统 SHALL 在 `waiting_approval` 工具的运行卡内显示一次性允许与拒绝操作，并在批准、拒绝、陈旧批准、超时或取消后以同一 call id 更新卡片状态。

#### Scenario: 用户允许等待中的工具
- **WHEN** 用户在工具活动卡中允许当前调用
- **THEN** 卡片进入排队或运行状态，且批准操作不再重复可用

