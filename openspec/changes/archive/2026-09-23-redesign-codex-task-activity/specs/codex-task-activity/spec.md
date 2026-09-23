## Purpose

定义本地 Runtime Agent 的 Codex 风格活动时间线：运行中可检查正文、动态任务和原始 I/O，结束后过程可折叠回看而结论保持清晰。

## ADDED Requirements

### Requirement: 动态活动任务与有序正文
系统 SHALL 将一个 Turn 呈现为按 cursor 排列的正文片段和动态活动任务，而不是固定工具类别或每次 LLM 调用的卡片。活动任务 MUST 具有稳定 `activityId`，且可混排正文、网页搜索、文件读取、Shell 与文件编辑事件。

#### Scenario: 异构工具属于同一工作目标
- **WHEN** Agent 为同一受控任务摘要依次读取文件、搜索网页并运行命令
- **THEN** 客户端在同一个活动任务中按发生顺序显示这些事件

#### Scenario: 正文位于任务之间
- **WHEN** Runtime 发送没有 `activityId` 的可见正文事件
- **THEN** 客户端在相邻活动任务之间将其呈现为独立正文片段

### Requirement: 活动任务标题可修订
系统 MUST 允许 Agent Graph 为活动任务提供面向用户的受控摘要，并以稳定 `activityId` 和单调递增的 `titleRevision` 更新标题；该摘要 MUST NOT 是原始思维链。

#### Scenario: 任务标题随进展更新
- **WHEN** Runtime 为已存在的活动任务发送更高 `titleRevision` 的标题更新
- **THEN** 客户端原位更新同一任务标题，保留时间线位置、子项和展开状态

#### Scenario: 收到过时标题更新
- **WHEN** 客户端收到不高于当前版本的标题更新
- **THEN** 客户端忽略该更新

### Requirement: “正在思考”尾部状态
系统 SHALL 在初始生成、活动任务结束后等待下一次模型输出、或工具结果返回后等待模型续跑时，在活动时间线末尾显示“正在思考”状态行。该状态行不是活动任务，也 MUST NOT 在 Turn 完成后作为历史项保留。

#### Scenario: 任务间隙
- **WHEN** 上一个活动任务已经结束且尚未收到新的正文、活动任务或最终结论
- **THEN** 用户看到带低强度扫光的“正在思考”状态行

### Requirement: 结束后归档过程
系统 SHALL 在生成结束后将完整过程收进“用时 N 秒”折叠记录，并将最终结论和产物显示在其后。

#### Scenario: 查看完成任务
- **WHEN** 任务完成
- **THEN** 过程默认折叠且结论和文件变更卡保持可见

### Requirement: 本地原始 I/O 模式
系统 MUST 在本地 Runtime 链路显示工具和脚本的原始输入输出，而不得以 `NODE_ENV` 改变该行为，并 SHALL 保留可展开的记录边界。

#### Scenario: 查看 Shell 输出
- **WHEN** 用户展开 Shell 记录
- **THEN** 系统显示原始命令和输出
