## Purpose

定义 Action-Driver 将真实模型调用追踪到 LangSmith、按会话读取追踪摘要并安全关联应用内 LangSmith 详情页面的可观察性边界，使模型层日志拥有单一且可审计的事实来源。

## ADDED Requirements

### Requirement: 追踪真实模型调用到 LangSmith
当 LangSmith 配置有效时，Runtime SHALL 为每次真实模型调用创建和完成可关联的追踪记录，并 SHALL 将 Action-Driver 的会话标识、任务标识、请求标识、模型标识和终态关联到该记录。追踪 SHALL 包含执行所需的输入、输出、错误、用量和耗时；鉴权凭据 MUST NOT 写入追踪。

#### Scenario: 成功的流式模型调用
- **WHEN** Runtime 收到一条真实模型调用的最终成功结果
- **THEN** LangSmith 中存在与该调用关联的一条完成记录，包含关联标识、最终输入输出、可用用量和耗时，且不包含 API Key 或鉴权头

#### Scenario: 失败的模型调用
- **WHEN** 模型调用以错误终止
- **THEN** LangSmith 中对应记录标记为失败并包含安全化错误信息，Runtime 仍按原有任务失败语义处理该错误

### Requirement: 按 LangSmith 会话读取模型日志摘要
模型层日志服务 SHALL 从 LangSmith 返回的追踪记录构造会话列表，并 SHALL 以 Action-Driver 会话标识聚合其任务摘要。列表 SHALL 提供会话名称、会话标识、开始时间、状态、总耗时、任务数及每个任务的模型和状态；MUST NOT 以本地模型调用存储或 Mock 记录补足、替换或伪装成功响应。

#### Scenario: 查询有追踪记录的会话
- **WHEN** 用户打开模型层日志且 LangSmith 返回属于已配置项目的追踪记录
- **THEN** 系统按会话显示映射后的真实摘要，并允许展开会话查看任务行

#### Scenario: LangSmith 返回空结果
- **WHEN** LangSmith 查询成功但没有可显示的追踪记录
- **THEN** 系统返回空会话集合，界面显示明确空状态

#### Scenario: LangSmith 查询失败
- **WHEN** LangSmith 不可达、未配置或拒绝查询请求
- **THEN** 系统返回可诊断的读取错误和重试机会，且不显示本地或 Mock 模型日志

### Requirement: 提供安全的 LangSmith 内嵌详情
模型层日志服务 SHALL 为每个可展示的会话和任务提供其 LangSmith 详情地址。桌面端 SHALL 仅在该地址为 HTTPS、属于已配置 LangSmith Web 端点并对应当前查询结果时，在隔离的 `WebContentsView` 中加载它；不符合这些条件的地址 MUST 被拒绝且不得导航当前应用窗口。远程视图 MUST NOT 获得 Node 集成、应用 preload 或任意 IPC 能力，并 SHALL 拒绝非 HTTPS 导航及新窗口请求。

#### Scenario: 打开会话详情
- **WHEN** 用户选择模型会话的详情操作且存在经验证的 LangSmith 地址
- **THEN** 应用内隔离视图展示该 LangSmith 页面，关闭后保留模型层日志列表状态

#### Scenario: 拒绝不可信详情地址
- **WHEN** 详情地址不是 HTTPS、与已配置的 LangSmith Web 端点不匹配，或未关联当前查询结果
- **THEN** 系统拒绝打开该地址并向用户显示可诊断错误
