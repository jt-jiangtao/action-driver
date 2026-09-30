## Why

当前运行时的客户端—服务端边界是定制的 MessagePort RPC：Electron Main 持有 RuntimeClient，Preload 只暴露白名单 IPC，模型连接配置与 API Key 存在客户端 `userData`，真实模型请求由客户端进程发出。这与已确认的终态不一致：**服务端即使当前集成在客户端内，也必须是会话数据与配置的唯一写入者、真实请求的发起者，并且可原样迁移到云端**；页面与服务端之间应使用行业标准传输（HTTP + WebSocket），而不是为本地形态定制的私有协议。

## What Changes

- **BREAKING**：以 HTTP + WebSocket 取代 MessagePort RPC。配置、查询与模型连接走 HTTP；任务创建、取消、恢复和流式输出走一条应用级 WebSocket 长连接。首个闭环固定使用 `request.create` / `request.accepted` 与 `response.start` / `response.content` / `response.end` 事件，不再等待完整模型响应后一次性渲染。
- **BREAKING**：Renderer 页面直接持有 WebSocket。Electron Main 只负责启动并监督本地 Runtime、生成一次性访问凭据并向受信任页面注入 `wsUrl + accessToken`；流式命令、事件、重连与游标恢复不再经过 Main IPC 代理。
- **BREAKING**：模型连接配置与凭据从 Electron Main 迁入服务端。服务端持有连接、凭据（本地形态加密后写入本地存储）并真实发起 `GET /models`、`POST /chat/completions`、`POST /v1/messages`；客户端页面只保留配置界面，不再持有密钥、不再直连供应商。
- 服务端成为会话数据与配置的唯一写入者，并保持本地存储；客户端页面不再读写存储。
- 服务端按"可迁移"约束实现：传输、存储、凭据、时钟与 ID 全部是端口，本地与云端各一套适配器，业务代码共用；本期只实现本地形态，云端形态作为同一代码的另一种装配。
- Electron Main 收窄为：启动并监督本地服务端、承载 Browser/Computer Skill 与 macOS 能力、把服务端地址与本机访问凭据交给页面。
- 页面直连服务端 HTTP/WS，需要网络访问与凭据处理；这取代此前"渲染进程不直连网络、只走白名单 IPC"的约束（用户已明确覆盖）。
- 接口层日志升级为结构化的请求/响应配对事件：用 `correlationId` 关联一次交互，按实际传输协议（IPC、HTTP、WebSocket）筛选；列表只读取摘要，详情按需读取独立保存的请求与响应载荷。
- 请求与响应正文不做业务内容脱敏，但服务端访问凭据、模型供应商密钥、Authorization、Cookie 与已知 Token 字段 MUST NOT 落盘；本地日志以容量与保留期双重上限淘汰最旧记录。

## Capabilities

### New Capabilities

- `runtime-service-transport`: 定义服务端对客户端暴露的 HTTP 接口与 WebSocket 会话协议：地址与凭据协商、配置接口、会话多路复用、严格的 `start → content* → end` 流式生命周期、事件游标恢复、取消与恢复命令、错误与版本协商，以及本地形态与云端形态共用同一契约的约束。

### Modified Capabilities

- `model-connections-settings`: 设置页改为通过服务端 HTTP 接口读写模型连接；凭据不再由客户端持有，连接与模型测试结果由服务端返回。
- `desktop-shell`: 渲染边界从"只走白名单 IPC"调整为"页面通过服务端 HTTP/WS 访问能力"；Main 收窄为启动服务端、提供 Skill 与 macOS 能力、注入服务端地址与访问凭据。
- `interaction-log-viewer`: 从仅展示载荷尺寸与摘要升级为可查看请求/响应正文的结构化事件；增加传输协议筛选、摘要列表与按需详情读取，并保持凭据永不落盘。

## Impact

- 新增服务端入口与 HTTP/WS 传输层；`apps/agent-runtime` 明确定位为"本地服务端"（集成在客户端内、可迁移云端）。
- `packages/runtime-contracts` 的 MessagePort 协议被 HTTP/WS 契约取代；Main 的 `RuntimeSupervisor`/`RuntimeClientGateway`/`agent-ipc`/preload 代理层收窄或移除。
- 模型连接实现从 `apps/desktop/src/main/model-connections/*` 迁入服务端，客户端只保留 `DesktopModelConnectionsService` 的 HTTP 版本。
- 已配置的两条连接（含加密凭据）需要一次性迁移到服务端存储，客户端旧文件与 safeStorage 路径下线。
- 测试面变化：契约测试改为 HTTP/WS；E2E 需要覆盖页面直连、断线重连与游标恢复；打包后仍需验证服务端随客户端启动。
- 日志存储新增独立载荷与保留策略；查询契约拆分为摘要列表和单条详情，避免完整请求/响应随每次列表刷新重复传输。
- 任务提交从原有请求/响应式调用升级为应用级 WebSocket 流；客户端需要维护事件去重、顺序校验、Markdown 增量内容聚合和断线后的游标恢复，服务端需要持久化可重放事件并在终态提供最终全文校准。
- Renderer 需要持有仅限本次 Runtime 生命周期的一次性访问凭据，并把本地 WebSocket Origin、CSP `connect-src`、重连与页面重载恢复纳入安全和回归测试；模型供应商 API Key 仍只存在于 Runtime。

## Battle Status

- 类型：架构 + 安全（跨进程边界、传输协议、数据所有权、凭据归属、后续云端迁移）。
- 状态：**已裁决**（2026-09-22）。逐项结论见下，无遗留分歧。
- 已裁决（用户明确指定）：
  1. 服务端当前集成在客户端内，且必须可迁移到云端；后期做云端执行。
  2. 会话数据与配置都由服务端写入本地存储，服务端是唯一写入者。
  3. 客户端与服务端之间直接使用 HTTP；会话使用 WebSocket。
  4. 用户已接受安全边界调整与重做传输层的代价：客户端与服务端之间直接使用标准传输（HTTP/WS），不再保留私有 MessagePort RPC。
  5. 云端执行不操作用户本机 GUI：云端与本地是两套执行环境，本机 GUI 动作只发生在本地形态。
- 逐项结论（2026-09-22 按推荐确认）：
  1. 服务端载体：**扩展现有 `apps/agent-runtime`**，一个进程、一个写者、一次迁移。
  2. 本地鉴权：**每次启动生成一次性访问凭据 + 只监听回环 + 校验 Origin**。
  3. 存储布局：**配置与会话同一 SQLite 库**，只前进迁移。
  4. 旧 MessagePort 通道：**一次性移除**，不保留降级路径。
  5. 服务端不可用时：**页面可只读查看本地历史**，恢复后自动回到可用状态。
  6. 本地形态页面接入：**Electron Main 作为服务端原生客户端，页面经窄桥接口使用能力**；云端形态页面直连 HTTPS/WSS（参照 Codex app-server 拒绝浏览器 Origin 请求的做法）。
  7. 密钥安全性本轮不处理（用户明确）：凭据密钥经环境变量注入 Runtime 进程；后续安全化时改为私有握手通道注入并记录该已知风险。
  8. 本轮范围：Main 内部替换为服务端 HTTP 客户端，渲染层与 Preload 合同不动；一次性迁移旧文件到服务端 SQLite，失败可回滚。
  9. 接口日志采用**结构化配对事件 + 独立载荷存储**：正文保留原始业务内容，鉴权凭据永不落盘；协议筛选只表达 IPC、HTTP、WebSocket，不与 OpenAI/Anthropic 供应商协议混用。
  10. 日志列表只返回摘要，选中事件后按需读取 Request/Response；以容量与保留期双重上限控制本地占用。此前“只记录载荷尺寸、不记录完整请求体”的方案被本裁决取代。

## Priority Update (2026-09-23)

- 类型：产品优先级 + 运行时架构 + 数据所有权，属于决策型任务。
- 目标：先跑通一个可验收的真实 Agent 最小闭环——从真实模型选择、提交用户目标、完成一次模型请求，到查看真实任务列表、接口层日志与模型层日志；本阶段不接入 Browser Use、Computer Use 或 Skill 调用。
- 现状检查：页面当前只保存 `modelId`，提交合同不携带连接引用；本地运行时仍使用确定性模型网关；最近任务、模型日志等局部页面仍依赖 Mock 数据。因此仅替换一个请求函数无法形成真实闭环。
- 比较方案：
  1. 同时打通 OpenAI-compatible 与 Anthropic-compatible。覆盖完整，但会把两套请求/响应合同、流式差异和错误映射同时引入首个闭环，扩大返工面。
  2. **先打通 OpenAI-compatible 单轮非流式闭环**。Anthropic 连接仍可配置，但在 Agent 模型选择中明确禁用并说明“Agent 调用暂未接入”。这是本次裁决。
  3. 页面直接调用供应商并绕过 Runtime。短期更快，但违反服务端唯一持有凭据、唯一写入会话和统一记录日志的既有边界。
- 最终裁决：用户选择方案 2（B）。该垂直切片提升为本 change 的最高优先级；除其直接依赖与严重回归外，暂停更广泛的 HTTP/WS 迁移、Skill、Browser Use 与 Computer Use 工作。
- 数据要求：本地生产装配中的模型选择、最近任务/会话列表、任务详情、接口层日志列表/详情、模型层日志列表/详情 MUST 全部来自真实持久化或真实执行投影；Mock 只允许存在于单元测试、组件测试与视觉测试装配中。
- 当时取舍：该裁决先以非流式完成真实数据闭环，Anthropic 暂不可用于 Agent 执行；其中“非流式”范围已被下方 Streaming Priority Update 取代，Anthropic 后置与禁止 Mock 降级继续有效。
- 重开条件：若 OpenAI-compatible 无法表达现有供应商端点、真实持久化需要改变“服务端唯一写入者”边界，或任务/日志投影必须引入新的跨模块所有权，再重新 Battle。

## Streaming Priority Update (2026-09-23)

- 类型：产品交互 + 公共协议 + 运行时架构，属于决策型任务；Battle 已完成。
- 当前唯一优先目标：先跑通一个可验收的真实 Agent 流程——选择真实 OpenAI-compatible 模型、创建真实会话与任务、通过 WebSocket 接收并渲染流式输出、完成后查看同一次调用的真实 Request/Response 日志。除支撑该闭环的最小能力外，其他工作均后置。
- 协议裁决：使用一条应用级长期 WebSocket 连接；客户端发送 `request.create`，服务端持久化后返回 `request.accepted`，随后严格发送一次 `response.start`、零到多次 `response.content`、一次 `response.end`。`response.end` 对完成、失败和取消都成立，并携带最终聚合全文用于校准客户端增量内容；开始前失败使用 `request.error`。
- 标识与恢复：持久化的请求事件携带稳定 `eventId`、`requestId`、请求内连续 `sequence` 与全局可恢复 `cursor`，按事件类型另带 `responseId`、`sessionId`、`taskId`、`streamId`、`messageId`；创建请求携带 `idempotencyKey`。传输按至少一次投递设计，客户端按 `eventId` 去重、按请求 `sequence` 检测缺口，并以 `request.resume(afterCursor)` 请求重放；超出保留窗口时服务端返回 `response.snapshot`。原 v1 单响应计序裁决由 `converge-runtime-architecture` 的 v2 请求计序覆盖。
- 渲染裁决：`request.accepted` 后页面立即进入真实会话并创建用户消息、空 assistant 消息与生成中状态；`response.content` 只追加文本，页面聚合完整字符串后交给 `markdown-it` 渲染，不把单个 delta 片段独立解析为 Markdown。没有 Browser/Computer 动作时保持 Agent-only 全宽布局，不显示右侧面板或相关控件。
- 日志裁决：一次模型调用只形成一条可配对记录，保存完整模型请求、最终聚合响应、用量、结束原因、状态和耗时；不得为每个 `response.content` 分片创建日志事件，日志查询控制面继续不被记录。
- 范围后置：Anthropic Agent 执行、Skill、Browser Use、Computer Use、人工接管、复杂多任务控制及与最小闭环无关的横向 HTTP/WS 迁移均不阻塞本轮验收。
- 用户覆盖：Agent 曾推荐首版本地形态复用既有 Runtime 事件通道以降低连接治理成本；用户明确选择独立 WebSocket，以便后续远程 Runtime 复用同一协议。接受的已知风险是新增鉴权、连接生命周期、幂等、重放、背压和断线恢复复杂度。
- 成功标准：真实上游按流返回内容时，页面从 `start` 进入生成态、随 `content` 持续显示 Markdown、在 `end` 后进入准确终态；刷新或重连不会重复文本；任务列表、会话详情和请求/响应日志均来自真实持久化数据且能用标识串联；整个流程不出现 Mock 降级、Browser/Computer 面板或日志递归记录。
- 上游 SDK 裁决：用户确认采用官方 `openai` Node SDK 处理 OpenAI-compatible HTTP/SSE、取消、超时和结构化 chunk；Action-Driver 保留业务生命周期、持久化、幂等重放、聚合日志和凭据过滤。比较过继续自研 Fetch/SSE 与仅引入 `eventsource-parser` 的方案，前者维护面过大，后者仍需自研大部分上游适配。SDK 自动重试和 debug logging 必须关闭，避免一次请求产生隐藏重试、重复日志或敏感正文旁路。

## Renderer Direct WebSocket Update (2026-09-23)

- 类型：安全边界 + 公共协议 + 客户端架构，属于决策型任务；Battle 已完成。
- 目标：让本地与未来云端形态复用同一套 Renderer WebSocket 客户端，页面直接发送流式命令、接收事件并负责重连和游标恢复，移除 Main 对流式消息的代理。
- 当前方案：Renderer 通过 Preload 只读获取 Main 注入的本次启动 `wsUrl + accessToken`，使用浏览器 WebSocket API 建立 `action-driver.stream.v2` 长连接；Main 不再转发 `request.create` 或 `response.*`。服务端主动发送原生 Ping，浏览器网络栈自动回复 Pong；页面通过连接关闭、业务超时和恢复快照判断健康状态。
- 比较方案：保留 Main WebSocket 客户端可避免访问凭据进入页面环境，安全边界更窄，但本地与未来云端需要不同传输适配，且增加一层 IPC 流式代理。Renderer 直连减少代理层并提高云端复用度，但扩大 Renderer 注入漏洞的影响面。
- 最终裁决：用户确认采用 Renderer 直连，并明确接受一次性 Runtime token 进入 Renderer 内存的风险。模型供应商 API Key 仍由 Runtime 独占，页面不得读取或透传。
- 安全约束：访问凭据只存在内存且随 Runtime 生命周期失效；只允许受信任应用 Origin 连接回环地址；CSP 仅开放注入的 Runtime 端点；连接 URL、token、鉴权帧不得进入日志、截图、持久化任务或错误正文。
- 重开条件：若 Electron/Chromium 无法可靠完成原生 Ping/Pong、动态 CSP 无法把网络范围限制到注入端点，或页面注入面无法满足最小权限要求，则重新比较 Main 代理与 Renderer 直连。

## Multi-turn Session Update (2026-09-23)

- 类型：产品交互 + 会话数据模型 + 公共协议，属于决策型任务；Battle 已完成。
- 目标：任务完成后正文输入框继续可用，用户可在当前会话中发起下一轮真实模型调用，并在同一页面、侧栏会话和日志链路中查看完整历史。
- 最终裁决：每次用户继续提问都在原 `sessionId` 下创建一个新任务，而不是重新打开或覆盖已结束任务；Runtime 使用该会话按顺序持久化的全部用户与 assistant 消息构造新一轮模型上下文，并复用会话上一轮的模型引用。
- 展示与日志：页面展示同一会话的完整消息序列，运行中只锁定当前提交并显示中断控制，终态恢复可编辑输入；侧栏每个会话只显示一项；模型层与接口层日志按 `sessionId` 聚合、按 `taskId` 区分每轮调用。
- 比较方案：复用同一个终态任务会破坏任务不可变终态、幂等键和每轮日志边界；每次创建全新会话会割裂上下文和侧栏记录。采用“同会话、新任务”保持会话连续性与任务审计边界。
- 重开条件：若完整历史超过供应商上下文窗口，需要另行裁决截断、摘要或记忆策略；本轮只保证按顺序发送当前持久化历史，不引入自动摘要。
