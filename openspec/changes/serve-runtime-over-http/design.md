## Context

参见 `proposal.md` 的 Why。当前状态：Electron Main 通过 `utilityProcess.fork()` 启动 `apps/agent-runtime`，用 `MessageChannelMain` + `packages/runtime-contracts` 的私有 RPC 通信；Runtime 独占 SQLite，保存任务、消息、步骤、Skill 调用、运行事件与 LangGraph checkpoint；模型连接实现（`apps/desktop/src/main/model-connections/*`）位于客户端，凭据经 `safeStorage` 写入 `userData/data/model-connections.json`。

用户已裁决的终态约束（2026-09-22）：

1. 服务端当前集成在客户端内，且必须可原样迁移到云端；后期做云端执行。
2. 会话数据与配置都由服务端写入本地存储，服务端是唯一写入者。
3. 客户端与服务端之间直接使用 HTTP；会话使用 WebSocket。

## Goals / Non-Goals

**Goals:**

- 用 HTTP + WebSocket 建立稳定、版本化的客户端—服务端边界，替换私有 MessagePort RPC。
- 让服务端成为会话数据与配置的唯一写入者，并真实发起模型请求。
- 让服务端代码在本地与云端两种装配下复用，传输、存储、凭据全部端口化。
- 优先形成可验收的真实流式闭环：模型选择、会话创建、WebSocket 增量输出、Markdown 渲染、任务持久化与请求/响应日志能够用同一组标识串联。

**Non-Goals:**

- 不实现真实 Browser Use、Computer Use、Skill 或 Anthropic Agent 执行；没有相关动作时任务页不装配或展示右侧面板。
- 不在本期实现云端部署、账号体系、多端同步或数据迁移到云端。
- 不改变会话历史归属：历史仍只写在本地，云端推理不成为历史的事实来源。
- 不引入第三方 HTTP 框架作为强制依赖；除非实施中发现必要，传输层使用 Node 内建 `http`/`ws` 能力或等价的轻量实现。
- 不在首个流式闭环中实现人工接管、复杂多任务控制或完整反向 Skill 调用；只保留协议扩展边界。

## Decisions

### 1. 服务端载体：扩展现有 `apps/agent-runtime`

把 `apps/agent-runtime` 明确定位为"可迁移的本地服务端"：它已经是被客户端嵌入的独立进程、已经是 SQLite 的唯一写者、已经持有 checkpoint 与事件游标。本期在其中加入 HTTP/WS 传输、配置与凭据存储、模型请求执行，并把 Main 的代理层收窄为"启动 + 注入地址与凭据"。

替代方案 A：新建 `apps/server` 独立 HTTP 服务，runtime 作为其内部模块。代价是短期出现两个进程边界与两套启动逻辑，且要重新决定谁写 SQLite；收益是边界更直观。
替代方案 B：把服务端写成纯云端服务，本地只留 UI 与 Skill。代价是本期无法离线运行、所有会话都要联网，与"数据写在本地"的裁决冲突。

选择"扩展现有 runtime"的理由：保持一个进程、一个写者、一次迁移；同时通过端口化（决策 5）让它在云端装配时仍然成立。裁决状态：**已裁决（2026-09-22）：采用扩展 `apps/agent-runtime`**。

### 2. 传输：HTTP 承载配置，WebSocket 承载会话

- HTTP：`GET /health`、`GET /version`、模型连接 CRUD、模型发现、连接测试、模型测试、任务查询。
- WebSocket：客户端建立一条应用级长期连接，使用子协议 `actiondriver.stream.v1`。客户端事件为 `auth`、`request.create`、`request.cancel`、`request.resume`；服务端控制事件为 `session.ready`、`request.accepted`、`request.error`、`response.snapshot`；流式事件固定为 `response.start`、`response.content`、`response.end`。
- 生命周期：服务端只有在初始会话、任务和用户消息持久化成功后才发送 `request.accepted`。每个已开始响应严格遵循 `start → content* → end`；开始前失败使用 `request.error`，开始后的完成、失败和取消都以唯一 `response.end` 收口。
- 标识：`eventId` 用于去重，`requestId` 用于命令关联，`idempotencyKey` 用于安全重试；`responseId`、`sessionId`、`taskId`、`streamId`、`messageId` 分别标识响应、会话、任务、流和消息。每个响应的 `sequence` 从 0 单调递增，持久化事件另带全局可恢复 `cursor`。
- 事件恢复：传输按至少一次投递设计。客户端只在成功应用事件后推进本地 cursor，重连时发送 `request.resume(afterCursor)`；服务端重放相同 `eventId` 的原事件，客户端先按 `eventId` 去重，再按 `sequence` 检测缺口。保留窗口外返回 `response.snapshot`，客户端用持久化全文替换不完整投影。
- 终态校准：`response.content` 只携带 `delta`；`response.end` 始终携带当前最终聚合 `content`、`finishReason`、`usage`、`durationMs` 与可选结构化错误。客户端以全文覆盖校准，不再次追加。
- 连接治理：协议心跳使用 WebSocket 原生 Ping/Pong，不新增 JSON ping 消息；正常关闭、协议错误、策略拒绝、消息过大、服务端错误和过载分别使用标准 close code 1000、1002、1008、1009、1011、1013。重连采用指数退避与抖动。
- 反向调用：本地装配下复用同一连接，携带 `invocationId`、`deadline`、取消语义；迟到响应只记录诊断。云端装配不操作用户本机 GUI，因此该通道只服务同机装配。

替代方案 A：全部走 HTTP（含 SSE 事件流 + 轮询控制）。代价是双向调用（服务端 → 本机 Skill）需要额外通道，而云端形态下本地不能监听入站端口。
替代方案 B：保留 MessagePort RPC，仅在协议上换成 HTTP 语义。代价是与"可迁移云端"目标冲突。
替代方案 C：全 WebSocket（含配置接口）。代价是配置类操作失去 HTTP 语义与缓存、调试与工具生态。

选择 HTTP + WS 混合的理由：配置是请求/响应型操作，会话是持续双向流；这是行业标准分工，也直接支持未来远程 Runtime。首版本地闭环曾比较“复用既有 Runtime 事件通道”和“独立 WebSocket”；前者实现成本更低，Agent 曾推荐前者，但用户明确选择后者以避免未来远程形态再次更换协议。裁决状态：**已裁决（HTTP 用于查询与配置，独立 WebSocket 用于创建、取消、恢复和流式输出）**。

### 3. 配置与凭据归属：服务端持有并写入本地

模型连接（名称、协议、地址、启用的模型、测试状态）与凭据由服务端持有；本地形态下凭据加密后写入本地存储，模型请求由服务端发起。客户端设置页只提交一次表单并读取掩码提示。

替代方案：客户端持有凭据、请求时透传给服务端。代价是凭据暴露在页面层与网络层，且云端形态下页面必须把凭据发到云端；与"服务端实际发起请求"的裁决冲突。

裁决状态：**已裁决（配置经由服务端写入本地）**。

### 4. 页面直连服务端，Main 收窄

页面通过 Electron Main 注入的地址与访问凭据直接访问 HTTP/WS。Main 只保留：启动与监督本地服务端、注入地址与凭据、承载 Browser/Computer Skill 与 macOS 能力。

替代方案：Main 作为代理，页面只走白名单 IPC。代价是新增一层需要维护的适配器，且与"页面与服务端分离、服务端可迁云端"的意图相悖。

裁决状态：**已裁决并细化（2026-09-22）**：本地形态由 Electron Main 作为服务端原生客户端、页面经窄桥接口访问（与 Codex app-server 拒绝浏览器 Origin 请求的做法一致）；云端形态页面直连 HTTPS/WSS。这覆盖此前"渲染进程不直连网络"的约束，代价在 Risks 中记录。

### 5. 可迁移性：传输 / 存储 / 凭据 / 时钟 / ID 全部端口化

| 端口 | 本地装配 | 云端装配（后续） |
| --- | --- | --- |
| 传输 | 回环 HTTP + WS | HTTPS + WSS（网关/域名） |
| 存储 | 本地 SQLite 与本地文件 | 远端数据库与对象存储 |
| 凭据 | 本地加密（依赖主进程注入的加密能力） | 托管密钥管理服务 |
| 时钟 / ID | 系统时钟与 UUID | 同一实现（无本机假设） |

业务代码只依赖端口，不出现 `app.getPath()`、`safeStorage`、回环地址等本机假设；装配由进程入口决定。裁决状态：**已裁决（服务端需要可迁移到云端）**；本地形态采用**配置与会话同一 SQLite 库**、**每启动一次性凭据 + 回环地址 + Origin 校验**。

### 6. 迁移与下线

实施顺序：先在服务端内建立 HTTP/WS 与配置存储 → 迁移已配置的两条连接（含加密凭据，在服务端解密后重新加密写入本地存储）→ 页面改为 HTTP/WS 客户端 → 移除 Main 的凭据存储与 MessagePort 代理层 → 移除 `packages/runtime-contracts` 的私有协议中被取代的部分。

回滚策略：保留一版 `implement-model-connections-service` 记录与提交，出现严重问题时可按提交回退客户端实现；服务端存储使用带版本的迁移，旧配置在迁移成功前不删除。

### 7. 参考 Codex app-server 的取舍（2026-09-22 核实）

用户要求参考 Codex 的做法。已核实的官方事实（[Codex App Server](https://developers.openai.com/codex/app-server)、[Codex environments](https://learn.chatgpt.com/docs/environments/modes)、[Codex cloud](https://learn.chatgpt.com/docs/cloud)）：

- Codex 用**本地 app-server 进程**承载会话历史、认证、审批与流式事件，富客户端（CLI TUI、IDE 扩展等）是它的客户端。
- 协议是**双向 JSON-RPC 2.0**（`thread/start`、`turn/start` 等请求；`turn/started` 等通知），传输支持 stdio（默认）、Unix socket 与 WebSocket；WebSocket 目前被官方标注为实验性、不推荐生产使用。
- HTTP 只用于健康探测：`GET /readyz`、`GET /healthz`；**带 Origin 头的请求一律返回 403**，即浏览器页面被刻意挡在本地服务端之外。
- 同一个 app-server 可以远端运行（`--listen ws://IP:PORT`），客户端用 `codex --remote wss://…` 连接，凭据来自环境变量/文件（`--remote-auth-token-env`、`--ws-auth capability-token|signed-bearer-token`），并要求 TLS。
- app-server 与它的 Code Mode host 之间是**服务端主动出站**的连接（`--code-mode-host wss://…`），与"云端服务端反向请求本地执行"的形态一致。
- 入口做了背压保护：队列满时返回 JSON-RPC `-32001 Server overloaded; retry later`，客户端按指数退避 + 抖动重试。
- 客户端类型由服务端按版本生成（`codex app-server generate-ts` / `generate-json-schema`），避免协议漂移。

对 ActionDriver 的取舍：

1. **采纳**：本地服务端持有会话与配置、客户端是它的客户端、健康检查走 HTTP、远端模式用 WSS + token + TLS、反向调用走服务端出站连接、入口做背压与结构化错误、客户端类型由服务端版本生成。
2. **调整**：Codex 明确拒绝带 Origin 的本地请求，说明"浏览器页面直连本地服务端"不是它采用的做法。因此本地形态建议由 Electron Main 作为服务端的原生客户端（页面经窄桥接口使用能力），云端形态再由页面直连 HTTPS/WSS。两个形态对页面暴露同一组接口，只替换传输适配器。
3. **不建议照搬**：WebSocket 在 Codex 中仍是实验性传输，默认是 stdio；ActionDriver 是 Electron + TypeScript，直接采用 HTTP + WebSocket 比自实现 stdio 帧更稳妥，但需要自行承担 Codex 已经处理好的鉴权、背压与版本兼容。
4. **与 Codex 的差异（2026-09-22 用户裁决）**：云端执行**不操作**用户本机 GUI。云端装配只运行服务端侧能力（含将来的云端浏览器/沙箱），不通过客户端反向请求本机 Browser/Computer 动作；本机 GUI 动作只发生在本地装配。这样云端与本地是两套执行环境，而不是"云端大脑 + 本机手脚"。

### 8. 接口日志：结构化配对事件与独立载荷存储

接口日志使用统一的 `InteractionLogStore` 端口，不再把 Pino JSON 行本身当成页面查询契约。采集端先写入摘要并得到事件 ID，再在交互完成时以同一 `correlationId` 补充响应、结果和耗时；页面列表只读取摘要，用户打开详情时才通过 `getDetail(eventId)` 读取 Request/Response 正文。

摘要模型 `InteractionLogSummary` 包含：事件 ID、`correlationId`、时间、`transport`（`ipc | http | websocket`）、方向、交互种类、操作、`requestId`、`taskId`、结果、状态码、耗时、请求/响应字节数、载荷可用性与截断状态。详情模型 `InteractionLogDetail` 在摘要上增加 Request/Response 载荷描述，载荷描述包含 `kind`（`json | text | binary-metadata | empty`）、`contentType`、原始字节数、是否截断和可显示正文。

请求写入后、响应尚未到达时事件状态为 `pending`；进程恢复时无法完成的旧 `pending` 事件转为 `incomplete`，不得伪装为失败响应。WebSocket 事件推送与其他天然单向消息使用 `one-way-event`，只保存实际存在的一侧，不创建虚假的 Request 或 Response。

本地适配器在日志目录保存追加式摘要索引和按事件 ID 命名的独立压缩载荷文件；摘要与载荷使用临时文件 + 原子替换提交，清理时作为同一事件删除。云端装配可把同一端口替换成数据库索引与对象存储，页面和采集端不感知部署差异。

本地默认保留策略为总容量 256 MiB、最长 7 天、单个文本载荷最多 4 MiB；容量或时间任一超限时从最旧事件开始同时删除摘要和载荷。超过单载荷上限时保留可诊断的文本片段并设置 `truncated=true`，同时记录原始字节数；二进制只记录类型、大小与摘要，不把原始内容传给日志页面。保留参数由装配配置注入，业务代码不得硬编码用户目录。

业务正文不做内容脱敏：系统提示词、用户输入、模型请求和模型返回按上述容量规则原样保存。写入前只在已知凭据边界排除 `Authorization`、`Proxy-Authorization`、`Cookie`、`Set-Cookie`、`X-API-Key` 以及模型连接和服务端鉴权 DTO 中明确声明的密钥字段；不得递归删除业务正文中碰巧名为 `token` 的普通字段。凭据过滤失败时拒绝持久化正文，只保留带诊断原因的摘要。

查询端口拆分为摘要分页与单条详情：`list` 支持传输协议、方向、级别、关键词和分页游标，`getDetail` 只接受事件 ID。协议筛选只表达 IPC、HTTP、WebSocket；OpenAI/Anthropic 属于模型供应商协议，保留为上下文字段或后续独立筛选，不混入传输协议枚举。

日志查询与维护接口属于观测控制面，不属于被观测业务流量。Main 的统一 IPC 采集入口必须在开始记录前排除 `actiondriver:log:*`，包括列表、详情、刷新与后续日志管理通道；排除规则集中维护并由回归测试验证，避免日志页面每次刷新都生成新的日志事件。

替代方案 A：把完整 Request/Response 直接内联到现有 JSONL。实现成本较低，但自动刷新会重复读取并跨 IPC 传输大正文，现有小文件轮转也会快速淘汰可用记录。

替代方案 B：继续只保存载荷大小与摘要。体积和凭据风险最低，但无法在应用内复盘真实请求与响应，不满足本次目标。

裁决状态：**已裁决（2026-09-22）：采用结构化配对事件 + 独立载荷存储；业务正文原样保留，鉴权凭据永不落盘。**

### 9. 最高优先级垂直切片：真实 OpenAI-compatible 流式 Agent

首个可运行目标不是继续横向铺开传输层，而是形成一个端到端真实闭环：用户从服务端返回的已启用模型中选择一个 OpenAI-compatible 模型，通过 WebSocket 创建真实会话与任务，Runtime 使用该连接的真实凭据发起流式 `/chat/completions` 请求，页面持续渲染 assistant 内容，结束后从真实投影展示任务、会话详情、接口层日志和模型层日志。此前“先完成非流式闭环”的阶段性裁决已被本节取代。

模型选择使用 `{ connectionId, modelId }` 作为稳定身份，不能只依赖可能跨连接重复的 `modelId`。选择器只列出服务端真实返回且已启用、支持文本的模型；Anthropic-compatible 连接继续允许配置和测试，但首个切片在 Agent 选择器中不可选，并明确显示“Agent 调用暂未接入”。没有可用模型、已选模型被停用、连接删除和服务端不可用都必须有独立状态，不能回退到硬编码默认模型。

`request.create` 携带明确的模型引用、用户目标、主提示词与固定的 `skills=[]`。Runtime 通过同一个 `ModelConnectionService` 解析连接、解密凭据和创建真实模型网关；进程入口不得分别构造互不共享的连接服务，也不得在本地生产装配中回退到 `DeterministicModelGateway`。供应商密钥只在 Runtime 内存中的上游请求边界出现。

执行采用单轮流式语义：系统提示词与用户输入组成一次上游请求；服务端解析供应商分片、只发布用户可见的 assistant 文本，不发布隐藏推理内容。流式事件和 assistant 聚合全文由同一运行事务边界持久化，终态写入消息与任务投影。上游认证、限流、超时、协议错误和无文本响应映射为稳定错误码；界面只展示 Agent 输出与运行状态，不出现 Browser/Computer 面板或虚构步骤。

客户端在 `request.accepted` 后立即导航或绑定到真实会话，插入已持久化的用户消息与一个稳定 `messageId` 的空 assistant 消息。收到 `response.content` 时只更新该消息的字符串缓冲；为避免逐 token 触发高频布局，视图层以 50–100ms 合并刷新，但不得改变事件和持久化语义。每次刷新都把当前完整字符串交给 `markdown-it`，保持 `html: false`，不单独解析 delta。收到 `response.end` 后用最终全文校准，停止生成状态并显示完成、失败或取消结果。

本地生产装配必须读取真实数据：模型选项来自连接服务，最近任务/会话与任务详情来自 Runtime 存储，接口层日志来自 `InteractionLogStore`，模型层日志由真实运行事件投影。刷新应用或重启本地服务后仍能恢复这些数据。Mock catalog、示例会话与示例模型日志只保留在测试/视觉装配中，并通过组合根显式注入，不能作为真实数据为空或请求失败时的降级内容。

日志链路覆盖客户端创建、Runtime 处理和供应商调用。供应商调用新增 `service->model` 方向，并在开始时创建一条 pending 记录，终态时以同一 `correlationId` 写入不含鉴权头和 API Key 的完整模型请求、最终聚合响应、用量、结束原因、状态与耗时。中间供应商分片和 `response.content` 不各自创建日志记录。模型层日志按同一 `taskId`、`requestId`、`correlationId` 投影系统提示词、用户输入、模型请求、最终模型响应和任务终态。`actiondriver:log:*` 等日志查询控制面继续排除，避免查看日志产生新的日志。

自动化回归使用本地假 OpenAI-compatible HTTP 服务，以确定性覆盖多分片 Markdown、错误、取消与断线恢复；但它不能替代真实服务验收。交付前还必须使用用户已在模型连接页配置并启用的真实 OpenAI-compatible 服务完成一次 live smoke：生产装配从 Runtime 凭据存储读取真实密钥，通过 WebSocket 创建任务并展示真实流式返回，结束后任务、消息与两层日志均可查询。live smoke 不把密钥写入命令、夹具、截图、日志或仓库，真实服务不可用时明确失败且不得回退假服务或 Mock。两类验收都断言不存在 Browser/Computer 面板、分片日志或正文重复。

替代方案 A 是同时实现 OpenAI 与 Anthropic 的执行路径；替代方案 B 是页面直连供应商；替代方案 C 是保留非流式上游并在客户端用定时器伪造逐字显示。前两者分别扩大首个切片和破坏凭据边界，方案 C 无法验证真实背压、取消、错误和日志终态。裁决状态：**已裁决（2026-09-23）：采用 OpenAI-compatible 真实流式垂直切片，Anthropic 暂只配置不可执行，所有可见任务与日志使用真实数据。**

## Risks / Trade-offs

- [重做传输层产生返工] → 复用既有领域类型与错误分类，只替换传输与装配；任务按"服务端 → 客户端 → 下线"顺序推进，每步保持可运行。
- [凭据密钥经环境变量注入 Runtime 属于已知临时妥协] → 本轮接受；后续改为主进程通过私有握手通道注入，消除子进程环境可见面。
- [页面直连导致凭据暴露面扩大（覆盖既有安全裁决）] → 本地形态只监听回环地址、每启动生成一次性访问凭据、请求走结构化错误且日志脱敏；页面不接触模型供应商凭据，只持有服务端访问凭据；后续云端形态引入正式鉴权与最小权限。
- [断线重连与游标恢复复杂] → 事件持久化 + 客户端幂等应用；专门覆盖重连、页面重载、重复投递三类测试。
- [独立 WebSocket 增加连接治理成本] → 使用单长连接、固定子协议、原生 Ping/Pong、标准 close code、指数退避和单一客户端状态机；这是用户为后续远程 Runtime 复用而接受的覆盖风险。
- [增量 Markdown 在语法未闭合时出现短暂重排] → 始终渲染聚合全文并以 50–100ms 合并刷新；终态全文校准，禁止逐分片创建独立 Markdown 节点。
- [上游分片数量使日志爆炸或日志页面递归污染] → 分片只进入运行事件与聚合器；接口日志按一次模型调用配对，日志控制面统一排除。
- [单写者与迁移期双写] → 迁移只在服务端内完成，客户端旧文件在迁移成功前保持只读，迁移后删除，禁止两端同时写。
- [`safeStorage` 属于客户端能力] → 通过凭据端口注入：本地装配由 Main 提供加密能力实现，云端装配使用托管密钥服务；端口缺失时拒绝保存明文。
- [云端执行阶段的数据归属与能力范围需要重新裁决] → 本期只保证边界与端口可迁移；云端阶段的历史归属、同步、隐私策略以及云端侧能力（云端浏览器/沙箱）范围作为独立 Battle，不在本 change 内假设。已裁决的是：云端不操作用户本机 GUI。
- [E2E 复杂度上升] → 视觉与组件测试继续绑定 Mock 服务端实现；新增以真实服务端进程为基础的集成 E2E，覆盖提交、事件、中断、恢复、退出清理与断线重连。
- [原始业务正文增加本地隐私暴露面] → 日志保持本地、使用容量与保留期双重上限并在页面明确提示；凭据边界始终过滤。用户已明确选择不对业务正文做脱敏。
- [大载荷拖慢列表刷新或跨进程传输] → 摘要与载荷物理分离，列表永不返回正文，详情按事件 ID 单独读取；文本超过 4 MiB 标记截断，二进制仅记录元数据。
- [摘要存在但载荷缺失或清理中断] → 详情返回结构化 `payload-unavailable` 状态，列表仍可读取；写入使用原子提交，清理以事件为单位且可重复执行。
- [首个闭环暂不支持 Anthropic 执行] → 保留连接配置与测试能力，在模型选择器明确禁用并说明原因；后续以独立增量接入，不伪装兼容。
- [真实数据为空时暴露旧 Mock 降级] → 本地生产组合根禁止注入 Mock catalog/gateway/log projection，并用重启恢复与空数据测试守卫。

## Migration Plan

0. 先完成真实 OpenAI-compatible 流式最小闭环：WebSocket 协议与流式上游 → 可恢复事件及消息持久化 → 页面 Markdown 流式渲染 → 聚合 Request/Response 日志 → 本地假上游 E2E。该步骤完成前只推进其直接依赖与严重回归修复。
1. 归档 `implement-model-connections-service`，保留"客户端侧实现"的历史记录（其实现将随后被本 change 取代）。
2. 在服务端内建立 HTTP/WS 传输与配置/凭据存储，保留既有领域模型、错误分类与"不支持文本"判定。
3. 迁移已配置的连接与凭据到服务端存储，验证迁移后可读取、可测试、可启用/停用。
4. 客户端改为 HTTP/WS：设置页走 HTTP，任务页走 WebSocket；Main 与 Preload 收窄。
5. 移除 MessagePort 代理层与客户端凭据存储，更新打包与冒烟验证。

### 功能扩展顺序（2026-09-22 用户确认）

实施按前端功能逐个交付，每个功能端到端可用后再进入下一个：

1. **真实 OpenAI-compatible 流式最小闭环**：模型配置与选择 → WebSocket 创建会话 → 真实流式生成与 Markdown 渲染 → 真实任务/会话列表 → 聚合接口层与模型层日志；作为一个垂直切片验收
2. **Anthropic 执行路径**：在不改变模型引用、流式生命周期和数据所有权的前提下增量接入
3. **通用列表与控制能力**：继续完成多任务、断线恢复、中断/继续等完整会话协议
4. **添加 Skill**（MCP 暂不考虑）
5. **Browser Use**（独立 change）
6. **Computer Use**（独立 change）

## 后续阶段路线（本 change 不实施，登记以防漏项）

| 阶段 | 终态目标（来自已确认产品要求） | 关键工作 |
| --- | --- | --- |
| Browser Use（下一个独立 change） | 网页直接嵌入产品内、操作以 Skill 暴露、页面实时展示观察/步骤/目标高亮 | Playwright Fork 第一版；内嵌浏览器真实导航；Action Graph 与稳定 Node Handle 的第一次落地；页面高亮与状态动画 |
| Native Browser Engine | 定制 Electron/Chromium Fork，改内核向 Agent 暴露 Action Graph、增量观察与受约束动作 | Chromium 构建与供应链；内核侧 Action Graph 暴露；Jev 接入；与 Playwright 引擎各自独立评测 |
| Computer Use | 通过 AXUIElement、CGEvent、ScreenCaptureKit 实现全系统操作 | Swift/Objective-C++ 原生服务；辅助功能与录屏权限引导；与 Browser Use 高层统一、底层独立 |
| 云端执行 | 服务端可部署云端执行 Agent Loop，且不操作用户本机 GUI | 云端装配（传输/存储/凭据端口切换）；云端侧执行环境（含云端浏览器/沙箱的选型）；历史归属与同步策略（需独立 Battle） |
| 记忆与重放 | Page Memory、Procedure Memory、零 Token 重放 | 独立 change，依赖 Action Graph 稳定后设计 |

## Open Questions

当前服务端进程形态、本地鉴权、存储布局、旧通道处置、离线行为、日志入口、自动刷新和日志视觉方向均已裁决并进入规格与任务；本 change 暂无阻塞实施的开放问题。云端历史同步、云端隐私策略和云端侧能力范围留给后续独立 Battle。
