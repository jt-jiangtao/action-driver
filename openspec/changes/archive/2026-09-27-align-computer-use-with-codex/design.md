## Context

参见 `proposal.md` 的 Why。对照对象是本机安装的 Codex（ChatGPT.app 26.917）：`cua_node/lib/node_modules/@oai/{cua-repl,cua,sky}` 与 `~/.codex/computer-use/Codex Computer Use.app`。既有实现与问题见 2026-09-26 代码审查；既有裁决见已归档的 `2026-09-26-implement-computer-use` 与未完成的 `per-action-approval-in-js-entry`（本变更取代后者）。

Codex 的分层（据包内代码与配置确认）：

```
模型 ──js / js_reset──► cua_repl（launcher 生成工具描述，拉起 node_repl）
  node_repl 不受信上下文：模型代码 + cua 对象层（getApp → App 对象，薄封装扁平 sky 方法）
     └─ Trusted RPC ─► 受信 worker：@oai/sky/service
          withComputerUsePolicy：getAppPolicy → createElicitation（阻塞，暂停超时）→ 冻结入参
          └─ native pipe ─► Codex Computer Use.app（SkyComputerUseService：AX / 事件 / 截图 / 覆盖提示）
```

本仓库已有同构的三段：沙箱子进程（`repl-server.mjs`）↔ 宿主（`JsReplHost.callSky`，受信）↔ helper（Unix socket）。本变更保留这三段，改变每段的职责。

多轮会话已经存在：`stream-session-service` 以"同会话、新任务"实现追问，`request.create` 携带 `sessionId`，每轮创建新任务并带入会话历史。但 Computer Use 的 REPL 会话（`js-tools` 的 `sessions`）、已读 Skill（`LoadedSkills`）与控制门禁都按 taskId 维护，所以一到下一轮就全部丢失。旧的 `task.submit` 路径仍令 `sessionId = taskId`。

## Goals / Non-Goals

**Goals**

- 固定版本、明确支持范围内的模型接口、工具集合及输出通过兼容验证；不承诺完整产品行为一致。
- 授权按应用、在调用内阻塞完成，删除挂起/续接/重放机制。
- 目标应用可在后台被操作，同一应用同时只被一个任务操作。
- 覆盖提示、Esc 取消、用户介入中断与应用专属说明可用。
- 修复代码审查中的高危与中危问题。

**Non-Goals**

- 浏览器表面（`getBrowser`、`createBrowserTab`、Tab 对象）。
- 锁屏下工作、系统声音录制。
- 组织级应用策略的下发与管理界面（只预留 `denied` 判定）。

## Compatibility Battle（2026-09-26）

以 vendor/SOURCE.md 固定版本的 Codex JS 为基线，在明确支持的 macOS computer 范围内实现可验证兼容。验收涵盖工具与参数语义、状态及图片输出、审批、动作效果、错误和生命周期。复用源码不构成完整行为一致的证明；不承诺所有应用、系统版本或 Codex 原生 helper 行为完全相同。

用户选择 A；B 是以完整电脑操作行为一致为目标补全宿主并开展系统对照，成本更大且仍无法证明不可见原生实现的全部行为，未采用。自己的审批 HTTP/事件链路、Skill 加载、D9 策略名单、30 分钟/4 会话回收和 D6 前台坐标限制是本项目实现或明确差异，不能直接称为 Codex 事实。

兼容矩阵须列明方法、输入、输出与错误、应用/系统版本、前后台条件、证据及差异。未验证项不得标为兼容；成功投递不等于应用生效。D5 的连续动作与重读规则、D10 的受信宿主能力与模型权限隔离、D12 的取消及未知结果传播须先检查再实现。当前 D5 强制重读是本项目保守限制，若检查后需要改变安全或公共契约，先提供证据并裁决该项。

## Decisions

### D1 复用 Codex JavaScript，保留自己的 helper

用户已裁决只复用 JS、保留自己的 helper，复制的文件提交进仓库。原样复制本机 Codex 的 `@oai/cua-repl`、`@oai/cua`、`@oai/sky` 、Computer Use Skill 与配套文档到 `apps/agent-runtime/vendor/codex-cua/`，来源版本记录在 SOURCE.md，通过 `scripts/sync-codex-cua.mjs` 同步；vendor、来源记录和脚本均入库。不复制浏览器实现或原生二进制。

运行时通过受信加载钩子重定向 mac 传输与遥测，保留本项目原生 helper，不修改 vendor。库和 Computer Use Skill 直接复用 Codex，接口名称、参数和输出契约遵循对应版本，不自行设计替代接口。本机旧 Computer Use Skill 仍使用 node_repl/sky，与现行接口矛盾。用户补充裁决：直接复用 cua/docs/tinysky-alt-core-cua-repl.md 作为 Skill 正文，正文逐字保持原样，仅添加本项目加载所需的 frontmatter 元数据。用户进一步明确按整个 Skill 目录复用：原目录完整存入 vendor/skills/computer-use，运行资源保留全部引用、脚本和素材的相对路径，附带 codex-docs 文档目录；同步脚本复制目录并生成入口，由加载器提供；本项目仅编写宿主、传输、审批和 helper 的适配层。cua/App 对象接口、自动输出、首次文档与 rewriteDocumentation 行为复用 JS 包。模型只看到 js/js_reset，宿主负责轮次收尾。应用策略、审批与沙箱仍由本项目受信侧控制，不能因复用包绕过 D2/D9/D10。

- 替代方案：自行实现 cua 层并自行撰写文档，降低专有依赖，但增加行为漂移。用户选择复用 JS；专有文件仅内部使用，正式发布前移除或替换。必须测试自有 helper 的传输、输出及取消兼容性。

### D2 应用审批：宿主在调用内阻塞，不经过 LangGraph interrupt

`callSky` 对每个方法都执行以下步骤：

1. 解析入参，拒绝访问器属性，并冻结入参。
2. 向 helper 请求 `app-policy`，得到 `decision`（`allowed` / `denied` / `forbidden`）、`target`（bundleId、displayName、appPath、`risk: high|low`、`warningSubtitle`）和 `allowPersistentApproval`。
3. 若判定为 `denied` 或 `forbidden`，直接报错（`APP_DENIED` / `APP_FORBIDDEN`）。
4. 若该应用已在本会话获批或已被始终允许，直接放行。否则由 `AppApprovalBroker` 发出 `computer.app-approval.requested` 事件并 `await` 用户的决定，同时暂停该单元的超时计时，与 Codex 的 `withSuspendedTimeout` 等价。
5. 获批后把 `app` 替换为 `target.appPath`，再交给 sky 层执行。

审批传输路径：

- 请求和结果：AppApprovalBroker → stream-session-service 的活动 request → 带 cursor 的 WebSocket computer.app-approval.requested / resolved → renderer-stream-client → stream-task-projection → 授权卡。新增流契约、replay 和 response.snapshot 中的 pendingAppApproval；重连只恢复存活 broker 的待决请求，不能从历史复活取消的审批。
- 决定：授权卡 → desktop adapter 的专用 decideAppApproval → RuntimeAgentHttpApi → POST /tasks/:taskId/app-approvals/:approvalRequestId/decision → local-runtime-server 的 task.decide-app-approval { taskId, requestId: approvalRequestId, decision: once | session | always | deny } → 同一个 AppApprovalBroker 的等待 Promise。HTTP 和流服务共享 broker，校验 taskId 归属、拒绝过期及重复决定；approvalRequestId 与创建任务的 stream requestId 分开命名。

任务继续通过 WebSocket request.create 创建。决定不走现有 HTTP /tasks/:taskId/input → task.provide-input → graphRunner.provideInput，不重跑图或重放节点；不另加 WebSocket 决定入口。任务状态保持 `running`，投影新增 `pendingAppApproval`。以下三种情况都会让等待中的审批以 `CANCELLED` 结束：任务被中断、`js_reset`、单元超时。

传输实现进度：专用 HTTP 路由、runtime 命令、带 cursor 的请求/结果事件、桌面命令与投影已接入，并由 runtime-process 提供同一个 broker。`pendingAppApproval` 为待决请求数组，容纳并行调用的多个等待者。启用 broker 的流服务在重连时返回权威快照（含任务消息、活动、工具及存活审批），不重放历史授权请求到待决卡；历史事件仍持久保留。Broker 等待异步发布完成后才解除授权阻塞，发布失败不授予会话权限。始终允许存入 runtime SQLite 的 computer_app_approvals 表，不能覆盖 helper 当前 forbidden/denied 判定。旧 JS 入口与新 broker 的能力调用连接、授权卡及设置页仍未完成，以上不构成端到端验收。

作用域规则：

- "本会话"按 sessionId 记录，跨轮保留，会话结束时清除。
- "始终"持久化在 runtime 设置里，按 bundleId 记录；只有 `allowPersistentApproval` 为真时才提供这个选项。
- "仅本次"只放行当前这一次 sky 调用，与 Codex 中不带 persist 的 accept 相同。

- 替代方案：沿用 graph interrupt。它能让审批状态进入检查点、在进程重启后存活，但每次都要重放节点，这正是代码审查中第 1、2、8、9、10、11 项问题的根源，因此不采用。本方案的审批状态只存在内存里，runtime 重启会让进行中的调用失败并要求重试，这与 Codex 的行为一致。

### D3 敏感动作确认走追问，Computer Use 状态跨轮保留

与 Codex 一致，确认不是工具，而是对话：确认策略文档规定哪些动作必须先确认、哪些必须交给用户、哪些可以依据首轮指令里的预先许可直接执行。需要确认时，模型在回复中说明风险与具体动作，然后结束本轮；用户在同一会话中追问回复，下一轮任务继续执行。

这要求以下状态以 sessionId 为键跨轮保留：

- JS 子进程与 REPL 绑定：`js-tools` 的会话表、工作区映射、`JsReplHost` 都改为按 sessionId 寻址，工作区沿用会话工作区。
- 已读 Skill：`LoadedSkills` 改为按会话记录，下一轮无需重新执行 `skill_read`。
- 本会话授权（D2）与已注入的应用专属说明（D8）。
- 首次调用文档的输出状态：同一会话只在首轮输出，之后需要时由 `rewriteDocumentation()` 重新输出。

控制门禁的暂停与接管仍按任务生效（这两项是对某一轮的控制）；Esc 取消作用于整个会话，见 D7。

会话生命周期：会话从第一次 `js` 调用开始，在以下任一情况下结束：闲置超过 30 分钟、被 LRU 逐出（最多 4 个）、用户执行 `js_reset`、用户按 Esc，或 runtime 退出。会话结束时终止子进程、删除截图目录、清除本会话授权。

- 替代方案：新增一个阻塞式确认工具，在调用内等待回答。它不依赖跨轮状态，但与 Codex 的交互不一致，还要额外增加一种卡片和一条命令。用户裁决"需要实现追问"，因此不采用。

### D4 每轮结束执行 `turn_ended` 等价收尾，不暴露给模型

Codex 的 `cua_repl` 在 `enabled_tools` 中列出了 `turn_ended`，node_repl 收到后执行收尾，从实现看是宿主在一轮结束时调用。本仓库在每轮任务进入终态（完成、失败、中断）时执行等价收尾：隐藏覆盖提示、释放本轮持有的应用租约、取消仍在等待的应用授权。REPL 会话与本会话授权保留。模型可见的工具只有 `js`、`js_reset`。

### D5 元素序号由 helper 按应用维护，并保持稳定

helper 为每个"会话 + 应用"保存最近一次的状态：元素表（AXUIElement 到序号）和渲染文本。每次读取时，与上一次记录中 `CFEqual` 相等的元素沿用原来的序号，新出现的元素分配新序号，因此差异输出里的序号可以直接使用。

动作只携带 `app + elementIndex`，不再携带 observationId。helper 用该应用最近一次状态解析序号，并逐项核对元素仍然存在、角色、标题、标识、位置都没有变化；任何一项不符就返回 `STALE_REFERENCE`。坐标动作以该应用窗口截图的像素坐标为准，并要求坐标落在窗口范围内。

动作执行后序号继续可用，允许 Codex 文档所述的批量写法（一个或多个动作后再 `getAXState()`）；每个动作前按上述规则逐个核对，读取失败后在重新读取成功前一律返回 `STALE_REFERENCE`。sky 层删除"失效后换新树重试"，已批准的动作最多执行一次。

**D5 补充裁决（2026-09-26，0.4 实测后）**：实测证实原"每个动作后作废全部序号"会使 Codex 文档推荐的批量动作在第二个动作失败。比较了三种方案：A 保持动作后强制重读（最保守，但与复用的 Skill 文档冲突）；B 允许连续动作并逐个核对元素（Agent 推荐）；C 连续动作但窗口数量或焦点窗口变化即作废（折中，实现更复杂）。用户选择 B。已知风险：动作改变界面上下文（如弹出对话框遮住原按钮）但目标元素属性未变时，后续动作仍会执行，与 Codex 承担相同风险。

- 替代方案：每次读取都按遍历顺序重新编号。这样实现简单，但差异输出中未变化的元素序号会悄悄漂移，模型拿旧序号就会点到别的元素，因此不采用。

### D6 后台操作（待前置验证）

- `getApp` 或 `app-state` 在应用未运行时，用 `activates = false` 启动它，不调用 `activate()`。
- `click`、`setValue`、`selectText`、`performSecondaryAction` 优先使用 AX 接口。
- 键盘事件通过 `CGEvent.postToPid` 发给目标进程，因此不能触发全局快捷键。按键按 xdotool 语法解析为 keycode 表，包括修饰键、功能键和小键盘键。
- `typeText` 中的 `\n` 和 `\r` 转换为回车键事件。
- 坐标点击、拖拽、滚动只在目标应用已处于前台时执行。后台请求在投递事件之前返回 `BACKGROUND_INPUT_UNSUPPORTED`，提示用户把目标切到前台；不试投后台鼠标事件，不自动切前台。动作前再次核对前台进程及目标窗口，若已切换则拒绝执行。基于元素的动作在后台仅使用可用的 AX 动作，无 AX 实现时同样返回不支持。
- 截图使用 ScreenCaptureKit 按窗口截取，统一输出 PNG。

### D7 覆盖提示、Esc 取消与用户介入（待签名 helper 权限验证）

helper 在第一次动作前显示一个不激活、不接收鼠标事件的浮层，文案为"Action-Driver 正在使用你的电脑 · Esc 取消"，会话结束时隐藏。

helper 同时安装一个只监听的事件 tap：

- 用户按 Esc 时，结束会话。此后同一任务的所有调用都返回 `USER_STOPPED_SESSION`，runtime 随即中断该任务。
- 动作执行期间，如果检测到并非由 helper 发出的鼠标或键盘事件（依据事件来源的进程号判断），就中断当前动作并返回 `USER_INTERVENED`；会话本身保留。

暂停和接管（ControlGate）沿用现有语义，并且在宿主执行每次 sky 调用之前都会检查。

### D8 应用专属说明

`app-state` 的结果可以携带 `appSpecificInstructions`。在同一会话中，每个应用只注入一次，形式为 `<app_specific_instructions>…</app_specific_instructions>`，放在状态文本前面。说明内容以资源文件形式随 helper 或 runtime 打包，按 bundleId 查找。首版只提供机制和少量示例条目。

### D9 应用策略与禁区

helper 判定 `forbidden` 的范围：

- 终端类应用：Terminal、iTerm2、Warp、Ghostty 等，按 bundleId 列表判断；
- Action-Driver 自身和它的 helper；
- 系统认证与隐私授权界面：SecurityAgent，以及系统设置中的隐私与安全、登录密码相关面板；
- 钥匙串访问。

风险等级为 `high` 的应用（浏览器、邮件、消息、系统设置等）会显示警告副标题，而且不提供"始终允许"。`denied` 由一个本地可配置的组织策略文件判定，首版只读取这个文件，不提供管理界面。

### D10 沙箱与唯一通道

用户补充裁决保留独立子进程，由系统沙箱与受信宿主承担安全边界。已比较专用 JS 隔离运行时，因额外依赖及集成成本未采用。node:vm 只用于绑定与执行语义，不声称构成权限隔离；按模型可以访问真实 process、伪造 IPC 的威胁模型验证。环境白名单不继承凭据；JS 专用 profile 限定初始 Node 可执行文件、拒绝 fork，脚本 profile 保持原能力。宿主只在存活单元内接收能力请求，拒绝重复/非法请求 ID；每次请求仍须进入受信 Skill、控制、策略与审批门禁。授权计时只能由宿主暂停和恢复，不接受子进程自报的授权或计时状态。

受信启动器与服务可使用自身所需模块，但不能泄漏导入能力或进程句柄给模型。Codex 启动器依赖独立 NodeREPL 执行器，复制 JS 不会提供它；须验证本项目宿主支持所用 Trusted RPC、审批、超时暂停、输出和收尾契约，禁止通过放宽模型权限启动原包。

- 仅模型代码的模块导入拒绝以下模块：`child_process`、`worker_threads`、`cluster`、`node:process`、`inspector`。
- JS 入口改用专属的沙箱配置：只允许执行 node 可执行文件本身（`process-exec` 限定为该路径的 literal），禁止 `process-fork`。脚本类工具继续使用原有配置，因此 `buildSandboxProfile` 需要增加参数。
- `getApp` 或 `app-state` 只接受三类值：bundleId、已登记应用的显示名、位于 `/Applications`、`/System/Applications`、`~/Applications` 之下的 .app 路径。拒绝会话工作区和临时目录中的路径。

### D11 数据：截图写入会话临时目录，输入文本按实际执行值脱敏

- sky 层把截图写入会话临时目录。`getScreenshot` 返回图片字节并自动输出。
- `nodeRepl.emitImage` 发出的图片进入 `VolatileComputerImages`，不再调用 `assets.saveGenerated`。
- 会话结束（见 D3）时删除临时目录。
- Computer Use JS 代码仅存内存；持久化输入只记录代码长度及 helper 明确确认成功的 typeText、paste、setValue 文本长度。原代码和屏幕输出在当前执行/下一次模型请求中以内存数据提供，历史、事件、交互日志与检查点不保存原文；参见 D11 补充裁决。

### D12 helper 通信：并发读取、可取消、执行后不判超时

socket 服务改为：读循环不阻塞，每个请求交给独立的 Task 处理，按 requestId 登记。桌面动作经过 actor 串行执行。`cancel` 请求把对应的 Task 标记为取消，Task 在安全点检查取消标记，不会在事件序列中途打断。

动作执行完成后不再检查 deadline。client 超时时发送 cancel 并返回 `TIMED_OUT`，注明“动作可能已执行，请重新读取状态”。执行结果此时未知；迟到响应仅用于内部结算，不改变已返回结果或重发动作。重新观察不保证能还原每个动作是否完成。此语义须纳入兼容验证。

## Risks / Trade-offs

- 应用获批后，该应用内的动作不再逐次确认，误操作和提示注入的影响范围扩大到整个应用。敏感动作是否确认依赖模型遵守确认策略（用户已接受）。
- 审批状态只存在内存中，runtime 重启会让等待中的调用失败，需要模型重试（与 Codex 一致）。
- 后台坐标鼠标操作明确不支持，只有可用的 AX 动作可后台执行；需要坐标的任务要求用户先把目标切到前台。键盘后台投递仍需逐应用验证，投递成功不等于输入生效。
- 只监听的事件 tap 需要辅助功能授权，并且可能触发"输入监控"授权，需要在打包冒烟测试中验证，必要时把"输入监控"加入授权指引。
- 截图会短暂落盘（用户已接受），会话结束时删除；进程异常退出时，残留文件由下次启动时清理。
- 接口名、包名和文档形态沿用 Codex 专有产品，存在授权与商标风险，本变更不处理。
- 模型提示词和 Skill 同时变化，已有的 e2e 交互契约需要整体更新。

## Migration Plan

1. 在 helper 和协议中新增按应用寻址的操作与错误码，同时保留旧的 `observe` / `capture` / `act` 操作，直到 runtime 切换完成。
2. runtime 引入 cua 层、`AppApprovalBroker`、按会话保留的 Computer Use 会话和每轮收尾钩子，然后删除挂起/续接协议和四个类型化工具。
3. desktop 更新审批卡和设置页。
4. 删除 helper 中的旧操作，更新主线规格，并把 `per-action-approval-in-js-entry` 归档为被取代。

## 前置验证记录

2026-09-26，macOS 27.0（26A428），Swift 进程探针结果：AXIsProcessTrusted=true，CGPreflightListenEventAccess=true，键盘/鼠标 cgSessionEventTap + listenOnly 创建成功，随即销毁。四个目标应用均已安装，Finder 与微信正在运行。

上述两个 preflight 都为 true 只表示当前访问可用，不能推断系统设置中两项均有独立授权；后续 UI 与签名身份验证见下。0.1/0.2 仍有未验证项，不因探针部分成功而勾选。

D6/D7 是待验证设计，0.1/0.2 完成前不得开始依赖它们的实现。0.1 要逐应用记录前台保持、实际输入效果和无响应检测方式；postToPid 无应用确认回执，成功投递不能当作动作成功。0.2 要在实际签名 helper 上分别验证仅辅助功能、仅输入监控、两者都有、两者都无四种组合，并确认真实 Esc/用户介入回调。若结论改变后台能力、失败检测或权限要求，先完成 Battle 裁决并更新设计及规格。

### D6 Battle 补充裁决（2026-09-26）

- 目标与成功标准：后台动作不误投前台应用，不伪造成功，不自动激活目标；不支持的请求在投递前得到明确错误。
- 新证据：Finder 临时目录窗口的坐标点击未展开搜索，AXPress 成功展开；Safari 本地测试页的坐标点击未触发按钮处理函数，AXPress 成功触发。Safari 滚动后 AXScrollBar 值仍为 0。所有这些操作都保持原前台应用。Safari 测试输入框收到 postToPid 键盘输入；Finder 搜索框未观察到字符，尚不能排除焦点或输入法因素。
- 验证限制：备忘录是空列表，搜索 AXPress 返回成功但没有暴露可输入字段，滚动没有有效内容可供验证；微信当前窗口 AX 树只暴露窗口控制按钮，无法验证内容输入。0.1 不标记全部完成。
- 主要质疑：postToPid 无应用执行回执，原方案无法可靠检测鼠标无响应并返回不支持；尝试后重试还可能重复执行。
- 可执行替代方案：取得用户许可后激活目标，再执行前台坐标操作，覆盖面更广但会中断当前工作。
- 推荐与用户明确裁决：后台用 AX；坐标鼠标操作仅在目标已处于前台时执行，后台直接报不支持。用户已选择推荐方案。不采用自动激活或后台试投。
- 已知权衡：后台能力覆盖面缩小，需要坐标的应用任务可能要求用户切换前台；后台键盘兼容性尚未充分验证。
- 重新开启条件：新证据表明 AX 后台动作也破坏前台状态，或提出新增自动激活/后台事件支持。

### D6 键盘补充裁决（2026-09-26，0.1 实测后）

- 新证据：备忘录在后台时 postToPid 键盘输入生效；微信（文件传输助手）在后台时同样返回成功，但用户确认输入框未出现文字。postToPid 没有应用回执，helper 无法判断后台键盘是否被接收，原实现报告 executed 构成伪造成功。
- 比较方案：A 保留后台键盘，改报「已投递未确认」（Agent 推荐）；B 键盘也要求前台，后台直接报不支持；C 按已验证应用白名单允许后台键盘。
- 用户裁决：A。目标不在前台时，`type`/`key` 返回 `executed: false, delivered: true`；运行时向当前单元输出提示，要求模型用截图或重新读取状态核实；未确认的输入不计入 D11 已执行文本长度。前台投递保持 executed。
- 已知权衡：后台键盘在部分应用上静默无效，依赖模型按提示核实；与 Codex 同样采用进程投递。

### D7 签名身份与真实事件验证（2026-09-26）

使用临时诊断 app，经 LaunchServices 启动，bundleId 为 com.action-driver.computer-use，可执行名与实际 helper 相同，并使用同一 Action-Driver Dev Signing 证书及 hardened runtime 签名。codesign 的 designated requirement 与实际 helper 相同：identifier com.action-driver.computer-use，certificate root SHA-1 8630c40a8f4ad70f37b6979e3d3295142d6a1fc4。结束后重新注册仓库中的实际 helper 路径。

系统设置的“隐私与安全 → 输入监控”列表显示“无项目”，未给 helper 单独添加输入监控授权。诊断进程 AXIsProcessTrusted=true，CGPreflightListenEventAccess=true，CGPreflightPostEventAccess=true，cgSessionEventTap + listenOnly 创建成功。用户按要求移动鼠标并按 Esc；60 秒窗口共收到 203 个事件、其中 1 次 Esc。探针仅记录计数，不保存键盘内容。

结论：在当前 macOS 27.0 机器、该签名身份已有辅助功能授权时，真实键盘/鼠标监听及 Esc 回调无需额外输入监控授权，支持 D7 的权限假设。不能据此声明整个监听状态机已集成，或推断 macOS 14–26 及其他签名身份的结果；四种权限组合尚未完整覆盖，0.2 不勾选。授权指引不凭猜测新增输入监控项。

### D7 权限矩阵实测（2026-09-26，0.2）

用实际 helper 的签名身份（临时在入口加入只计数的诊断参数，测后按备份原样还原并重新构建）逐组测试，每组由用户在 60 秒窗口内移动鼠标并按 Esc；只记录事件与 Esc 计数。

| 辅助功能 | 输入监控 | AX 预检 | 监听预检 | 投递预检 | tap 创建 | 事件 | Esc |
|---|---|---|---|---|---|---|---|
| 开 | 关 | ✓ | ✓ | ✓ | ✓ | 863 | 1 |
| 关 | 开 | ✗ | ✗ | ✗ | ✓ | 0 | 0 |
| 开 | 开 | ✓ | ✓ | ✓ | ✓ | 350 | 2 |
| 关 | 关 | ✗ | ✗ | ✗ | ✓ | 0 | 0 |

结论：在 macOS 27.0、当前签名身份下，监听与 Esc 取决于辅助功能授权；仅开输入监控收不到任何事件，开启辅助功能后是否开输入监控不影响结果，支持 D7 不新增输入监控授权指引的假设。未授权时 tap 仍创建成功但收不到事件，1.8 必须以辅助功能/监听预检判定可用，不能以 tap 创建成功判定。限制：切换授权后需重启进程且偶有未生效（“两者都开”首测全部为 ✗，用户重新确认后重测正常，首测不计）；“仅输入监控”一组无法排除开关未对该身份生效；不覆盖其他 macOS 版本与签名身份。

## Open Questions

- 后台鼠标事件在主流应用上的实际可用范围，需要在 P1 实施前做一次 spike（测试 Finder、Safari、备忘录、微信）。
- 当前 Mac 的同身份签名探针已证明：已有辅助功能授权时无需单独输入监控授权且能收到真实 Esc。尚需实际 helper 集成验证、其他权限组合与支持的 macOS 版本验证。

## 方案 A 兼容矩阵初稿（2026-09-26）

基线：SOURCE.md 中的 sky 0.7.1、cua 0.2.5、cua-repl 0.1.0；Mac 实测环境 macOS 27.0。状态“源码确认”仅证明 JS 契约，不证明 Action-Driver 已兼容。

| 范围 | 证据与状态 | 本项目差异或待验证项 |
|---|---|---|
| js/js_reset、隐藏收尾 | cua-repl README，源码确认 | 本项目工具迁移及收尾尚未完成 |
| getApp/listApps/getState、状态输出、rewriteDocumentation | create_tinysky_alt.js，源码确认 | 宿主 RPC 与模型实际输出未验证 |
| getAXState/getScreenshot/getAXStateAndScreenshot | 原 JS 方法契约确认 | 稳定序号、差异文本、截图区域与像素映射未验证 |
| click/drag/scroll | 原 JS 参数契约确认 | D6 前台坐标限制已裁决；AX 效果逐应用验证 |
| scroll 分页语义 | 未证明与原版一致 | 本项目按 Codex 的 `pages` 参数接受输入，但在 `codex-native-client` 里折算为 600 像素/页（`Math.round(pages * 600)`）。0.1 spike 中原生 `AXScrollDownByPage` 在备忘录上返回 ACTION_FAILED；1.5 实测坐标滚动能改变可见项（Finder 可见探针文件 17 → 0），但没有证据表明与原版分页距离相同。按本变更「未验证项不得标为兼容」的规则，此条 **不得标为兼容**；发布前需逐应用实测原版行为，或把差异写入用户可见文档。 |
| paste/pressKey/typeText/selectText/setValue/performSecondaryAction | 原 JS 参数契约确认 | 粘贴完成条件、UTF-16、目标输入及动作效果未验证 |
| 应用授权 | computer-use-policy.js 确认 elicitation、冻结与超时暂停 | 自有 HTTP/事件流传输；仅 helper 首批策略测试通过，未端到端验证 |
| 生命周期与取消 | 隐藏收尾源码确认；签名身份探针收到 Esc | 本项目会话回收与租约策略；实际 helper 权限矩阵未完成 |
| 文档与 Skill | 完整目录复制及正文一致测试通过 | 自有 Skill 加载；浏览器 API 不属于支持范围 |
| 沙箱与受信服务 | 原版 CUA + 受信 sky/service + 真实独立沙箱子进程链路已验证，D10 前置检查通过 | 模型子进程的 process 可达是已接受边界；受信端口留在宿主，实际生产注册与完整唯一通道验收尚未完成 |
| 超时、断线与迟到结果 | D12 已规定未知结果不自动重发 | 对照场景和实现未完成 |

应用策略首批实现：默认组织策略文件为 ~/Library/Application Support/Action-Driver/computer-use-policy.json，JSON 字段 deniedBundleIds 为非空 bundleId 字符串数组。缺失文件无额外组织拒绝；格式或读取错误拒绝完成策略判定。尚未接入实际动作门禁，系统设置敏感面板和桌面自身识别仍待补齐。

### 前置兼容检查的新增证据

- 原包在普通 Node 20 中启动时，嵌套 node_modules 下的 tslib.es6.js 被当作 CommonJS，出现命名导出错误。受信加载钩子仅对规范化 vendor 根目录中的 JS 指定 ESM 格式，不修改 vendor。真实子进程的原版 CUA 契约测试通过 3 项（包括禁止 fork 的 JS 专属沙箱内加载）：初始化文档不获取应用库存；sky setup/execute RPC、应用绑定及动作参数、emit:false、截图图片输出和跨 requestMeta 文档重写。RPC 和图片数据为替身，未证明原生动作效果或 Action-Driver 端到端兼容。
- 沙箱真实进程测试 3 项通过：初始 Node 可启动、不继承测试凭据和 NODE_OPTIONS、osascript 与另一 Node 子进程均被系统拒绝。原脚本启动子进程的定向回归测试保留，不将此有限验证称为完整 D10 兼容完成。
- Broker 内部 12 项测试与宿主授权计时测试通过；真实 HTTP/事件流、runtime 设置存储、复用包的受信服务接入仍未完成。
- D12 客户端测试覆盖动作投递后超时/断线、迟到成功不复活原请求且不重发；这些错误现明确提示可能已执行。客户端排队取消已验证及时拒绝且不投递；helper actor、安全取消及启动恢复尚待实现与验证。

- 额外协议限制：本项目目前限制元素序号为 0..1,000,000、坐标为 ±100,000、点击次数为 1..3。原 JS 的参数校验及不可见原生 helper 未证明这些上限相同，必须作为协议限制列入矩阵；不得把越界输入列为已验证兼容。

### 按会话运行时链路的新增证据（2026-09-26）

- CuaRuntime 按 sessionId 保留真实子进程、首次工作区和原版 sky/service，单元串行运行时才绑定当前 taskId。控制门禁与审批仍使用真实轮次 taskId，原生策略返回 canonical bundleId 后取得租约。CuaEntryTools 从原 vendor instructions 读取工具描述，仅返回 js/js_reset；endTurn、reset 和 dispose 是受信宿主入口。正式 runtime-process 尚未切换。
- 原版 CUA 的真实沙箱子进程经真实 broker 进入受信服务；审批等待、计时暂停、取消、参数与宿主上下文边界已经在整条链路验证。伪造 taskId、调用宿主 createElicitation、替换服务名以及导入 child_process 均失败且未投递动作。forbidden 在原版包装中呈现原包的 “Computer Use is not allowed … for safety reasons” 错误文本，保留原包行为，不把它误写成 APP_FORBIDDEN 的模型输出证据。
- 同会话下一轮不重新输出首次文档、重新询问已授权应用或重复注入说明；重置清空这些状态并删除真实 PNG 临时目录。闲置超过 30 分钟与最多 4 会话 LRU 逐出已测试；并发任务不会覆盖正在等待的审批上下文，立即重置可以取消尚未启动的运行。图片异步交付先于工具结果完成。
- 此处原生请求由测试替身响应。D7 的真实 helper 权限矩阵、正式任务终态/浮层收尾、D11 数据脱敏和生产易失图片接线仍未完成，不因此声称完整 Computer Use 或所有系统沙箱行为一致。

### D11 执行前代码存储的补充裁决（2026-09-26）

发现工具 proposed 事件与 LangGraph pendingToolCalls 会在执行前保存完整 JS，实际输入文本的事后脱敏无法保护早期记录。用户明确选择代码仅存内存：历史与检查点仅记录代码长度、实际执行文本长度，图片/屏幕输出继续仅内存传递。原代码只由受信运行时暂存并提供给当前执行与下一次模型请求，轮次结束后清理；进程重启后的待执行代码不可恢复，必须明确失败，不猜测或重发。实际输入长度仅在 helper 明确返回 executed=true 后登记；结果未知不伪造已执行摘要。放弃先加密落盘、执行后生成脱敏版本的方案，避免临时密钥与崩溃清理机制；代价是历史不展示原代码，待执行调用不可跨进程重启恢复。这是对“执行文本替换为长度占位”的收紧，既有历史不在本次迁移范围。
