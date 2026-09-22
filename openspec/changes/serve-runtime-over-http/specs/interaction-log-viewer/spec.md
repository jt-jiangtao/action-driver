## Purpose

定义开发者与用户在控制台和日志页面查看 Renderer 与服务端交互记录的行为，使本地运行的应用无需外部终端也能核对交互、耗时与失败原因。

## ADDED Requirements

### Requirement: 在控制台打印交互记录
系统 SHALL 在开发态把每一次 Renderer 与服务端交互打印为可读的一行记录，包含方向、通道或端点、结果与耗时；记录 MUST NOT 包含凭据或载荷正文，并 SHALL 可通过环境变量关闭。

#### Scenario: 页面调用服务端能力
- **WHEN** 页面发起一次服务端调用
- **THEN** 控制台先打印出站行，完成后打印结果行与耗时

#### Scenario: 调用失败
- **WHEN** 调用返回错误
- **THEN** 控制台打印错误行并包含可读错误码，不打印凭据与请求体

#### Scenario: 关闭控制台输出
- **WHEN** 运行环境把控制台日志开关设为关闭
- **THEN** 不再打印交互行，文件日志与日志页面不受影响

### Requirement: 提供日志页面
系统 SHALL 提供查看最近交互记录的页面，展示时间、方向、传输协议、通道或端点、结果、耗时与请求/响应载荷大小，并 SHALL 支持按级别、方向、传输协议与关键词过滤以及刷新；页面 MUST 通过服务端接口读取记录，不直接访问日志文件路径。

#### Scenario: 打开日志页面
- **WHEN** 用户进入日志页面
- **THEN** 页面展示最近交互记录，并按时间顺序排列

#### Scenario: 过滤与刷新
- **WHEN** 用户选择级别、方向、IPC/HTTP/WebSocket 传输协议或关键词过滤，或触发刷新
- **THEN** 页面按条件展示匹配记录，并保持原有顺序与滚动位置

#### Scenario: 没有或无法读取日志
- **WHEN** 尚无日志或日志读取失败
- **THEN** 页面展示明确的空状态或可诊断错误，并显示日志文件位置与查看方式

#### Scenario: 自动刷新
- **WHEN** 页面处于自动刷新状态
- **THEN** 新记录按间隔追加，用户可暂停自动刷新

### Requirement: 将请求与响应记录为结构化交互事件
系统 SHALL 为每次 IPC、HTTP 和可配对的 WebSocket 调用创建结构化交互事件，并 SHALL 使用同一 `correlationId` 关联实际发生的 Request 与 Response；系统 MUST NOT 为单向消息伪造不存在的另一侧。

#### Scenario: 请求成功返回
- **WHEN** 一次跨边界请求收到响应
- **THEN** 系统在同一事件中保存请求、响应、结果、状态码与耗时，并使列表摘要和详情引用同一事件 ID

#### Scenario: 请求仍在执行
- **WHEN** 请求已经写入但响应尚未到达
- **THEN** 事件显示为 `pending`，且详情只展示实际存在的请求内容

#### Scenario: 进程退出后留下未完成请求
- **WHEN** 系统恢复时发现无法继续完成的旧 `pending` 事件
- **THEN** 事件转为 `incomplete` 并保留已有请求，不伪造失败响应

#### Scenario: WebSocket 单向推送
- **WHEN** 服务端推送没有对应请求的 WebSocket 事件
- **THEN** 系统将其记录为 `one-way-event`，只展示实际消息方向与载荷

#### Scenario: 查询日志控制面
- **WHEN** Renderer 调用 `actiondriver:log:list`、`actiondriver:log:detail` 或其他 `actiondriver:log:*` 日志管理通道
- **THEN** 系统返回日志数据但不为该调用创建新的交互事件，避免查询行为污染记录或形成递归采集

### Requirement: 按需读取请求与响应详情
日志查询服务 SHALL 将摘要列表与单条详情拆分：列表响应 MUST NOT 包含请求或响应正文，详情接口 SHALL 只按事件 ID 返回该事件可用的 Request/Response；筛选、分页和自动刷新 MUST NOT 批量加载正文。

#### Scenario: 浏览事件列表
- **WHEN** 页面读取、筛选、翻页或自动刷新交互列表
- **THEN** 服务端只返回摘要、载荷大小与可用性标记，不返回正文

#### Scenario: 打开事件详情
- **WHEN** 用户选择一条事件
- **THEN** 页面单独读取该事件详情，并允许独立展开、收起和复制 Request、Response 与原始元数据

#### Scenario: 格式化可读正文
- **WHEN** 载荷是 JSON 或文本
- **THEN** 页面按内容类型提供可读格式，同时保留能够准确复制的原始文本

#### Scenario: 自动刷新时保持详情
- **WHEN** 用户已打开详情且列表继续自动刷新
- **THEN** 当前详情保持打开和稳定，除非用户关闭或该事件已被保留策略清理

### Requirement: 按真实传输协议筛选
系统 SHALL 把 IPC、HTTP 与 WebSocket 作为传输协议枚举，并 SHALL 支持单选或多选；OpenAI 与 Anthropic 等模型供应商协议 MUST NOT 混入传输协议筛选器。

#### Scenario: 选择一个传输协议
- **WHEN** 用户只选择 HTTP
- **THEN** 列表只展示 `transport=http` 的事件，同时保留其他级别、方向和关键词条件

#### Scenario: 选择多个传输协议
- **WHEN** 用户同时选择 IPC 与 WebSocket
- **THEN** 列表展示两种协议的并集，且不展示 HTTP 事件

#### Scenario: 清除协议筛选
- **WHEN** 用户清除传输协议条件
- **THEN** 页面恢复展示所有协议并保留其他筛选条件

### Requirement: 保存业务正文但排除鉴权凭据
系统 SHALL 按容量规则原样保存系统提示词、用户输入、模型请求与模型返回等业务正文；服务端访问凭据、模型供应商密钥、Authorization、Proxy-Authorization、Cookie、Set-Cookie、X-API-Key 与鉴权 DTO 明确声明的密钥字段 MUST NOT 出现在摘要、详情、复制内容或原始记录中。

#### Scenario: 正文包含模型输入输出
- **WHEN** 一次交互携带系统提示词、用户输入或模型返回
- **THEN** 详情按原始业务内容展示，不进行通用关键词替换或递归字段脱敏

#### Scenario: 请求携带鉴权信息
- **WHEN** 请求头或鉴权 DTO 包含访问凭据或模型密钥
- **THEN** 写入前排除凭据，并且后续所有查询与复制路径都无法恢复该值

#### Scenario: 凭据过滤无法安全完成
- **WHEN** 采集端无法确认凭据已经从正文边界排除
- **THEN** 系统拒绝持久化正文，只保存带诊断原因且不含正文的摘要

### Requirement: 限制日志载荷占用并表达缺失状态
本地日志 SHALL 默认最多占用 256 MiB、最长保留 7 天、单个文本载荷最多保存 4 MiB，并 SHALL 在容量或时间任一超限时从最旧事件开始共同删除摘要与载荷；二进制载荷 MUST 只记录内容类型、大小与摘要。

#### Scenario: 文本载荷超过单条上限
- **WHEN** Request 或 Response 文本超过 4 MiB
- **THEN** 系统保存可诊断片段、记录原始字节数并标记 `truncated=true`，页面明确显示截断状态

#### Scenario: 达到总容量或保留期限
- **WHEN** 日志超过 256 MiB 或事件早于 7 天
- **THEN** 清理器从最旧事件开始同时删除摘要和载荷，且重复执行不会破坏其余事件

#### Scenario: 详情载荷已经缺失或过期
- **WHEN** 用户查看的事件摘要仍可见但载荷无法读取或刚被清理
- **THEN** 页面保留详情结构并显示“载荷已过期”或可诊断错误，不把缺失载荷显示为空正文

#### Scenario: 记录二进制载荷
- **WHEN** 交互携带二进制 Request 或 Response
- **THEN** 系统只保存类型、原始大小与摘要，页面不加载或复制原始二进制
