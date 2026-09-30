## Why

Computer Use 的 Skill 与 `@oai/sky` 接口取自 Codex，但运行时的审批模型和执行模型与 Codex 相反，且参照的是 Codex 已经不再作为入口的旧接口。本机安装的 Codex（ChatGPT.app 26.917，`@oai/sky` 0.7.1、`@oai/cua` 0.2.5、`@oai/cua-repl` 0.1.0）实际行为如下：

- 入口是 `cua_repl`：模型可见工具为 `js`、`js_reset`；`turn_ended` 为宿主收尾入口；模型通过 `cua.getApp(...)` 取得应用对象再调用 `click(42)`、`getAXState()` 等方法；首次调用时返回核心文档与确认策略，获取应用或观察时自动输出界面状态。旧的扁平 `sky.get_app_state(...)` 接口只作为 `cua` 的下层实现保留。
- 审批按**应用**、在**调用内阻塞**进行：每个 sky 方法都经过应用策略检查（`allowed` / `denied` / `forbidden`，附风险等级与警告副标题），再通过 MCP form elicitation 询问"允许 Computer Use 使用 <应用>？"，可选仅本次、本会话、始终（仅当应用允许持久授权）；等待期间暂停工具超时；获批后冻结入参并把 `app` 替换为解析出的真实路径。点击、输入等单个动作不逐次确认，敏感动作由模型按独立的确认策略文档主动确认。
- 模型代码运行在不受信上下文，sky 实现与审批运行在受信 worker，经 Trusted RPC 调用。
- 元素序号由原生服务维护；读取应用状态时附带应用专属操作说明，每个应用每会话注入一次；屏幕覆盖提示"正在使用你的电脑 · Esc 取消"，用户按 Esc 结束会话、用户手动操作中断当前动作。

本仓库则按**动作**逐次确认，用"单元挂起 → LangGraph interrupt → 节点重放 → 续接"实现，并要求目标应用位于前台。2026-09-26 的代码审查中，审批卡不出现（`jsAction` 未被 `local-runtime-server` 识别）、SPLIT 后残留单元被下一次调用接管、重启后审批与动作错配、批准后自动重试执行用户未见的动作等高危问题，多数直接源自这套机制。

## Compatibility Scope

以 vendor/SOURCE.md 固定版本的 Codex JS 为基线，在明确支持的 macOS computer 范围内实现可验证兼容。验收涵盖工具与参数语义、状态及图片输出、审批、动作效果、错误和生命周期。复用源码不构成完整行为一致的证明；不承诺所有应用、系统版本或 Codex 原生 helper 行为完全相同。

## What Changes

- **BREAKING** 模型接口改为 Codex 现行的 `cua` 对象接口：`cua.getState()`、`cua.getApp(name|path|bundleId)`、`cua.listApps()`、`cua.rewriteDocumentation()`，应用对象提供 `getAXState` / `getScreenshot` / `getAXStateAndScreenshot` / `click` / `drag` / `scroll` / `selectText` / `setValue` / `performSecondaryAction` / `paste` / `pressKey` / `typeText`；观察与发现方法自动输出结果，支持 `{ emit: false }` 与 `{ disableDiffing: true }`；首次调用输出核心文档与确认策略。仅启用 computer 表面，不含浏览器表面（Browser Use 仍为独立 Skill）。
- **BREAKING** 模型可见工具集合改为 `js`、`js_reset`；`turn_ended` 仅作为宿主轮次收尾入口，不暴露给模型。`js` 的描述由入口说明、computer 用法与输出规则组成；`computer-use` Skill 直接复用 Codex 对应版本的原文。
- **BREAKING** 审批粒度由"每个动作"改为"每个应用"：每次 sky 调用先查应用策略，再在调用内阻塞询问（仅本次 / 本会话 / 始终）；已持久授权的应用直接放行；等待期间暂停工具超时；获批后冻结入参。
- **BREAKING** 移除 JS 单元挂起/续接协议：删除 `ApprovalRequiredError`、`ToolApprovalRequired`、`continuation.decisions`、`jsAction` 审批卡、`COMPUTER_ACTION_SPLIT_REQUIRED`、`APPROVAL_ROUND_LIMIT`；一次调用可连续执行多个动作。
- **BREAKING** 下线 `computer_permissions` / `computer_observe` / `computer_capture` / `computer_act` 四个类型化工具。
- 应用策略由 helper 判定：`forbidden`（终端类应用、Action-Driver 自身、系统认证与隐私授权弹窗）不可放行；`denied` 预留给组织策略；每个应用给出风险等级、警告副标题与是否允许持久授权。
- 敏感动作确认走追问，与 Codex 一致：内置确认策略文档，随首次调用输出；模型按策略在对话中向用户提问或要求接管，然后结束本轮；用户在同一会话中回复后继续。为此，REPL 会话、已读 Skill 与本会话授权都改为按 sessionId 跨轮保留。每轮结束时执行 `turn_ended` 等价收尾：隐藏覆盖提示、释放应用租约。会话闲置超时或被回收时，清理 REPL 与截图。
- helper 以应用为目标、可后台操作：元素序号由 helper 按应用维护；优先 AX 动作，键盘事件投递到目标进程、不能触发全局快捷键；截图按窗口采集；`getApp` 在后台启动未运行的应用、不抢前台；`typeText` 中的 `\n` / `\r` 模拟回车；按 xdotool 语法支持任意按键；支持右键 / 中键、`clickCount`、按元素或坐标滚动；后台仅使用可用 AX 动作，坐标鼠标操作要求目标已在前台，否则投递前返回不支持。
- 覆盖提示与 Esc 取消：Computer Use 会话进行时显示"Action-Driver 正在使用你的电脑 · Esc 取消"；按 Esc 结束会话并使后续调用返回 `USER_STOPPED_SESSION`，用户手动操作时中断当前动作并返回 `USER_INTERVENED`。
- 应用专属说明：helper 可为应用返回操作说明，读取应用状态时注入，每个应用每会话一次；`cua.rewriteDocumentation()` 在上下文压缩后重新输出文档。
- 同一应用同一时间只允许一个会话操作（应用级租约，按轮持有）。
- 已批准动作不自动重复执行（最终结果可能未知）：删除 sky 层"失效后换新树重试"；helper 在动作执行后不再以超时判失败；取消可中断排队与执行中的请求。
- JS 入口保持沙箱，禁止创建子进程，使 `cua`/sky 成为操作桌面的唯一通道；`getApp` 只打开 LaunchServices 已登记的应用。
- 截图写入会话临时目录、会话结束即删除，不进入会话历史与检查点；Computer Use JS 代码仅存内存，历史与检查点只保存代码长度及已确认执行文本的长度摘要，待执行代码不可跨进程重启恢复。
- 修复粘贴后过早恢复剪贴板、选区按字素而非 UTF-16 计算等审查问题。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `computer-use`: 模型接口改为 `cua` 对象接口；授权由逐动作改为逐应用并引入应用策略；执行目标由前台应用改为指定应用并支持后台；新增覆盖提示、Esc 取消、用户介入中断与应用专属说明；截图数据改为会话临时文件；取消、并发与失效引用语义收紧。

## Impact

- Runtime：`apps/agent-runtime/src/computer-use/*`（js-repl、js-tools、sky-session、cell-actions、tool-approval、tools、volatile-images，新增 cua 层与应用审批）、`agent-graph.ts` 审批循环、`local-runtime-server.ts` 与 `task-projection.ts` 审批投影、`runtime-process.ts` 工具注册、`execution/session-sandbox.ts`、`resources/js-repl/*`、`resources/prompts/main.md`、`resources/system-skills/computer-use/`。
- Desktop：`TaskPage.tsx` 审批卡改为应用授权卡；设置页增加"始终允许的应用"管理；`computer-use-client.ts` 取消与启动逻辑。
- Native helper：`NativeComputerUseService.swift`、`ComputerUseCore.swift`、`ComputerUseSocketServer.swift`、`ComputerUseMain.swift`，新增应用策略、覆盖窗口与 Esc 监听。
- 契约：`packages/runtime-contracts/src/computer-use-protocol.ts` 改为按应用寻址并新增错误码。
- 取代未完成的 `per-action-approval-in-js-entry`，本变更合入后应将其归档并注明被取代。
- 推翻主线规格中"逐次确认""默认允许所有应用""截图只走内存"三条既有裁决。

## Battle Status

- D10 隔离边界补充裁决：真实 REPL 探针可经暴露函数的 constructor 访问子进程的 process。已比较保留独立受限子进程与引入专用 JS 隔离运行时；用户确认推荐方案，保留独立子进程，把它视为完全不可信，以系统沙箱和受信宿主承担权限边界，node:vm 只提供执行与绑定语义。模型导入拦截仅作为额外限制，不能作为安全证明。

- 兼容范围补充裁决（2026-09-26）：用户明确选择方案 A，保留原 JS、完整 Skill 目录、自有适配层和 helper。已检查 NodeREPL 宿主依赖、审批、原生动作、Skill 加载、沙箱和取消语义；替代方案 B 为补全宿主契约并以完整 computer 行为一致为目标开展系统对照，因验证成本扩大且原生实现不可见而未采用。此前“源码复用即可保证行为一致”的 Agent 假设被否定。接受无法证明全部行为相同的限制；D5/D10/D12 检查作为相关实现前置项。

- Skill 来源补充裁决：本机旧 Skill 使用 node_repl/sky，用户明确选择以现行 cua_repl 核心文档原文作为 Skill 正文，仅添加本项目加载元数据，不复用旧 Skill 的接口说明。

- D6 补充裁决（Mac 实测后）：用户明确选择后台使用 AX；坐标点击、拖拽、滚动仅在目标已在前台时执行，后台请求在投递前报不支持，不自动激活或试投。Finder/Safari 反例与替代方案见 design 的 D6 Battle 记录。

- 后续明确裁决：只复用 Codex JavaScript 包、Computer Use Skill 与配套文档，保留自己的原生 helper；复制的文件提交进仓库。原样 vendor `@oai/cua-repl`、`@oai/cua`、`@oai/sky`，通过加载钩子适配传输与遥测，不复制浏览器实现或原生二进制；来源、版本及同步脚本随文件入库。专有文件仅内部使用，正式发布前移除或替换。
- 类型：产品（授权交互）+ 架构（审批机制、执行模型、模型接口、数据策略）+ 安全。
- 状态：**Battle 已裁决（2026-09-26）**。用户裁决"直接对齐 Codex"，接受逐应用授权、应用策略与始终允许、截图写入会话临时文件、后台操作四项规格变更；随后裁决对齐 Codex 现行 `cua_repl` 接口而非旧的扁平 `@oai/sky` 接口，并纳入覆盖提示与 Esc 取消、应用专属说明两项附加能力；随后裁决"需要实现追问"：敏感动作确认采用 Codex 的对话式追问，由 Computer Use 状态跨轮保留来支撑，不另设阻塞确认工具。
- 已比较的替代方案：一是保留逐动作确认，JS 入口只读、动作统一走类型化工具并在调用前审批（Agent 在对齐前的推荐），可消除挂起/重放问题但与 Skill 用法不一致；二是只对齐旧扁平接口，改动较小但与 Codex 现行行为持续偏离。用户均未采纳。
- 明确不纳入：锁屏下工作（`CUALockScreenGuardian` / `screenLocked`）、系统声音录制、浏览器表面。
- 用户接受的已知风险：应用获批后该应用内的点击、输入不再逐次确认，误操作与提示注入的影响面扩大到整个已授权应用，敏感动作确认依赖模型遵守确认策略；截图会短暂落盘。
- 需要记录的事实：仓库中的 `@oai/sky` 是本项目自写的适配层，不是 Codex 的依赖库；Codex 的 computer-use 插件声明为 `"license": "Proprietary"`，本项目沿用其接口名、包名与文档文本存在授权与商标风险，本变更不处理，留待发布前评估。

- D6 键盘补充裁决（2026-09-26）：0.1 实测发现后台键盘在微信上静默无效却报告成功；比较键盘也要求前台、按应用白名单两种替代方案后，用户选择保留后台键盘但返回「已投递未确认」并提示模型核实（Agent 推荐），未确认的输入不计入已执行文本长度。

- D5 补充裁决（2026-09-26）：0.4 实测发现动作后强制重读与 Codex 文档的批量动作写法冲突；比较强制重读、窗口变化即作废两种替代方案后，用户选择允许连续动作并在每个动作前逐个核对元素（Agent 推荐）。接受动作改变界面上下文而目标元素属性未变时后续动作仍执行的风险。

- D11 补充裁决（2026-09-26）：用户选择整段 Computer Use JS 仅存内存，历史与检查点保存代码长度及已执行文本长度；接受历史不可查看原代码、重启后待执行调用不可恢复的代价。比较过先加密存储再事后脱敏，因临时密钥和恢复/清理机制的成本未采用。
