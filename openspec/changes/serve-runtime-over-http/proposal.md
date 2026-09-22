## Why

当前运行时的客户端—服务端边界是定制的 MessagePort RPC：Electron Main 持有 RuntimeClient，Preload 只暴露白名单 IPC，模型连接配置与 API Key 存在客户端 `userData`，真实模型请求由客户端进程发出。这与已确认的终态不一致：**服务端即使当前集成在客户端内，也必须是会话数据与配置的唯一写入者、真实请求的发起者，并且可原样迁移到云端**；页面与服务端之间应使用行业标准传输（HTTP + WebSocket），而不是为本地形态定制的私有协议。

## What Changes

- **BREAKING**：以 HTTP + WebSocket 取代 MessagePort RPC。配置与模型连接走 HTTP；会话（提交目标、事件流、暂停/继续/人工接管、等待用户输入）走一条 WebSocket 长连接，服务端反向调用本机 Skill 也复用该连接。
- **BREAKING**：模型连接配置与凭据从 Electron Main 迁入服务端。服务端持有连接、凭据（本地形态加密后写入本地存储）并真实发起 `GET /models`、`POST /chat/completions`、`POST /v1/messages`；客户端页面只保留配置界面，不再持有密钥、不再直连供应商。
- 服务端成为会话数据与配置的唯一写入者，并保持本地存储；客户端页面不再读写存储。
- 服务端按"可迁移"约束实现：传输、存储、凭据、时钟与 ID 全部是端口，本地与云端各一套适配器，业务代码共用；本期只实现本地形态，云端形态作为同一代码的另一种装配。
- Electron Main 收窄为：启动并监督本地服务端、承载 Browser/Computer Skill 与 macOS 能力、把服务端地址与本机访问凭据交给页面。
- 页面直连服务端 HTTP/WS，需要网络访问与凭据处理；这取代此前"渲染进程不直连网络、只走白名单 IPC"的约束（用户已明确覆盖）。
- 接口层日志升级为结构化的请求/响应配对事件：用 `correlationId` 关联一次交互，按实际传输协议（IPC、HTTP、WebSocket）筛选；列表只读取摘要，详情按需读取独立保存的请求与响应载荷。
- 请求与响应正文不做业务内容脱敏，但服务端访问凭据、模型供应商密钥、Authorization、Cookie 与已知 Token 字段 MUST NOT 落盘；本地日志以容量与保留期双重上限淘汰最旧记录。

## Capabilities

### New Capabilities

- `runtime-service-transport`: 定义服务端对客户端暴露的 HTTP 接口与 WebSocket 会话协议：地址与凭据协商、配置接口、会话多路复用、事件游标恢复、控制命令、反向 Skill 调用、错误与版本协商，以及本地形态与云端形态共用同一契约的约束。

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
