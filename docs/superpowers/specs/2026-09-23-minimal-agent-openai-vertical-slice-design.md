# 真实 OpenAI-compatible 流式 Agent 闭环设计

> **协议版本更新：** 本文记录最初的 v1 纵向闭环。当前持久化事件协议以 `2026-09-24-architecture-convergence-design.md` 为准，使用 `action-driver.stream.v2` 和请求内连续 `sequence`；下文的 v1 示例仅作历史背景。

日期：2026-09-23

关联 OpenSpec：`serve-runtime-over-http`

状态：待用户复核

## 目标与成功标准

当前唯一优先目标是跑通一个可验收的真实 Agent 流程：用户选择已经保存并启用的 OpenAI-compatible 模型，通过一条应用级 WebSocket 创建真实会话与任务，Runtime 调用真实模型服务，页面持续渲染流式 Markdown，结束后能够从真实任务、消息、接口层日志和模型层日志复盘同一次调用。

成功必须同时满足：

1. 模型选择、会话、任务、消息、接口层日志和模型层日志全部来自真实服务端数据，不回退 Mock、示例数据或确定性模型。
2. 模型调用由 Runtime 发起；页面不持有供应商凭据，也不直连供应商。
3. 流式生命周期严格为一次 `response.start`、零到多次 `response.content`、一次 `response.end`。
4. 页面在请求被接受后立即显示真实会话和生成中消息，并持续渲染聚合后的 Markdown；终态用最终全文校准。
5. 一次模型调用只产生一条聚合 Request/Response 日志，不把每个内容分片写成日志，也不记录日志查询控制面。
6. 没有 Browser/Computer 动作时采用 Agent-only 全宽布局，不打开或展示右侧面板。
7. 自动化回归使用确定性假上游，但交付验收必须额外调用用户已配置的真实模型服务；真实服务失败时明确失败，不能降级。

## Battle 结论

这是产品交互、公共协议和运行时边界共同变化的决策型任务。原最小闭环采用非流式请求，已经证明真实模型选择、持久化任务和查询投影可行，但无法满足发送后立即形成会话、持续显示模型内容和验证真实流式日志终态的要求。

比较过三种传输方案：

- 复用现有 Runtime 事件通道：首版本地实现成本最低，但远程 Runtime 阶段需要再次更换连接和恢复协议。Agent 曾推荐该方案。
- 使用独立应用级 WebSocket：需要自行处理鉴权、心跳、幂等、重放、背压和断线恢复，但本地与未来远程 Runtime 可以复用同一协议。
- 使用 HTTP 创建任务并以 SSE 接收输出：服务端到客户端流较简单，但取消、恢复和未来双向控制需要第二套通道。

用户明确选择独立 WebSocket，并接受新增连接治理复杂度。实现范围进一步收敛为“流程、渲染、日志”；Anthropic Agent 执行、Skill、Browser Use、Computer Use、人工接管和复杂多任务控制均后置。

## 范围

包含：

- 真实启用模型的查询与精确选择；
- 单条应用级 WebSocket 连接；
- 请求接受、流式开始、内容增量、终态和开始前错误；
- 创建幂等、事件去重、顺序检查与最小断线恢复；
- OpenAI-compatible 真实流式 `/chat/completions`；
- 任务、消息、流式事件与终态持久化；
- 页面实时 Markdown 渲染和 Agent-only 全宽布局；
- 聚合接口层 Request/Response 和模型层执行日志；
- 本地假上游自动化回归与真实已配置模型服务 live smoke。

不包含：

- Anthropic Agent 执行；
- Skill、MCP、Browser Use、Computer Use；
- 人工接管、等待用户输入和完整多任务控制；
- 云端部署、账号体系和多端同步；
- Figma 或视觉基线检查。

## 系统边界与数据流

```text
Renderer
  ├─ HTTP: 查询模型、任务和日志
  └─ WebSocket: request.create / cancel / resume
                         │
                         ▼
Runtime WebSocket Server
  ├─ 先持久化 session / task / user message
  ├─ request.accepted
  ├─ response.start
  ├─ response.content *
  └─ response.end
             │
             ├─ ModelConnectionService ──> 真实 OpenAI-compatible 流
             ├─ RuntimeStore ────────────> 任务 / 消息 / 可恢复事件
             └─ InteractionLogStore ─────> 聚合 Request / Response
```

Runtime 是连接、凭据、会话、任务、消息和运行事件的唯一写入者。模型连接服务由 Runtime 组合根构造一次，同时服务配置查询和执行网关。供应商密钥只在 Runtime 构造上游请求时解密到内存，不能进入 WebSocket 消息、页面状态、任务数据、日志或错误信息。

配置、模型列表、任务查询和日志查询继续使用现有请求/响应接口；创建、取消、恢复和流式输出使用 WebSocket。这样查询语义保持简单，持续双向运行状态拥有稳定的远程协议。

## WebSocket 协议

连接使用 `Sec-WebSocket-Protocol: action-driver.stream.v1`。客户端消息：

- `auth`
- `request.create`
- `request.cancel`
- `request.resume`

服务端控制消息：

- `session.ready`
- `request.accepted`
- `request.error`
- `response.snapshot`

服务端流式消息：

- `response.start`
- `response.content`
- `response.end`

所有业务消息使用 JSON envelope。稳定标识职责如下：

- `eventId`：事件去重；
- `requestId`：客户端命令与结果关联；
- `idempotencyKey`：创建请求安全重试；
- `sessionId`、`taskId`：会话与任务归属；
- `responseId`、`streamId`、`messageId`：一次模型响应、流和 assistant 消息；
- `sequence`：同一响应内从 0 单调递增；
- `cursor`：服务端持久化事件的全局恢复位置。

`request.create` 只携带业务输入和模型引用：

```ts
type ModelRef = {
  connectionId: string;
  modelId: string;
};

type RequestCreate = {
  type: "request.create";
  protocol: "action-driver.stream.v1";
  eventId: string;
  requestId: string;
  idempotencyKey: string;
  sessionId: string | null;
  createdAt: string;
  payload: {
    input: { role: "user"; content: string };
    model: ModelRef;
    systemPrompt?: string;
    skills: [];
  };
};
```

服务端只有在会话、任务和用户消息成功持久化后才发送 `request.accepted`。在 `response.start` 前发生的参数、模型引用、授权或存储错误使用 `request.error`；一旦发出 `response.start`，完成、失败和取消都必须且只能以一次 `response.end` 收口。

`response.content` 只携带文本 `delta`。`response.end` 携带当前最终聚合 `content`、`finishReason`、`usage`、`durationMs` 和可选结构化错误，客户端用全文覆盖校准已有缓冲，不再次追加。

传输按至少一次投递设计。客户端按 `eventId` 去重、按 `sequence` 检测同一响应的缺口，只在事件成功应用后推进 `cursor`。重连发送 `request.resume(afterCursor)`；服务端重放原事件。游标超过保留窗口时返回 `response.snapshot`，客户端用持久化的会话、任务、消息全文和终态替换不完整投影。

心跳使用 WebSocket 原生 Ping/Pong。关闭码使用标准语义：1000 正常关闭、1002 协议错误、1008 鉴权或策略拒绝、1009 消息过大、1011 服务端错误、1013 过载重试。重连使用指数退避和抖动。

## 真实模型流

OpenAI-compatible adapter 使用官方 `openai` Node SDK 发起真实流式 `/chat/completions` 请求，并把 SDK 的结构化 chunk 转换为内部可取消的异步流。SDK 按已保存连接设置 `baseURL`，关闭自动重试与 debug logging，显式传入 15 秒超时和调用级 `AbortSignal`。适配器负责：

- 解析 assistant 文本增量；
- 聚合最终全文、用量和结束原因；
- 映射认证、限流、超时、网络、中途断流、畸形分片和无文本错误；
- 在取消时中止上游请求；
- 绝不发布隐藏推理内容，只发布用户可见 assistant 输出。

SDK 只承担 Runtime 到供应商这一跳的 HTTP/SSE、UTF-8 分帧、取消和基础错误解析；桌面端到 Runtime 仍只使用 `action-driver.stream.v1` WebSocket。Action-Driver 自己维护事件生命周期、幂等、重放、持久化和聚合日志，不把 SDK 类型传播到公共协议。

不得用非流式响应加定时器模拟逐字输出。真实服务不可用时任务进入明确失败态，不回退到假服务或 Mock。

## 页面投影与 Markdown 渲染

收到 `request.accepted` 后，页面立即导航或绑定到真实会话，显示已持久化的用户消息、稳定 `messageId` 的空 assistant 消息和生成中状态。

收到 `response.content` 时，客户端状态机把 `delta` 追加到同一消息字符串。视图层以 50–100ms 合并刷新，避免逐 token 触发昂贵布局；每次刷新都把当前完整字符串交给 `markdown-it`，保持 `html: false`。不得把单个 delta 作为独立 Markdown 文档解析，否则代码块、列表和链接在跨分片时会错误。

收到 `response.end` 后，页面用最终 `content` 校准消息并停止生成态：

- `completed`：显示完成状态和真实元数据；
- `failed`：保留已生成正文并显示结构化错误；
- `cancelled`：保留已生成正文并显示取消状态。

重复 `eventId` 或旧 `sequence` 不得重复追加；发现序列缺口时暂停应用后续增量并请求恢复或快照。

当任务没有 Browser/Computer 数据时，Agent 内容占满可用宽度，右侧面板、折叠入口和相关控件都不渲染。

## 持久化与日志

流式事件与最终消息使用同一运行编排持久化。终态写入顺序必须保证页面不会先看到完成、随后却查询不到 assistant 全文。进程或连接中断后，持久化事件能够重放；最终消息是快照和任务详情的事实来源。

接口层日志在供应商调用开始时创建一条 `service->model` pending 记录，在完成、失败或取消时用同一 `correlationId` 补齐：

- 完整模型 Request；
- 最终聚合 Response；
- 状态、结束原因、用量和耗时；
- `taskId`、`requestId` 和 `correlationId`。

供应商原始分片和 `response.content` 不创建独立日志。模型层日志从同一真实任务事件投影系统提示词、用户输入、模型请求、最终模型响应和任务终态。所有 `action-driver:log:*` 查询、刷新和详情消息在采集前统一排除，避免日志递归。

业务正文按既有容量规则保存；Authorization、API Key、Cookie、服务端访问凭据和已声明密钥字段永不落盘。过滤无法确认时拒绝保存正文，只保留安全诊断摘要。

## 测试与验收

定向测试按任务运行，不在每个子项后跑全集：

1. 协议和状态机：正常生命周期、开始前错误、开始后失败/取消、重复事件、序列缺口、最终全文校准。
2. 模型适配器：多分片 Markdown、认证失败、限流、超时、畸形分片、无文本和中途断流。
3. Runtime：先持久化后接受、幂等创建、事件重放、窗口过期快照、终态一致性。
4. 客户端：连接、去重、重连、恢复、错误隔离和无 Mock 降级。
5. 页面：未闭合 Markdown、合并刷新、失败保留部分正文、终态校准和 Agent-only 全宽布局。
6. 日志：一次模型调用一条聚合记录、分片不落日志、日志控制面排除和凭据泄漏守卫。

自动化端到端回归使用本地假 OpenAI-compatible 服务，按多个分片返回跨边界 Markdown，并覆盖一次中途断线。它验证真实 WebSocket、持久化和页面路径，但不作为真实供应商可用性的替代证明。

交付前必须使用用户已经在模型连接页配置并启用的真实 OpenAI-compatible 服务完成一次 live smoke：生产装配从 Runtime 凭据存储取密钥，页面选择真实模型并发送，持续展示真实返回，结束后能在任务、消息和双层日志中定位同一次调用。密钥不得写入命令、测试夹具、截图、日志或仓库。

整个最高优先级任务组完成后再运行完整 `corepack pnpm check`、桌面 E2E 和 OpenSpec 严格校验。

## 实施顺序

1. WebSocket 消息合同与纯状态机。
2. OpenAI-compatible 真实流式适配器。
3. Runtime WebSocket 入口、执行编排和可恢复持久化。
4. 桌面单连接客户端和请求接受后的真实会话投影。
5. Markdown 流式渲染、终态校准和 Agent-only 布局。
6. 聚合 Request/Response 与模型层日志。
7. 本地假上游自动化端到端回归。
8. 真实已配置模型服务 live smoke。
9. 整组完整门禁。

## 已知风险与缓解

- 独立 WebSocket 增加鉴权、连接、幂等和恢复复杂度：使用单长连接、固定子协议、纯状态机、标准 Ping/Pong 和 close code，并以定向测试锁定边界。
- Markdown 在语法未闭合时短暂重排：始终渲染聚合全文并以 50–100ms 合并刷新，终态全文校准。
- 至少一次投递导致正文重复：`eventId` 去重、`sequence` 检查、最终全文覆盖三层保护。
- 分片日志造成存储爆炸：分片只进入运行事件和聚合器，接口日志按一次供应商调用配对。
- live smoke 依赖用户真实服务状态和额度：它是明确的人工/本地验收，不进入默认 CI；失败必须暴露真实原因，不能降级。
- 首版只支持 OpenAI-compatible：Anthropic 继续可配置和测试，但 Agent 选择中明确不可执行。
