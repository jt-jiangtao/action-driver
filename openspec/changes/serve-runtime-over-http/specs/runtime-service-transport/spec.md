## Purpose

定义 ActionDriver 客户端访问服务端能力的传输契约：配置与模型连接走 HTTP，会话与反向 Skill 调用走 WebSocket，使本地集成形态与将来的云端形态共用同一套接口，并让服务端成为会话数据与配置的唯一写入者。

## ADDED Requirements

### Requirement: 由服务端提供 HTTP 与 WebSocket 接口
系统 SHALL 由服务端对客户端暴露 HTTP 接口处理配置与模型连接管理，并暴露 WebSocket 会话通道处理任务提交、事件流与控制命令；两类接口 MUST 使用同一套版本化、类型化的请求与响应模型。

#### Scenario: 客户端读取配置
- **WHEN** 页面请求模型连接列表
- **THEN** 请求经 HTTP 到达服务端，响应包含连接、协议、地址、掩码凭据提示与模型状态，且不包含明文凭据

#### Scenario: 客户端开启会话
- **WHEN** 页面提交一个目标
- **THEN** 页面发送 `request.create`，服务端完成校验与初始持久化后返回 `request.accepted` 及稳定的会话、任务和响应标识，并在同一连接上继续推送该响应的流式事件

#### Scenario: 两类接口使用同一模型
- **WHEN** 开发者在 HTTP 与 WebSocket 之上实现同一能力
- **THEN** 两者复用同一领域请求与响应类型，不出现仅在某一种传输中存在的字段或错误码

### Requirement: 客户端获得服务端地址与访问凭据
系统 SHALL 由 Electron Main 在启动本地服务端后，把服务端地址与访问凭据交给页面；页面 MUST 使用该地址与凭据访问 HTTP 与 WebSocket，MUST NOT 自行拼接其他地址或伪造凭据。

#### Scenario: 本地服务端启动完成
- **WHEN** 本地服务端完成就绪检查
- **THEN** 页面获得可用的地址与凭据，并能立即完成一次配置读取

#### Scenario: 服务端未就绪
- **WHEN** 页面在服务端就绪前访问接口
- **THEN** 系统返回可识别的暂不可用结果，页面展示不可用状态且不写入任何本地数据

#### Scenario: 未授权访问
- **WHEN** 请求缺少凭据或凭据无效
- **THEN** 服务端拒绝请求并返回可诊断的授权错误，且不泄露内部路径或凭据内容

### Requirement: 会话在单一 WebSocket 上多路复用
系统 SHALL 使用一条应用级长期 WebSocket 连接承载会话创建、取消、恢复与流式事件，并通过 `requestId` 关联命令、通过 `sessionId` 与 `taskId` 区分运行归属、通过 `responseId`、`streamId` 与 `messageId` 区分一次模型响应；客户端 MUST 能在不重建连接的情况下处理连续或并发请求。

#### Scenario: 同一连接并发运行两个任务
- **WHEN** 客户端在同一连接上提交两个目标
- **THEN** 服务端为两个任务分别推送事件，客户端按任务标识区分且响应不会串线

#### Scenario: 请求持久化后才被接受
- **WHEN** 服务端收到带 `eventId`、`requestId` 与 `idempotencyKey` 的有效 `request.create`
- **THEN** 服务端先创建并持久化真实会话、任务和用户消息，再返回一次 `request.accepted`，客户端随即进入该真实会话并等待流式事件

#### Scenario: 创建请求无法开始执行
- **WHEN** 请求在 `response.start` 前因参数、模型引用、授权或持久化错误而失败
- **THEN** 服务端返回与原 `requestId` 关联的 `request.error`，且不伪造 `response.start` 或 `response.end`

#### Scenario: 重复创建请求
- **WHEN** 客户端因超时或重连用同一 `idempotencyKey` 重发 `request.create`
- **THEN** 服务端返回原有的接受结果或当前快照，不创建第二个会话、任务或模型调用

#### Scenario: 取消运行中请求
- **WHEN** 客户端发送与运行中响应关联的 `request.cancel`
- **THEN** 服务端停止继续生成，并最终为该响应发送 `status=cancelled` 的 `response.end`

### Requirement: 流式响应遵循固定生命周期
系统 SHALL 为每次已开始的模型响应严格发送一次 `response.start`、零到多次 `response.content` 和一次 `response.end`；同一响应的事件 SHALL 使用从零开始单调递增的 `sequence`，且 `response.end` MUST 对完成、失败和取消三种终态都成立。

#### Scenario: 成功流式返回
- **WHEN** 上游模型开始生成并连续返回文本增量
- **THEN** 服务端先发送 `sequence=0` 的 `response.start`，再按顺序发送携带文本 `delta` 的 `response.content`，最后发送 `status=completed` 的 `response.end`

#### Scenario: 上游在开始后失败
- **WHEN** 服务端已经发送 `response.start`，随后上游发生认证、限流、超时、协议或连接错误
- **THEN** 服务端发送且只发送一次 `status=failed` 的 `response.end`，其中包含稳定错误码且不包含凭据

#### Scenario: 终态校准增量内容
- **WHEN** 服务端发送任意状态的 `response.end`
- **THEN** 事件包含当前可用的最终聚合 `content`、`finishReason`、用量和耗时，客户端用该全文校准已累积增量而不重复追加

#### Scenario: 未产生文本的成功响应
- **WHEN** 上游以成功协议结束但没有可渲染的 assistant 文本
- **THEN** 服务端以稳定的无文本错误结束该响应，不把空字符串伪装成成功答复

### Requirement: 事件订阅支持游标恢复
系统 SHALL 为每个持久化事件分配全局可恢复 `cursor` 和唯一 `eventId`，允许客户端发送 `request.resume(afterCursor)` 继续接收；传输 SHALL 按至少一次投递设计，重复确认或重复投递 MUST NOT 造成重复文本或状态回退。

#### Scenario: 断线重连
- **WHEN** 页面与服务端的连接中断后重新建立
- **THEN** 客户端使用最后应用的 `cursor` 请求恢复，服务端重放后续事件，客户端按 `eventId` 去重并按 `sequence` 检查同一响应是否缺失事件

#### Scenario: 页面重新加载
- **WHEN** 页面重新加载并重新订阅已知任务
- **THEN** 页面依据游标补齐缺失事件并得到与断线前一致的可见状态

#### Scenario: 重放窗口已经过期
- **WHEN** 客户端请求的 `afterCursor` 已超出服务端事件保留窗口
- **THEN** 服务端返回 `response.snapshot`，其中包含当前会话、任务、消息全文与终态，客户端以快照替换本地不完整投影

### Requirement: 本地装配由服务端通过同一通道调用本机 Skill
系统 SHALL 在服务端与客户端同机装配时，通过同一条客户端出站连接请求本机执行 Browser/Computer Skill，并携带请求标识、截止时间与取消语义；迟到的结果 MUST NOT 被当作新的成功结果。云端装配 MUST NOT 请求操作用户本机 GUI，也不得要求用户本机开放入站端口。

#### Scenario: 服务端请求本机执行动作
- **WHEN** Agent Loop 决定调用本机 Skill
- **THEN** 服务端通过会话连接下发类型化请求，本机执行后回传结果并关联到原调用

#### Scenario: 请求超时或取消
- **WHEN** 本机未在截止时间前返回结果，或任务被中断
- **THEN** 服务端收到超时或取消结果，迟到响应被忽略并记录为诊断信息

#### Scenario: 云端装配不操作本机 GUI
- **WHEN** 服务端以云端装配运行
- **THEN** 它不请求用户本机的 Browser/Computer 动作、不依赖本机 Skill 通道，客户端只负责展示与控制

### Requirement: 传输契约支持版本兼容与结构化错误
系统 SHALL 在会话建立与每个 HTTP 响应中携带协议版本，主版本不一致时拒绝业务请求；所有失败 MUST 以结构化错误返回，包含稳定错误码与可读信息。

#### Scenario: 主版本不兼容
- **WHEN** 客户端与服务端的主协议版本不一致
- **THEN** 服务端在执行任何业务写入前拒绝连接，并返回明确的版本错误

#### Scenario: 结构化失败
- **WHEN** 请求因参数、授权、超时或上游故障失败
- **THEN** 客户端收到稳定错误码与信息，能够区分可重试与不可重试，并且错误内容不包含明文凭据

### Requirement: 本地形态限制访问范围
本地形态的服务端 SHALL 只监听回环地址，并 SHALL 拒绝来源不可信或缺少凭据的请求；服务端 MUST NOT 把访问凭据写入日志、事件或任务数据。

#### Scenario: 非本机访问
- **WHEN** 本机之外的来源尝试访问本地服务端
- **THEN** 请求被拒绝，且不执行任何业务逻辑

#### Scenario: 凭据不出现在可观察输出
- **WHEN** 开发者检查日志、事件或任务投影
- **THEN** 不出现服务端访问凭据与模型供应商密钥

### Requirement: 同一份服务端可迁移到云端
系统 SHALL 让服务端业务代码不依赖"必须运行在用户本机"的假设：传输、存储、凭据、时钟与标识生成 MUST 通过可替换端口注入，本地形态与云端形态只替换适配器。

#### Scenario: 云端装配
- **WHEN** 服务端以云端配置启动
- **THEN** 它使用远端存储与托管凭据适配器提供同样的 HTTP/WS 契约，本地适配器不参与装配

#### Scenario: 本地装配
- **WHEN** 服务端随客户端启动
- **THEN** 它使用本地存储与本地凭据适配器提供同样的契约，客户端不需要知道部署位置

### Requirement: 任务提交绑定精确的模型连接
系统 SHALL 要求 Agent 任务提交携带 `{ connectionId, modelId }` 模型引用、用户目标、主提示词与 Skill 选择，并 SHALL 由服务端依据自身持久化配置解析该引用；客户端 MUST NOT 传递供应商凭据或自行构造上游请求。

#### Scenario: 提交最小 Agent 任务
- **WHEN** 客户端用有效的 OpenAI-compatible 模型引用提交目标
- **THEN** 服务端解析对应连接并创建任务，本阶段把 Skill 选择固定为空列表

#### Scenario: 模型引用失效
- **WHEN** 引用的连接或模型不存在、未启用或不支持文本
- **THEN** 服务端在发起上游请求前返回稳定的不可执行错误，并且不回退到其他模型

#### Scenario: 客户端未携带凭据
- **WHEN** 服务端接收任务提交
- **THEN** 请求只包含模型引用和业务输入，供应商密钥由服务端内部解析且不进入任务合同

### Requirement: 通过真实 OpenAI-compatible 上游完成流式执行
本地生产装配 SHALL 通过模型连接服务持有的真实 OpenAI-compatible 凭据发起流式模型请求，并 SHALL 把可恢复的流式事件、最终模型输出、任务状态与运行事件写入服务端存储；本地生产装配 MUST NOT 回退到确定性模型网关或以定时器伪造流式输出。

#### Scenario: 上游成功流式返回文本
- **WHEN** OpenAI-compatible `/chat/completions` 按流返回有效 assistant 文本增量并正常结束
- **THEN** 服务端按固定生命周期发布事件，保存最终 assistant 全文、把任务置为完成并发布可恢复的终态事件

#### Scenario: 上游请求失败
- **WHEN** 上游返回认证、限流、超时、协议或无文本错误
- **THEN** 服务端保存结构化失败结果、把任务置为失败，并依据是否已经开始响应使用 `request.error` 或失败的 `response.end` 返回不含凭据的稳定错误码

#### Scenario: 服务重启后读取结果
- **WHEN** 已完成或失败的任务在本地服务重启后被查询
- **THEN** 服务端从持久化存储恢复相同任务状态、消息和运行事件

#### Scenario: 最小闭环不调用本机 Skill
- **WHEN** 本阶段任务运行
- **THEN** Runtime 不注册或调用 Browser/Computer Provider，任务投影中也不产生虚构的 Browser/Computer 步骤
