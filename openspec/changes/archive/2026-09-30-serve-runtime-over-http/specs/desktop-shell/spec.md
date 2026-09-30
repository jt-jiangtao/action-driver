## MODIFIED Requirements

### Requirement: 使用安全的渲染边界
系统 MUST 隔离桌面主进程与页面渲染环境。页面 SHALL 通过 Electron Main 注入的服务端地址与访问凭据，使用 HTTP 与 WebSocket 访问服务端能力；页面 MUST NOT 直接接触文件系统、数据库路径、模型供应商凭据或本地服务端的进程与端口管理，Main MUST NOT 代替服务端持有会话数据、配置或模型凭据。

#### Scenario: 页面访问桌面能力
- **WHEN** 页面需要读取配置或运行会话
- **THEN** 页面使用注入的服务端地址与凭据访问 HTTP 与 WebSocket 接口，不直接访问 Node.js 或 Electron 原始 API

#### Scenario: 服务端随应用启动
- **WHEN** 应用启动
- **THEN** Electron Main 启动并监督本地服务端，就绪后把地址与访问凭据交给页面

#### Scenario: Main 只承载本机独占能力
- **WHEN** Agent Loop 需要执行 Browser 或 Computer 动作
- **THEN** 服务端通过客户端出站连接请求 Main 执行，Main 不承担会话数据写入或模型请求

#### Scenario: 页面不获得敏感引用
- **WHEN** 页面检查可用的桌面接口
- **THEN** 页面无法访问数据库路径、本地服务端的进程引用、模型供应商凭据或任意通用 IPC 通道

#### Scenario: 沙箱渲染进程加载桥接脚本
- **WHEN** 主窗口在启用沙箱的渲染进程中加载预加载脚本
- **THEN** 桥接脚本以受支持的形式加载成功并暴露服务端地址与凭据，页面读不到未声明的桌面接口

## ADDED Requirements

### Requirement: 本地生产页面只展示真实运行投影
本地生产装配 SHALL 从服务端读取模型选项、最近任务与会话、任务详情和消息，MUST NOT 在真实数据为空或读取失败时回退到 Mock catalog、示例会话或硬编码运行结果；Mock 数据 MAY 仅由测试与视觉装配显式注入。

#### Scenario: 展示最近真实任务
- **WHEN** 用户完成一次真实 Agent 任务并返回列表
- **THEN** 最近任务与会话列表展示该持久化记录及其真实状态、模型和时间

#### Scenario: 应用重启后恢复列表
- **WHEN** 用户重启应用并重新进入任务列表或详情
- **THEN** 页面从服务端恢复先前的任务、消息与终态，不重新生成示例内容

#### Scenario: 真实列表为空
- **WHEN** 服务端尚未保存任何任务
- **THEN** 页面展示明确空状态，不展示 Mock 任务

#### Scenario: 最小任务采用 Agent-only 布局
- **WHEN** 用户打开本阶段任务详情
- **THEN** 页面展示用户输入、Agent 状态与模型输出，不渲染 Browser Use 或 Computer Use 面板

#### Scenario: 无浏览器动作时保持全宽
- **WHEN** 当前任务没有 Browser Use 或 Computer Use 动作、观察或产物
- **THEN** Agent 会话占用可用内容宽度，页面不打开右侧面板，也不展示折叠浏览器或 Computer 控件

### Requirement: 页面实时渲染真实流式响应
本地生产页面 SHALL 在 `request.accepted` 后立即展示已持久化的真实会话、用户消息、空 assistant 消息和生成中状态，并 SHALL 随 `response.content` 聚合 assistant 文本；页面 MUST 以聚合后的完整字符串进行 Markdown 渲染，MUST NOT 把单个增量片段作为独立 Markdown 文档解析。

#### Scenario: 请求已接受但尚无正文
- **WHEN** 页面收到 `request.accepted` 但尚未收到 `response.content`
- **THEN** 页面显示真实会话与生成中状态，不插入示例答复、假进度或 Browser/Computer 步骤

#### Scenario: 增量内容持续到达
- **WHEN** 页面按顺序收到同一响应的多个 `response.content`
- **THEN** 页面把 `delta` 追加到同一 assistant 消息并用聚合全文刷新 Markdown，未闭合的 Markdown 语法不会生成多条消息

#### Scenario: 响应正常结束
- **WHEN** 页面收到 `status=completed` 的 `response.end`
- **THEN** 页面用事件携带的最终全文校准消息、停止生成态并展示完成状态和真实元数据

#### Scenario: 响应失败或取消
- **WHEN** 页面收到 `status=failed` 或 `status=cancelled` 的 `response.end`
- **THEN** 页面保留已经生成的可用正文，停止生成态并展示对应错误或取消状态，不把任务显示为成功

#### Scenario: 重放事件包含重复分片
- **WHEN** 重连后收到已经应用过的 `eventId` 或较旧 `sequence`
- **THEN** 页面忽略重复事件，不重复追加正文；发现序列缺口时请求恢复或快照而不继续显示可能损坏的文本

### Requirement: 任务正文提供稳定的多轮输入与滚动状态
任务正文 SHALL 只展示该会话的用户消息与模型 Markdown 回复，不展示执行进度组件；消息区域 SHALL 独立滚动并保持输入框固定在正文底部。输入框 SHALL 在会话终态恢复可编辑，在当前轮运行时进入明确的只读状态并展示中断操作，且各状态的边框、焦点、按钮可用性和光标 MUST 与真实交互能力一致。

#### Scenario: 已完成会话继续输入
- **WHEN** 当前任务已经完成、失败或取消且存在可用模型
- **THEN** 输入框可获得焦点并接受文本，非空时发送按钮可用；提交后输入被清空、当前会话创建新任务并进入生成态

#### Scenario: 当前轮正在生成
- **WHEN** 当前会话存在运行中的任务
- **THEN** 输入框不可编辑且以明确的只读样式显示，发送按钮替换为中断按钮，不允许排队第二条输入

#### Scenario: 空输入或模型不可用
- **WHEN** 输入为空，或当前会话继承的模型已不可用
- **THEN** 发送按钮禁用并以弱化样式显示，页面不发送请求；模型不可用时同时提供可诊断提示

#### Scenario: 长会话滚动
- **WHEN** 消息历史高度超过可用正文区域
- **THEN** 只有消息区域出现窄滚动条，输入框保持可见且不随消息滚出；新分片到达且用户位于底部时自动跟随，用户主动向上查看历史时不强制抢回滚动位置

#### Scenario: 正文不显示执行进度
- **WHEN** 页面渲染任意真实任务状态
- **THEN** 正文不出现“执行进度”、虚构步骤或固定时间线，运行状态只通过输入控件、可访问状态和日志表达

### Requirement: 侧栏以会话而非任务去重
本地生产页面 SHALL 在最近记录中每个 `sessionId` 只展示一项，以会话首轮标题作为稳定标题，并以最新任务时间和状态排序；打开该项 SHALL 恢复会话最新任务和完整有序消息历史。

#### Scenario: 同一会话完成两轮调用
- **WHEN** 第二轮任务完成并刷新最近记录
- **THEN** 侧栏仍只有一条该会话记录，其排序时间与状态来自第二轮任务，标题保持首轮会话标题
