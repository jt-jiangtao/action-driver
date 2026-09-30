## Context

动机与失败证据见 proposal.md。与实现相关的现状约束：

- Computer Use 的 `js` 是当前唯一声明 `redactForPersistence` 的工具；脱敏因此只在该工具上生效，其他工具的失败消息不受影响。
- 同一套脱敏被三个出口复用：持久化的 `tool_invocations.error_json`、事件与交互日志，以及 `agent-graph.ts` 拼给模型的工具结果。任何一处放行，另两处也一起改变。
- `ToolError` 的 wire 结构是 `.strict()` 的 `{ code, message, retryable }`，事件与检查点按该结构序列化。
- 门禁失败发生在执行器内部、JS 代码尚未运行之前，因此这些消息全部是代码里的静态字面量。

## Goals / Non-Goals

**Goals:**

- 未读 `computer-use` Skill、引擎不可用、上下文缺失、源代码不可用、参数无效与应用授权结果等静态指引错误，原样出现在模型可见结果与用户界面中。
- 含隐私的内容继续保持现状：执行输出、JS 代码与用户输入文本在历史、事件、交互日志和模型可见结果中只有长度或脱敏占位。
- 模型在工具说明层面就能得知 `js` 的 Skill 前置条件。

**Non-Goals:**

- 不改 `ToolError` wire 契约、事件负载、检查点结构或桌面 UI 结构。
- 不改变“必须先读 `computer-use` Skill”这一门禁本身，也不新增自动加载 Skill 的行为。
- 不把可能含动态内容的消息（例如带 schema 校验细节的 `INVALID_REQUEST: …`）纳入放行范围。
- 不重写已经持久化的历史记录，旧条目继续显示既有占位。

## Decisions

### D1：按精确消息文本放行，而不是给错误加标记字段

新增中性的模块 `apps/agent-runtime/src/tool-error-exposure.ts`，导出可放行消息的常量与判定函数；Computer Use 的抛出点引用同一常量，`tool-result-redaction.ts` 的 `redactToolError` 在消息命中时原样返回，否则维持 `[redacted N characters]`。

- 替代方案：给 `ToolError` 增加 `expose` 字段，由抛出点显式标记。放弃原因是该结构是 `.strict()` 的 wire 契约，改它会连带事件、持久化与桌面投影；本轮需要放行的都是静态字面量，标记式方案的额外能力用不上。
- 选择理由：改动集中在 agent-runtime 内部，失败方向安全——漏配只会继续脱敏，不会泄露隐私。

### D2：放行范围限定为规范列出的静态指引错误

放行 `SKILL_NOT_LOADED`、`ENGINE_UNAVAILABLE`、`COMPUTER_USE_CONTEXT_REQUIRED`、`COMPUTER_CODE_UNAVAILABLE`、`TOOL_INPUT_INVALID`、`APP_DENIED`、`APP_FORBIDDEN`、`APP_BUSY`，以及应用授权流程中的固定取消文案。`codex-native-client.ts` 中拼接校验细节的 `INVALID_REQUEST: ${…}` 与其余消息保持脱敏。

- 替代方案：把既有的 61 字符门禁文案直接写死在脱敏函数里。放弃原因是文案与抛出点分离，后续修改容易造成静默失效。

### D3：前置条件写进 `js` 工具说明

在 `cua-tools.ts` 组装 `js` 说明时追加一行项目补充说明（与既有的 `browser-disabled` 片段同样方式拼接）：同一会话首次调用前必须先用 `skill_read` 读取 `computer-use`，否则返回 `SKILL_NOT_LOADED`。`js_reset` 不设门禁，说明保持不变。

- 替代方案：仅在失败消息里给出指引，靠模型自纠。放弃原因是本次真实失败中模型连续三次盲目重试，说明单靠错误回执的恢复成本过高，而工具说明是唯一在首次调用前就可见的通道。

### D4：用 `NODE_OPTIONS` 给 Runtime 进程启用 vm 模块，而不是 `execArgv`

受信宿主 `codex-service-host.mjs` 是在 Runtime 进程内 import 的（`codex-sky-session.ts`），它需要 `vm.SourceTextModule` 才能加载随包的 `@oai/sky` 源码。Runtime 由 `utilityProcess.fork` 启动，因此启动环境必须带上该能力；`runtimeProcessEnvironment` 在保留调用方既有 `NODE_OPTIONS` 的前提下追加 `--experimental-vm-modules`。

- 实测依据：同一 Electron 38.8.6 下，`execArgv: ['--experimental-vm-modules']` 无效（子进程 `vm.SourceTextModule` 仍缺失），`env.NODE_OPTIONS` 有效；用真实宿主模块复现出 `ENGINE_UNAVAILABLE: trusted host requires VM module support`（59 字符，与线上错误长度一致），修复后宿主正常创建。
- 替代方案：把受信宿主移到独立子进程，像 `js` 子进程那样显式带 flag 启动。隔离更干净、不依赖 Runtime 启动参数，但要新增进程与 IPC 边界，成本明显更高；本轮不采用。
- 替代方案：改用 `vm.SourceTextModule` 之外的加载方式。需要重写 vendor 加载器，代价与风险都不成比例。

### D5：失败的 Computer Use 调用复用既有的易失内存通道回给模型

`js` 是唯一声明 `redactForPersistence` 的工具，成功结果已经通过 `volatileToolResults`（以 `taskId:providerCallId` 为键的进程内映射）在「下一次模型请求」处替换为原始输出，历史与事件保留脱敏副本。失败结果此前不进入该通道，因此模型既拿不到原始错误，也拿不到该次调用失败前打印的入口文档——而文档正是它写对代码的前提。本设计让失败结果同样进入该通道，携带原始 `error` 与该次调用已产出的 `stdout`／`stderr`／`result` 文本。

- 选择理由：复用已验证的通道，改动集中在 `agent-graph.ts` 一处；不触碰 `ToolError` 与事件结构，历史、交互日志与界面维持既有脱敏强度。
- 替代方案：把失败事件的 `output` 加进 `tool.failed` 事件并持久化。放弃原因是 `tool.failed` 是 `.strict()` 的 wire 契约，且会把 JS 输出写入历史，直接违反「最小化界面数据」。
- 替代方案：只补工具说明。放弃原因：本次真实失败中模型连续 7 次盲试，说明仅有静态说明不足。
- 记忆体影响：失败结果与成功结果同样是每任务每调用一份，模型消费后由 `releaseVolatileToolResults` 释放，未进入检查点。

同一决策下，`js` 工具说明新增入口声明：受支持入口是宿主提供的全局 `cua`，不要 `import("@oai/sky")` 也不要引用 `sky` 全局。

### D6：界面展示内存中的代码、输出与错误，而不是把它们持久化

`js` 执行器在通过输入校验后把源码放进 `LiveComputerCalls`，执行结束时再把该次调用实际打印的文本或失败原因写进同一条记录（进程内、带上限的最近若干次调用）；流服务在构造工具流事件时，若该调用仍在内存里，就以 `{ code }` 作为 `rawInput`、以实际文本作为 `rawOutput`、以原始错误作为 `rawError` 下发，界面分别按 JavaScript、纯文本与纯文本展示。历史、运行时事件、交互日志与检查点仍只有代码长度、已执行文本长度与输出长度。

- 选择理由：`rawInput` 与界面渲染路径都已存在，改动只在 runtime 侧读取内存表；持久化形态（长度摘要）与既有隐私裁决完全一致。
- 替代方案：把代码写进持久化输入，让历史也能看到。放弃原因：这是此前明确裁决过的隐私边界，本次用户裁决也确认不覆盖它。
- 替代方案：另开一条诊断接口或调试面板。放弃原因：界面已有展开区，复用 `rawInput`／`rawOutput` 并新增可选 `rawError`（工具流事件的公共字段）即可，避免多一套权限面。
- 已知代价：Runtime 重启后、或记录被挤出内存上限后，卡片回落到长度摘要；界面不会长期保留这些内容。

### D7：沙箱子进程的加载器为遥测模块提供合成实现

随包 `@oai/sky` 的 `computer-use-telemetry.js` 导入 `@statsig/js-client`，而该依赖只存在于 `@oai/cua` 的嵌套 `node_modules`，从 vendor 树无法解析。受信宿主本来就以合成模块替换同一文件；本设计让沙箱入口的 `codex-module-loader.mjs` 做同样的替换，并把该加载器接入应用的子进程启动参数（此前只有测试使用它）。

- 选择理由：与受信宿主行为一致，模型直接导入 `@oai/sky` 时不再因缺包失败；vendor 字节保持不改。
- 替代方案：把 `@statsig/js-client` 及其依赖补进 vendor 树。放弃原因：体积与维护成本高，且仍然改动 vendor 契约。
- 替代方案：改写 vendored 遥测文件。放弃原因：与「保持 vendor 字节不变」的既有约束冲突。

### D8：桌面 provider 的命令白名单跟着模型入口走

模型入口在应用寻址改造后发送 `app-policy`、`session-start`、`session-end`，而桌面 provider 仍只放行改造前的 `permissions`／`observe`／`capture`／`act`／`list-apps`／`app-state`，于是所有需要应用策略的调用（例如 `cua.getApp(...)`）都以 `SKILL_PROVIDER_FAILED: INVALID_REQUEST: Unsupported Computer Use command`（72 字符）失败。本设计把白名单收敛为模型入口真正使用的集合：`act`、`list-apps`、`app-state`、`app-policy`、`session-start`、`session-end`。

- 选择理由：白名单表达的是「运行时可以请求哪些桌面操作」，必须与入口实际发送的操作一致；`permissions`／`guidance` 由桌面自己直接访问 helper，保持不对外开放。
- 替代方案：直接删掉白名单，只靠请求 schema 校验。放弃原因：schema 还包含 `shutdown`、`cancel` 等桌面专用操作，白名单是这层窄化的唯一位置。
- 替代方案：把 `permissions`／`guidance` 一并放行。放弃原因：当前没有运行时调用方，扩大接口面没有收益。
- 回归保护：`computer-use-provider.test.ts` 现在断言 `app-policy`／`session-start`／`session-end` 被接受，同时继续拒绝 `observe` 与 `shutdown`。

### D9：审批请求只持久化冻结字段

审批请求原先用 `...context` 展开调用方上下文，而入口传入的上下文是 `CodexCallContext`（带 `signal: AbortSignal`），于是 `computer.app-approval.requested` 的持久化负载里出现了运行时对象，被持久化守卫以 `PERSISTENCE_PAYLOAD_REJECTED at runtimeEvent.payload.approval.signal` 拒绝——审批流程因此无法进入等待状态。

- 选择理由：持久化的审批请求本就只需要 `requestId`／`taskId`／`sessionId`／`target`／`allowPersistentApproval`；逐字段构造既消除运行时对象，也固定了事件负载的形状。
- 替代方案：在持久化前深拷贝并剔除 `signal`。放弃原因：形状仍由调用方决定，下一次上下文扩展会再次把运行时对象带进来。
- 回归保护：`app-approval-broker.test.ts` 断言带 `signal` 的上下文产出的请求恰好只有那五个字段。

### D10：Computer Use 输入、输出与错误随调用持久化（用户覆盖既有隐私裁决）

用户裁决要求模型能拿到原始错误并在刷新／重启后仍能看到调用细节，因此 `js` 执行器不再声明 `redactForPersistence`：输入（JS 代码）、输出与错误像其他工具一样进入持久化。随之删除只为最小化落库存在的东西：图内的易失源码映射与结果替换、`COMPUTER_CODE_UNAVAILABLE` 分支、仅内存的展示通道与 `rawError` 协议字段。失败工具的输出改为在 `ToolInvocationService` 的 catch 中快照（此前只有输出超限／进程退出三类错误会保留输出），并通过工具结果里的 `output` 回给模型。

- 选择理由：诊断链路要闭环——用户看得见、模型看得见、重启后还在，且三处是同一份原文；同时删掉一整层状态，避免「内存里有、历史里没有」的不一致。
- 被覆盖的旧决策：`align-computer-use-with-codex` 要求「JS 代码仅存内存，历史／检查点只保存长度」。覆盖由用户明确作出，已知代价是代码中可能内嵌的用户输入、屏幕文本与错误原文会落库。
- 替代方案：只持久化错误与输入，输出仍只存长度。放弃原因：用户明确要求三者都持久化，且缺少输出时模型难以判断动作是否已生效。
- 未改变：截图、窗口图像与完整元素树仍然只在会话临时目录／短期内存中，会话结束即删除；应用授权仍需用户裁决。

## Risks / Trade-offs

- [错误文案改动后白名单失配] → 抛出点与白名单共用同一常量，断言按常量比对；失配时的行为是退回脱敏，不会泄露。
- [误把含隐私的文案列入白名单] → 白名单只接受静态字面量；`js` 输出流、代码与执行文本长度的既有路径不经过白名单。新增条目必须同时补一条“未列入即脱敏”的反向用例。
- [模型把 `APP_DENIED` 当作可重试错误] → 文案本身指明应用未获授权；本轮不引入新的重试策略，若出现误重试再单独立项。
- [用户界面暴露更多实现细节] → 放行的都是设计为面向模型的固定指令文本，不含应用内容、屏幕内容或用户数据。
- [Runtime 进程受 `NODE_OPTIONS` 影响] → 只追加 vm 模块开关，保留调用方已有取值；Electron 对 `NODE_OPTIONS` 有白名单限制，本轮使用的 flag 已实测生效。
- [依赖 vender 加载器内部实现] → 该能力由受信宿主启动时自检，缺失时返回可诊断错误而不是静默降级；若后续换成独立子进程方案，本决策随之失效。
- [失败输出仍可能含屏幕内容] → 只进入模型请求，不写历史、事件或界面；模型本来就在同一次会话里看过这些内容，不扩大暴露面。用例同时断言检查点不含原文。
- [界面展示的代码进入本机界面进程] → 只走运行时到渲染进程的实时流，界面不写入任何持久化存储（renderer 仅用 sessionStorage 记录当前任务 id）；用例断言历史记录仍只有长度摘要。
- [内存代码表增长] → 表按最近 200 次调用淘汰，进程退出即消失；未命中时界面回落为长度摘要。
- [加载器替换遥测改变第三方行为] → 替换后的合成实现只导出四个空实现函数（与受信宿主一致），不改变 sky 的功能路径。
- [持久化代码与输出带来隐私回归] → 这是用户明确覆盖的裁决：历史、事件、交互日志与检查点会包含模型写进代码的应用内文本与屏幕文本；截图与完整元素树仍不落库。若后续要收回，需要单独裁决并设计已存历史的清理。
- [失败调用的输出体积] → 失败输出沿用工具输出上限（1 MiB）与流事件的 64 KiB 原始 I/O 上限，超限部分被截断并标记。

## Migration Plan

无数据迁移：历史条目保持既有脱敏占位，新产生的错误按新规则记录。回滚即还原 `tool-error-exposure.ts` 的引入与 `redactToolError` 的判定分支，行为回到当前状态。

## Archive Decision (2026-09-30)

### Decisions

- 最终方向：按用户明确裁决直接归档本变更，保留 25/27 的历史任务状态，不实施剩余任务，也不同步 1 份 delta spec。
- 对比过的替代方案：先审计当前代码与各变更的依赖，完成仍有效的任务、同步规范后再逐项归档。该方案可减少遗留缺口，但需要继续执行用户现已取消的工作。
- 用户覆盖：此前建议先审计并完成有效项；用户随后明确改为整体归档，并确认当前无任务要执行。

### Risks / Trade-offs

- 未完成任务不会因归档而完成；如需这些功能，必须重新立项和验证。
- Delta spec 留在历史归档中，不作为主规范当前要求；归档不删除其他工作树中的未提交文件。
