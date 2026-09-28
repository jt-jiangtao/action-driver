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
系统 SHALL 支持模型返回一个或多个工具调用、逐一执行并把每个结果关联到原始 tool call id 后再次调用模型，直到模型产生面向用户的最终内容或达到调用预算。最终内容可以包含文本和由工具生成的图片引用；图片字节不得作为工具文本结果或对话事件传输。单任务 MUST 允许至少 400 次工具调用及相同数量的单调用轮次；当前预算为最多 512 次调用和 512 轮。

#### Scenario: 单个工具调用后生成答案
- **WHEN** 模型先请求工具且工具成功返回结果
- **THEN** Runtime 把工具结果加入同一任务上下文并继续模型调用，最终只把模型生成的最终文本和已生成的图片内容作为助手正文

#### Scenario: 生图工具产生图片
- **WHEN** 模型调用已启用的生图工具且生成成功
- **THEN** Runtime 保留工具调用记录和结果引用，并把图片放入本轮助手消息，后续文字可继续流式展示

#### Scenario: 生图工具并行子请求
- **WHEN** 一个生图工具调用包含最多 4 条图片需求
- **THEN** Runtime 在同一 call id 下并发执行各子请求，分别记录结果，按完成顺序持久化图片事件，部分失败不丢弃已成功图片

#### Scenario: 模型返回多个工具调用
- **WHEN** 同一模型响应包含多个合法工具调用
- **THEN** Runtime 为每个调用创建独立 call id，按确定顺序执行并将全部结果关联回对应的 provider tool call id

#### Scenario: 超过工具调用预算
- **WHEN** 单次任务超过配置的最大工具轮次或最大调用数量
- **THEN** Runtime 停止继续调用并以 `TOOL_BUDGET_EXCEEDED` 失败，不进入无限模型循环

#### Scenario: 四类工具的大批量调用
- **WHEN** 同一任务要求 Shell、Python、Node.js、Web Search 各调用 100 次
- **THEN** Runtime 在未遇到提供方或工具错误时执行全部 400 次调用，按顺序记录各自终态，并允许模型继续生成最终回答

### Requirement: 统一工具调用生命周期
系统 SHALL 对本轮已授予且通过工具定义、名称与参数校验的调用自动执行，并以 `proposed`、`queued`、`running`、`completed`、`failed`、`cancelled` 表达新工具调用，为每次状态变化发布可序列化事件。系统 MUST NOT 为新调用产生 `waiting_approval` 或等待人工批准；未授予、未注册、名称不匹配或输入无效的调用 MUST 在执行器运行前失败。旧 `waiting_approval` 历史事件 SHALL 可只读解析，且不得因升级自动执行仍悬挂的旧调用。

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
系统 MUST 将工具执行进度记录为运行事件，将单次工具调用记录为一条可关联请求与结果的聚合日志，并禁止把工具进度文字混入助手正文或把每个输出分片记录成独立接口日志。Runtime MUST 以请求内持久化 `sequence` 排列的活动事件关联正文、工具和文件变更，全局 `cursor` 用于数据库定位与回放：活动事件包含稳定 `activityId`，每个实际工具调用 MUST 关联执行时的活动 id 和稳定 `callId`，标题更新包含单调递增的 `titleRevision`。Agent Graph MUST 在运行流程中创建和按规则更新活动标题，不得向模型暴露 `activity_update` 元工具或为活动更新生成合成工具结果。Runtime MUST 在首个外部工具调用前创建受控活动事件，并将后续连续工具调用及关联正文绑定到该活动，直到下一活动或 Turn 结束。事件 MUST 在持久化后广播；首个工具事件决定其展示位置，后续工具输出 MUST 更新同一调用项。本地 Runtime 原始 I/O SHALL 允许该聚合记录向任务活动界面提供输入输出，且不得以 `NODE_ENV` 改变该行为。Runtime 的恢复快照 MUST 包含一致高水位 cursor、活动、关联工具、正文顺序和原始 I/O 边界；完整模型调用日志的保留、脱敏与展示策略不在本 requirement 中定义。

#### Scenario: 工具流式输出
- **WHEN** 执行器产生多个内容分片
- **THEN** WebSocket 以同一 call id 发送有序 `tool.start / tool.content / tool.end|tool.error` 事件，日志只保存一条聚合调用记录

#### Scenario: 本地开发查看原始输出
- **WHEN** 本地 Runtime 呈现工具记录
- **THEN** 界面可显示关联调用的原始输入输出而不改变助手正文

#### Scenario: 活动任务内的工具调用
- **WHEN** Agent Graph 为当前工作目标创建活动任务后发起工具调用
- **THEN** 工具生命周期事件携带该活动任务的 `activityId`，且重连回放保持原有请求 sequence 顺序

#### Scenario: 没有显式活动更新的工具调用
- **WHEN** 模型只返回一个或多个外部工具调用
- **THEN** Runtime 在发布首条工具生命周期事件前发布受控活动开始事件，并为该批次工具提供相同 `activityId`

#### Scenario: 正文与工具交错
- **WHEN** 模型先后产生正文 A、工具 A、正文 B 和工具 B
- **THEN** 实时流、重连回放与快照恢复均按持久化请求 sequence 保持该顺序，工具结果仅更新对应 `callId` 的原位置

#### Scenario: 查询日志页面
- **WHEN** 客户端调用日志查询控制面
- **THEN** 系统继续排除 `actiondriver:log:list` 等日志读取操作，避免日志递归记录自身

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

### Requirement: 工具调用准备阶段可见
系统 MUST 在模型流提供可识别的工具名但参数尚未完整时发送有序的准备进度；该进度 MUST NOT 含未完成的参数文本、不得启动执行器，也不得计为正式工具调用。模型响应结束并验证完整参数后，系统 SHALL 进入现有工具生命周期。

#### Scenario: 模型分片生成工具调用
- **WHEN** 模型先流出工具名，稍后才流出完整参数及响应终态
- **THEN** 客户端先收到工具名和准备状态，在完整调用到达前没有工具执行副作用或正式工具行

#### Scenario: 工具流中断或参数无效
- **WHEN** 模型流在工具参数完成前失败或取消，或最终参数无效
- **THEN** 准备状态结束，未验证的参数不作为正文、工具输入或可执行调用使用

### Requirement: 注册工作区依赖解析工具
系统 SHALL 向模型注册只读工具 `tools_local_command_dependencies_load`，返回本次应用包内文档依赖的 Node 解释器、Node 包目录、原生二进制目录与 Python 解释器的绝对路径。该工具 MUST 声明为只读且无网络副作用，MUST NOT 安装、下载或修改任何依赖，MUST NOT 授予其他工具权限，且其不可用时 MUST 返回结构化错误而不回退到用户环境。该工具 SHALL 随 command 插件生命周期注册和回收，其内部工具 ID SHALL 为 `tools/local/command/dependencies/load`。

#### Scenario: 模型请求依赖路径
- **WHEN** 模型调用 `tools_local_command_dependencies_load` 且该工具本轮已授予
- **THEN** Runtime 返回四个应用包内绝对路径，调用按 `proposed → queued → running → completed` 转移且不产生文件或网络副作用

#### Scenario: 依赖不可用
- **WHEN** 应用包内不存在文档依赖树而模型调用该工具
- **THEN** Runtime 返回 `TOOL_UNAVAILABLE` 类结构化错误，不下载依赖、不回退用户安装的运行时

#### Scenario: Skill 文本不改变权限
- **WHEN** 已启用的文档类 Skill 正文要求使用该工具或其他工具
- **THEN** 只有本轮已授权工具可执行，Skill 文本本身不授予任何权限

### Requirement: 网络搜索调用遵守当前工具执行策略
系统 MUST 将 Web Search 视为网络副作用工具，且只允许本轮已授予、配置了本地 SearXNG 服务并通过参数校验的调用。按 `remove-interactive-tool-approval` 已裁决的策略，合法调用 SHALL 无需逐次人工批准而直接执行；取消与超时仍沿用工具生命周期和模型续跑行为。

#### Scenario: 已启用搜索自动运行
- **WHEN** 模型请求已启用的 Web Search 且参数有效
- **THEN** Runtime 直接执行该次调用，并将规范化搜索结果作为带原 provider tool call id 的工具结果交回模型

#### Scenario: 未授予或参数无效
- **WHEN** 模型请求未授予的 Web Search 或参数不符合输入 Schema
- **THEN** Runtime 不发起网络请求，并把结构化错误交回模型

### Requirement: 为活动界面投影安全的工具摘要
系统 MUST 为每个工具调用的实时事件和恢复快照提供稳定 call id、工具标识、生命周期状态、受限参数摘要、调用顺序与终态耗时；终态调用还 MUST 提供可安全展示的受限结果或错误摘要。该投影 MUST NOT 包含原始执行输出、凭据、认证头、Cookie 或 transport 元数据。

#### Scenario: 实时卡片接收工具状态
- **WHEN** Runtime 发布工具生命周期事件
- **THEN** Renderer 可仅用事件中的安全投影更新对应活动卡，而无需读取原始工具载荷

#### Scenario: 重连恢复工具活动
- **WHEN** 客户端在工具调用后重连并收到任务快照
- **THEN** 快照包含恢复终态活动卡所需的安全摘要与顺序，并且不泄漏被排除的秘密或原始输出

### Requirement: Plugin owned tools follow runtime policy
Runtime SHALL 将插件工具绑定插件 ID、版本与实例，并继续执行现有输入校验、grants、可用性、超时、取消、事件和恢复规则。可信插件安装 SHALL 不自动扩大任务工具授权。

#### Scenario: Installed tool without grant
- **WHEN** 插件已启用但当前任务未授权其工具
- **THEN** 该工具不进入任务可调用集合，直接调用也被拒绝

#### Scenario: Plugin deactivates
- **WHEN** 插件进入停用或失败状态
- **THEN** 新调用不能解析到该插件，在途调用仍绑定原版本且不会静默切换实现

#### Scenario: Stale plugin instance reports result
- **WHEN** 已被回收的插件实例发送迟到消息
- **THEN** Runtime 不允许该消息重建贡献或覆盖另一实例的调用结果

### Requirement: Target and plugin qualified tool identities
内置工具 SHALL 使用 `tools/<target>/<plugin>/<operation>` 标识，层级仅以 `/` 分隔；target SHALL 是 local/cloud 执行上下文归属而不是是否联网。operation 可由一个或多个 `/` 分隔的片段组成。模型名称 SHALL 继续使用下划线形式，版本与名称分离。同一能力在不同 target 下 SHALL 使用不同标识与 grants。新注册工具、发现列表、调用事件和授权 SHALL 使用相同的斜杠 ID。

#### Scenario: Discover a local plugin tool
- **WHEN** Agent 发现本地 command Node 工具
- **THEN** 仅展示 `tools/local/command/node/run` 与 `tools_local_command_node_run`，工具 ID 不含点号

#### Scenario: No cloud binding
- **WHEN** 请求 cloud 工具但只有 local 实现及授权
- **THEN** 明确不可用或拒绝，不回退到本机执行

#### Scenario: Dot-separated tool identity is rejected
- **WHEN** 插件声明或调用使用点号工具 ID
- **THEN** 系统拒绝该 ID，不将其映射到斜杠工具或沿用旧授权
